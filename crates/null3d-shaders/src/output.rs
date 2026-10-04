//! What the build makes: for each variant, WGSL for WebGPU and GLSL ES 3.00 with reflection for
//! WebGL2. The records serialize with the field names of the generated TypeScript module's types.

use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;

use crate::{BuildError, Pipeline, Problem};

/// A result as the WebAssembly module returns it: `{"ok": true, "output": ...}` on success, and
/// `{"ok": false, "problems": [...]}` otherwise.
#[derive(Serialize)]
pub struct Response<'a, T> {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    output: Option<&'a T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    problems: Option<&'a [Problem]>,
}

impl<'a, T> From<&'a Result<T, BuildError>> for Response<'a, T> {
    fn from(result: &'a Result<T, BuildError>) -> Self {
        Self {
            ok: result.is_ok(),
            output: result.as_ref().ok(),
            problems: result.as_ref().err().map(|error| error.problems.as_slice()),
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
}

/// The features whose builds load on first use: the feature of each shader whose builds all belong
/// to one, and the feature of each permutation bit whose builds belong to one.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct FirstUseFeatures {
    /// Features by shader name.
    pub shaders: BTreeMap<String, String>,
    /// Features by permutation bit, in bit order.
    pub bits: BTreeMap<u32, String>,
}

impl FirstUseFeatures {
    /// The feature that a build of `shader` with the permutation word `permutation` belongs to:
    /// the shader's, or else that of the lowest bit of the word that a feature names. None for a
    /// build that loads at the start.
    pub fn feature_of(&self, shader: &str, permutation: u32) -> Option<&str> {
        self.shaders
            .get(shader)
            .or_else(|| {
                self.bits
                    .iter()
                    .find(|&(&bit, _)| permutation & bit != 0)
                    .map(|(_, feature)| feature)
            })
            .map(String::as_str)
    }
}

/// One built variant.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
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
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct WgslOutput {
    /// The module that naga writes from the composed, validated and compacted module.
    pub source: String,
    /// Render pipelines by name.
    pub pipelines: BTreeMap<String, Pipeline>,
}

/// The vertex and fragment shaders of one render pipeline, to link into one WebGL2 program.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct GlslProgram {
    /// The vertex shader.
    pub vertex: GlslStage,
    /// The fragment shader.
    pub fragment: GlslStage,
}

/// One GLSL ES 3.00 shader and the names its resources have in it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlslStage {
    /// The shader source.
    pub source: String,
    /// Uniform blocks, sorted by WGSL binding.
    pub uniform_blocks: Vec<GlslUniformBlock>,
    /// Texture uniforms, sorted by WGSL binding.
    pub textures: Vec<GlslTexture>,
}

/// A WGSL resource binding.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct Binding {
    /// The bind group.
    pub group: u32,
    /// The binding inside the group.
    pub binding: u32,
}

/// A uniform block of one GLSL stage.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct GlslUniformBlock {
    /// The block name, for `getUniformBlockIndex`.
    pub name: String,
    /// The WGSL uniform buffer the block stands for.
    #[serde(flatten)]
    pub binding: Binding,
}

/// A texture uniform of one GLSL stage, which joins a WGSL texture and its sampler.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
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
    use null3d_gpu::drawlist::permutation::{BLOOM, FXAA, MORPH};

    use super::*;

    #[test]
    fn a_build_belongs_to_its_shaders_feature_or_else_to_that_of_its_lowest_feature_bit() {
        let mut first_use = FirstUseFeatures::default();
        first_use
            .shaders
            .insert("sprite".to_owned(), "sprites".to_owned());
        first_use.bits.insert(BLOOM, "bloom".to_owned());
        first_use.bits.insert(MORPH, "morph".to_owned());
        assert_eq!(first_use.feature_of("sprite", BLOOM), Some("sprites"));
        assert_eq!(first_use.feature_of("final", FXAA | BLOOM), Some("bloom"));
        assert_eq!(first_use.feature_of("lit", MORPH | BLOOM), Some("morph"));
        assert_eq!(first_use.feature_of("lit", FXAA), None);
    }
}
