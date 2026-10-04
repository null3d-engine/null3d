//! Software occlusion culling: the job workers draw blocker meshes into a small depth buffer, and
//! culling then hides each object whose bounding sphere lies behind it.
//!
//! The method follows Intel's masked software occlusion culling. The buffer is a grid of
//! subtiles of 8 x 4 pixels. Each subtile keeps two layers: a depth that covers the whole subtile,
//! and a working layer of a coverage mask, one bit per pixel, with the farthest depth of what the
//! mask covers. A blocker's coverage joins the working layer, and when the mask fills, the working
//! layer's depth becomes the depth of the whole subtile. A blocker far behind the working layer
//! starts a new working layer instead. Blocks of 4 x 4 subtiles keep the farthest depth of their
//! subtiles, so a large object is tested a block at a time. Only the depths that cover whole
//! subtiles hide objects.
//!
//! # Depth
//!
//! Depth is clip-space z over w, as the engine's projections give it: 1 at the near plane, and
//! smaller farther away. It is affine across the screen for both perspective and orthographic
//! lenses, so a triangle's depth is a plane in pixel coordinates. A larger depth is nearer.
//!
//! # Conservative coverage
//!
//! The buffer never hides an object that a depth buffer of any finer resolution would show. A
//! pixel counts as covered by a blocker only when its whole square lies inside the blocker's
//! outline on the screen, and its depth is the farthest depth of the blocker anywhere in the
//! subtile:
//!
//! - Each blocker draws on its own into a scratch mask, with each pixel tested at its center.
//!   Neighbouring triangles share edges, so their union covers the blocker's outline without
//!   cracks.
//! - The pixels that the blocker's outline touches are then cleared. Its outline lies on the
//!   edges that join a drawn triangle to an undrawn one, on edges that fold back on the screen,
//!   on open edges, and where the near plane cuts the blocker. A pixel whose center lies inside
//!   and whose square no outline edge touches lies wholly inside.
//! - Each subtile's depth is the farthest depth, over the subtile, of every triangle that touches
//!   it, bounded by the triangle's farthest corner.
//!
//! A closed mesh draws only the triangles that face the camera, whose union is the whole shape's
//! outline. An open mesh draws the faces that its material draws.
//!
//! # Threads
//!
//! [`OcclusionBuffer::draw`] runs in two steps on the calling thread and the job workers. First
//! each blocker moves its corners into clip space, four at a time with SIMD, clips its triangles
//! at the near plane, and lists its outline edges. Then each band of 16 pixel rows draws every
//! blocker that reaches it, nearest first, into its own rows of the buffer. Bands write disjoint
//! parts of the buffer, so no thread waits for another. Setup runs in 64-bit floats, so blockers
//! that reach far past the screen's edges keep their precision without clipping at those edges.
//!
//! # Memory
//!
//! The buffer and its scratch space grow only when the target's shape changes, or when a frame
//! draws more blocker corners, triangles or edges than any frame before. Frames otherwise
//! allocate nothing.

use std::collections::{HashMap, TryReserveError};
use std::simd::prelude::*;

use crate::bvh::mesh::Triangles;
use crate::culling::shuffle_bytes;
use crate::jobs::JobSystem;
use crate::shared::SharedMut;

/// Pixels across a subtile: one byte of its coverage mask.
pub const SUBTILE_WIDTH: u32 = 8;
/// Pixel rows of a subtile: the four bytes of its coverage mask.
pub const SUBTILE_HEIGHT: u32 = 4;
/// Pixel rows of a band, which one thread draws: one row of blocks.
const BAND_HEIGHT: u32 = 16;
/// Subtiles across a block, and down it.
const BLOCK_SUBTILES_X: u32 = 4;
const BLOCK_SUBTILES_Y: u32 = BAND_HEIGHT / SUBTILE_HEIGHT;
/// Pixels across a row word of a band's scratch mask: four subtiles.
const WORD_PIXELS: u32 = 32;
/// The pixels that the buffer holds about, for any shape of target.
pub const TARGET_PIXELS: u32 = 256 * 144;
/// The most triangles that one blocker mesh may have. A larger mesh blocks nothing.
pub const MAX_BLOCKER_TRIANGLES: u32 = 4096;
/// A coverage mask whose every pixel is covered.
const FULL: u32 = u32::MAX;
/// The depth of a subtile that nothing covers: farther than anything.
const UNCOVERED: f32 = f32::NEG_INFINITY;
/// The second triangle of an edge that only one triangle uses.
const NO_TRIANGLE: u32 = u32::MAX;
/// Distance in pixels that outline edges and touch tests widen by, for rounding.
const PIXEL_EPS: f64 = 1e-4;
/// The relative size under which a triangle's orientation counts as edge-on.
const EDGE_ON: f64 = 1e-9;
/// Twice the area in square pixels under which a clipped triangle draws nothing.
const MIN_AREA: f64 = 1e-8;

/// An edge of a blocker mesh: its two corners, the triangles on each side, and whether the two
/// triangles run along it in opposite directions, as a mesh with consistent winding does.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Edge {
    a: u32,
    b: u32,
    t0: u32,
    /// [`NO_TRIANGLE`] for an edge of one triangle, or of more than two.
    t1: u32,
    opposite: bool,
}

/// A mesh that blocks the view: its corners welded where positions match, its triangles, and
/// the edges between them.
#[derive(Clone, Debug, Default)]
pub struct BlockerMesh {
    /// Corner positions as three arrays, padded with zeros to a multiple of four.
    xs: Vec<f32>,
    ys: Vec<f32>,
    zs: Vec<f32>,
    corners: u32,
    triangles: Vec<[u32; 3]>,
    edges: Vec<Edge>,
    /// True when every edge joins two triangles that run along it in opposite directions.
    closed: bool,
}

impl BlockerMesh {
    /// A blocker from a mesh's triangles, or `None` for a mesh with no triangles, more than
    /// [`MAX_BLOCKER_TRIANGLES`], or a corner that is not finite. Corners at the same position
    /// weld into one, so triangles that share a position share an edge, and triangles whose
    /// corners weld together are left out.
    pub fn build(mesh: &impl Triangles) -> Option<BlockerMesh> {
        let count = mesh.count();
        if count == 0 || count > MAX_BLOCKER_TRIANGLES {
            return None;
        }
        let mut welded: HashMap<[u32; 3], u32> = HashMap::new();
        let (mut xs, mut ys, mut zs) = (Vec::new(), Vec::new(), Vec::new());
        let mut triangles = Vec::with_capacity(count as usize);
        for t in 0..count {
            let mut ids = [0; 3];
            for (id, corner) in ids.iter_mut().zip(mesh.triangle(t)) {
                if !corner.iter().all(|v| v.is_finite()) {
                    return None;
                }
                // -0 and 0 are one position.
                let key = corner.map(|v| (v + 0.0).to_bits());
                *id = *welded.entry(key).or_insert_with(|| {
                    xs.push(corner[0]);
                    ys.push(corner[1]);
                    zs.push(corner[2]);
                    xs.len() as u32 - 1
                });
            }
            if ids[0] != ids[1] && ids[1] != ids[2] && ids[2] != ids[0] {
                triangles.push(ids);
            }
        }
        if triangles.is_empty() {
            return None;
        }
        let corners = xs.len() as u32;
        let padded = xs.len().next_multiple_of(4);
        for v in [&mut xs, &mut ys, &mut zs] {
            v.resize(padded, 0.0);
        }
        let (edges, closed) = edges_of(&triangles);
        Some(BlockerMesh {
            xs,
            ys,
            zs,
            corners,
            triangles,
            edges,
            closed,
        })
    }

