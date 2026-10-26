//! The final pass: one triangle over the canvas, which reads the scene color and writes the canvas
//! (see [`crate::output`]). On the HDR path it applies the tone mapping and encodes sRGB. The scene
//! color holds exposed color already, so the pass's exposure is 1. In the FXAA mode it smooths
//! edges first. On the 8-bit path the scene shaders did the output transform, and the pass runs
//! when the scene has one sample per pixel or the render scale can drop: it copies the scene color,
//! or runs FXAA on it. Below the whole canvas's render scale, it scales the scene's corner of the
//! scene color up to the canvas instead. While the sketch sharpens, the second step sharpens the
//! display color with RCAS, at the whole canvas's scale as well. With bloom (see
//! [`crate::bloom`]), the pass draws with its bloom build, which blends the base level of bloom's
//! chain into the scene color before the output transform. The vignette darkens HDR color before
//! the output transform too. While objects are
//! outlined, the pass paints the outline's line around them after the output transform (see
//! [`crate::outline`]). Then it grades the canvas color with a color grading table while the sketch
//! sets one (see [`crate::grading`]), and it dithers last. A custom tone curve takes the place of
//! the built-in curves: the pass then draws with the curve's templates, the curve's builds of the
//! pass. Custom effects can fold into the pass (see [`crate::effects`]): it then draws with the
//! fold's template, a build of the pass that runs the effects on each texel it reads, before the
//! vignette, and binds the effects' uniform buffer and the scene's depth too. With automatic
//! exposure (see [`crate::exposure`]), the pass multiplies the HDR color by the meter's texel,
//! which every build binds: a blank texel while the flag is clear. Each frame builder
//! owns one, with GPU object ids from its own ranges, and its pipelines come from the builder's
//! pipeline cache like every other.

use null3d_gpu::drawlist::{
    DrawList, Op, address, buffer_usage as usage, compare, format, layout as bind_layout,
    permutation, resource_kind, state_flags, template, texture_usage, view,
};

use crate::bloom::{BloomIds, FINAL_OFFSET};
use crate::frame::{LINEAR_LEVEL, RecordError, UploadArena, clamp_sampler};
use crate::grading::Grading;
use crate::outline::Outline;
use crate::output::{Antialias, Output, OutputUniform, SceneColor, ToneMapping};
use crate::pipelines::{DepthBias, PipelineCache, PipelineKey};

/// Bytes of the final pass's settings: the output settings, then the vignette's vector, the color
/// grading table's two, the outline's two and the sharpening's one.
const SETTINGS_BYTES: u32 = 112;
/// The bindings of the color grading table and of its sampler in the final pass's group.
const LUT_BINDING: u32 = 9;
const LUT_SAMPLER_BINDING: u32 = 10;
/// The binding of the outline mask in the final pass's group. The table's sampler reads it.
const OUTLINE_BINDING: u32 = 11;
/// The binding of the automatic exposure's texel in the final pass's group.
const EXPOSURE_BINDING: u32 = 12;
/// The binding of the built-in grading table, a 3D texture, in the final pass's group. The table's
/// sampler reads it.
const GRADE_BINDING: u32 = 13;
/// The bindings of the effects' uniform buffer and of the scene's depth in the fold's group.
const EFFECTS_BINDING: u32 = 4;
const EFFECT_DEPTH_BINDING: u32 = 5;

/// The final pass's settings, as `final.wgsl`'s `Settings` block lays them out.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct FinalUniform {
    output: OutputUniform,
    /// The vignette's intensity, size, falloff and roundness.
    vignette: [f32; 4],
    /// The scale that places a color in the color grading table, then the table's intensity.
    lut_scale: [f32; 4],
    /// The offset that places a color in the table, then a spare value.
    lut_offset: [f32; 4],
    /// The outline's visible color and width, then its hidden color and whether it draws (see
    /// [`Outline::uniform`]).
    outline: [[f32; 4]; 2],
    /// The sharpening's strength, then three spare values.
    sharpen: [f32; 4],
}

const _: () = assert!(std::mem::size_of::<FinalUniform>() == SETTINGS_BYTES as usize);

impl FinalUniform {
    /// The block as bytes, for an upload.
    fn as_bytes(&self) -> &[u8] {
        // SAFETY: the struct is `repr(C)` and made only of 4-byte fields, so it has no padding, and
        // any bytes of it are initialized.
        unsafe {
            std::slice::from_raw_parts(
                (self as *const Self).cast::<u8>(),
                std::mem::size_of::<Self>(),
            )
        }
    }
}

