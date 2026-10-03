//! The final pass: one triangle over the canvas, which reads the scene color and writes the canvas
//! (see [`crate::output`]). On the HDR path it applies the exposure and the tone mapping, encodes
//! sRGB and dithers. In the FXAA mode it smooths edges first. On the 8-bit path the scene shaders
//! did the output transform, and the pass runs when the scene has one sample per pixel or the
//! render scale can drop: it copies the scene color, or runs FXAA on it. Below the whole canvas's
//! render scale, it scales the scene's corner of the scene color up to the canvas instead. With
//! bloom (see [`crate::bloom`]), the pass draws with its bloom build, which adds bloom's levels to
//! the scene color before the output transform. Each frame builder owns one, with GPU object ids
//! from its own ranges, and its pipelines come from the builder's pipeline cache like every other.

use null3d_gpu::drawlist::{
    DrawList, Op, buffer_usage as usage, format, layout as bind_layout, permutation, resource_kind,
    sizes::OUTPUT_UNIFORM_BYTES, state_flags, template,
};

use crate::bloom::{BloomIds, FINAL_OFFSET, LEVELS};
use crate::frame::{RecordError, UploadArena};
use crate::output::{Antialias, Output, OutputUniform, SceneColor};
use crate::pipelines::{DepthBias, PipelineCache, PipelineKey};

/// The final pass's pipeline: it draws into the canvas, with no depth and no antialiasing. The
/// shader makes its triangle from the vertex index, so it reads no vertex buffer, and the triangle
/// covers the canvas whichever way it winds. The FXAA build smooths edges, and the bloom build adds
/// bloom's levels.
const fn pipeline(fxaa: bool, bloom: bool) -> PipelineKey {
    PipelineKey {
        template: if bloom {
            template::FINAL_BLOOM
        } else {
            template::FINAL
        },
        permutation: if fxaa { permutation::FXAA } else { 0 }
            | if bloom { permutation::BLOOM } else { 0 },
        vertex_format: 0,
        color_format: format::CANVAS,
        depth_format: format::NONE,
        samples: 1,
        state: state_flags::CULL_NONE,
        bias: DepthBias::NONE,
    }
}

/// The GPU objects of the final pass, which the frame builder's id ranges set.
#[derive(Clone, Copy, Debug)]
pub(crate) struct FinalIds {
    /// The buffer of the output settings.
    pub(crate) settings: u32,
    /// The bind group of the settings and the scene color.
    pub(crate) group: u32,
}

/// What the final pass's bloom build reads: bloom's uniform buffer and sampler, and the texture of
/// each level.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct BloomInputs {
    pub(crate) buffer: u32,
    pub(crate) sampler: u32,
    pub(crate) levels: [u32; LEVELS],
}

impl BloomInputs {
    /// The inputs of `ids`'s buffer and sampler, with each level's texture.
    pub(crate) fn new(ids: BloomIds, levels: [u32; LEVELS]) -> Self {
        Self {
            buffer: ids.buffer,
            sampler: ids.sampler,
            levels,
        }
    }
}

/// The final pass's GPU objects, and what they hold.
#[derive(Debug)]
pub(crate) struct FinalPass {
    ids: FinalIds,
    /// True for the FXAA build of the pass.
    fxaa: bool,
    /// The flags of the pass's settings: whether the scene color holds display color.
    flags: u32,
    /// The pipeline's id in the builder's cache, once the pass has asked for it.
    pipeline: Option<u32>,
    /// The bloom build's pipeline's id, once a frame with bloom asked for it.
    bloom_pipeline: Option<u32>,
    created: bool,
    /// The settings the buffer holds, or `None` before the first upload.
    uploaded: Option<OutputUniform>,
    /// The scene color texture that the bind group reads, with bloom's inputs for the bloom
    /// build, or `None` before the group exists.
    bound: Option<(u32, Option<BloomInputs>)>,
}

impl FinalPass {
    /// The final pass of a builder whose scene draws into `scene_color` in the `antialias` mode.
    pub(crate) fn new(ids: FinalIds, scene_color: SceneColor, antialias: Antialias) -> Self {
        Self {
            ids,
            fxaa: antialias == Antialias::Fxaa,
            flags: if scene_color.is_hdr() {
                0
            } else {
                OutputUniform::DISPLAY_COLOR
            },
            pipeline: None,
            bloom_pipeline: None,
            created: false,
            uploaded: None,
            bound: None,
        }
    }

    /// Takes the build and the flags for a scene that draws into `scene_color` in the `antialias`
    /// mode, from the next frame on. The pass asks for its pipelines and makes its bind group again.
    pub(crate) fn set_mode(&mut self, scene_color: SceneColor, antialias: Antialias) {
        let fresh = Self::new(self.ids, scene_color, antialias);
        *self = Self {
            created: self.created,
            ..fresh
        };
    }

    /// Bytes the pass may copy into a frame's arena: the output settings.
    pub(crate) const UPLOAD_BYTES: usize = OUTPUT_UNIFORM_BYTES as usize;

    /// Asks `pipelines` for the pass's pipeline, once, and for its bloom build's once a frame has
    /// `bloom`. A builder asks before it records the pipelines that its frame creates, so the list
    /// creates them with the others, at its start.
    pub(crate) fn request_pipeline(&mut self, pipelines: &mut PipelineCache, bloom: bool) {
        if self.pipeline.is_none() {
            self.pipeline = Some(pipelines.id(pipeline(self.fxaa, false)));
        }
        if bloom && self.bloom_pipeline.is_none() {
            self.bloom_pipeline = Some(pipelines.id(pipeline(self.fxaa, true)));
        }
    }