    /// The number of triangles.
    pub fn triangle_count(&self) -> u32 {
        self.triangles.len() as u32
    }

    /// The number of corners after welding.
    pub fn corner_count(&self) -> u32 {
        self.corners
    }

    /// The number of edges, one per pair of triangles that share it.
    pub fn edge_count(&self) -> u32 {
        self.edges.len() as u32
    }

    /// True when the mesh is closed: every edge joins two triangles that run along it in opposite
    /// directions.
    pub fn is_closed(&self) -> bool {
        self.closed
    }
}

/// The edges of welded triangles, and whether they close the mesh.
fn edges_of(triangles: &[[u32; 3]]) -> (Vec<Edge>, bool) {
    // Each triangle's three edges as (lower corner, higher corner, triangle, runs upward).
    let mut sides: Vec<(u32, u32, u32, bool)> = Vec::with_capacity(triangles.len() * 3);
    for (t, tri) in triangles.iter().enumerate() {
        for k in 0..3 {
            let (a, b) = (tri[k], tri[(k + 1) % 3]);
            sides.push((a.min(b), a.max(b), t as u32, a < b));
        }
    }
    sides.sort_unstable();
    let mut edges = Vec::with_capacity(sides.len() / 2 + 1);
    let mut closed = true;
    let mut i = 0;
    while i < sides.len() {
        let (a, b) = (sides[i].0, sides[i].1);
        let mut end = i + 1;
        while end < sides.len() && sides[end].0 == a && sides[end].1 == b {
            end += 1;
        }
        if end - i == 2 {
            let opposite = sides[i].3 != sides[i + 1].3;
            closed &= opposite;
            edges.push(Edge {
                a,
                b,
                t0: sides[i].2,
                t1: sides[i + 1].2,
                opposite,
            });
        } else {
            // An open edge, or one that more than two triangles share: each triangle's side
            // stands alone, and is part of the outline wherever its triangle draws.
            closed = false;
            for side in &sides[i..end] {
                edges.push(Edge {
                    a,
                    b,
                    t0: side.2,
                    t1: NO_TRIANGLE,
                    opposite: true,
                });
            }
        }
        i = end;
    }
    (edges, closed)
}

/// One blocker of a frame: the place of its mesh in the list that [`OcclusionBuffer::draw`]
/// takes, the matrix from the mesh's space to clip space, and whether its material draws both
/// faces of each triangle.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Blocker {
    /// The mesh's index in the list of blocker meshes.
    pub mesh: u32,
    /// The mesh's space to clip space, column-major.
    pub clip: [f32; 16],
    /// True when the material draws both faces of each triangle.
    pub double_sided: bool,
}

/// The matrix from an object's space to clip space: a view-projection matrix for positions
/// relative to the camera, after the object's world matrix, a row-major 3 x 4 matrix relative
/// to its cell, moved by the offset from the camera to that cell.
pub fn clip_matrix(view_proj: &[f32; 16], world: &[f32; 12], offset: [f32; 3]) -> [f32; 16] {
    // The world matrix as 4 x 4 column-major, relative to the camera.
    let w = [
        world[0],
        world[4],
        world[8],
        0.0,
        world[1],
        world[5],
        world[9],
        0.0,
        world[2],
        world[6],
        world[10],
        0.0,
        world[3] + offset[0],
        world[7] + offset[1],
        world[11] + offset[2],
        1.0,
    ];
    let mut out = [0.0; 16];
    for column in 0..4 {
        for row in 0..4 {
            out[column * 4 + row] = (0..4)
                .map(|k| view_proj[k * 4 + row] * w[column * 4 + k])
                .sum();
        }
    }
    out
}

/// A clipped triangle on the screen, in pixels: its three or four corners in order, each edge's
/// bound on the pixels of a row, the plane of its depth, `(dx, dy, at origin)`, its farthest
/// depth, and the pixels its box may touch.
#[derive(Clone, Copy, Debug, Default)]
struct Polygon {
    points: [[f64; 2]; 4],
    /// For each edge, from corner `i` to the next, x's change per unit of y, or infinity for a
    /// level edge.
    slopes: [f64; 4],
    /// For each edge, the pixel index at a row's center `y` where its inside starts or ends:
    /// `k y + m`, a lower bound for a positive side and an upper bound for a negative one. A
    /// level edge, side 0, holds `(b, c)` instead: its row is inside when `b y + c >= 0`.
    spans: [[f64; 2]; 4],
    sides: [i8; 4],
    edge_count: u32,
    plane: [f64; 3],
    far: f64,
    near: f64,
    x0: u32,
    x1: u32,
    y0: u32,
    y1: u32,
}

/// One blocker's part of the frame's lists: where its polygons and outline edges start, how
/// many it drew, and the pixels its polygons may touch.
#[derive(Clone, Copy, Debug, Default)]
struct Drawn {
    first_corner: u32,
    first_triangle: u32,
    first_polygon: u32,
    polygons: u32,
    first_segment: u32,
    segments: u32,
    /// The nearest depth of its polygons, rounded toward the camera.
    near: f32,
    x0: u32,
    x1: u32,
    y0: u32,
    y1: u32,
}

/// A band's scratch space: one blocker's coverage of the band's rows, a row of words per pixel
/// row, and its depth per subtile.
#[derive(Clone, Debug, Default)]
struct BandScratch {
    rows: Vec<u32>,
    depths: Vec<f32>,
}

/// The size of the buffer in pixels and how clip space maps onto it.
#[derive(Clone, Copy, Debug)]
struct Screen {
    width: f64,
    height: f64,
}

impl Screen {
    /// A point in clip space, in front of the near plane, as pixel x, pixel y downward, and depth.
    #[inline(always)]
    fn project(&self, p: [f64; 4]) -> [f64; 3] {
        let inv = 1.0 / p[3];
        [
            (p[0] * inv + 1.0) * 0.5 * self.width,
            (1.0 - p[1] * inv) * 0.5 * self.height,
            p[2] * inv,
        ]
    }
}

/// The masked depth buffer that blockers draw into, and the test that hides objects behind it.
/// See the module's notes.
#[derive(Clone, Debug, Default)]
pub struct OcclusionBuffer {
    width: u32,
    height: u32,
    tiles_x: u32,
    tiles_y: u32,
    /// Each subtile's depth over its whole area.
    near: Vec<f32>,
    /// Each subtile's working layer: its depth, and its coverage mask.
    layer: Vec<f32>,
    masks: Vec<u32>,
    /// Each block's farthest depth over its whole area.
    blocks: Vec<f32>,
    /// Each band's nearest whole-subtile depth.
    band_nearest: Vec<f32>,
    /// The nearest whole-subtile depth of the frame.
    nearest: f32,
    /// The view-projection matrix's rows, and the lengths of their first three entries.
    rows: [[f32; 4]; 4],
    lengths: [f32; 4],
    /// True once a frame drew a blocker that covers a whole subtile.
    active: bool,
    // The frame's lists, which grow only.
    corners: Vec<[f32; 4]>,
    codes: Vec<i8>,
    drawn: Vec<Drawn>,
    polygons: Vec<Polygon>,
    segments: Vec<[f64; 4]>,
    bands: Vec<BandScratch>,
    /// The blockers and triangles that the last frame drew.
    drawn_blockers: u32,
    drawn_polygons: u32,
}

