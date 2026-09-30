//! Grid-cell culling, which both frame builders share: the cells whose objects a view can see,
//! found before any object is tested.
//!
//! # Still and moving sources
//!
//! A still source changes only when the sketch changes it: a static scene object whose ancestors
//! are all static, or a row of a static instance batch. Every other source that draws is moving: a
//! dynamic object, a static object under a dynamic one, which moves with it every frame, or a row
//! of a dynamic batch. Moving sources keep per-object culling, every frame.
//!
//! Scene slots never move, so the still scene objects are kept in cell order through an order
//! list ([`CellOrder`]): each cell's still objects are one run of the list, and the moving objects
//! follow them. Each cell also has a box around the spheres of its still sources, relative to the
//! cell's centre ([`CellBounds`]).
//!
//! # Each frame
//!
//! [`CellCulling::update`] keeps the order and the boxes in step with the scene. A still source
//! that changed in the frame grows its cell's box. A still source that changed cells, a layout
//! rebuild, or an upload list that overflowed builds the order and the boxes again, so a box
//! shrinks only then. Each view then tests every cell's box against its frustum moved into that
//! cell ([`CellCulling::visible`]), and skips every still source of a cell out of view. The test
//! leaves a margin for the rounding of the per-object test, so a cell out of view holds no still
//! source that the per-object test would keep.
//!
//! A scene whose sources all lie in the origin cell culls as it did without cells: one cell gives
//! nothing to skip. So does a builder made with cell culling off.

use std::collections::TryReserveError;
use std::ops::Range;

use null3d_core::cells::MAX_CELLS;
use null3d_core::culling::Frustum;
use null3d_core::scene::{NO_PARENT, SceneStorage, flags};
use null3d_core::world::SphereArrays;

use crate::frame::FrameInput;

/// The number of cell indices.
const CELLS: usize = MAX_CELLS as usize;
/// The cell of a source in the order's last run: the moving sources.
pub(crate) const MOVING: u32 = MAX_CELLS;
/// How far a cell's box must lie outside a plane, relative to the size of the numbers in the
/// test, before the cell counts as out of view: well past the rounding of the per-object test.
const MARGIN: f64 = 8.0 * f32::EPSILON as f64;

/// Visits sources for [`CellOrder::build`]: it calls the visitor it gets with each source and its
/// cell, or [`MOVING`].
pub(crate) type Visit<'a> = &'a dyn Fn(&mut dyn FnMut(u32, u32));

/// Sources grouped by cell: each cell's still sources in one run, in the order they were visited,
/// then the moving sources. It allocates only in [`CellOrder::try_reserve`].
#[derive(Debug, Default)]
pub(crate) struct CellOrder {
    order: Vec<u32>,
    /// Where each cell's run starts, then where the moving run starts and where it ends.
    starts: Vec<u32>,
}

impl CellOrder {
    /// Makes room for `sources` sources. Room only grows.
    pub(crate) fn try_reserve(&mut self, sources: usize) -> Result<(), TryReserveError> {
        grow(&mut self.order, sources, 0)?;
        grow(&mut self.starts, CELLS + 2, 0)
    }

    /// Builds the order from the sources that `visit` visits, twice. Each run keeps the order of
    /// the visits.
    ///
    /// # Panics
    /// When the sources are more than the room made for them, or a cell is past [`MOVING`].
    #[inline(never)]
    pub(crate) fn build(&mut self, visit: Visit<'_>) {
        let starts = &mut self.starts[..CELLS + 2];
        starts.fill(0);
        visit(&mut |_, cell| starts[cell as usize + 1] += 1);
        for k in 1..starts.len() {
            starts[k] += starts[k - 1];
        }
        assert!(
            starts[CELLS + 1] as usize <= self.order.len(),
            "room for {} sources, {} visited",
            self.order.len(),
            starts[CELLS + 1]
        );
        // Each run's start moves to its end while its sources go in, then back.
        let order = &mut self.order;
        visit(&mut |source, cell| {
            let at = &mut starts[cell as usize];
            order[*at as usize] = source;
            *at += 1;
        });
        for k in (1..=CELLS).rev() {
            starts[k] = starts[k - 1];
        }
        starts[0] = 0;
    }

    /// The positions of a cell's still sources, or of the moving sources for [`MOVING`].
    pub(crate) fn run(&self, cell: u32) -> Range<u32> {
        let c = cell as usize;
        self.starts[c]..self.starts[c + 1]
    }

