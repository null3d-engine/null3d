//! The shader manifest, `shaders.toml`: the entry shaders to build, their render pipelines, and
//! their variants with shader defs and output targets.

use std::collections::BTreeMap;

use serde::Deserialize;

/// A language that a variant builds for.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub enum Target {
    /// WGSL for WebGPU.
    Wgsl,
    /// GLSL ES 3.00 for WebGL2.
    Glsl,
}

impl Target {
    /// The target's name in the manifest.
    pub fn name(self) -> &'static str {
        match self {
            Self::Wgsl => "wgsl",
            Self::Glsl => "glsl",
        }
    }
}

/// The parsed manifest.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    /// Entry shaders by name.
    #[serde(default)]
    pub shaders: BTreeMap<String, Shader>,
}

/// One entry shader.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Shader {
    /// The WGSL file, relative to the shader folder.
    pub file: String,
    /// Render pipelines by name.
    #[serde(default)]
    pub pipelines: BTreeMap<String, Pipeline>,
    /// Builds of the shader by name.
    pub variants: BTreeMap<String, Variant>,
}

/// The entry points of one render pipeline.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Pipeline {
    /// The vertex entry point.
    pub vertex: String,
    /// The fragment entry point.
    pub fragment: String,
}

impl Pipeline {
    /// Each stage of the pipeline, with its name in messages and its entry point.
    pub(crate) fn stages(&self) -> [(naga::ShaderStage, &'static str, &str); 2] {
        [
            (naga::ShaderStage::Vertex, "vertex", &self.vertex),
            (naga::ShaderStage::Fragment, "fragment", &self.fragment),
        ]
    }
}

/// One build of an entry shader.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Variant {
    /// Shader defs that are true in this build.
    #[serde(default)]
    pub defs: Vec<String>,
    /// The languages to write.
    pub targets: Vec<Target>,
}

impl Variant {
    /// True when the variant writes this target.
    pub fn has(&self, target: Target) -> bool {
        self.targets.contains(&target)
    }
}

impl Manifest {
    /// Parses the manifest text and checks names, targets and file paths. Each error names the
    /// manifest key it is about.
    pub fn parse(text: &str) -> Result<Self, Vec<String>> {
        let mut manifest: Manifest = toml::from_str(text).map_err(|e| vec![e.to_string()])?;
        let errors = manifest.check();
        if !errors.is_empty() {
            return Err(errors);
        }
        for shader in manifest.shaders.values_mut() {
            for variant in shader.variants.values_mut() {
                variant.targets.sort();
                variant.defs.sort();
            }
        }
        Ok(manifest)
    }

    fn check(&self) -> Vec<String> {
        let mut errors = Vec::new();
        for (name, shader) in &self.shaders {
            let key = format!("shaders.{name}");
            check_name(&mut errors, &key, name);
            check_file(&mut errors, &key, &shader.file);
            for (pipeline_name, pipeline) in &shader.pipelines {
                let pipeline_key = format!("{key}.pipelines.{pipeline_name}");
                check_name(&mut errors, &pipeline_key, pipeline_name);
                check_name(
                    &mut errors,
                    &format!("{pipeline_key}.vertex"),
                    &pipeline.vertex,
                );
                check_name(
                    &mut errors,
                    &format!("{pipeline_key}.fragment"),
                    &pipeline.fragment,
                );
            }
            if shader.variants.is_empty() {
                errors.push(format!(
                    "{key} has no variants. Add one, for example `variants.plain = {{ targets = [\"wgsl\", \"glsl\"] }}`."
                ));
            }
            for (variant_name, variant) in &shader.variants {
                let variant_key = format!("{key}.variants.{variant_name}");
                check_name(&mut errors, &variant_key, variant_name);
                check_variant(&mut errors, &variant_key, variant);
                if variant.has(Target::Glsl) && shader.pipelines.is_empty() {
                    errors.push(format!(
                        "{variant_key} targets \"glsl\", but {key} names no pipelines. WebGL2 needs a vertex and a fragment shader for each program: add `pipelines.main = {{ vertex = \"vs_main\", fragment = \"fs_main\" }}` with your entry point names."
                    ));
                }
            }
        }
        errors
    }
}

