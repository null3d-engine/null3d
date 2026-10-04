//! Blocker meshes for software occlusion culling: a few boxes that fill the inside of a model's
//! mesh, joined into one closed surface, which the job workers draw in place of the mesh.
//!
//! # Making a blocker
//!
//! The mesh's box is cut into a grid of cubic cells. A cell that any triangle touches is part of
//! the surface. The cells outside are those that a flood from around the box reaches without
//! crossing the surface. The rest are inside: no triangle touches them, and no path leads from
//! them to the outside, so no camera outside the mesh sees them. Gaps narrower than a cell, such
//! as the cracks where a mesh's parts meet without sharing corners, do not let the flood in.
//!
//! The ground hides each model from below its lowest point. So, with the ground on, the flood
//! does not start below the box, and a mesh that is open at its bottom, as most buildings are,
//! still has an inside. The cells of the lowest row never count as inside, so a blocker never
//! reaches the bottom.
//!
//! The largest box of inside cells comes first. Each next box is the one that adds the most cells
//! that no box holds yet, and it may reach into the boxes before it. The boxes stop when the next
//! adds too little. Their union becomes one closed surface: the faces between inside and outside
//! of a grid whose lines are the boxes' sides. Neighbouring faces share whole edges, so the
//! surface has no cracks, and a box needs only 12 triangles.
//!
//! # Checking a blocker
//!
//! [`check`] decides on its own, from the mesh's triangles, whether a blocker lies inside the
//! mesh, and the tool drops a blocker that fails it. A blocker that bulges out would hide objects
//! that show.
//!
//! - The blocker must be closed, with every edge joining two triangles that run along it in
//!   opposite directions, and it must face outward.
//! - No blocker triangle may touch or cross a triangle of the mesh.
//! - Each corner of the blocker, and points spread over each of its triangles, must lie inside
//!   the mesh. A point is inside when a ray toward each of 48 directions meets the mesh, and the
//!   last face it meets faces away from the point. That face faces a camera farther along the
//!   ray, so the camera cannot see the point. Faces that the ray meets before it, such as the
//!   inner faces of a mesh's overlapping parts, do not count. With the ground on, a ray downward
//!   that meets the ground under the mesh's box also passes, as the model may be open there.
//!
//! Every value derives from the input by adding, multiplying, dividing, rounding and square
//! roots, so the tool's single-threaded WebAssembly build gives the same blocker on every
//! machine.

use std::collections::HashMap;

use null3d_core::bvh::mesh::{IndexedTriangles, MeshBvh, Side};
use null3d_core::bvh::{Aabb, Ray};

/// The cells along the longest side of a mesh's box, by default.
pub const DEFAULT_RESOLUTION: u32 = 64;
/// The most boxes in a blocker, by default.
pub const DEFAULT_MAX_BOXES: u32 = 2;
/// A next box must add at least this share of the inside cells.
const MIN_GAIN: f64 = 0.02;
/// A blocker must fill at least this share of its mesh's box, or it hides too little to pay
/// for the frames that draw it.
pub const MIN_FILL: f64 = 0.05;
/// The times a blocker that fails the check shrinks by a cell and tries again.
const MAX_SHRINKS: u32 = 2;
/// The most triangles in a blocker. The boxes stop before the surface would need more.
pub const MAX_TRIANGLES: u32 = 512;
/// How far, as a share of a cell, a cell's box grows before the test of whether a triangle
/// touches it. A blocker then keeps at least this distance from the mesh's triangles, so rounding
/// its corners to 32-bit floats cannot move them onto the mesh.
const CELL_MARGIN: f64 = 1e-3;
/// How close, as a share of the mesh's longest side, a blocker triangle may come to a mesh
/// triangle before the check counts them as touching.
const TOUCH: f64 = 1e-5;
/// The points that the check spreads along each side of a blocker triangle, per longest side of
/// the mesh.
const SAMPLES_PER_SIDE: f64 = 8.0;
/// How far, as a share of the mesh's longest side, the check moves each point before it casts
/// rays, so no ray runs exactly through the shared edge of two triangles.
const JITTER: f64 = 2e-6;

/// How a blocker is made.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Settings {
    /// The cells along the longest side of the mesh's box.
    pub resolution: u32,
    /// The most boxes.
    pub max_boxes: u32,
    /// True when the ground hides the model from below its lowest point.
    pub ground: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            resolution: DEFAULT_RESOLUTION,
            max_boxes: DEFAULT_MAX_BOXES,
            ground: true,
        }
    }
}

/// A mesh's triangles: three floats per vertex and three indices per triangle, counterclockwise
/// from outside.
#[derive(Clone, Copy, Debug)]
pub struct Shape<'a> {
    /// x, y and z per vertex.
    pub positions: &'a [f32],
    /// Three per triangle.
    pub indices: &'a [u32],
}

/// A blocker: its corners and triangles, in the mesh's own space.
#[derive(Clone, Debug, PartialEq)]
pub struct Blocker {
    /// x, y and z per corner.
    pub positions: Vec<f32>,
    /// Three per triangle, counterclockwise from outside.
    pub indices: Vec<u32>,
    /// The boxes it joins.
    pub boxes: u32,
    /// The share of the mesh's box that it fills.
    pub fill: f64,
}

