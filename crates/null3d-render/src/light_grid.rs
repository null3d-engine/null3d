//! The light grid of clustered forward shading: a camera's view cut into clusters, and for each
//! cluster the list of the point and spot lights that can reach it. A fragment shader finds its
//! cluster and lights its surface with that cluster's lights alone, so each pixel's loop stays
//! short with hundreds of lights in view.
//!
//! # Clusters
//!
//! A cluster is one tile of the view in one slice of its depth. The tiles cut the view's
//! normalized device coordinates into an even grid, so the grid does not change with the render
//! size. The slices cut the distance along the view, and grow with it: each slice ends the same
//! factor further away than it starts, as the view's footprint of a tile grows with distance. A
//! perspective camera's slices start at its near plane. An orthographic camera's view can start
//! at or behind the camera, so its slices start at its near plane plus one unit of the view. The
//! last slice ends where the farthest visible light ends, or at the far plane, so no slice lies
//! beyond every light.
//!
//! # Assignment
//!
//! [`LightGrid::assign`] takes the visible point and spot lights of the view, with their
//! positions relative to its camera (see [`null3d_core::lights`]). Each light counts as its range
//! sphere, which holds a spot light's cone too. For each slice that the sphere reaches, a smaller
//! sphere holds the part of it inside the slice, and the planes between the columns and rows of
//! tiles give the tiles that sphere reaches. The test is conservative: a cluster may list a light
//! that misses it, but never misses a light that reaches it. The shaders' lighting ends each
//! light's reach smoothly at its range, so a cluster that lists a light it misses looks the same.
//!
//! The assignment runs in two passes over the same tiles. The first counts each cluster's lights.
//! A prefix sum then gives each cluster its place in the light index list, and the second pass
//! writes the lights' indices there, in the order of the light list. On WebGL2 the job workers
//! run both passes, slice by slice, and neither pass allocates: the grid keeps room for the most
//! lights it takes.
//!
//! On WebGPU a compute pass runs them instead (see [`ClusterParams`]). The CPU only picks the
//! frame's lights and cuts the view into slices and tiles, and the GPU tests each light against
//! each slice and tile with the same arithmetic, so both paths list the same lights in the same
//! order. That arithmetic keeps to the operations that WGSL rounds as the CPU does: it multiplies
//! by the inverse of a length instead of dividing by it, and it reads the depths where the slices
//! start from a table that the CPU fills, instead of taking powers of two.
//!
//! # Limits
//!
//! [`LightLimits`] caps the lights of one frame, the area lights of one frame, the lights of one
//! cluster and the entries of the index list. Past the area lights' cap, the grid keeps the area
//! lights that give the camera the most light, as [`area_light_at_camera`] estimates it. A light
//! that crosses that cap fades in or out over [`FADE_FRAMES`] frames, so none switches on or off at
//! once while the camera moves. Past the frame's cap, the grid keeps the lights whose spheres come
//! nearest the camera. Past a cluster's cap, or the index list's, a cluster keeps the lights that come first
//! in the list, and clusters further along the view lose lights first.
//!
//! # What the shaders read
//!
//! [`LightGrid::lights`] lists the lights in the order the index list numbers them, as the core's
//! 80-byte [`VisibleLight`] records. [`LightGrid::words`] holds the header's [`HEADER_WORDS`] words,
//! then one 32-bit word per cluster, then the index list. The header holds the slicing that finds a
//! position's slice: the row that gives its depth along the view and the row's bias, then the
//! slices per doubling, a flag, and the slice's start and unit. On WebGPU the fit's dispatch
//! overwrites it from the depth that the frame before measured, so a cluster covers a smaller part
//! of the view's depth. A cluster's word holds where its lights start in the words in its low
//! [`START_BITS`] bits, and how many there are in the bits above. Clusters count across the tiles
//! of a row first, then up the rows, then along the slices. [`GridUniform`] holds the CPU's slicing
//! in the frame uniform: [`LightGrid::cluster_at`] does what the shaders do when the slices are not
//! fitted.

use null3d_core::jobs::JobSystem;
use null3d_core::lights::{LightShadow, LightView, VisibleLight, kind};
use null3d_core::shared::SharedMut;
use null3d_gpu::drawlist::sizes::LIGHT_RECORD_BYTES;

use crate::camera::{Mat4, ViewDepth};
use crate::frame::{FrameInput, words_as_bytes};
use crate::shadow_tiles::ShadowTiles;
use crate::view::{MAX_VIEWS, ViewFrame, ViewId};

// The core's light records are what the shaders read.
const _: () = assert!(size_of::<VisibleLight>() == LIGHT_RECORD_BYTES as usize);

/// Bits of a cluster's word that hold where its lights start in the grid's words. The bits above
/// them hold the count.
pub const START_BITS: u32 = 23;
/// The most lights that one cluster lists: the most its word's count holds.
pub const MAX_PER_CLUSTER: u32 = (1 << (32 - START_BITS)) - 1;
/// The words of the grid's header, before the clusters' words. They hold the slicing that finds a
/// position's slice: the row that gives its depth along the view and the row's bias, then the
/// slices per doubling, a flag for a slicing fitted to the depth, the slice start and its unit. The
/// shaders read them from the grid, because a slicing fitted on the GPU cannot reach a uniform that
/// the CPU writes.
pub const HEADER_WORDS: u32 = 8;
/// The word of the header that holds the slices per doubling.
pub const HEADER_DOUBLING: u32 = 4;
/// The word of the header that is 1 when the slicing is fitted to the depth.
pub const HEADER_FITTED: u32 = 5;
/// The word of the header that holds the slice start, in the units of the view's depth.
pub const HEADER_START: u32 = 6;
/// The word of the header that holds the depth that adds 1 to the slice depth.
pub const HEADER_UNIT: u32 = 7;
/// The most tiles across or up the view.
pub const MAX_TILES: u32 = 254;
/// The most lights that one frame lists.
pub const MAX_LIGHTS: u32 = 4096;
/// The most entries of the light index list.
pub const MAX_INDICES: u32 = 1 << 16;

/// A tile rectangle that holds no tile.
const NO_TILES: u32 = u32::MAX;
/// Frames whose lights reach this many slices in all are assigned on the job workers too. Less
/// work is assigned on the calling thread alone, which then takes less time than waking the
/// workers and waiting for them: a few hundred small lights finish sooner on one thread.
const PARALLEL_WORK: u32 = 2048;
/// The same threshold when the job workers already had work this frame and are still awake.
const AWAKE_PARALLEL_WORK: u32 = 512;
/// How far each test reaches past a sphere, as a share of the sphere's distance from the camera
/// and its radius, so that a fragment's cluster, which the GPU rounds on its own, still lists
/// every light that reaches the fragment.
const MARGIN: f32 = 1e-4;

/// The frames over which an area light fades in when it joins the frame's kept area lights, or
/// fades out when it leaves them.
pub const FADE_FRAMES: u32 = 8;
/// What an area light's estimate keeps past its range: a small share, so lights out of range still
/// rank among themselves by their light, below every light in range.
const PAST_RANGE: f32 = 1e-4;
/// The closest that the estimate lets the camera come to a light, in meters, so a camera at or in
/// a light gives a finite number.
const NEAREST: f32 = 0.1;

/// True for a rectangle or tube light's record.
fn is_area(light: &VisibleLight) -> bool {
    light.kind == kind::RECT || light.kind == kind::TUBE
}

