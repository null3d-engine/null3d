//! Bounding volume hierarchies (BVHs): the trees that answer raycasts and overlap queries
//! without testing every object and every triangle.
//!
//! # Two levels
//!
//! The bottom level is one tree per mesh, over its triangles ([`mesh::MeshBvh`]). The asset tool
//! can store it in a file ([`format`]), or a job worker builds it when the mesh loads. A skinned
//! character's mesh uses the same tree, so queries test it in its bind pose, moved by its
//! object's matrix. The test of one capsule per bone ([`capsule`]) is not yet in the queries.
//!
//! The top level is a tree over objects' bounds ([`top::TopTree`]). [`scene::SceneBvh`] keeps two
//! of them for a scene:
//!
//! - Static objects: built once, with the surface area heuristic ([`build`]), and refitted when a
//!   static object moves. A change in which objects exist rebuilds it.
//! - Dynamic objects: rebuilt from their bounds in each frame that runs a query, from Morton
//!   codes and a radix sort ([`morton`]), with the subtrees built on the job workers.
//!
//! A query walks the top level to the objects whose boxes the ray or volume meets, moves the ray
//! into each object's own space, and walks that object's mesh tree.
//!
//! # Nodes
//!
//! Every tree uses the same node: four child boxes stored by axis ([`Node`]), so one SIMD
//! operation tests a ray against all four. A child is another node, a leaf (a run of up to
//! [`child::MAX_LEAF_COUNT`] primitives in the tree's order array), or empty. Nodes are stored
//! with each child after its parent, so a refit walks them backwards once, and a loaded tree that
//! keeps this rule cannot loop.
//!
//! A walk never follows an empty child, whatever its box test gives. A ray or a box that is not
//! finite in 32 bits can pass the test of an empty box, so the walks check the child word too.
//!
//! # Cells
//!
//! Object bounds are relative to the centers of their grid cells (see [`crate::cells`]). The top
//! level builds one subtree per cell, in that cell's frame. A query takes its origin in 64-bit
//! floats and moves it into each cell's frame before it walks that cell's subtree, so a ray
//! 6,000 km from the origin is as precise as one at the origin.
//!
//! # Robust boxes
//!
//! The ray-box test follows Ize's "Robust BVH Ray Traversal" (2013): it widens the far end of
//! each slab by the most its rounding can lose, so it never skips a box that holds a hit. Every
//! stored child box is also widened by one float step on each side, so a ray that runs exactly in
//! a box's face still enters it. A tree therefore finds every hit that testing each primitive in
//! turn finds, at the same distance.

pub mod build;
pub mod capsule;
pub mod format;
pub mod mesh;
pub mod morton;
pub mod query;
pub mod scene;
pub mod top;

use std::simd::prelude::*;

/// The most node levels from a root to its deepest node. Builds switch to splitting by count
/// before they reach it, and loaded trees deeper than it are refused.
pub const MAX_DEPTH: usize = 48;

/// Entries a traversal stack holds: three siblings per level and the node itself.
pub(crate) const STACK: usize = 3 * MAX_DEPTH + 1;

/// The node level from which builds split each node by count instead of by cost. Splitting by
/// count halves each part, so the tree stays within [`MAX_DEPTH`] for any input.
pub(crate) const COST_DEPTH: u32 = 32;

/// The most primitives in a part that one job worker builds alone, in the builds that run on
/// the job workers. One thread splits larger parts first.
pub const GRAIN: u32 = 1024;

/// The factor that widens the far end of a slab, `1 + 2γ₃` from Ize's paper rounded up, so
/// rounding never shortens a ray's span inside a box.
const FAR_SCALE: f32 = 1.0 + 4.0 * f32::EPSILON;

