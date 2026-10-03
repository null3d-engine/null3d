//! The binned surface area heuristic (SAH) build: the build for trees that are made once and
//! queried many times, such as mesh trees and the static top level.
//!
//! The build works top-down on a list of primitives. Each node starts with one part, all its
//! primitives, and splits the part with the largest surface area until it has four parts or no
//! part holds more than a leaf's worth. Each split sorts the part's box centres into [`BINS`]
//! bins along each axis and takes the plane between two bins that minimises
//! `area(left) × count(left) + area(right) × count(right)`, the expected cost of a ray that
//! enters the node. Parts of at most `max_leaf` primitives become leaves; larger parts become
//! child nodes, which split in turn.
//!
//! The primitives' boxes are copied once into a packed working array, one SIMD register per
//! corner, which each split reads in order and partitions in place. A split therefore reads its
//! part twice, once to bin it and once to partition it, and the bins give both sides' boxes.
//!
//! A part whose centres all coincide cannot be split by a plane, and from
//! [`COST_DEPTH`](super::COST_DEPTH) levels down every part splits by count instead: at the
//! middle of its run. Halving keeps the tree within [`MAX_DEPTH`](super::MAX_DEPTH) for any
//! input, such as one that the heuristic would split one primitive at a time.
//!
//! The build is serial and depends only on its input, so it gives the same tree, byte for byte,
//! on every machine: the asset tool and the engine agree. It allocates only when `nodes` or the
//! scratch must grow past their room.

use std::collections::TryReserveError;
use std::ops::Range;
use std::simd::prelude::*;

use super::{Aabb, COST_DEPTH, Node, Stack, child};
use crate::clusters::grow;
use crate::jobs::JobSystem;
use crate::shared::SharedMut;

/// Bins per axis.
pub const BINS: usize = 16;

/// A box with one SIMD register per corner; the fourth lanes are 0.
#[derive(Clone, Copy, Debug)]
struct Box4 {
    lo: f32x4,
    hi: f32x4,
}

impl Default for Box4 {
    fn default() -> Self {
        Self::EMPTY
    }
}

impl Box4 {
    const EMPTY: Box4 = Box4 {
        lo: f32x4::from_array([f32::INFINITY, f32::INFINITY, f32::INFINITY, 0.0]),
        hi: f32x4::from_array([f32::NEG_INFINITY, f32::NEG_INFINITY, f32::NEG_INFINITY, 0.0]),
    };

    #[inline(always)]
    fn of(b: &Aabb) -> Box4 {
        Box4 {
            lo: f32x4::from_array([b.min[0], b.min[1], b.min[2], 0.0]),
            hi: f32x4::from_array([b.max[0], b.max[1], b.max[2], 0.0]),
        }
    }

    #[inline(always)]
    fn aabb(&self) -> Aabb {
        let (lo, hi) = (self.lo.to_array(), self.hi.to_array());
        Aabb {
            min: [lo[0], lo[1], lo[2]],
            max: [hi[0], hi[1], hi[2]],
        }
    }

    /// Grows the box to hold `other`. Compare-and-select keeps a NaN bound out, as
    /// [`Aabb::grow`] does.
    #[inline(always)]
    fn grow(&mut self, other: &Box4) {
        self.lo = other.lo.simd_lt(self.lo).select(other.lo, self.lo);
        self.hi = other.hi.simd_gt(self.hi).select(other.hi, self.hi);
    }

    #[inline(always)]
    fn grow_point(&mut self, p: f32x4) {
        self.lo = p.simd_lt(self.lo).select(p, self.lo);
        self.hi = p.simd_gt(self.hi).select(p, self.hi);
    }

    /// Twice the box's centre.
    #[inline(always)]
    fn centre2(&self) -> f32x4 {
        self.lo + self.hi
    }

