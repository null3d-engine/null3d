//! The shader manifest, `shaders.toml`: the entry shaders to build, their render pipelines, and
//! their variants with shader defs, permutation bits and output targets, and the features whose
//! builds load on first use.

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
    /// Features whose builds load on first use, by feature name.
    #[serde(default)]
    pub first_use: BTreeMap<String, FirstUse>,
}

/// A feature whose shader builds go into files of their own, which a page loads the first time a
/// pipeline asks for one of the builds. A build belongs to the feature of its shader, or else to
/// the feature of its lowest permutation bit that a feature names.
#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FirstUse {
    /// Shaders that load by device, every build of which belongs to the feature.
    #[serde(default)]
    pub shaders: Vec<String>,
    /// Permutation bits by name: a build of a shader that loads by device with one of them belongs
    /// to the feature.
    #[serde(default)]
    pub bits: Vec<String>,
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
    /// True for a shader that the engine loads on a feature's first use: its builds go into a
    /// module of their own for each target, not into the main module or the device modules, so no
    /// page downloads them before it asks for the feature. Each of its variants has one target.
    #[serde(default)]
    pub first_use: bool,
    /// True for the template that custom materials build with their own WGSL added.
    #[serde(default)]
    pub custom_materials: bool,
    /// True for the template that custom effects build with their own WGSL added. It is a template
    /// only: the build checks it and writes no module of it.
    #[serde(default)]
    pub custom_effects: bool,
    /// True for the shader that custom tone curves build with their own WGSL added: the final
    /// pass.
    #[serde(default)]
    pub custom_tone_curves: bool,
    /// True for the shader that hosts joined custom effects, which effects' pieces build with.
    #[serde(default)]
    pub effect_group_host: bool,
    /// True for the shader that hosts custom effects and a custom tone curve folded into the final
    /// pass, which their pieces build with.
    #[serde(default)]
    pub effect_fold_host: bool,
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
            if shader.by_device && shader.first_use {
                errors.push(format!(
                    "{key} sets both by_device and first_use. A shader loads with the device's shaders or on its first use: keep one."
                ));
            } else if shader.by_device {
                check_one_target(
                    &mut errors,
                    &key,
                    &shader.variants,
                    "loads by device, and a device module holds one target's builds",
                );
            } else if shader.first_use {
                check_one_target(
                    &mut errors,
                    &key,
                    &shader.variants,
                    "loads on first use, and each of its modules holds one target's builds",
                );
            }
        }
        check_first_use(&mut errors, &manifest);
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
    if variant.permutations.iter().any(|bit| bit == "HALF") && variant.targets.len() > 1 {
        errors.push(format!(
            "{key} has the HALF permutation bit and more than one target. Its WGSL builds use 16-bit floats, which GLSL does not have, so give WebGPU and WebGL2 a variant each."
        ));
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

/// Checks that each variant of a shader whose modules hold one target's builds has one target.
/// `why` says how the shader loads, for the message.
fn check_one_target(
    errors: &mut Vec<String>,
    key: &str,
    variants: &BTreeMap<String, Variant>,
    why: &str,
) {
    for (name, variant) in variants {
        if variant.targets.len() > 1 {
            errors.push(format!(
                "{key}.variants.{name} targets both \"wgsl\" and \"glsl\", but {key} {why}. Give the variant one target, and add a variant for the other."
            ));
        }
    }
}

/// Checks the features whose builds load on first use: each has a name that a file name can hold,
/// and names shaders that load by device and permutation bits that a device does not fix, each in
/// one feature only. The template of custom materials stays in the files that load at the start,
/// since a custom material's build comes from the page's own code.
fn check_first_use(errors: &mut Vec<String>, manifest: &Manifest) {
    let mut shader_owners: BTreeMap<&str, &str> = BTreeMap::new();
    let mut bit_owners: BTreeMap<&str, &str> = BTreeMap::new();
    for (feature, first_use) in &manifest.first_use {
        let key = format!("first_use.{feature}");
        let named = feature.starts_with(|c: char| c.is_ascii_lowercase())
            && feature
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_');
        if !named
            || [Target::Wgsl, Target::Glsl]
                .iter()
                .any(|t| t.name() == feature)
        {
            errors.push(format!(
                "{key}: \"{feature}\" is not a valid feature name. Use lowercase letters, digits and underscores, start with a letter, and do not use \"wgsl\" or \"glsl\", because the name becomes part of a file name."
            ));
        }
        if first_use.shaders.is_empty() && first_use.bits.is_empty() {
            errors.push(format!(
                "{key} names no shaders and no bits, so no build loads on its first use. List its shaders in `shaders`, its permutation bits in `bits`, or both."
            ));
        }
        for shader_name in &first_use.shaders {
            match manifest.shaders.get(shader_name) {
                None => errors.push(format!(
                    "{key}.shaders has \"{shader_name}\", which is not a shader of the manifest."
                )),
                Some(shader) if !shader.by_device => errors.push(format!(
                    "{key}.shaders has \"{shader_name}\", which does not load by device. Set `by_device = true` on shaders.{shader_name}: only builds that load by device can load on first use."
                )),
                Some(shader) if shader.custom_materials => errors.push(format!(
                    "{key}.shaders has \"{shader_name}\", the template of custom materials, which stays in the files that load at the start."
                )),
                Some(_) => {}
            }
            if let Some(other) = shader_owners.insert(shader_name, feature) {
                errors.push(format!(
                    "{key}.shaders has \"{shader_name}\", which first_use.{other} names too. A shader's builds load with one feature."
                ));
            }
        }
        for bit in &first_use.bits {
            match permutation::bit(bit) {
                None => errors.push(format!(
                    "{key}.bits has \"{bit}\", which is not a permutation bit."
                )),
                Some(value) if value & permutation::DEVICE != 0 => errors.push(format!(
                    "{key}.bits has \"{bit}\", which a device fixes. Each device loads its builds at the start."
                )),
                Some(_) => {}
            }
            let used = manifest.shaders.values().any(|shader| {
                shader.by_device
                    && shader
                        .variants
                        .values()
                        .any(|variant| variant.permutations.contains(bit))
            });
            if permutation::bit(bit).is_some() && !used {
                errors.push(format!(
                    "{key}.bits has \"{bit}\", which no variant of a shader that loads by device lists, so it moves no build."
                ));
            }
            if let Some(other) = bit_owners.insert(bit, feature) {
                errors.push(format!(
                    "{key}.bits has \"{bit}\", which first_use.{other} names too. A bit's builds load with one feature."
                ));
            }
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

    const FEATURES: &str = r#"
[shaders.sprite]
file = "sprite.wgsl"
by_device = true
pipelines.main = { vertex = "vs", fragment = "fs" }
variants.webgpu = { permutations = ["TONE_MAP"], targets = ["wgsl"] }

[shaders.final]
file = "final.wgsl"
by_device = true
pipelines.main = { vertex = "vs", fragment = "fs" }
variants.webgpu = { permutations = ["FXAA", "BLOOM"], targets = ["wgsl"] }

[first_use.sprites]
shaders = ["sprite"]

[first_use.bloom]
bits = ["BLOOM"]
"#;

    #[test]
    fn features_that_load_on_first_use_name_their_shaders_and_bits() {
        let manifest = Manifest::parse(FEATURES).unwrap();
        assert_eq!(manifest.first_use["sprites"].shaders, ["sprite"]);
        assert_eq!(manifest.first_use["bloom"].bits, ["BLOOM"]);
    }

    #[test]
    fn features_that_load_on_first_use_are_checked() {
        let text = format!(
            "{FEATURES}\n[first_use.Glow]\nshaders = [\"sprite\", \"mesh\"]\nbits = [\"TONE_MAP\", \"SHINY\", \"BLOOM\", \"SKIN\"]\n\n[first_use.wgsl]\n"
        );
        let all = Manifest::parse(&text).unwrap_err().join("\n");
        for expected in [
            "first_use.Glow: \"Glow\" is not a valid feature name",
            "first_use.wgsl: \"wgsl\" is not a valid feature name",
            "first_use.wgsl names no shaders and no bits",
            "first_use.Glow.shaders has \"mesh\", which is not a shader of the manifest",
            "first_use.sprites.shaders has \"sprite\", which first_use.Glow names too",
            "first_use.Glow.bits has \"TONE_MAP\", which a device fixes",
            "first_use.Glow.bits has \"SHINY\", which is not a permutation bit",
            "first_use.bloom.bits has \"BLOOM\", which first_use.Glow names too",
            "first_use.Glow.bits has \"SKIN\", which no variant of a shader that loads by device lists",
        ] {
            assert!(all.contains(expected), "{expected}\n{all}");
        }
        let unlisted = FEATURES.replace("by_device = true\npipelines.main = { vertex = \"vs\", fragment = \"fs\" }\nvariants.webgpu = { permutations = [\"TONE_MAP\"]", "pipelines.main = { vertex = \"vs\", fragment = \"fs\" }\nvariants.webgpu = { permutations = [\"TONE_MAP\"]");
        let errors = Manifest::parse(&unlisted).unwrap_err();
        assert!(
            errors[0].contains("which does not load by device"),
            "{errors:?}"
        );
    }

    #[test]
    fn a_shader_that_loads_on_first_use_has_one_target_per_variant_and_no_device_modules() {
        let text = format!("{VALID}first_use = true\n");
        let errors = Manifest::parse(&text).unwrap_err();
        assert!(errors[0].contains("loads on first use"), "{errors:?}");
        let one_target = text.replace("[\"glsl\", \"wgsl\"]", "[\"glsl\"]");
        assert!(Manifest::parse(&one_target).unwrap().shaders["mesh"].first_use);
        let both = format!("{one_target}by_device = true\n");
        let errors = Manifest::parse(&both).unwrap_err();
        assert!(
            errors[0].contains("sets both by_device and first_use"),
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