fn dot(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

/// The distance from the camera to the nearest point of the area between `p - a` and `p + a`,
/// and `a`'s length: `p` relative to the camera, and `a` a half side.
fn along_side(p: [f32; 3], a: [f32; 3]) -> ([f32; 3], f32) {
    let half = dot(a, a).sqrt();
    if half == 0.0 {
        return (p, 0.0);
    }
    let t = (-dot(p, a) / (half * half)).clamp(-1.0, 1.0);
    (std::array::from_fn(|k| p[k] + t * a[k]), half)
}

/// An estimate of the light that an area light's record gives the camera: its luminance (color
/// times intensity) times its area, over the squared distance from the camera to its nearest
/// point. The light's own window ends it at its range, past which only [`PAST_RANGE`] of it stays.
/// A rectangle's area is its width times its height, and a tube's its length times its diameter.
pub fn area_light_at_camera(light: &VisibleLight) -> f32 {
    let [r, g, b] = light.color;
    let luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    let (q, half_a) = along_side(light.position, light.direction);
    let (area, distance) = if light.kind == kind::RECT {
        let (q, half_b) = along_side(q, [light.decay, light.cone_cos, light.penumbra_cos]);
        (4.0 * half_a * half_b, dot(q, q).sqrt())
    } else {
        (4.0 * half_a * light.decay, dot(q, q).sqrt() - light.decay)
    };
    let distance = distance.max(NEAREST);
    let reach = (distance / light.range.max(f32::MIN_POSITIVE)).powi(4);
    let window = ((1.0 - reach).max(0.0).powi(2)).max(PAST_RANGE);
    luminance * area / (distance * distance) * window
}

/// An area light's fade: its weight from 0 to 1, and the frame that last listed it.
#[derive(Clone, Copy, Debug, Default)]
struct Fade {
    weight: f32,
    seen: u32,
}

/// How the grid cuts a view into clusters.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct GridShape {
    /// Tiles across the view, at most [`MAX_TILES`].
    pub tiles_x: u32,
    /// Tiles up the view, at most [`MAX_TILES`].
    pub tiles_y: u32,
    /// Slices along the view.
    pub slices: u32,
}

impl GridShape {
    /// The number of tiles in one slice.
    pub const fn tiles(&self) -> u32 {
        self.tiles_x * self.tiles_y
    }

    /// The number of clusters.
    pub const fn clusters(&self) -> u32 {
        self.tiles() * self.slices
    }

    /// The cluster of tile `(x, y)` in slice `slice`: tiles count across a row first, then up the
    /// rows, then along the slices.
    pub const fn cluster(&self, x: u32, y: u32, slice: u32) -> u32 {
        (slice * self.tiles_y + y) * self.tiles_x + x
    }
}

/// The engine's grid: 16 tiles across, 9 up and 24 slices, 3,456 clusters.
pub const DEFAULT_GRID: GridShape = GridShape {
    tiles_x: 16,
    tiles_y: 9,
    slices: 24,
};

/// The most area lights that one frame shades unless the quality settings say otherwise: the
/// Ultra preset's cap.
pub const DEFAULT_AREA_LIGHT_CAP: u32 = 32;

/// The most lights a grid lists.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LightLimits {
    /// The most lights of one frame, at most [`MAX_LIGHTS`]: the ones nearest the camera when
    /// more are visible.
    pub lights: u32,
    /// The most area lights of one frame, which cost a surface several times what a point light
    /// costs: the ones that give the camera the most light when more are visible, with the ones
    /// that still fade out. They count toward `lights` too.
    pub area_lights: u32,
    /// The most lights of one cluster, at most [`MAX_PER_CLUSTER`].
    pub per_cluster: u32,
    /// The most entries of the index list over every cluster, at most [`MAX_INDICES`].
    pub indices: u32,
}

impl Default for LightLimits {
    /// The limits of the heaviest quality preset, with the whole index list.
    fn default() -> Self {
        Self {
            lights: 1024,
            area_lights: DEFAULT_AREA_LIGHT_CAP,
            per_cluster: 128,
            indices: MAX_INDICES,
        }
    }
}

/// What the shaders read to find a position's cluster, laid out as two `vec4f`s.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct GridUniform {
    /// The row that gives a position's slice depth: the base-2 logarithm of its dot product with
    /// `(x, y, z, 1)`, times the slices per doubling, is the position's slice. A position relative
    /// to the camera gives 1 where the first slice starts.
    pub depth: [f32; 4],
    /// Tiles across, tiles up, slices, and slices per doubling of the slice depth. The slices are 0
    /// when the grid lists no light, and the shaders then skip the grid.
    pub grid: [f32; 4],
}

/// Threads per workgroup of the GPU's light clustering passes.
pub const GPU_WORKGROUP_SIZE: u32 = 128;
/// The most slices that [`ClusterParams`] holds.
pub const GPU_MAX_SLICES: u32 = 32;
/// The most planes between tiles that [`ClusterParams`] holds: the columns' and the rows' planes,
/// one more than the tiles across and one more than the tiles up.
pub const GPU_MAX_PLANES: u32 = 32;

/// What the GPU's light clustering passes read beside the light list, as a uniform block: the
/// CPU's part of [`LightGrid::assign`] for the frame, which [`LightGrid::prepare`] does. The
/// shader `light_clusters.wgsl` declares the same block.
///
/// Three dispatches in one compute pass list each cluster's lights, as the job workers' passes
/// do. The first counts each cluster's lights into the cluster's word. One workgroup then adds up
/// the counts, with the caps, into each cluster's place in the index list. The last writes the
/// lights' indices there, in the order of the light list. The first and the last run one
/// workgroup per slice and run of tiles ([`LightGrid::gpu_workgroups`]), whose threads share the
/// tile rectangles of each run of lights.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct ClusterParams {
    /// Tiles across, tiles up, slices, and the lights of the light list.
    pub shape: [u32; 4],
    /// The most lights of one cluster, the entries of the index list, the clusters, and 0.
    pub limits: [u32; 4],
    /// The row that gives a position's depth along the view.
    pub depth_row: [f32; 4],
    /// The depth row's direction, of length 1, then one over the row's length.
    pub forward: [f32; 4],
    /// How far each tile test reaches past a sphere: the share of its radius, the share of its
    /// distance from the camera, and two zeros.
    pub reach: [f32; 4],
    /// Each slice's bounds along the view, two slices per vector.
    pub bounds: [[f32; 4]; (GPU_MAX_SLICES / 2) as usize],
    /// The planes between the columns of tiles, then between the rows.
    pub planes: [[f32; 4]; GPU_MAX_PLANES as usize],
    /// The near plane, the far plane, the view depth where the last slice ends, and 1 for a
    /// perspective lens. The GPU's fit reads them to fit the slices to the depth.
    pub fit: [f32; 4],
    /// The CPU's slicing, for a frame whose slices the GPU does not fit: the slices per doubling,
    /// the slice start, and the depth that adds 1 to the slice depth.
    pub plain: [f32; 4],
}

/// Bytes of [`ClusterParams`].
pub const CLUSTER_PARAMS_BYTES: u32 = size_of::<ClusterParams>() as u32;

impl ClusterParams {
    /// The block as 32-bit words, for an upload.
    pub fn as_words(&self) -> &[u32] {
        // SAFETY: the block is `repr(C)` and made of 32-bit values only, so it has no padding and
        // every word of it is initialized.
        unsafe {
            std::slice::from_raw_parts(
                (self as *const Self).cast::<u32>(),
                CLUSTER_PARAMS_BYTES as usize / 4,
            )
        }
    }
}

/// A view as the grid sees it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GridView {
    /// The view-projection matrix for positions relative to the camera.
    pub view_proj: Mat4,
    /// How far positions lie along the view.
    pub depth: ViewDepth,
}

/// Where a light lies along the view, and the slices it reaches.
#[derive(Clone, Copy, Debug, Default)]
struct Span {
    /// The distance of the light's position along the view.
    depth: f32,
    /// How far the light's sphere reaches along the view on each side.
    reach: f32,
    /// The slices it reaches: `first..end`, none when they are equal.
    first: u32,
    end: u32,
}

/// How the grid slices depth for the frame: see [`GridUniform`].
#[derive(Clone, Copy, Debug, Default)]
struct Slicing {
    /// The view's depth where the first slice starts.
    start: f32,
    /// The view's depth that adds 1 to the slice depth, near the camera.
    unit: f32,
    /// Slices per doubling of the slice depth.
    per_doubling: f32,
    /// The view depth where the last slice ends: the end of the farthest visible light, or the far
    /// plane.
    end: f32,
    /// The near plane's distance.
    near: f32,
    /// The far plane's distance.
    far: f32,
    /// True for a perspective lens, whose view starts at the camera.
    perspective: bool,
    /// One over the length of the depth row's direction: the world units per unit of the view's
    /// depth.
    inverse_scale: f32,
    /// The row that gives a position's depth along the view.
    row: [f32; 4],
    /// The depth row's direction, of length 1.
    forward: [f32; 3],
}

