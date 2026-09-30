//! The `shader-build` command, run against a copy of the repository's shader inputs, and the
//! committed modules checked against a fresh build.

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

    fn run(&self, check: bool) -> Output {
        let mut command = Command::new(env!("CARGO_BIN_EXE_shader-build"));
        command.arg("--root").arg(&self.0);
        if check {
            command.arg("--check");
        }
        command.output().expect("the shader-build command runs")
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

#[test]
fn check_fails_after_the_generated_file_is_edited_and_passes_after_regeneration() {
    let scratch = Scratch::new();
    let output = scratch.0.join(OUTPUT_PATH);

    let missing = scratch.run(true);
    assert_eq!(missing.status.code(), Some(1), "{}", text(&missing.stderr));
    assert!(text(&missing.stderr).contains("Run `bun run shaders` to create it."));

    let written = scratch.run(false);
    assert!(written.status.success(), "{}", text(&written.stderr));
    assert!(
        text(&written.stdout)
            .contains("Wrote the shader modules in packages/engine/src/generated.")
    );
    let fresh = fs::read_to_string(&output).unwrap();
    assert!(scratch.run(true).status.success());

    let edited = fresh.replacen("#version 300 es", "#version 310 es", 1);
    assert_ne!(edited, fresh);
    fs::write(&output, &edited).unwrap();
    let stale = scratch.run(true);
    assert_eq!(stale.status.code(), Some(1));
    let message = text(&stale.stderr);
    assert!(message.contains(OUTPUT_PATH), "{message}");
    assert!(message.contains("differs from a fresh build"), "{message}");
    assert!(message.contains("Run `bun run shaders`"), "{message}");

    let rewritten = scratch.run(false);
    assert!(rewritten.status.success());
    assert_eq!(fs::read_to_string(&output).unwrap(), fresh);
    assert!(scratch.run(true).status.success());
    let unchanged = scratch.run(false);
    assert!(text(&unchanged.stdout).contains("already up to date"));
}

#[test]
fn the_build_writes_a_module_for_each_target_and_value_of_the_bits_a_device_fixes() {
    let scratch = Scratch::new();
    assert!(scratch.run(false).status.success());
    let folder = scratch.0.join(OUTPUT_DIR);
    for module in [
        "shaders-wgsl.ts",
        "shaders-glsl.ts",
        "shaders-glsl-draw-index.ts",
    ] {
        let text = fs::read_to_string(folder.join(module)).unwrap();
        assert!(
            text.contains("export const SHADERS: DeviceShaders = {"),
            "{module}"
        );
    }
    let wgsl = fs::read_to_string(folder.join("shaders-wgsl.ts")).unwrap();
    assert!(wgsl.contains("\tlit: {\n\t\twebgpu: {") && !wgsl.contains("#version"));
    let glsl = fs::read_to_string(folder.join("shaders-glsl-draw-index.ts")).unwrap();
    assert!(glsl.contains("\tlit: {\n\t\twebgl2_draw_index: {"));
    assert!(glsl.contains("\tcull: {},") && !glsl.contains("\tlit: {\n\t\twebgl2: {"));
    // A shader without permutation bits is in every module of its target.
    assert!(glsl.contains("\tmipmap: {\n\t\twebgl2: {"));
    let main = fs::read_to_string(scratch.0.join(OUTPUT_PATH)).unwrap();
    assert!(main.contains("\t1: () => import('./shaders-glsl-draw-index'),"));
    assert!(!main.contains("LIT_SHADER") && main.contains("TEST_MESH_SHADER"));
}

#[test]
fn a_device_module_that_the_build_no_longer_makes_fails_the_check_and_is_deleted() {
    let scratch = Scratch::new();
    assert!(scratch.run(false).status.success());
    let stale = scratch.0.join(OUTPUT_DIR).join("shaders-glsl-skin.ts");
    fs::write(&stale, "export {};\n").unwrap();
    let check = scratch.run(true);
    assert_eq!(check.status.code(), Some(1));
    let message = text(&check.stderr);
    assert!(
        message
            .contains("shaders-glsl-skin.ts: the shader build no longer makes this device module"),
        "{message}"
    );
    assert!(scratch.run(false).status.success());
    assert!(!stale.exists());
    assert!(scratch.run(true).status.success());
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
    let result = scratch.run(false);
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

#[test]
fn the_committed_modules_match_a_fresh_build() {
    if let Err(error) = null3d_shaders::check(&repository()) {
        panic!("{error}");
    }
}
