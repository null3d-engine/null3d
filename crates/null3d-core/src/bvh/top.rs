//! The top level: a tree over items' boxes, such as objects' bounds, with one subtree per grid
//! cell.
//!
//! Each item has an id (an object's slot), a cell, and a box relative to that cell's centre. A
//! build groups the items by cell and builds one subtree per cell in the cell's own frame, so
//! boxes stay precise however far the cell lies from the origin. A query takes its origin in
//! 64-bit floats, moves it into each cell's frame, and tests the cells' boxes first; a ray
//! visits cells nearest first and stops once a hit lies nearer than the next cell.
//!
//! Leaves hold one item each, so every item's box takes one lane of the four-box test, and a
//! query reaches only the items whose boxes it meets. The query then calls the caller's test for
//! each such item with the ray in the item's cell frame: the caller moves it into the object's
//! space and tests the mesh tree or the bone capsules.
//!
//! [`TopTree::build_sah`] suits items that rarely change, and [`TopTree::refit`] follows their
//! moves. [`TopTree::build_morton`] suits items that move every frame: it runs on the job
//! workers. After [`TopTree::try_reserve`] neither build allocates for as many items as were
//! reserved.

use std::collections::TryReserveError;
use std::ops::Range;

use super::build::{SahScratch, build_sah_parallel};
use super::morton::{MortonInput, MortonScratch, build_morton, node_room};
use super::{
    Aabb, BoxQuery, Node, Ray, SphereQuery, ray_box_entry, refit_nodes, walk_near_first,
    walk_overlap,
};
use crate::cells::{CELL_SIZE, CellCoords, CellTable, MAX_CELLS};
use crate::clusters::{count_cells, group_by_cell, grow, morton_sort};
use crate::jobs::JobSystem;
use crate::shared::SharedMut;

/// Items per chunk when [`TopTree::update_parallel`] splits its work.
pub const UPDATE_CHUNK: u32 = 1024;

/// A ray whose origin is in 64-bit floats, so it is precise anywhere in a large world. Distances
/// are in multiples of the direction.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WorldRay {
    /// Where the ray starts.
    pub origin: [f64; 3],
    /// The ray's direction.
    pub direction: [f32; 3],
    /// The nearest distance a hit may have.
    pub t_min: f32,
    /// The farthest distance a hit may have.
    pub t_max: f32,
}

impl WorldRay {
    /// A ray from `origin` along `direction`, from distance 0 with no far limit.
    pub fn new(origin: [f64; 3], direction: [f32; 3]) -> WorldRay {
        WorldRay {
            origin,
            direction,
            t_min: 0.0,
            t_max: f32::INFINITY,
        }
    }

    /// The same ray with its far limit at `t_max`.
    pub fn with_max(self, t_max: f32) -> WorldRay {
        WorldRay { t_max, ..self }
    }

    /// The ray in the frame of a cell: its origin relative to the cell's centre, computed in
    /// 64-bit floats and rounded once.
    pub fn in_cell(&self, cell: CellCoords) -> Ray {
        Ray {
            origin: in_cell(self.origin, cell),
            direction: self.direction,
            t_min: self.t_min,
            t_max: self.t_max,
        }
    }
}

/// A point relative to a cell's centre, computed in 64-bit floats and rounded once.
pub fn in_cell(point: [f64; 3], cell: CellCoords) -> [f32; 3] {
    std::array::from_fn(|k| (point[k] - f64::from(cell[k]) * f64::from(CELL_SIZE)) as f32)
}

/// A cell's subtree: the cell, its root node, and the box around its items in its frame.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CellRoot {
    /// The cell's coordinates.
    pub coords: CellCoords,
    /// The root node.
    pub node: u32,
    /// The box around the cell's items.
    pub bounds: Aabb,
}

/// A tree over items in cells. See the module documentation.
#[derive(Clone, Debug, Default)]
pub struct TopTree {
    ids: Vec<u32>,
    cells: Vec<u32>,
    boxes: Vec<Aabb>,
    /// Box centres by axis, which the Morton sort reads.
    centres: [Vec<f32>; 3],
    /// Items by cell, which the Morton sort reads.
    grouped: Vec<u32>,
    /// Leaf entries: the items in leaf order.
    order: Vec<u32>,
    codes: Vec<u32>,
    codes_back: Vec<u32>,
    order_back: Vec<u32>,
    ends: Vec<u32>,
    groups: Vec<Range<u32>>,
    group_cells: Vec<u32>,
    group_roots: Vec<u32>,
    nodes: Vec<Node>,
    roots: Vec<CellRoot>,
    sah: SahScratch,
    morton: MortonScratch,
    /// The node slots the last build used, from the first.
    used: u32,
}