    /// Half the surface area, 0 for an empty box.
    #[inline(always)]
    fn half_area(&self) -> f32 {
        let e = (self.hi - self.lo).to_array();
        if !(e[0] >= 0.0 && e[1] >= 0.0 && e[2] >= 0.0) {
            return 0.0;
        }
        e[0] * e[1] + e[1] * e[2] + e[2] * e[0]
    }
}

/// A run of the working array, `start..end`, with the box around its primitives and the box
/// around their doubled centres.
#[derive(Clone, Copy, Debug, Default)]
struct Part {
    start: u32,
    end: u32,
    bounds: Box4,
    centres: Box4,
}

impl Part {
    fn len(&self) -> u32 {
        self.end - self.start
    }
}

/// A node waiting to be split.
#[derive(Clone, Copy, Debug)]
struct Task {
    node: u32,
    part: Part,
    depth: u32,
}

/// Working space for [`build_sah`]: the stack of nodes waiting to be split, and the packed
/// boxes.
#[derive(Clone, Debug, Default)]
pub struct SahScratch {
    tasks: Vec<Task>,
    subtasks: Vec<SubTask>,
    boxes: Vec<Box4>,
}

impl SahScratch {
    /// Makes room for builds over up to `primitives` primitives. Room only grows.
    pub fn try_reserve(&mut self, primitives: usize) -> Result<(), TryReserveError> {
        // The stack holds at most three siblings per level.
        let tasks = primitives.min(3 * super::MAX_DEPTH + 1);
        if self.tasks.capacity() < tasks {
            self.tasks.try_reserve_exact(tasks - self.tasks.len())?;
        }
        if self.boxes.capacity() < primitives {
            self.boxes
                .try_reserve_exact(primitives - self.boxes.len())?;
        }
        Ok(())
    }
}

/// One bin: the primitives whose centres fall in it.
#[derive(Clone, Copy, Debug, Default)]
struct Bin {
    bounds: Box4,
    centres: Box4,
    count: u32,
}

/// Splits a node's part into up to four parts: the part with the most area, or the most
/// primitives when splitting by count, splits until there are four or none holds more than
/// `max_leaf`. `boxes` and `ids` are the runs the parts index.
fn split_node(
    boxes: &mut [Box4],
    ids: &mut [u32],
    part: Part,
    depth: u32,
    max_leaf: u32,
) -> ([Part; 4], usize) {
    // A node of at most four single-primitive leaves has one shape, whatever the splits.
    let singles = max_leaf == 1 && part.len() <= 4;
    let by_count = depth >= COST_DEPTH || singles;
    let key = |p: &Part| {
        if by_count {
            p.len() as f32
        } else {
            p.bounds.half_area()
        }
    };
    let mut parts = [part; 4];
    let mut n = 1;
    while n < 4 {
        let pick = (0..n)
            .filter(|&i| parts[i].len() > max_leaf)
            // On a tie the first part wins, so the build depends on nothing but its input.
            .max_by(|&a, &b| key(&parts[a]).total_cmp(&key(&parts[b])).then(b.cmp(&a)));
        let Some(i) = pick else { break };
        let (left, right) = split(boxes, ids, &parts[i], by_count);
        parts[i] = left;
        parts[n] = right;
        n += 1;
    }
    (parts, n)
}

/// Copies the boxes of `ids` into the working array, and returns the part that spans them.
fn load(boxes: &mut Vec<Box4>, ids: &[u32], box_of: &impl Fn(u32) -> Aabb) -> Part {
    boxes.clear();
    let mut bounds = Box4::EMPTY;
    let mut centres = Box4::EMPTY;
    for &id in ids {
        let b = Box4::of(&box_of(id));
        bounds.grow(&b);
        centres.grow_point(b.centre2());
        boxes.push(b);
    }
    Part {
        start: 0,
        end: ids.len() as u32,
        bounds,
        centres,
    }
}

