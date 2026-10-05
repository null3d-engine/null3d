//! The final pass: one triangle over the canvas, which reads the scene color and writes the canvas
//! (see [`crate::output`]). On the HDR path it applies the tone mapping, encodes sRGB and dithers.
//! The scene color holds exposed color already, so the pass's exposure is 1. In the FXAA mode it smooths edges first. On the 8-bit path the scene shaders
//! did the output transform, and the pass runs when the scene has one sample per pixel or the
//! render scale can drop: it copies the scene color, or runs FXAA on it. Below the whole canvas's
//! render scale, it scales the scene's corner of the scene color up to the canvas instead. With
//! bloom (see [`crate::bloom`]), the pass draws with its bloom build, which blends the base level of
//! bloom's chain into the scene color before the output transform. While objects are outlined, the pass paints the
//! outline's line around them after the output transform (see [`crate::outline`]). Last, it grades
//! the canvas color with a color grading table and the vignette while the sketch sets them (see
//! [`crate::grading`]). Each frame builder owns one, with GPU object ids from its own ranges, and
//! its pipelines come from the builder's pipeline cache like every other.

use null3d_gpu::drawlist::{
    DrawList, Op, address, buffer_usage as usage, compare, filter, format, layout as bind_layout,
    permutation, resource_kind, state_flags, template, texture_usage, view,
};

use crate::bloom::{BloomIds, FINAL_OFFSET};
use crate::frame::{RecordError, UploadArena};
use crate::grading::Grading;
use crate::outline::Outline;
use crate::output::{Antialias, Output, OutputUniform, SceneColor, ToneMapping};
use crate::pipelines::{DepthBias, PipelineCache, PipelineKey};

/// Bytes of the final pass's settings: the output settings, then the vignette's vector, the color
/// grading table's two and the outline's two.
const SETTINGS_BYTES: u32 = 96;
/// The bindings of the color grading table and of its sampler in the final pass's group.
const LUT_BINDING: u32 = 9;
const LUT_SAMPLER_BINDING: u32 = 10;
/// The binding of the outline mask in the final pass's group. The table's sampler reads it.
const OUTLINE_BINDING: u32 = 11;