/// Child words: what each of a node's four children is.
///
/// | Word | Meaning |
/// | --- | --- |
/// | [`EMPTY`] | No child; its box is empty, so no test enters it |
/// | below [`LEAF`] | The index of a node |
/// | [`LEAF`] set | A leaf: `count - 1` in the bits from [`COUNT_SHIFT`], the first order entry below them |
pub mod child {
    /// No child.
    pub const EMPTY: u32 = u32::MAX;
    /// The bit that marks a leaf.
    pub const LEAF: u32 = 1 << 31;
    /// Where a leaf's count, less one, starts.
    pub const COUNT_SHIFT: u32 = 28;
    /// The bits of a leaf's first order entry.
    pub const FIRST_MASK: u32 = (1 << COUNT_SHIFT) - 1;
    /// The most primitives a leaf holds.
    pub const MAX_LEAF_COUNT: u32 = 8;
    /// The most primitives a tree holds.
    pub const MAX_PRIMITIVES: u32 = 1 << COUNT_SHIFT;

    /// A leaf of `count` primitives from order entry `first` on.
    ///
    /// # Panics
    /// In debug builds, when the count is 0 or over [`MAX_LEAF_COUNT`], or `first` does not fit.
    #[inline(always)]
    pub const fn leaf(first: u32, count: u32) -> u32 {
        debug_assert!(count >= 1 && count <= MAX_LEAF_COUNT && first <= FIRST_MASK);
        LEAF | ((count - 1) << COUNT_SHIFT) | first
    }

    /// True for a leaf word.
    #[inline(always)]
    pub const fn is_leaf(word: u32) -> bool {
        word & LEAF != 0 && word != EMPTY
    }

    /// True for a node word.
    #[inline(always)]
    pub const fn is_node(word: u32) -> bool {
        word & LEAF == 0
    }

    /// A leaf's first order entry and its count.
    #[inline(always)]
    pub const fn leaf_range(word: u32) -> (u32, u32) {
        (word & FIRST_MASK, ((word & !LEAF) >> COUNT_SHIFT) + 1)
    }
}

/// An axis-aligned box. An empty box has a minimum of +∞ and a maximum of -∞ on each axis.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Aabb {
    /// The lowest corner.
    pub min: [f32; 3],
    /// The highest corner.
    pub max: [f32; 3],
}

impl Default for Aabb {
    fn default() -> Self {
        Self::EMPTY
    }
}

impl Aabb {
    /// The box that holds nothing; growing it by a box gives that box.
    pub const EMPTY: Aabb = Aabb {
        min: [f32::INFINITY; 3],
        max: [f32::NEG_INFINITY; 3],
    };

    /// The box around three points.
    #[inline(always)]
    pub fn of_triangle(v: &[[f32; 3]; 3]) -> Aabb {
        Aabb {
            min: std::array::from_fn(|k| v[0][k].min(v[1][k]).min(v[2][k])),
            max: std::array::from_fn(|k| v[0][k].max(v[1][k]).max(v[2][k])),
        }
    }

    /// The box around a sphere. A sphere with a negative or NaN radius, or a centre that is not
    /// finite, gives the empty box, so queries never find it.
    #[inline(always)]
    pub fn of_sphere(center: [f32; 3], radius: f32) -> Aabb {
        if radius.is_nan() || radius < 0.0 || !center.iter().all(|v| v.is_finite()) {
            return Aabb::EMPTY;
        }
        Aabb {
            min: center.map(|c| c - radius),
            max: center.map(|c| c + radius),
        }
    }

    /// True when the box holds no point.
    #[inline(always)]
    pub fn is_empty(&self) -> bool {
        !(0..3).all(|k| self.min[k] <= self.max[k])
    }

    /// Grows the box to hold `other`.
    #[inline(always)]
    pub fn grow(&mut self, other: &Aabb) {
        for k in 0..3 {
            self.min[k] = self.min[k].min(other.min[k]);
            self.max[k] = self.max[k].max(other.max[k]);
        }
    }

