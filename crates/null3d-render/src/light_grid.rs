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
//! The job workers assign the lights slice by slice, in two passes over the same tiles. The first
//! counts each cluster's lights. A prefix sum then gives each cluster its place in the light index
//! list, and the second pass writes the lights' indices there, in the order of the light list.
//! Neither pass allocates: the grid keeps room for the most lights it takes.
//!
//! # Limits
//!
//! [`LightLimits`] caps the lights of one frame, the lights of one cluster and the entries of the
//! index list. Past the frame's cap, the grid keeps the lights whose spheres come nearest the
//! camera. Past a cluster's cap, or the index list's, a cluster keeps the lights that come first
//! in the list, and clusters further along the view lose lights first.
//!
//! # What the shaders read
//!
//! [`LightGrid::lights`] lists the lights in the order the index list numbers them, as the core's
//! 64-byte [`VisibleLight`] records. [`LightGrid::words`] holds one 32-bit word per cluster, then
//! the index list. A cluster's word holds where its lights start in the words in its low
//! [`START_BITS`] bits, and how many there are in the bits above. Clusters count across the tiles
//! of a row first, then up the rows, then along the slices. [`GridUniform`] holds what a shader
//! needs to find a position's cluster: [`LightGrid::cluster_at`] does what the shaders do.

use null3d_core::jobs::JobSystem;
use null3d_core::lights::VisibleLight;
use null3d_core::shared::SharedMut;
use null3d_gpu::drawlist::sizes::LIGHT_RECORD_BYTES;

use crate::camera::{Mat4, ViewDepth};
use crate::frame::words_as_bytes;
use crate::view::ViewFrame;

// The core's light records are what the shaders read.
const _: () = assert!(size_of::<VisibleLight>() == LIGHT_RECORD_BYTES as usize);

/// Bits of a cluster's word that hold where its lights start in the grid's words. The bits above
/// them hold the count.
pub const START_BITS: u32 = 23;
/// The most lights that one cluster lists: the most its word's count holds.
pub const MAX_PER_CLUSTER: u32 = (1 << (32 - START_BITS)) - 1;
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

/// The most lights a grid lists.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LightLimits {
    /// The most lights of one frame, at most [`MAX_LIGHTS`]: the ones nearest the camera when
    /// more are visible.
    pub lights: u32,
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
    /// The first and last slices it reaches: none when `first > last`.
    first: u32,
    last: u32,
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
    /// The length of the depth row's direction: the view's units per world unit.
    scale: f32,
    /// The depth row's direction, of length 1.
    forward: [f32; 3],
}

impl Slicing {
    /// The slice depth of a view depth.
    fn slice_depth(&self, depth: f32) -> f32 {
        (depth - self.start) / self.unit + 1.0
    }

    /// The slice of a view depth, from 0 to `slices - 1`.
    fn slice_of(&self, depth: f32, slices: u32) -> u32 {
        let slice = (self.slice_depth(depth).log2() * self.per_doubling).floor();
        (slice.max(0.0) as u32).min(slices - 1)
    }

    /// The view depth where slice `slice` starts.
    fn slice_start(&self, slice: u32) -> f32 {
        ((slice as f32 / self.per_doubling).exp2() - 1.0) * self.unit + self.start
    }
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
    /// The visible lights in order of nearness, when more than the frame's cap are visible.
    nearest: Vec<u32>,
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
            nearest: Vec::new(),
            rects: vec![NO_TILES; shape.slices as usize * lights],
            counts: vec![0; clusters],
            words: vec![0; clusters + limits.indices as usize],
            used: 0,
            view_proj: [0.0; 16],
            slicing: Slicing::default(),
            uniform: GridUniform::default(),
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

    /// The most words the grid gives the shaders: a word per cluster and the whole index list.
    pub fn max_words(&self) -> u32 {
        self.shape.clusters() + self.limits.indices
    }

    /// The lights the grid lists, as the index list numbers them.
    pub fn lights(&self) -> &[VisibleLight] {
        &self.lights
    }

    /// One word per cluster, then the entries of the index list in use: see the module
    /// documentation.
    pub fn words(&self) -> &[u32] {
        &self.words[..(self.shape.clusters() + self.used) as usize]
    }

    /// The lights that a cluster lists, as indices into [`LightGrid::lights`].
    pub fn cluster_lights(&self, cluster: u32) -> &[u32] {
        let word = self.words[cluster as usize];
        let start = (word & ((1 << START_BITS) - 1)) as usize;
        &self.words[start..start + (word >> START_BITS) as usize]
    }

    /// What the shaders read to find a position's cluster.
    pub fn uniform(&self) -> GridUniform {
        self.uniform
    }