/// The final pass's settings, as `final.wgsl`'s `Settings` block lays them out.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct FinalUniform {
    output: OutputUniform,
    /// The vignette's offset and darkness, then two spare values.
    vignette: [f32; 4],
    /// The scale that places a color in the color grading table, then the table's intensity.
    lut_scale: [f32; 4],
    /// The offset that places a color in the table, then a spare value.
    lut_offset: [f32; 4],
    /// The outline's visible color and width, then its hidden color and whether it draws (see
    /// [`Outline::uniform`]).
    outline: [[f32; 4]; 2],
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
/// blends in bloom's base level.
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
    /// The flags of the pass's settings: whether the scene color holds display color.
    flags: u32,
    /// The pipeline's id in the builder's cache, once the pass has asked for it.
    pipeline: Option<u32>,
    /// The bloom build's pipeline's id, once a frame with bloom asked for it.
    bloom_pipeline: Option<u32>,
    created: bool,
    /// The settings the buffer holds, or `None` before the first upload.
    uploaded: Option<FinalUniform>,
    /// The scene color texture that the bind group reads, with bloom's inputs for the bloom
    /// build, the color grading table and the outline mask, or `None` before the group exists.
    bound: Option<(u32, Option<BloomInputs>, u32, u32)>,
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
            self.pipeline = Some(pipelines.id(pipeline(self.fxaa, false)));
        }
        if bloom && self.bloom_pipeline.is_none() {
            self.bloom_pipeline = Some(pipelines.id(pipeline(self.fxaa, true)));
        }
        self.bloom_pipeline
    }

    /// Makes the pass's own GPU objects when the GPU lacks them, uploads the settings for
    /// `tone_mapping`, the scene's size in pixels, `render_size`, `grading` and `outline` when they
    /// changed, and binds the scene color texture `scene_color`, with `bloom`'s inputs for the bloom
    /// build, the color grading table and the outline mask, when they are new. The frame's list made
    /// the plan's textures again when `textures_made`, which leaves an older bind group reading a
    /// texture that is gone.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn prepare(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        tone_mapping: ToneMapping,
        render_size: (u32, u32),
        scene_color: u32,
        bloom: Option<BloomInputs>,
        grading: Grading,
        outline: Option<OutlineInputs>,
        textures_made: bool,
    ) -> Result<(), RecordError> {
        let ids = self.ids;
        if !self.created {
            Self::create_objects(list, ids)?;
            self.created = true;
        }
        let output = Output {
            tone_mapping,
            exposure: 1.0,
        };
        let mut settings = FinalUniform {
            output: OutputUniform {
                flags: self.flags,
                ..output.uniform()
            },
            ..FinalUniform::default()
        };
        settings.output.set_render_size(render_size);
        if let Some(vignette) = grading.vignette {
            settings.output.flags |= OutputUniform::VIGNETTE;
            settings.vignette = [vignette.offset, vignette.darkness, 0.0, 0.0];
        }
        let lut = match grading.lut {
            Some((texture, scale, offset)) => {
                settings.output.flags |= OutputUniform::LUT;
                settings.lut_scale = scale;
                settings.lut_offset = offset;
                texture
            }
            None => ids.blank_lut,
        };
        let mask = match outline {
            Some(OutlineInputs { mask, outline }) => {
                settings.output.flags |= OutputUniform::OUTLINE;
                settings.outline = outline.uniform();
                mask
            }
            None => ids.blank_outline,
        };
        if self.uploaded != Some(settings) {
            let (at, bytes) = arena.push(settings.as_bytes())?;
            list.push(Op::WriteBuffer, &[ids.settings, 0, at, bytes])?;
            self.uploaded = Some(settings);
        }
        let inputs = (scene_color, bloom, lut, mask);
        if textures_made || self.bound != Some(inputs) {
            let mut words = [0u32; 3 + 5 * 12];
            let mut len = 3;
            let mut entry = |binding: u32, kind: u32, id: u32, offset: u32, size: u32| {
                words[len..len + 5].copy_from_slice(&[binding, kind, id, offset, size]);
                len += 5;
            };
            entry(0, resource_kind::BUFFER, ids.settings, 0, 0);
            entry(1, resource_kind::TEXTURE, scene_color, 0, 0);
            entry(LUT_BINDING, resource_kind::TEXTURE, lut, 0, 0);
            entry(
                LUT_SAMPLER_BINDING,
                resource_kind::SAMPLER,
                ids.lut_sampler,
                0,
                0,
            );
            entry(OUTLINE_BINDING, resource_kind::TEXTURE, mask, 0, 0);
            let layout = match bloom {
                None => bind_layout::FINAL,
                Some(bloom) => {
                    entry(2, resource_kind::BUFFER, bloom.buffer, FINAL_OFFSET, 0);
                    entry(3, resource_kind::TEXTURE, bloom.base, 0, 0);
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
        list.push(
            Op::CreateSampler,
            &[
                ids.lut_sampler,
                address::CLAMP_TO_EDGE,
                address::CLAMP_TO_EDGE,
                address::CLAMP_TO_EDGE,
                filter::LINEAR,
                filter::LINEAR,
                filter::NEAREST,
                0f32.to_bits(),
                0f32.to_bits(),
                compare::NONE,
                1,
            ],
        )?;
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
    use crate::grading::Vignette;

    const IDS: FinalIds = FinalIds {
        settings: 1,
        group: 2,
        blank_lut: 3,
        lut_sampler: 4,
        blank_outline: 6,
    };

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
        pass.prepare(
            &mut list,
            &mut arena,
            ToneMapping::default(),
            (64, 64),
            5,
            None,
            grading,
            None,
            true,
        )
        .unwrap();
        (pipelines.keys()[0], pass.uploaded.unwrap(), list)
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
            vignette: Some(Vignette {
                offset: 1.2,
                darkness: 0.7,
            }),
        };
        let (_, settings, list) = prepared(format::CANVAS, Antialias::Msaa, grading);
        assert_eq!(
            settings.output.flags,
            OutputUniform::DISPLAY_COLOR | OutputUniform::VIGNETTE | OutputUniform::LUT
        );
        assert_eq!(settings.vignette, [1.2, 0.7, 0.0, 0.0]);
        assert_eq!((settings.lut_scale, settings.lut_offset), (scale, offset));
        assert_eq!(bound_table(&list), 40);
    }
}