impl Slicing {
    /// The slice depth of a view depth.
    fn slice_depth(&self, depth: f32) -> f32 {
        (depth - self.start) / self.unit + 1.0
    }

    /// The view depth where slice `slice` starts.
    fn slice_start(&self, slice: u32) -> f32 {
        ((slice as f32 / self.per_doubling).exp2() - 1.0) * self.unit + self.start
    }

    /// The depth of a light's position along the view, added up in the order the GPU adds it.
    fn depth_of(&self, p: [f32; 3]) -> f32 {
        let [rx, ry, rz, rw] = self.row;
        rx * p[0] + ry * p[1] + rz * p[2] + rw
    }
}

/// True when a sphere of radius `r` whose center lies at view depth `depth` reaches the depths
/// between `bounds`, in the world units that `inverse_scale` turns view depths into: the test that
/// a slice's tile rectangle starts with.
fn reaches_depths(bounds: [f32; 2], depth: f32, r: f32, inverse_scale: f32) -> bool {
    (bounds[0] - depth) * inverse_scale <= r && (bounds[1] - depth) * inverse_scale >= -r
}

/// The light grid of one view: see the module documentation.
#[derive(Debug)]
pub struct LightGrid {
    shape: GridShape,
    limits: LightLimits,
    /// The planes between the columns of tiles, then between the rows, each normalized and
    /// facing the side of the higher tiles.
    planes: Vec<[f32; 4]>,
    /// The lights the grid lists, as the index list numbers them.
    lights: Vec<VisibleLight>,
    /// Each light's span along the view.
    spans: Vec<Span>,
    /// Each slice's depths along the view, widened on each side for the GPU's rounding: where it
    /// starts and where it ends.
    bounds: Vec<[f32; 2]>,
    /// The visible lights in order of nearness, when more than the frame's cap are visible.
    nearest: Vec<u32>,
    /// Each visible area light's estimate of its light at the camera, by its place in the visible
    /// list, when more than the area lights' cap are visible.
    estimates: Vec<f32>,
    /// Each visible light's weight in the frame, by its place in the visible list: 1 for every
    /// light but an area light that fades, and 0 for one the frame leaves out.
    weights: Vec<f32>,
    /// Each area light's fade, by its row in the light table.
    fades: Vec<Fade>,
    /// The frames that chose lights so far, which marks the fades that the last frame listed.
    frame: u32,
    /// Each slice's tile rectangle of each light, [`NO_TILES`] for none: one row of lights per
    /// slice.
    rects: Vec<u32>,
    /// Each cluster's lights in the first pass, then its written lights in the second.
    counts: Vec<u32>,
    /// One word per cluster, then the index list.
    words: Vec<u32>,
    /// Entries of the index list in use.
    used: u32,
    view_proj: Mat4,
    slicing: Slicing,
    uniform: GridUniform,
    /// True when the GPU may fit this grid's slices to the measured depth: the camera view's grid.
    fits: bool,
    /// True when this grid's slicing is fitted to a measured depth range.
    fitted: bool,
}

impl LightGrid {
    /// An empty grid of `shape`, with room for the most that `limits` lets it list. Panics when a
    /// limit or the shape is out of range.
    pub fn new(shape: GridShape, limits: LightLimits) -> Self {
        assert!(
            (1..=MAX_TILES).contains(&shape.tiles_x)
                && (1..=MAX_TILES).contains(&shape.tiles_y)
                && shape.slices > 0,
            "a light grid of {shape:?}"
        );
        assert!(
            limits.lights <= MAX_LIGHTS
                && limits.per_cluster <= MAX_PER_CLUSTER
                && limits.indices <= MAX_INDICES,
            "light limits of {limits:?}"
        );
        let clusters = shape.clusters() as usize;
        let lights = limits.lights as usize;
        Self {
            shape,
            limits,
            planes: vec![[0.0; 4]; (shape.tiles_x + shape.tiles_y + 2) as usize],
            lights: Vec::with_capacity(lights),
            spans: vec![Span::default(); lights],
            bounds: vec![[0.0; 2]; shape.slices as usize],
            nearest: Vec::new(),
            estimates: Vec::new(),
            weights: Vec::new(),
            fades: Vec::new(),
            frame: 1,
            rects: vec![NO_TILES; shape.slices as usize * lights],
            counts: vec![0; clusters],
            words: vec![0; (HEADER_WORDS as usize) + clusters + limits.indices as usize],
            used: 0,
            view_proj: [0.0; 16],
            slicing: Slicing::default(),
            uniform: GridUniform::default(),
            fits: false,
            fitted: false,
        }
    }

    /// How the grid cuts the view.
    pub fn shape(&self) -> GridShape {
        self.shape
    }

    /// The most the grid lists.
    pub fn limits(&self) -> LightLimits {
        self.limits
    }

    /// Sets the most area lights of one frame, from the next frame on.
    pub fn set_area_light_cap(&mut self, cap: u32) {
        self.limits.area_lights = cap;
    }

    /// The most words the grid gives the shaders: the header, a word per cluster, and the whole
    /// index list.
    pub fn max_words(&self) -> u32 {
        HEADER_WORDS + self.shape.clusters() + self.limits.indices
    }

    /// The lights the grid lists, as the index list numbers them.
    pub fn lights(&self) -> &[VisibleLight] {
        &self.lights
    }

    /// The header's slicing words, one word per cluster, then the entries of the index list in use:
    /// see the module documentation.
    pub fn words(&self) -> &[u32] {
        &self.words[..(HEADER_WORDS + self.shape.clusters() + self.used) as usize]
    }

    /// The lights that a cluster lists, as indices into [`LightGrid::lights`].
    pub fn cluster_lights(&self, cluster: u32) -> &[u32] {
        let word = self.words[(HEADER_WORDS + cluster) as usize];
        let start = (word & ((1 << START_BITS) - 1)) as usize;
        &self.words[start..start + (word >> START_BITS) as usize]
    }

    /// What the shaders read to find a position's cluster.
    pub fn uniform(&self) -> GridUniform {
        self.uniform
    }

    /// The cluster of a position relative to the camera, as the shaders find it, or `None` when
    /// the position lies beyond the last slice or the grid lists no light. A fitted slicing keeps
    /// its last slice open, as the shaders do, so a position past its end takes the last cluster.
    pub fn cluster_at(&self, p: [f32; 3]) -> Option<u32> {
        let [tiles_x, tiles_y, slices, per_doubling] = self.uniform.grid;
        if slices == 0.0 {
            return None;
        }
        let m = &self.view_proj;
        let clip = |row: usize| m[row] * p[0] + m[4 + row] * p[1] + m[8 + row] * p[2] + m[12 + row];
        let w = clip(3);
        let tile =
            |ndc: f32, tiles: f32| ((ndc * 0.5 + 0.5) * tiles).floor().clamp(0.0, tiles - 1.0);
        let (x, y) = (tile(clip(0) / w, tiles_x), tile(clip(1) / w, tiles_y));
        let d = &self.uniform.depth;
        let slice_depth = d[0] * p[0] + d[1] * p[1] + d[2] * p[2] + d[3];
        let mut slice = (slice_depth.log2() * per_doubling).floor().max(0.0);
        if self.fitted {
            slice = slice.min(slices - 1.0);
        } else if slice >= slices {
            return None;
        }
        Some(self.shape.cluster(x as u32, y as u32, slice as u32))
    }

    /// True when the GPU's light clustering passes can assign lights to a grid of `shape`: its
    /// slices and its planes fit [`ClusterParams`].
    pub const fn fits_gpu(shape: GridShape) -> bool {
        shape.slices <= GPU_MAX_SLICES && shape.tiles_x + shape.tiles_y + 2 <= GPU_MAX_PLANES
    }