fn check_variant(errors: &mut Vec<String>, key: &str, variant: &Variant) {
    if variant.targets.is_empty() {
        errors.push(format!(
            "{key}.targets is empty. List \"wgsl\", \"glsl\" or both."
        ));
    }
    for (index, target) in variant.targets.iter().enumerate() {
        if variant.targets[..index].contains(target) {
            errors.push(format!("{key}.targets lists \"{}\" twice.", target.name()));
        }
    }
    for (index, def) in variant.defs.iter().enumerate() {
        if !is_identifier(def) {
            errors.push(format!(
                "{key}.defs has \"{def}\". A shader def uses letters, digits and underscores, and does not start with a digit."
            ));
        }
        if variant.defs[..index].contains(def) {
            errors.push(format!("{key}.defs lists \"{def}\" twice."));
        }
    }
}

fn check_name(errors: &mut Vec<String>, key: &str, name: &str) {
    if !is_identifier(name) {
        errors.push(format!(
            "{key}: \"{name}\" is not a valid name. Use letters, digits and underscores, and do not start with a digit, because the name becomes a TypeScript property or a WGSL entry point."
        ));
    }
}

fn check_file(errors: &mut Vec<String>, key: &str, file: &str) {
    let inside =
        !file.starts_with('/') && !file.split('/').any(|part| part == ".." || part.is_empty());
    if !inside || !file.ends_with(".wgsl") {
        errors.push(format!(
            "{key}.file is \"{file}\". Name a .wgsl file inside the shader folder, such as \"mesh.wgsl\"."
        ));
    } else if file.starts_with("lib/") {
        errors.push(format!(
            "{key}.file is \"{file}\", a library module. Entry shaders live outside lib/, and they reach library modules with `#import`."
        ));
    }
}

/// True for ASCII names that are valid in WGSL, GLSL and as unquoted TypeScript property names.
pub fn is_identifier(name: &str) -> bool {
    let mut chars = name.chars();
    chars
        .next()
        .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

#[cfg(test)]
mod tests {
    use super::*;

    const VALID: &str = r#"
[shaders.mesh]
file = "mesh.wgsl"
pipelines.main = { vertex = "vs_main", fragment = "fs_main" }
variants.plain = { targets = ["glsl", "wgsl"] }
variants.instanced = { defs = ["INSTANCED"], targets = ["wgsl"] }
"#;

    #[test]
    fn a_valid_manifest_parses_with_sorted_targets() {
        let manifest = Manifest::parse(VALID).unwrap();
        let mesh = &manifest.shaders["mesh"];
        assert_eq!(mesh.file, "mesh.wgsl");
        assert_eq!(mesh.pipelines["main"].vertex, "vs_main");
        assert_eq!(mesh.variants["plain"].targets, [Target::Wgsl, Target::Glsl]);
        assert_eq!(mesh.variants["instanced"].defs, ["INSTANCED"]);
    }

    #[test]
    fn unknown_keys_are_rejected() {
        let errors = Manifest::parse(&VALID.replace("file =", "path =")).unwrap_err();
        assert!(errors[0].contains("unknown field `path`"), "{errors:?}");
    }

    #[test]
    fn glsl_targets_need_a_pipeline() {
        let text =
            "[shaders.mesh]\nfile = \"mesh.wgsl\"\nvariants.plain = { targets = [\"glsl\"] }\n";
        let errors = Manifest::parse(text).unwrap_err();
        assert!(errors[0].contains("names no pipelines"), "{errors:?}");
    }

    #[test]
    fn names_targets_defs_and_files_are_checked() {
        let text = r#"
[shaders.bad-name]
file = "../mesh.glsl"
variants.plain = { defs = ["A", "A", "1B"], targets = [] }
"#;
        let errors = Manifest::parse(text).unwrap_err();
        let all = errors.join("\n");
        assert!(
            all.contains("shaders.bad-name: \"bad-name\" is not a valid name"),
            "{all}"
        );
        assert!(
            all.contains("Name a .wgsl file inside the shader folder"),
            "{all}"
        );
        assert!(all.contains("targets is empty"), "{all}");
        assert!(all.contains("lists \"A\" twice"), "{all}");
        assert!(all.contains("has \"1B\""), "{all}");
    }

    #[test]
    fn a_target_listed_twice_is_named_as_the_manifest_spells_it() {
        let text = VALID.replace(
            "targets = [\"glsl\", \"wgsl\"]",
            "targets = [\"glsl\", \"glsl\"]",
        );
        let errors = Manifest::parse(&text).unwrap_err();
        assert!(
            errors[0].contains("targets lists \"glsl\" twice"),
            "{errors:?}"
        );
    }

    #[test]
    fn library_modules_are_not_entry_shaders() {
        let text = VALID.replace("\"mesh.wgsl\"", "\"lib/math.wgsl\"");
        let errors = Manifest::parse(&text).unwrap_err();
        assert!(errors[0].contains("a library module"), "{errors:?}");
    }
}