    /// Grows the box to hold a point.
    #[inline(always)]
    pub fn grow_point(&mut self, p: [f32; 3]) {
        for k in 0..3 {
            self.min[k] = self.min[k].min(p[k]);
            self.max[k] = self.max[k].max(p[k]);
        }
    }

    /// The box's centre, which builds sort by.
    #[inline(always)]
    pub fn centroid(&self) -> [f32; 3] {
        std::array::from_fn(|k| (self.min[k] + self.max[k]) * 0.5)
    }

    /// Half the box's surface area, the cost the surface area heuristic weighs; 0 for an empty
    /// box.
    #[inline(always)]
    pub fn half_area(&self) -> f32 {
        if self.is_empty() {
            return 0.0;
        }
        let [x, y, z] = std::array::from_fn::<f32, 3, _>(|k| self.max[k] - self.min[k]);
        x * y + y * z + z * x
    }

    /// True when the box holds every point of `other`. Every box holds the empty box.
    pub fn contains(&self, other: &Aabb) -> bool {
        other.is_empty()
            || (0..3).all(|k| self.min[k] <= other.min[k] && other.max[k] <= self.max[k])
    }

    /// The box widened by one float step on each side, as nodes store it. Infinite bounds stay.
    #[inline(always)]
    pub fn widened(&self) -> Aabb {
        let down = |v: f32| if v.is_finite() { v.next_down() } else { v };
        let up = |v: f32| if v.is_finite() { v.next_up() } else { v };
        Aabb {
            min: self.min.map(down),
            max: self.max.map(up),
        }
    }

    /// The box around this box after the affine transform `m`, a 3 × 4 matrix by rows, widened
    /// by [`TRANSFORM_MARGIN`] of its size and position and by [`BOX_PAD`]. A ray's hit on a
    /// mesh, found in the mesh's own space, then lies in the box of the mesh's transformed box
    /// even after rounding. An empty box stays empty.
    pub fn transformed(&self, m: &crate::math::Affine) -> Aabb {
        if self.is_empty() {
            return Aabb::EMPTY;
        }
        let c = self.centroid().map(f64::from);
        let h: [f64; 3] = std::array::from_fn(|k| f64::from(self.max[k] - self.min[k]) * 0.5);
        let mut out = Aabb::EMPTY;
        for r in 0..3 {
            let row = |k: usize| f64::from(m[r * 4 + k]);
            let centre = row(0) * c[0] + row(1) * c[1] + row(2) * c[2] + row(3);
            let extent = row(0).abs() * h[0] + row(1).abs() * h[1] + row(2).abs() * h[2];
            let reach = extent + (centre.abs() + extent) * TRANSFORM_MARGIN + BOX_PAD;
            out.min[r] = (centre - reach) as f32;
            out.max[r] = (centre + reach) as f32;
        }
        out
    }
}

/// The share of a transformed box's size and position that [`Aabb::transformed`] adds on each
/// side: far more than 32-bit rounding moves a point, and far less than changes which rays
/// meet the box.
pub const TRANSFORM_MARGIN: f64 = 1.0 / (1 << 20) as f64;

/// The distance in meters that [`Aabb::transformed`] adds on each side: four float steps at
/// half a grid cell from the cell's centre, where a 32-bit position is least precise.
pub const BOX_PAD: f64 = 4.0 * (crate::cells::HALF_CELL as f64) * f32::EPSILON as f64;

/// A ray: the points `origin + t × direction` for `t` from `t_min` to `t_max`. The direction need
/// not have unit length; distances are in multiples of it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Ray {
    /// Where the ray starts.
    pub origin: [f32; 3],
    /// The ray's direction.
    pub direction: [f32; 3],
    /// The nearest distance a hit may have.
    pub t_min: f32,
    /// The farthest distance a hit may have.
    pub t_max: f32,
}

