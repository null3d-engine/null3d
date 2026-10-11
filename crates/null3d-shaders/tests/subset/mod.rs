//! The repository's shaders, narrowed to a few of them.
//!
//! A build of every variant takes minutes, and cargo-nextest runs each test in a process of its
//! own, so tests cannot share one. A test that checks how the build or the command behaves builds
//! only the shaders it reads. The checks that read every build share one test in `build.rs`.

use std::path::Path;

use null3d_shaders::Inputs;
use toml::{Table, Value};

/// The repository's shader inputs with only the named shaders in the manifest. The files are the
/// library modules and the named shaders' own files. Each first-use feature keeps its bits and
/// the named shaders among its shaders, and a feature left with neither goes.
pub fn repository_subset(names: &[&str]) -> Inputs {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let mut inputs = Inputs::read(&root).expect("the repository's shaders");
    let mut manifest: Table = toml::from_str(&inputs.manifest).expect("the shader manifest");

    let shaders = table(manifest.get_mut("shaders"));
    shaders.retain(|name, _| names.contains(&name));
    assert_eq!(
        shaders.len(),
        names.len(),
        "a named shader is not in the manifest"
    );
    let files: Vec<String> = shaders
        .values()
        .map(|shader| shader["file"].as_str().expect("a file name").to_owned())
        .collect();

    if let Some(features) = manifest.get_mut("first_use") {
        table(Some(features)).retain(|_, feature| {
            let feature = table(Some(feature));
            if let Some(Value::Array(list)) = feature.get_mut("shaders") {
                list.retain(|shader| names.contains(&shader.as_str().expect("a shader name")));
                if list.is_empty() {
                    feature.remove("shaders");
                }
            }
            feature.contains_key("shaders") || feature.contains_key("bits")
        });
    }

    inputs
        .files
        .retain(|file, _| file.starts_with("lib/") || files.contains(file));
    inputs.manifest = toml::to_string(&manifest).expect("the narrowed manifest");
    inputs
}

fn table(value: Option<&mut Value>) -> &mut Table {
    value
        .and_then(Value::as_table_mut)
        .expect("a table in the shader manifest")
}