/// Builds a tree over the primitives that `order[range]` lists, whose boxes `box_of` gives, and
/// appends its nodes to `nodes`. Returns the root's index, or `None` when the range is empty.
/// `order[range]` ends in leaf order: each leaf names a run of it.
///
/// The root is a node even for one primitive. Every other node has at least two children, so a
/// build over `n` primitives appends at most `n` nodes. Nodes follow each other with no gap, as
/// the stored format needs.
///
/// # Errors
/// When `nodes` or the scratch cannot grow.
///
/// # Panics
/// When `max_leaf` is 0 or over [`child::MAX_LEAF_COUNT`], the range is past `order`, or the
/// order array is longer than [`child::MAX_PRIMITIVES`].
pub fn build_sah(
    box_of: impl Fn(u32) -> Aabb,
    order: &mut [u32],
    range: Range<u32>,
    max_leaf: u32,
    nodes: &mut Vec<Node>,
    scratch: &mut SahScratch,
) -> Result<Option<u32>, TryReserveError> {
    assert!((1..=child::MAX_LEAF_COUNT).contains(&max_leaf));
    assert!(order.len() as u64 <= u64::from(child::MAX_PRIMITIVES));
    if range.is_empty() {
        return Ok(None);
    }
    let ids = &mut order[range.start as usize..range.end as usize];
    scratch.try_reserve(ids.len())?;
    let whole = load(&mut scratch.boxes, ids, &box_of);
    let root = push_node(nodes)?;
    scratch.tasks.clear();
    scratch.tasks.push(Task {
        node: root,
        part: whole,
        depth: 0,
    });
    let boxes = &mut scratch.boxes[..];
    while let Some(task) = scratch.tasks.pop() {
        let (parts, n) = split_node(boxes, ids, task.part, task.depth, max_leaf);
        let mut node = Node::EMPTY;
        for (i, part) in parts[..n].iter().enumerate() {
            let word = if part.len() <= max_leaf {
                child::leaf(range.start + part.start, part.len())
            } else {
                let index = push_node(nodes)?;
                if scratch.tasks.len() == scratch.tasks.capacity() {
                    scratch.tasks.try_reserve(1)?;
                }
                scratch.tasks.push(Task {
                    node: index,
                    part: *part,
                    depth: task.depth + 1,
                });
                index
            };
            node.set_child(i, word, &part.bounds.aabb());
        }
        nodes[task.node as usize] = node;
    }
    Ok(Some(root))
}

/// A part that a job worker builds into its own node slots: the node whose child it is, the
/// child's place, and the part's first slot.
#[derive(Clone, Copy, Debug)]
struct SubTask {
    parent: u32,
    slot: u32,
    part: Part,
    depth: u32,
    base: u32,
}

