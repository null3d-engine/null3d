//! The `shader-build` command, run against copies of the repository's shader inputs.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::atomic::{AtomicUsize, Ordering};

use null3d_shaders::{MANIFEST_PATH, OUTPUT_DIR, OUTPUT_PATH, SHADER_DIR};

fn repository() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// A scratch folder that holds a copy of the shader inputs and is removed when dropped.
struct Scratch(PathBuf);

impl Scratch {
    fn new() -> Self {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let root = std::env::temp_dir().join(format!(
            "null3d-shader-build-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&root);
        copy_dir(&repository().join(SHADER_DIR), &root.join(SHADER_DIR));
        fs::copy(repository().join(MANIFEST_PATH), root.join(MANIFEST_PATH)).unwrap();
        Self(root)
    }

    fn run(&self) -> Output {
        Command::new(env!("CARGO_BIN_EXE_shader-build"))
            .arg("--root")
            .arg(&self.0)
            .output()
            .expect("the shader-build command runs")
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn copy_dir(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for entry in fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let target = to.join(entry.file_name());
        if entry.path().is_dir() {
            copy_dir(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), target).unwrap();
        }
    }
}

fn text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
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
    assert!(wgsl.contains("\tlit: {\n\t\twebgpu: {") && !wgsl.contains("#version"));
    let glsl = fs::read_to_string(folder.join("shaders-glsl-draw-index.js")).unwrap();
    assert!(glsl.contains("\tlit: {\n\t\twebgl2_draw_index: {"));
    assert!(glsl.contains("\tcull: {},") && !glsl.contains("\tlit: {\n\t\twebgl2: {"));
    // A shader without permutation bits is in every module of its target.
    assert!(glsl.contains("\tmipmap: {\n\t\twebgl2: {"));
    let main = fs::read_to_string(scratch.0.join(OUTPUT_PATH)).unwrap();
    assert!(main.contains(
        "\t1: () => importShaders(new URL('./shaders-glsl-draw-index.js?no-inline', import.meta.url)),"
    ));
    assert!(!main.contains("LIT_SHADER") && main.contains("TEST_MESH_SHADER"));
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
