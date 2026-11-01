//! The subsurface blur of skin: light that enters skin leaves it a few millimetres away, redder
//! the further it went, so a shadow's edge, the light beside a nose and the pores of a skin map
//! soften. The render graph's subsurface passes run after the transparent passes, before the custom
//! effects (see [`crate::frame_graph`]):
//!
//! 1. The skin pass draws the objects whose material has a scatter radius again, from the
//!    subsurface view (see [`crate::view::ViewId::SUBSURFACE`]), with the camera's lights,
//!    shadows, ambient occlusion and environment. Its builds of the standard material write only
//!    the diffuse light that scatters, after the fog, as the camera's opaque pass added it to the
//!    scene color, into a target of the render size of one sample, with a depth target of its own.
//!    Each texel holds the view distance in alpha, and each channel's scatter distance in the low
//!    bits of its float (`null3d::subsurface`), so the steps need no material table.
//! 2. The across step blurs that light along the rows, into a target of half floats.
//! 3. The down step blurs that along the columns, and writes the scene's color plus the blurred
//!    light less the sharp light, where the skin is the surface in front, into a copy that the
//!    custom effects, depth of field, bloom and the final pass read in place of the scene color.
//!
//! Each tap's weight is Burley's diffusion profile of each channel's scatter distance, at the
//! distance in the world between the tap's surface and the pixel's. The steps are Jimenez et al.'s
//! separable subsurface scattering with that profile. Their settings live in one uniform buffer, a
//! block per step, which a frame writes and uploads only when the taps, the camera's lens, the
//! canvas or the render scale changed.

use null3d_gpu::drawlist::{
    DrawList, Op, buffer_usage as usage, format, layout as bind_layout, permutation, resource_kind,
    state_flags, template,
};

use crate::bloom::bytes_of;
use crate::camera::Mat4;
use crate::frame::{RecordError, UploadArena};
use crate::graph::{RenderScale, Size};
use crate::pipelines::{DepthBias, DrawKey, PipelineCache, PipelineKey};

/// The steps: across, then down.
pub(crate) const STEPS: usize = 2;

/// The format of the skin pass's target: 32-bit floats, whose low bits hold the scatter
/// distances.
pub(crate) const SKIN_FORMAT: u32 = format::RGBA32_FLOAT;

/// The format of the across step's target: the blurred light, with the view distance in alpha.
pub(crate) const ACROSS_FORMAT: u32 = format::RGBA16_FLOAT;

/// The format of the down step's target: HDR color, as the scene color holds it.
pub(crate) const FORMAT: u32 = format::RGBA16_FLOAT;

/// The tap counts of each step that the quality setting takes, from the lightest. Each count is
/// odd, so the pixel itself stands at the middle of its taps.
pub const TAP_COUNTS: [u32; 3] = [11, 17, 25];

/// Bytes between two steps' blocks in the uniform buffer, a multiple of the offset alignment that
/// bind groups need for a buffer range.
const BLOCK: usize = 256;

/// Bytes of the uniform buffer: a block for each step.
const BUFFER_BYTES: usize = STEPS * BLOCK;

/// The permutation bits that the skin builds keep of a pair's own: what places and colors its
/// vertices, its mask's test, its shadows, its maps' frame and the light through it. Alpha to
/// coverage and the alpha hash test their alpha as a plain mask, as on a target of one sample.
const SKIN_BITS: u32 = permutation::VERTEX_COLOR
    | permutation::ALPHA_MASK
    | permutation::RECEIVE_SHADOWS
    | permutation::SKIN
    | permutation::MORPH
    | permutation::VERTEX_TANGENT
    | permutation::TRANSLUCENCY;

/// The key of the pipeline that draws a pair in the skin pass, or `None` for a pair that takes no
/// blur: a material other than the standard one, one that blends or lets light through, or one
/// whose pipeline reads its instances by index. It draws the pair's faces with its depth bias,
/// testing and writing the skin pass's own depth.
pub(crate) const fn skin_key(pipeline: DrawKey) -> Option<DrawKey> {
    let template = match pipeline.template {
        template::INSTANCED_LIT => template::SUBSURFACE,
        template::INSTANCED_STANDARD_MAPS => template::SUBSURFACE_MAPS,
        _ => return None,
    };
    if pipeline.sorts() || pipeline.permutation & permutation::INSTANCE_INDEX != 0 {
        return None;
    }
    let faces = state_flags::CULL_NONE | state_flags::CULL_FRONT;
    Some(DrawKey {
        template,
        permutation: pipeline.permutation & SKIN_BITS,
        vertex_format: pipeline.vertex_format,
        state: pipeline.state & faces,
        bias: pipeline.bias,
    })
}

