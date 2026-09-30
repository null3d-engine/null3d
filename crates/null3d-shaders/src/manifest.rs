//! The shader manifest, `shaders.toml`: the entry shaders to build, their render pipelines, and
//! their variants with shader defs, permutation bits and output targets.

use std::collections::BTreeMap;

use null3d_gpu::drawlist::permutation;
use serde::{Deserialize, Serialize};

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
    /// True for a shader that loads by device: its builds go into the device modules, one for each
    /// target and each value of the permutation bits that a device fixes, and not into the main
    /// module. Each of its variants has one target.
    #[serde(default)]
    pub by_device: bool,
}

/// The entry points of one render pipeline.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
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

/// One variant of an entry shader: a build for each combination of its permutation bits.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Variant {
    /// Shader defs that are true in every build of the variant.
    #[serde(default)]
    pub defs: Vec<String>,
    /// Permutation bits by name, as the draw list's `permutation` module names them. The variant
    /// builds once for each combination of them, with the names of the bits it has as more defs.
    #[serde(default)]
    pub permutations: Vec<String>,
    /// The languages to write.
    pub targets: Vec<Target>,
}

impl Variant {
    /// True when the variant writes this target.
    pub fn has(&self, target: Target) -> bool {
        self.targets.contains(&target)
    }

    /// Every build of the variant `name`, one for each combination of its permutation bits, in
    /// the order of their permutation words. The build without any bit takes the variant's name,
    /// and each other build adds the names of its bits in lowercase, in bit order: variant
    /// `webgl2` with `DRAW_INDEX` builds `webgl2` and `webgl2_draw_index`. The variant's names
    /// must be checked first.
    pub(crate) fn builds(&self, name: &str) -> Vec<Build> {
        let mut bits: Vec<(&str, u32)> = self
            .permutations
            .iter()
            .filter_map(|bit| permutation::bit(bit).map(|value| (bit.as_str(), value)))
            .collect();
        bits.sort_by_key(|&(_, value)| value);
        let mut builds: Vec<Build> = (0..1usize << bits.len())
            .map(|combination| {
                let mut build = Build {
                    name: name.to_owned(),
                    defs: self.defs.clone(),
                    permutation: 0,
                };
                for (k, &(bit, value)) in bits.iter().enumerate() {
                    if combination & (1 << k) != 0 {
                        build.name.push('_');
                        build.name.push_str(&bit.to_ascii_lowercase());
                        build.defs.push(bit.to_owned());
                        build.permutation |= value;
                    }
                }
                build.defs.sort();
                build
            })
            .collect();
        builds.sort_by_key(|build| build.permutation);
        builds
    }
}

/// One build of a variant: its name, its shader defs and its permutation word.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Build {
    pub name: String,
    pub defs: Vec<String>,
    pub permutation: u32,
}

