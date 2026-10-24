//! Helpers for building small shader projects in memory.
//!
//! When `NULL3D_SHADER_COMPILER` is set, as `bun run test:shader-compiler` sets it, every build
//! also runs through the shader compiler, the WebAssembly module that build tools load, and its
//! result must be the native build's. The module must be built first, with `bun run build`.

use std::collections::BTreeMap;
use std::io::{BufRead, BufReader};
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
    Inputs {
        manifest,
        files,
        parts: BTreeMap::new(),
    }
}

/// Builds the inputs natively, and through the shader compiler when `NULL3D_SHADER_COMPILER` is
/// set. The two results must be the same.
pub fn build(inputs: &Inputs) -> Result<Output, BuildError> {
    let native = null3d_shaders::build(inputs);
    if std::env::var_os("NULL3D_SHADER_COMPILER").is_some() {
        let expected = serde_json::to_value(Response::from(&native)).expect("the native result");
        assert_same("the build", &build_in_shader_compiler(inputs), &expected);
    }
    native
}

/// Runs a build through the shader compiler, in Bun. A test that compares one shader of the
/// repository with the native build of the whole repository runs this itself, through the `subset`
/// module, so that the shader is built once.
pub fn build_in_shader_compiler(inputs: &Inputs) -> Value {
    let mut result = None;
    build_each_in_shader_compiler(std::slice::from_ref(inputs), |_, value| {
        result = Some(value)
    });
    result.expect("the shader compiler's result")
}

/// The memory that one shader compiler process may take: its WebAssembly module holds at most
/// 4 GiB, of which its compiler and the result it is writing fill most for the costliest entries.
/// The processes run beside the test, which holds the native build, so each counts as half the
/// module's room. Most entries take far less.
const MEMORY_PER_COMPILER: u64 = 2 << 30;

/// How many shader compiler processes run at once: one for each core, and no more than the
/// memory available now holds at [`MEMORY_PER_COMPILER`] each. Linux reports that memory in
/// `/proc/meminfo`. Elsewhere the count is the core count alone.
pub fn compiler_processes() -> usize {
    let cores = std::thread::available_parallelism().map_or(1, std::num::NonZeroUsize::get);
    let memory = available_memory().map_or(usize::MAX, |bytes| {
        usize::try_from(bytes / MEMORY_PER_COMPILER).unwrap_or(usize::MAX)
    });
    cores.min(memory).max(1)
}

/// The memory available to new processes, in bytes, from `/proc/meminfo`, or `None` where the
/// system has no such file.
fn available_memory() -> Option<u64> {
    let info = std::fs::read_to_string("/proc/meminfo").ok()?;
    let line = info
        .lines()
        .find(|line| line.starts_with("MemAvailable:"))?;
    let kib: u64 = line.split_whitespace().nth(1)?.parse().ok()?;
    Some(kib * 1024)
}

/// The estimated work of a build: the builds that its entries make, as the shader library counts
/// them for splitting CI's shards. A manifest that does not parse counts nothing, which is
/// enough for ranking.
fn build_cost(inputs: &Inputs) -> u64 {
    null3d_shaders::entry_costs(inputs).map_or(0, |costs| costs.iter().map(|(_, cost)| cost).sum())
}