    /// Writes what the GPU's passes read to list the lights that [`LightGrid::prepare`] picked.
    /// Panics when the grid's shape does not fit them ([`LightGrid::fits_gpu`]).
    pub fn gpu_params(&self, out: &mut ClusterParams) {
        assert!(
            Self::fits_gpu(self.shape),
            "a GPU light grid of {:?}",
            self.shape
        );
        let shape = self.shape;
        let s = &self.slicing;
        out.shape = [
            shape.tiles_x,
            shape.tiles_y,
            shape.slices,
            self.lights.len() as u32,
        ];
        out.limits = [
            self.limits.per_cluster,
            self.limits.indices,
            shape.clusters(),
            0,
        ];
        out.depth_row = s.row;
        out.forward = [s.forward[0], s.forward[1], s.forward[2], s.inverse_scale];
        // The third value lets the fit run for the camera view's grid alone: another view's depth
        // differs, so it keeps the CPU's slicing.
        out.reach = [1.0 + MARGIN, MARGIN, if self.fits { 1.0 } else { 0.0 }, 0.0];
        for (pair, out) in self.bounds.chunks(2).zip(&mut out.bounds) {
            *out = [0.0; 4];
            out[..pair.len() * 2].copy_from_slice(pair.as_flattened());
        }
        out.planes[..self.planes.len()].copy_from_slice(&self.planes);
        out.fit = [s.near, s.far, s.end, if s.perspective { 1.0 } else { 0.0 }];
        out.plain = [s.per_doubling, s.start, s.unit, 0.0];
    }

    /// The workgroups of the GPU's counting and writing dispatches: a run of tiles of one slice
    /// each, across the slices.
    pub fn gpu_workgroups(&self) -> [u32; 3] {
        [
            self.shape.tiles().div_ceil(GPU_WORKGROUP_SIZE),
            self.shape.slices,
            1,
        ]
    }

    /// True when the grid's test finds that light `light` of [`LightGrid::lights`] reaches
    /// cluster `cluster`, before any cap. The clusters list exactly the lights this finds, until
    /// a cap cuts a list short.
    pub fn reaches(&self, light: u32, cluster: u32) -> bool {
        let tiles = self.shape.tiles();
        let slice = cluster / tiles;
        let tile = cluster % tiles;
        let (x, y) = (tile % self.shape.tiles_x, tile / self.shape.tiles_x);
        let span = self.spans[light as usize];
        if !(span.first..span.end).contains(&slice) {
            return false;
        }
        let rect = self.rect(&self.lights[light as usize], &span, slice);
        rect != NO_TILES && {
            let [x0, x1, y0, y1] = rect.to_le_bytes().map(u32::from);
            (x0..=x1).contains(&x) && (y0..=y1).contains(&y)
        }
    }

    /// Lists the lights of `visible`, whose positions are relative to the camera of `view`, in the
    /// clusters they reach, on the calling thread and the job workers. Allocates nothing, unless
    /// more lights are visible than ever before and more than the frame's cap.
    pub fn assign(&mut self, jobs: &JobSystem, view: &GridView, visible: &[VisibleLight]) {
        self.assign_with(jobs, view, visible, None);
    }

    /// Lists the lights of `visible` as [`LightGrid::assign`] does, with the slices fitted to the
    /// nearest and farthest view depth that `measured` gives. This is the reference that the GPU's
    /// `fit_lights` follows, and the fitted slicing's tests run it.
    pub fn assign_fitted(
        &mut self,
        jobs: &JobSystem,
        view: &GridView,
        visible: &[VisibleLight],
        measured: [f32; 2],
    ) {
        self.assign_with(jobs, view, visible, Some(measured));
    }

    fn assign_with(
        &mut self,
        jobs: &JobSystem,
        view: &GridView,
        visible: &[VisibleLight],
        measured: Option<[f32; 2]>,
    ) {
        let Some(work) = self.prepare_with(view, visible, measured) else {
            return;
        };
        let lights = self.lights.len();
        let parallel = jobs.worker_count() > 0
            && work
                >= if jobs.workers_busy_this_frame() {
                    AWAKE_PARALLEL_WORK
                } else {
                    PARALLEL_WORK
                };
        let slices = self.shape.slices;
        let run = |pass: &(dyn Fn(u32) + Sync)| {
            if parallel {
                jobs.parallel_for(slices, 1, &|range, _| range.for_each(pass));
            } else {
                (0..slices).for_each(pass);
            }
        };

        let tiles = self.shape.tiles() as usize;
        let stride = self.limits.lights as usize;
        let tiles_x = self.shape.tiles_x as usize;
        {
            let rects = SharedMut::new(&mut self.rects);
            let counts = SharedMut::new(&mut self.counts);
            let this = &*self;
            run(&|slice| {
                let s = slice as usize;
                // SAFETY: each slice writes only its own row of rectangles and its own clusters'
                // counts, which no other slice touches.
                let rects = unsafe { rects.slice(s * stride, lights) };
                let counts = unsafe { counts.slice(s * tiles, tiles) };
                counts.fill(0);
                for (rect, (light, span)) in
                    rects.iter_mut().zip(this.lights.iter().zip(&this.spans))
                {
                    *rect = if (span.first..span.end).contains(&slice) {
                        this.rect(light, span, slice)
                    } else {
                        NO_TILES
                    };
                    for_each_tile(*rect, |x, y| counts[y * tiles_x + x] += 1);
                }
            });
        }
        self.place();
        {
            let words = SharedMut::new(&mut self.words);
            let counts = SharedMut::new(&mut self.counts);
            let rects = &self.rects;
            run(&|slice| {
                let s = slice as usize;
                // SAFETY: each slice reads its own clusters' words and writes its own clusters'
                // counts and index list entries, which the prefix sum keeps apart.
                let placed = unsafe { counts.slice(s * tiles, tiles) };
                for (light, &rect) in rects[s * stride..s * stride + lights].iter().enumerate() {
                    for_each_tile(rect, |x, y| {
                        let tile = y * tiles_x + x;
                        let word = unsafe { words.read(HEADER_WORDS as usize + s * tiles + tile) };
                        let written = placed[tile];
                        if written < word >> START_BITS {
                            let at = (word & ((1 << START_BITS) - 1)) + written;
                            unsafe { words.write(at as usize, light as u32) };
                            placed[tile] = written + 1;
                        }
                    });
                }
            });
        }
    }

    /// Picks the lights of `visible` that the frame lists, cuts the view into slices for them, and
    /// sets the planes between the tiles: everything but the passes that list each cluster's
    /// lights. Returns the slices that the lights reach in all, or `None` when the grid lists no
    /// light, so a frame needs no pass. The GPU's passes start from here (see [`ClusterParams`]).
    pub fn prepare(&mut self, view: &GridView, visible: &[VisibleLight]) -> Option<u32> {
        self.prepare_with(view, visible, None)
    }

    /// Picks the lights and cuts the view's slices as [`LightGrid::prepare`] does, with the slices
    /// fitted to the nearest and farthest view depth that `measured` gives. This is the reference
    /// that the GPU's `fit_lights` follows, and the fitted slicing's tests start here.
    pub fn prepare_fitted(
        &mut self,
        view: &GridView,
        visible: &[VisibleLight],
        measured: [f32; 2],
    ) -> Option<u32> {
        self.fits = true;
        self.prepare_with(view, visible, Some(measured))
    }

    fn prepare_with(
        &mut self,
        view: &GridView,
        visible: &[VisibleLight],
        measured: Option<[f32; 2]>,
    ) -> Option<u32> {
        self.choose(visible);
        self.used = 0;
        self.view_proj = view.view_proj;
        let Some(work) = self.slice_with(&view.depth, measured) else {
            self.uniform = GridUniform::default();
            self.fitted = false;
            self.zero_header();
            return None;
        };
        self.set_planes();
        Some(work)
    }

