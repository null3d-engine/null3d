//! Today's mesh placement beside the offset allocator, on one workload of models that load and
//! leave again.
//!
//! Today's placement appends a mesh's vertices and indices to the end of its page. A mesh that
//! leaves leaves a hole, and the storage closes the hole by moving every mesh after it down, which
//! the GPU uploads again. The offset allocator places a mesh in a hole at once and moves nothing,
//! but it holds the page's peak size, because it has no way to give the buffer's end back.
//!
//! The workload is the same for both: rounds of a live set of models, where each round removes the
//! same share and adds the same number of new models. Sizes come from a fixed sequence, so both
//! placements meet the same requests in the same order.
//!
//! Run the timed test with:
//!
//! ```text
//! cargo test -p null3d-render --release --test offset_placement -- --ignored --nocapture
//! ```
#![allow(clippy::disallowed_methods)] // The timed test reads the clock.

use std::time::{Duration, Instant};

use null3d_render::geometry::Geometry;
use null3d_render::meshes::{MeshMoves, MeshStorage, Packing};
use null3d_render::offset_alloc::{OffsetAllocation, OffsetAllocator};

/// Rounds of the workload.
const ROUNDS: usize = 12;
/// The live models that the workload starts with.
const MODELS: usize = 48;
/// The share of the live models that leaves each round, in percent.
const LEAVES: usize = 30;
/// Vertices of the smallest and the largest model.
const SMALLEST: u32 = 600;
const LARGEST: u32 = 24_000;
/// Bytes of the base vertex format: a position and a normal, each three floats.
const STRIDE: u32 = 24;
/// The index pool's unit: the engine writes whole 4-byte words.
const INDEX_UNIT: u32 = 4;

/// A step of the workload.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Step {
    /// A model of that many vertices arrives.
    Arrive(u32),
    /// The model with that many vertices leaves.
    Leave(u32),
}

/// The rounds of the workload: the first one holds the starting models, each later one the models
/// that leave and the ones that take their place.
fn workload() -> Vec<Vec<Step>> {
    let mut rounds = Vec::with_capacity(ROUNDS + 1);
    let mut next = 0;
    let mut live: Vec<u32> = (0..MODELS).map(|_| size_at(next)).collect();
    next += MODELS;
    rounds.push(live.iter().copied().map(Step::Arrive).collect());
    for _ in 0..ROUNDS {
        let leaving = (live.len() * LEAVES / 100).max(1);
        // The oldest models leave, in order, as a streaming level does.
        let gone: Vec<u32> = live.drain(..leaving).collect();
        let arrived: Vec<u32> = (0..leaving).map(|_| size_at(next)).collect();
        next += leaving;
        live.extend_from_slice(&arrived);
        rounds.push(
            gone.into_iter()
                .map(Step::Leave)
                .chain(arrived.into_iter().map(Step::Arrive))
                .collect(),
        );
    }
    rounds
}

/// The vertices of the model that a workload step asks for, from a fixed sequence.
fn size_at(k: usize) -> u32 {
    let spread = LARGEST - SMALLEST;
    let size = SMALLEST + (k as u32).wrapping_mul(2_654_435_761) % (spread + 1);
    // One triangle for each three vertices.
    size - size % 3
}

/// A model of `vertices` vertices and one triangle for each three of them.
fn model(vertices: u32) -> Geometry {
    let vertices = vertices.max(6);
    let floats: Vec<f32> = (0..vertices * 6).map(|k| (k % 17) as f32 * 0.125).collect();
    let indices = (0..vertices).collect();
    Geometry::from_floats(0, &floats, indices)
}

/// The index units that one model asks for.
fn index_units(vertices: u32) -> u32 {
    (vertices * 2).div_ceil(INDEX_UNIT)
}

/// What one placement costs over the workload.
#[derive(Debug, Default)]
struct Cost {
    /// The bytes that the placement moved after a model left.
    copied: u64,
    /// The bytes that the buffers hold at any time: the live models' bytes for today's placement,
    /// and the provisioned buffers for the allocator.
    held: u64,
    /// The buffers' peak bytes over the workload.
    peak: u64,
    /// The time that the workload's placements and removals took.
    time: Duration,
    /// The free bytes of the allocator's buffers at the end, and the largest free range.
    free: u64,
    largest_free: u64,
}

