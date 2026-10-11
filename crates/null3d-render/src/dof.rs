//! Depth of field: the blur of a camera lens, which keeps sharp only what lies near the focus
//! distance. The render graph's depth of field passes run after the custom effects and before
//! bloom (see [`crate::frame_graph`]), so bloom glows from the blurred image, and the final pass
//! tone maps it:
//!
//! 1. The setup step reads four pixels of the scene's color and depth for each texel of a target
//!    at half the render size. It finds each pixel's circle of confusion from its depth, through
//!    the thin lens formula, and writes their color with the blur size that wins.
//! 2. The gather blurs that target over a disk or polygon of taps, the bokeh shape, with the near
//!    and the far field apart. A blurred object in front spreads over a sharp one behind it, and a
//!    sharp object never spreads into the blurred background, so no halo shows at depth edges.
//! 3. The tent step smooths the gather with a small filter.
//! 4. The composite step mixes the result into the scene's color at the render size, by each
//!    pixel's own blur size, into a target that bloom and the final pass read.
//!
//! This is the gather of KinoBokeh, which Unity's post-processing stack ships, with the lens of a
//! camera: a focal length in millimetres on a full-frame sensor, 24 mm tall, an aperture as an
//! f-number, and a focus distance in world units, taken as metres. The blur size of a point at
//! distance `d` is the circle of confusion on the sensor, as a share of the sensor's height:
//! `f² / (N (s - f) h) × (1 - s / d)`, with focal length `f`, f-number `N`, focus distance `s` and
//! sensor height `h`. Behind the focus it grows toward its far value; in front it grows without
//! bound, so the largest blur size caps it.
//!
//! The steps' settings live in one uniform buffer, a block per step, which a frame writes and
//! uploads only when a setting, the camera's lens, the canvas, the render scale or the focus moved.
//! The gather's taps live in its block, so a new tap count or bokeh shape makes no GPU object.

use null3d_gpu::drawlist::{
    DrawList, Op, address, buffer_usage as usage, compare, filter, format, layout as bind_layout,
    resource_kind, state_flags, template,
};

use crate::bloom::{CornerMap, bytes_of};
use crate::camera::Mat4;
use crate::frame::{RecordError, UploadArena};
use crate::graph::{RenderScale, Size};
use crate::pipelines::{DepthBias, PipelineCache, PipelineKey};

/// The steps: the setup, the gather, the tent and the composite.
pub(crate) const STEPS: usize = 4;

/// The format of the half-size targets: color with the signed blur size in alpha.
pub(crate) const HALF_FORMAT: u32 = format::RGBA16_FLOAT;

/// The format of the composite's target: HDR color, as the scene color holds it.
pub(crate) const FORMAT: u32 = format::RGBA16_FLOAT;

/// The size of the setup's, the gather's and the tent's targets.
pub(crate) const HALF: Size = Size::HALF;

/// The height of a full-frame sensor, 36 by 24 mm, in millimetres.
pub const SENSOR_HEIGHT_MM: f32 = 24.0;

/// The tap counts of the gather that the quality setting takes, from the lightest: rings of 5 or
/// 7 more taps each around a center tap, as Unity's disk kernels have.
pub const TAP_COUNTS: [u32; 4] = [16, 22, 43, 71];

/// Room for the most taps in the gather's block: two in each of its vectors.
const KERNEL_VECTORS: usize = 36;

/// Bytes between two steps' blocks in the uniform buffer, a multiple of the offset alignment that
/// bind groups need for a buffer range.
const BLOCK: usize = 768;

/// Bytes of the uniform buffer: a block for each step.
const BUFFER_BYTES: usize = STEPS * BLOCK;

/// How depth of field looks: the lens and the most blur.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Dof {
    /// The distance along the view that is sharp, in world units.
    pub focus_distance: f32,
    /// A point in the world whose distance along the view each frame focuses at, in place of
    /// `focus_distance`.
    pub focus_point: Option<[f64; 3]>,
    /// The aperture as an f-number: the focal length over the lens opening.
    pub aperture: f32,
    /// The focal length in millimetres, or 0 to take the camera's field of view on a full-frame
    /// sensor.
    pub focal_length: f32,
    /// The largest blur radius, as a share of the image's height.
    pub max_blur: f32,
    /// The aperture's blades: 0 for a round bokeh, or from 3 for a polygon of that many sides.
    pub blades: u32,
}

