//! What the build makes: for each variant, WGSL for WebGPU and GLSL ES 3.00 with reflection for
//! WebGL2.

use std::collections::BTreeMap;

use crate::Pipeline;

/// Every variant the build made.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Output {
    /// Variants by shader name, then by variant name.
    pub shaders: BTreeMap<String, BTreeMap<String, VariantOutput>>,
    /// Pipeline names by shader name, sorted.
    pub pipelines: BTreeMap<String, Vec<String>>,
}

/// One built variant.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VariantOutput {
    /// WGSL for WebGPU, when the variant targets it.
    pub wgsl: Option<WgslOutput>,
    /// GLSL programs for WebGL2 by pipeline name, when the variant targets it.
    pub glsl: Option<BTreeMap<String, GlslProgram>>,
}

/// One WGSL module and the entry points of each render pipeline.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WgslOutput {
    /// The module that naga writes from the composed, validated and compacted module.
    pub source: String,
    /// Render pipelines by name.
    pub pipelines: BTreeMap<String, Pipeline>,
}

/// The vertex and fragment shaders of one render pipeline, to link into one WebGL2 program.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GlslProgram {
    /// The vertex shader.
    pub vertex: GlslStage,
    /// The fragment shader.
    pub fragment: GlslStage,
}

/// One GLSL ES 3.00 shader and the names its resources have in it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GlslStage {
    /// The shader source.
    pub source: String,
    /// Uniform blocks, sorted by WGSL binding.
    pub uniform_blocks: Vec<GlslUniformBlock>,
    /// Texture uniforms, sorted by WGSL binding.
    pub textures: Vec<GlslTexture>,
}

/// A WGSL resource binding.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Binding {
    /// The bind group.
    pub group: u32,
    /// The binding inside the group.
    pub binding: u32,
}

/// A uniform block of one GLSL stage.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GlslUniformBlock {
    /// The block name, for `getUniformBlockIndex`.
    pub name: String,
    /// The WGSL uniform buffer the block stands for.
    pub binding: Binding,
}

/// A texture uniform of one GLSL stage, which joins a WGSL texture and its sampler.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GlslTexture {
    /// The uniform name, for `getUniformLocation`.
    pub name: String,
    /// The WGSL texture.
    pub binding: Binding,
    /// The WGSL sampler the stage samples the texture with, if any.
    pub sampler: Option<Binding>,
}