impl Manifest {
    /// Parses the manifest text and checks names, targets and file paths. Each error names the
    /// manifest key it is about.
    pub fn parse(text: &str) -> Result<Self, Vec<String>> {
        let mut manifest: Manifest = toml::from_str(text).map_err(|e| vec![e.to_string()])?;
        let mut errors = Vec::new();
        for (name, shader) in &manifest.shaders {
            let key = format!("shaders.{name}");
            check_name(&mut errors, &key, name);
            check_file(&mut errors, &key, &shader.file);
            errors.extend(check_builds(&key, &shader.pipelines, &shader.variants));
            if shader.by_device {
                check_by_device(&mut errors, &key, &shader.variants);
            }
        }
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
}

/// Checks the names, targets and shader defs of a shader's pipelines and variants. `key` names
/// the shader in the messages; an empty key is a shader on its own, outside a manifest.
pub(crate) fn check_builds(
    key: &str,
    pipelines: &BTreeMap<String, Pipeline>,
    variants: &BTreeMap<String, Variant>,
) -> Vec<String> {
    let child = |name: String| {
        if key.is_empty() {
            name
        } else {
            format!("{key}.{name}")
        }
    };
    let shader = if key.is_empty() { "the shader" } else { key };
    let mut errors = Vec::new();
    for (pipeline_name, pipeline) in pipelines {
        let pipeline_key = child(format!("pipelines.{pipeline_name}"));
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
    if variants.is_empty() {
        errors.push(format!(
            "{shader} has no variants. Add one, for example `variants.plain = {{ targets = [\"wgsl\", \"glsl\"] }}`."
        ));
    }
    let mut builds: BTreeMap<String, &str> = BTreeMap::new();
    for (variant_name, variant) in variants {
        let variant_key = child(format!("variants.{variant_name}"));
        check_name(&mut errors, &variant_key, variant_name);
        let known_bits = check_variant(&mut errors, &variant_key, variant);
        if variant.has(Target::Glsl) && pipelines.is_empty() {
            errors.push(format!(
                "{variant_key} targets \"glsl\", but {shader} names no pipelines. WebGL2 needs a vertex and a fragment shader for each program: add `pipelines.main = {{ vertex = \"vs_main\", fragment = \"fs_main\" }}` with your entry point names."
            ));
        }
        if !known_bits {
            continue;
        }
        for build in variant.builds(variant_name) {
            if let Some(other) = builds.insert(build.name.clone(), variant_name) {
                errors.push(format!(
                    "{variant_key} and variant `{other}` both build `{}`, since each permutation bit adds its name to a variant's name. Rename one of the variants.",
                    build.name
                ));
            }
        }
    }
    errors
}

/// Checks a variant's targets, defs and permutation bits. Returns false when a permutation bit is
/// not one of the draw list's, so its builds cannot be named.
fn check_variant(errors: &mut Vec<String>, key: &str, variant: &Variant) -> bool {
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
    let mut known = true;
    for (index, bit) in variant.permutations.iter().enumerate() {
        if permutation::bit(bit).is_none() {
            let names: Vec<&str> = permutation::NAMES.iter().map(|&(name, _)| name).collect();
            errors.push(format!(
                "{key}.permutations has \"{bit}\", which is not a permutation bit. The bits are {}.",
                names.join(", ")
            ));
            known = false;
        }
        if variant.permutations[..index].contains(bit) {
            errors.push(format!("{key}.permutations lists \"{bit}\" twice."));
        }
        if variant.defs.contains(bit) {
            errors.push(format!(
                "{key} lists \"{bit}\" in both defs and permutations. Keep it in permutations, which builds the variant with it and without it."
            ));
        }
    }
    known
}

/// Checks that each variant of a shader that loads by device has one target, since a device
/// module holds the builds of one target.
fn check_by_device(errors: &mut Vec<String>, key: &str, variants: &BTreeMap<String, Variant>) {
    for (name, variant) in variants {
        if variant.targets.len() > 1 {
            errors.push(format!(
                "{key}.variants.{name} targets both \"wgsl\" and \"glsl\", but {key} loads by device, and a device module holds one target's builds. Give the variant one target, and add a variant for the other."
            ));
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
    fn a_variant_builds_once_for_each_combination_of_its_permutation_bits() {
        let text = r#"
[shaders.lit]
file = "lit.wgsl"
pipelines.main = { vertex = "vs", fragment = "fs" }
variants.webgl2 = { defs = ["WEBGL2"], permutations = ["TONE_MAP", "DRAW_INDEX"], targets = ["glsl"] }
variants.webgpu = { targets = ["wgsl"] }
"#;
        let manifest = Manifest::parse(text).unwrap();
        let lit = &manifest.shaders["lit"];
        let builds = lit.variants["webgl2"].builds("webgl2");
        let summary: Vec<(&str, Vec<&str>, u32)> = builds
            .iter()
            .map(|b| {
                let defs = b.defs.iter().map(String::as_str).collect();
                (b.name.as_str(), defs, b.permutation)
            })
            .collect();
        assert_eq!(
            summary,
            [
                ("webgl2", vec!["WEBGL2"], 0),
                ("webgl2_draw_index", vec!["DRAW_INDEX", "WEBGL2"], 1),
                ("webgl2_tone_map", vec!["TONE_MAP", "WEBGL2"], 2),
                (
                    "webgl2_draw_index_tone_map",
                    vec!["DRAW_INDEX", "TONE_MAP", "WEBGL2"],
                    3
                ),
            ]
        );
        let plain = lit.variants["webgpu"].builds("webgpu");
        assert_eq!(plain.len(), 1);
        assert_eq!(
            (plain[0].name.as_str(), plain[0].permutation),
            ("webgpu", 0)
        );
    }

    #[test]
    fn permutation_bits_are_checked() {
        let text = r#"
[shaders.mesh]
file = "mesh.wgsl"
pipelines.main = { vertex = "vs", fragment = "fs" }
variants.a = { defs = ["TONE_MAP"], permutations = ["SHINY", "TONE_MAP", "TONE_MAP"], targets = ["wgsl"] }
"#;
        let all = Manifest::parse(text).unwrap_err().join("\n");
        assert!(
            all.contains("\"SHINY\", which is not a permutation bit"),
            "{all}"
        );
        assert!(all.contains("The bits are DRAW_INDEX, TONE_MAP,"), "{all}");
        assert!(
            all.contains("permutations lists \"TONE_MAP\" twice"),
            "{all}"
        );
        assert!(all.contains("in both defs and permutations"), "{all}");
    }

    #[test]
    fn a_build_name_that_another_variant_takes_is_rejected() {
        let text = r#"
[shaders.mesh]
file = "mesh.wgsl"
pipelines.main = { vertex = "vs", fragment = "fs" }
variants.a = { permutations = ["TONE_MAP"], targets = ["wgsl"] }
variants.a_tone_map = { targets = ["wgsl"] }
"#;
        let errors = Manifest::parse(text).unwrap_err();
        assert!(
            errors[0].contains("variants.a_tone_map and variant `a` both build `a_tone_map`"),
            "{errors:?}"
        );
    }

    #[test]
    fn each_variant_of_a_shader_that_loads_by_device_has_one_target() {
        let text = format!("{VALID}by_device = true\n");
        let errors = Manifest::parse(&text).unwrap_err();
        assert_eq!(errors.len(), 1, "{errors:?}");
        assert!(
            errors[0].contains("shaders.mesh.variants.plain targets both"),
            "{errors:?}"
        );
        let one_target = text.replace("[\"glsl\", \"wgsl\"]", "[\"glsl\"]");
        assert!(Manifest::parse(&one_target).unwrap().shaders["mesh"].by_device);
    }

    #[test]
    fn library_modules_are_not_entry_shaders() {
        let text = VALID.replace("\"mesh.wgsl\"", "\"lib/math.wgsl\"");
        let errors = Manifest::parse(&text).unwrap_err();
        assert!(errors[0].contains("a library module"), "{errors:?}");
    }
}