    /// Every source, by position.
    pub(crate) fn sources(&self) -> &[u32] {
        &self.order[..self.len()]
    }

    /// The number of sources.
    pub(crate) fn len(&self) -> usize {
        self.starts.get(CELLS + 1).map_or(0, |&end| end as usize)
    }

    /// The number of still sources: those before the moving run.
    pub(crate) fn still(&self) -> usize {
        self.starts.get(CELLS).map_or(0, |&end| end as usize)
    }
}

/// A box, relative to its cell's centre: `lo` to `hi` on each axis. An empty box has `lo` above
/// `hi`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct CellBox {
    pub(crate) lo: [f32; 3],
    pub(crate) hi: [f32; 3],
}

impl CellBox {
    const EMPTY: CellBox = CellBox {
        lo: [f32::INFINITY; 3],
        hi: [f32::NEG_INFINITY; 3],
    };

    /// True when the box holds no sphere.
    pub(crate) fn is_empty(&self) -> bool {
        (0..3).any(|k| self.lo[k] > self.hi[k])
    }

    /// Grows the box to hold a sphere. A sphere with a negative infinite radius, which culling
    /// never keeps, or with a coordinate that is not a number, adds nothing; one with an
    /// infinite radius makes the box unbounded.
    #[inline(always)]
    fn add(&mut self, centre: [f32; 3], radius: f32) {
        for k in 0..3 {
            self.lo[k] = self.lo[k].min(centre[k] - radius);
            self.hi[k] = self.hi[k].max(centre[k] + radius);
        }
    }

    /// True when the box lies wholly outside one of the planes, by more than the margin for the
    /// rounding of the per-object test. It computes in 64-bit floats, and any value that is not a
    /// number keeps the box in view.
    pub(crate) fn outside(&self, planes: &[[f32; 4]; 6]) -> bool {
        planes.iter().any(|&[nx, ny, nz, d]| {
            let d = f64::from(d);
            let (mut reach, mut size, mut extent) = (d, d.abs(), 0.0f64);
            for (k, n) in [nx, ny, nz].into_iter().enumerate() {
                if n == 0.0 {
                    continue;
                }
                let (n, lo, hi) = (f64::from(n), f64::from(self.lo[k]), f64::from(self.hi[k]));
                reach += if n > 0.0 { n * hi } else { n * lo };
                size += n.abs() * lo.abs().max(hi.abs());
                extent = extent.max(hi - lo);
            }
            reach < -MARGIN * (size + extent)
        })
    }
}

/// The box around the spheres of each cell's still sources.
#[derive(Debug)]
pub(crate) struct CellBounds {
    boxes: Vec<CellBox>,
}

impl Default for CellBounds {
    fn default() -> Self {
        Self {
            boxes: vec![CellBox::EMPTY; CELLS],
        }
    }
}

impl CellBounds {
    fn clear(&mut self) {
        self.boxes.fill(CellBox::EMPTY);
    }

    #[inline(always)]
    fn add(&mut self, cell: u32, spheres: &SphereArrays<'_>, row: usize) {
        self.boxes[cell as usize].add(
            [spheres.xs[row], spheres.ys[row], spheres.zs[row]],
            spheres.radii[row],
        );
    }

    /// A cell's box.
    pub(crate) fn of(&self, cell: u32) -> &CellBox {
        &self.boxes[cell as usize]
    }
}

/// A set of cell indices.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct CellMask([u64; CELLS / 64]);

impl CellMask {
    /// Every cell.
    pub(crate) const ALL: CellMask = CellMask([u64::MAX; CELLS / 64]);

    pub(crate) fn contains(&self, cell: u32) -> bool {
        self.0[cell as usize / 64] & (1 << (cell % 64)) != 0
    }

    fn insert(&mut self, cell: u32) {
        self.0[cell as usize / 64] |= 1 << (cell % 64);
    }

    /// The cells in the set, in increasing index.
    pub(crate) fn iter(&self) -> impl Iterator<Item = u32> + '_ {
        self.0.iter().enumerate().flat_map(|(w, &word)| {
            let mut bits = word;
            std::iter::from_fn(move || {
                (bits != 0).then(|| {
                    let bit = bits.trailing_zeros();
                    bits &= bits - 1;
                    w as u32 * 64 + bit
                })
            })
        })
    }
}