/// Builds one tree per run of `groups` over the primitives that `order` lists, whose boxes
/// `box_of` gives, with the same splits as [`build_sah`], and writes each run's root node to
/// `roots`. Returns how many node slots the trees use, from the first: `nodes` holds the trees
/// there.
///
/// One thread splits the parts of more than [`GRAIN`](super::GRAIN) primitives, and the job
/// workers build the smaller parts' subtrees at once. A part of `m` primitives writes its nodes
/// into its own `m - 1` slots, and empties the slots it leaves unused, so the tree is the same for
/// any number of threads and a refit can walk every slot. It allocates nothing once `nodes` and
/// the scratch have room for [`node_room`](super::morton::node_room) nodes and the primitives.
///
/// # Errors
/// When `nodes` or the scratch cannot grow.
///
/// # Panics
/// As [`build_sah`] does, and when a run is empty or `roots` is shorter than `groups`.
#[allow(clippy::too_many_arguments)]
pub fn build_sah_parallel(
    jobs: &JobSystem,
    box_of: impl Fn(u32) -> Aabb,
    order: &mut [u32],
    groups: &[Range<u32>],
    max_leaf: u32,
    roots: &mut [u32],
    nodes: &mut Vec<Node>,
    scratch: &mut SahScratch,
) -> Result<u32, TryReserveError> {
    assert!((1..=child::MAX_LEAF_COUNT).contains(&max_leaf));
    assert!(order.len() as u64 <= u64::from(child::MAX_PRIMITIVES));
    assert!(roots.len() >= groups.len());
    let room = super::morton::node_room(order.len() as u32, groups.len() as u32);
    grow(nodes, room, Node::EMPTY)?;
    scratch.try_reserve(order.len())?;
    if scratch.subtasks.capacity() < order.len() / 2 {
        scratch
            .subtasks
            .try_reserve_exact(order.len() / 2 - scratch.subtasks.len())?;
    }
    let all = load(&mut scratch.boxes, order, &box_of);
    let boxes = &mut scratch.boxes[..];
    scratch.subtasks.clear();
    scratch.tasks.clear();
    let mut next = 0u32;
    for (g, run) in groups.iter().enumerate() {
        assert!(!run.is_empty() && run.end <= all.end);
        let (bounds, centres) = bounds_of(&boxes[run.start as usize..run.end as usize]);
        roots[g] = next;
        scratch.tasks.push(Task {
            node: next,
            part: Part {
                start: run.start,
                end: run.end,
                bounds,
                centres,
            },
            depth: 0,
        });
        next += 1;
        while let Some(task) = scratch.tasks.pop() {
            let (parts, n) = split_node(boxes, order, task.part, task.depth, max_leaf);
            let mut node = Node::EMPTY;
            for (slot, part) in parts[..n].iter().enumerate() {
                let len = part.len();
                let word = if len <= max_leaf {
                    child::leaf(part.start, len)
                } else if len > super::GRAIN {
                    scratch.tasks.push(Task {
                        node: next,
                        part: *part,
                        depth: task.depth + 1,
                    });
                    next += 1;
                    next - 1
                } else {
                    scratch.subtasks.push(SubTask {
                        parent: task.node,
                        slot: slot as u32,
                        part: *part,
                        depth: task.depth + 1,
                        base: 0,
                    });
                    child::EMPTY
                };
                node.set_child(slot, word, &part.bounds.aabb());
            }
            nodes[task.node as usize] = node;
        }
    }
    // Each part's slots follow the upper nodes, in part order.
    for sub in &mut scratch.subtasks {
        sub.base = next;
        next += sub.part.len() - 1;
        nodes[sub.parent as usize].children[sub.slot as usize] = sub.base;
    }
    debug_assert!(next as usize <= room);
    let shared_nodes = SharedMut::new(&mut nodes[..]);
    let shared_boxes = SharedMut::new(boxes);
    let shared_ids = SharedMut::new(order);
    let subtasks = &scratch.subtasks;
    jobs.parallel_for(subtasks.len() as u32, 1, &|range, _| {
        for sub in &subtasks[range.start as usize..range.end as usize] {
            let (s, len) = (sub.part.start as usize, sub.part.len() as usize);
            // SAFETY: each part owns its run of the boxes and ids and its node slots, which no
            // other part touches.
            let (boxes, ids, mine) = unsafe {
                (
                    shared_boxes.slice(s, len),
                    shared_ids.slice(s, len),
                    shared_nodes.slice(sub.base as usize, len - 1),
                )
            };
            build_subtree(boxes, ids, mine, sub, max_leaf);
        }
    });
    Ok(next)
}

/// Builds one part's subtree into its own node slots, depth first, and empties the slots left.
fn build_subtree(
    boxes: &mut [Box4],
    ids: &mut [u32],
    mine: &mut [Node],
    sub: &SubTask,
    max_leaf: u32,
) {
    let start = sub.part.start;
    let local = Part {
        start: 0,
        end: sub.part.len(),
        ..sub.part
    };
    let mut next = 1usize;
    let mut stack: Stack<(u32, Part, u32)> = Stack::new();
    stack.push((0, local, sub.depth));
    while let Some((at, part, depth)) = stack.pop() {
        let (parts, n) = split_node(boxes, ids, part, depth, max_leaf);
        let mut node = Node::EMPTY;
        for (slot, p) in parts[..n].iter().enumerate() {
            let word = if p.len() <= max_leaf {
                child::leaf(start + p.start, p.len())
            } else {
                stack.push((next as u32, *p, depth + 1));
                next += 1;
                sub.base + next as u32 - 1
            };
            node.set_child(slot, word, &p.bounds.aabb());
        }
        mine[at as usize] = node;
    }
    mine[next..].fill(Node::EMPTY);
}