/// The most vertex bytes, then index bytes, that the workload holds at one time. An allocator has
/// to hold this much up front.
fn peak_bytes(rounds: &[Vec<Step>]) -> (u64, u64) {
    let mut live: Vec<u32> = Vec::new();
    let (mut vertex_peak, mut index_peak) = (0u64, 0u64);
    for steps in rounds {
        for step in steps {
            match step {
                Step::Arrive(vertices) => live.push(*vertices),
                Step::Leave(vertices) => {
                    let at = live.iter().position(|v| v == vertices).unwrap();
                    live.remove(at);
                }
            }
        }
        let vertices: u64 = live.iter().map(|v| u64::from(*v) * u64::from(STRIDE)).sum();
        let indices: u64 = live.iter().map(|v| u64::from(index_units(*v)) * 4).sum();
        vertex_peak = vertex_peak.max(vertices);
        index_peak = index_peak.max(indices);
    }
    (vertex_peak, index_peak)
}

/// The bytes that a page holds, for the moves that a removal reports.
fn page_bytes(storage: &MeshStorage) -> Vec<(u64, u64)> {
    storage
        .pages()
        .iter()
        .map(|page| (page.vertices.len() as u64, (page.indices.len() * 2) as u64))
        .collect()
}

fn held_bytes(storage: &MeshStorage) -> u64 {
    storage
        .pages()
        .iter()
        .map(|page| page.vertices.len() as u64 + (page.indices.len() * 2) as u64)
        .sum()
}

/// The bytes that a removal moved: from each page's first changed byte to the page's end.
fn moved_bytes(before: &[(u64, u64)], after: &[(u64, u64)], moves: &MeshMoves) -> u64 {
    let mut moved = 0;
    for &(page, vertex_byte, index_byte) in &moves.pages {
        let (vertices_before, indices_before) = before[page as usize];
        let (vertices_after, indices_after) = after[page as usize];
        moved += vertices_before
            .saturating_sub(vertex_byte as u64)
            .min(vertices_after);
        moved += indices_before
            .saturating_sub(index_byte as u64)
            .min(indices_after);
    }
    moved
}

/// Runs the workload through today's storage: append to a page, and close a hole by copying.
fn today(rounds: &[Vec<Step>]) -> Cost {
    let mut cost = Cost::default();
    let mut storage = MeshStorage::new(Packing::SharedBuffers);
    let mut live: Vec<(u32, u32)> = Vec::new(); // vertices and mesh id
    for steps in rounds {
        for step in steps {
            match step {
                Step::Arrive(vertices) => {
                    let start = Instant::now();
                    let id = storage.add(&model(*vertices)).unwrap();
                    cost.time += start.elapsed();
                    live.push((*vertices, id));
                }
                Step::Leave(vertices) => {
                    let at = live.iter().position(|(v, _)| v == vertices).unwrap();
                    let (_, id) = live.remove(at);
                    let before = page_bytes(&storage);
                    let start = Instant::now();
                    let moves = storage.remove(&[id]);
                    cost.time += start.elapsed();
                    let after = page_bytes(&storage);
                    cost.copied += moved_bytes(&before, &after, &moves);
                    storage.release(&[id]);
                }
            }
        }
        cost.held = held_bytes(&storage);
        cost.peak = cost.peak.max(cost.held);
    }
    cost
}