/// What a frame's subsurface steps draw with: the taps of each step, and the camera's projection
/// and its inverse.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SubsurfaceFrame {
    pub taps: u32,
    pub projection: Mat4,
    pub inverse_projection: Mat4,
}

/// A step's block, as `subsurface.wgsl` lays out its `Step` struct.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct Block {
    corner: [f32; 4],
    lens: [f32; 4],
    offset: [f32; 4],
    rows: [f32; 4],
    depth: [f32; 4],
    taps: [f32; 4],
}

const _: () = assert!(std::mem::size_of::<Block>() <= BLOCK);

/// The GPU objects of the steps, which the frame builder's id ranges set.
#[derive(Clone, Copy, Debug)]
pub(crate) struct SubsurfaceIds {
    /// The uniform buffer of both steps' blocks.
    pub(crate) buffer: u32,
    /// The bind group of each step, from this id on.
    pub(crate) first_group: u32,
}

/// The textures that the steps read: the skin pass's target, the across step's, and the scene's
/// color and depth.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct SubsurfaceSources {
    pub(crate) skin: u32,
    pub(crate) across: u32,
    pub(crate) color: u32,
    pub(crate) depth: u32,
}

/// The pipeline of step `step`: one triangle into its target.
const fn pipeline(step: usize, multisampled: bool) -> PipelineKey {
    let (template, color_format) = match step {
        0 => (template::SUBSURFACE_BLUR, ACROSS_FORMAT),
        _ if multisampled => (template::SUBSURFACE_COMPOSITE_MS, FORMAT),
        _ => (template::SUBSURFACE_COMPOSITE, FORMAT),
    };
    PipelineKey {
        template,
        permutation: 0,
        vertex_format: 0,
        color_format,
        depth_format: format::NONE,
        samples: 1,
        state: state_flags::CULL_NONE,
        bias: DepthBias::NONE,
    }
}

/// The terms of an inverse projection that give a depth value's view-space z: the projection's
/// third and fourth rows do not depend on x and y, so neither do the inverse's.
fn depth_terms(inverse: &Mat4) -> [f32; 4] {
    [inverse[10], inverse[14], inverse[11], inverse[15]]
}

/// What a frame's blocks depend on. The frame writes them again only when one changes.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Staged {
    canvas: (u32, u32),
    scale: RenderScale,
    frame: SubsurfaceFrame,
}

/// The steps' GPU objects, their settings and what the GPU holds of them.
#[derive(Debug)]
pub(crate) struct SubsurfacePass {
    ids: SubsurfaceIds,
    /// True when the scene's depth target is multisampled, so the down step reads sample 0.
    multisampled: bool,
    /// True on WebGL2, which counts rows from the bottom.
    rows_from_bottom: bool,
    pipelines: [Option<u32>; STEPS],
    created: bool,
    staged: [u8; BUFFER_BYTES],
    staged_for: Option<Staged>,
    /// The textures that the steps' bind groups read, before the first group exists the default.
    bound: Option<SubsurfaceSources>,
}

impl SubsurfacePass {
    /// The steps, with GPU objects from `ids`, for a scene depth of `samples`, on WebGL2 with
    /// `rows_from_bottom`.
    pub(crate) fn new(ids: SubsurfaceIds, samples: u32, rows_from_bottom: bool) -> Self {
        Self {
            ids,
            multisampled: samples > 1,
            rows_from_bottom,
            pipelines: [None; STEPS],
            created: false,
            staged: [0; BUFFER_BYTES],
            staged_for: None,
            bound: None,
        }
    }

    /// Bytes a frame may copy into its arena: the whole uniform buffer.
    pub(crate) const UPLOAD_BYTES: usize = BUFFER_BYTES;