impl Ray {
    /// A ray from `origin` along `direction`, from distance 0 with no far limit.
    pub fn new(origin: [f32; 3], direction: [f32; 3]) -> Ray {
        Ray {
            origin,
            direction,
            t_min: 0.0,
            t_max: f32::INFINITY,
        }
    }

    /// The same ray with its far limit at `t_max`.
    pub fn with_max(self, t_max: f32) -> Ray {
        Ray { t_max, ..self }
    }

    /// The point at distance `t`.
    pub fn at(&self, t: f32) -> [f32; 3] {
        std::array::from_fn(|k| self.origin[k] + t * self.direction[k])
    }

    /// The ray in the local space of an object whose matrix (relative to the ray's frame) is
    /// `matrix`, with the same distances: the direction is not normalized, so a hit at distance
    /// `t` in local space is at distance `t` in the ray's frame. `None` when the matrix cannot be
    /// inverted, as with a zero scale.
    pub fn to_local(&self, matrix: &crate::math::Affine) -> Option<Ray> {
        let m64 = matrix.map(f64::from);
        let inv = crate::math::invert64(&m64)?;
        let o = self.origin.map(f64::from);
        let d = self.direction.map(f64::from);
        let row = |r: usize, v: [f64; 3], w: f64| {
            inv[r * 4] * v[0] + inv[r * 4 + 1] * v[1] + inv[r * 4 + 2] * v[2] + inv[r * 4 + 3] * w
        };
        Some(Ray {
            origin: std::array::from_fn(|r| row(r, o, 1.0) as f32),
            direction: std::array::from_fn(|r| row(r, d, 0.0) as f32),
            ..*self
        })
    }
}

/// A node: four child boxes stored by axis, and the four child words (see [`child`]). The layout
/// is fixed: it is the 112-byte record of the file format (see [`format`]).
#[derive(Clone, Copy, Debug, PartialEq)]
#[repr(C, align(16))]
pub struct Node {
    /// The lowest x, y and z of each child's box, by axis then child.
    pub min: [[f32; 4]; 3],
    /// The highest x, y and z of each child's box, by axis then child.
    pub max: [[f32; 4]; 3],
    /// The four child words.
    pub children: [u32; 4],
}

/// Bytes per node.
pub const NODE_BYTES: usize = std::mem::size_of::<Node>();
const _: () = assert!(NODE_BYTES == 112);

impl Default for Node {
    fn default() -> Self {
        Self::EMPTY
    }
}

impl Node {
    /// A node with four empty children.
    pub const EMPTY: Node = Node {
        min: [[f32::INFINITY; 4]; 3],
        max: [[f32::NEG_INFINITY; 4]; 3],
        children: [child::EMPTY; 4],
    };

    /// The stored box of child `i`.
    #[inline(always)]
    pub fn child_box(&self, i: usize) -> Aabb {
        Aabb {
            min: std::array::from_fn(|k| self.min[k][i]),
            max: std::array::from_fn(|k| self.max[k][i]),
        }
    }

    /// Sets child `i`'s word and box. The box is stored widened (see [`Aabb::widened`]).
    #[inline(always)]
    pub fn set_child(&mut self, i: usize, word: u32, bounds: &Aabb) {
        self.set_box(i, bounds);
        self.children[i] = word;
    }

    /// Sets child `i`'s box, widened.
    #[inline(always)]
    pub fn set_box(&mut self, i: usize, bounds: &Aabb) {
        let b = bounds.widened();
        for k in 0..3 {
            self.min[k][i] = b.min[k];
            self.max[k][i] = b.max[k];
        }
    }

    /// The box around the four children's stored boxes.
    #[inline(always)]
    pub fn bounds(&self) -> Aabb {
        let mn = self.min.map(|a| f32x4::from_array(a).reduce_min());
        let mx = self.max.map(|a| f32x4::from_array(a).reduce_max());
        Aabb { min: mn, max: mx }
    }
}