impl Default for Dof {
    fn default() -> Self {
        Self {
            focus_distance: 10.0,
            focus_point: None,
            aperture: 2.8,
            focal_length: 0.0,
            max_blur: 0.02,
            blades: 0,
        }
    }
}

/// The focal length, in millimetres, of a lens with a vertical field of view of `fov_degrees` on a
/// full-frame sensor.
pub fn focal_length_of_fov(fov_degrees: f32) -> f32 {
    SENSOR_HEIGHT_MM / 2.0 / (fov_degrees.to_radians() / 2.0).tan()
}

/// A thin lens in one frame: the blur size of a point at distance `d` along the view is
/// `far × (1 - focus / d)`, as a share of the image's height.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Lens {
    /// The blur size far behind the focus, where it levels off.
    pub far: f32,
    /// The distance that is sharp.
    pub focus: f32,
}

impl Lens {
    /// The lens of focal length `focal_length` in millimetres, f-number `aperture`, focused at
    /// `focus` world units, taken as metres. A lens cannot focus closer than its focal length, so
    /// the focus keeps beyond it.
    pub fn new(focal_length: f32, aperture: f32, focus: f32) -> Self {
        let f = focal_length.max(1.0) / 1000.0;
        let focus = focus.max(f * 1.01);
        let n = aperture.max(0.1);
        Self {
            far: f * f / (n * (focus - f) * (SENSOR_HEIGHT_MM / 1000.0)),
            focus,
        }
    }

    /// The signed blur size of a point at `distance` along the view: below 0 in front of the
    /// focus, above 0 behind it, as a share of the image's height.
    pub fn blur(&self, distance: f32) -> f32 {
        self.far * (1.0 - self.focus / distance.max(1e-6))
    }
}

/// What a frame's depth of field draws with: the settings, the lens of the frame's camera and
/// focus, the camera's near and far distances, the inverse of its projection, and the gather's
/// taps.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DofFrame {
    pub dof: Dof,
    pub lens: Lens,
    pub near: f32,
    pub far: f32,
    pub inverse_projection: Mat4,
    pub taps: u32,
}

impl DofFrame {
    /// The largest blur that the frame can show, as a share of the image's height: the lens's blur
    /// at the camera's near and far planes, capped by the largest blur size. The gather reaches no
    /// further.
    pub fn radius(&self) -> f32 {
        let cap = self.dof.max_blur.max(0.0);
        let near = self.lens.blur(self.near.max(1e-4)).abs();
        let far = self.lens.blur(self.far.max(1e-4)).abs();
        near.max(far).min(cap)
    }
}

/// The golden angle in radians, which turns each tap of the gather's spiral from the one before.
const GOLDEN_ANGLE: f32 = 2.399_963_3;

/// The mean distance between neighboring taps of a gather of `taps` taps over a disk of radius 1:
/// the side of the square of each tap's even share of the disk's area.
pub(crate) fn tap_spacing(taps: u32) -> f32 {
    (std::f32::consts::PI / taps.max(1) as f32).sqrt()
}

/// The taps of the gather for `taps` taps, at most 72, as places in a disk of radius 1: a spiral
/// that turns each tap by the golden angle from the one before, Vogel's method, from the center to
/// the edge, so each tap takes an even share of the disk's area and no ring of taps leaves a gap.
/// The taps after the center shift together so that they balance around it. With 3 or more
/// `blades` the disk becomes a regular polygon of that many sides, with a corner at the top. On
/// WebGL2 (`rows_from_bottom`) rows count up, so the shape turns over to keep its corner at the top.
pub fn kernel(taps: u32, blades: u32, rows_from_bottom: bool) -> ([[f32; 4]; KERNEL_VECTORS], u32) {
    let count = taps.clamp(1, 2 * KERNEL_VECTORS as u32) as usize;
    let mut places = [[0.0f32; 2]; 2 * KERNEL_VECTORS];
    let sides = blades as f32;
    let tau = std::f32::consts::TAU;
    let mut sum = [0.0f32; 2];
    for (index, place) in places.iter_mut().enumerate().take(count).skip(1) {
        let angle = index as f32 * GOLDEN_ANGLE;
        let mut reach = (index as f32 / (count - 1) as f32).sqrt();
        if blades >= 3 {
            // The polygon's edge along this angle, with a corner straight up.
            let wedge = tau / sides;
            let from_corner = (angle + tau / 4.0).rem_euclid(wedge) - wedge / 2.0;
            reach *= (wedge / 2.0).cos() / from_corner.cos();
        }
        let y = -angle.sin() * reach;
        *place = [angle.cos() * reach, if rows_from_bottom { -y } else { y }];
        sum = [sum[0] + place[0], sum[1] + place[1]];
    }
    let shift = [
        sum[0] / (count.max(2) - 1) as f32,
        sum[1] / (count.max(2) - 1) as f32,
    ];
    for place in places.iter_mut().take(count).skip(1) {
        *place = [place[0] - shift[0], place[1] - shift[1]];
    }
    let mut kernel = [[0.0; 4]; KERNEL_VECTORS];
    let (pairs, _) = places.as_chunks::<2>();
    for (vector, pair) in kernel.iter_mut().zip(pairs) {
        *vector = [pair[0][0], pair[0][1], pair[1][0], pair[1][1]];
    }
    (kernel, count as u32)
}

