//! Helpers for building small shader projects in memory.

use std::collections::BTreeMap;

use null3d_shaders::{BuildError, Inputs, Output, Problem, build};

/// The display path of an entry shader in the tests' projects.
pub const SHADER: &str = "crates/null3d-shaders/wgsl/shader.wgsl";

/// The repository's `null3d::math` module.
pub fn math() -> String {
    std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/wgsl/lib/math.wgsl"))
        .expect("the math library module")
}

/// A project with one entry shader, `shader.wgsl`, one pipeline named `main` when the shader has
/// `vs_main` and `fs_main`, and the given variants, written as TOML inline tables. The library
/// holds the repository's math module and any extra modules.
pub fn project(source: &str, variants: &[(&str, &str)], library: &[(&str, &str)]) -> Inputs {
    let mut manifest = String::from("[shaders.shader]\nfile = \"shader.wgsl\"\n");
    if source.contains("fn vs_main") && source.contains("fn fs_main") {
        manifest.push_str("pipelines.main = { vertex = \"vs_main\", fragment = \"fs_main\" }\n");
    }
    for (name, table) in variants {
        manifest.push_str(&format!("variants.{name} = {table}\n"));
    }
    let mut files = BTreeMap::new();
    files.insert("shader.wgsl".to_owned(), source.to_owned());
    files.insert("lib/math.wgsl".to_owned(), math());
    for (file, text) in library {
        files.insert(format!("lib/{file}"), (*text).to_owned());
    }
    Inputs { manifest, files }
}

/// Builds a shader with one variant that targets WGSL.
pub fn build_wgsl(source: &str) -> Result<Output, BuildError> {
    build(&project(source, &[("v", "{ targets = [\"wgsl\"] }")], &[]))
}

/// The WGSL of the only variant.
pub fn wgsl(output: &Output, variant: &str) -> String {
    output.shaders["shader"][variant]
        .wgsl
        .as_ref()
        .expect("a WGSL target")
        .source
        .clone()
}

/// The one problem of a failed build.
pub fn only_problem(result: Result<Output, BuildError>) -> Problem {
    let error = result.expect_err("the build should fail");
    assert_eq!(error.problems.len(), 1, "expected one problem:\n{error}");
    error.problems.into_iter().next().unwrap()
}

/// Asserts that a build fails on a language feature, at a line of the entry shader, with a message
/// that names the file, the line and the feature.
pub fn assert_feature(result: Result<Output, BuildError>, feature: &str, line: u32) {
    let problem = only_problem(result);
    let shown = problem.to_string();
    assert_eq!(problem.feature.as_deref(), Some(feature), "{shown}");
    assert_eq!(problem.file.as_deref(), Some(SHADER), "{shown}");
    assert_eq!(problem.line, Some(line), "{shown}");
    assert!(shown.starts_with(&format!("{SHADER}:{line}: ")), "{shown}");
    assert!(shown.contains(&format!("`{feature}`")), "{shown}");
    assert!(shown.contains("AGENTS.md hard rule 10"), "{shown}");
}