fn push_node(nodes: &mut Vec<Node>) -> Result<u32, TryReserveError> {
    if nodes.len() == nodes.capacity() {
        nodes.try_reserve(1)?;
    }
    nodes.push(Node::EMPTY);
    Ok(nodes.len() as u32 - 1)
}

/// The box around `boxes` and the box around their doubled centres.
fn bounds_of(boxes: &[Box4]) -> (Box4, Box4) {
    let mut bounds = Box4::EMPTY;
    let mut centres = Box4::EMPTY;
    for b in boxes {
        bounds.grow(b);
        centres.grow_point(b.centre2());
    }
    (bounds, centres)
}

/// Splits a part of at least two primitives into two non-empty parts, reordering its run of the
/// working array and of the ids alike.
fn split(boxes: &mut [Box4], ids: &mut [u32], part: &Part, by_count: bool) -> (Part, Part) {
    let (s, e) = (part.start as usize, part.end as usize);
    let extent = (part.centres.hi - part.centres.lo).to_array();
    let spread = extent[..3].iter().any(|&v| v > 0.0);
    if !by_count && spread && part.len() as usize <= SMALL {
        let mid = split_small(&mut boxes[s..e], &mut ids[s..e]);
        return halves(boxes, part, part.start + mid as u32);
    }
    if !by_count && spread {
        let lo = part.centres.lo;
        let scale = f32x4::from_array(std::array::from_fn(|k| {
            if k < 3 && extent[k] > 0.0 {
                BINS as f32 / extent[k]
            } else {
                0.0
            }
        }));
        let (bins, best) = bin_and_choose(&boxes[s..e], lo, scale, part.len());
        if let Some((axis, plane)) = best {
            let mid = partition(&mut boxes[s..e], &mut ids[s..e], |b| {
                bin_of(b.centre2(), lo, scale)[axis] < plane as i32
            });
            let mut sides = [(Box4::EMPTY, Box4::EMPTY); 2];
            for (i, bin) in bins[axis].iter().enumerate() {
                let side = &mut sides[usize::from(i >= plane)];
                side.0.grow(&bin.bounds);
                side.1.grow(&bin.centres);
            }
            let at = part.start + mid as u32;
            return (
                Part {
                    start: part.start,
                    end: at,
                    bounds: sides[0].0,
                    centres: sides[0].1,
                },
                Part {
                    start: at,
                    end: part.end,
                    bounds: sides[1].0,
                    centres: sides[1].1,
                },
            );
        }
    }
    // By count: the middle of the run. The run keeps the order of earlier splits, which follows
    // the space, and identical centres have no better order.
    halves(boxes, part, part.start + part.len() / 2)
}

/// The two parts of a run split at `mid`, with their boxes.
fn halves(boxes: &[Box4], part: &Part, mid: u32) -> (Part, Part) {
    let (lb, lc) = bounds_of(&boxes[part.start as usize..mid as usize]);
    let (rb, rc) = bounds_of(&boxes[mid as usize..part.end as usize]);
    (
        Part {
            start: part.start,
            end: mid,
            bounds: lb,
            centres: lc,
        },
        Part {
            start: mid,
            end: part.end,
            bounds: rb,
            centres: rc,
        },
    )
}

/// The most primitives in a part that splits by sorting instead of by bins.
const SMALL: usize = 16;