    /// Asks `pipelines` for the steps' pipelines, once.
    pub(crate) fn request_pipelines(&mut self, pipelines: &mut PipelineCache) {
        for (step, slot) in self.pipelines.iter_mut().enumerate() {
            if slot.is_none() {
                *slot = Some(pipelines.id(pipeline(step, self.multisampled)));
            }
        }
    }

    /// The ids of the steps' pipelines that the pass asked for.
    pub(crate) fn pipeline_ids(&self) -> impl Iterator<Item = u32> + '_ {
        self.pipelines.iter().flatten().copied()
    }

    /// Makes the buffer when the GPU lacks it, writes and uploads the blocks for `frame` when an
    /// input changed, and binds the steps to `sources` when they changed or the frame made the
    /// plan's textures again.
    pub(crate) fn prepare(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        (canvas, scale): ((u32, u32), RenderScale),
        frame: SubsurfaceFrame,
        sources: SubsurfaceSources,
        textures_made: bool,
    ) -> Result<(), RecordError> {
        let ids = self.ids;
        if !self.created {
            list.push(
                Op::CreateBuffer,
                &[
                    ids.buffer,
                    BUFFER_BYTES as u32,
                    usage::UNIFORM | usage::COPY_DST,
                ],
            )?;
            self.created = true;
        }
        let inputs = Staged {
            canvas,
            scale,
            frame,
        };
        if self.staged_for != Some(inputs) {
            self.stage(inputs);
            let (at, bytes) = arena.push(&self.staged)?;
            list.push(Op::WriteBuffer, &[ids.buffer, 0, at, bytes])?;
            self.staged_for = Some(inputs);
        }
        if textures_made || self.bound != Some(sources) {
            self.bind(list, sources)?;
            self.bound = Some(sources);
        }
        Ok(())
    }

    /// Records each step's bind group: the across step reads the skin pass's target, and the down
    /// step reads it with the across step's target and the scene's color and depth.
    fn bind(&self, list: &mut DrawList, sources: SubsurfaceSources) -> Result<(), RecordError> {
        let ids = self.ids;
        let block = |step: usize| {
            [
                0,
                resource_kind::BUFFER,
                ids.buffer,
                (step * BLOCK) as u32,
                std::mem::size_of::<Block>() as u32,
            ]
        };
        let texture = |binding: u32, id: u32| [binding, resource_kind::TEXTURE, id, 0, 0];
        let down_layout = if self.multisampled {
            bind_layout::SUBSURFACE_COMPOSITE_MS
        } else {
            bind_layout::SUBSURFACE_COMPOSITE
        };
        let steps: [(u32, &[[u32; 5]]); STEPS] = [
            (
                bind_layout::SUBSURFACE_BLUR,
                &[block(0), texture(1, sources.skin)],
            ),
            (
                down_layout,
                &[
                    block(1),
                    texture(1, sources.skin),
                    texture(2, sources.across),
                    texture(3, sources.color),
                    texture(4, sources.depth),
                ],
            ),
        ];
        let mut words = [0u32; 3 + 5 * 5];
        for (step, (layout, entries)) in steps.into_iter().enumerate() {
            words[..3].copy_from_slice(&[
                ids.first_group + step as u32,
                layout,
                entries.len() as u32,
            ]);
            for (place, entry) in entries.iter().enumerate() {
                words[3 + 5 * place..][..5].copy_from_slice(entry);
            }
            list.push(Op::CreateBindGroup, &words[..3 + 5 * entries.len()])?;
        }
        Ok(())
    }

    /// Writes both steps' blocks into the staging copy.
    fn stage(&mut self, inputs: Staged) {
        let Staged {
            canvas,
            scale,
            frame,
        } = inputs;
        let p = &frame.projection;
        let (width, height) = Size::Full.viewport(canvas, scale);
        let extent = Size::Full.extent(canvas);
        // WebGL2 draws the corner into a texture's last rows.
        let first_row = if self.rows_from_bottom {
            extent.1.saturating_sub(height)
        } else {
            0
        };
        let mut block = Block {
            corner: [
                0.0,
                first_row as f32,
                width.max(1) as f32 - 1.0,
                (first_row + height.max(1)) as f32 - 1.0,
            ],
            lens: [p[0], p[5], p[8], p[9]],
            offset: [p[12], p[13], p[11], p[15]],
            rows: [
                if self.rows_from_bottom { -1.0 } else { 1.0 },
                0.0,
                0.0,
                0.0,
            ],
            depth: depth_terms(&frame.inverse_projection),
            taps: [0.0; 4],
        };
        let taps = frame.taps.max(3) as f32;
        for step in 0..STEPS {
            block.taps = if step == 0 {
                [1.0, 0.0, taps, width as f32]
            } else {
                [0.0, 1.0, taps, height as f32]
            };
            self.staged[step * BLOCK..][..std::mem::size_of::<Block>()]
                .copy_from_slice(bytes_of(&block));
        }
    }

    /// Records step `step` inside the render pass that the render graph began into its target,
    /// which also limits it to the drawn corner.
    pub(crate) fn record(&self, list: &mut DrawList, step: usize) -> Result<(), RecordError> {
        let pipeline = self.pipelines[step].expect("the steps ask for their pipelines first");
        list.push(Op::SetPipeline, &[pipeline])?;
        list.push(
            Op::SetBindGroup,
            &[0, self.ids.first_group + step as u32, 0],
        )?;
        list.push(Op::Draw, &[3, 1, 0, 0])?;
        Ok(())
    }

    /// Forgets the GPU objects, so the next frame makes them again, after the thread that draws
    /// replaced the GPU. The pipelines keep their ids, which the cache creates again.
    pub(crate) fn reset_gpu(&mut self) {
        self.created = false;
        self.staged_for = None;
        self.bound = None;
    }
}