impl TopTree {
    /// An empty tree. It allocates nothing until [`TopTree::try_reserve`] or a build.
    pub fn new() -> Self {
        Self::default()
    }

    /// Makes room for `items` items, and for the trees over them. Room only grows. Each build
    /// makes room for its own working space the first time it runs.
    pub fn try_reserve(&mut self, items: u32) -> Result<(), TryReserveError> {
        let n = items as usize;
        for v in [&mut self.ids, &mut self.cells] {
            if v.capacity() < n {
                v.try_reserve_exact(n - v.len())?;
            }
        }
        if self.boxes.capacity() < n {
            self.boxes.try_reserve_exact(n - self.boxes.len())?;
        }
        grow(&mut self.order, n, 0)?;
        grow(&mut self.ends, MAX_CELLS as usize, 0)?;
        let groups = n.min(MAX_CELLS as usize);
        for v in [&mut self.group_cells, &mut self.group_roots] {
            grow(v, groups, 0)?;
        }
        if self.groups.capacity() < groups {
            self.groups.try_reserve_exact(groups - self.groups.len())?;
        }
        if self.roots.capacity() < groups {
            self.roots.try_reserve_exact(groups - self.roots.len())?;
        }
        let nodes = node_room(items, groups as u32);
        if self.nodes.capacity() < nodes {
            self.nodes.try_reserve_exact(nodes - self.nodes.len())?;
        }
        Ok(())
    }

    /// Makes room for the Morton build's working space over the items.
    fn reserve_morton(&mut self) -> Result<(), TryReserveError> {
        let n = self.ids.len();
        for v in &mut self.centres {
            grow(v, n, 0.0)?;
        }
        for v in [
            &mut self.grouped,
            &mut self.codes,
            &mut self.codes_back,
            &mut self.order_back,
        ] {
            grow(v, n, 0)?;
        }
        self.morton.try_reserve(n as u32)
    }

    /// Removes every item and the tree.
    pub fn clear(&mut self) {
        self.ids.clear();
        self.cells.clear();
        self.boxes.clear();
        self.nodes.clear();
        self.roots.clear();
        self.used = 0;
    }

    /// Adds an item: its id, its cell index in the table that builds read, and its box in that
    /// cell's frame. The tree is stale until the next build.
    pub fn push(&mut self, id: u32, cell: u32, bounds: Aabb) {
        self.ids.push(id);
        self.cells.push(cell);
        self.boxes.push(bounds);
    }

    /// The number of items.
    pub fn len(&self) -> u32 {
        self.ids.len() as u32
    }

    /// True when there are no items.
    pub fn is_empty(&self) -> bool {
        self.ids.is_empty()
    }

    /// Each item's id.
    pub fn ids(&self) -> &[u32] {
        &self.ids
    }

    /// Each item's cell index.
    pub fn cells(&self) -> &[u32] {
        &self.cells
    }

    /// Each item's box.
    pub fn boxes(&self) -> &[Aabb] {
        &self.boxes
    }

    /// Sets item `i`'s cell and box. The tree is stale until a refit, or a build when the cell
    /// changed.
    pub fn set(&mut self, i: u32, cell: u32, bounds: Aabb) {
        self.cells[i as usize] = cell;
        self.boxes[i as usize] = bounds;
    }

    /// Sets the cell and box of each item of `items`, a range of item indices, to what `f`
    /// returns for its index and id, on the job workers.
    pub fn update_parallel(
        &mut self,
        jobs: &JobSystem,
        items: Range<u32>,
        f: &(dyn Fn(u32, u32) -> (u32, Aabb) + Sync),
    ) {
        let ids = &self.ids;
        let cells = SharedMut::new(&mut self.cells);
        let boxes = SharedMut::new(&mut self.boxes);
        let first = items.start;
        jobs.parallel_for(items.len() as u32, UPDATE_CHUNK, &|range, _| {
            for i in range.start + first..range.end + first {
                let (cell, b) = f(i, ids[i as usize]);
                // SAFETY: each chunk writes only the items of its own range.
                unsafe {
                    cells.write(i as usize, cell);
                    boxes.write(i as usize, b);
                }
            }
        });
    }