/// A ray prepared for the four-box test: its origin and inverse direction in every lane, and for
/// each axis whether the box's minimum is the near side.
#[derive(Clone, Copy, Debug)]
pub(crate) struct RayBoxes {
    origin: [f32x4; 3],
    inverse: [f32x4; 3],
    min_near: [bool; 3],
    t_min: f32x4,
}

impl RayBoxes {
    #[inline(always)]
    pub(crate) fn new(ray: &Ray) -> RayBoxes {
        // A zero component becomes the largest float, so slabs give 0 or ±∞ and never NaN; the
        // widened boxes keep a ray that runs in a face inside the box.
        let inverse = ray.direction.map(|d| {
            if d == 0.0 {
                f32::MAX.copysign(d)
            } else {
                1.0 / d
            }
        });
        RayBoxes {
            origin: ray.origin.map(f32x4::splat),
            inverse: inverse.map(f32x4::splat),
            min_near: inverse.map(|i| i >= 0.0),
            t_min: f32x4::splat(ray.t_min),
        }
    }

    /// The children of `node` that the ray meets before `t_max`, as a lane mask, and the
    /// distance at which it enters each.
    #[inline(always)]
    pub(crate) fn test(&self, node: &Node, t_max: f32) -> (Mask<i32, 4>, f32x4) {
        let mut near = self.t_min;
        let mut far = f32x4::splat(t_max);
        let scale = f32x4::splat(FAR_SCALE);
        for k in 0..3 {
            let (lo, hi) = if self.min_near[k] {
                (node.min[k], node.max[k])
            } else {
                (node.max[k], node.min[k])
            };
            let t0 = (f32x4::from_array(lo) - self.origin[k]) * self.inverse[k];
            let t1 = (f32x4::from_array(hi) - self.origin[k]) * self.inverse[k] * scale;
            // Compare and select: a NaN slab, from a box with NaN bounds, leaves the span alone.
            near = near.simd_lt(t0).select(t0, near);
            far = t1.simd_lt(far).select(t1, far);
        }
        (near.simd_le(far), near)
    }
}

/// An axis-aligned box in every lane, for the four-box overlap tests.
#[derive(Clone, Copy, Debug)]
pub(crate) struct BoxQuery {
    min: [f32x4; 3],
    max: [f32x4; 3],
}

impl BoxQuery {
    pub(crate) fn new(b: &Aabb) -> BoxQuery {
        BoxQuery {
            min: b.min.map(f32x4::splat),
            max: b.max.map(f32x4::splat),
        }
    }

    /// The children of `node` whose boxes touch the query box.
    #[inline(always)]
    pub(crate) fn test(&self, node: &Node) -> Mask<i32, 4> {
        let mut hit = Mask::splat(true);
        for k in 0..3 {
            hit &= f32x4::from_array(node.min[k]).simd_le(self.max[k])
                & f32x4::from_array(node.max[k]).simd_ge(self.min[k]);
        }
        hit
    }
}

/// A sphere in every lane, for the four-box overlap tests.
#[derive(Clone, Copy, Debug)]
pub(crate) struct SphereQuery {
    center: [f32x4; 3],
    radius_squared: f32x4,
}

impl SphereQuery {
    pub(crate) fn new(center: [f32; 3], radius: f32) -> SphereQuery {
        SphereQuery {
            center: center.map(f32x4::splat),
            radius_squared: f32x4::splat(radius * radius),
        }
    }

    /// The children of `node` whose boxes touch the sphere.
    #[inline(always)]
    pub(crate) fn test(&self, node: &Node) -> Mask<i32, 4> {
        let mut d2 = f32x4::splat(0.0);
        let mut nonempty = Mask::splat(true);
        for k in 0..3 {
            let lo = f32x4::from_array(node.min[k]);
            let hi = f32x4::from_array(node.max[k]);
            nonempty &= lo.simd_le(hi);
            let c = self.center[k];
            // The distance from the centre to the box along this axis: 0 inside the slab.
            let below = (lo - c).simd_max(f32x4::splat(0.0));
            let above = (c - hi).simd_max(f32x4::splat(0.0));
            let d = below + above;
            d2 += d * d;
        }
        nonempty & d2.simd_le(self.radius_squared)
    }
}