/// Makes `v` at least `len` long, with default elements.
fn grow<T: Clone + Default>(v: &mut Vec<T>, len: usize) -> Result<(), TryReserveError> {
    if v.len() < len {
        v.try_reserve_exact(len - v.len())?;
        v.resize(len, T::default());
    }
    Ok(())
}

/// The nearest `f32` at or below `v`: rounding that never makes a depth nearer.
#[inline(always)]
fn round_far(v: f64) -> f32 {
    let f = v as f32;
    if f64::from(f) > v { f.next_down() } else { f }
}

impl OcclusionBuffer {
    /// An empty buffer, which hides nothing until a frame draws into it.
    pub fn new() -> Self {
        Self::default()
    }

    /// The buffer's size in pixels.
    pub fn size(&self) -> (u32, u32) {
        (self.width, self.height)
    }

    /// The buffer's size for a target of `width` x `height` pixels: about [`TARGET_PIXELS`] of
    /// the same shape, whole subtile columns and whole bands.
    pub fn size_for(width: u32, height: u32) -> (u32, u32) {
        let aspect = f64::from(width.max(1)) / f64::from(height.max(1));
        let round = |v: f64, step: u32| ((v / f64::from(step)).round() as u32).max(1) * step;
        let w = round((f64::from(TARGET_PIXELS) * aspect).sqrt(), WORD_PIXELS).min(1024);
        let h = round(f64::from(w) / aspect, BAND_HEIGHT).min(1024);
        (w, h)
    }

    /// Takes the size [`OcclusionBuffer::size_for`] gives a target of `width` x `height` pixels.
    /// Memory grows only when the size changes.
    pub fn resize(&mut self, width: u32, height: u32) -> Result<(), TryReserveError> {
        let (w, h) = Self::size_for(width, height);
        if (w, h) == (self.width, self.height) {
            return Ok(());
        }
        let (tiles_x, tiles_y) = (w / SUBTILE_WIDTH, h / SUBTILE_HEIGHT);
        let tiles = (tiles_x * tiles_y) as usize;
        let bands = (h / BAND_HEIGHT) as usize;
        grow(&mut self.near, tiles)?;
        grow(&mut self.layer, tiles)?;
        grow(&mut self.masks, tiles)?;
        grow(
            &mut self.blocks,
            (tiles_x / BLOCK_SUBTILES_X) as usize * bands,
        )?;
        grow(&mut self.band_nearest, bands)?;
        grow(&mut self.bands, bands)?;
        for band in &mut self.bands {
            grow(&mut band.rows, (BAND_HEIGHT * w / WORD_PIXELS) as usize)?;
            grow(&mut band.depths, (BLOCK_SUBTILES_Y * tiles_x) as usize)?;
        }
        (self.width, self.height, self.tiles_x, self.tiles_y) = (w, h, tiles_x, tiles_y);
        self.active = false;
        Ok(())
    }

    /// Forgets what the buffer holds, so it hides nothing.
    pub fn clear(&mut self) {
        self.active = false;
        self.drawn_blockers = 0;
        self.drawn_polygons = 0;
    }

    /// True while the buffer may hide objects.
    pub fn is_active(&self) -> bool {
        self.active
    }

    /// The blockers with a triangle on the screen, and their triangles after clipping, in the
    /// last frame.
    pub fn drawn(&self) -> (u32, u32) {
        (self.drawn_blockers, self.drawn_polygons)
    }

    /// The depth that covers the whole subtile at pixel `(x, y)`, or negative infinity where
    /// nothing covers it.
    pub fn subtile_depth(&self, x: u32, y: u32) -> f32 {
        let (sx, sy) = (x / SUBTILE_WIDTH, y / SUBTILE_HEIGHT);
        if !self.active || sx >= self.tiles_x || sy >= self.tiles_y {
            return UNCOVERED;
        }
        self.near[(sy * self.tiles_x + sx) as usize]
    }

    /// Draws `blockers`, nearest first, into the buffer, on the calling thread and the job
    /// workers. `view_proj` is the view-projection matrix for positions relative to the camera,
    /// which [`OcclusionBuffer::hides`] then projects spheres with. Each blocker's mesh is
    /// `meshes[blocker.mesh]`. Fails only when memory cannot grow for more blocker corners,
    /// triangles or edges than any frame drew before; the buffer then hides nothing.
    ///
    /// # Panics
    /// When the buffer has no size yet, or a blocker names a mesh past `meshes`.
    pub fn draw(
        &mut self,
        jobs: &JobSystem,
        view_proj: &[f32; 16],
        meshes: &[BlockerMesh],
        blockers: &[Blocker],
    ) -> Result<(), TryReserveError> {
        assert!(self.width > 0, "the occlusion buffer has no size");
        self.clear();
        for (i, row) in self.rows.iter_mut().enumerate() {
            *row = [
                view_proj[i],
                view_proj[4 + i],
                view_proj[8 + i],
                view_proj[12 + i],
            ];
        }
        self.lengths = self.rows.map(|[x, y, z, _]| (x * x + y * y + z * z).sqrt());
        if blockers.is_empty() {
            return Ok(());
        }
        self.reserve(meshes, blockers)?;

        // Step 1: each blocker's polygons and outline edges, in its own part of the lists.
        let screen = Screen {
            width: f64::from(self.width),
            height: f64::from(self.height),
        };
        let corners = SharedMut::new(&mut self.corners);
        let codes = SharedMut::new(&mut self.codes);
        let polygons = SharedMut::new(&mut self.polygons);
        let segments = SharedMut::new(&mut self.segments);
        let drawn = SharedMut::new(&mut self.drawn);
        jobs.parallel_for(blockers.len() as u32, 4, &|range, _| {
            for k in range {
                let blocker = &blockers[k as usize];
                let mesh = &meshes[blocker.mesh as usize];
                // SAFETY: each blocker writes only its own entry and its own parts of the lists,
                // which `reserve` laid out without overlap.
                unsafe {
                    let entry = &mut drawn.slice(k as usize, 1)[0];
                    let triangles = mesh.triangles.len();
                    prepare(
                        mesh,
                        blocker,
                        screen,
                        corners.slice(entry.first_corner as usize, mesh.corners as usize),
                        codes.slice(entry.first_triangle as usize, triangles),
                        polygons.slice(entry.first_polygon as usize, triangles),
                        segments.slice(entry.first_segment as usize, mesh.edges.len() + triangles),
                        entry,
                    );
                }
            }
        });
        self.drawn_blockers = self.drawn[..blockers.len()]
            .iter()
            .filter(|d| d.polygons > 0)
            .count() as u32;
        self.drawn_polygons = self.drawn[..blockers.len()]
            .iter()
            .map(|d| d.polygons)
            .sum();

        // Step 2: each band draws every blocker that reaches it into its own rows.
        let bands = self.height / BAND_HEIGHT;
        let tiles_x = self.tiles_x as usize;
        let band_tiles = tiles_x * BLOCK_SUBTILES_Y as usize;
        let blocks_x = tiles_x / BLOCK_SUBTILES_X as usize;
        let near = SharedMut::new(&mut self.near);
        let layer = SharedMut::new(&mut self.layer);
        let masks = SharedMut::new(&mut self.masks);
        let blocks = SharedMut::new(&mut self.blocks);
        let band_nearest = SharedMut::new(&mut self.band_nearest);
        let scratch = SharedMut::new(&mut self.bands);
        let lists = Lists {
            drawn: &self.drawn[..blockers.len()],
            polygons: &self.polygons,
            segments: &self.segments,
        };
        let width = self.width;
        jobs.parallel_for(bands, 1, &|range, _| {
            for band in range {
                let b = band as usize;
                // SAFETY: each band writes only its own rows of subtiles, its own row of blocks,
                // its own nearest depth and its own scratch space.
                unsafe {
                    let mut out = BandOut {
                        near: near.slice(b * band_tiles, band_tiles),
                        layer: layer.slice(b * band_tiles, band_tiles),
                        masks: masks.slice(b * band_tiles, band_tiles),
                    };
                    let scratch = &mut scratch.slice(b, 1)[0];
                    draw_band(band, width, &lists, scratch, &mut out);
                    let (row, nearest) = summarize(&out, tiles_x);
                    blocks
                        .slice(b * blocks_x, blocks_x)
                        .copy_from_slice(&row[..blocks_x]);
                    band_nearest.write(b, nearest);
                }
            }
        });
        self.nearest = self.band_nearest[..bands as usize]
            .iter()
            .copied()
            .fold(UNCOVERED, f32::max);
        self.active = self.nearest > UNCOVERED;
        Ok(())
    }