/// The final pass's pipeline: it draws into the canvas, with no depth and no antialiasing. The
/// shader makes its triangle from the vertex index, so it reads no vertex buffer, and the triangle
/// covers the canvas whichever way it winds. The FXAA build smooths edges, and the bloom build
/// blends in bloom's base level. A custom tone curve's builds take the templates from `curve` on:
/// the first binds as the pass does, and the next as its bloom build does. The `upscale` build
/// scales the corner up and sharpens it, for the second step of the two-step pass.
const fn pipeline(fxaa: bool, bloom: bool, curve: Option<u32>, upscale: bool) -> PipelineKey {
    PipelineKey {
        template: match (curve, bloom) {
            (Some(first), false) => first,
            (Some(first), true) => first + 1,
            (None, false) => template::FINAL,
            (None, true) => template::FINAL_BLOOM,
        },
        permutation: if fxaa { permutation::FXAA } else { 0 }
            | if bloom { permutation::BLOOM } else { 0 }
            | if upscale { permutation::UPSCALE } else { 0 },
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
    /// The buffer of the pass's settings.
    pub(crate) settings: u32,
    /// The bind group of the settings, the scene color and the color grading table.
    pub(crate) group: u32,
    /// The blank color grading table of one texel, which the group binds while the sketch sets
    /// none.
    pub(crate) blank_lut: u32,
    /// The linear sampler of the color grading table, which reads the outline mask too.
    pub(crate) lut_sampler: u32,
    /// The blank 2D texture of one texel, which the group binds in place of the outline mask while
    /// no outline draws.
    pub(crate) blank_outline: u32,
}

/// What the final pass reads of the outline effect: the mask's texture, and the outline's
/// settings with its width in pixels of the canvas.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct OutlineInputs {
    pub(crate) mask: u32,
    pub(crate) outline: Outline,
}

/// What the final pass's fold build reads of the effects that fold into it: their uniform buffer,
/// and the scene's depth or a blank texture, which is multisampled when `multisampled` says.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct FoldInputs {
    pub(crate) buffer: u32,
    pub(crate) depth: u32,
    pub(crate) multisampled: bool,
}

/// What the final pass's bloom build reads: bloom's uniform buffer and sampler, and the texture of
/// the chain's base level.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct BloomInputs {
    pub(crate) buffer: u32,
    pub(crate) sampler: u32,
    pub(crate) base: u32,
}

impl BloomInputs {
    /// The inputs of `ids`'s buffer and sampler, with the base level's texture.
    pub(crate) fn new(ids: BloomIds, base: u32) -> Self {
        Self {
            buffer: ids.buffer,
            sampler: ids.sampler,
            base,
        }
    }
}

/// The final pass's GPU objects, and what they hold.
#[derive(Debug)]
pub(crate) struct FinalPass {
    ids: FinalIds,
    /// True for the FXAA build of the pass.
    fxaa: bool,
    /// True for the first of the two steps below the whole canvas's render scale: the pass then
    /// draws one texel for each render pixel into a target of the render size, and leaves the
    /// dither to the second step.
    resolve: bool,
    /// True when the scene color holds high dynamic range color, which the pass tone maps.
    hdr: bool,
    /// The flags of the pass's settings: whether the scene color holds display color.
    flags: u32,
    /// The pipeline's id in the builder's cache, once the pass has asked for it.
    pipeline: Option<u32>,
    /// The bloom build's pipeline's id, once a frame with bloom asked for it.
    bloom_pipeline: Option<u32>,
    /// The second step of the two-step pass, which the plain final pass draws below the whole
    /// canvas's render scale, or `None` for the first step.
    present: Option<Present>,
    /// The first template of the custom tone curve that the pass draws with, or `None` for the
    /// pass's own curves.
    tone_curve: Option<u32>,
    /// The fold build's pipeline, with its template and depth read, once a frame asked for it.
    fold_pipeline: Option<(u32, bool, u32)>,
    /// True while the frame's pass draws with the fold build.
    folds: bool,
    created: bool,
    /// The settings the buffer holds, or `None` before the first upload.
    uploaded: Option<FinalUniform>,
    /// What the bind group reads, or `None` before the group exists.
    bound: Option<Bound>,
}

/// What the final pass's bind group reads: the scene color texture, bloom's inputs for the bloom
/// build, the color grading table, the built-in grading table, the outline mask, and the inputs of
/// the effects that fold into the pass.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Bound {
    scene_color: u32,
    bloom: Option<BloomInputs>,
    lut: u32,
    grade: u32,
    mask: u32,
    fold: Option<FoldInputs>,
    exposure: u32,
}