/// Why a mesh got no blocker.
#[derive(Clone, Debug, PartialEq)]
pub enum Dropped {
    /// The mesh has no triangle, or its box has no size.
    Empty,
    /// A position is not a finite number, or an index lies past the vertices.
    Invalid,
    /// No cell lies inside the mesh: it is open, or thinner than a cell.
    NoInside,
    /// The boxes fill less than [`MIN_FILL`] of the mesh's box.
    TooLittle {
        /// The share they fill.
        fill: f64,
    },
    /// The blocker failed the check.
    Failed(Failure),
}

/// Why a blocker failed the check.
#[derive(Clone, Debug, PartialEq)]
pub enum Failure {
    /// An edge does not join two triangles that run along it in opposite directions, or the
    /// surface faces inward.
    NotClosed,
    /// A blocker triangle touches or crosses this triangle of the mesh.
    Crosses {
        /// The mesh triangle's index.
        triangle: u32,
    },
    /// A point of the blocker lies outside the mesh, as a ray from it toward `direction` shows.
    Outside {
        /// The point.
        point: [f32; 3],
        /// The ray's direction.
        direction: [f32; 3],
    },
}

impl std::fmt::Display for Dropped {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Dropped::Empty => write!(f, "it has no triangles"),
            Dropped::Invalid => write!(f, "a position is not a number, or an index has no vertex"),
            Dropped::NoInside => write!(
                f,
                "it encloses no space: it is open at a side or its top, or thinner than a cell"
            ),
            Dropped::TooLittle { fill } => write!(
                f,
                "its blocker would fill {:.1}% of its box, under {:.0}%",
                // Rounded down, so a share just under the least never reads as the least.
                (fill * 1000.0).floor() / 10.0,
                MIN_FILL * 100.0
            ),
            Dropped::Failed(Failure::NotClosed) => write!(f, "its blocker is not closed"),
            Dropped::Failed(Failure::Crosses { triangle }) => {
                write!(f, "its blocker touches triangle {triangle}")
            }
            Dropped::Failed(Failure::Outside { point, .. }) => write!(
                f,
                "its blocker reaches outside it at {:?}",
                point.map(|v| (v * 1000.0).round() / 1000.0)
            ),
        }
    }
}

/// Makes a mesh's blocker, checks it, and returns it, or says why the mesh gets none.
///
/// # Errors
/// [`Dropped`] for a mesh that encloses no space, a blocker that would fill too little of the
/// mesh's box, or one that fails [`check`].
pub fn make(shape: &Shape<'_>, settings: &Settings) -> Result<Blocker, Dropped> {
    let grid = Grid::of(shape, settings)?;
    let mut inside = grid.inside(shape, settings.ground);
    let mut failure = None;
    // A blocker that fails the check tries again a cell smaller on every side: a crack too
    // narrow for the flood may still let a camera see in near the mesh's surface.
    for _ in 0..=MAX_SHRINKS {
        let blocker = match grid.blocker(&inside, settings) {
            Ok(blocker) => blocker,
            Err(dropped) => return Err(failure.map_or(dropped, Dropped::Failed)),
        };
        match check(shape, &blocker.positions, &blocker.indices, settings.ground) {
            Ok(()) => return Ok(blocker),
            Err(f) => failure = Some(f),
        }
        inside = grid.shrunk(&inside);
    }
    Err(Dropped::Failed(failure.unwrap_or(Failure::NotClosed)))
}

/// A box of cells: its first cell and the cell past its last, on each axis.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct CellBox {
    lo: [u32; 3],
    hi: [u32; 3],
}

impl CellBox {
    fn volume(&self) -> u64 {
        (0..3).map(|k| u64::from(self.hi[k] - self.lo[k])).product()
    }
}

/// The grid of cells over a mesh's box.
struct Grid {
    origin: [f64; 3],
    cell: f64,
    /// Cells on each axis.
    n: [usize; 3],
}

impl Grid {
    fn of(shape: &Shape<'_>, settings: &Settings) -> Result<Grid, Dropped> {
        if shape.indices.is_empty() || shape.positions.is_empty() {
            return Err(Dropped::Empty);
        }
        let vertices = shape.positions.len() / 3;
        if shape.indices.iter().any(|&i| i as usize >= vertices)
            || shape.positions.iter().any(|v| !v.is_finite())
        {
            return Err(Dropped::Invalid);
        }
        let (lo, hi) = bounds(shape.positions);
        let longest = (0..3).map(|k| hi[k] - lo[k]).fold(0.0, f64::max);
        if longest <= 0.0 {
            return Err(Dropped::Empty);
        }
        let cell = longest / f64::from(settings.resolution.max(2));
        let n = std::array::from_fn(|k| (((hi[k] - lo[k]) / cell).ceil() as usize).max(1));
        Ok(Grid {
            origin: lo,
            cell,
            n,
        })
    }

    /// The coordinate of grid line `i` on axis `k`, as a 32-bit float.
    fn coordinate(&self, k: usize, i: u32) -> f32 {
        (self.origin[k] + f64::from(i) * self.cell) as f32
    }

    /// The index of cell `c` in arrays over the grid.
    fn at(&self, c: [usize; 3]) -> usize {
        (c[2] * self.n[1] + c[1]) * self.n[0] + c[0]
    }