/// Runs a list of builds through the shader compiler and gives each result and the index of its
/// input to `check`. The builds are split over several processes ([`compiler_processes`]), and
/// each process composes the shader library once and reuses it for the builds that follow. Each
/// process writes its results as lines, which are read one at a time, so a result that would not
/// fit in memory beside every other one still works.
pub fn build_each_in_shader_compiler(inputs: &[Inputs], mut check: impl FnMut(usize, Value)) {
    if inputs.is_empty() {
        return;
    }
    let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tools/shader-compiler.ts");
    let jobs = compiler_processes().min(inputs.len());
    // The largest entries go to different processes, each with small entries beside it, so no
    // process spends the whole run on one entry while the others hold small ones.
    let costs: Vec<u64> = inputs.iter().map(build_cost).collect();
    let mut order: Vec<usize> = (0..inputs.len()).collect();
    order.sort_by_key(|&index| std::cmp::Reverse(costs[index]));
    let mut loads = vec![0u64; jobs];
    let mut groups: Vec<Vec<usize>> = vec![Vec::new(); jobs];
    for index in order {
        let job = loads
            .iter()
            .enumerate()
            .min_by_key(|&(_, &load)| load)
            .map_or(0, |(job, _)| job);
        loads[job] += costs[index];
        groups[job].push(index);
    }
    for group in &mut groups {
        group.sort_unstable();
    }
    let mut children = Vec::with_capacity(jobs);
    for group in &groups {
        let mut child = Command::new("bun")
            .arg(&script)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("Bun runs the shader compiler");
        let request: Vec<&Inputs> = group.iter().map(|&index| &inputs[index]).collect();
        {
            let stdin = child.stdin.take().expect("the shader compiler's input");
            serde_json::to_writer(stdin, &request)
                .expect("the request reaches the shader compiler");
        }
        children.push((group, child));
    }
    for (group, mut child) in children {
        let stdout = child.stdout.take().expect("the shader compiler's output");
        let mut answers = BufReader::new(stdout);
        // A result arrives as one line that may run to a gigabyte, so it is read as bytes, which
        // need no second copy as text.
        let mut line = Vec::new();
        let mut answered = 0;
        for &index in group {
            line.clear();
            if answers
                .read_until(b'\n', &mut line)
                .expect("the shader compiler's answer")
                == 0
            {
                break;
            }
            let result = serde_json::from_slice(&line).expect("the shader compiler's JSON result");
            check(index, result);
            answered += 1;
        }
        let status = child.wait().expect("the shader compiler finishes");
        let stderr = child.stderr.take().expect("the shader compiler's errors");
        let stderr = std::io::read_to_string(stderr).expect("the shader compiler's errors");
        assert!(status.success(), "the shader compiler failed:\n{stderr}");
        assert_eq!(
            answered,
            group.len(),
            "the shader compiler answered {answered} of {} builds in its group:\n{stderr}",
            group.len()
        );
    }
}

/// Fails at the first line where two results, printed as JSON, differ ([`same`]).
pub fn assert_same(what: &str, compiled: &Value, native: &Value) {
    if let Err(difference) = same(what, compiled, native) {
        panic!("{difference}");
    }
}

/// Names the first line where two results, printed as JSON, differ. `what` names the build that
/// was compared. The results are printed only when they differ: a repository entry's result is
/// hundreds of megabytes, and printing both would cost the test more memory than it needs to
/// compare them.
pub fn same(what: &str, compiled: &Value, native: &Value) -> Result<(), String> {
    if compiled == native {
        return Ok(());
    }
    // A result that failed where the native build succeeded is reported by why it failed. Comparing
    // the two as text would name only the `ok` flag, and a stop for want of memory, which no shader
    // causes, would read as an unexplained difference.
    if compiled["ok"] == Value::Bool(false) {
        return Err(format!(
            "{what}: the shader compiler answered with a failure where the native build did not:\n{}",
            problems_of(compiled)
        ));
    }
    let pretty = |value| serde_json::to_string_pretty(value).expect("JSON text");
    let (compiled, native) = (pretty(compiled), pretty(native));
    let line = compiled
        .lines()
        .zip(native.lines())
        .position(|(a, b)| a != b)
        .unwrap_or_else(|| compiled.lines().count().min(native.lines().count()));
    Err(format!(
        "{what}: the shader compiler's result differs from the native build's, first at line {}:\n  shader compiler: {}\n  native build:    {}",
        line + 1,
        compiled.lines().nth(line).unwrap_or("(the end)"),
        native.lines().nth(line).unwrap_or("(the end)"),
    ))
}

/// Every problem of a failed result, one to a line, with its place when it names one.
fn problems_of(result: &Value) -> String {
    let problems = result["problems"].as_array().cloned().unwrap_or_default();
    if problems.is_empty() {
        return "  (the response names no problem)".to_owned();
    }
    problems
        .iter()
        .map(|problem| {
            let message = problem["message"].as_str().unwrap_or("(no message)");
            let variants = problem["variants"]
                .as_array()
                .map(|names| {
                    names
                        .iter()
                        .filter_map(Value::as_str)
                        .collect::<Vec<_>>()
                        .join(", ")
                })
                .unwrap_or_default();
            match problem["file"].as_str() {
                Some(file) => format!("  {file}: {message} ({variants})"),
                None => format!("  {message} ({variants})"),
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
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
        .to_string()
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