    /// Copies the lights the frame lists: all of `visible`, or past the area lights' cap the area
    /// lights that [`area_light_at_camera`] ranks first, with the lights that still fade out, and
    /// past the frame's cap the ones whose spheres come nearest the camera, in the order of
    /// `visible`. Each area light's color is multiplied by its fade. It allocates only when the
    /// light table or the visible list grew past what an earlier frame met.
    fn choose(&mut self, visible: &[VisibleLight]) {
        let cap = self.limits.lights as usize;
        self.lights.clear();
        self.frame = self.frame.wrapping_add(1);
        let areas = visible.iter().filter(|light| is_area(light)).count();
        if areas == 0 && visible.len() <= cap {
            self.lights.extend_from_slice(visible);
            return;
        }
        if cap == 0 {
            return;
        }
        let rows = visible.iter().map(|light| light.light as usize + 1).max();
        self.nearest.clear();
        self.estimates.clear();
        self.weights.clear();
        let room = self.nearest.try_reserve(visible.len()).is_ok()
            && self.estimates.try_reserve(visible.len()).is_ok()
            && self.weights.try_reserve(visible.len()).is_ok()
            && rows.is_none_or(|rows| {
                rows <= self.fades.len() || self.fades.try_reserve(rows - self.fades.len()).is_ok()
            });
        if !room {
            // Without room to rank them, the first lights stay, with the first area lights.
            let area_cap = self.limits.area_lights as usize;
            let mut kept_areas = 0;
            let first = visible.iter().filter(|light| {
                let area = is_area(light);
                kept_areas += usize::from(area);
                !area || kept_areas <= area_cap
            });
            self.lights.extend(first.take(cap).copied());
            return;
        }
        if let Some(rows) = rows.filter(|&rows| rows > self.fades.len()) {
            self.fades.resize(rows, Fade::default());
        }
        self.fade_area_lights(visible, areas);

        // The frame's cap among the lights that the area lights' cap and the fades leave.
        let weights = &self.weights;
        let nearest = &mut self.nearest;
        nearest.clear();
        nearest.extend((0..visible.len() as u32).filter(|&i| weights[i as usize] > 0.0));
        if nearest.len() > cap {
            let near_edge = |i: &u32| {
                let light = &visible[*i as usize];
                let [x, y, z] = light.position;
                (x * x + y * y + z * z).sqrt() - light.range
            };
            nearest.select_nth_unstable_by(cap - 1, |a, b| near_edge(a).total_cmp(&near_edge(b)));
            nearest.truncate(cap);
            nearest.sort_unstable();
        }
        self.lights.extend(nearest.iter().map(|&i| {
            let weight = weights[i as usize];
            let mut light = visible[i as usize];
            light.color = light.color.map(|c| c * weight);
            light
        }));
    }

    /// Gives each of the `areas` area lights of `visible` its weight for the frame, and every other
    /// light a weight of 1. The cap keeps the area lights that give the camera the most light, and
    /// the nearest of equal ones. A kept light's weight rises toward 1, and any other's falls toward
    /// 0, by a step of one in [`FADE_FRAMES`] each frame. A light that the last frame did not list
    /// starts at its end weight, so lights that come into view, and a scene's first frame, show no
    /// fade.
    fn fade_area_lights(&mut self, visible: &[VisibleLight], areas: usize) {
        let area_cap = self.limits.area_lights as usize;
        let Self {
            nearest,
            estimates,
            weights,
            fades,
            frame,
            ..
        } = self;
        weights.clear();
        weights.extend(
            visible
                .iter()
                .map(|light| if is_area(light) { 0.0 } else { 1.0 }),
        );
        // The kept area lights get a weight of 1 here, the rest stay at 0, before the fades.
        nearest.clear();
        nearest.extend((0..visible.len() as u32).filter(|&i| is_area(&visible[i as usize])));
        if areas > area_cap {
            estimates.clear();
            estimates.extend(visible.iter().map(|light| {
                if is_area(light) {
                    area_light_at_camera(light)
                } else {
                    0.0
                }
            }));
            let near_edge = |i: u32| {
                let light = &visible[i as usize];
                dot(light.position, light.position).sqrt() - light.range
            };
            let rank = |a: &u32, b: &u32| {
                let (ea, eb) = (estimates[*a as usize], estimates[*b as usize]);
                eb.total_cmp(&ea)
                    .then_with(|| near_edge(*a).total_cmp(&near_edge(*b)))
            };
            if area_cap > 0 {
                nearest.select_nth_unstable_by(area_cap - 1, rank);
            }
            nearest.truncate(area_cap);
        }
        for &i in nearest.iter() {
            weights[i as usize] = 1.0;
        }
        let step = 1.0 / FADE_FRAMES as f32;
        for (light, weight) in visible.iter().zip(weights.iter_mut()) {
            if !is_area(light) {
                continue;
            }
            let fade = &mut fades[light.light as usize];
            let target = *weight;
            fade.weight = if fade.seen.wrapping_add(1) == *frame {
                if target > fade.weight {
                    (fade.weight + step).min(1.0)
                } else {
                    (fade.weight - step).max(0.0)
                }
            } else {
                target
            };
            fade.seen = *frame;
            *weight = fade.weight;
        }
    }

    /// Sets the slices for the frame's lights, and each light's span of slices. Returns the slices
    /// that the lights reach in all, or `None` when no light reaches the view's depth, so the grid
    /// lists none.
    fn slice_with(&mut self, depth: &ViewDepth, measured: Option<[f32; 2]>) -> Option<u32> {
        let [rx, ry, rz, rw] = depth.row;
        let scale = (rx * rx + ry * ry + rz * rz).sqrt();
        if self.lights.is_empty() || !(scale > 0.0 && scale.is_finite()) {
            return None;
        }
        let start = if depth.perspective {
            depth.near.max(f32::MIN_POSITIVE)
        } else {
            depth.near
        };
        let unit = if depth.perspective { start } else { 1.0 };
        let mut slicing = Slicing {
            start,
            unit,
            per_doubling: 1.0,
            end: start,
            near: depth.near,
            far: depth.far,
            perspective: depth.perspective,
            inverse_scale: 1.0 / scale,
            row: depth.row,
            forward: [rx / scale, ry / scale, rz / scale],
        };
        let mut end = start;
        for (span, light) in self.spans.iter_mut().zip(&self.lights) {
            span.depth = slicing.depth_of(light.position);
            span.reach = light.range * scale;
            end = end.max(span.depth + span.reach);
        }
        let end = end.min(depth.far);
        if end <= start {
            return None;
        }
        // At least a little depth, so the logarithm of the last slice's end is above 0.
        let end = end.max(start + unit * 1e-3);
        slicing.end = end;
        slicing.near = depth.near;
        slicing.far = depth.far;
        slicing.perspective = depth.perspective;
        let slices = self.shape.slices;
        slicing.per_doubling = slices as f32 / slicing.slice_depth(end).log2();
        // A measured range fits the slices as the GPU's fit does: the measured nearest depth starts
        // the second slice and the measured farthest ends the one before the last. The end slices
        // stay open, to the near plane and to the end of the lights' reach, so a fragment outside
        // the measured range still gets every light that reaches it. A range shorter than a
        // twentieth of its near end fits nothing, as the GPU's fit leaves the CPU's slicing there.
        let mut fitted = false;
        if let Some([near, far]) = measured {
            let far = far.min(end);
            if depth.perspective && slices > 1 && near > start && far > near * 1.05 {
                let per_doubling = (slices - 1) as f32 / (far / near).log2();
                slicing.per_doubling = per_doubling;
                slicing.start = near * (-1.0 / per_doubling).exp2();
                slicing.unit = slicing.start;
                fitted = true;
            }
        }
        let unit = slicing.unit;
        let mut near = slicing.slice_start(0);
        for (slice, bounds) in self.bounds.iter_mut().enumerate() {
            let far = slicing.slice_start(slice as u32 + 1);
            let low = if fitted && slice == 0 {
                slicing.near
            } else {
                near
            };
            let high = if fitted && slice as u32 + 1 >= slices {
                slicing.end
            } else {
                far
            };
            let margin = MARGIN * (low.abs() + high.abs() + unit);
            *bounds = [low - margin, high + margin];
            near = far;
        }
        // A light reaches the slices whose depths its sphere reaches, a run of them, found with the
        // same test as each slice's tile rectangle starts with.
        let inverse = slicing.inverse_scale;
        let mut work = 0;
        for (span, light) in self.spans.iter_mut().zip(&self.lights) {
            let (depth, r) = (span.depth, light.range);
            span.first = self
                .bounds
                .partition_point(|&[_, far]| (far - depth) * inverse < -r)
                as u32;
            span.end = self
                .bounds
                .partition_point(|&[near, _]| (near - depth) * inverse <= r)
                as u32;
            span.end = span.end.max(span.first);
            work += span.end - span.first;
        }
        if work == 0 {
            return None;
        }
        self.slicing = slicing;
        self.fitted = fitted;
        let chosen = slicing.unit;
        self.uniform = GridUniform {
            depth: [
                rx / chosen,
                ry / chosen,
                rz / chosen,
                (rw - slicing.start) / chosen + 1.0,
            ],
            grid: [
                self.shape.tiles_x as f32,
                self.shape.tiles_y as f32,
                slices as f32,
                slicing.per_doubling,
            ],
        };
        self.write_header(fitted);
        Some(work)
    }