    /// The cluster of a position relative to the camera, as the shaders find it, or `None` when
    /// the position lies beyond the last slice or the grid lists no light.
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
        let slice = (slice_depth.log2() * per_doubling).floor().max(0.0);
        (slice < slices).then(|| self.shape.cluster(x as u32, y as u32, slice as u32))
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
        if slice < span.first || slice > span.last {
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
        self.choose(visible);
        self.used = 0;
        self.view_proj = view.view_proj;
        let Some(work) = self.slice(&view.depth) else {
            self.uniform = GridUniform::default();
            return;
        };
        self.set_planes();
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
                    *rect = if (span.first..=span.last).contains(&slice) {
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
                        let word = unsafe { words.read(s * tiles + tile) };
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

    /// Copies the lights the frame lists: all of `visible`, or past the frame's cap, the ones whose
    /// spheres come nearest the camera, in the order of `visible`.
    fn choose(&mut self, visible: &[VisibleLight]) {
        let cap = self.limits.lights as usize;
        self.lights.clear();
        if visible.len() <= cap {
            self.lights.extend_from_slice(visible);
            return;
        }
        if cap == 0 {
            return;
        }
        let nearest = &mut self.nearest;
        nearest.clear();
        if nearest.try_reserve(visible.len()).is_err() {
            // Without room to rank them, the first lights stay.
            self.lights.extend_from_slice(&visible[..cap]);
            return;
        }
        nearest.extend(0..visible.len() as u32);
        let near_edge = |i: &u32| {
            let light = &visible[*i as usize];
            let [x, y, z] = light.position;
            (x * x + y * y + z * z).sqrt() - light.range
        };
        nearest.select_nth_unstable_by(cap - 1, |a, b| near_edge(a).total_cmp(&near_edge(b)));
        nearest[..cap].sort_unstable();
        self.lights
            .extend(nearest[..cap].iter().map(|&i| visible[i as usize]));
    }

    /// Sets the slices for the frame's lights, and each light's span of slices. Returns the slices
    /// that the lights reach in all, or `None` when no light reaches the view's depth, so the grid
    /// lists none.
    fn slice(&mut self, depth: &ViewDepth) -> Option<u32> {
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
        let mut end = start;
        for (span, light) in self.spans.iter_mut().zip(&self.lights) {
            let [x, y, z] = light.position;
            span.depth = rx * x + ry * y + rz * z + rw;
            span.reach = light.range * scale;
            end = end.max(span.depth + span.reach);
        }
        let end = end.min(depth.far);
        if end <= start {
            return None;
        }
        // At least a little depth, so the logarithm of the last slice's end is above 0.
        let end = end.max(start + unit * 1e-3);
        let mut slicing = Slicing {
            start,
            unit,
            per_doubling: 1.0,
            scale,
            forward: [rx / scale, ry / scale, rz / scale],
        };
        let slices = self.shape.slices;
        slicing.per_doubling = slices as f32 / slicing.slice_depth(end).log2();
        let mut work = 0;
        for span in &mut self.spans[..self.lights.len()] {
            let (near, far) = (span.depth - span.reach, span.depth + span.reach);
            (span.first, span.last) = if far < start || near > end {
                (1, 0)
            } else {
                (
                    slicing.slice_of(near.max(start), slices),
                    slicing.slice_of(far.min(end), slices),
                )
            };
            work += (span.last + 1).saturating_sub(span.first);
        }
        self.slicing = slicing;
        self.uniform = GridUniform {
            depth: [rx / unit, ry / unit, rz / unit, (rw - start) / unit + 1.0],
            grid: [
                self.shape.tiles_x as f32,
                self.shape.tiles_y as f32,
                slices as f32,
                slicing.per_doubling,
            ],
        };
        Some(work)
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
        for (word, count) in self.words.iter_mut().zip(&mut self.counts) {
            let kept = (*count).min(per_cluster).min(room - used);
            *word = if kept == 0 {
                0
            } else {
                (clusters + used) | (kept << START_BITS)
            };
            used += kept;
            *count = 0;
        }
        self.used = used;
    }

    /// The tiles that a light reaches in a slice, packed as the bytes first column, last column,
    /// first row and last row, or [`NO_TILES`].
    fn rect(&self, light: &VisibleLight, span: &Span, slice: u32) -> u32 {
        let s = &self.slicing;
        let r = light.range;
        // The part of the sphere inside the slice, as offsets along the view from its center, a
        // little wider than the slice for the GPU's rounding.
        let (start, end) = (s.slice_start(slice), s.slice_start(slice + 1));
        let margin = MARGIN * (start.abs() + end.abs() + s.unit);
        let low = ((start - margin - span.depth) / s.scale).max(-r);
        let high = ((end + margin - span.depth) / s.scale).min(r);
        if low > high {
            return NO_TILES;
        }
        // A sphere around that part: its widest circle, and its half length along the view.
        let widest = low.max(0.0).min(high);
        let half = (high - low) / 2.0;
        let middle = (high + low) / 2.0;
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

/// A frame builder's light grid: the grid of the camera's view each frame, and what the GPU holds
/// of it. Only the camera's view lists point and spot lights: every other view's uniform block
/// says that its grid lists none.
#[derive(Debug)]
pub(crate) struct CameraLights {
    grid: LightGrid,
    /// The grid's words and lights as the GPU holds them, after the last upload.
    held_words: Vec<u32>,
    held_lights: Vec<VisibleLight>,
    held: bool,
    /// The room that uploads take in a frame's arena: a power of two at least as large as the
    /// largest upload so far, so the arenas grow only when the lights reach further than before.
    room: usize,
}

impl CameraLights {
    pub(crate) fn new(limits: LightLimits) -> Self {
        let grid = LightGrid::new(DEFAULT_GRID, limits);
        Self {
            held_words: Vec::with_capacity(grid.max_words() as usize),
            held_lights: Vec::with_capacity(limits.lights as usize),
            held: false,
            room: 0,
            grid,
        }
    }

    /// The grid of the camera's view.
    pub(crate) fn grid(&self) -> &LightGrid {
        &self.grid
    }

    /// Lists the frame's point and spot lights in the grid of the camera's view, `frame`, and
    /// gives the view's uniform block the values that find each position's cluster.
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
        self.grid.assign(jobs, &view, lights);
        self.room = self.room.max(self.upload_bytes().next_power_of_two());
        let uniform = self.grid.uniform();
        frame.uniform.cluster_depth = uniform.depth;
        frame.uniform.cluster_grid = uniform.grid;
    }

    /// True when the grid lists lights and they differ from what the GPU holds. They count as
    /// held from then on, so the caller uploads them.
    pub(crate) fn take_new(&mut self) -> bool {
        let (words, lights) = (self.grid.words(), self.grid.lights());
        if self.grid.uniform().grid[2] == 0.0
            || (self.held && words == &self.held_words[..] && lights == &self.held_lights[..])
        {
            return false;
        }
        self.held_words.clear();
        self.held_words.extend_from_slice(words);
        self.held_lights.clear();
        self.held_lights.extend_from_slice(lights);
        self.held = true;
        true
    }

    /// The grid's words, as bytes for an upload.
    pub(crate) fn words_bytes(&self) -> &[u8] {
        words_as_bytes(self.grid.words())
    }

    /// The grid's light records, as bytes for an upload.
    pub(crate) fn lights_bytes(&self) -> &[u8] {
        let lights = self.grid.lights();
        // SAFETY: a light record is `repr(C)` and made of 32-bit values only, so it has no padding
        // and every byte of it is initialized.
        unsafe { std::slice::from_raw_parts(lights.as_ptr().cast::<u8>(), size_of_val(lights)) }
    }

    /// The bytes that the next upload copies: the grid's words and lights of this frame, or none
    /// when the grid lists no light.
    fn upload_bytes(&self) -> usize {
        if self.grid.uniform().grid[2] == 0.0 {
            return 0;
        }
        self.words_bytes().len() + self.lights_bytes().len()
    }

    /// The room to keep in a frame's arena for the upload, at least [`CameraLights::upload_bytes`]
    /// once the frame's lights are assigned.
    pub(crate) fn upload_room(&self) -> usize {
        self.room
    }

    /// Forgets what the GPU holds, after the thread that draws replaced the GPU.
    pub(crate) fn forget_gpu(&mut self) {
        self.held = false;
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
            format!(
                "const WORD_ROW_SHIFT: u32 = {}u;",
                shift(sizes::INDICES_PER_TEXTURE_ROW)
            ),
            format!(
                "const LIGHT_ROW_SHIFT: u32 = {}u;",
                shift(sizes::LIGHTS_PER_TEXTURE_ROW)
            ),
        ] {
            assert!(lights.contains(&line), "lib/lights.wgsl lacks {line}");
        }
        // The shader finds its cluster from the frame's two vectors, and the start of a
        // cluster's lights fits below the count for every list the limits allow.
        assert_eq!(size_of::<GridUniform>(), 32);
        assert!(DEFAULT_GRID.clusters() + MAX_INDICES < 1 << START_BITS);
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
            scale: 1.0,
            forward: [0.0, 0.0, -1.0],
        };
        for slice in 0..10 {
            let start = slicing.slice_start(slice);
            assert!((slicing.slice_depth(start).log2() * 2.0 - slice as f32).abs() < 1e-5);
            assert_eq!(slicing.slice_of(start * 1.001, 20), slice);
        }
        assert_eq!(slicing.slice_of(0.1, 20), 0);
        assert_eq!(slicing.slice_of(1e9, 20), 19);
    }
}