#[cfg(test)]
mod tests {
    use null3d_gpu::drawlist::{decode, vertex};

    use super::*;

    fn key(template: u32, permutation: u32, state: u32) -> DrawKey {
        DrawKey {
            template,
            permutation,
            vertex_format: vertex::UV0,
            state,
            bias: DepthBias::from_polygon_offset(1.0, 1.0),
        }
    }

    #[test]
    fn the_skin_pass_draws_the_standard_materials_with_their_own_builds() {
        let lit = key(
            template::INSTANCED_LIT,
            permutation::VERTEX_COLOR
                | permutation::ALPHA_MASK
                | permutation::ALPHA_HASH
                | permutation::RECEIVE_SHADOWS
                | permutation::TRANSLUCENCY,
            state_flags::CULL_NONE | state_flags::ALPHA_TO_COVERAGE,
        );
        let skin = skin_key(lit).unwrap();
        assert_eq!(skin.template, template::SUBSURFACE);
        // A mask tests its alpha by its cutoff on a target of one sample, and the skin pass
        // writes and tests depth of its own.
        assert_eq!(
            skin.permutation,
            permutation::VERTEX_COLOR
                | permutation::ALPHA_MASK
                | permutation::RECEIVE_SHADOWS
                | permutation::TRANSLUCENCY
        );
        assert_eq!(skin.state, state_flags::CULL_NONE);
        assert!(skin.writes_depth());
        assert_eq!(
            (skin.vertex_format, skin.bias),
            (lit.vertex_format, lit.bias)
        );
        let maps = key(
            template::INSTANCED_STANDARD_MAPS,
            permutation::VERTEX_TANGENT,
            0,
        );
        let skin = skin_key(maps).unwrap();
        assert_eq!(skin.template, template::SUBSURFACE_MAPS);
        assert_eq!(skin.permutation, permutation::VERTEX_TANGENT);
        // Blended surfaces, surfaces that let light through, and other materials take no blur.
        assert_eq!(
            skin_key(key(template::INSTANCED_LIT, 0, state_flags::BLEND_NORMAL)),
            None
        );
        let glass = key(template::INSTANCED_LIT, permutation::TRANSMISSION, 0);
        assert_eq!(skin_key(glass), None);
        assert_eq!(skin_key(key(template::INSTANCED_UNLIT, 0, 0)), None);
        assert_eq!(skin_key(key(template::CUSTOM_FIRST, 0, 0)), None);
    }

