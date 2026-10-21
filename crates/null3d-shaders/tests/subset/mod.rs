//! The repository's shaders, narrowed to a few of them.
//!
//! A build of every variant takes minutes, and cargo-nextest runs each test in a process of its
//! own, so tests cannot share one. A test that checks how the build or the command behaves builds
//! only the shaders it reads. The checks that read every build share one test in `build.rs`.

use std::path::Path;

use null3d_shaders::Inputs;

/// The repository's shader inputs with only the named shaders in the manifest. The files are the
/// library modules and the named shaders' own files. Each first-use feature keeps the named
/// shaders among its shaders and the bits that a named shader which loads by device permutes, and
/// a feature left with neither goes.
pub fn repository_subset(names: &[&str]) -> Inputs {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let inputs = Inputs::read(&root).expect("the repository's shaders");
    null3d_shaders::narrowed(&inputs, names)
}