    /// Which cells lie inside the mesh: no triangle touches them, and a flood from around the box
    /// does not reach them. The flood starts below the box only without the ground, and the
    /// lowest row of cells never counts as inside.
    fn inside(&self, shape: &Shape<'_>, ground: bool) -> Vec<bool> {
        // The grid with one more cell on each side, where the flood starts.
        let p = self.n.map(|n| n + 2);
        let at = |c: [usize; 3]| (c[2] * p[1] + c[1]) * p[0] + c[0];
        const OPEN: u8 = 0;
        const WALL: u8 = 1;
        const OUT: u8 = 2;
        let mut state = vec![OPEN; p[0] * p[1] * p[2]];
        let margin = self.cell * CELL_MARGIN;
        for tri in shape.indices.as_chunks::<3>().0 {
            let v: [[f64; 3]; 3] = std::array::from_fn(|c| {
                let i = tri[c] as usize * 3;
                std::array::from_fn(|k| f64::from(shape.positions[i + k]))
            });
            let range = |k: usize| {
                let lo = v.iter().map(|p| p[k]).fold(f64::INFINITY, f64::min);
                let hi = v.iter().map(|p| p[k]).fold(f64::NEG_INFINITY, f64::max);
                let first = ((lo - margin - self.origin[k]) / self.cell)
                    .floor()
                    .max(0.0) as usize;
                let last = ((hi + margin - self.origin[k]) / self.cell).floor() as usize;
                first..=last.min(self.n[k] - 1)
            };
            let (rx, ry, rz) = (range(0), range(1), range(2));
            for z in rz {
                for y in ry.clone() {
                    for x in rx.clone() {
                        let c = [x, y, z];
                        let center: [f64; 3] = std::array::from_fn(|k| {
                            self.origin[k] + (c[k] as f64 + 0.5) * self.cell
                        });
                        if triangle_touches_box(&v, center, self.cell * 0.5 + margin) {
                            state[at([x + 1, y + 1, z + 1])] = WALL;
                        }
                    }
                }
            }
        }
        let mut stack = Vec::new();
        for z in 0..p[2] {
            for y in 0..p[1] {
                for x in 0..p[0] {
                    let border = x == 0
                        || z == 0
                        || y == 0
                        || x == p[0] - 1
                        || y == p[1] - 1
                        || z == p[2] - 1;
                    if !border {
                        continue;
                    }
                    let i = at([x, y, z]);
                    // The ground seals the layer below the box.
                    if y == 0 && ground {
                        state[i] = WALL;
                    } else if state[i] == OPEN {
                        state[i] = OUT;
                        stack.push([x, y, z]);
                    }
                }
            }
        }
        while let Some(c) = stack.pop() {
            for (k, step) in [(0, -1), (0, 1), (1, -1), (1, 1), (2, -1), (2, 1)] {
                let Some(m) = c[k].checked_add_signed(step) else {
                    continue;
                };
                if m >= p[k] {
                    continue;
                }
                let mut d = c;
                d[k] = m;
                let i = at(d);
                if state[i] == OPEN {
                    state[i] = OUT;
                    stack.push(d);
                }
            }
        }
        let mut inside = vec![false; self.n[0] * self.n[1] * self.n[2]];
        for z in 0..self.n[2] {
            for y in 1..self.n[1] {
                for x in 0..self.n[0] {
                    inside[self.at([x, y, z])] = state[at([x + 1, y + 1, z + 1])] == OPEN;
                }
            }
        }
        inside
    }

    /// The blocker of a set of inside cells, before the check.
    fn blocker(&self, inside: &[bool], settings: &Settings) -> Result<Blocker, Dropped> {
        let total = inside.iter().filter(|&&c| c).count();
        if total == 0 {
            return Err(Dropped::NoInside);
        }
        let boxes = self.boxes(inside, total, settings.max_boxes.max(1));
        // Fewer boxes when the surface would need too many triangles, or when two boxes meet
        // only along an edge, which four faces would then share.
        for used in (1..=boxes.len()).rev() {
            let (corners, indices) = union_surface(&boxes[..used]);
            let positions: Vec<f32> = corners
                .iter()
                .flat_map(|c| std::array::from_fn::<f32, 3, _>(|k| self.coordinate(k, c[k])))
                .collect();
            if indices.len() / 3 > MAX_TRIANGLES as usize
                || closed_outward(&positions, &indices).is_err()
            {
                continue;
            }
            let filled = union_volume(&boxes[..used]);
            let fill = filled as f64 / (self.n[0] * self.n[1] * self.n[2]) as f64;
            if fill < MIN_FILL {
                return Err(Dropped::TooLittle { fill });
            }
            return Ok(Blocker {
                positions,
                indices,
                boxes: used as u32,
                fill,
            });
        }
        Err(Dropped::NoInside)
    }