/// True when the sphere touches the box. This is the scalar test that [`SphereQuery`] runs four
/// at a time, for one box.
pub fn sphere_touches_box(center: [f32; 3], radius: f32, b: &Aabb) -> bool {
    if b.is_empty() {
        return false;
    }
    let mut d2 = 0.0;
    for k in 0..3 {
        let d = (b.min[k] - center[k]).max(0.0) + (center[k] - b.max[k]).max(0.0);
        d2 += d * d;
    }
    d2 <= radius * radius
}

/// Sorts `v` by `less`, a strict order, in place, with no allocation. Heap sort keeps the code
/// small in WebAssembly, where each of the standard library's sorts adds kilobytes per element
/// type. Equal elements may change places, so callers sort by keys that differ.
pub(crate) fn heap_sort_by<T: Copy>(v: &mut [T], less: impl Fn(&T, &T) -> bool) {
    let sift = |v: &mut [T], mut root: usize, end: usize| loop {
        let mut child = 2 * root + 1;
        if child >= end {
            return;
        }
        if child + 1 < end && less(&v[child], &v[child + 1]) {
            child += 1;
        }
        if !less(&v[root], &v[child]) {
            return;
        }
        v.swap(root, child);
        root = child;
    };
    let n = v.len();
    for root in (0..n / 2).rev() {
        sift(v, root, n);
    }
    for end in (1..n).rev() {
        v.swap(0, end);
        sift(v, 0, end);
    }
}

/// A fixed stack for traversals, which never allocates. Trees stay within [`MAX_DEPTH`], so it
/// cannot overflow.
pub(crate) struct Stack<T: Copy + Default> {
    items: [T; STACK],
    len: usize,
}

impl<T: Copy + Default> Stack<T> {
    #[inline(always)]
    pub(crate) fn new() -> Self {
        Self {
            items: [T::default(); STACK],
            len: 0,
        }
    }

    #[inline(always)]
    pub(crate) fn push(&mut self, item: T) {
        self.items[self.len] = item;
        self.len += 1;
    }

    #[inline(always)]
    pub(crate) fn pop(&mut self) -> Option<T> {
        if self.len == 0 {
            return None;
        }
        self.len -= 1;
        Some(self.items[self.len])
    }
}

/// Pushes the children that `mask` marks onto `stack` so the nearest pops first, each with its
/// entry distance. Empty children are never pushed.
#[inline(always)]
pub(crate) fn push_near_first(
    stack: &mut Stack<(u32, f32)>,
    node: &Node,
    mask: Mask<i32, 4>,
    near: f32x4,
) {
    let near = near.to_array();
    let mut hits = [(0u32, 0.0f32); 4];
    let mut n = 0;
    for i in 0..4 {
        if mask.test(i) && node.children[i] != child::EMPTY {
            hits[n] = (node.children[i], near[i]);
            n += 1;
        }
    }
    // Insertion sort, farthest first.
    for i in 1..n {
        let mut j = i;
        while j > 0 && hits[j - 1].1 < hits[j].1 {
            hits.swap(j - 1, j);
            j -= 1;
        }
    }
    for &hit in &hits[..n] {
        stack.push(hit);
    }
}