    /// Lays out each blocker's part of the frame's lists, growing them when they are too short.
    fn reserve(
        &mut self,
        meshes: &[BlockerMesh],
        blockers: &[Blocker],
    ) -> Result<(), TryReserveError> {
        grow(&mut self.drawn, blockers.len())?;
        let (mut corners, mut triangles, mut segments) = (0u32, 0u32, 0u32);
        for (entry, blocker) in self.drawn.iter_mut().zip(blockers) {
            let mesh = &meshes[blocker.mesh as usize];
            *entry = Drawn {
                first_corner: corners,
                first_triangle: triangles,
                first_polygon: triangles,
                first_segment: segments,
                ..Drawn::default()
            };
            corners += mesh.corners;
            triangles += mesh.triangle_count();
            // An outline edge for each edge, and a near-plane edge for each clipped triangle.
            segments += mesh.edge_count() + mesh.triangle_count();
        }
        grow(&mut self.corners, corners as usize)?;
        grow(&mut self.codes, triangles as usize)?;
        grow(&mut self.polygons, triangles as usize)?;
        grow(&mut self.segments, segments as usize)
    }

    /// True when a sphere lies wholly behind what the buffer covers, so the frame need not draw
    /// what it bounds. `center` is relative to the camera, in the space of the view-projection
    /// matrix that the last [`OcclusionBuffer::draw`] took. A sphere that reaches the camera's
    /// plane, or whose bounds leave the buffer's grid of numbers, is never hidden.
    pub fn hides(&self, center: [f32; 3], radius: f32) -> bool {
        let [x, y, z] = center.map(f32x4::splat);
        self.hidden4(x, y, z, f32x4::splat(radius)) & 1 != 0
    }

    /// [`OcclusionBuffer::hides`] for four spheres, one per lane: a bit per lane, set for each
    /// hidden sphere. A lane with a negative radius is never hidden.
    pub fn hidden4(&self, xs: f32x4, ys: f32x4, zs: f32x4, radii: f32x4) -> u32 {
        if !self.active {
            return 0;
        }
        let splat = f32x4::splat;
        let row = |[a, b, c, d]: [f32; 4]| splat(a) * xs + splat(b) * ys + splat(c) * zs + splat(d);
        let [cx, cy, cz, cw] = self.rows.map(row);
        let [lx, ly, lz, lw] = self.lengths.map(|l| splat(l) * radii);
        let (w_min, w_max) = (cw - lw, cw + lw);
        let zero = splat(0.0);
        // The nearest depth anywhere in each sphere, rounded toward the camera.
        let z_max = cz + lz;
        let depth = z_max.simd_gt(zero).select(z_max / w_min, z_max / w_max);
        let depth = depth + splat(1e-6) + depth.abs() * splat(1e-5);
        // Each sphere's box on the screen: each coordinate over w at its extremes.
        let low = |v: f32x4| v.simd_lt(zero).select(v / w_min, v / w_max);
        let high = |v: f32x4| v.simd_gt(zero).select(v / w_min, v / w_max);
        let (w, h) = (splat(self.width as f32), splat(self.height as f32));
        let (half, one) = (splat(0.5), splat(1.0));
        let left = (low(cx - lx) + one) * half * w;
        let right = (high(cx + lx) + one) * half * w;
        let top = (one - high(cy + ly)) * half * h;
        let bottom = (one - low(cy - ly)) * half * h;
        // Comparisons with a number that is not one fail, so such a lane is never hidden. A box
        // off the buffer is left to the frustum test.
        let candidates = radii.simd_ge(zero)
            & w_min.simd_gt(splat(1e-6) * cw.abs().simd_max(one))
            & depth.simd_lt(splat(self.nearest))
            & right.simd_ge(zero)
            & left.simd_lt(w)
            & bottom.simd_ge(zero)
            & top.simd_lt(h);
        let pixel = |v: f32x4, size: u32| {
            v.simd_max(zero)
                .cast::<u32>()
                .simd_min(u32x4::splat(size - 1))
        };
        let (across, down) = (u32x4::splat(SUBTILE_WIDTH), u32x4::splat(SUBTILE_HEIGHT));
        let sx0 = (pixel(left, self.width) / across).to_array();
        let sx1 = (pixel(right, self.width) / across).to_array();
        let sy0 = (pixel(top, self.height) / down).to_array();
        let sy1 = (pixel(bottom, self.height) / down).to_array();
        let depth = depth.to_array();
        let mut lanes = candidates.to_bitmask() as u32;
        let mut hidden = 0;
        while lanes != 0 {
            let k = lanes.trailing_zeros() as usize;
            lanes &= lanes - 1;
            if self.covers(sx0[k], sx1[k], sy0[k], sy1[k], depth[k]) {
                hidden |= 1 << k;
            }
        }
        hidden
    }

    /// True when every subtile of columns `sx0..=sx1` and rows `sy0..=sy1` is covered nearer
    /// than `depth`. A box of more subtiles than one block tests whole blocks first.
    fn covers(&self, sx0: u32, sx1: u32, sy0: u32, sy1: u32, depth: f32) -> bool {
        let tiles = (sx1 - sx0 + 1) * (sy1 - sy0 + 1);
        if tiles <= BLOCK_SUBTILES_X * BLOCK_SUBTILES_Y {
            return (sy0..=sy1).all(|sy| self.row_covers(sy, sx0, sx1, depth));
        }
        let blocks_x = self.tiles_x / BLOCK_SUBTILES_X;
        for by in sy0 / BLOCK_SUBTILES_Y..=sy1 / BLOCK_SUBTILES_Y {
            for bx in sx0 / BLOCK_SUBTILES_X..=sx1 / BLOCK_SUBTILES_X {
                if self.blocks[(by * blocks_x + bx) as usize] > depth {
                    continue;
                }
                let rows =
                    (by * BLOCK_SUBTILES_Y).max(sy0)..=((by + 1) * BLOCK_SUBTILES_Y - 1).min(sy1);
                let first = (bx * BLOCK_SUBTILES_X).max(sx0);
                let last = ((bx + 1) * BLOCK_SUBTILES_X - 1).min(sx1);
                if !rows
                    .into_iter()
                    .all(|sy| self.row_covers(sy, first, last, depth))
                {
                    return false;
                }
            }
        }
        true
    }