    /// The inside cells whose six neighbours are all inside too.
    fn shrunk(&self, inside: &[bool]) -> Vec<bool> {
        let n = self.n;
        let inside_at = |c: [usize; 3], k: usize, step: isize| {
            c[k].checked_add_signed(step)
                .filter(|&m| m < n[k])
                .is_some_and(|m| {
                    let mut d = c;
                    d[k] = m;
                    inside[self.at(d)]
                })
        };
        let mut out = vec![false; inside.len()];
        for z in 0..n[2] {
            for y in 0..n[1] {
                for x in 0..n[0] {
                    let c = [x, y, z];
                    out[self.at(c)] = inside[self.at(c)]
                        && (0..3).all(|k| inside_at(c, k, -1) && inside_at(c, k, 1));
                }
            }
        }
        out
    }

    /// Boxes of inside cells, largest first, then each the box that adds the most cells that no
    /// box before it holds, until a box would add too little.
    fn boxes(&self, inside: &[bool], total: usize, max_boxes: u32) -> Vec<CellBox> {
        let [nx, ny, nz] = self.n;
        let mut covered = vec![false; inside.len()];
        let mut boxes = Vec::new();
        let min_gain = ((total as f64 * MIN_GAIN).ceil() as u64).max(1);
        // Prefix sums of the cells that are inside and not covered yet.
        let (px, py) = (nx + 1, ny + 1);
        let mut sums = vec![0u32; px * py * (nz + 1)];
        let mut layer = vec![true; nx * nz];
        let mut heights = vec![0u32; nx];
        let mut stack: Vec<(usize, u32)> = Vec::with_capacity(nx + 1);
        while (boxes.len() as u32) < max_boxes {
            for z in 0..nz {
                for y in 0..ny {
                    for x in 0..nx {
                        let i = self.at([x, y, z]);
                        let own = u32::from(inside[i] && !covered[i]);
                        let s = |dx: usize, dy: usize, dz: usize| {
                            sums[((z + dz) * py + (y + dy)) * px + (x + dx)]
                        };
                        let value = own + s(0, 1, 1) + s(1, 0, 1) + s(1, 1, 0)
                            - s(0, 0, 1)
                            - s(0, 1, 0)
                            - s(1, 0, 0)
                            + s(0, 0, 0);
                        sums[((z + 1) * py + (y + 1)) * px + (x + 1)] = value;
                    }
                }
            }
            let gain_of = |b: &CellBox| -> u64 {
                let s = |x: u32, y: u32, z: u32| {
                    i64::from(sums[(z as usize * py + y as usize) * px + x as usize])
                };
                let ([x0, y0, z0], [x1, y1, z1]) = (b.lo, b.hi);
                (s(x1, y1, z1) - s(x0, y1, z1) - s(x1, y0, z1) - s(x1, y1, z0)
                    + s(x0, y0, z1)
                    + s(x0, y1, z0)
                    + s(x1, y0, z0)
                    - s(x0, y0, z0)) as u64
            };
            let mut best: Option<(u64, u64, CellBox)> = None;
            // Each run of rows from y0 up: the cells inside in all of them, then every maximal
            // rectangle of those cells, by the largest rectangle in a histogram.
            for y0 in 0..ny {
                layer.fill(true);
                for y1 in y0..ny {
                    let mut any = false;
                    for z in 0..nz {
                        for x in 0..nx {
                            let cell = &mut layer[z * nx + x];
                            *cell = *cell && inside[self.at([x, y1, z])];
                            any |= *cell;
                        }
                    }
                    if !any {
                        break;
                    }
                    heights.fill(0);
                    for z in 0..nz {
                        for x in 0..nx {
                            heights[x] = if layer[z * nx + x] { heights[x] + 1 } else { 0 };
                        }
                        stack.clear();
                        for x in 0..=nx {
                            let h = heights.get(x).copied().unwrap_or(0);
                            let mut start = x;
                            while let Some(&(from, top)) = stack.last() {
                                if top < h {
                                    break;
                                }
                                stack.pop();
                                if top > 0 {
                                    let b = CellBox {
                                        lo: [from as u32, y0 as u32, (z + 1) as u32 - top],
                                        hi: [x as u32, (y1 + 1) as u32, (z + 1) as u32],
                                    };
                                    let (gain, volume) = (gain_of(&b), b.volume());
                                    if best.is_none_or(|(g, v, _)| (gain, volume) > (g, v)) {
                                        best = Some((gain, volume, b));
                                    }
                                }
                                start = from;
                            }
                            stack.push((start, h));
                        }
                    }
                }
            }
            let Some((gain, _, b)) = best else {
                break;
            };
            if gain < min_gain {
                break;
            }
            for z in b.lo[2]..b.hi[2] {
                for y in b.lo[1]..b.hi[1] {
                    for x in b.lo[0]..b.hi[0] {
                        covered[self.at([x as usize, y as usize, z as usize])] = true;
                    }
                }
            }
            boxes.push(b);
        }
        boxes
    }
}

/// The lowest and highest position on each axis.
fn bounds(positions: &[f32]) -> ([f64; 3], [f64; 3]) {
    let mut lo = [f64::INFINITY; 3];
    let mut hi = [f64::NEG_INFINITY; 3];
    for p in positions.as_chunks::<3>().0 {
        for k in 0..3 {
            lo[k] = lo[k].min(f64::from(p[k]));
            hi[k] = hi[k].max(f64::from(p[k]));
        }
    }
    (lo, hi)
}

