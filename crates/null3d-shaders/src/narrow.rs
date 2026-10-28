//! A build's inputs narrowed to a few of the manifest's shaders.
//!
//! A build of every shader takes minutes, and a test or a CI shard that reads only some of them
//! should not pay for the rest. The narrowing keeps the named shaders, their files, and the
//! first-use features that they reach, so the narrowed inputs build as the whole ones would.

use toml::{Table, Value};

use crate::Inputs;

/// `inputs` with only the named shaders in the manifest. The files are the library modules and the
/// named shaders' own files, and a named shader keeps its part. Each first-use feature keeps the
/// named shaders among its shaders and the bits that a named shader which loads by device
/// permutes, and a feature left with neither goes.
pub fn narrowed(inputs: &Inputs, names: &[&str]) -> Inputs {
    let mut inputs = Inputs {
        manifest: inputs.manifest.clone(),
        files: inputs.files.clone(),
        only: inputs.only.clone(),
        parts: inputs
            .parts
            .iter()
            .filter(|(name, _)| names.contains(&name.as_str()))
            .map(|(name, part)| (name.clone(), *part))
            .collect(),
    };
    let mut manifest: Table = toml::from_str(&inputs.manifest).expect("the shader manifest");

    let shaders = table(manifest.get_mut("shaders"));
    shaders.retain(|name, _| {
        let name: &str = name;
        names.contains(&name)
    });
    assert_eq!(
        shaders.len(),
        names.len(),
        "a named shader is not in the manifest"
    );
    let files: Vec<String> = shaders
        .values()
        .map(|shader| shader["file"].as_str().expect("a file name").to_owned())
        .collect();
    let device_bits: Vec<String> = shaders
        .values()
        .filter(|shader| shader.get("by_device").and_then(Value::as_bool) == Some(true))
        .filter_map(|shader| shader.get("variants").and_then(Value::as_table))
        .flat_map(|variants| variants.values())
        .filter_map(|variant| variant.get("permutations").and_then(Value::as_array))
        .flatten()
        .map(|bit| bit.as_str().expect("a permutation bit").to_owned())
        .collect();

    if let Some(features) = manifest.get_mut("first_use") {
        table(Some(features)).retain(|_, feature| {
            let feature = table(Some(feature));
            keep(feature, "shaders", |shader| names.contains(&shader));
            keep(feature, "bits", |bit| {
                device_bits.iter().any(|kept| kept == bit)
            });
            feature.contains_key("shaders") || feature.contains_key("bits")
        });
    }

    inputs
        .files
        .retain(|file, _| file.starts_with("lib/") || files.contains(file));
    inputs.manifest = toml::to_string(&manifest).expect("the narrowed manifest");
    inputs
}

/// Narrows a list of names in a first-use feature to those that pass, and removes a list left empty.
fn keep(feature: &mut Table, key: &str, pass: impl Fn(&str) -> bool) {
    if let Some(Value::Array(list)) = feature.get_mut(key) {
        list.retain(|name| pass(name.as_str().expect("a name in a first-use feature")));
        if list.is_empty() {
            feature.remove(key);
        }
    }
}

fn table(value: Option<&mut Value>) -> &mut Table {
    value
        .and_then(Value::as_table_mut)
        .expect("a table in the shader manifest")
}