    /// The cells' subtrees.
    pub fn roots(&self) -> &[CellRoot] {
        &self.roots
    }

    /// The nodes. Builds on the job workers leave some empty.
    pub fn nodes(&self) -> &[Node] {
        &self.nodes[..self.used as usize]
    }

    /// Groups the items by cell into `out`, and lists each cell's run.
    fn group(&mut self, into_order: bool) {
        let n = self.ids.len();
        count_cells(&self.cells, &mut self.ends);
        let out = if into_order {
            &mut self.order[..n]
        } else {
            &mut self.grouped[..n]
        };
        group_by_cell(&self.cells, &mut self.ends, out);
        self.groups.clear();
        let mut g = 0;
        let mut start = 0;
        for (cell, &end) in self.ends.iter().enumerate() {
            if end > start {
                self.groups.push(start..end);
                self.group_cells[g] = cell as u32;
                g += 1;
            }
            start = end;
        }
    }

    /// Lists the cells' roots once their subtrees are built, or leaves the tree empty when the
    /// build failed.
    fn finish(
        &mut self,
        table: &CellTable,
        built: Result<u32, TryReserveError>,
    ) -> Result<(), TryReserveError> {
        self.roots.clear();
        self.used = *built.as_ref().unwrap_or(&0);
        if built.is_err() {
            self.groups.clear();
            return built.map(|_| ());
        }
        for g in 0..self.groups.len() {
            let node = self.group_roots[g];
            self.roots.push(CellRoot {
                coords: table.coords(self.group_cells[g]),
                node,
                bounds: self.nodes[node as usize].bounds(),
            });
        }
        Ok(())
    }

    /// Builds the tree with the SAH build (see [`super::build`]), on the job workers. `table`
    /// gives each cell index's coordinates.
    ///
    /// # Errors
    /// When memory cannot grow; the tree is then empty.
    pub fn build_sah(
        &mut self,
        table: &CellTable,
        jobs: &JobSystem,
    ) -> Result<(), TryReserveError> {
        self.try_reserve(self.len())?;
        self.roots.clear();
        self.used = 0;
        self.group(true);
        let n = self.ids.len();
        let boxes = &self.boxes;
        let built = build_sah_parallel(
            jobs,
            |id| boxes[id as usize],
            &mut self.order[..n],
            &self.groups,
            1,
            &mut self.group_roots,
            &mut self.nodes,
            &mut self.sah,
        );
        self.finish(table, built)
    }

    /// Builds the tree with the Morton build (see [`super::morton`]), on the job workers.
    ///
    /// # Errors
    /// When memory cannot grow; the tree is then empty.
    pub fn build_morton(
        &mut self,
        table: &CellTable,
        jobs: &JobSystem,
    ) -> Result<(), TryReserveError> {
        self.try_reserve(self.len())?;
        self.reserve_morton()?;
        self.roots.clear();
        self.used = 0;
        let n = self.ids.len();
        for (i, b) in self.boxes.iter().enumerate() {
            let c = b.centroid();
            for k in 0..3 {
                self.centres[k][i] = c[k];
            }
        }
        self.group(false);
        let [xs, ys, zs] = &self.centres;
        for run in &self.groups {
            let r = run.start as usize..run.end as usize;
            morton_sort(
                [&xs[..n], &ys[..n], &zs[..n]],
                Some(&self.grouped[r.clone()]),
                &mut self.codes[r.clone()],
                &mut self.codes_back[r.clone()],
                &mut self.order_back[r.clone()],
                &mut self.order[r],
            );
        }
        let built = build_morton(
            jobs,
            MortonInput {
                boxes: &self.boxes,
                order: &self.order[..n],
                codes: &self.codes[..n],
                max_leaf: 1,
            },
            &self.groups,
            &mut self.group_roots,
            &mut self.nodes,
            &mut self.morton,
        );
        self.finish(table, built)
    }

    /// Refits the tree to the items' current boxes, keeping its shape. Items must keep their
    /// cells: a cell change needs a build.
    pub fn refit(&mut self) {
        let boxes = &self.boxes;
        refit_nodes(&mut self.nodes[..self.used as usize], &self.order, |id| {
            boxes[id as usize]
        });
        for root in &mut self.roots {
            root.bounds = self.nodes[root.node as usize].bounds();
        }
    }