    /// True when subtiles `sx0..=sx1` of row `sy` are all covered nearer than `depth`, four at a
    /// time.
    #[inline(always)]
    fn row_covers(&self, sy: u32, sx0: u32, sx1: u32, depth: f32) -> bool {
        let start = (sy * self.tiles_x) as usize;
        let row = &self.near[start + sx0 as usize..=start + sx1 as usize];
        let (chunks, rest) = row.as_chunks::<4>();
        let limit = f32x4::splat(depth);
        chunks
            .iter()
            .all(|chunk| f32x4::from_array(*chunk).simd_gt(limit).all())
            && rest.iter().all(|&near| near > depth)
    }
}

/// The frame's lists that every band reads.
struct Lists<'a> {
    drawn: &'a [Drawn],
    polygons: &'a [Polygon],
    segments: &'a [[f64; 4]],
}

/// A band's rows of the buffer.
struct BandOut<'a> {
    near: &'a mut [f32],
    layer: &'a mut [f32],
    masks: &'a mut [u32],
}

/// Moves one blocker's corners into clip space, clips and sets up its drawn triangles, and lists
/// its outline edges, into its own parts of the frame's lists.
#[allow(clippy::too_many_arguments)]
fn prepare(
    mesh: &BlockerMesh,
    blocker: &Blocker,
    screen: Screen,
    corners: &mut [[f32; 4]],
    codes: &mut [i8],
    polygons: &mut [Polygon],
    segments: &mut [[f64; 4]],
    out: &mut Drawn,
) {
    transform(mesh, &blocker.clip, corners);
    let front_only = mesh.closed || !blocker.double_sided;
    let corner = |i: u32| corners[i as usize].map(f64::from);
    let (mut n_polygons, mut n_segments) = (0usize, 0usize);
    let (mut x0, mut x1, mut y0, mut y1) = (u32::MAX, 0, u32::MAX, 0);
    let mut near = f64::NEG_INFINITY;
    for (t, tri) in mesh.triangles.iter().enumerate() {
        let [a, b, c] = tri.map(corner);
        codes[t] = facing(a, b, c, front_only);
        if codes[t] == 0 {
            continue;
        }
        // Clip at the near plane, where z equals w; in front of it z is at most w.
        let mut clipped = [[0.0; 4]; 4];
        let mut count = 0;
        let mut cut = [[0.0; 4]; 2];
        let mut cuts = 0;
        let points = [a, b, c];
        for k in 0..3 {
            let (p, q) = (points[k], points[(k + 1) % 3]);
            let (dp, dq) = (p[3] - p[2], q[3] - q[2]);
            if dp >= 0.0 {
                clipped[count] = p;
                count += 1;
            }
            if (dp >= 0.0) != (dq >= 0.0) {
                let s = dp / (dp - dq);
                let point = std::array::from_fn(|i| p[i] + (q[i] - p[i]) * s);
                clipped[count] = point;
                count += 1;
                cut[cuts] = point;
                cuts += 1;
            }
        }
        let projected: [[f64; 3]; 4] = std::array::from_fn(|i| {
            if i < count {
                screen.project(clipped[i])
            } else {
                [0.0; 3]
            }
        });
        let Some(polygon) = (count >= 3)
            .then(|| set_up(&projected[..count], screen))
            .flatten()
        else {
            // Too thin to draw: the edges beside it then outline the blocker.
            codes[t] = 0;
            continue;
        };
        if cuts == 2 {
            let [p, q] = cut.map(|point| screen.project(point));
            segments[n_segments] = [p[0], p[1], q[0], q[1]];
            n_segments += 1;
        }
        if polygon.x0 < polygon.x1 && polygon.y0 < polygon.y1 {
            (x0, x1) = (x0.min(polygon.x0), x1.max(polygon.x1));
            (y0, y1) = (y0.min(polygon.y0), y1.max(polygon.y1));
            near = near.max(polygon.near);
            polygons[n_polygons] = polygon;
            n_polygons += 1;
        }
    }
    for edge in &mesh.edges {
        let d0 = codes[edge.t0 as usize];
        let d1 = if edge.t1 == NO_TRIANGLE {
            0
        } else {
            codes[edge.t1 as usize]
        };
        // Two drawn triangles lie on opposite sides of their edge when they face the same way and
        // run along it in opposite directions, or face opposite ways and run along it the same way.
        let inside = d0 != 0 && d1 != 0 && ((d0 == d1) == edge.opposite);
        if (d0 == 0 && d1 == 0) || inside {
            continue;
        }
        if let Some(segment) = clip_segment(corner(edge.a), corner(edge.b), screen) {
            segments[n_segments] = segment;
            n_segments += 1;
        }
    }
    if n_polygons == 0 {
        (x0, x1, y0, y1) = (0, 0, 0, 0);
    }
    let near = near as f32;
    *out = Drawn {
        polygons: n_polygons as u32,
        segments: n_segments as u32,
        near: near.next_up(),
        x0,
        x1,
        y0,
        y1,
        ..*out
    };
}

/// Moves a mesh's corners into clip space, four at a time.
fn transform(mesh: &BlockerMesh, m: &[f32; 16], out: &mut [[f32; 4]]) {
    let column = |c: usize| [m[c], m[c + 1], m[c + 2], m[c + 3]].map(f32x4::splat);
    let (mx, my, mz, mw) = (column(0), column(4), column(8), column(12));
    let n = mesh.corners as usize;
    for i in (0..n).step_by(4) {
        let x = f32x4::from_slice(&mesh.xs[i..i + 4]);
        let y = f32x4::from_slice(&mesh.ys[i..i + 4]);
        let z = f32x4::from_slice(&mesh.zs[i..i + 4]);
        let rows: [f32x4; 4] = std::array::from_fn(|r| mx[r] * x + my[r] * y + mz[r] * z + mw[r]);
        let rows = rows.map(|v| v.to_array());
        for lane in 0..4.min(n - i) {
            out[i + lane] = [rows[0][lane], rows[1][lane], rows[2][lane], rows[3][lane]];
        }
    }
}

/// How a triangle in clip space faces the camera: 1 for counterclockwise on the screen, the
/// front face, -1 for the back face, and 0 when it does not draw: edge-on, or a back face of a
/// blocker that draws front faces alone. The sign is that of the triangle's homogeneous
/// determinant, which holds for the part in front of the camera even when a corner lies behind it.
#[inline(always)]
fn facing(a: [f64; 4], b: [f64; 4], c: [f64; 4], front_only: bool) -> i8 {
    let det = a[0] * (b[1] * c[3] - b[3] * c[1]) - a[1] * (b[0] * c[3] - b[3] * c[0])
        + a[3] * (b[0] * c[1] - b[1] * c[0]);
    let length = |p: [f64; 4]| (p[0] * p[0] + p[1] * p[1] + p[3] * p[3]).sqrt();
    let scale = length(a) * length(b) * length(c);
    if det > EDGE_ON * scale {
        1
    } else if det < -EDGE_ON * scale && !front_only {
        -1
    } else {
        0
    }
}