    /// Writes the header's slicing words, which the shaders read to find a position's slice, from
    /// the grid's slicing. On WebGPU the fit's dispatch overwrites them from the reduced depth.
    fn write_header(&mut self, fitted: bool) {
        let [a, b, c, d] = self.uniform.depth;
        let header = &mut self.words[..HEADER_WORDS as usize];
        header[..4].copy_from_slice(&[a.to_bits(), b.to_bits(), c.to_bits(), d.to_bits()]);
        header[HEADER_DOUBLING as usize] = self.slicing.per_doubling.to_bits();
        header[HEADER_FITTED as usize] = if fitted { 1.0f32.to_bits() } else { 0 };
        header[HEADER_START as usize] = self.slicing.start.to_bits();
        header[HEADER_UNIT as usize] = self.slicing.unit.to_bits();
    }

    /// Empties the header, for a grid that lists no light.
    fn zero_header(&mut self) {
        self.words[..HEADER_WORDS as usize].fill(0);
    }

    /// Sets the planes between the tiles' columns and rows from the view-projection matrix.
    fn set_planes(&mut self) {
        let m = &self.view_proj;
        let row = |i: usize| [m[i], m[4 + i], m[8 + i], m[12 + i]];
        let w = row(3);
        let (tiles_x, tiles_y) = (self.shape.tiles_x, self.shape.tiles_y);
        let (columns, rows) = self.planes.split_at_mut(tiles_x as usize + 1);
        for (planes, axis, tiles) in [(columns, row(0), tiles_x), (rows, row(1), tiles_y)] {
            for (i, plane) in planes.iter_mut().enumerate() {
                // Normalized device coordinate `k` along the axis is the plane `axis - k w = 0`.
                let k = 2.0 * i as f32 / tiles as f32 - 1.0;
                let p: [f32; 4] = std::array::from_fn(|c| axis[c] - k * w[c]);
                let length = (p[0] * p[0] + p[1] * p[1] + p[2] * p[2]).sqrt();
                *plane = if length > 0.0 && length.is_finite() {
                    p.map(|v| v / length)
                } else {
                    // A plane that every sphere reaches on both sides.
                    [0.0; 4]
                };
            }
        }
    }

    /// Gives each cluster its place in the index list, from the counts of the first pass, with the
    /// caps applied, and empties the counts for the second pass.
    fn place(&mut self) {
        let clusters = self.shape.clusters();
        let (per_cluster, room) = (self.limits.per_cluster, self.limits.indices);
        let mut used = 0;
        for (word, count) in self.words[HEADER_WORDS as usize..]
            .iter_mut()
            .zip(&mut self.counts)
        {
            let kept = (*count).min(per_cluster).min(room - used);
            *word = if kept == 0 {
                0
            } else {
                (HEADER_WORDS + clusters + used) | (kept << START_BITS)
            };
            used += kept;
            *count = 0;
        }
        self.used = used;
    }

    /// The tiles that a light reaches in a slice, packed as the bytes first column, last column,
    /// first row and last row, or [`NO_TILES`].
    ///
    /// The GPU's passes run the same steps in `light_clusters.wgsl`, so a change here changes the
    /// shader too.
    fn rect(&self, light: &VisibleLight, span: &Span, slice: u32) -> u32 {
        let s = &self.slicing;
        let r = light.range;
        // The part of the sphere inside the slice, as offsets along the view from its center, a
        // little wider than the slice for the GPU's rounding.
        let [near, far] = self.bounds[slice as usize];
        if !reaches_depths([near, far], span.depth, r, s.inverse_scale) {
            return NO_TILES;
        }
        let low = ((near - span.depth) * s.inverse_scale).max(-r);
        let high = ((far - span.depth) * s.inverse_scale).min(r);
        // A sphere around that part: its widest circle, and its half length along the view.
        let widest = low.max(0.0).min(high);
        let half = (high - low) * 0.5;
        let middle = (high + low) * 0.5;
        let squared = (r * r - widest * widest).max(0.0) + half * half;
        let (center, radius) = if squared < r * r {
            let [x, y, z] = light.position;
            let f = s.forward;
            (
                [x + f[0] * middle, y + f[1] * middle, z + f[2] * middle],
                squared.sqrt(),
            )
        } else {
            (light.position, r)
        };
        let [x, y, z] = center;
        let reach = radius * (1.0 + MARGIN) + MARGIN * (x * x + y * y + z * z).sqrt();
        let (columns, rows) = self.planes.split_at(self.shape.tiles_x as usize + 1);
        let (Some((x0, x1)), Some((y0, y1))) = (
            span_of(columns, center, reach),
            span_of(rows, center, reach),
        ) else {
            return NO_TILES;
        };
        u32::from_le_bytes([x0, x1, y0, y1])
    }
}

/// One camera view's light grid: the grid of the view each frame, and what the GPU holds of it.
///
/// The job workers list each cluster's lights, or on WebGPU the GPU does: the CPU then prepares
/// the grid and uploads the light list and [`ClusterParams`] alone.
#[derive(Debug)]
pub(crate) struct ViewLights {
    grid: LightGrid,
    /// True when the GPU lists each cluster's lights.
    on_gpu: bool,
    /// What the GPU's passes read, when they list the lights.
    params: ClusterParams,
    /// The grid's words, or on the GPU its parameters, and the lights, as the GPU holds them
    /// after the last upload.
    held_words: Vec<u32>,
    held_lights: Vec<VisibleLight>,
    held: bool,
    /// The room that uploads take in a frame's arena: a power of two at least as large as the
    /// largest upload so far, so the arenas grow only when the lights reach further than before.
    room: usize,
}

impl ViewLights {
    /// A grid whose clusters' lights the job workers list, or with `on_gpu`, the GPU's light
    /// clustering passes.
    fn with_assignment(limits: LightLimits, on_gpu: bool, fits: bool) -> Self {
        let grid = LightGrid::new(DEFAULT_GRID, limits);
        let words = if on_gpu {
            CLUSTER_PARAMS_BYTES / 4
        } else {
            grid.max_words()
        };
        Self {
            on_gpu,
            params: ClusterParams::default(),
            held_words: Vec::with_capacity(words as usize),
            held_lights: Vec::with_capacity(limits.lights as usize),
            held: false,
            room: 0,
            grid: {
                let mut grid = grid;
                grid.fits = fits;
                grid
            },
        }
    }

    /// Sets the most area lights of one frame, from the next frame on.
    pub(crate) fn set_area_light_cap(&mut self, cap: u32) {
        self.grid.set_area_light_cap(cap);
    }

    /// The grid of the view.
    pub(crate) fn grid(&self) -> &LightGrid {
        &self.grid
    }