/// What a scene slot is to cell culling.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Kind {
    /// It draws nowhere.
    None,
    /// A still source, kept in cell order.
    Still,
    /// A moving source.
    Moving,
}

/// Grid-cell culling's state for one frame builder. See the module documentation.
#[derive(Debug)]
pub(crate) struct CellCulling {
    /// False for a builder made with cell culling off.
    enabled: bool,
    /// True when the builder culls still scene objects from a copy of their spheres in cell
    /// order, which the order's positions index.
    copies: bool,
    kinds: Vec<Kind>,
    /// The cell each still slot had when the order was built.
    placed: Vec<u32>,
    /// The position of each still slot in the order.
    positions: Vec<u32>,
    scene: CellOrder,
    /// The still slots' spheres, by position, when the builder asked for copies.
    copy: [Vec<f32>; 4],
    bounds: CellBounds,
    /// Scratch for the classification: a chain of slots up to a known ancestor.
    chain: Vec<u32>,
    /// True when the order and the boxes match the scene as of the last update.
    current: bool,
    /// True when the last update found cells to cull by.
    active: bool,
    /// How many times the order was built, so a builder knows when to upload its own again.
    builds: u32,
}

impl CellCulling {
    /// Cell culling for a builder, or none when `enabled` is false. With `copies`, the builder
    /// culls still scene objects from [`CellCulling::still_spheres`].
    pub(crate) fn new(enabled: bool, copies: bool) -> Self {
        Self {
            enabled,
            copies,
            kinds: Vec::new(),
            placed: Vec::new(),
            positions: Vec::new(),
            scene: CellOrder::default(),
            copy: Default::default(),
            bounds: CellBounds::default(),
            chain: Vec::new(),
            current: false,
            active: false,
            builds: 0,
        }
    }

    /// Sorts the scene's slots into still and moving sources after a layout rebuild, which
    /// `drawn` gives each slot's part in: true for a slot with a mesh and a material that draw.
    /// The next update builds the order again. Allocates only the first time.
    #[inline(never)]
    pub(crate) fn classify(
        &mut self,
        scene: &SceneStorage,
        drawn: &dyn Fn(usize) -> bool,
    ) -> Result<(), TryReserveError> {
        self.current = false;
        if !self.enabled {
            return Ok(());
        }
        let rows = scene.capacity() as usize + 1;
        grow(&mut self.kinds, rows, Kind::None)?;
        grow(&mut self.placed, rows, 0)?;
        grow(&mut self.positions, rows, 0)?;
        grow(&mut self.chain, rows, 0)?;
        self.scene.try_reserve(rows)?;
        if self.copies {
            for array in &mut self.copy {
                grow(array, rows, 0.0)?;
            }
        }
        // First whether each slot and its ancestors are all static, then whether it draws.
        let (parents, slot_flags) = (scene.parents(), scene.flags());
        let high = scene.slots().high_water() as usize;
        let kinds = &mut self.kinds[..rows];
        kinds.fill(Kind::None);
        let unknown = |kind: Kind| kind == Kind::None;
        for slot in 0..high {
            if !unknown(kinds[slot]) {
                continue;
            }
            let mut len = 0;
            let mut at = slot;
            let kind = loop {
                if !unknown(kinds[at]) {
                    break kinds[at];
                }
                if slot_flags[at] & flags::DYNAMIC != 0 {
                    kinds[at] = Kind::Moving;
                    break Kind::Moving;
                }
                self.chain[len] = at as u32;
                len += 1;
                match parents[at] {
                    NO_PARENT => break Kind::Still,
                    parent => at = parent as usize,
                }
            };
            for &member in &self.chain[..len] {
                kinds[member as usize] = kind;
            }
        }
        for (slot, kind) in kinds[..high].iter_mut().enumerate() {
            if !drawn(slot) {
                *kind = Kind::None;
            }
        }
        Ok(())
    }

    /// Brings the order and the boxes up to the frame, and returns true when cell culling runs
    /// for it: the builder was made with it on, and the scene's sources lie in more than the
    /// origin cell. Call it once per frame, after [`CellCulling::classify`] for a new layout.
    /// Allocates nothing.
    #[inline(never)]
    pub(crate) fn update(&mut self, input: &FrameInput<'_>) -> bool {
        self.active = self.enabled && !input.scene.cell_table().origin_only();
        if !self.active {
            self.current = false;
            return false;
        }
        if !(self.current && self.follow(input)) {
            self.build(input);
        }
        true
    }