/// The grid lines that the boxes' sides lie on, on each axis, in order.
fn lines(boxes: &[CellBox]) -> [Vec<u32>; 3] {
    std::array::from_fn(|k| {
        let mut v: Vec<u32> = boxes.iter().flat_map(|b| [b.lo[k], b.hi[k]]).collect();
        v.sort_unstable();
        v.dedup();
        v
    })
}

/// Whether each cell of the grid of the boxes' sides lies in a box, by its index there.
fn union_cells(boxes: &[CellBox], lines: &[Vec<u32>; 3]) -> Vec<bool> {
    let n = lines.clone().map(|l| l.len().saturating_sub(1));
    let mut cells = vec![false; n[0] * n[1] * n[2]];
    for b in boxes {
        let range = |k: usize| {
            let from = lines[k].partition_point(|&v| v < b.lo[k]);
            let to = lines[k].partition_point(|&v| v < b.hi[k]);
            from..to
        };
        for z in range(2) {
            for y in range(1) {
                for x in range(0) {
                    cells[(z * n[1] + y) * n[0] + x] = true;
                }
            }
        }
    }
    cells
}

/// The cells that the union of the boxes holds.
fn union_volume(boxes: &[CellBox]) -> u64 {
    let lines = lines(boxes);
    let cells = union_cells(boxes, &lines);
    let n = lines.clone().map(|l| l.len().saturating_sub(1));
    let mut volume = 0;
    for z in 0..n[2] {
        for y in 0..n[1] {
            for x in 0..n[0] {
                if cells[(z * n[1] + y) * n[0] + x] {
                    let size = |k: usize, i: usize| u64::from(lines[k][i + 1] - lines[k][i]);
                    volume += size(0, x) * size(1, y) * size(2, z);
                }
            }
        }
    }
    volume
}

/// The closed surface of the union of the boxes: its corners as grid lines, and three indices per
/// triangle, counterclockwise from outside.
fn union_surface(boxes: &[CellBox]) -> (Vec<[u32; 3]>, Vec<u32>) {
    let lines = lines(boxes);
    let cells = union_cells(boxes, &lines);
    let n = lines.clone().map(|l| l.len().saturating_sub(1));
    let filled = |c: [isize; 3]| {
        (0..3).all(|k| c[k] >= 0 && (c[k] as usize) < n[k])
            && cells[(c[2] as usize * n[1] + c[1] as usize) * n[0] + c[0] as usize]
    };
    let mut corners: Vec<[u32; 3]> = Vec::new();
    let mut ids: HashMap<[u32; 3], u32> = HashMap::new();
    let mut indices = Vec::new();
    let mut corner = |c: [usize; 3]| -> u32 {
        let key = std::array::from_fn(|k| lines[k][c[k]]);
        *ids.entry(key).or_insert_with(|| {
            corners.push(key);
            (corners.len() - 1) as u32
        })
    };
    for z in 0..n[2] {
        for y in 0..n[1] {
            for x in 0..n[0] {
                let c = [x, y, z];
                if !filled(c.map(|v| v as isize)) {
                    continue;
                }
                for axis in 0..3 {
                    for out in [false, true] {
                        let mut d = c.map(|v| v as isize);
                        d[axis] += if out { 1 } else { -1 };
                        if filled(d) {
                            continue;
                        }
                        // The face's plane, then its two other axes in cyclic order, so that
                        // their cross product points along the axis.
                        let (u, v) = ((axis + 1) % 3, (axis + 2) % 3);
                        let at = |du: usize, dv: usize| {
                            let mut p = c;
                            p[axis] += usize::from(out);
                            p[u] += du;
                            p[v] += dv;
                            p
                        };
                        let quad = [
                            corner(at(0, 0)),
                            corner(at(1, 0)),
                            corner(at(1, 1)),
                            corner(at(0, 1)),
                        ];
                        let [a, b, c2, d2] = quad;
                        if out {
                            indices.extend([a, b, c2, a, c2, d2]);
                        } else {
                            indices.extend([a, c2, b, a, d2, c2]);
                        }
                    }
                }
            }
        }
    }
    (corners, indices)
}

/// True when a triangle touches the cube of half side `half` around `center`, by the separating
/// axis test of Akenine-Möller.
fn triangle_touches_box(v: &[[f64; 3]; 3], center: [f64; 3], half: f64) -> bool {
    let p: [[f64; 3]; 3] = std::array::from_fn(|i| std::array::from_fn(|k| v[i][k] - center[k]));
    for k in 0..3 {
        let lo = p.iter().map(|q| q[k]).fold(f64::INFINITY, f64::min);
        let hi = p.iter().map(|q| q[k]).fold(f64::NEG_INFINITY, f64::max);
        if lo > half || hi < -half {
            return false;
        }
    }
    let e: [[f64; 3]; 3] = std::array::from_fn(|i| sub(p[(i + 1) % 3], p[i]));
    let normal = cross(e[0], e[1]);
    let reach = half * (normal[0].abs() + normal[1].abs() + normal[2].abs());
    if dot(normal, p[0]).abs() > reach {
        return false;
    }
    for edge in &e {
        for k in 0..3 {
            let mut unit = [0.0; 3];
            unit[k] = 1.0;
            let axis = cross(unit, *edge);
            let projected = p.map(|q| dot(q, axis));
            let lo = projected.iter().copied().fold(f64::INFINITY, f64::min);
            let hi = projected.iter().copied().fold(f64::NEG_INFINITY, f64::max);
            let r = half * (axis[0].abs() + axis[1].abs() + axis[2].abs());
            if lo > r || hi < -r {
                return false;
            }
        }
    }
    true
}