/// The second step of the two-step pass: its bind group, which reads the first step's display
/// color, the plain pipeline that scales that color up to the canvas, and what the group reads.
/// The group lives beside the pass's own, so a frame that crosses the whole canvas's render scale
/// switches groups and makes none.
#[derive(Debug)]
struct Present {
    group: u32,
    pipeline: Option<u32>,
    bound: Option<Bound>,
}

/// What a frame's final pass reads and applies: the tone mapping, the render size, the color it
/// reads, bloom's inputs for the bloom build, the grading, the outline, the effects that fold into
/// the pass, and the automatic exposure's texel.
#[derive(Clone, Copy, Debug)]
pub(crate) struct FinalInputs {
    pub(crate) tone_mapping: ToneMapping,
    pub(crate) render_size: (u32, u32),
    pub(crate) color: u32,
    pub(crate) bloom: Option<BloomInputs>,
    pub(crate) grading: Grading,
    pub(crate) outline: Option<OutlineInputs>,
    /// The mask's texture while it marks surfaces that keep their display color, whose pixels skip
    /// the tone curve.
    pub(crate) tone_mask: Option<u32>,
    pub(crate) fold: Option<FoldInputs>,
    pub(crate) exposure: Option<u32>,
}

impl FinalPass {
    /// The final pass of a builder whose scene draws into `scene_color` in the `antialias` mode.
    pub(crate) fn new(ids: FinalIds, scene_color: SceneColor, antialias: Antialias) -> Self {
        let hdr = scene_color.is_hdr();
        Self {
            ids,
            fxaa: antialias == Antialias::Fxaa,
            resolve: false,
            hdr,
            flags: if hdr { 0 } else { OutputUniform::DISPLAY_COLOR },
            pipeline: None,
            bloom_pipeline: None,
            present: None,
            tone_curve: None,
            fold_pipeline: None,
            folds: false,
            created: false,
            uploaded: None,
            bound: None,
        }
    }

    /// The first of the two steps below the whole canvas's render scale: the pass draws one texel
    /// for each render pixel into a target of the render size, with FXAA and bloom, and the second
    /// step scales its display color up to the canvas.
    pub(crate) fn resolve(mut self) -> Self {
        self.resolve = true;
        self
    }

    /// The plain final pass, which also draws the second of the two steps below the whole canvas's
    /// render scale, binding `group` there.
    pub(crate) fn presents(mut self, group: u32) -> Self {
        self.present = Some(Present {
            group,
            pipeline: None,
            bound: None,
        });
        self
    }

    /// Takes the build and the flags for a scene that draws into `scene_color` in the `antialias`
    /// mode, from the next frame on. The pass asks for its pipelines and makes its bind groups
    /// again.
    pub(crate) fn set_mode(&mut self, scene_color: SceneColor, antialias: Antialias) {
        let present = self.present.as_ref().map(|present| Present {
            group: present.group,
            pipeline: None,
            bound: None,
        });
        let fresh = Self::new(self.ids, scene_color, antialias);
        *self = Self {
            created: self.created,
            tone_curve: self.tone_curve,
            resolve: self.resolve,
            present,
            ..fresh
        };
    }

    /// Draws with the custom tone curve whose templates start at `template`, or with the pass's own
    /// curves with `None`, from the next frame on. The pass asks for its pipelines again when the
    /// curve changes.
    pub(crate) fn set_tone_curve(&mut self, template: Option<u32>) {
        if template != self.tone_curve {
            self.tone_curve = template;
            self.pipeline = None;
            self.bloom_pipeline = None;
        }
    }

    /// True for the FXAA build of the pass, which reads the pixels around each pixel.
    pub(crate) fn fxaa(&self) -> bool {
        self.fxaa
    }

    /// Asks `pipelines` for the pipeline of the fold build whose template is `template`, which
    /// reads a multisampled depth when `multisampled` says, and returns its id.
    pub(crate) fn request_fold(
        &mut self,
        pipelines: &mut PipelineCache,
        template: u32,
        multisampled: bool,
    ) -> u32 {
        match self.fold_pipeline {
            Some((t, ms, id)) if t == template && ms == multisampled => id,
            _ => {
                let key = PipelineKey {
                    permutation: if multisampled {
                        permutation::DEPTH_MULTISAMPLED
                    } else {
                        0
                    },
                    ..pipeline(false, false, Some(template), false)
                };
                let id = pipelines.id(key);
                self.fold_pipeline = Some((template, multisampled, id));
                id
            }
        }
    }

    /// Bytes the pass may copy into a frame's arena: its settings.
    pub(crate) const UPLOAD_BYTES: usize = SETTINGS_BYTES as usize;