    /// True when the last update found cells to cull by.
    pub(crate) fn active(&self) -> bool {
        self.active
    }

    /// How many times the order was built; a builder whose order holds more than the scene's
    /// builds its own again when this changes.
    pub(crate) fn builds(&self) -> u32 {
        self.builds
    }

    /// The scene's drawn slots in cell order: still slots cell by cell, then the moving ones.
    pub(crate) fn scene_order(&self) -> &CellOrder {
        &self.scene
    }

    /// The still slots' spheres by position in the scene order, for a builder made with copies.
    pub(crate) fn still_spheres(&self) -> SphereArrays<'_> {
        let n = self.scene.still();
        let [xs, ys, zs, radii] = &self.copy;
        SphereArrays::new(&xs[..n], &ys[..n], &zs[..n], &radii[..n])
    }

    /// The cells whose still sources a view can see: those whose box is not wholly outside the
    /// view's frustum moved into the cell. `offsets` holds the offset from the view's camera to
    /// each cell in use.
    pub(crate) fn visible(&self, frustum: &Frustum, offsets: &[[f32; 4]]) -> CellMask {
        let mut mask = CellMask::default();
        for (cell, &[x, y, z, _]) in offsets.iter().enumerate() {
            let cell_box = self.bounds.of(cell as u32);
            if !cell_box.is_empty() && !cell_box.outside(frustum.moved_by([x, y, z]).planes()) {
                mask.insert(cell as u32);
            }
        }
        mask
    }

    /// Grows the boxes by the still sources that changed in the frame, and copies their spheres.
    /// Returns false when one changed cells, or the change list is incomplete, so the order must
    /// be built again.
    fn follow(&mut self, input: &FrameInput<'_>) -> bool {
        let (scene, parity) = (input.scene, input.parity());
        let spheres = scene.world(parity).spheres();
        let cells = scene.cells();
        for (start, count) in scene.changed().runs() {
            for slot in start as usize..(start + count) as usize {
                if self.kinds.get(slot) != Some(&Kind::Still) {
                    continue;
                }
                if cells[slot] != self.placed[slot] {
                    return false;
                }
                self.bounds.add(cells[slot], &spheres, slot);
                self.copy_sphere(self.positions[slot] as usize, &spheres, slot);
            }
        }
        for (_, batch) in input.batches.iter() {
            if batch.is_dynamic() || batch.frame() != input.frame {
                continue;
            }
            if batch.cell_changes().count > 0 {
                return false;
            }
            let rows = batch.world(parity).spheres();
            let (cells, active) = (batch.cells(), batch.frame_active_count(parity));
            for range in batch.changed_ranges() {
                for row in range.start..(range.start + range.count).min(active) {
                    self.bounds.add(cells[row as usize], &rows, row as usize);
                }
            }
        }
        true
    }

    /// Copies the sphere of scene slot `slot` to `position` of the still spheres, for a builder
    /// made with copies.
    #[inline(always)]
    fn copy_sphere(&mut self, position: usize, spheres: &SphereArrays<'_>, slot: usize) {
        if self.copies {
            let values = [spheres.xs, spheres.ys, spheres.zs, spheres.radii];
            for (array, values) in self.copy.iter_mut().zip(values) {
                array[position] = values[slot];
            }
        }
    }

    /// Visits each scene slot that draws, in slot order, with its cell when it is still, or
    /// [`MOVING`], as the scene order holds them.
    pub(crate) fn visit_scene(&self, scene: &SceneStorage, visit: &mut dyn FnMut(u32, u32)) {
        let cells = scene.cells();
        let high = (scene.slots().high_water() as usize).min(self.kinds.len());
        for (slot, kind) in self.kinds[..high].iter().enumerate() {
            match kind {
                Kind::Still => visit(slot as u32, cells[slot]),
                Kind::Moving => visit(slot as u32, MOVING),
                Kind::None => {}
            }
        }
    }

    /// Builds the scene order, the copies and the boxes from the frame's scene.
    fn build(&mut self, input: &FrameInput<'_>) {
        let (scene, parity) = (input.scene, input.parity());
        let spheres = scene.world(parity).spheres();
        let cells = scene.cells();
        let mut order = std::mem::take(&mut self.scene);
        order.build(&|visit| self.visit_scene(scene, visit));
        self.scene = order;
        self.bounds.clear();
        let still = self.scene.still();
        for position in 0..still {
            let s = self.scene.sources()[position] as usize;
            self.placed[s] = cells[s];
            self.positions[s] = position as u32;
            self.bounds.add(cells[s], &spheres, s);
            self.copy_sphere(position, &spheres, s);
        }
        for (_, batch) in input.batches.iter().filter(|(_, b)| !b.is_dynamic()) {
            let rows = batch.world(parity).spheres();
            let active = batch.frame_active_count(parity) as usize;
            for (row, &cell) in batch.cells()[..active].iter().enumerate() {
                self.bounds.add(cell, &rows, row);
            }
        }
        self.current = true;
        self.builds = self.builds.wrapping_add(1);
    }
}