/// Splits a run of at most [`SMALL`] primitives at the cheapest of all its splits along each
/// axis, in the order of their centres: the exact heuristic, cheaper than binning at this size.
/// Reorders the run along the chosen axis and returns where the right side starts.
fn split_small(boxes: &mut [Box4], ids: &mut [u32]) -> usize {
    let n = boxes.len();
    let mut best: Option<(f32, usize, usize)> = None;
    let mut sorted = [[0u8; SMALL]; 3];
    for (k, order) in sorted.iter_mut().enumerate() {
        // A stable insertion sort by centre: ties keep their places, so the order is total.
        let key = |at: u8| boxes[at as usize].centre2()[k];
        for i in 0..n {
            order[i] = i as u8;
            let mut j = i;
            while j > 0 && key(order[j - 1]).total_cmp(&key(order[j])).is_gt() {
                order.swap(j - 1, j);
                j -= 1;
            }
        }
        let mut right = [0.0f32; SMALL];
        let mut acc = Box4::EMPTY;
        for i in (1..n).rev() {
            acc.grow(&boxes[order[i] as usize]);
            right[i] = acc.half_area() * (n - i) as f32;
        }
        let mut acc = Box4::EMPTY;
        for i in 1..n {
            acc.grow(&boxes[order[i - 1] as usize]);
            let cost = acc.half_area() * i as f32 + right[i];
            if best.is_none_or(|(c, _, _)| cost < c) {
                best = Some((cost, k, i));
            }
        }
    }
    let (_, axis, mid) = best.unwrap_or((0.0, 0, n / 2));
    let mut moved_boxes = [Box4::EMPTY; SMALL];
    let mut moved_ids = [0u32; SMALL];
    for (i, &from) in sorted[axis][..n].iter().enumerate() {
        moved_boxes[i] = boxes[from as usize];
        moved_ids[i] = ids[from as usize];
    }
    boxes.copy_from_slice(&moved_boxes[..n]);
    ids.copy_from_slice(&moved_ids[..n]);
    mid
}

/// The bin of each axis for a doubled centre.
#[inline(always)]
fn bin_of(c2: f32x4, lo: f32x4, scale: f32x4) -> i32x4 {
    // A float-to-integer cast saturates and turns NaN into 0.
    ((c2 - lo) * scale)
        .cast::<i32>()
        .simd_clamp(i32x4::splat(0), i32x4::splat(BINS as i32 - 1))
}

/// Bins a run along each axis, and returns the bins with the axis and the first bin of the
/// right side of the cheapest plane, or `None` when every centre falls in one bin.
#[allow(clippy::type_complexity)]
fn bin_and_choose(
    run: &[Box4],
    lo: f32x4,
    scale: f32x4,
    len: u32,
) -> ([[Bin; BINS]; 3], Option<(usize, usize)>) {
    let mut bins = [[Bin::default(); BINS]; 3];
    for b in run {
        let c2 = b.centre2();
        let at = bin_of(c2, lo, scale).to_array();
        for k in 0..3 {
            let bin = &mut bins[k][at[k] as usize];
            bin.bounds.grow(b);
            bin.centres.grow_point(c2);
            bin.count += 1;
        }
    }
    let mut best: Option<(f32, usize, usize)> = None;
    for (k, axis) in bins.iter().enumerate() {
        if scale[k] == 0.0 {
            continue;
        }
        // Costs of the right sides, swept from the last bin.
        let mut right_cost = [0.0f32; BINS];
        let mut acc = Box4::EMPTY;
        let mut count = 0u32;
        for i in (1..BINS).rev() {
            acc.grow(&axis[i].bounds);
            count += axis[i].count;
            right_cost[i] = acc.half_area() * count as f32;
        }
        let mut acc = Box4::EMPTY;
        let mut left = 0u32;
        for i in 1..BINS {
            acc.grow(&axis[i - 1].bounds);
            left += axis[i - 1].count;
            if left == 0 || left == len {
                continue;
            }
            let cost = acc.half_area() * left as f32 + right_cost[i];
            if best.is_none_or(|(c, _, _)| cost < c) {
                best = Some((cost, k, i));
            }
        }
    }
    (bins, best.map(|(_, k, i)| (k, i)))
}