    #[test]
    fn the_shader_lays_out_the_block_as_the_core_writes_it() {
        let shader = include_str!("../../null3d-shaders/wgsl/subsurface.wgsl");
        let fields = ["corner", "lens", "offset", "rows", "depth", "taps"];
        let mut at = 0;
        for field in fields {
            let found = shader[at..]
                .find(&format!("    {field}: vec4f,"))
                .unwrap_or_else(|| {
                    panic!("subsurface.wgsl lacks {field} after the fields before it")
                });
            at += found + 1;
        }
        assert_eq!(std::mem::size_of::<Block>(), fields.len() * 16);
    }

    fn frame() -> SubsurfaceFrame {
        let projection = crate::camera::Lens::Perspective(crate::camera::Perspective {
            fov_degrees: 50.0,
            near: 0.1,
            far: 100.0,
        })
        .projection(16.0 / 9.0);
        SubsurfaceFrame {
            taps: 17,
            projection,
            inverse_projection: crate::camera::invert(&projection).unwrap(),
        }
    }

    fn ops(list: &DrawList) -> Vec<Op> {
        decode(list.words()).map(|c| c.unwrap().op).collect()
    }

    #[test]
    fn a_moving_camera_only_uploads_the_blocks() {
        let ids = SubsurfaceIds {
            buffer: 1,
            first_group: 3,
        };
        let mut pass = SubsurfacePass::new(ids, 1, true);
        let mut pipelines = PipelineCache::default();
        pass.request_pipelines(&mut pipelines);
        assert_eq!(pass.pipeline_ids().count(), STEPS);
        let mut list = DrawList::with_capacity(4096);
        let mut arena = UploadArena::default();
        let sources = SubsurfaceSources {
            skin: 10,
            across: 11,
            color: 12,
            depth: 13,
        };
        let mut run = |pass: &mut SubsurfacePass, list: &mut DrawList, frame: SubsurfaceFrame| {
            list.clear();
            arena
                .reset(SubsurfacePass::UPLOAD_BYTES)
                .expect("room for the test's uploads");
            let size = ((1920, 1080), RenderScale::FULL);
            pass.prepare(list, &mut arena, size, frame, sources, false)
                .unwrap();
        };
        run(&mut pass, &mut list, frame());
        let groups: Vec<u32> = decode(list.words())
            .map(|c| c.unwrap())
            .filter(|c| c.op == Op::CreateBindGroup)
            .map(|c| c.operands[1])
            .collect();
        assert_eq!(
            groups,
            [
                bind_layout::SUBSURFACE_BLUR,
                bind_layout::SUBSURFACE_COMPOSITE
            ],
            "a depth of one sample takes the plain layout"
        );
        run(&mut pass, &mut list, frame());
        assert!(list.is_empty(), "nothing changed, so nothing records");
        let mut moved = frame();
        moved.projection[5] *= 1.2;
        run(&mut pass, &mut list, moved);
        assert_eq!(ops(&list), [Op::WriteBuffer], "a new lens only uploads");
    }

    #[test]
    fn webgl2_corners_lie_in_the_last_rows_of_the_targets() {
        let ids = SubsurfaceIds {
            buffer: 1,
            first_group: 3,
        };
        let block_of = |rows_from_bottom: bool| {
            let mut pass = SubsurfacePass::new(ids, 1, rows_from_bottom);
            let half = RenderScale::from_thousandths(500);
            pass.stage(Staged {
                canvas: (200, 100),
                scale: half,
                frame: frame(),
            });
            let words = &pass.staged[..std::mem::size_of::<Block>()];
            let floats: Vec<f32> = words
                .chunks(4)
                .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
                .collect();
            floats
        };
        let top = block_of(false);
        assert_eq!(&top[..4], &[0.0, 0.0, 99.0, 49.0]);
        assert_eq!(top[12], 1.0, "rows count down the image on WebGPU");
        let bottom = block_of(true);
        assert_eq!(&bottom[..4], &[0.0, 50.0, 99.0, 99.0]);
        assert_eq!(bottom[12], -1.0);
        // The across step steps along the rows over the corner's width, the down step along the
        // columns over its height.
        assert_eq!(&top[20..24], &[1.0, 0.0, 17.0, 100.0]);
    }
}
