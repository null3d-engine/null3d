//! What the build makes: for each variant, WGSL for WebGPU and GLSL ES 3.00 with reflection for
//! WebGL2. The records serialize with the field names of the generated TypeScript module's types.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use null3d_gpu::drawlist::permutation;
use serde::{Deserialize, Serialize};

use crate::{BuildError, Pipeline, Problem};

/// The bits whose value names a feature that another template also names ([`permutation::SHARED`],
/// decision record D-156). Such a value counts only for a template that lists its name.
pub fn shared_bits() -> u32 {
    permutation::SHARED
        .iter()
        .filter_map(|&(name, _)| permutation::bit(name))
        .fold(0, |mask, bit| mask | bit)
}

/// A result as the WebAssembly module returns it: `{"ok": true, "output": ...}` on success, and
/// `{"ok": false, "problems": [...]}` otherwise, each with `"warnings": [...]` when the build
/// found any.
#[derive(Serialize)]
pub struct Response<'a, T> {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    output: Option<&'a T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    problems: Option<&'a [Problem]>,
    #[serde(skip_serializing_if = "<[Problem]>::is_empty")]
    warnings: &'a [Problem],
}

impl<'a, T> Response<'a, T> {
    /// The response with the build's warnings.
    #[must_use]
    pub fn with_warnings(self, warnings: &'a [Problem]) -> Self {
        Self { warnings, ..self }
    }
}

impl<'a, T> From<&'a Result<T, BuildError>> for Response<'a, T> {
    fn from(result: &'a Result<T, BuildError>) -> Self {
        Self {
            ok: result.is_ok(),
            output: result.as_ref().ok(),
            problems: result.as_ref().err().map(|error| error.problems.as_slice()),
            warnings: &[],
        }
    }
}

/// Every variant the build made.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct Output {
    /// Variants by shader name, then by variant name.
    pub shaders: BTreeMap<String, BTreeMap<String, VariantOutput>>,
    /// Pipeline names by shader name, sorted.
    pub pipelines: BTreeMap<String, Vec<String>>,
    /// The shaders that load by device, whose builds go into the device modules.
    #[serde(skip)]
    pub by_device: BTreeSet<String>,
    /// The features whose builds load on first use, in device modules of their own.
    #[serde(skip)]
    pub first_use: FirstUseFeatures,
    /// The shaders that load on a feature's first use as a whole, each in a module of its own per
    /// target, which the feature's code imports.
    #[serde(skip)]
    pub first_use_shaders: BTreeSet<String>,
    /// The permutation words that a narrowed build made, or empty when it made every word. The
    /// module names them so that a page can say which word its build lacks, rather than draw
    /// nothing.
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    pub listed: BTreeSet<u32>,
}

/// The features whose builds load on first use: the feature of each shader whose builds all belong
/// to one, and the feature of each permutation bit whose builds belong to one. A build that needs
/// one feature loads with that feature's files. A build that needs several, such as a skinned build
/// of the alpha hash, loads with files of its own, which a page loads only once it uses each of
/// those features. So no feature's files hold builds that only pages with another feature draw
/// with.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct FirstUseFeatures {
    /// Features by shader name.
    pub shaders: BTreeMap<String, String>,
    /// Features by permutation bit, in bit order.
    pub bits: BTreeMap<u32, String>,
    /// By shader name, the shared-value bits of [`Self::bits`] whose names the shader's variants
    /// list: a value that names a feature another template names too counts only for a template
    /// that lists its name ([`shared_bits`], decision record D-156). An unshared bit counts for
    /// every template.
    pub listed: BTreeMap<String, u32>,
}

/// The character that joins the names of the features that a build needs, in the key of its files.
pub const FEATURE_JOIN: char = '+';

impl FirstUseFeatures {
    /// The key of the files that hold a build of `shader` with the permutation word `permutation`:
    /// the names of the features that it needs, its shader's and those of its bits, sorted and
    /// joined by [`FEATURE_JOIN`]. None for a build that loads at the start. A value that names a
    /// feature another template names too counts only for a template that lists its name, because
    /// a shared value names a different feature in each template (decision record D-156).
    pub fn file_of(&self, shader: &str, permutation: u32) -> Option<String> {
        let allowed = self.listed.get(shader).copied().unwrap_or(0) | !shared_bits();
        let mut features: BTreeSet<&str> = self
            .bits
            .iter()
            .filter(|&(&bit, _)| permutation & allowed & bit != 0)
            .map(|(_, feature)| feature.as_str())
            .collect();
        features.extend(self.shaders.get(shader).map(String::as_str));
        if features.is_empty() {
            return None;
        }
        let names: Vec<&str> = features.into_iter().collect();
        Some(names.join(&FEATURE_JOIN.to_string()))
    }
}