/// A convex polygon of three or four points in pixels with depth, set up for drawing, or `None`
/// when it has too little area to draw.
fn set_up(points: &[[f64; 3]], screen: Screen) -> Option<Polygon> {
    let n = points.len();
    // Twice the signed area, and the plane from the corner triangle of the largest area.
    let mut area = 0.0;
    for i in 0..n {
        let (p, q) = (points[i], points[(i + 1) % n]);
        area += p[0] * q[1] - q[0] * p[1];
    }
    if area.is_nan() || area.abs() < MIN_AREA {
        return None;
    }
    let sign = area.signum();
    let mut polygon = Polygon {
        edge_count: n as u32,
        ..Polygon::default()
    };
    for i in 0..n {
        let (p, q) = (points[i], points[(i + 1) % n]);
        let (a, b) = (sign * (p[1] - q[1]), sign * (q[0] - p[0]));
        let c = -(a * p[0] + b * p[1]);
        polygon.points[i] = [p[0], p[1]];
        let dy = q[1] - p[1];
        polygon.slopes[i] = if dy.abs() < 1e-9 {
            f64::INFINITY
        } else {
            (q[0] - p[0]) / dy
        };
        // a (i + 0.5) + b y + c >= 0 for a pixel i at a row's center y.
        (polygon.spans[i], polygon.sides[i]) = if a == 0.0 {
            ([b, c], 0)
        } else {
            ([-b / a, -c / a - 0.5], if a > 0.0 { 1 } else { -1 })
        };
    }
    polygon.far = points.iter().map(|p| p[2]).fold(f64::INFINITY, f64::min);
    polygon.near = points
        .iter()
        .map(|p| p[2])
        .fold(f64::NEG_INFINITY, f64::max);
    let mut best = (0.0, [0usize; 3]);
    for k in 1..n - 1 {
        let (p, q, r) = (points[0], points[k], points[k + 1]);
        let twice = (q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1]);
        if twice.abs() > best.0 {
            best = (twice.abs(), [0, k, k + 1]);
        }
    }
    let [p, q, r] = best.1.map(|i| points[i]);
    let twice = (q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1]);
    polygon.plane = if twice.abs() > 1e-6 {
        let dx = ((q[2] - p[2]) * (r[1] - p[1]) - (r[2] - p[2]) * (q[1] - p[1])) / twice;
        let dy = ((r[2] - p[2]) * (q[0] - p[0]) - (q[2] - p[2]) * (r[0] - p[0])) / twice;
        [dx, dy, p[2] - dx * p[0] - dy * p[1]]
    } else {
        // A sliver's plane is not precise: its farthest corner bounds it.
        [0.0, 0.0, polygon.far]
    };
    // The pixels whose squares the box touches, edges included.
    let (mut lx, mut hx, mut ly, mut hy) = (
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
    );
    for p in points {
        (lx, hx) = (lx.min(p[0]), hx.max(p[0]));
        (ly, hy) = (ly.min(p[1]), hy.max(p[1]));
    }
    let clamp = |v: f64, size: f64| v.floor().clamp(0.0, size) as u32;
    polygon.x0 = clamp(lx - PIXEL_EPS, screen.width);
    polygon.x1 = clamp(hx + PIXEL_EPS + 1.0, screen.width);
    polygon.y0 = clamp(ly - PIXEL_EPS, screen.height);
    polygon.y1 = clamp(hy + PIXEL_EPS + 1.0, screen.height);
    Some(polygon)
}

/// An edge between two clip-space points, cut at the near plane and in pixels, or `None` when it
/// lies wholly before the near plane.
fn clip_segment(mut p: [f64; 4], mut q: [f64; 4], screen: Screen) -> Option<[f64; 4]> {
    let (dp, dq) = (p[3] - p[2], q[3] - q[2]);
    if dp < 0.0 && dq < 0.0 {
        return None;
    }
    if dp < 0.0 || dq < 0.0 {
        let s = dp / (dp - dq);
        let cut: [f64; 4] = std::array::from_fn(|i| p[i] + (q[i] - p[i]) * s);
        if dp < 0.0 {
            p = cut;
        } else {
            q = cut;
        }
    }
    let ([x0, y0, _], [x1, y1, _]) = (screen.project(p), screen.project(q));
    Some([x0, y0, x1, y1])
}

/// Draws every blocker that reaches band `band` into it, nearest first.
fn draw_band(
    band: u32,
    width: u32,
    lists: &Lists<'_>,
    scratch: &mut BandScratch,
    out: &mut BandOut<'_>,
) {
    out.near.fill(UNCOVERED);
    out.layer.fill(0.0);
    out.masks.fill(0);
    let (top, bottom) = (band * BAND_HEIGHT, (band + 1) * BAND_HEIGHT);
    let words = (width / WORD_PIXELS) as usize;
    let tiles_x = (width / SUBTILE_WIDTH) as usize;
    for d in lists.drawn {
        if d.polygons == 0 || d.y1 <= top || d.y0 >= bottom {
            continue;
        }
        let (r0, r1) = (d.y0.max(top), d.y1.min(bottom));
        let (w0, w1) = (
            (d.x0 / WORD_PIXELS) as usize,
            d.x1.div_ceil(WORD_PIXELS) as usize,
        );
        // Whole subtile rows, which the merge reads.
        let (t0, t1) = (
            (r0 - top) / SUBTILE_HEIGHT,
            (r1 - top).div_ceil(SUBTILE_HEIGHT),
        );
        // A blocker wholly behind what the band's subtiles hold over its box would change none of
        // them, as each merge keeps only coverage nearer than a subtile's whole depth.
        let (s0, s1) = (
            (d.x0 / SUBTILE_WIDTH) as usize,
            d.x1.div_ceil(SUBTILE_WIDTH) as usize,
        );
        let behind = (t0..t1).all(|t| {
            let at = t as usize * tiles_x;
            out.near[at + s0..at + s1].iter().all(|&z| z > d.near)
        });
        if behind {
            continue;
        }
        for r in t0 * SUBTILE_HEIGHT..t1 * SUBTILE_HEIGHT {
            let at = r as usize * words;
            scratch.rows[at + w0..at + w1].fill(0);
        }
        for t in t0..t1 {
            let at = t as usize * tiles_x;
            scratch.depths[at + w0 * 4..at + w1 * 4].fill(f32::INFINITY);
        }
        let first = d.first_polygon as usize;
        for polygon in &lists.polygons[first..first + d.polygons as usize] {
            if polygon.y1 <= r0 || polygon.y0 >= r1 {
                continue;
            }
            cover(polygon, r0, r1, top, words, scratch);
            bound_depths(polygon, r0, r1, top, tiles_x, scratch);
        }
        let first = d.first_segment as usize;
        for segment in &lists.segments[first..first + d.segments as usize] {
            uncover(segment, r0, r1, top, width, scratch);
        }
        for t in t0..t1 {
            let rows = (t * SUBTILE_HEIGHT) as usize * words;
            for w in w0..w1 {
                let row = |k: usize| scratch.rows[rows + k * words + w];
                let packed = u32x4::from_array([row(0), row(1), row(2), row(3)]);
                let masks = u32x4::from_ne_bytes(shuffle_bytes(packed.to_ne_bytes(), TRANSPOSE));
                let at = t as usize * tiles_x + w * 4;
                let depths = f32x4::from_slice(&scratch.depths[at..at + 4]);
                merge(out, at, masks, depths);
            }
        }
    }
}

