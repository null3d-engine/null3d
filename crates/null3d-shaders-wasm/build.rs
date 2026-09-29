//! Lists the engine's shader library modules, the `.wgsl` files in the shader crate's `lib`
//! folder, for the crate to include. A new module needs no change here.

use std::fmt::Write;
use std::path::Path;
use std::{env, fs};

fn main() {
    let folder = Path::new(env!("CARGO_MANIFEST_DIR")).join("../null3d-shaders/wgsl/lib");
    println!("cargo::rerun-if-changed={}", folder.display());
    let mut files: Vec<_> = fs::read_dir(&folder)
        .expect("the shader library folder")
        .map(|entry| entry.expect("an entry of the shader library folder").path())
        .filter(|path| {
            path.extension()
                .is_some_and(|extension| extension == "wgsl")
        })
        .collect();
    files.sort();
    let mut code = String::from("&[\n");
    for path in files {
        let name = path.file_name().expect("a file name").to_string_lossy();
        let path = path.canonicalize().expect("a library module's path");
        writeln!(code, "    (\"lib/{name}\", include_str!({path:?})),").expect("a string");
    }
    code.push(']');
    let out = env::var("OUT_DIR").expect("Cargo's output folder");
    fs::write(Path::new(&out).join("library.rs"), code).expect("the library list");
}
