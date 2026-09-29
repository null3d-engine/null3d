//! Helpers for building small shader projects in memory.
//!
//! When `NULL3D_SHADER_COMPILER` is set, as `bun run test:shader-compiler` sets it, every build
//! also runs through the shader compiler, the WebAssembly module that build tools load, and its
//! result must be the native build's. The module must be built first, with `bun run build`.

use std::collections::BTreeMap;
use std::path::Path;
use std::process::{Command, Stdio};

use null3d_shaders::{BuildError, Inputs, Output, Problem, Response};
use serde_json::Value;

/// The display path of an entry shader in the tests' projects.
pub const SHADER: &str = "crates/null3d-shaders/wgsl/shader.wgsl";

/// How a message about a portability rule ends: with a link to the page that states the rules.
pub const SEE_RULES: &str =
    " See https://github.com/null3d-engine/null3d/blob/main/docs/shaders/wgsl-rules.md";

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

/// Builds the inputs natively, and through the shader compiler when `NULL3D_SHADER_COMPILER` is
/// set. The two results must be the same.
pub fn build(inputs: &Inputs) -> Result<Output, BuildError> {
    let native = null3d_shaders::build(inputs);
    if std::env::var_os("NULL3D_SHADER_COMPILER").is_some() {
        let expected = serde_json::to_value(Response::from(&native)).expect("the native result");
        assert_same(&build_in_shader_compiler(inputs), &expected);
    }
    native
}

/// Runs a build through the shader compiler, in Bun.
fn build_in_shader_compiler(inputs: &Inputs) -> Value {
    let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tools/shader-compiler.ts");
    let mut child = Command::new("bun")
        .arg(script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("Bun runs the shader compiler");
    let stdin = child.stdin.take().expect("the shader compiler's input");
    serde_json::to_writer(stdin, inputs).expect("the request reaches the shader compiler");
    let output = child
        .wait_with_output()
        .expect("the shader compiler finishes");
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        output.status.success(),
        "the shader compiler failed:\n{stderr}"
    );
    serde_json::from_slice(&output.stdout).expect("the shader compiler's JSON result")
}

/// Fails at the first line where two results, printed as JSON, differ.
fn assert_same(compiled: &Value, native: &Value) {
    let pretty = |value| serde_json::to_string_pretty(value).expect("JSON text");
    let (compiled, native) = (pretty(compiled), pretty(native));
    if compiled == native {
        return;
    }
    let line = compiled
        .lines()
        .zip(native.lines())
        .position(|(a, b)| a != b)
        .unwrap_or_else(|| compiled.lines().count().min(native.lines().count()));
    panic!(
        "the shader compiler's result differs from the native build's, first at line {}:\n  shader compiler: {}\n  native build:    {}",
        line + 1,
        compiled.lines().nth(line).unwrap_or("(the end)"),
        native.lines().nth(line).unwrap_or("(the end)"),
    );
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

/// The 1-based column, in characters, of the first `text` in a 1-based line of `source`.
pub fn column_of(source: &str, line: u32, text: &str) -> u32 {
    let line_text = source
        .lines()
        .nth(line as usize - 1)
        .expect("the line exists");
    let at = line_text.find(text).expect("the line holds the text");
    u32::try_from(line_text[..at].chars().count() + 1).unwrap()
}

/// Asserts that a shader with one WGSL variant fails on a language feature at the first `at` in
/// a line of the entry shader, with a message that names the file, the place and the feature, and
/// ends with a link to the rules page.
pub fn assert_feature(source: &str, feature: &str, line: u32, at: &str) {
    let problem = only_problem(build_wgsl(source));
    let shown = problem.to_string();
    let column = column_of(source, line, at);
    assert_eq!(problem.feature.as_deref(), Some(feature), "{shown}");
    assert_eq!(problem.file.as_deref(), Some(SHADER), "{shown}");
    assert_eq!(
        (problem.line, problem.column),
        (Some(line), Some(column)),
        "{shown}"
    );
    assert!(
        shown.starts_with(&format!("{SHADER}:{line}:{column}: ")),
        "{shown}"
    );
    assert!(shown.contains(&format!("`{feature}`")), "{shown}");
    assert!(problem.message.ends_with(SEE_RULES), "{shown}");
    assert!(!shown.contains("AGENTS.md"), "{shown}");
}