/// The terms of an inverse projection that give a depth value's view-space z: the projection's
/// third and fourth rows do not depend on x and y, so neither do the inverse's.
fn depth_terms(inverse: &Mat4) -> [f32; 4] {
    [inverse[10], inverse[14], inverse[11], inverse[15]]
}

/// A step's block, as `dof.wgsl` lays out its `Step` struct.
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
struct Block {
    map: [f32; 4],
    bounds: [f32; 4],
    source: [f32; 4],
    blurred_map: [f32; 4],
    blurred_bounds: [f32; 4],
    lens: [f32; 4],
    depth: [f32; 4],
    taps: [f32; 4],
    kernel: [[f32; 4]; KERNEL_VECTORS],
}

const _: () = assert!(std::mem::size_of::<Block>() <= BLOCK);

impl Default for Block {
    fn default() -> Self {
        Self {
            map: [0.0; 4],
            bounds: [0.0; 4],
            source: [0.0; 4],
            blurred_map: [0.0; 4],
            blurred_bounds: [0.0; 4],
            lens: [0.0; 4],
            depth: [0.0; 4],
            taps: [0.0; 4],
            kernel: [[0.0; 4]; KERNEL_VECTORS],
        }
    }
}

/// The GPU objects of depth of field, which the frame builder's id ranges set.
#[derive(Clone, Copy, Debug)]
pub(crate) struct DofIds {
    /// The uniform buffer of every step's block.
    pub(crate) buffer: u32,
    /// The linear sampler of every step.
    pub(crate) sampler: u32,
    /// The bind group of each step, from this id on.
    pub(crate) first_group: u32,
}

/// The textures that the steps read: the scene's color and depth, and the setup's, the gather's
/// and the tent's targets.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct DofSources {
    pub(crate) color: u32,
    pub(crate) depth: u32,
    pub(crate) halves: [u32; 3],
}

/// The pipeline of step `step`: one triangle into its target.
const fn pipeline(step: usize, multisampled: bool) -> PipelineKey {
    let template = match step {
        0 if multisampled => template::DOF_SETUP_MS,
        0 => template::DOF_SETUP,
        1 => template::DOF_BLUR,
        2 => template::DOF_FILTER,
        _ if multisampled => template::DOF_COMPOSITE_MS,
        _ => template::DOF_COMPOSITE,
    };
    PipelineKey {
        template,
        permutation: 0,
        vertex_format: 0,
        color_format: if step == STEPS - 1 {
            FORMAT
        } else {
            HALF_FORMAT
        },
        depth_format: format::NONE,
        samples: 1,
        state: state_flags::CULL_NONE,
        bias: DepthBias::NONE,
    }
}

/// What a frame's blocks depend on. The frame writes them again only when one changes.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Staged {
    canvas: (u32, u32),
    scale: RenderScale,
    frame: DofFrame,
}

/// Depth of field's GPU objects, its settings and what the GPU holds of them.
#[derive(Debug)]
pub(crate) struct DofPass {
    ids: DofIds,
    /// True when the scene's depth target is multisampled, so the steps read sample 0.
    multisampled: bool,
    /// True on WebGL2, which counts rows from the bottom.
    rows_from_bottom: bool,
    pipelines: [Option<u32>; STEPS],
    created: bool,
    staged: [u8; BUFFER_BYTES],
    staged_for: Option<Staged>,
    /// The textures that the steps' bind groups read, before the first group exists the default.
    bound: Option<DofSources>,
}

