//! The final pass: one triangle over the canvas, which reads the scene color and writes the canvas
//! (see [`crate::output`]). On the HDR path it applies the exposure and the tone mapping, encodes
//! sRGB and dithers. In the FXAA mode it smooths edges first. On the 8-bit path the scene shaders
//! did the output transform, and the pass runs only when the scene has one sample per pixel: it
//! copies the scene color, or runs FXAA on it. Each frame builder owns one, with GPU object ids
//! from its own ranges, and its pipeline comes from the builder's pipeline cache like every other.

use null3d_gpu::drawlist::{
    DrawList, Op, buffer_usage as usage, format, layout as bind_layout, permutation, resource_kind,
    sizes::OUTPUT_UNIFORM_BYTES, state_flags, template,
};

use crate::frame::{RecordError, UploadArena};
use crate::output::{Antialias, Output, OutputUniform, SceneColor};
use crate::pipelines::{PipelineCache, PipelineKey};

/// The final pass's pipeline: it draws into the canvas, with no depth and no antialiasing. The
/// shader makes its triangle from the vertex index, so it reads no vertex buffer, and the triangle
/// covers the canvas whichever way it winds. The FXAA build smooths edges.
const fn pipeline(fxaa: bool) -> PipelineKey {
    PipelineKey {
        template: template::FINAL,
        permutation: if fxaa { permutation::FXAA } else { 0 },
        vertex_format: 0,
        color_format: format::CANVAS,
        depth_format: format::NONE,
        samples: 1,
        state: state_flags::CULL_NONE,
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
    created: bool,
    /// The settings the buffer holds, or `None` before the first upload.
    uploaded: Option<OutputUniform>,
    /// The scene color texture that the bind group reads, or `None` before it exists.
    bound: Option<u32>,
}

impl FinalPass {
    /// The final pass of a builder whose scene draws into `scene_color` in the `antialias` mode.
    pub(crate) fn new(ids: FinalIds, scene_color: SceneColor, antialias: Antialias) -> Self {
        let mut pass = Self {
            ids,
            fxaa: false,
            flags: 0,
            pipeline: None,
            created: false,
            uploaded: None,
            bound: None,
        };
        pass.set_mode(scene_color, antialias);
        pass
    }

    /// Makes the pass read a scene color in `scene_color`, in the `antialias` mode, from the next
    /// frame on. The pass asks for its pipeline again, and binds the scene color again, as the
    /// frame makes its targets again. Its settings buffer stays.
    pub(crate) fn set_mode(&mut self, scene_color: SceneColor, antialias: Antialias) {
        self.fxaa = antialias == Antialias::Fxaa;
        self.flags = if scene_color.is_hdr() {
            0
        } else {
            OutputUniform::DISPLAY_COLOR
        };
        self.pipeline = None;
        self.bound = None;
    }

    /// Bytes the pass may copy into a frame's arena: the output settings.
    pub(crate) const UPLOAD_BYTES: usize = OUTPUT_UNIFORM_BYTES as usize;

    /// Asks `pipelines` for the pass's pipeline, once. A builder asks before it records the
    /// pipelines that its frame creates, so the list creates this one with the others, at its
    /// start.
    pub(crate) fn request_pipeline(&mut self, pipelines: &mut PipelineCache) {
        if self.pipeline.is_none() {
            self.pipeline = Some(pipelines.id(pipeline(self.fxaa)));
        }
    }

    /// Makes the settings buffer when the GPU lacks it, uploads the settings for `output` when
    /// they changed, and binds the scene color texture `scene_color` when it is new. The frame's
    /// list made the plan's textures again when `textures_made`, which leaves an older bind group
    /// reading a texture that is gone.
    pub(crate) fn prepare(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        output: Output,
        scene_color: u32,
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
        let settings = OutputUniform {
            flags: self.flags,
            ..output.uniform()
        };
        if self.uploaded != Some(settings) {
            let (at, bytes) = arena.push(settings.as_bytes())?;
            list.push(Op::WriteBuffer, &[ids.settings, 0, at, bytes])?;
            self.uploaded = Some(settings);
        }
        if textures_made || self.bound != Some(scene_color) {
            list.push(
                Op::CreateBindGroup,
                &[
                    ids.group,
                    bind_layout::FINAL,
                    2,
                    0,
                    resource_kind::BUFFER,
                    ids.settings,
                    0,
                    0,
                    1,
                    resource_kind::TEXTURE,
                    scene_color,
                    0,
                    0,
                ],
            )?;
            self.bound = Some(scene_color);
        }
        Ok(())
    }

    /// Records the pass inside the render pass that the render graph began into the canvas.
    pub(crate) fn record(&self, list: &mut DrawList) -> Result<(), RecordError> {
        let pipeline = self
            .pipeline
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
        pass.request_pipeline(&mut pipelines);
        pass.prepare(&mut list, &mut arena, Output::default(), 4, true)
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