    /// The nearest item that `hit` reports a hit on, and the hit's distance. `hit` gets each
    /// item whose box the ray meets, nearest box first, as its id and the ray in its cell's
    /// frame with the far limit at the nearest hit so far; it returns the item's hit distance
    /// within the ray's limits, or `None`.
    pub fn raycast(
        &self,
        ray: &WorldRay,
        mut hit: impl FnMut(u32, &Ray) -> Option<f32>,
    ) -> Option<(u32, f32)> {
        let mut entries = [(0.0f32, 0u32); MAX_CELLS as usize];
        let n = self.cells_entered(ray, &mut entries);
        let mut best = None;
        let mut t_max = ray.t_max;
        for &(enter, r) in &entries[..n] {
            if enter > t_max {
                break;
            }
            let root = &self.roots[r as usize];
            let mut local = ray.in_cell(root.coords);
            local.t_max = t_max;
            walk_near_first(&self.nodes, root.node, &local, |first, count, limit| {
                let mut limit = limit;
                for &item in &self.order[first as usize..(first + count) as usize] {
                    let id = self.ids[item as usize];
                    if let Some(t) = hit(id, &local.with_max(limit)) {
                        limit = t;
                        best = Some((id, t));
                    }
                }
                limit
            });
            if let Some((_, t)) = best {
                t_max = t;
            }
        }
        best
    }

    /// True when `hit` reports a hit on any item whose box the ray meets. It stops at the first.
    /// `hit` gets the item's id and the ray in its cell's frame.
    pub fn raycast_any(&self, ray: &WorldRay, mut hit: impl FnMut(u32, &Ray) -> bool) -> bool {
        self.roots.iter().any(|root| {
            let local = ray.in_cell(root.coords);
            ray_box_entry(&local, &root.bounds).is_some()
                && super::walk_any(&self.nodes, root.node, &local, |first, count| {
                    self.order[first as usize..(first + count) as usize]
                        .iter()
                        .any(|&item| hit(self.ids[item as usize], &local))
                })
        })
    }

    /// Calls `visit` with the id of every item whose box the ray meets, and the ray in its
    /// cell's frame, in no set order.
    pub fn raycast_all(&self, ray: &WorldRay, mut visit: impl FnMut(u32, &Ray)) {
        self.raycast_any(ray, |id, local| {
            visit(id, local);
            false
        });
    }

    /// Calls `visit` with the id of every item whose box touches the box from `min` to `max`,
    /// and the box's minimum and maximum in the item's cell frame, in no set order.
    pub fn overlap_box(&self, min: [f64; 3], max: [f64; 3], mut visit: impl FnMut(u32, &Aabb)) {
        for root in &self.roots {
            let local = Aabb {
                min: in_cell(min, root.coords),
                max: in_cell(max, root.coords),
            };
            let query = BoxQuery::new(&local);
            let mut top = Node::EMPTY;
            top.set_child(0, 0, &root.bounds);
            if !query.test(&top).test(0) {
                continue;
            }
            walk_overlap(
                &self.nodes,
                root.node,
                |n| query.test(n),
                |first, count| {
                    for &item in &self.order[first as usize..(first + count) as usize] {
                        visit(self.ids[item as usize], &local);
                    }
                    false
                },
            );
        }
    }

    /// Calls `visit` with the id of every item whose box touches the sphere, and the sphere's
    /// centre in the item's cell frame, in no set order.
    pub fn overlap_sphere(
        &self,
        center: [f64; 3],
        radius: f32,
        mut visit: impl FnMut(u32, [f32; 3]),
    ) {
        for root in &self.roots {
            let local = in_cell(center, root.coords);
            if !super::sphere_touches_box(local, radius, &root.bounds) {
                continue;
            }
            let query = SphereQuery::new(local, radius);
            walk_overlap(
                &self.nodes,
                root.node,
                |n| query.test(n),
                |first, count| {
                    for &item in &self.order[first as usize..(first + count) as usize] {
                        visit(self.ids[item as usize], local);
                    }
                    false
                },
            );
        }
    }

    /// Writes each cell root the ray enters, as its entry distance and index, nearest first,
    /// and returns how many.
    fn cells_entered(&self, ray: &WorldRay, out: &mut [(f32, u32)]) -> usize {
        let mut n = 0;
        for (i, root) in self.roots.iter().enumerate() {
            if let Some(t) = ray_box_entry(&ray.in_cell(root.coords), &root.bounds) {
                out[n] = (t, i as u32);
                n += 1;
            }
        }
        super::heap_sort_by(&mut out[..n], |a, b| {
            a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)).is_lt()
        });
        n
    }
}