/// Sets every child box of `nodes` to the box around what lies under it, from the last node to
/// the first, so each child node is done before its parent. `entries` is the order array that
/// leaves index, and `box_of` gives the box of an entry's primitive.
pub(crate) fn refit_nodes(nodes: &mut [Node], entries: &[u32], box_of: impl Fn(u32) -> Aabb) {
    for i in (0..nodes.len()).rev() {
        for slot in 0..4 {
            let w = nodes[i].children[slot];
            let b = if child::is_leaf(w) {
                let (first, count) = child::leaf_range(w);
                let mut b = Aabb::EMPTY;
                for &id in &entries[first as usize..(first + count) as usize] {
                    b.grow(&box_of(id));
                }
                b
            } else if child::is_node(w) {
                nodes[w as usize].bounds()
            } else {
                continue;
            };
            nodes[i].set_box(slot, &b);
        }
    }
}

/// Walks the leaves of the tree under `root` that the ray enters, nearest first, and calls
/// `leaf` with each leaf's first order entry, its count and the current far limit. `leaf`
/// returns the new far limit, and leaves that start past it are skipped.
#[inline(always)]
pub(crate) fn walk_near_first(
    nodes: &[Node],
    root: u32,
    ray: &Ray,
    mut leaf: impl FnMut(u32, u32, f32) -> f32,
) {
    let boxes = RayBoxes::new(ray);
    let mut t_max = ray.t_max;
    let mut stack: Stack<(u32, f32)> = Stack::new();
    let mut node = &nodes[root as usize];
    loop {
        let (mask, near) = boxes.test(node, t_max);
        push_near_first(&mut stack, node, mask, near);
        loop {
            let Some((w, near)) = stack.pop() else {
                return;
            };
            if near > t_max {
                continue;
            }
            if child::is_leaf(w) {
                let (first, count) = child::leaf_range(w);
                t_max = leaf(first, count, t_max);
            } else {
                node = &nodes[w as usize];
                break;
            }
        }
    }
}

/// Walks the leaves of the tree under `root` that the ray enters, in no set order, until `leaf`
/// returns true. Returns true when it did.
#[inline(always)]
pub(crate) fn walk_any(
    nodes: &[Node],
    root: u32,
    ray: &Ray,
    leaf: impl FnMut(u32, u32) -> bool,
) -> bool {
    let boxes = RayBoxes::new(ray);
    walk_overlap(nodes, root, |node| boxes.test(node, ray.t_max).0, leaf)
}

/// Walks the leaves of the tree under `root` whose boxes `test` marks, until `leaf` returns
/// true. Returns true when it did. Empty children are never followed.
#[inline(always)]
pub(crate) fn walk_overlap(
    nodes: &[Node],
    root: u32,
    test: impl Fn(&Node) -> Mask<i32, 4>,
    mut leaf: impl FnMut(u32, u32) -> bool,
) -> bool {
    let mut stack: Stack<u32> = Stack::new();
    let mut node = &nodes[root as usize];
    loop {
        let mask = test(node);
        for (i, &w) in node.children.iter().enumerate() {
            if !mask.test(i) || w == child::EMPTY {
                continue;
            }
            if child::is_leaf(w) {
                let (first, count) = child::leaf_range(w);
                if leaf(first, count) {
                    return true;
                }
            } else {
                stack.push(w);
            }
        }
        match stack.pop() {
            Some(w) => node = &nodes[w as usize],
            None => return false,
        }
    }
}