    /// Lists the frame's point and spot lights of the view `frame` in its grid, and gives the
    /// view's uniform block the values that find each position's cluster.
    pub(crate) fn assign(
        &mut self,
        jobs: &JobSystem,
        frame: &mut ViewFrame,
        lights: &[VisibleLight],
    ) {
        let view = GridView {
            view_proj: frame.uniform.view_proj,
            depth: frame.depth,
        };
        if self.on_gpu {
            if self.grid.prepare(&view, lights).is_some() {
                self.grid.gpu_params(&mut self.params);
            }
        } else {
            self.grid.assign(jobs, &view, lights);
        }
        self.room = self.room.max(self.upload_bytes().next_power_of_two());
        let uniform = self.grid.uniform();
        frame.uniform.cluster_depth = uniform.depth;
        frame.uniform.cluster_grid = uniform.grid;
        frame.uniform.cluster_fit = [if self.grid.fits { 1.0 } else { 0.0 }, 0.0, 0.0, 0.0];
    }

    /// Leaves the slicing on the CPU's, or lets the GPU fit it to the measured depth, from the
    /// next frame on.
    fn set_fit(&mut self, fits: bool) {
        self.grid.fits = fits;
    }

    /// Writes each listed light's first tile of the shadow atlas into its record, from the tiles
    /// that `tiles` planned for the lights of `shadows`.
    pub(crate) fn mark_shadows(&mut self, tiles: &ShadowTiles, shadows: &[LightShadow]) {
        tiles.mark_lights(&mut self.grid.lights, shadows);
    }

    /// True when the grid lists lights and they differ from what the GPU holds. They count as
    /// held from then on, so the caller uploads them.
    pub(crate) fn take_new(&mut self) -> bool {
        let Self {
            grid,
            on_gpu,
            params,
            held_words,
            held_lights,
            held,
            ..
        } = self;
        let (words, lights) = (held_source(*on_gpu, params, grid), grid.lights());
        if grid.uniform().grid[2] == 0.0
            || (*held && words == &held_words[..] && lights == &held_lights[..])
        {
            return false;
        }
        held_words.clear();
        held_words.extend_from_slice(words);
        held_lights.clear();
        held_lights.extend_from_slice(lights);
        *held = true;
        true
    }

    /// The grid's words, as bytes for an upload.
    pub(crate) fn words_bytes(&self) -> &[u8] {
        words_as_bytes(self.grid.words())
    }

    /// The parameters of the GPU's passes, as bytes for an upload.
    pub(crate) fn params_bytes(&self) -> &[u8] {
        words_as_bytes(self.params.as_words())
    }

    /// The grid's light records, as bytes for an upload.
    pub(crate) fn lights_bytes(&self) -> &[u8] {
        let lights = self.grid.lights();
        // SAFETY: a light record is `repr(C)` and made of 32-bit values only, so it has no padding
        // and every byte of it is initialized.
        unsafe { std::slice::from_raw_parts(lights.as_ptr().cast::<u8>(), size_of_val(lights)) }
    }

    /// The bytes that the next upload copies: the grid's words, or on the GPU its parameters, and
    /// the lights of this frame, or none when the grid lists no light.
    fn upload_bytes(&self) -> usize {
        if self.grid.uniform().grid[2] == 0.0 {
            return 0;
        }
        // WebGL2 uploads the words in whole texels of four.
        (held_source(self.on_gpu, &self.params, &self.grid).len() * 4).next_multiple_of(16)
            + self.lights_bytes().len()
    }

    /// The room to keep in a frame's arena for the upload, at least [`ViewLights::upload_bytes`]
    /// once the frame's lights are assigned.
    pub(crate) fn upload_room(&self) -> usize {
        self.room
    }

    /// Forgets what the GPU holds, after the thread that draws replaced the GPU.
    pub(crate) fn forget_gpu(&mut self) {
        self.held = false;
    }
}

/// A frame builder's light grids, one per camera view. The camera's view has its grid from the
/// start. Every other camera view, such as a scene pass's, gets its own on the first frame that it
/// sees a point or spot light, with the camera's limits, so passes in a scene without such lights
/// cost nothing. A view without a grid lists no light: its uniform block's slices stay 0. A
/// removed view's grid stays for the next view in its place.
#[derive(Debug)]
pub(crate) struct LightGrids {
    /// Each camera view's grid, by view: the camera's first.
    views: Vec<Option<ViewLights>>,
    limits: LightLimits,
    on_gpu: bool,
    /// The point and spot lights that a view other than the camera's sees in the frame, before its
    /// grid takes them.
    seen: Vec<VisibleLight>,
}

impl LightGrids {
    /// The grids of a builder whose job workers list each cluster's lights, or with `on_gpu`, whose
    /// light clustering passes do.
    pub(crate) fn new(limits: LightLimits, on_gpu: bool) -> Self {
        let mut views: Vec<Option<ViewLights>> = (0..MAX_VIEWS).map(|_| None).collect();
        views[ViewId::CAMERA.index()] = Some(ViewLights::with_assignment(limits, on_gpu, true));
        Self {
            views,
            limits,
            on_gpu,
            seen: Vec::new(),
        }
    }

    /// Leaves the camera's slicing on the CPU's, or lets the GPU fit it to the measured depth,
    /// from the next frame on. Another view's grid never fits: its depth differs.
    pub(crate) fn set_fit(&mut self, fits: bool) {
        if let Some(camera) = self.views[ViewId::CAMERA.index()].as_mut() {
            camera.set_fit(fits);
        }
    }

    /// The grid of the camera's view.
    pub(crate) fn camera(&self) -> &ViewLights {
        self.get(ViewId::CAMERA)
            .expect("the camera's view has a light grid")
    }

    /// The grid of camera view `view`, or `None` before the view first sees a light.
    pub(crate) fn get(&self, view: ViewId) -> Option<&ViewLights> {
        self.views.get(view.index())?.as_ref()
    }

    /// Each camera view that has a grid, with it.
    pub(crate) fn iter(&self) -> impl Iterator<Item = (ViewId, &ViewLights)> {
        self.views
            .iter()
            .enumerate()
            .filter_map(|(index, lights)| Some((ViewId::from_index(index), lights.as_ref()?)))
    }

    /// Each camera view that has a grid, with it, to change.
    pub(crate) fn iter_mut(&mut self) -> impl Iterator<Item = (ViewId, &mut ViewLights)> {
        self.views
            .iter_mut()
            .enumerate()
            .filter_map(|(index, lights)| Some((ViewId::from_index(index), lights.as_mut()?)))
    }

    /// Lists the point and spot lights of camera view `view`, whose values for the frame are
    /// `frame`, in its grid, and writes each listed light's tile of the shadow atlas, which `tiles`
    /// planned for the camera's view. The camera's view takes `input`'s visible lights. Any other
    /// view gathers its own from `input`'s light table, with `exposure`, the exposure frames draw
    /// with: a light that only such a view sees has no tile, so it casts no shadow there. A view
    /// gets its grid here, the first time it sees a light.
    pub(crate) fn assign(
        &mut self,
        view: ViewId,
        frame: &mut ViewFrame,
        input: &FrameInput<'_>,
        exposure: f32,
        tiles: &ShadowTiles,
    ) {
        let lights = if view == ViewId::CAMERA {
            input.lights
        } else {
            let Some(table) = input.light_table else {
                return;
            };
            let seen = &mut self.seen;
            seen.clear();
            // Room for every row: more only after the scene created lights.
            seen.reserve(table.rows() as usize);
            let light_view = LightView {
                camera: frame.camera,
                frustum: frame.frustum,
                layers: frame.layers,
            };
            table.gather_view(input.scene, input.parity(), &light_view, exposure, seen);
            &self.seen[..]
        };
        let Some(place) = self.views.get_mut(view.index()) else {
            return;
        };
        if place.is_none() && !lights.is_empty() {
            *place = Some(ViewLights::with_assignment(self.limits, self.on_gpu, false));
        }
        if let Some(grid) = place.as_mut() {
            grid.assign(input.jobs, frame, lights);
            grid.mark_shadows(tiles, input.shadow_lights);
        }
    }

    /// Sets the most area lights that each view's grid shades in one frame, from the next frame on.
    pub(crate) fn set_area_light_cap(&mut self, cap: u32) {
        self.limits.area_lights = cap;
        for (_, lights) in self.iter_mut() {
            lights.set_area_light_cap(cap);
        }
    }

