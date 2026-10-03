//! The Morton build (a linear BVH): the build for trees remade in every frame that queries them,
//! such as the top level over dynamic objects.
//!
//! The primitives are first sorted along a Morton curve through the box around their centres,
//! with the radix sort that clusters use (see [`crate::clusters`]). Primitives close in space are
//! then close in the order, and the tree follows the curve: a node's run of the order splits
//! where the highest bit of the Morton code changes, which cuts its box in half along one axis.
//! Each node takes up to four parts by splitting its largest part again, as the SAH build does.
//!
//! A split costs one binary search, so the build is linear in the primitive count, and it needs
//! no boxes until the end: the topology comes from the codes, and the boxes are filled from the
//! last node to the first, each child after its parent.
//!
//! # In parallel
//!
//! One thread splits the runs of more than [`GRAIN`] primitives. Each smaller run becomes a task,
//! and the job workers build the tasks' subtrees at once. A task of `m` primitives writes into its
//! own `m - 1` node slots, which no other task touches, and empties the slots it leaves unused.
//! The tree is the same for any number of threads. It allocates nothing once
//! [`MortonScratch::try_reserve`] and the caller's node array have room.

use std::collections::TryReserveError;
use std::ops::Range;

use super::{Aabb, COST_DEPTH, GRAIN, Node, Stack, child};
use crate::clusters::grow;
use crate::jobs::JobSystem;
use crate::shared::SharedMut;

/// A run of primitives that a job worker builds into its own node slots.
#[derive(Clone, Copy, Debug, Default)]
struct Task {
    /// The node whose child the run is, and the child's place in it.
    parent: u32,
    slot: u32,
    start: u32,
    end: u32,
    depth: u32,
    /// The run's first node slot.
    base: u32,
}

/// Working space for [`build_morton`].
#[derive(Clone, Debug, Default)]
pub struct MortonScratch {
    tasks: Vec<Task>,
}

impl MortonScratch {
    /// Makes room for builds over up to `primitives` primitives. Room only grows.
    pub fn try_reserve(&mut self, primitives: u32) -> Result<(), TryReserveError> {
        // Each task holds more than one primitive.
        let tasks = (primitives as usize).div_ceil(2);
        if self.tasks.capacity() < tasks {
            self.tasks.try_reserve_exact(tasks - self.tasks.len())?;
        }
        Ok(())
    }
}

/// The node slots that [`build_morton`] needs for `primitives` primitives in `groups` groups.
pub const fn node_room(primitives: u32, groups: u32) -> usize {
    primitives as usize + groups as usize
}

/// The input of a Morton build.
#[derive(Clone, Copy, Debug)]
pub struct MortonInput<'a> {
    /// Each primitive's box.
    pub boxes: &'a [Aabb],
    /// The primitives in curve order, as indices into `boxes`: each group's run sorted on its
    /// own.
    pub order: &'a [u32],
    /// The Morton code of each entry of `order`.
    pub codes: &'a [u32],
    /// The most primitives per leaf.
    pub max_leaf: u32,
}

/// Builds one subtree per run of `groups`, each over a run of `input.order`, into `nodes`, and
/// writes each group's root node to `roots`. Returns how many node slots the trees use, from the
/// first: `nodes` holds the trees there, and slots that no node uses hold empty nodes.
///
/// # Errors
/// When `nodes` cannot grow to [`node_room`].
///
/// # Panics
/// When a run is empty or past the order array, `roots` is shorter than `groups`, the codes are
/// shorter than the order, or `max_leaf` is 0 or over [`child::MAX_LEAF_COUNT`].
pub fn build_morton(
    jobs: &JobSystem,
    input: MortonInput<'_>,
    groups: &[Range<u32>],
    roots: &mut [u32],
    nodes: &mut Vec<Node>,
    scratch: &mut MortonScratch,
) -> Result<u32, TryReserveError> {
    let max_leaf = input.max_leaf;
    assert!((1..=child::MAX_LEAF_COUNT).contains(&max_leaf));
    assert!(input.codes.len() >= input.order.len() && roots.len() >= groups.len());
    let room = node_room(input.order.len() as u32, groups.len() as u32);
    grow(nodes, room, Node::EMPTY)?;
    scratch.try_reserve(input.order.len() as u32)?;
    scratch.tasks.clear();

    // One thread splits the large runs; `next` counts the nodes it makes.
    let mut next = 0u32;
    let mut stack: Stack<(u32, u32, u32, u32)> = Stack::new();
    for (g, run) in groups.iter().enumerate() {
        assert!(!run.is_empty() && run.end as usize <= input.order.len());
        roots[g] = next;
        stack.push((next, run.start, run.end, 0));
        next += 1;
        while let Some((node, start, end, depth)) = stack.pop() {
            let mut n = Node::EMPTY;
            for (slot, part) in split_node(input.codes, start..end, depth, max_leaf)
                .into_iter()
                .flatten()
                .enumerate()
            {
                let len = part.end - part.start;
                if len <= max_leaf {
                    n.set_child(slot, child::leaf(part.start, len), &leaf_box(&input, &part));
                } else if len > GRAIN {
                    n.children[slot] = next;
                    stack.push((next, part.start, part.end, depth + 1));
                    next += 1;
                } else {
                    scratch.tasks.push(Task {
                        parent: node,
                        slot: slot as u32,
                        start: part.start,
                        end: part.end,
                        depth: depth + 1,
                        base: 0,
                    });
                }
            }
            nodes[node as usize] = n;
        }
    }
    let upper = next;
    // Each task's slots follow the upper nodes, in task order.
    for task in &mut scratch.tasks {
        task.base = next;
        next += task.end - task.start - 1;
        nodes[task.parent as usize].children[task.slot as usize] = task.base;
    }
    debug_assert!(next as usize <= room);

    let shared = SharedMut::new(&mut nodes[..]);
    let tasks = &scratch.tasks;
    jobs.parallel_for(tasks.len() as u32, 1, &|range, _| {
        for task in &tasks[range.start as usize..range.end as usize] {
            // SAFETY: each task writes only its own slots, `base..base + len - 1`, and reads only
            // nodes it wrote.
            unsafe { build_task(&input, task, shared) };
        }
    });

    // The upper nodes' boxes of child nodes, from the last upper node to the first: every child
    // comes after its parent, and the tasks' nodes are done.
    for i in (0..upper as usize).rev() {
        fill_child_boxes(nodes, i);
    }
    Ok(next)
}

