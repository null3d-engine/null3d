//! The final pass: one triangle over the canvas, which reads the HDR scene color, applies the
//! exposure and the tone mapping, encodes sRGB and dithers (see [`crate::output`]). It runs only on
//! the HDR path. Each frame builder owns one, with GPU object ids from its own ranges.

use null3d_gpu::drawlist::{
    DrawList, Op, buffer_usage as usage, format, layout as bind_layout, resource_kind,
    sizes::OUTPUT_UNIFORM_BYTES, state_flags, template,
};

use crate::frame::{RecordError, UploadArena};
use crate::output::OutputUniform;

/// The GPU objects of the final pass, which the frame builder's id ranges set.
#[derive(Clone, Copy, Debug)]
pub(crate) struct FinalIds {
    pub(crate) pipeline: u32,
    /// The buffer of the output settings.
    pub(crate) settings: u32,
    /// The bind group of the settings and the scene color.
    pub(crate) group: u32,
}

/// The final pass's GPU objects, and what they hold.
#[derive(Debug)]
pub(crate) struct FinalPass {
    ids: FinalIds,
    created: bool,
    /// The settings the buffer holds, or `None` before the first upload.
    uploaded: Option<OutputUniform>,
    /// The scene color texture that the bind group reads, or `None` before it exists.
    bound: Option<u32>,
}

impl FinalPass {
    pub(crate) fn new(ids: FinalIds) -> Self {
        Self {
            ids,
            created: false,
            uploaded: None,
            bound: None,
        }
    }

    /// Bytes the pass may copy into a frame's arena: the output settings.
    pub(crate) const UPLOAD_BYTES: usize = OUTPUT_UNIFORM_BYTES as usize;

    /// Makes the pipeline and the settings buffer when the GPU lacks them, uploads the settings
    /// when they changed, and binds the scene color texture `scene_color` when it is new. The
    /// frame's list made the plan's textures again when `textures_made`, which leaves an older
    /// bind group reading a texture that is gone.
    pub(crate) fn prepare(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        settings: OutputUniform,
        scene_color: u32,
        textures_made: bool,
    ) -> Result<(), RecordError> {
        let ids = self.ids;
        if !self.created {
            // The shader makes its triangle from the vertex index, so it reads no vertex buffer
            // and the vertex format is the plain one.
            list.push(
                Op::CreateRenderPipeline,
                &[
                    ids.pipeline,
                    template::FINAL,
                    0,
                    format::CANVAS,
                    format::NONE,
                    1,
                    state_flags::CULL_NONE,
                    0,
                ],
            )?;
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
        list.push(Op::SetPipeline, &[self.ids.pipeline])?;
        list.push(Op::SetBindGroup, &[0, self.ids.group, 0])?;
        list.push(Op::Draw, &[3, 1, 0, 0])?;
        Ok(())
    }

    /// Forgets the GPU objects, so the next frame makes them again, after the thread that draws
    /// replaced the GPU.
    pub(crate) fn reset_gpu(&mut self) {
        self.created = false;
        self.uploaded = None;
        self.bound = None;
    }
}