/// The distance at which the ray enters the box before `ray.t_max`, by the same robust test
/// that tree walks use, or `None`. A ray that starts inside the box enters it at `ray.t_min`.
pub fn ray_box_entry(ray: &Ray, b: &Aabb) -> Option<f32> {
    let mut node = Node::EMPTY;
    for k in 0..3 {
        node.min[k][0] = b.min[k];
        node.max[k][0] = b.max[k];
    }
    let (mask, near) = RayBoxes::new(ray).test(&node, ray.t_max);
    mask.test(0).then(|| near[0])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn heap_sort_orders_like_the_standard_sort() {
        let mut state = 7u32;
        for n in [0usize, 1, 2, 3, 10, 257] {
            let mut v: Vec<(u32, u32)> = (0..n as u32)
                .map(|i| {
                    state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                    (state >> 24, i)
                })
                .collect();
            let mut want = v.clone();
            want.sort();
            heap_sort_by(&mut v, |a, b| a < b);
            assert_eq!(v, want);
        }
    }

    #[test]
    fn leaf_words_round_trip() {
        let w = child::leaf(12345, 4);
        assert!(child::is_leaf(w));
        assert!(!child::is_node(w));
        assert_eq!(child::leaf_range(w), (12345, 4));
        assert_eq!(
            child::leaf_range(child::leaf(child::FIRST_MASK, 8)),
            (child::FIRST_MASK, 8)
        );
        assert!(!child::is_leaf(child::EMPTY));
        assert!(!child::is_node(child::EMPTY));
        assert!(child::is_node(7));
    }

    #[test]
    fn empty_children_never_meet_a_ray() {
        for d in [[1.0, 0.0, 0.0], [-1.0, -2.0, 0.5], [0.0, 0.0, 0.0]] {
            let ray = RayBoxes::new(&Ray::new([0.0; 3], d));
            let (mask, _) = ray.test(&Node::EMPTY, f32::INFINITY);
            assert!(!mask.any());
        }
    }

    #[test]
    fn a_ray_in_a_face_enters_the_widened_box() {
        let mut node = Node::EMPTY;
        let b = Aabb {
            min: [0.0, 0.0, 0.0],
            max: [1.0, 1.0, 1.0],
        };
        node.set_child(0, 0, &b);
        // Along x, exactly in the face y = 1.
        let ray = RayBoxes::new(&Ray::new([-1.0, 1.0, 0.5], [1.0, 0.0, 0.0]));
        let (mask, near) = ray.test(&node, f32::INFINITY);
        assert!(mask.test(0));
        assert!((near[0] - 1.0).abs() < 1e-6);
        // A box behind the ray is missed.
        let ray = RayBoxes::new(&Ray::new([2.0, 0.5, 0.5], [1.0, 0.0, 0.0]));
        assert!(!ray.test(&node, f32::INFINITY).0.test(0));
    }

    #[test]
    fn overlap_tests_match_the_scalar_test() {
        let mut node = Node::EMPTY;
        let b = Aabb {
            min: [0.0, 0.0, 0.0],
            max: [1.0, 2.0, 3.0],
        };
        node.set_child(1, 0, &b);
        let wide = node.child_box(1);
        for (c, r) in [
            ([2.0, 1.0, 1.0], 1.0),
            ([2.0, 1.0, 1.0], 0.9),
            ([0.5; 3], 0.0),
        ] {
            assert_eq!(
                SphereQuery::new(c, r).test(&node).test(1),
                sphere_touches_box(c, r, &wide)
            );
            assert!(!SphereQuery::new(c, r).test(&node).test(0));
        }
        let q = Aabb {
            min: [1.0, 2.0, 3.0],
            max: [4.0, 4.0, 4.0],
        };
        assert!(BoxQuery::new(&q).test(&node).test(1));
        assert!(!BoxQuery::new(&q).test(&node).test(0));
    }

    #[test]
    fn rays_move_into_local_space_with_the_same_distances() {
        // Scaled by 2 and moved by 10 along x.
        let m = [
            2.0, 0.0, 0.0, 10.0, //
            0.0, 2.0, 0.0, 0.0, //
            0.0, 0.0, 2.0, 0.0,
        ];
        let ray = Ray::new([0.0, 0.0, 0.0], [1.0, 0.0, 0.0]);
        let local = ray.to_local(&m).unwrap();
        assert_eq!(local.origin, [-5.0, 0.0, 0.0]);
        assert_eq!(local.direction, [0.5, 0.0, 0.0]);
        // The local point at t is the world point at t.
        assert_eq!(local.at(10.0), [0.0, 0.0, 0.0]);
        assert!(ray.to_local(&[0.0; 12]).is_none());
    }
}