/// The byte shuffle that turns four pixel rows of four subtiles, a word per row, into the four
/// subtiles' masks, a byte per row.
const TRANSPOSE: u8x16 = u8x16::from_array([0, 4, 8, 12, 1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15]);

/// Sets the bits of the pixels in `start..=end` in a row of words.
#[inline(always)]
fn set_bits(row: &mut [u32], start: u32, end: u32) {
    let (first, last) = ((start / 32) as usize, (end / 32) as usize);
    let low = u32::MAX << (start % 32);
    let high = u32::MAX >> (31 - end % 32);
    if first == last {
        row[first] |= low & high;
        return;
    }
    row[first] |= low;
    row[first + 1..last].fill(u32::MAX);
    row[last] |= high;
}

/// Clears the bits of the pixels in `start..=end` in a row of words.
#[inline(always)]
fn clear_bits(row: &mut [u32], start: u32, end: u32) {
    let (first, last) = ((start / 32) as usize, (end / 32) as usize);
    let low = u32::MAX << (start % 32);
    let high = u32::MAX >> (31 - end % 32);
    if first == last {
        row[first] &= !(low & high);
        return;
    }
    row[first] &= !low;
    row[first + 1..last].fill(0);
    row[last] &= !high;
}

/// Sets the pixels of rows `r0..r1` whose centers lie inside the polygon, edges included.
fn cover(polygon: &Polygon, r0: u32, r1: u32, top: u32, words: usize, scratch: &mut BandScratch) {
    let n = polygon.edge_count as usize;
    let (spans, sides) = (&polygon.spans[..n], &polygon.sides[..n]);
    let (lowest, highest) = (f64::from(polygon.x0), f64::from(polygon.x1) - 1.0);
    for r in polygon.y0.max(r0)..polygon.y1.min(r1) {
        let y = f64::from(r) + 0.5;
        let (mut lo, mut hi) = (lowest, highest);
        for (&[k, m], &side) in spans.iter().zip(sides) {
            let at = k * y + m;
            match side {
                1 => lo = lo.max(at.ceil()),
                -1 => hi = hi.min(at.floor()),
                _ if at < 0.0 => hi = -1.0,
                _ => {}
            }
        }
        if lo <= hi {
            let at = (r - top) as usize * words;
            set_bits(&mut scratch.rows[at..at + words], lo as u32, hi as u32);
        }
    }
}

/// Lowers the depth of each subtile of rows `r0..r1` that the polygon touches to the polygon's
/// farthest depth over the subtile. In each row of subtiles, the polygon touches the subtiles
/// that its part between the row's top and bottom spans, as both are convex.
fn bound_depths(
    polygon: &Polygon,
    r0: u32,
    r1: u32,
    top: u32,
    tiles_x: usize,
    scratch: &mut BandScratch,
) {
    let n = polygon.edge_count as usize;
    let [px, py, pc] = polygon.plane;
    let (t0, t1) = (
        (polygon.y0.max(r0) - top) / SUBTILE_HEIGHT,
        (polygon.y1.min(r1) - top).div_ceil(SUBTILE_HEIGHT),
    );
    let width = f64::from(SUBTILE_WIDTH);
    let last = tiles_x as f64 - 1.0;
    // The plane's lowest value over a subtile, from the corner where it is lowest, as the subtile
    // at x = 0 has it; each subtile across adds `step`.
    let (corner_x, step) = (if px > 0.0 { 0.0 } else { width }, px * width);
    for t in t0..t1 {
        let ya = f64::from(top + t * SUBTILE_HEIGHT);
        let yb = ya + f64::from(SUBTILE_HEIGHT);
        let (ya, yb) = (ya - PIXEL_EPS, yb + PIXEL_EPS);
        let (mut lo, mut hi) = (f64::INFINITY, f64::NEG_INFINITY);
        for i in 0..n {
            let (p, q) = (polygon.points[i], polygon.points[(i + 1) % n]);
            let (ylo, yhi) = (p[1].min(q[1]), p[1].max(q[1]));
            if yhi < ya || ylo > yb {
                continue;
            }
            let (xlo, xhi) = (p[0].min(q[0]), p[0].max(q[0]));
            let slope = polygon.slopes[i];
            if slope.is_infinite() {
                (lo, hi) = (lo.min(xlo), hi.max(xhi));
                continue;
            }
            for y in [ya.max(ylo), yb.min(yhi)] {
                let x = (p[0] + (y - p[1]) * slope).clamp(xlo, xhi);
                (lo, hi) = (lo.min(x), hi.max(x));
            }
        }
        if lo > hi || hi < -PIXEL_EPS || lo > (last + 1.0) * width + PIXEL_EPS {
            continue;
        }
        let first = ((lo - PIXEL_EPS) / width).floor().clamp(0.0, last) as usize;
        let end = ((hi + PIXEL_EPS) / width).floor().clamp(0.0, last) as usize;
        let row = if py > 0.0 {
            ya + PIXEL_EPS
        } else {
            yb - PIXEL_EPS
        };
        let start = px * corner_x + py * row + pc + step * first as f64;
        let at = t as usize * tiles_x;
        let depths = &mut scratch.depths[at + first..=at + end];
        // Four subtiles at a time. Each bound moves away from the camera by more than rounding
        // to 32 bits can move it toward it.
        let far = f64x4::splat(polygon.far);
        let mut plane =
            f64x4::splat(start) + f64x4::from_array([0.0, 1.0, 2.0, 3.0]) * f64x4::splat(step);
        let (chunks, rest) = depths.as_chunks_mut::<4>();
        for chunk in chunks {
            let bound = plane.simd_max(far);
            let bound = bound - bound.abs().simd_max(f64x4::splat(1e-3)) * f64x4::splat(1e-7);
            let lowered = f32x4::from_array(*chunk).simd_min(bound.cast::<f32>());
            *chunk = lowered.to_array();
            plane += f64x4::splat(4.0 * step);
        }
        for (k, depth) in rest.iter_mut().enumerate() {
            let bound = plane[k].max(polygon.far);
            *depth = depth.min(round_far(bound - 1e-7 * bound.abs().max(1e-3)));
        }
    }
}