/// Moves the boxes for which `left` holds to the front, with their ids, and returns how many
/// there are.
fn partition(boxes: &mut [Box4], ids: &mut [u32], left: impl Fn(&Box4) -> bool) -> usize {
    let mut i = 0;
    let mut j = boxes.len();
    loop {
        while i < j && left(&boxes[i]) {
            i += 1;
        }
        while i < j && !left(&boxes[j - 1]) {
            j -= 1;
        }
        if i >= j {
            return i;
        }
        boxes.swap(i, j - 1);
        ids.swap(i, j - 1);
        i += 1;
        j -= 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unit_box(x: f32) -> Aabb {
        Aabb {
            min: [x, 0.0, 0.0],
            max: [x + 1.0, 1.0, 1.0],
        }
    }

    #[test]
    fn every_primitive_lands_in_exactly_one_leaf() {
        let boxes: Vec<Aabb> = (0..1000).map(|i| unit_box((i * 7 % 1000) as f32)).collect();
        let mut order: Vec<u32> = (0..1000).collect();
        let mut nodes = Vec::new();
        let root = build_sah(
            |id| boxes[id as usize],
            &mut order,
            0..1000,
            4,
            &mut nodes,
            &mut SahScratch::default(),
        )
        .unwrap()
        .unwrap();
        assert_eq!(root, 0);
        assert!(nodes.len() <= 1000);
        let mut seen = vec![0u32; 1000];
        for (i, node) in nodes.iter().enumerate() {
            for (c, &w) in node.children.iter().enumerate() {
                if child::is_leaf(w) {
                    let (first, count) = child::leaf_range(w);
                    assert!(count <= 4);
                    for &id in &order[first as usize..(first + count) as usize] {
                        seen[id as usize] += 1;
                        assert!(node.child_box(c).contains(&boxes[id as usize]));
                    }
                } else if child::is_node(w) {
                    assert!(w as usize > i, "children come after their parents");
                    assert!(node.child_box(c).contains(&nodes[w as usize].bounds()));
                }
            }
        }
        assert!(seen.iter().all(|&s| s == 1));
    }

    #[test]
    fn identical_boxes_split_by_count_and_stay_shallow() {
        let boxes = [unit_box(0.0)];
        let mut order: Vec<u32> = vec![0; 10_000];
        let mut nodes = Vec::new();
        build_sah(
            |id| boxes[id as usize],
            &mut order,
            0..10_000,
            1,
            &mut nodes,
            &mut SahScratch::default(),
        )
        .unwrap();
        // Depth of each node, parents first.
        let mut depth = vec![0usize; nodes.len()];
        for i in 0..nodes.len() {
            for &w in &nodes[i].children {
                if child::is_node(w) {
                    depth[w as usize] = depth[i] + 1;
                }
            }
        }
        assert!(depth.iter().max().copied().unwrap() < super::super::MAX_DEPTH);
    }

    #[test]
    fn a_range_builds_over_its_own_entries() {
        let boxes: Vec<Aabb> = (0..10).map(|i| unit_box(i as f32)).collect();
        let mut order: Vec<u32> = (0..10).collect();
        let mut nodes = Vec::new();
        let mut scratch = SahScratch::default();
        build_sah(
            |id| boxes[id as usize],
            &mut order,
            3..8,
            1,
            &mut nodes,
            &mut scratch,
        )
        .unwrap();
        let mut leaves: Vec<u32> = nodes
            .iter()
            .flat_map(|n| n.children)
            .filter(|&w| child::is_leaf(w))
            .map(|w| child::leaf_range(w).0)
            .collect();
        leaves.sort_unstable();
        assert_eq!(leaves, [3, 4, 5, 6, 7]);
        assert_eq!(&order[..3], &[0, 1, 2]);
        let built = build_sah(
            |_| unit_box(0.0),
            &mut [],
            0..0,
            4,
            &mut nodes,
            &mut scratch,
        );
        assert_eq!(built.unwrap(), None);
    }
}