    /// Asks `pipelines` for the pass's pipeline, once, and for its bloom build's once a frame has
    /// `bloom`. A builder asks before it records the pipelines that its frame creates, so the list
    /// creates them with the others, at its start.
    pub(crate) fn request_pipeline(
        &mut self,
        pipelines: &mut PipelineCache,
        bloom: bool,
    ) -> Option<u32> {
        if self.pipeline.is_none() {
            self.pipeline = Some(pipelines.id(pipeline(self.fxaa, false, self.tone_curve, false)));
        }
        if bloom && self.bloom_pipeline.is_none() {
            self.bloom_pipeline =
                Some(pipelines.id(pipeline(self.fxaa, true, self.tone_curve, false)));
        }
        self.bloom_pipeline
    }

    /// The id of the pass's own pipeline, once it asked for it: the build without bloom.
    pub(crate) fn plain_pipeline(&self) -> Option<u32> {
        self.pipeline
    }

    /// Asks `pipelines`, once, for the second step's plain pipeline, which scales the first step's
    /// display color up to the canvas and sharpens it, and returns its id. It is the pass's only
    /// build with the upscale.
    pub(crate) fn request_present(&mut self, pipelines: &mut PipelineCache) -> u32 {
        let present = self
            .present
            .as_mut()
            .expect("only the plain final pass draws the second step");
        *present
            .pipeline
            .get_or_insert_with(|| pipelines.id(pipeline(false, false, None, true)))
    }

    /// Makes the pass's own GPU objects when the GPU lacks them, and binds what `inputs` reads in
    /// the pass's bind group when it is new: the color, bloom's inputs for the bloom build, the
    /// color grading table, the outline mask, the inputs of the effects that fold into the pass and
    /// the automatic exposure's texel. While the pass `draws` this frame, it uploads its settings
    /// when they changed. The frame's list made the plan's textures again when `textures_made`,
    /// which leaves an older bind group reading a texture that is gone.
    pub(crate) fn prepare(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        inputs: &FinalInputs,
        textures_made: bool,
        draws: bool,
    ) -> Result<(), RecordError> {
        if !self.created {
            Self::create_objects(list, self.ids)?;
            self.created = true;
        }
        self.folds = inputs.fold.is_some();
        // The first step's settings mark it, so it draws one texel for each render pixel.
        let flags = if self.resolve {
            self.flags | OutputUniform::RESOLVE
        } else {
            self.flags
        };
        let (settings, bound) = self.settings(inputs, flags);
        if draws {
            self.upload(list, arena, settings)?;
        }
        bind(
            list,
            self.ids,
            self.ids.group,
            &mut self.bound,
            bound,
            textures_made,
        )
    }

    /// Binds what the second step reads in its own bind group when it is new, as
    /// [`Self::prepare`] does, and uploads the second step's settings while it `draws` this frame.
    /// The second step reads display color at the canvas: the first step's tone mapped color,
    /// which it dithers when the first step read high dynamic range color. The pass's own objects
    /// come from [`Self::prepare`], which runs first.
    pub(crate) fn prepare_present(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        inputs: &FinalInputs,
        textures_made: bool,
        draws: bool,
    ) -> Result<(), RecordError> {
        let flags = OutputUniform::DISPLAY_COLOR | if self.hdr { OutputUniform::DITHER } else { 0 };
        let (settings, bound) = self.settings(inputs, flags);
        if draws {
            self.upload(list, arena, settings)?;
        }
        let present = self
            .present
            .as_mut()
            .expect("only the plain final pass draws the second step");
        bind(
            list,
            self.ids,
            present.group,
            &mut present.bound,
            bound,
            textures_made,
        )
    }

    /// The settings that the pass uploads for `inputs` with the output `flags`, and what its bind
    /// group reads.
    fn settings(&self, inputs: &FinalInputs, flags: u32) -> (FinalUniform, Bound) {
        let ids = self.ids;
        let output = Output {
            tone_mapping: inputs.tone_mapping,
            exposure: 1.0,
        };
        let mut settings = FinalUniform {
            output: OutputUniform {
                flags,
                ..output.uniform()
            },
            ..FinalUniform::default()
        };
        settings.output.set_render_size(inputs.render_size);
        if let Some(vignette) = inputs.grading.vignette {
            settings.output.flags |= OutputUniform::VIGNETTE;
            settings.vignette = vignette.uniform();
        }
        let lut = match inputs.grading.lut {
            Some((texture, scale, offset)) => {
                settings.output.flags |= OutputUniform::LUT;
                settings.lut_scale = scale;
                settings.lut_offset = offset;
                texture
            }
            None => ids.blank_lut,
        };
        let grade = match inputs.grading.grade {
            Some(texture) => {
                // The table grades display color in this pass, after the tone curve.
                settings.output.flags |= OutputUniform::GRADE;
                texture
            }
            None => ids.blank_lut,
        };
        let mask = match inputs.outline {
            Some(OutlineInputs { mask, outline }) => {
                settings.output.flags |= OutputUniform::OUTLINE;
                settings.outline = outline.uniform();
                mask
            }
            None => inputs.tone_mask.unwrap_or(ids.blank_outline),
        };
        if inputs.tone_mask.is_some() {
            settings.output.flags |= OutputUniform::UNMAPPED;
        }
        let exposure = match inputs.exposure {
            Some(texel) => {
                settings.output.flags |= OutputUniform::AUTO_EXPOSURE;
                texel
            }
            None => ids.blank_outline,
        };
        if let Some(strength) = inputs.grading.sharpen {
            settings.output.flags |= OutputUniform::SHARPEN;
            settings.sharpen[0] = strength;
        }
        let bound = Bound {
            scene_color: inputs.color,
            bloom: inputs.bloom,
            lut,
            grade,
            mask,
            fold: inputs.fold,
            exposure,
        };
        (settings, bound)
    }