fn sub(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn add(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

fn scale(a: [f64; 3], s: f64) -> [f64; 3] {
    [a[0] * s, a[1] * s, a[2] * s]
}

fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

/// The directions of the check's rays: every order and sign of (1, 2, 5), so no ray runs along an
/// axis, where the edges of models' flat faces lie.
fn directions() -> [[f32; 3]; 48] {
    const ORDERS: [[usize; 3]; 6] = [
        [0, 1, 2],
        [0, 2, 1],
        [1, 0, 2],
        [1, 2, 0],
        [2, 0, 1],
        [2, 1, 0],
    ];
    let base = [1.0, 2.0, 5.0];
    let length = 30.0f64.sqrt();
    std::array::from_fn(|i| {
        let order = ORDERS[i / 8];
        let signs = i % 8;
        std::array::from_fn(|k| {
            let sign = if signs & (1 << k) == 0 { 1.0 } else { -1.0 };
            (sign * base[order[k]] / length) as f32
        })
    })
}

/// Checks that a blocker lies inside a mesh: see the module documentation.
///
/// # Errors
/// The first [`Failure`] found.
pub fn check(
    shape: &Shape<'_>,
    positions: &[f32],
    indices: &[u32],
    ground: bool,
) -> Result<(), Failure> {
    closed_outward(positions, indices)?;
    let mesh = IndexedTriangles {
        positions: shape.positions,
        indices: shape.indices,
    };
    let bvh = MeshBvh::build(&mesh).map_err(|_| Failure::NotClosed)?;
    let (lo, hi) = bounds(shape.positions);
    let longest = (0..3).map(|k| hi[k] - lo[k]).fold(0.0, f64::max);
    let corner = |i: u32| -> [f64; 3] {
        let at = i as usize * 3;
        std::array::from_fn(|k| f64::from(positions[at + k]))
    };
    let mesh_corner = |i: u32| -> [f64; 3] {
        let at = i as usize * 3;
        std::array::from_fn(|k| f64::from(shape.positions[at + k]))
    };
    // No blocker triangle may touch a mesh triangle.
    let touch = longest * TOUCH;
    for tri in indices.as_chunks::<3>().0 {
        let a: [[f64; 3]; 3] = std::array::from_fn(|c| corner(tri[c]));
        let mut b = Aabb::EMPTY;
        for p in &a {
            b.grow_point(p.map(|v| v as f32));
        }
        let pad = touch as f32 + f32::EPSILON * longest as f32;
        let wide = Aabb {
            min: b.min.map(|v| v - pad),
            max: b.max.map(|v| v + pad),
        };
        let mut crossing = None;
        bvh.overlap(&wide, |t| {
            let at = t as usize * 3;
            let m: [[f64; 3]; 3] = std::array::from_fn(|c| mesh_corner(shape.indices[at + c]));
            let near = triangles_within(&a, &m, touch);
            if near {
                crossing = Some(t);
            }
            near
        });
        if let Some(triangle) = crossing {
            return Err(Failure::Crosses { triangle });
        }
    }
    // Every corner, and points spread over every triangle, must lie inside.
    let dirs = directions();
    let base = lo[1];
    let spacing = longest / SAMPLES_PER_SIDE;
    let jitter = [0.377, 0.613, 0.211].map(|j| j * longest * JITTER);
    // Hits this close along a ray count as one place, such as two faces that share an edge.
    let same = (longest * TOUCH) as f32;
    let inside = |p: [f64; 3]| -> Result<(), Failure> {
        let origin = add(p, jitter).map(|v| v as f32);
        for &direction in &dirs {
            let ray = Ray::new(origin, direction);
            let downward = ground && direction[1] < 0.0;
            let t_base = if downward {
                ((base - f64::from(origin[1])) / f64::from(direction[1])) as f32
            } else {
                f32::INFINITY
            };
            // The farthest hit before the ground, and whether a face there faces away from the
            // point, toward a camera farther along the ray.
            let (mut last, mut leaves) = (f32::NEG_INFINITY, false);
            bvh.raycast_all(&mesh, &ray, Side::Double, |hit| {
                if hit.t >= t_base {
                    return;
                }
                if hit.t > last + same {
                    (last, leaves) = (hit.t, !hit.front);
                } else if hit.t >= last - same {
                    leaves |= !hit.front;
                }
            });
            let passes = if downward && !leaves {
                // The ray may reach the ground where the model stands, which may be open below.
                let q = ray.at(t_base);
                q[0] >= lo[0] as f32
                    && q[0] <= hi[0] as f32
                    && q[2] >= lo[2] as f32
                    && q[2] <= hi[2] as f32
            } else {
                leaves
            };
            if !passes {
                return Err(Failure::Outside {
                    point: p.map(|v| v as f32),
                    direction,
                });
            }
        }
        Ok(())
    };
    for i in 0..(positions.len() / 3) as u32 {
        inside(corner(i))?;
    }
    for tri in indices.as_chunks::<3>().0 {
        let a: [[f64; 3]; 3] = std::array::from_fn(|c| corner(tri[c]));
        let side = (0..3)
            .map(|i| dot(sub(a[(i + 1) % 3], a[i]), sub(a[(i + 1) % 3], a[i])).sqrt())
            .fold(0.0, f64::max);
        let steps = ((side / spacing).ceil() as u32).max(1);
        for i in 0..=steps {
            for j in 0..=steps - i {
                let (u, v) = (
                    f64::from(i) / f64::from(steps),
                    f64::from(j) / f64::from(steps),
                );
                let p = add(
                    a[0],
                    add(scale(sub(a[1], a[0]), u), scale(sub(a[2], a[0]), v)),
                );
                inside(p)?;
            }
        }
    }
    Ok(())
}

/// Checks that every edge joins two triangles that run along it in opposite directions, and that
/// the surface encloses a positive volume, so it faces outward. Corners at the same position
/// count as one, as the engine welds them.
fn closed_outward(positions: &[f32], indices: &[u32]) -> Result<(), Failure> {
    if indices.is_empty() || !indices.len().is_multiple_of(3) {
        return Err(Failure::NotClosed);
    }
    let corners = positions.len() / 3;
    let mut welded: HashMap<[u32; 3], u32> = HashMap::new();
    let mut ids = Vec::with_capacity(corners);
    for p in positions.as_chunks::<3>().0 {
        let key = p.map(|v| (v + 0.0).to_bits());
        let next = welded.len() as u32;
        ids.push(*welded.entry(key).or_insert(next));
    }
    // Each edge's balance of directions and its number of triangles.
    let mut edges: HashMap<(u32, u32), (i32, u32)> = HashMap::new();
    let mut volume = 0.0;
    for tri in indices.as_chunks::<3>().0 {
        if tri.iter().any(|&i| i as usize >= corners) {
            return Err(Failure::NotClosed);
        }
        for k in 0..3 {
            let (a, b) = (ids[tri[k] as usize], ids[tri[(k + 1) % 3] as usize]);
            let edge = edges.entry((a.min(b), a.max(b))).or_insert((0, 0));
            edge.0 += if a < b { 1 } else { -1 };
            edge.1 += 1;
        }
        let p: [[f64; 3]; 3] = std::array::from_fn(|c| {
            let at = tri[c] as usize * 3;
            std::array::from_fn(|k| f64::from(positions[at + k]))
        });
        volume += dot(p[0], cross(p[1], p[2]));
    }
    let paired = edges
        .values()
        .all(|&(balance, uses)| balance == 0 && uses == 2);
    if !paired || volume <= 0.0 {
        return Err(Failure::NotClosed);
    }
    Ok(())
}

/// True when two triangles touch, cross, or come within `distance` of each other.
fn triangles_within(a: &[[f64; 3]; 3], b: &[[f64; 3]; 3], distance: f64) -> bool {
    let d2 = distance * distance;
    for i in 0..3 {
        if segment_crosses_triangle(a[i], a[(i + 1) % 3], b)
            || segment_crosses_triangle(b[i], b[(i + 1) % 3], a)
            || point_triangle_distance2(a[i], b) <= d2
            || point_triangle_distance2(b[i], a) <= d2
        {
            return true;
        }
        for j in 0..3 {
            if segment_distance2(a[i], a[(i + 1) % 3], b[j], b[(j + 1) % 3]) <= d2 {
                return true;
            }
        }
    }
    false
}

/// True when the segment from `p` to `q` meets the triangle, edges included.
fn segment_crosses_triangle(p: [f64; 3], q: [f64; 3], t: &[[f64; 3]; 3]) -> bool {
    let d = sub(q, p);
    let e1 = sub(t[1], t[0]);
    let e2 = sub(t[2], t[0]);
    let h = cross(d, e2);
    let det = dot(e1, h);
    if det == 0.0 {
        return false;
    }
    let s = sub(p, t[0]);
    let u = dot(s, h) / det;
    if !(0.0..=1.0).contains(&u) {
        return false;
    }
    let qv = cross(s, e1);
    let v = dot(d, qv) / det;
    if v < 0.0 || u + v > 1.0 {
        return false;
    }
    let along = dot(e2, qv) / det;
    (0.0..=1.0).contains(&along)
}

/// The squared distance from a point to a triangle, by Ericson's closest point test.
fn point_triangle_distance2(p: [f64; 3], t: &[[f64; 3]; 3]) -> f64 {
    let [a, b, c] = *t;
    let (ab, ac, ap) = (sub(b, a), sub(c, a), sub(p, a));
    let (d1, d2) = (dot(ab, ap), dot(ac, ap));
    let closest = if d1 <= 0.0 && d2 <= 0.0 {
        a
    } else {
        let bp = sub(p, b);
        let (d3, d4) = (dot(ab, bp), dot(ac, bp));
        if d3 >= 0.0 && d4 <= d3 {
            b
        } else {
            let vc = d1 * d4 - d3 * d2;
            if vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0 {
                add(a, scale(ab, d1 / (d1 - d3)))
            } else {
                let cp = sub(p, c);
                let (d5, d6) = (dot(ab, cp), dot(ac, cp));
                if d6 >= 0.0 && d5 <= d6 {
                    c
                } else {
                    let vb = d5 * d2 - d1 * d6;
                    if vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0 {
                        add(a, scale(ac, d2 / (d2 - d6)))
                    } else {
                        let va = d3 * d6 - d5 * d4;
                        if va <= 0.0 && (d4 - d3) >= 0.0 && (d5 - d6) >= 0.0 {
                            add(b, scale(sub(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6))))
                        } else {
                            let denom = va + vb + vc;
                            if denom == 0.0 {
                                // A triangle with no area: the nearest of its corners.
                                return [a, b, c]
                                    .iter()
                                    .map(|&q| dot(sub(p, q), sub(p, q)))
                                    .fold(f64::INFINITY, f64::min);
                            }
                            add(a, add(scale(ab, vb / denom), scale(ac, vc / denom)))
                        }
                    }
                }
            }
        }
    };
    let d = sub(p, closest);
    dot(d, d)
}

/// The squared distance between two segments, by Ericson's closest points test.
fn segment_distance2(p1: [f64; 3], q1: [f64; 3], p2: [f64; 3], q2: [f64; 3]) -> f64 {
    let (d1, d2, r) = (sub(q1, p1), sub(q2, p2), sub(p1, p2));
    let (a, e, f) = (dot(d1, d1), dot(d2, d2), dot(d2, r));
    let (s, t) = if a <= 0.0 && e <= 0.0 {
        (0.0, 0.0)
    } else if a <= 0.0 {
        (0.0, (f / e).clamp(0.0, 1.0))
    } else {
        let c = dot(d1, r);
        if e <= 0.0 {
            ((-c / a).clamp(0.0, 1.0), 0.0)
        } else {
            let b = dot(d1, d2);
            let denom = a * e - b * b;
            let mut s = if denom > 0.0 {
                ((b * f - c * e) / denom).clamp(0.0, 1.0)
            } else {
                0.0
            };
            let mut t = (b * s + f) / e;
            if t < 0.0 {
                t = 0.0;
                s = (-c / a).clamp(0.0, 1.0);
            } else if t > 1.0 {
                t = 1.0;
                s = ((b - c) / a).clamp(0.0, 1.0);
            }
            (s, t)
        }
    };
    let c1 = add(p1, scale(d1, s));
    let c2 = add(p2, scale(d2, t));
    let d = sub(c1, c2);
    dot(d, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A closed box from `lo` to `hi`, as 8 corners and 12 triangles facing outward.
    fn cuboid(lo: [f32; 3], hi: [f32; 3]) -> (Vec<f32>, Vec<u32>) {
        let boxes = [CellBox {
            lo: [0, 0, 0],
            hi: [1, 1, 1],
        }];
        let (corners, indices) = union_surface(&boxes);
        let positions = corners
            .iter()
            .flat_map(|c| {
                std::array::from_fn::<f32, 3, _>(|k| if c[k] == 0 { lo[k] } else { hi[k] })
            })
            .collect();
        (positions, indices)
    }

    #[test]
    fn a_box_surface_is_closed_and_faces_outward() {
        let (positions, indices) = cuboid([0.0; 3], [1.0, 2.0, 3.0]);
        assert_eq!(indices.len(), 36);
        assert_eq!(closed_outward(&positions, &indices), Ok(()));
        let flipped: Vec<u32> = indices.chunks(3).flat_map(|t| [t[0], t[2], t[1]]).collect();
        assert_eq!(
            closed_outward(&positions, &flipped),
            Err(Failure::NotClosed)
        );
        assert_eq!(
            closed_outward(&positions, &indices[..33]),
            Err(Failure::NotClosed)
        );
    }

    #[test]
    fn the_union_of_two_boxes_is_one_surface_without_inner_faces() {
        let boxes = [
            CellBox {
                lo: [0, 0, 0],
                hi: [4, 2, 2],
            },
            CellBox {
                lo: [2, 0, 0],
                hi: [4, 2, 6],
            },
        ];
        let (corners, indices) = union_surface(&boxes);
        let positions: Vec<f32> = corners.iter().flat_map(|c| c.map(|v| v as f32)).collect();
        assert_eq!(closed_outward(&positions, &indices), Ok(()));
        assert_eq!(union_volume(&boxes), 16 + 16);
    }

    #[test]
    fn the_box_test_finds_triangles_that_touch_a_cell() {
        let t = [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]];
        assert!(triangle_touches_box(&t, [0.2, 0.2, 0.0], 0.1));
        assert!(!triangle_touches_box(&t, [0.2, 0.2, 0.5], 0.1));
        assert!(!triangle_touches_box(&t, [0.8, 0.8, 0.0], 0.1));
        assert!(triangle_touches_box(&t, [0.55, 0.55, 0.0], 0.1));
    }

    #[test]
    fn distances_between_triangles() {
        let a = [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]];
        let above = a.map(|p| [p[0], p[1], p[2] + 0.5]);
        assert!(!triangles_within(&a, &above, 0.1));
        assert!(triangles_within(&a, &above, 0.6));
        let through = [[0.2, 0.2, -1.0], [0.2, 0.2, 1.0], [0.3, 0.25, 1.0]];
        assert!(triangles_within(&a, &through, 0.0));
    }
}
