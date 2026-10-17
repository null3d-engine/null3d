//! The per-entry shader cache: a change to one shader compiles only that shader, and a change to
//! a library module compiles only the entries that import it.

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};

use null3d_shaders::{Cache, CacheStats, Inputs, Output};

/// The repository's `null3d::math` module, which `a` imports.
fn math() -> String {
    fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/wgsl/lib/math.wgsl"))
        .expect("the math library module")
}

/// A fragment shader that imports `null3d::math`, so a change to that module reaches it.
const A: &str = r"#import null3d::math

@fragment
fn fs_main() -> @location(0) vec4f {
    return vec4f(null3d::math::square(0.5));
}
";

/// A fragment shader that imports nothing, so no library change reaches it.
const B: &str = r"@fragment
fn fs_main() -> @location(0) vec4f {
    return vec4f(0.25);
}
";

/// Two entries, `a` and `b`, over the repository's math module.
fn project(a: &str, b: &str) -> Inputs {
    let manifest = r#"[shaders.a]
file = "a.wgsl"
variants.plain = { targets = ["wgsl"] }

[shaders.b]
file = "b.wgsl"
variants.plain = { targets = ["wgsl"] }
"#;
    let mut files = BTreeMap::new();
    files.insert("lib/math.wgsl".to_owned(), math());
    files.insert("a.wgsl".to_owned(), a.to_owned());
    files.insert("b.wgsl".to_owned(), b.to_owned());
    Inputs {
        manifest: manifest.to_owned(),
        files,
    }
}

/// The math module with a change that reaches every shader that calls `square`.
fn changed_math() -> String {
    math().replace("return x * x;", "return x * x + 1.0;")
}

/// A scratch folder for the cache, removed when dropped.
struct Scratch(PathBuf);

impl Scratch {
    fn new() -> Self {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let root = std::env::temp_dir().join(format!(
            "null3d-shader-cache-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        Self(root)
    }

    /// The cache in this scratch folder, under the compiler stamp `test`.
    fn cache(&self) -> Cache {
        Cache::at(&self.0, "test")
    }

    /// One entry's cache file: the name it was built under, then the key of that build.
    fn entry(&self, name: &str) -> PathBuf {
        let prefix = format!("{name}.");
        let mut found: Vec<PathBuf> = fs::read_dir(&self.0)
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| {
                let file = path.file_name().unwrap_or_default().to_string_lossy();
                file.starts_with(&prefix) && file.ends_with(".json")
            })
            .collect();
        assert_eq!(found.len(), 1, "one cached entry named {name}");
        found.pop().unwrap()
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// Builds once, with the cache, and returns the output.
fn build(scratch: &Scratch, inputs: &Inputs) -> Output {
    null3d_shaders::build_with_cache(inputs, &scratch.cache())
        .expect("the build succeeds")
        .0
}

#[test]
fn a_second_build_reuses_every_entry_and_changes_nothing() {
    let scratch = Scratch::new();
    let inputs = project(A, B);
    let first = null3d_shaders::build_with_cache(&inputs, &scratch.cache()).unwrap();
    assert_eq!(
        first.1,
        CacheStats {
            compiled: 2,
            reused: 0
        }
    );
    let second = null3d_shaders::build_with_cache(&inputs, &scratch.cache()).unwrap();
    assert_eq!(
        second.1,
        CacheStats {
            compiled: 0,
            reused: 2
        }
    );
    assert_eq!(first.0, second.0);
}

#[test]
fn changing_one_entry_recompiles_only_that_entry() {
    let scratch = Scratch::new();
    let first = build(&scratch, &project(A, B));
    let changed = A.replace("0.5", "0.75");
    let (output, stats) =
        null3d_shaders::build_with_cache(&project(&changed, B), &scratch.cache()).unwrap();
    assert_eq!(
        stats,
        CacheStats {
            compiled: 1,
            reused: 1
        }
    );
    assert_ne!(output.shaders["a"], first.shaders["a"]);
    assert_eq!(output.shaders["b"], first.shaders["b"]);
}

#[test]
fn changing_a_library_module_recompiles_only_the_entries_that_import_it() {
    let scratch = Scratch::new();
    let first = build(&scratch, &project(A, B));
    let mut inputs = project(A, B);
    inputs
        .files
        .insert("lib/math.wgsl".to_owned(), changed_math());
    let (output, stats) = null3d_shaders::build_with_cache(&inputs, &scratch.cache()).unwrap();
    assert_eq!(
        stats,
        CacheStats {
            compiled: 1,
            reused: 1
        }
    );
    assert_ne!(
        output.shaders["a"], first.shaders["a"],
        "the entry that imports math compiles again"
    );
    assert_eq!(
        output.shaders["b"], first.shaders["b"],
        "the entry that imports nothing does not"
    );
}

#[test]
fn a_corrupted_or_missing_entry_compiles_again_with_identical_output() {
    let scratch = Scratch::new();
    let inputs = project(A, B);
    let first = build(&scratch, &inputs);

    fs::write(scratch.entry("b"), "{ this is not a cache entry").unwrap();
    let (corrupted, stats) = null3d_shaders::build_with_cache(&inputs, &scratch.cache()).unwrap();
    assert_eq!(
        stats,
        CacheStats {
            compiled: 1,
            reused: 1
        }
    );
    assert_eq!(corrupted, first);

    fs::remove_file(scratch.entry("a")).unwrap();
    let (missing, stats) = null3d_shaders::build_with_cache(&inputs, &scratch.cache()).unwrap();
    assert_eq!(
        stats,
        CacheStats {
            compiled: 1,
            reused: 1
        }
    );
    assert_eq!(missing, first);
}

#[test]
fn a_warm_cache_gives_the_same_output_as_a_cold_build() {
    let inputs = project(A, B);
    let uncached = null3d_shaders::build(&inputs).unwrap();

    let scratch = Scratch::new();
    let cold = build(&scratch, &inputs);
    assert_eq!(cold, uncached);

    let second = Scratch::new();
    build(&second, &inputs);
    let (warm, stats) = null3d_shaders::build_with_cache(&inputs, &second.cache()).unwrap();
    assert_eq!(
        stats,
        CacheStats {
            compiled: 0,
            reused: 2
        }
    );
    assert_eq!(warm, uncached);
}

#[test]
fn another_compiler_stamp_rebuilds_every_entry() {
    let scratch = Scratch::new();
    build(&scratch, &project(A, B));
    let (_, stats) =
        null3d_shaders::build_with_cache(&project(A, B), &Cache::at(&scratch.0, "other")).unwrap();
    assert_eq!(
        stats,
        CacheStats {
            compiled: 2,
            reused: 0
        }
    );
}