    /// Uploads `settings` when the buffer holds others.
    fn upload(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        settings: FinalUniform,
    ) -> Result<(), RecordError> {
        if self.uploaded != Some(settings) {
            let (at, bytes) = arena.push(settings.as_bytes())?;
            list.push(Op::WriteBuffer, &[self.ids.settings, 0, at, bytes])?;
            self.uploaded = Some(settings);
        }
        Ok(())
    }

    /// Records the creation of the settings buffer, the blank color grading table and the blank
    /// outline texture, each of one texel, and the table's linear sampler, which clamps at the
    /// table's edges.
    fn create_objects(list: &mut DrawList, ids: FinalIds) -> Result<(), RecordError> {
        list.push(
            Op::CreateBuffer,
            &[
                ids.settings,
                SETTINGS_BYTES,
                usage::UNIFORM | usage::COPY_DST,
            ],
        )?;
        list.push(
            Op::CreateTexture,
            &[
                ids.blank_lut,
                1,
                1,
                1,
                format::RGBA8_UNORM,
                texture_usage::TEXTURE_BINDING,
                1,
                1,
                view::D3,
            ],
        )?;
        list.push(
            Op::CreateTexture,
            &[
                ids.blank_outline,
                1,
                1,
                1,
                format::RGBA8_UNORM,
                texture_usage::TEXTURE_BINDING,
                1,
                1,
                view::D2,
            ],
        )?;
        clamp_sampler(
            list,
            ids.lut_sampler,
            address::CLAMP_TO_EDGE,
            LINEAR_LEVEL,
            0.0,
            compare::NONE,
        )?;
        Ok(())
    }

    /// Records the pass inside the render pass that the render graph began into the canvas, in its
    /// bloom build with `bloom`, and in its fold build while effects fold into it.
    pub(crate) fn record(&self, list: &mut DrawList, bloom: bool) -> Result<(), RecordError> {
        let pipeline = if bloom {
            self.bloom_pipeline
        } else if self.folds {
            self.fold_pipeline.map(|(_, _, id)| id)
        } else {
            self.pipeline
        }
        .expect("the final pass asks for its pipeline before it records");
        list.push(Op::SetPipeline, &[pipeline])?;
        list.push(Op::SetBindGroup, &[0, self.ids.group, 0])?;
        list.push(Op::Draw, &[3, 1, 0, 0])?;
        Ok(())
    }

    /// Records the second step of the two-step pass inside the render pass that the render graph
    /// began into the canvas: one triangle over the canvas, with the plain pipeline that scales the
    /// first step's display color up to it.
    pub(crate) fn record_present(&self, list: &mut DrawList) -> Result<(), RecordError> {
        let (pipeline, group) = self
            .present
            .as_ref()
            .and_then(|present| Some((present.pipeline?, present.group)))
            .expect("the two-step asks for its present pipeline before it records");
        list.push(Op::SetPipeline, &[pipeline])?;
        list.push(Op::SetBindGroup, &[0, group, 0])?;
        list.push(Op::Draw, &[3, 1, 0, 0])?;
        Ok(())
    }

    /// Forgets the GPU objects, so the next frame makes them again, after the thread that draws
    /// replaced the GPU. The pipeline keeps its id, which the cache creates again.
    pub(crate) fn reset_gpu(&mut self) {
        self.created = false;
        self.uploaded = None;
        self.bound = None;
        if let Some(present) = self.present.as_mut() {
            present.bound = None;
        }
    }
}