    /// The room to keep in a frame's arena for every grid's upload.
    pub(crate) fn upload_room(&self) -> usize {
        self.iter().map(|(_, lights)| lights.upload_room()).sum()
    }

    /// Forgets what the GPU holds of every grid, after the thread that draws replaced the GPU.
    pub(crate) fn forget_gpu(&mut self) {
        for (_, lights) in self.iter_mut() {
            lights.forget_gpu();
        }
    }
}

/// What the GPU must hold for a frame besides the lights: the grid's words, or when the GPU lists
/// each cluster's lights, the parameters of its passes.
fn held_source<'a>(on_gpu: bool, params: &'a ClusterParams, grid: &'a LightGrid) -> &'a [u32] {
    if on_gpu {
        params.as_words()
    } else {
        grid.words()
    }
}

/// The first and last tiles between consecutive planes of `planes` that a sphere reaches, or
/// `None` when it reaches none.
fn span_of(planes: &[[f32; 4]], center: [f32; 3], reach: f32) -> Option<(u8, u8)> {
    let distance = |p: &[f32; 4]| p[0] * center[0] + p[1] * center[1] + p[2] * center[2] + p[3];
    let mut found = None;
    let mut before = distance(&planes[0]);
    for (tile, plane) in planes[1..].iter().enumerate() {
        let after = distance(plane);
        // The sphere reaches the tile unless it lies wholly before its first plane or wholly
        // after its second.
        if before >= -reach && after <= reach {
            let tile = tile as u8;
            found = Some(found.map_or((tile, tile), |(first, _)| (first, tile)));
        }
        before = after;
    }
    found
}

/// Calls `f` with each tile `(x, y)` of a packed rectangle.
#[inline(always)]
fn for_each_tile(rect: u32, mut f: impl FnMut(usize, usize)) {
    if rect == NO_TILES {
        return;
    }
    let [x0, x1, y0, y1] = rect.to_le_bytes().map(usize::from);
    for y in y0..=y1 {
        for x in x0..=x1 {
            f(x, y);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_shaders_read_the_grid_as_the_grid_writes_it() {
        use null3d_gpu::drawlist::sizes;
        let lights = include_str!("../../null3d-shaders/wgsl/lib/lights.wgsl");
        let shift = |per_row: u32| {
            assert!(per_row.is_power_of_two());
            per_row.trailing_zeros()
        };
        for line in [
            format!("const START_BITS: u32 = {START_BITS}u;"),
            format!("const HEADER_WORDS: u32 = {HEADER_WORDS}u;"),
            format!(
                "const WORD_ROW_SHIFT: u32 = {}u;",
                shift(sizes::GRID_WORDS_PER_TEXTURE_ROW)
            ),
            format!(
                "const LIGHT_ROW_SHIFT: u32 = {}u;",
                shift(sizes::LIGHTS_PER_TEXTURE_ROW)
            ),
            format!("const LIGHT_TEXELS: u32 = {}u;", sizes::LIGHT_RECORD_TEXELS),
            format!(
                "const GRID_COLUMN: u32 = {}u;",
                sizes::LIGHTS_PER_TEXTURE_ROW * sizes::LIGHT_RECORD_TEXELS
            ),
        ] {
            assert!(lights.contains(&line), "lib/lights.wgsl lacks {line}");
        }
        // The shader finds its cluster from the header's slicing, and the start of a cluster's
        // lights fits below the count for every list the limits allow.
        assert_eq!(size_of::<GridUniform>(), 32);
        assert!(HEADER_WORDS + DEFAULT_GRID.clusters() + MAX_INDICES < 1 << START_BITS);
    }

    #[test]
    fn the_light_clustering_shader_reads_the_parameters_as_the_grid_writes_them() {
        use null3d_gpu::drawlist::sizes;
        let shader = include_str!("../../null3d-shaders/wgsl/light_clusters.wgsl");
        for line in [
            format!("const WORKGROUP_SIZE: u32 = {GPU_WORKGROUP_SIZE}u;"),
            format!("const START_BITS: u32 = {START_BITS}u;"),
            format!("const HEADER_WORDS: u32 = {HEADER_WORDS}u;"),
            format!("const MAX_PLANES: u32 = {GPU_MAX_PLANES}u;"),
            format!(
                "const LIGHT_VECTORS: u32 = {}u;",
                sizes::LIGHT_RECORD_BYTES / 16
            ),
            format!("bounds: array<vec4f, {}>,", GPU_MAX_SLICES / 2),
            "planes: array<vec4f, MAX_PLANES>,".to_owned(),
            "fit: vec4f,".to_owned(),
            "plain: vec4f,".to_owned(),
        ] {
            assert!(shader.contains(&line), "light_clusters.wgsl lacks {line}");
        }
        // Five vectors, then the slices' bounds, the planes, the fit's values and the CPU's
        // slicing.
        assert_eq!(
            CLUSTER_PARAMS_BYTES,
            (5 + GPU_MAX_SLICES / 2 + GPU_MAX_PLANES + 2) * 16
        );
        assert!(LightGrid::fits_gpu(DEFAULT_GRID));
    }

    #[test]
    fn clusters_count_across_then_up_then_along() {
        let shape = GridShape {
            tiles_x: 4,
            tiles_y: 3,
            slices: 5,
        };
        assert_eq!(shape.clusters(), 60);
        assert_eq!(shape.cluster(0, 0, 0), 0);
        assert_eq!(shape.cluster(3, 0, 0), 3);
        assert_eq!(shape.cluster(0, 1, 0), 4);
        assert_eq!(shape.cluster(0, 0, 1), 12);
        assert_eq!(shape.cluster(3, 2, 4), 59);
    }

    #[test]
    fn a_sphere_reaches_the_tiles_between_the_planes_it_touches() {
        // Planes x = -1, 0 and 1: two tiles.
        let planes = [
            [1.0, 0.0, 0.0, 1.0],
            [1.0, 0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0, -1.0],
        ];
        assert_eq!(span_of(&planes, [-0.5, 0.0, 0.0], 0.2), Some((0, 0)));
        assert_eq!(span_of(&planes, [0.5, 0.0, 0.0], 0.2), Some((1, 1)));
        assert_eq!(span_of(&planes, [0.1, 0.0, 0.0], 0.2), Some((0, 1)));
        assert_eq!(span_of(&planes, [3.0, 0.0, 0.0], 0.2), None);
        assert_eq!(span_of(&planes, [-1.1, 0.0, 0.0], 0.2), Some((0, 0)));
    }

    #[test]
    fn slices_start_where_their_depths_say() {
        let slicing = Slicing {
            start: 0.5,
            unit: 0.5,
            per_doubling: 2.0,
            end: 10.0,
            near: 0.5,
            far: 100.0,
            perspective: true,
            inverse_scale: 1.0,
            row: [0.0, 0.0, -1.0, 0.0],
            forward: [0.0, 0.0, -1.0],
        };
        for slice in 0..10 {
            let start = slicing.slice_start(slice);
            assert!((slicing.slice_depth(start).log2() * 2.0 - slice as f32).abs() < 1e-5);
            // A slice's depth on its own side of the slice's start.
            let floor = |depth: f32| (slicing.slice_depth(depth).log2() * 2.0).floor();
            assert_eq!(floor(start * 1.001), slice as f32);
        }
    }

    #[test]
    fn a_sphere_reaches_the_depths_its_radius_spans() {
        // Depths 10 to 12 in a view of two units per world unit: one to six world units away.
        let bounds = [10.0, 12.0];
        assert!(reaches_depths(bounds, 8.0, 1.0, 0.5));
        assert!(!reaches_depths(bounds, 7.9, 1.0, 0.5));
        assert!(reaches_depths(bounds, 14.0, 1.0, 0.5));
        assert!(!reaches_depths(bounds, 14.1, 1.0, 0.5));
        assert!(reaches_depths(bounds, 11.0, 0.1, 0.5));
    }
}