/// Clears, in rows `r0..r1`, every pixel whose square an outline edge touches.
fn uncover(segment: &[f64; 4], r0: u32, r1: u32, top: u32, width: u32, scratch: &mut BandScratch) {
    let &[x0, y0, x1, y1] = segment;
    let (ylo, yhi) = (y0.min(y1), y0.max(y1));
    if !(yhi + PIXEL_EPS >= f64::from(r0) && ylo - PIXEL_EPS < f64::from(r1)) {
        return;
    }
    if !(x0.max(x1) + PIXEL_EPS >= 0.0 && x0.min(x1) - PIXEL_EPS < f64::from(width)) {
        return;
    }
    let words = (width / WORD_PIXELS) as usize;
    let first = ((ylo - PIXEL_EPS).floor().max(f64::from(r0))) as u32;
    let last = ((yhi + PIXEL_EPS).floor().min(f64::from(r1 - 1))) as u32;
    let dy = y1 - y0;
    let x_at = |y: f64| {
        if dy.abs() < 1e-12 {
            None
        } else {
            Some(x0 + (y - y0) * (x1 - x0) / dy)
        }
    };
    for r in first..=last {
        let (lo, hi) = match (
            x_at(f64::from(r).clamp(ylo, yhi)),
            x_at(f64::from(r + 1).clamp(ylo, yhi)),
        ) {
            (Some(a), Some(b)) => (a.min(b), a.max(b)),
            _ => (x0.min(x1), x0.max(x1)),
        };
        let (lo, hi) = (lo - PIXEL_EPS, hi + PIXEL_EPS);
        if hi < 0.0 || lo >= f64::from(width) {
            continue;
        }
        let start = lo.floor().max(0.0) as u32;
        let end = (hi.floor() as u32).min(width - 1);
        let at = (r - top) as usize * words;
        clear_bits(&mut scratch.rows[at..at + words], start, end);
    }
}

/// Merges one blocker's coverage and depth of four subtiles, from `at` in the band, into the
/// buffer's two layers.
#[inline(always)]
fn merge(out: &mut BandOut<'_>, at: usize, m: u32x4, d: f32x4) {
    let range = at..at + 4;
    let z0 = f32x4::from_slice(&out.near[range.clone()]);
    let z1 = f32x4::from_slice(&out.layer[range.clone()]);
    let mk = u32x4::from_slice(&out.masks[range.clone()]);
    let zero = u32x4::splat(0);
    let full = u32x4::splat(FULL);
    // Coverage behind the whole-subtile depth adds nothing.
    let useful = m.simd_ne(zero) & d.simd_gt(z0) & d.simd_lt(f32x4::splat(f32::INFINITY));
    // Coverage of a whole subtile becomes its depth; the working layer stays only if nearer.
    let whole = m.simd_eq(full);
    let keep = mk.simd_ne(zero) & z1.simd_gt(d);
    let (whole_z0, whole_mk) = (d, keep.select(mk, zero));
    // Part of a subtile joins the working layer, unless that layer lies far nearer than this
    // coverage, which then starts a new one. A full layer becomes the whole-subtile depth.
    let discard = mk.simd_ne(zero) & (z1 - d).simd_gt(d - z0);
    let kept = discard.select(zero, mk);
    let joined_z1 = kept.simd_eq(zero).select(d, z1.simd_min(d));
    let joined_mk = kept | m;
    let filled = joined_mk.simd_eq(full);
    let part_z0 = filled.select(joined_z1, z0);
    let part_mk = filled.select(zero, joined_mk);
    let new_z0 = useful.select(whole.select(whole_z0, part_z0), z0);
    let new_z1 = useful.select(whole.select(z1, joined_z1), z1);
    let new_mk = useful.select(whole.select(whole_mk, part_mk), mk);
    new_z0.copy_to_slice(&mut out.near[range.clone()]);
    new_z1.copy_to_slice(&mut out.layer[range.clone()]);
    new_mk.copy_to_slice(&mut out.masks[range]);
}

/// A band's row of blocks, each the farthest whole-subtile depth of its subtiles, and the band's
/// nearest whole-subtile depth. Holds room for up to 256 blocks.
fn summarize(out: &BandOut<'_>, tiles_x: usize) -> ([f32; 256], f32) {
    let mut blocks = [f32::INFINITY; 256];
    let mut nearest = UNCOVERED;
    for t in 0..BLOCK_SUBTILES_Y as usize {
        let row = &out.near[t * tiles_x..(t + 1) * tiles_x];
        for (b, chunk) in row.as_chunks::<4>().0.iter().enumerate() {
            let v = f32x4::from_array(*chunk);
            blocks[b] = blocks[b].min(v.reduce_min());
            nearest = nearest.max(v.reduce_max());
        }
    }
    (blocks, nearest)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bit_ranges_set_and_clear_across_words() {
        let mut row = [0u32; 4];
        set_bits(&mut row, 3, 3);
        assert_eq!(row, [8, 0, 0, 0]);
        set_bits(&mut row, 30, 66);
        assert_eq!(row, [8 | 0xC000_0000, u32::MAX, 0b111, 0]);
        clear_bits(&mut row, 31, 64);
        assert_eq!(row, [8 | 0x4000_0000, 0, 0b110, 0]);
        clear_bits(&mut row, 0, 127);
        assert_eq!(row, [0; 4]);
    }

    #[test]
    fn the_transpose_gathers_each_subtiles_rows() {
        let rows = u32x4::from_array([0x4433_2211, 0x8877_6655, 0xCCBB_AA99, 0x00FF_EEDD]);
        let masks = u32x4::from_ne_bytes(shuffle_bytes(rows.to_ne_bytes(), TRANSPOSE));
        assert_eq!(
            masks.to_array(),
            [0xDD99_5511, 0xEEAA_6622, 0xFFBB_7733, 0x00CC_8844]
        );
    }

    #[test]
    fn sizes_keep_the_shape_in_whole_subtiles_and_bands() {
        assert_eq!(OcclusionBuffer::size_for(1920, 1080), (256, 144));
        let (w, h) = OcclusionBuffer::size_for(1080, 1920);
        assert!(w % WORD_PIXELS == 0 && h % BAND_HEIGHT == 0 && h > w);
        let (w, h) = OcclusionBuffer::size_for(1, 1);
        assert!(w == 192 && h == 192);
    }

    #[test]
    fn a_box_welds_into_a_closed_mesh() {
        use crate::bvh::mesh::TriangleSoup;
        // A unit box of 12 triangles whose 24 corners repeat per face, as generators make it.
        let faces: [[[f32; 3]; 4]; 6] = [
            [[1., -1., -1.], [1., 1., -1.], [1., 1., 1.], [1., -1., 1.]],
            [
                [-1., -1., 1.],
                [-1., 1., 1.],
                [-1., 1., -1.],
                [-1., -1., -1.],
            ],
            [[-1., 1., -1.], [-1., 1., 1.], [1., 1., 1.], [1., 1., -1.]],
            [
                [-1., -1., 1.],
                [-1., -1., -1.],
                [1., -1., -1.],
                [1., -1., 1.],
            ],
            [[-1., -1., 1.], [1., -1., 1.], [1., 1., 1.], [-1., 1., 1.]],
            [
                [1., -1., -1.],
                [-1., -1., -1.],
                [-1., 1., -1.],
                [1., 1., -1.],
            ],
        ];
        let mut soup = Vec::new();
        for f in faces {
            for i in [0, 1, 2, 0, 2, 3] {
                soup.extend_from_slice(&f[i]);
            }
        }
        let mesh = BlockerMesh::build(&TriangleSoup { positions: &soup }).expect("a blocker");
        assert_eq!(mesh.corner_count(), 8);
        assert_eq!(mesh.triangle_count(), 12);
        assert_eq!(mesh.edge_count(), 18);
        assert!(mesh.is_closed());
    }
}