/// One built variant.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
pub struct VariantOutput {
    /// The permutation bits the build was made with, as a render pipeline's permutation word
    /// holds them: 0 for a variant without permutation bits.
    pub permutation: u32,
    /// WGSL for WebGPU, when the variant targets it.
    pub wgsl: Option<WgslOutput>,
    /// GLSL programs for WebGL2 by pipeline name, when the variant targets it.
    pub glsl: Option<BTreeMap<String, GlslProgram>>,
}

/// One WGSL module and the entry points of each render pipeline.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
pub struct WgslOutput {
    /// The module that naga writes from the composed, validated and compacted module. It is a
    /// shared text, so the builds that the cache gives back with the same module hold one copy.
    pub source: Arc<str>,
    /// Render pipelines by name.
    pub pipelines: BTreeMap<String, Pipeline>,
}

/// The vertex and fragment shaders of one render pipeline, to link into one WebGL2 program.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
pub struct GlslProgram {
    /// The vertex shader.
    pub vertex: GlslStage,
    /// The fragment shader.
    pub fragment: GlslStage,
}

/// One GLSL ES 3.00 shader and the names its resources have in it.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlslStage {
    /// The shader source. It is a shared text, so the builds that the cache gives back with the
    /// same shader hold one copy.
    pub source: Arc<str>,
    /// Uniform blocks, sorted by WGSL binding.
    pub uniform_blocks: Vec<GlslUniformBlock>,
    /// Texture uniforms, sorted by WGSL binding.
    pub textures: Vec<GlslTexture>,
}

/// A WGSL resource binding.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Deserialize, Serialize)]
pub struct Binding {
    /// The bind group.
    pub group: u32,
    /// The binding inside the group.
    pub binding: u32,
}

/// A uniform block of one GLSL stage.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
pub struct GlslUniformBlock {
    /// The block name, for `getUniformBlockIndex`.
    pub name: String,
    /// The WGSL uniform buffer the block stands for.
    #[serde(flatten)]
    pub binding: Binding,
}

/// A texture uniform of one GLSL stage, which joins a WGSL texture and its sampler.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
pub struct GlslTexture {
    /// The uniform name, for `getUniformLocation`.
    pub name: String,
    /// The WGSL texture.
    #[serde(flatten)]
    pub binding: Binding,
    /// The WGSL sampler the stage samples the texture with, if any.
    pub sampler: Option<Binding>,
}

#[cfg(test)]
mod tests {
    use null3d_gpu::drawlist::permutation::{
        ALPHA_COVERAGE, ALPHA_HASH, AREA_LIGHTS, BLOOM, FXAA, MORPH, SAMPLE_MASK,
    };

    use super::*;

    #[test]
    fn a_build_that_needs_several_features_has_files_of_its_own() {
        let mut first_use = FirstUseFeatures::default();
        first_use
            .shaders
            .insert("sprite".to_owned(), "sprites".to_owned());
        first_use.bits.insert(BLOOM, "bloom".to_owned());
        first_use.bits.insert(MORPH, "morph".to_owned());
        first_use.bits.insert(AREA_LIGHTS, "area_lights".to_owned());
        first_use.bits.insert(ALPHA_HASH, "hash".to_owned());
        first_use.bits.insert(ALPHA_COVERAGE, "coverage".to_owned());
        first_use.bits.insert(SAMPLE_MASK, "coverage".to_owned());
        // A bit takes only the builds of the shaders whose variants list its name, because a value
        // can name another feature in another shader (decision record D-156).
        first_use.listed.insert("final".to_owned(), BLOOM);
        first_use.listed.insert(
            "lit".to_owned(),
            BLOOM | MORPH | AREA_LIGHTS | ALPHA_HASH | ALPHA_COVERAGE | SAMPLE_MASK,
        );
        first_use.listed.insert("sprite".to_owned(), ALPHA_HASH);
        let file = |shader, permutation| first_use.file_of(shader, permutation);
        assert_eq!(file("sprite", 0).as_deref(), Some("sprites"));
        assert_eq!(file("final", FXAA | BLOOM).as_deref(), Some("bloom"));
        // A shared value names the area lights for the lit templates and FXAA for the final pass.
        assert_eq!(file("lit", AREA_LIGHTS).as_deref(), Some("area_lights"));
        assert_eq!(file("final", FXAA), None);
        assert_eq!(
            file("lit", MORPH | ALPHA_HASH).as_deref(),
            Some("hash+morph")
        );
        assert_eq!(file("sprite", ALPHA_HASH).as_deref(), Some("hash+sprites"));
        assert_eq!(
            file("lit", MORPH | ALPHA_HASH | BLOOM).as_deref(),
            Some("bloom+hash+morph")
        );
        assert_eq!(
            file("lit", ALPHA_COVERAGE | SAMPLE_MASK).as_deref(),
            Some("coverage"),
            "two bits of one feature"
        );
    }
}