impl DofPass {
    /// Depth of field's steps, with GPU objects from `ids`, for a scene depth of `samples`, on
    /// WebGL2 with `rows_from_bottom`.
    pub(crate) fn new(ids: DofIds, samples: u32, rows_from_bottom: bool) -> Self {
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

    /// Makes the buffer and the sampler when the GPU lacks them, writes and uploads the blocks for
    /// `frame` when an input changed, and binds the steps to `sources` when they changed or the
    /// frame made the plan's textures again.
    pub(crate) fn prepare(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        (canvas, scale): ((u32, u32), RenderScale),
        frame: DofFrame,
        sources: DofSources,
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
            list.push(
                Op::CreateSampler,
                &[
                    ids.sampler,
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

    /// Records each step's bind group: the setup and the composite read the scene's color and
    /// depth, the gather and the tent the target before them, and the composite the tent's too.
    fn bind(&self, list: &mut DrawList, sources: DofSources) -> Result<(), RecordError> {
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
        let sampler = [2, resource_kind::SAMPLER, ids.sampler, 0, 0];
        let mut words = [0u32; 3 + 5 * 5];
        for step in 0..STEPS {
            let (layout, entries): (u32, &[[u32; 5]]) = match step {
                0 => (
                    if self.multisampled {
                        bind_layout::EFFECT_DEPTH_MS
                    } else {
                        bind_layout::EFFECT
                    },
                    &[
                        block(0),
                        texture(1, sources.color),
                        sampler,
                        texture(3, sources.depth),
                    ],
                ),
                1 | 2 => (
                    bind_layout::BLOOM,
                    &[block(step), texture(1, sources.halves[step - 1]), sampler],
                ),
                _ => (
                    if self.multisampled {
                        bind_layout::DOF_COMPOSITE_MS
                    } else {
                        bind_layout::DOF_COMPOSITE
                    },
                    &[
                        block(3),
                        texture(1, sources.color),
                        sampler,
                        texture(3, sources.depth),
                        texture(4, sources.halves[2]),
                    ],
                ),
            };
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

    /// Writes every step's block into the staging copy.
    fn stage(&mut self, inputs: Staged) {
        let Staged {
            canvas,
            scale,
            frame,
        } = inputs;
        let rows = self.rows_from_bottom;
        let scene = CornerMap::area(Size::Full, canvas, scale);
        let half = CornerMap::area(HALF, canvas, scale);
        // Blur sizes are in texels of the half-size targets, whose drawn corner is their height.
        let texels = half.corner.1 as f32;
        let mut shared = Block {
            lens: [
                frame.lens.far * texels,
                frame.lens.focus,
                frame.dof.max_blur.max(0.0) * texels,
                frame.radius() * texels,
            ],
            depth: depth_terms(&frame.inverse_projection),
            ..Block::default()
        };
        for step in 0..STEPS {
            // Each step reads the scene, or the half-size target before it.
            let (source, target) = match step {
                0 => (scene, half),
                1 | 2 => (half, half),
                _ => (scene, scene),
            };
            let map = CornerMap::new(source, target, rows);
            shared.map = map.map;
            shared.bounds = map.bounds;
            shared.source = map.source;
            if step == STEPS - 1 {
                let blurred = CornerMap::new(half, scene, rows);
                shared.blurred_map = blurred.map;
                shared.blurred_bounds = blurred.bounds;
            }
            shared.kernel = [[0.0; 4]; KERNEL_VECTORS];
            shared.taps = [0.0; 4];
            if step == 1 {
                let (kernel, taps) = kernel(frame.taps, frame.dof.blades, rows);
                shared.kernel = kernel;
                shared.taps[0] = taps as f32;
                // A round aperture turns its spiral by a different angle at each texel; a polygon
                // does not turn, so its corners stay put.
                if frame.dof.blades < 3 {
                    shared.taps[2] = std::f32::consts::TAU;
                }
            } else if step == 2 {
                // The tent reaches half the spacing of the gather's taps, at least half a texel,
                // so a highlight smaller than the spacing fills its disk.
                let spacing = shared.lens[3] * tap_spacing(frame.taps);
                shared.taps[1] = (0.5 * spacing).max(0.5);
            }
            self.staged[step * BLOCK..][..std::mem::size_of::<Block>()]
                .copy_from_slice(bytes_of(&shared));
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
    use super::*;

    fn close(a: f32, b: f32) -> bool {
        (a - b).abs() <= 1e-4 * a.abs().max(b.abs()).max(1.0)
    }

    #[test]
    fn the_lens_is_the_thin_lens_circle_of_confusion() {
        // A 50 mm lens at f/2 focused at 2 m: the circle of confusion at infinity is f² / (N (s -
        // f)) = 0.0025 / (2 × 1.95) m = 0.641 mm, a share of 0.0267 of a 24 mm sensor.
        let lens = Lens::new(50.0, 2.0, 2.0);
        assert!(close(lens.far, 0.0025 / (2.0 * 1.95) / 0.024), "{lens:?}");
        assert_eq!(lens.blur(2.0), 0.0);
        assert!(lens.blur(4.0) > 0.0 && lens.blur(1.0) < 0.0);
        // Twice the distance behind the focus blurs half as much as the far value; at half the
        // focus distance in front, as much as the far value, the other way.
        assert!(close(lens.blur(4.0), lens.far / 2.0));
        assert!(close(lens.blur(1.0), -lens.far));
        // Closing the aperture by two stops halves the blur; a longer lens blurs more.
        assert!(close(Lens::new(50.0, 4.0, 2.0).far, lens.far / 2.0));
        assert!(Lens::new(85.0, 2.0, 2.0).far > lens.far * 2.0);
        // A lens focuses no closer than its focal length.
        let close_up = Lens::new(50.0, 2.0, 0.0);
        assert!(close_up.focus > 0.05 && close_up.far.is_finite());
    }

    #[test]
    fn a_focal_length_matches_its_field_of_view_on_a_full_frame_sensor() {
        // A 50 mm lens sees 27 degrees up and down on a 24 mm sensor.
        let fov = 2.0 * (12.0f32 / 50.0).atan().to_degrees();
        assert!(close(focal_length_of_fov(fov), 50.0));
        assert!(close(focal_length_of_fov(90.0), 12.0));
    }

    #[test]
    fn the_gather_reaches_the_largest_blur_the_frame_can_show() {
        let frame = |dof: Dof| DofFrame {
            dof,
            lens: Lens::new(50.0, dof.aperture, dof.focus_distance),
            near: 0.3,
            far: 100.0,
            inverse_projection: [0.0; 16],
            taps: 22,
        };
        // An open lens hits the cap in front of the focus.
        let open = frame(Dof::default());
        assert_eq!(open.radius(), 0.02);
        // A lens closed far down blurs less than the cap anywhere between the planes: most at the
        // far plane here.
        let closed = frame(Dof {
            aperture: 22.0,
            focus_distance: 0.5,
            ..Dof::default()
        });
        let far = closed.lens.blur(100.0);
        assert!(closed.lens.blur(0.3).abs() < far, "{closed:?}");
        assert!(far < 0.02 && close(closed.radius(), far), "{closed:?}");
    }

    #[test]
    fn the_kernel_spreads_its_taps_evenly_over_the_disk_or_polygon() {
        let places = |taps: u32, blades: u32| -> Vec<[f32; 2]> {
            let (kernel, count) = kernel(taps, blades, false);
            assert_eq!(count, taps);
            kernel
                .iter()
                .flat_map(|v| [[v[0], v[1]], [v[2], v[3]]])
                .take(count as usize)
                .collect()
        };
        for taps in TAP_COUNTS {
            let disk = places(taps, 0);
            assert_eq!(disk[0], [0.0, 0.0], "the center tap reads the texel itself");
            let reach: Vec<f32> = disk.iter().map(|p| p[0].hypot(p[1])).collect();
            let farthest = reach.iter().copied().fold(0.0f32, f32::max);
            assert!((farthest - 1.0).abs() < 0.05, "{taps}: {farthest}");
            // The taps balance around the center, so the blur does not shift the image.
            let sum = disk
                .iter()
                .fold([0.0f32; 2], |s, p| [s[0] + p[0], s[1] + p[1]]);
            assert!(
                sum[0].abs() < 1e-4 && sum[1].abs() < 1e-4,
                "{taps}: {sum:?}"
            );
            // Each tap takes an even share of the area: a quarter of them lie within half the
            // radius, which holds a quarter of the disk.
            let inner = reach.iter().filter(|&&r| r < 0.5).count() as f32 / taps as f32;
            assert!((inner - 0.25).abs() < 2.0 / taps as f32, "{taps}: {inner}");
            assert!(close(
                tap_spacing(taps),
                (std::f32::consts::PI / taps as f32).sqrt()
            ));
        }
        // A hexagon's taps stay inside its corners' reach, and its outer taps reach past its
        // edges' distance, cos 30 degrees. Rows count down on WebGPU and up on WebGL2, so the
        // shape turns over there to keep a corner at the top.
        let hexagon = places(43, 6);
        let reach: Vec<f32> = hexagon.iter().map(|p| p[0].hypot(p[1])).collect();
        assert!(reach.iter().all(|&r| r <= 1.05), "{reach:?}");
        let edge = (std::f32::consts::PI / 6.0).cos();
        assert!(
            reach.iter().filter(|&&r| r > edge).count() >= 3,
            "{reach:?}"
        );
        let (upright, _) = kernel(43, 6, false);
        let (flipped, _) = kernel(43, 6, true);
        assert_eq!(flipped[11][1], -upright[11][1]);
    }

    #[test]
    fn the_shader_lays_out_the_block_as_the_core_writes_it() {
        let shader = include_str!("../../null3d-shaders/wgsl/dof.wgsl");
        for field in [
            "map: vec4f,",
            "bounds: vec4f,",
            "source: vec4f,",
            "blurred_map: vec4f,",
            "blurred_bounds: vec4f,",
            "lens: vec4f,",
            "depth: vec4f,",
            "taps: vec4f,",
            "kernel: array<vec4f, 36>,",
        ] {
            assert!(shader.contains(field), "dof.wgsl lacks {field}");
        }
        assert_eq!(std::mem::size_of::<Block>(), 8 * 16 + KERNEL_VECTORS * 16);
        assert!(shader.contains(&format!("MAX_TAPS: u32 = {}u;", 2 * KERNEL_VECTORS)));
    }

    #[test]
    fn a_moving_focus_only_uploads_the_blocks() {
        let ids = DofIds {
            buffer: 1,
            sampler: 2,
            first_group: 3,
        };
        let mut pass = DofPass::new(ids, 4, false);
        let mut pipelines = PipelineCache::default();
        pass.request_pipelines(&mut pipelines);
        let mut list = DrawList::with_capacity(4096);
        let mut arena = UploadArena::default();
        let sources = DofSources {
            color: 10,
            depth: 11,
            halves: [12, 13, 14],
        };
        let mut frame = DofFrame {
            dof: Dof::default(),
            lens: Lens::new(50.0, 2.8, 10.0),
            near: 0.1,
            far: 100.0,
            inverse_projection: [0.0; 16],
            taps: 22,
        };
        let ops = |list: &DrawList| -> Vec<Op> {
            null3d_gpu::drawlist::decode(list.words())
                .map(|c| c.unwrap().op)
                .collect()
        };
        let mut run = |pass: &mut DofPass, list: &mut DrawList, frame: DofFrame| {
            list.clear();
            arena.reset(DofPass::UPLOAD_BYTES);
            pass.prepare(
                list,
                &mut arena,
                ((1920, 1080), RenderScale::FULL),
                frame,
                sources,
                false,
            )
            .unwrap();
        };
        run(&mut pass, &mut list, frame);
        let first = ops(&list);
        assert_eq!(
            first
                .iter()
                .filter(|&&op| op == Op::CreateBindGroup)
                .count(),
            STEPS
        );
        // The multisampled depth takes its own layouts and builds.
        let groups: Vec<u32> = null3d_gpu::drawlist::decode(list.words())
            .map(|c| c.unwrap())
            .filter(|c| c.op == Op::CreateBindGroup)
            .map(|c| c.operands[1])
            .collect();
        assert_eq!(
            groups,
            [
                bind_layout::EFFECT_DEPTH_MS,
                bind_layout::BLOOM,
                bind_layout::BLOOM,
                bind_layout::DOF_COMPOSITE_MS
            ]
        );
        run(&mut pass, &mut list, frame);
        assert!(list.is_empty(), "nothing changed, so nothing records");
        frame.lens = Lens::new(50.0, 2.8, 4.0);
        run(&mut pass, &mut list, frame);
        assert_eq!(ops(&list), [Op::WriteBuffer], "a new focus only uploads");
    }
}