/// Grows `v` to `len` entries of `fill`, or fails when memory cannot grow.
fn grow<T: Copy>(v: &mut Vec<T>, len: usize, fill: T) -> Result<(), TryReserveError> {
    if v.len() < len {
        v.try_reserve_exact(len - v.len())?;
        v.resize(len, fill);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_order_groups_sources_by_cell_and_keeps_their_order() {
        let mut order = CellOrder::default();
        order.try_reserve(8).unwrap();
        let sources = [
            (10, 3),
            (11, MOVING),
            (12, 0),
            (13, 3),
            (14, 511),
            (15, MOVING),
        ];
        order.build(&|visit: &mut dyn FnMut(u32, u32)| {
            for (source, cell) in sources {
                visit(source, cell);
            }
        });
        assert_eq!(order.sources(), [12, 10, 13, 14, 11, 15]);
        assert_eq!(order.run(0), 0..1);
        assert_eq!(order.run(1), 1..1);
        assert_eq!(order.run(3), 1..3);
        assert_eq!(order.run(511), 3..4);
        assert_eq!(order.run(MOVING), 4..6);
        assert_eq!((order.still(), order.len()), (4, 6));
    }

    #[test]
    fn a_mask_lists_its_cells_in_order() {
        let mut mask = CellMask::default();
        for cell in [300, 0, 63, 64, 511] {
            mask.insert(cell);
        }
        assert_eq!(mask.iter().collect::<Vec<_>>(), [0, 63, 64, 300, 511]);
        assert!(mask.contains(64) && !mask.contains(65));
        assert_eq!(CellMask::ALL.iter().count(), CELLS);
    }

    /// The planes of an axis-aligned box of space: x, y and z from `lo` to `hi`.
    fn slab(lo: [f32; 3], hi: [f32; 3]) -> Frustum {
        Frustum::from_planes([
            [1.0, 0.0, 0.0, -lo[0]],
            [-1.0, 0.0, 0.0, hi[0]],
            [0.0, 1.0, 0.0, -lo[1]],
            [0.0, -1.0, 0.0, hi[1]],
            [0.0, 0.0, 1.0, -lo[2]],
            [0.0, 0.0, -1.0, hi[2]],
        ])
    }

    /// A seeded random number in [0, 1).
    fn random(state: &mut u64) -> f32 {
        *state ^= *state << 13;
        *state ^= *state >> 7;
        *state ^= *state << 17;
        (*state >> 40) as f32 / (1u64 << 24) as f32
    }

    #[test]
    fn a_cell_out_of_view_holds_no_sphere_that_culling_each_sphere_keeps() {
        use crate::camera::{Lens, Orthographic, Perspective};
        use null3d_core::cells::CellPosition;
        let mut state = 0x9E37_79B9_7F4A_7C15;
        let mut r = |lo: f32, hi: f32| lo + (hi - lo) * random(&mut state);
        let (mut out, mut kept) = (0, 0);
        for trial in 0..300 {
            // A camera near the origin, or 1,000 km out, turned any way.
            let far = if trial % 2 == 0 { 0 } else { 977 };
            let camera = CellPosition {
                cell: [far + r(-2.0, 2.0) as i32, 0, r(-2.0, 2.0) as i32],
                local: [r(-512.0, 512.0), r(-40.0, 40.0), r(-512.0, 512.0)],
            };
            let (yaw, pitch) = (r(0.0, 6.3), r(-1.4, 1.4));
            let (sy, cy, sp, cp) = (yaw.sin(), yaw.cos(), pitch.sin(), pitch.cos());
            let world = [
                cy,
                sy * sp,
                sy * cp,
                0.0,
                0.0,
                cp,
                -sp,
                0.0,
                -sy,
                cy * sp,
                cy * cp,
                0.0,
            ];
            // Half the cameras of each distance look through an orthographic lens.
            let lens = if trial % 4 < 2 {
                Lens::from(Perspective {
                    fov_degrees: r(20.0, 110.0),
                    near: r(0.05, 5.0),
                    far: r(50.0, 4000.0),
                })
            } else {
                Lens::from(Orthographic {
                    height: r(10.0, 2000.0),
                    width: None,
                    center: [r(-50.0, 50.0), r(-50.0, 50.0)],
                    near: r(-100.0, 5.0),
                    far: r(50.0, 4000.0),
                })
            };
            let frustum =
                Frustum::from_view_projection(&lens.relative_view_projection(&world, 1.7));
            for _ in 0..20 {
                let cell = [
                    camera.cell[0] + r(-4.0, 4.0) as i32,
                    r(-1.0, 1.0) as i32,
                    camera.cell[2] + r(-4.0, 4.0) as i32,
                ];
                let moved = frustum.moved_by(camera.offset_to(cell));
                let mut spheres = Vec::new();
                for k in 0..40 {
                    let radius = if k % 7 == 0 {
                        r(10.0, 200.0)
                    } else {
                        r(0.1, 5.0)
                    };
                    let mut centre = [r(-512.0, 512.0), r(-60.0, 60.0), r(-512.0, 512.0)];
                    if k % 5 == 0 {
                        // Moved onto a plane so that it touches it from outside or inside by a
                        // hair, when the plane passes near the cell.
                        let [nx, ny, nz, d] = moved.planes()[k % 6];
                        let reach = nx * centre[0] + ny * centre[1] + nz * centre[2] + d;
                        let shift = reach + radius + r(-0.01, 0.01);
                        if shift.abs() > 300.0 {
                            continue;
                        }
                        centre = [
                            centre[0] - nx * shift,
                            centre[1] - ny * shift,
                            centre[2] - nz * shift,
                        ];
                    }
                    spheres.push((centre, radius));
                }
                let mut cell_box = CellBox::EMPTY;
                for &(centre, radius) in &spheres {
                    cell_box.add(centre, radius);
                }
                let any_kept = spheres
                    .iter()
                    .any(|&([x, y, z], radius)| moved.contains_sphere(x, y, z, radius));
                if cell_box.outside(moved.planes()) {
                    out += 1;
                    assert!(
                        !any_kept,
                        "trial {trial}: a cell out of view keeps a sphere"
                    );
                } else {
                    kept += usize::from(any_kept);
                }
            }
        }
        assert!(
            out > 100 && kept > 100,
            "{out} cells out of view, {kept} in view"
        );
    }

    #[test]
    fn a_box_is_outside_only_past_the_margin() {
        let mut cell_box = CellBox::EMPTY;
        assert!(cell_box.is_empty());
        cell_box.add([0.0, 0.0, 0.0], 1.0);
        cell_box.add([10.0, 0.0, 0.0], 1.0);
        assert_eq!(
            cell_box,
            CellBox {
                lo: [-1.0, -1.0, -1.0],
                hi: [11.0, 1.0, 1.0]
            }
        );
        let planes = |frustum: Frustum| *frustum.planes();
        // Touching counts as in view; a box clearly past a plane is out.
        assert!(!cell_box.outside(&planes(slab([11.0, -5.0, -5.0], [20.0, 5.0, 5.0]))));
        assert!(cell_box.outside(&planes(slab([11.1, -5.0, -5.0], [20.0, 5.0, 5.0]))));
        // Far out, the margin grows with the numbers: a box a millimetre past a plane 1,000 km
        // away stays in view, one a metre past is out.
        let far = |gap: f32| slab([1.0e6 + gap, -5.0, -5.0], [2.0e6, 5.0, 5.0]);
        cell_box.add([1.0e6, 0.0, 0.0], 0.0);
        assert!(!cell_box.outside(&planes(far(0.001))));
        assert!(cell_box.outside(&planes(far(4.0))));
        // Spheres culling never keeps add nothing; one without a bound keeps the box in view.
        let mut hidden = CellBox::EMPTY;
        hidden.add([0.0; 3], f32::NEG_INFINITY);
        hidden.add([f32::NAN, 0.0, 0.0], 1.0);
        assert!(hidden.is_empty());
        let mut unbounded = CellBox::EMPTY;
        unbounded.add([0.0; 3], f32::INFINITY);
        assert!(!unbounded.outside(&planes(slab([5.0; 3], [6.0; 3]))));
    }
}
