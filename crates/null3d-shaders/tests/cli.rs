//! The `shader-build` command, run against copies of a few of the repository's shaders.

mod subset;

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::atomic::{AtomicUsize, Ordering};

use null3d_shaders::{MANIFEST_PATH, OUTPUT_DIR, OUTPUT_PATH, SHADER_DIR};
use subset::repository_subset;

/// The shaders in each copy: one that loads by device with draw index builds, one without a GLSL
/// target, one without permutation bits, and one that stays in the main module.
const SHADERS: [&str; 4] = ["outline_mask", "cull", "mipmap", "test_mesh"];

/// The shaders of the cache tests: `test_mesh` imports the `null3d::math` library module, and the
/// other two import none.
const CACHE_SHADERS: [&str; 3] = ["test_mesh", "cull", "mipmap"];

/// A scratch folder that holds a copy of the shader inputs and is removed when dropped.
struct Scratch(PathBuf);

impl Scratch {
    fn new() -> Self {
        Self::of(&SHADERS)
    }

    /// A copy of the repository's shaders with only `names` in the manifest.
    fn of(names: &[&str]) -> Self {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let root = std::env::temp_dir().join(format!(
            "null3d-shader-build-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&root);
        let inputs = repository_subset(names);
        for (file, text) in &inputs.files {
            write(&root.join(SHADER_DIR).join(file), text);
        }
        write(&root.join(MANIFEST_PATH), &inputs.manifest);
        Self(root)
    }

    fn run(&self) -> Output {
        Command::new(env!("CARGO_BIN_EXE_shader-build"))
            .arg("--root")
            .arg(&self.0)
            .output()
            .expect("the shader-build command runs")
    }

    /// The folder of this copy's per-entry cache.
    fn cache_dir(&self) -> PathBuf {
        self.0.join(".shader-cache")
    }

    /// Runs the command with a per-entry cache whose compiler stamp is `test`.
    fn run_cached(&self) -> Output {
        Command::new(env!("CARGO_BIN_EXE_shader-build"))
            .arg("--root")
            .arg(&self.0)
            .arg("--cache")
            .arg(self.cache_dir())
            .arg("--stamp")
            .arg("test")
            .output()
            .expect("the shader-build command runs")
    }

    /// Each entry's stored record, by file name, from the cache folder.
    fn cache_files(&self) -> BTreeMap<String, String> {
        let Ok(entries) = fs::read_dir(self.cache_dir()) else {
            return BTreeMap::new();
        };
        entries
            .map(|entry| {
                let entry = entry.unwrap();
                let name = entry.file_name().to_string_lossy().into_owned();
                (name, fs::read_to_string(entry.path()).unwrap())
            })
            .collect()
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn write(path: &Path, text: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, text).unwrap();
}

fn text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

/// The entries a run compiled and reused, from the command's summary line.
fn stats(output: &Output) -> (usize, usize) {
    let stdout = text(&output.stdout);
    let line = stdout
        .lines()
        .find(|line| line.starts_with("The shader build compiled"))
        .unwrap_or_else(|| panic!("no build summary in:\n{stdout}"));
    let compiled = line
        .split("compiled ")
        .nth(1)
        .and_then(|rest| rest.split(' ').next())
        .and_then(|word| word.parse().ok())
        .unwrap_or_else(|| panic!("no compiled count in: {line}"));
    let reused = line
        .split("reused ")
        .nth(1)
        .map(|rest| rest.trim_end_matches('.'))
        .and_then(|word| word.parse().ok())
        .unwrap_or_else(|| panic!("no reused count in: {line}"));
    (compiled, reused)
}

/// Every generated module in a folder, by file name.
fn modules(folder: &Path) -> BTreeMap<String, String> {
    fs::read_dir(folder)
        .unwrap()
        .map(|entry| entry.unwrap())
        .map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            (name, fs::read_to_string(entry.path()).unwrap())
        })
        .collect()
}

#[test]
fn the_build_writes_the_modules_and_replaces_a_hand_edit() {
    let scratch = Scratch::new();
    let output = scratch.0.join(OUTPUT_PATH);

    let written = scratch.run();
    assert!(written.status.success(), "{}", text(&written.stderr));
    assert!(
        text(&written.stdout)
            .contains("Wrote the shader modules in packages/engine/src/generated.")
    );
    let fresh = fs::read_to_string(&output).unwrap();

    let edited = fresh.replacen("#version 300 es", "#version 310 es", 1);
    assert_ne!(edited, fresh);
    fs::write(&output, &edited).unwrap();
    let rewritten = scratch.run();
    assert!(rewritten.status.success());
    assert!(text(&rewritten.stdout).contains("Wrote the shader modules"));
    assert_eq!(fs::read_to_string(&output).unwrap(), fresh);

    let unchanged = scratch.run();
    assert!(text(&unchanged.stdout).contains("already up to date"));
}

#[test]
fn separate_runs_write_the_same_modules() {
    let first = Scratch::new();
    let second = Scratch::new();
    assert!(first.run().status.success());
    assert!(second.run().status.success());
    let built = modules(&first.0.join(OUTPUT_DIR));
    assert!(
        built.contains_key("shaders.ts") && built.len() > 1,
        "{:?}",
        built.keys()
    );
    assert!(built == modules(&second.0.join(OUTPUT_DIR)));
}

#[test]
fn a_second_run_with_no_change_reuses_every_entry() {
    let scratch = Scratch::of(&CACHE_SHADERS);
    let first = scratch.run_cached();
    assert!(first.status.success(), "{}", text(&first.stderr));
    assert_eq!(stats(&first), (CACHE_SHADERS.len(), 0));
    let built = modules(&scratch.0.join(OUTPUT_DIR));

    let second = scratch.run_cached();
    assert!(second.status.success(), "{}", text(&second.stderr));
    assert!(text(&second.stdout).contains("already up to date"));
    assert_eq!(stats(&second), (0, CACHE_SHADERS.len()));
    assert_eq!(modules(&scratch.0.join(OUTPUT_DIR)), built);
}

#[test]
fn changing_one_entry_compiles_only_that_entry() {
    let scratch = Scratch::of(&CACHE_SHADERS);
    assert!(scratch.run_cached().status.success());
    let before = scratch.cache_files();
    let built = modules(&scratch.0.join(OUTPUT_DIR));

    // `cull` imports no library module, so only its own entry compiles again.
    let shader = scratch.0.join(SHADER_DIR).join("cull.wgsl");
    let source = fs::read_to_string(&shader).unwrap();
    let changed = source.replace(
        "const WORKGROUP_SIZE: u32 = 128u;",
        "const WORKGROUP_SIZE: u32 = 64u;",
    );
    assert_ne!(changed, source);
    fs::write(&shader, changed).unwrap();

    let run = scratch.run_cached();
    assert!(run.status.success(), "{}", text(&run.stderr));
    assert_eq!(stats(&run), (1, CACHE_SHADERS.len() - 1));
    assert_ne!(
        modules(&scratch.0.join(OUTPUT_DIR)),
        built,
        "the edited shader's module output did not change"
    );
    let after = scratch.cache_files();
    assert_ne!(before["cull.json"], after["cull.json"]);
    for name in ["test_mesh.json", "mipmap.json"] {
        assert_eq!(
            before[name], after[name],
            "the entry `{name}` compiled again"
        );
    }
}

#[test]
fn changing_a_library_module_compiles_only_its_importers() {
    let scratch = Scratch::of(&CACHE_SHADERS);
    assert!(scratch.run_cached().status.success());
    let before = scratch.cache_files();

    // `test_mesh` imports `null3d::math`; `cull` and `mipmap` import no library module.
    let library = scratch.0.join(SHADER_DIR).join("lib/math.wgsl");
    let source = fs::read_to_string(&library).unwrap();
    fs::write(&library, format!("{source}\n// the cache test's probe.\n")).unwrap();

    let run = scratch.run_cached();
    assert!(run.status.success(), "{}", text(&run.stderr));
    assert_eq!(stats(&run), (1, CACHE_SHADERS.len() - 1));
    let after = scratch.cache_files();
    assert_ne!(before["test_mesh.json"], after["test_mesh.json"]);
    for name in ["cull.json", "mipmap.json"] {
        assert_eq!(before[name], after[name], "`{name}` does not import math");
    }
}

#[test]
fn a_corrupted_or_missing_cache_entry_compiles_again_with_identical_output() {
    let scratch = Scratch::of(&CACHE_SHADERS);
    let clean = Scratch::of(&CACHE_SHADERS);
    assert!(clean.run().status.success());
    let expected = modules(&clean.0.join(OUTPUT_DIR));

    assert!(scratch.run_cached().status.success());
    fs::write(scratch.cache_dir().join("cull.json"), "{ not a cache entry").unwrap();
    let corrupted = scratch.run_cached();
    assert!(corrupted.status.success(), "{}", text(&corrupted.stderr));
    assert_eq!(stats(&corrupted), (1, CACHE_SHADERS.len() - 1));
    assert_eq!(modules(&scratch.0.join(OUTPUT_DIR)), expected);

    fs::remove_file(scratch.cache_dir().join("mipmap.json")).unwrap();
    let missing = scratch.run_cached();
    assert!(missing.status.success(), "{}", text(&missing.stderr));
    assert_eq!(stats(&missing), (1, CACHE_SHADERS.len() - 1));
    assert_eq!(modules(&scratch.0.join(OUTPUT_DIR)), expected);
}

#[test]
fn a_warm_cache_writes_the_same_modules_as_a_cold_build() {
    let cached = Scratch::of(&CACHE_SHADERS);
    assert!(cached.run_cached().status.success());
    let warm = modules(&cached.0.join(OUTPUT_DIR));

    let plain = Scratch::of(&CACHE_SHADERS);
    assert!(plain.run().status.success());
    assert_eq!(modules(&plain.0.join(OUTPUT_DIR)), warm);

    for entry in fs::read_dir(cached.0.join(OUTPUT_DIR)).unwrap() {
        fs::remove_file(entry.unwrap().path()).unwrap();
    }
    let again = cached.run_cached();
    assert!(again.status.success(), "{}", text(&again.stderr));
    assert_eq!(stats(&again), (0, CACHE_SHADERS.len()));
    assert_eq!(modules(&cached.0.join(OUTPUT_DIR)), warm);
}

#[test]
fn the_cache_can_be_turned_off() {
    let scratch = Scratch::of(&CACHE_SHADERS);
    assert!(scratch.run_cached().status.success());

    let flagged = Command::new(env!("CARGO_BIN_EXE_shader-build"))
        .arg("--root")
        .arg(&scratch.0)
        .arg("--cache")
        .arg(scratch.cache_dir())
        .arg("--stamp")
        .arg("test")
        .arg("--no-cache")
        .output()
        .expect("the shader-build command runs");
    assert!(flagged.status.success(), "{}", text(&flagged.stderr));
    assert_eq!(stats(&flagged), (CACHE_SHADERS.len(), 0));

    let environment = Command::new(env!("CARGO_BIN_EXE_shader-build"))
        .arg("--root")
        .arg(&scratch.0)
        .arg("--cache")
        .arg(scratch.cache_dir())
        .env("NULL3D_NO_SHADER_CACHE", "1")
        .output()
        .expect("the shader-build command runs");
    assert!(
        environment.status.success(),
        "{}",
        text(&environment.stderr)
    );
    assert_eq!(stats(&environment), (CACHE_SHADERS.len(), 0));
}

#[test]
fn the_build_writes_a_module_for_each_target_and_value_of_the_bits_a_device_fixes() {
    let scratch = Scratch::new();
    assert!(scratch.run().status.success());
    let folder = scratch.0.join(OUTPUT_DIR);
    for module in [
        "shaders-wgsl.js",
        "shaders-glsl.js",
        "shaders-glsl-draw-index.js",
    ] {
        let text = fs::read_to_string(folder.join(module)).unwrap();
        assert!(text.contains("export const SHADERS = {"), "{module}");
    }
    let wgsl = fs::read_to_string(folder.join("shaders-wgsl.js")).unwrap();
    assert!(wgsl.contains("\toutline_mask: {\n\t\twebgpu: {") && !wgsl.contains("#version"));
    let glsl = fs::read_to_string(folder.join("shaders-glsl-draw-index.js")).unwrap();
    assert!(glsl.contains("\toutline_mask: {\n\t\twebgl2_draw_index: {"));
    assert!(glsl.contains("\tcull: {},") && !glsl.contains("\toutline_mask: {\n\t\twebgl2: {"));
    // A shader without permutation bits is in every module of its target.
    assert!(glsl.contains("\tmipmap: {\n\t\twebgl2: {"));
    let main = fs::read_to_string(scratch.0.join(OUTPUT_PATH)).unwrap();
    assert!(main.contains(
        "\t1: () => importShaders(new URL('./shaders-glsl-draw-index.js', import.meta.url)),"
    ));
    assert!(!main.contains("OUTLINE_MASK_SHADER") && main.contains("TEST_MESH_SHADER"));
}

#[test]
fn the_build_deletes_a_device_module_that_it_no_longer_makes() {
    let scratch = Scratch::new();
    assert!(scratch.run().status.success());
    let stale = scratch.0.join(OUTPUT_DIR).join("shaders-glsl-skin.js");
    fs::write(&stale, "export {};\n").unwrap();
    let rebuilt = scratch.run();
    assert!(rebuilt.status.success());
    assert!(text(&rebuilt.stdout).contains("Wrote the shader modules"));
    assert!(!stale.exists());
}

#[test]
fn a_shader_error_fails_the_command_with_the_file_and_line() {
    let scratch = Scratch::new();
    let shader = scratch.0.join(SHADER_DIR).join("test_mesh.wgsl");
    let source = fs::read_to_string(&shader).unwrap();
    let broken = source.replace(
        "var world = position;",
        "var world = position;\n    world.xy = vec2f(0.0);",
    );
    fs::write(&shader, broken).unwrap();
    let result = scratch.run();
    assert_eq!(result.status.code(), Some(1));
    let message = text(&result.stderr);
    let line = source
        .lines()
        .position(|l| l.contains("var world = position;"))
        .unwrap()
        + 2;
    assert!(
        message.contains(&format!("{SHADER_DIR}/test_mesh.wgsl:{line}:10: ")),
        "{message}"
    );
    assert!(message.contains("`swizzle_assignment`"), "{message}");
    assert!(!scratch.0.join(OUTPUT_PATH).exists());
}

#[test]
fn unknown_arguments_are_rejected() {
    let result = Command::new(env!("CARGO_BIN_EXE_shader-build"))
        .arg("--fix")
        .output()
        .unwrap();
    assert_eq!(result.status.code(), Some(2));
    assert!(text(&result.stderr).contains("unknown argument `--fix`"));
}
