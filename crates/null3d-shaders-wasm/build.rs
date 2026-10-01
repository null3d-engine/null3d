//! Lists the engine's shader files for the crate to include: the entry shaders in the shader
//! crate's `wgsl` folder, among them the template of custom materials, and the library modules in
//! its `lib` folder. A new file needs no change here.

use std::fmt::Write;
use std::path::{Path, PathBuf};
use std::{env, fs};

/// The `.wgsl` files directly in `folder`, sorted.
fn wgsl_files(folder: &Path) -> Vec<PathBuf> {
    println!("cargo::rerun-if-changed={}", folder.display());
    let mut files: Vec<_> = fs::read_dir(folder)
        .expect("a shader folder")
        .map(|entry| entry.expect("an entry of a shader folder").path())
        .filter(|path| {
            path.extension()
                .is_some_and(|extension| extension == "wgsl")
        })
        .collect();
    files.sort();
    files
}

fn main() {
    let shaders = Path::new(env!("CARGO_MANIFEST_DIR")).join("../null3d-shaders/wgsl");
    let mut code = String::from("&[\n");
    for (prefix, folder) in [("", shaders.clone()), ("lib/", shaders.join("lib"))] {
        for path in wgsl_files(&folder) {
            let name = path.file_name().expect("a file name").to_string_lossy();
            let path = path.canonicalize().expect("a shader file's path");
            writeln!(code, "    (\"{prefix}{name}\", include_str!({path:?})),").expect("a string");
        }
    }
    code.push(']');
    let out = env::var("OUT_DIR").expect("Cargo's output folder");
    fs::write(Path::new(&out).join("shaders.rs"), code).expect("the list of shader files");
}