/// Sets the box of each child node of node `i` to the box around that node's children.
#[inline(always)]
fn fill_child_boxes(nodes: &mut [Node], i: usize) {
    for slot in 0..4 {
        let w = nodes[i].children[slot];
        if child::is_node(w) {
            let b = nodes[w as usize].bounds();
            nodes[i].set_box(slot, &b);
        }
    }
}

/// Builds a task's subtree in its own slots, then fills its boxes from the last slot back.
///
/// # Safety
/// No other thread touches the task's slots while it runs.
unsafe fn build_task(input: &MortonInput<'_>, task: &Task, nodes: SharedMut<Node>) {
    let len = (task.end - task.start) as usize;
    // SAFETY: the slots are the task's own (see the caller).
    let mine = unsafe { nodes.slice(task.base as usize, len - 1) };
    let mut next = 1usize;
    let mut stack: Stack<(u32, u32, u32, u32)> = Stack::new();
    stack.push((0, task.start, task.end, task.depth));
    while let Some((node, start, end, depth)) = stack.pop() {
        let mut n = Node::EMPTY;
        for (slot, part) in split_node(input.codes, start..end, depth, input.max_leaf)
            .into_iter()
            .flatten()
            .enumerate()
        {
            let count = part.end - part.start;
            if count <= input.max_leaf {
                n.set_child(
                    slot,
                    child::leaf(part.start, count),
                    &leaf_box(input, &part),
                );
            } else {
                n.children[slot] = task.base + next as u32;
                stack.push((next as u32, part.start, part.end, depth + 1));
                next += 1;
            }
        }
        mine[node as usize] = n;
    }
    // Local indices: a child node's absolute index less the base.
    for i in (0..next).rev() {
        for slot in 0..4 {
            let w = mine[i].children[slot];
            if child::is_node(w) {
                let b = mine[(w - task.base) as usize].bounds();
                mine[i].set_box(slot, &b);
            }
        }
    }
    mine[next..].fill(Node::EMPTY);
}

/// The box around a leaf's primitives.
#[inline(always)]
fn leaf_box(input: &MortonInput<'_>, part: &Range<u32>) -> Aabb {
    let mut b = Aabb::EMPTY;
    for &id in &input.order[part.start as usize..part.end as usize] {
        b.grow(&input.boxes[id as usize]);
    }
    b
}

/// Splits a node's run into up to four parts: the part with the most primitives splits until
/// there are four or none holds more than `max_leaf`.
#[inline(always)]
fn split_node(
    codes: &[u32],
    run: Range<u32>,
    depth: u32,
    max_leaf: u32,
) -> [Option<Range<u32>>; 4] {
    let mut parts: [Option<Range<u32>>; 4] = [Some(run), None, None, None];
    for n in 1..4 {
        let pick = (0..n)
            .filter_map(|i| parts[i].clone().map(|p| (i, p.end - p.start)))
            .filter(|&(_, len)| len > max_leaf)
            // On a tie the first part wins.
            .max_by(|a, b| a.1.cmp(&b.1).then(b.0.cmp(&a.0)));
        let Some((i, _)) = pick else { break };
        let p = parts[i].clone().unwrap_or_default();
        let mid = split_point(codes, &p, depth >= COST_DEPTH);
        parts[i] = Some(p.start..mid);
        parts[n] = Some(mid..p.end);
    }
    parts
}

/// Where a run of at least two primitives splits: at the first code whose highest differing bit
/// is set, or in the middle when the codes are equal or the build splits by count.
#[inline(always)]
fn split_point(codes: &[u32], run: &Range<u32>, by_count: bool) -> u32 {
    let (first, last) = (codes[run.start as usize], codes[run.end as usize - 1]);
    if by_count || first == last {
        return run.start + (run.end - run.start) / 2;
    }
    let bit = 31 - (first ^ last).leading_zeros();
    let codes = &codes[run.start as usize..run.end as usize];
    run.start + codes.partition_point(|&c| (c >> bit) & 1 == 0) as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runs_split_at_the_highest_differing_bit() {
        let codes = [0b0001, 0b0011, 0b0100, 0b0110, 0b0111];
        assert_eq!(split_point(&codes, &(0..5), false), 2);
        assert_eq!(split_point(&codes, &(2..5), false), 3);
        assert_eq!(split_point(&[5, 5, 5, 5], &(0..4), false), 2);
        assert_eq!(split_point(&codes, &(0..5), true), 2);
    }
}