    /// Makes the settings buffer when the GPU lacks it, uploads the settings for `output` and the
    /// scene's size in pixels, `render_size`, when they changed, and binds the scene color texture
    /// `scene_color`, with `bloom`'s inputs for the bloom build, when they are new. The frame's
    /// list made the plan's textures again when `textures_made`, which leaves an older bind group
    /// reading a texture that is gone.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn prepare(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        output: Output,
        render_size: (u32, u32),
        scene_color: u32,
        bloom: Option<BloomInputs>,
        textures_made: bool,
    ) -> Result<(), RecordError> {
        let ids = self.ids;
        if !self.created {
            list.push(
                Op::CreateBuffer,
                &[
                    ids.settings,
                    OUTPUT_UNIFORM_BYTES,
                    usage::UNIFORM | usage::COPY_DST,
                ],
            )?;
            self.created = true;
        }
        let mut settings = OutputUniform {
            flags: self.flags,
            ..output.uniform()
        };
        settings.set_render_size(render_size);
        if self.uploaded != Some(settings) {
            let (at, bytes) = arena.push(settings.as_bytes())?;
            list.push(Op::WriteBuffer, &[ids.settings, 0, at, bytes])?;
            self.uploaded = Some(settings);
        }
        let inputs = (scene_color, bloom);
        if textures_made || self.bound != Some(inputs) {
            let mut words = [0u32; 3 + 5 * 9];
            let mut len = 3;
            let mut entry = |binding: u32, kind: u32, id: u32, offset: u32, size: u32| {
                words[len..len + 5].copy_from_slice(&[binding, kind, id, offset, size]);
                len += 5;
            };
            entry(0, resource_kind::BUFFER, ids.settings, 0, 0);
            entry(1, resource_kind::TEXTURE, scene_color, 0, 0);
            let layout = match bloom {
                None => bind_layout::FINAL,
                Some(bloom) => {
                    entry(2, resource_kind::BUFFER, bloom.buffer, FINAL_OFFSET, 0);
                    for (level, &texture) in bloom.levels.iter().enumerate() {
                        entry(3 + level as u32, resource_kind::TEXTURE, texture, 0, 0);
                    }
                    entry(8, resource_kind::SAMPLER, bloom.sampler, 0, 0);
                    bind_layout::FINAL_BLOOM
                }
            };
            words[0] = ids.group;
            words[1] = layout;
            words[2] = ((len - 3) / 5) as u32;
            list.push(Op::CreateBindGroup, &words[..len])?;
            self.bound = Some(inputs);
        }
        Ok(())
    }

    /// Records the pass inside the render pass that the render graph began into the canvas, in its
    /// bloom build with `bloom`.
    pub(crate) fn record(&self, list: &mut DrawList, bloom: bool) -> Result<(), RecordError> {
        let pipeline = if bloom {
            self.bloom_pipeline
        } else {
            self.pipeline
        }
        .expect("the final pass asks for its pipeline before it records");
        list.push(Op::SetPipeline, &[pipeline])?;
        list.push(Op::SetBindGroup, &[0, self.ids.group, 0])?;
        list.push(Op::Draw, &[3, 1, 0, 0])?;
        Ok(())
    }

    /// Forgets the GPU objects, so the next frame makes them again, after the thread that draws
    /// replaced the GPU. The pipeline keeps its id, which the cache creates again.
    pub(crate) fn reset_gpu(&mut self) {
        self.created = false;
        self.uploaded = None;
        self.bound = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const IDS: FinalIds = FinalIds {
        settings: 1,
        group: 2,
    };

    /// Prepares a final pass for a scene color in `format` in the `antialias` mode, and returns the
    /// pipeline it asked for and the settings it uploaded.
    fn prepared(format: u32, antialias: Antialias) -> (PipelineKey, OutputUniform) {
        let mut pass = FinalPass::new(IDS, SceneColor::from_format(format), antialias);
        let mut list = DrawList::with_capacity(256);
        let mut arena = UploadArena::default();
        arena.reset(FinalPass::UPLOAD_BYTES);
        let mut pipelines = PipelineCache::default();
        pass.request_pipeline(&mut pipelines, false);
        pass.prepare(
            &mut list,
            &mut arena,
            Output::default(),
            (64, 64),
            4,
            None,
            true,
        )
        .unwrap();
        (pipelines.keys()[0], pass.uploaded.unwrap())
    }

    #[test]
    fn fxaa_takes_its_build_and_the_8_bit_path_reads_display_color() {
        let shader = include_str!("../../null3d-shaders/wgsl/final.wgsl");
        let line = format!(
            "const DISPLAY_COLOR: u32 = {}u;",
            OutputUniform::DISPLAY_COLOR
        );
        assert!(shader.contains(&line), "final.wgsl lacks {line}");
        for (scene, flags) in [
            (format::RGBA16_FLOAT, 0),
            (format::CANVAS, OutputUniform::DISPLAY_COLOR),
        ] {
            for (antialias, bits) in [
                (Antialias::Fxaa, permutation::FXAA),
                (Antialias::None, 0),
                (Antialias::Msaa, 0),
            ] {
                let (key, settings) = prepared(scene, antialias);
                assert_eq!(key.permutation, bits, "{antialias:?}");
                assert_eq!(settings.flags, flags, "{scene}");
                assert_eq!(settings.exposure, Output::default().exposure);
            }
        }
    }
}