/// Makes the bind group `group` of a pass with `ids` again when what it reads, `inputs`, is new,
/// or when the frame's list made the plan's textures again, and records what it reads in `bound`.
/// Bloom's inputs take the bloom build's layout, and the inputs of effects that fold into the pass
/// the fold build's.
fn bind(
    list: &mut DrawList,
    ids: FinalIds,
    group: u32,
    bound: &mut Option<Bound>,
    inputs: Bound,
    textures_made: bool,
) -> Result<(), RecordError> {
    if !textures_made && *bound == Some(inputs) {
        return Ok(());
    }
    let mut words = [0u32; 3 + 5 * 12];
    let mut len = 3;
    let mut entry = |binding: u32, kind: u32, id: u32, offset: u32, size: u32| {
        words[len..len + 5].copy_from_slice(&[binding, kind, id, offset, size]);
        len += 5;
    };
    entry(0, resource_kind::BUFFER, ids.settings, 0, 0);
    entry(1, resource_kind::TEXTURE, inputs.scene_color, 0, 0);
    entry(LUT_BINDING, resource_kind::TEXTURE, inputs.lut, 0, 0);
    entry(
        LUT_SAMPLER_BINDING,
        resource_kind::SAMPLER,
        ids.lut_sampler,
        0,
        0,
    );
    entry(OUTLINE_BINDING, resource_kind::TEXTURE, inputs.mask, 0, 0);
    entry(GRADE_BINDING, resource_kind::TEXTURE, inputs.grade, 0, 0);
    entry(
        EXPOSURE_BINDING,
        resource_kind::TEXTURE,
        inputs.exposure,
        0,
        0,
    );
    let layout = match (inputs.bloom, inputs.fold) {
        (Some(bloom), _) => {
            entry(2, resource_kind::BUFFER, bloom.buffer, FINAL_OFFSET, 0);
            entry(3, resource_kind::TEXTURE, bloom.base, 0, 0);
            entry(8, resource_kind::SAMPLER, bloom.sampler, 0, 0);
            bind_layout::FINAL_BLOOM
        }
        (None, Some(fold)) => {
            let bytes = crate::effects::BUFFER_BYTES as u32;
            entry(
                EFFECTS_BINDING,
                resource_kind::BUFFER,
                fold.buffer,
                0,
                bytes,
            );
            entry(
                EFFECT_DEPTH_BINDING,
                resource_kind::TEXTURE,
                fold.depth,
                0,
                0,
            );
            if fold.multisampled {
                bind_layout::FINAL_EFFECTS_DEPTH_MS
            } else {
                bind_layout::FINAL_EFFECTS
            }
        }
        (None, None) => bind_layout::FINAL,
    };
    words[0] = group;
    words[1] = layout;
    words[2] = ((len - 3) / 5) as u32;
    list.push(Op::CreateBindGroup, &words[..len])?;
    *bound = Some(inputs);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::grading::Vignette;

    const IDS: FinalIds = FinalIds {
        settings: 1,
        group: 2,
        blank_lut: 3,
        lut_sampler: 4,
        blank_outline: 6,
    };
    /// The second step's bind group.
    const PRESENT_GROUP: u32 = 7;

    /// Prepares a final pass for a scene color in `format` in the `antialias` mode, with
    /// `grading`, and returns the pipeline it asked for, the settings it uploaded and its list.
    fn prepared(
        format: u32,
        antialias: Antialias,
        grading: Grading,
    ) -> (PipelineKey, FinalUniform, DrawList) {
        let mut pass = FinalPass::new(IDS, SceneColor::from_format(format), antialias);
        let mut list = DrawList::with_capacity(256);
        let mut arena = UploadArena::default();
        arena.reset(FinalPass::UPLOAD_BYTES);
        let mut pipelines = PipelineCache::default();
        pass.request_pipeline(&mut pipelines, false);
        pass.prepare(&mut list, &mut arena, &inputs(grading), true, true)
            .unwrap();
        (pipelines.keys()[0], pass.uploaded.unwrap(), list)
    }

    /// What a pass reads at a render size of 64 by 64 pixels: the color 5, with `grading`.
    fn inputs(grading: Grading) -> FinalInputs {
        FinalInputs {
            tone_mapping: ToneMapping::default(),
            render_size: (64, 64),
            color: 5,
            bloom: None,
            grading,
            outline: None,
            tone_mask: None,
            fold: None,
            exposure: None,
        }
    }

    /// Checks that `final.wgsl` declares a flag with the value that the pass uploads.
    fn check_flag(name: &str, value: u32) {
        let shader = include_str!("../../null3d-shaders/wgsl/final.wgsl");
        let line = format!("const {name}: u32 = {value}u;");
        assert!(shader.contains(&line), "final.wgsl lacks {line}");
    }

    #[test]
    fn fxaa_takes_its_build_and_the_8_bit_path_reads_display_color() {
        check_flag("DISPLAY_COLOR", OutputUniform::DISPLAY_COLOR);
        for (scene, flags) in [
            (format::RGBA16_FLOAT, 0),
            (format::CANVAS, OutputUniform::DISPLAY_COLOR),
        ] {
            for (antialias, bits) in [
                (Antialias::Fxaa, permutation::FXAA),
                (Antialias::None, 0),
                (Antialias::Msaa, 0),
            ] {
                let (key, settings, _) = prepared(scene, antialias, Grading::default());
                assert_eq!(key.permutation, bits, "{antialias:?}");
                assert_eq!(settings.output.flags, flags, "{scene}");
                assert_eq!(settings.output.exposure, 1.0);
            }
        }
    }

    #[test]
    fn the_two_step_marks_its_first_and_second_steps() {
        check_flag("RESOLVE", OutputUniform::RESOLVE);
        check_flag("DITHER", OutputUniform::DITHER);
        let mut list = DrawList::with_capacity(256);
        let mut arena = UploadArena::default();
        // Two steps, so two settings blocks fit.
        arena.reset(2 * FinalPass::UPLOAD_BYTES);
        // The first step draws at the render size and leaves the dither to the second.
        let mut first = FinalPass::new(
            IDS,
            SceneColor::from_format(format::RGBA16_FLOAT),
            Antialias::Fxaa,
        )
        .resolve();
        let mut pipelines = PipelineCache::default();
        first.request_pipeline(&mut pipelines, false);
        first
            .prepare(
                &mut list,
                &mut arena,
                &inputs(Grading::default()),
                true,
                true,
            )
            .unwrap();
        let flags = first.uploaded.unwrap().output.flags;
        assert_ne!(flags & OutputUniform::RESOLVE, 0);
        assert_eq!(flags & OutputUniform::DITHER, 0);

        // The second step reads the first step's display color and dithers it, since the first step
        // read high dynamic range color. It draws with the pass's UPSCALE build, and binds a group
        // of its own beside the pass's, so a frame that crosses the whole canvas's scale makes none.
        let mut second = FinalPass::new(
            IDS,
            SceneColor::from_format(format::RGBA16_FLOAT),
            Antialias::Fxaa,
        )
        .presents(PRESENT_GROUP);
        let mut pipelines = PipelineCache::default();
        second.request_pipeline(&mut pipelines, false);
        let present = second.request_present(&mut pipelines);
        assert_eq!(
            pipelines.keys()[present as usize - 1].permutation,
            permutation::UPSCALE
        );
        let groups = |list: &DrawList| -> Vec<u32> {
            null3d_gpu::drawlist::decode(list.words())
                .map(|command| command.unwrap())
                .filter(|command| command.op == Op::CreateBindGroup)
                .map(|command| command.operands[0])
                .collect()
        };
        let read = inputs(Grading::default());
        let mut list = DrawList::with_capacity(256);
        second
            .prepare(&mut list, &mut arena, &read, false, false)
            .unwrap();
        second
            .prepare_present(&mut list, &mut arena, &read, false, true)
            .unwrap();
        assert_eq!(groups(&list), [IDS.group, PRESENT_GROUP]);
        let flags = second.uploaded.unwrap().output.flags;
        assert_ne!(flags & OutputUniform::DISPLAY_COLOR, 0);
        assert_ne!(flags & OutputUniform::DITHER, 0);
        assert_eq!(flags & OutputUniform::RESOLVE, 0);

        // Back at the whole canvas the pass uploads its own settings and makes no group.
        arena.reset(2 * FinalPass::UPLOAD_BYTES);
        let mut list = DrawList::with_capacity(256);
        second
            .prepare(&mut list, &mut arena, &read, false, true)
            .unwrap();
        second
            .prepare_present(&mut list, &mut arena, &read, false, false)
            .unwrap();
        assert!(groups(&list).is_empty());
        assert_eq!(second.uploaded.unwrap().output.flags, 0);
    }

    #[test]
    fn a_custom_tone_curve_takes_its_own_templates_and_asks_again_when_it_changes() {
        let mut pass = FinalPass::new(
            IDS,
            SceneColor::from_format(format::RGBA16_FLOAT),
            Antialias::Fxaa,
        );
        let mut pipelines = PipelineCache::default();
        pass.request_pipeline(&mut pipelines, true);
        pass.set_tone_curve(Some(template::CUSTOM_FIRST));
        pass.request_pipeline(&mut pipelines, true);
        let templates: Vec<u32> = pipelines.keys().iter().map(|key| key.template).collect();
        // The pass's own builds, then the curve's two builds.
        assert_eq!(
            templates,
            [
                template::FINAL,
                template::FINAL_BLOOM,
                template::CUSTOM_FIRST,
                template::CUSTOM_FIRST + 1
            ],
            "the curve's builds bind as the pass's"
        );
        pass.set_mode(
            SceneColor::from_format(format::RGBA16_FLOAT),
            Antialias::None,
        );
        pass.request_pipeline(&mut pipelines, false);
        assert_eq!(
            pipelines.keys().last().map(|key| key.template),
            Some(template::CUSTOM_FIRST)
        );
    }

    #[test]
    fn the_built_in_grading_table_sets_its_flag_and_binds_its_own_binding() {
        check_flag("GRADE", OutputUniform::GRADE);
        let bound = |list: &DrawList| {
            let groups: Vec<Vec<u32>> = null3d_gpu::drawlist::decode(list.words())
                .map(|command| command.unwrap())
                .filter(|command| command.op == Op::CreateBindGroup)
                .map(|command| command.operands.to_vec())
                .collect();
            let [group] = &groups[..] else {
                panic!("one bind group: {groups:?}");
            };
            group[3..]
                .chunks(5)
                .find(|entry| entry[0] == GRADE_BINDING)
                .expect("the group binds a grading table")[2]
        };
        let (_, settings, list) =
            prepared(format::RGBA16_FLOAT, Antialias::Msaa, Grading::default());
        assert_eq!(settings.output.flags & OutputUniform::GRADE, 0);
        assert_eq!(bound(&list), IDS.blank_lut);
        let (_, settings, list) = prepared(
            format::RGBA16_FLOAT,
            Antialias::Msaa,
            Grading {
                grade: Some(41),
                ..Grading::default()
            },
        );
        assert_ne!(settings.output.flags & OutputUniform::GRADE, 0);
        assert_eq!(bound(&list), 41);
    }

    #[test]
    fn grading_sets_its_flags_and_values_and_binds_the_table_or_the_blank_one() {
        check_flag("VIGNETTE", OutputUniform::VIGNETTE);
        check_flag("LUT", OutputUniform::LUT);
        let bound_table = |list: &DrawList| {
            let groups: Vec<Vec<u32>> = null3d_gpu::drawlist::decode(list.words())
                .map(|command| command.unwrap())
                .filter(|command| command.op == Op::CreateBindGroup)
                .map(|command| command.operands.to_vec())
                .collect();
            let [group] = &groups[..] else {
                panic!("one bind group: {groups:?}");
            };
            let entry = group[3..]
                .chunks(5)
                .find(|entry| entry[0] == LUT_BINDING)
                .expect("the group binds a table");
            entry[2]
        };
        let (_, settings, list) =
            prepared(format::RGBA16_FLOAT, Antialias::Msaa, Grading::default());
        assert_eq!(settings.output.flags, 0);
        assert_eq!(bound_table(&list), IDS.blank_lut);

        let scale = [0.5, 0.25, 0.125, 0.8];
        let offset = [0.01, 0.02, 0.03, 0.0];
        let grading = Grading {
            lut: Some((40, scale, offset)),
            grade: None,
            vignette: Some(Vignette {
                intensity: 0.7,
                size: 1.2,
                falloff: 2.0,
                roundness: 0.5,
            }),
            sharpen: None,
            ..Grading::default()
        };
        let (_, settings, list) = prepared(format::CANVAS, Antialias::Msaa, grading);
        assert_eq!(
            settings.output.flags,
            OutputUniform::DISPLAY_COLOR | OutputUniform::VIGNETTE | OutputUniform::LUT
        );
        assert_eq!(settings.vignette, [0.7, 1.2, 2.0, 0.5]);
        assert_eq!((settings.lut_scale, settings.lut_offset), (scale, offset));
        assert_eq!(bound_table(&list), 40);
    }

    #[test]
    fn the_sharpening_sets_its_flag_and_its_strength() {
        check_flag("SHARPEN", OutputUniform::SHARPEN);
        let (_, settings, _) = prepared(
            format::RGBA16_FLOAT,
            Antialias::Msaa,
            Grading {
                sharpen: Some(0.5),
                ..Grading::default()
            },
        );
        assert_ne!(settings.output.flags & OutputUniform::SHARPEN, 0);
        assert_eq!(settings.sharpen, [0.5, 0.0, 0.0, 0.0]);
        let (_, settings, _) = prepared(format::RGBA16_FLOAT, Antialias::Msaa, Grading::default());
        assert_eq!(settings.output.flags & OutputUniform::SHARPEN, 0);
        assert_eq!(settings.sharpen, [0.0; 4]);
    }
}