/// Runs the workload through the offset allocator: place in a hole, and free without a copy.
/// Returns `None` when a request does not fit the buffers that `vertex_units` and `index_units`
/// give.
fn allocator(rounds: &[Vec<Step>], vertex_units: u32, index_units_capacity: u32) -> Option<Cost> {
    let mut cost = Cost::default();
    let nodes = (MODELS * 6) as u32;
    let mut vertices = OffsetAllocator::new(vertex_units, STRIDE, nodes).unwrap();
    let mut indices = OffsetAllocator::new(index_units_capacity, INDEX_UNIT, nodes).unwrap();
    let mut live: Vec<(u32, OffsetAllocation, OffsetAllocation)> = Vec::new();
    for steps in rounds {
        for step in steps {
            match step {
                Step::Arrive(vertices_count) => {
                    let start = Instant::now();
                    let vertex_range = vertices.alloc(*vertices_count).ok()?;
                    let index_range = indices.alloc(index_units(*vertices_count)).ok()?;
                    cost.time += start.elapsed();
                    live.push((*vertices_count, vertex_range, index_range));
                }
                Step::Leave(vertices_count) => {
                    let at = live
                        .iter()
                        .position(|(v, _, _)| v == vertices_count)
                        .unwrap();
                    let (_, vertex_range, index_range) = live.remove(at);
                    let start = Instant::now();
                    vertices.free(vertex_range);
                    indices.free(index_range);
                    cost.time += start.elapsed();
                }
            }
        }
    }
    let report = vertices.report();
    let index_report = indices.report();
    cost.held = report.capacity + index_report.capacity;
    cost.peak = cost.held;
    cost.copied = 0;
    cost.free = report.free + index_report.free;
    cost.largest_free = report.largest_free.max(index_report.largest_free);
    Some(cost)
}

/// The least buffer that each pool needs for the workload: the smallest size that places every
/// request. An allocator holds its buffer's whole size from the start.
fn least_capacity(rounds: &[Vec<Step>], vertex_peak: u64, index_peak: u64) -> (u32, u32) {
    let fit = |vertex_units: u32, index_capacity: u32| {
        allocator(rounds, vertex_units, index_capacity).is_some()
    };
    let necessary = |low: u32, high: u32, fits: &dyn Fn(u32) -> bool| {
        let (mut low, mut high) = (low, high);
        while low < high {
            let middle = low + (high - low) / 2;
            if fits(middle) {
                high = middle;
            } else {
                low = middle + 1;
            }
        }
        low
    };
    let vertex_ceiling = (vertex_peak / u64::from(STRIDE)) as u32 + 1;
    let index_ceiling = (index_peak / u64::from(INDEX_UNIT)) as u32 + 1;
    let vertex = necessary(1, vertex_ceiling * 2, &|units| {
        fit(units, index_ceiling * 4)
    });
    let index = necessary(1, index_ceiling * 2, &|units| fit(vertex, units));
    (vertex, index)
}

/// Both placements hold the same ranges, and only today's moves bytes.
#[test]
fn today_copies_and_the_allocator_does_not() {
    let rounds = workload();
    let (vertex_peak, index_peak) = peak_bytes(&rounds);
    let today = today(&rounds);
    let (vertex_units, index_units_capacity) = least_capacity(&rounds, vertex_peak, index_peak);
    let allocated = allocator(&rounds, vertex_units, index_units_capacity).unwrap();
    println!("today: {today:?}");
    println!("allocator: {allocated:?}");
    assert!(today.copied > 0, "today's placement moves bytes");
    assert_eq!(allocated.copied, 0, "the allocator moves none");
    // The allocator holds its peak, which the workload reached, and today's placement holds what
    // is live at the end, which is less.
    assert!(allocated.held >= today.peak, "the allocator holds the peak");
    assert!(
        allocated.held <= today.peak + today.peak / 10,
        "and under a tenth more, for the classes' waste"
    );
    assert!(today.held < allocated.held, "today's page shrinks again");
    let _ = (vertex_peak, index_peak);
}

/// The time that the placements take over the workload, which a removal frame pays.
#[test]
#[ignore = "times the placements; run with --release --ignored --nocapture"]
fn placement_time_on_a_model_churn() {
    const TRIALS: usize = 5;
    let rounds = workload();
    let (vertex_peak, index_peak) = peak_bytes(&rounds);
    let (vertex_units, index_units_capacity) = least_capacity(&rounds, vertex_peak, index_peak);
    for trial in 1..=TRIALS {
        let today = today(&rounds);
        let allocated = allocator(&rounds, vertex_units, index_units_capacity).unwrap();
        println!(
            "trial {trial}: today {:?}, allocator {:?}; copied {} bytes ({:.1} MiB); \
             held {} vs {} bytes; free {} bytes, largest {}",
            today.time,
            allocated.time,
            today.copied,
            today.copied as f64 / (1024.0 * 1024.0),
            today.held,
            allocated.held,
            allocated.free,
            allocated.largest_free
        );
    }
}
