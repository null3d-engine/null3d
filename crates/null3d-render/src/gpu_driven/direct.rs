//! The direct-draw path: the job workers cull the sources and buckets that the GPU culls on the
//! default path, and each bucket draws with `drawIndexed` and a count that the CPU knows. WebKit's
//! indirect validation makes every indexed indirect draw whose pipeline has vertex buffers
//! expensive on Apple GPUs (decision record D-174), so a device that a start-up probe measured to
//! be faster this way draws its buckets directly.
//!
//! Culling is [`null3d_core::culling::cull_into_buckets`], the CPU culling that the WebGL2 builder
//! uses. Each view's sources land in its layout's buckets; each bucket's visible sources are
//! copied into the view's compacted instance buffer in the layout that the mesh shaders read, and
//! each bucket draws its slice with its instance count as the draw's count. World matrices come
//! from the core's world buffers, moved by each source's cell offset as the culling shader moves
//! them, so the vertex shaders draw positions relative to the view's camera as they always do.
//!
//! The buffers are the culling path's: the view's compacted instance buffer is the one that the
//! indirect path has the culling shader fill. Only its contents change, so the pipelines, the
//! layouts, the bind groups and the mesh shaders are the same on both paths.

use std::collections::TryReserveError;

use null3d_core::cells::{CELL_SHIFT, ORIGIN_CELL};
use null3d_core::culling::{
    BY_ROW, BucketedCull, CullRun, CullSet, CullView, LevelChoice, LevelRows, NO_BUCKET, RowBiases,
    RowCells, RowRadii, RowRanges, SetLayers, SetOrder, batch_ranges, cull_into_buckets,
};
use null3d_core::handle::Handle;
use null3d_core::instances::BatchTable;
use null3d_core::jobs::JobSystem;
use null3d_core::levels::LevelRule;
use null3d_core::scene::SceneStorage;
use null3d_gpu::drawlist::{DrawList, Op, sizes};

use super::layout::Layout;
use crate::cells::{CellCulling, CellMask, MOVING};
use crate::frame::{CellOffsets, RecordError, RunCells, UploadArena, push_runs, words_as_bytes};
use crate::view::{ViewFrame, ViewId};

/// The set that lists the scene's slots in place, without grid cells.
const SCENE_SET: u32 = 0;
/// The set that lists the still sources in cell order, and the one that lists the moving sources.
const STILL_SET: u32 = 1;
const MOVING_SET: u32 = 2;
/// The first set that lists a batch's rows.
const FIRST_BATCH_SET: u32 = 3;
/// The bits of a culling entry that hold its source; the cell index lies above them.
const ENTRY_SOURCE: u32 = (1 << CELL_SHIFT) - 1;
/// The words of one copied instance: three matrix rows, then its ids.
const COPY_WORDS: usize = (sizes::INSTANCE_STRIDE / 4) as usize;
/// The words of a copy's ids: its material, its first joint, its source and its fade value.
const IDS_MATERIAL: usize = 12;
const IDS_JOINT: usize = 13;
const IDS_SOURCE: usize = 14;
const IDS_FADE: usize = 15;
/// Floats of one world matrix: three rows of four.
const MATRIX_FLOATS: usize = 12;

/// One view's culling output, its buckets' instance counts and the bytes to upload.
#[derive(Default)]
struct ViewCull {
    cull: BucketedCull,
    /// Each bucket's instance count, in the layout's bucket order.
    counts: Vec<u32>,
}

/// Every view's culling output on the direct-draw path.
#[derive(Default)]
pub(super) struct Direct {
    views: Vec<ViewCull>,
    /// The runs of the view being culled.
    runs: Vec<CullRun>,
    /// The offsets from the frame's view to each cell in use.
    offsets: CellOffsets,
    /// The copies of one bucket, as the frame uploads them. One bucket is written at a time, so the
    /// room that the copies need is the largest bucket's, not the whole layout's.
    bucket_copies: Vec<u32>,
}

impl Direct {
    /// Culls `drawn` for `view` on the CPU, uploads the visible instances into the view's
    /// compacted instance buffer, and keeps each bucket's count for the draws. `sources` is the
    /// scene's layout, whose world matrices, layer table and skin firsts every view reads.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn record(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        jobs: &JobSystem,
        view: ViewId,
        frame: &ViewFrame,
        scene: &SceneStorage,
        batches: &BatchTable,
        cells: &CellCulling,
        sources: &Layout,
        drawn: &Layout,
        rule: LevelRule,
        parity: usize,
    ) -> Result<(), RecordError> {
        self.offsets.update(scene, &frame.camera);
        let offsets = self.offsets.as_slice();
        let visible = if cells.active() {
            cells.visible(&frame.frustum, offsets)
        } else {
            CellMask::ALL
        };
        self.runs.clear();
        push_view_runs(
            &mut self.runs,
            scene,
            batches,
            drawn,
            cells,
            &visible,
            parity,
        )
        .map_err(out_of_memory)?;
        let runs = &self.runs;
        let buckets = drawn.buckets.len() as u32;
        if self.views.len() <= view.index() {
            self.views.resize_with(view.index() + 1, ViewCull::default);
        }
        if self.views[view.index()].counts.len() < buckets as usize {
            self.views[view.index()].counts.resize(buckets as usize, 0);
        }
        let scene_layers = scene
            .common_layers()
            .map_or(SetLayers::Rows(sources.layers()), SetLayers::All);
        let scene_order = cells.scene_order().sources();
        let sets = |set: u32| -> CullSet<'_> {
            if set >= FIRST_BATCH_SET {
                let batch = batches
                    .get(Handle::from_raw(
                        drawn.batch_id((set - FIRST_BATCH_SET) as usize),
                    ))
                    .expect("the layout names live batches");
                return CullSet {
                    spheres: batch.world(parity).spheres(),
                    cells: batch.cells(),
                    order: SetOrder::Rows,
                    layers: SetLayers::All(batch.layers()),
                };
            }
            let world = scene.world(parity).spheres();
            let (spheres, order) = match set {
                STILL_SET => (cells.still_spheres(), SetOrder::Copied(scene_order)),
                MOVING_SET => (world, SetOrder::Gathered(scene_order)),
                _ => (world, SetOrder::Rows),
            };
            CullSet {
                spheres,
                cells: scene.cells(),
                order,
                layers: scene_layers,
            }
        };
        let level_rows = |set: u32| -> LevelRows<'_> {
            if set < FIRST_BATCH_SET {
                return LevelRows {
                    spheres: scene.world(parity).spheres(),
                    cells: RowCells::Rows(scene.cells()),
                    radii: RowRadii::Rows(scene.local_radii()),
                    biases: RowBiases::Rows(scene.level_biases()),
                    ranges: RowRanges::Rows(scene.draw_ranges()),
                };
            }
            let batch = batches
                .get(Handle::from_raw(
                    drawn.batch_id((set - FIRST_BATCH_SET) as usize),
                ))
                .expect("the layout names live batches");
            LevelRows {
                spheres: batch.world(parity).spheres(),
                cells: batch
                    .common_cell()
                    .map_or(RowCells::Rows(batch.cells()), RowCells::One),
                radii: RowRadii::One(batch.local_radius()),
                biases: RowBiases::One(1.0),
                ranges: batch_ranges(batches, batch),
            }
        };
        let choice = LevelChoice {
            rule,
            links: drawn.level_links(),
            rows: &level_rows,
            codes: drawn.codes,
            levels: drawn.bucket_levels(),
        };
        let by_row = runs
            .iter()
            .filter(|run| choice.run_looks_up(run.bucket, run.set))
            .count();
        let entry = &mut self.views[view.index()];
        entry
            .cull
            .try_reserve(drawn.cull_rows(), runs.len() as u32, by_row as u32, buckets)
            .map_err(out_of_memory)?;
        let cull_view = CullView {
            frustum: &frame.frustum,
            offsets,
            layers: frame.layers,
            occlusion: None,
        };
        let ViewCull { cull, counts } = entry;
        let mut copies = std::mem::take(&mut self.bucket_copies);
        cull_into_buckets(
            jobs,
            cull_view,
            &sets,
            runs,
            drawn.cull_buckets(),
            buckets,
            Some(&choice),
            cull,
        );
        let recorded = write_copies(
            list,
            arena,
            view,
            drawn,
            cull,
            counts,
            &mut copies,
            scene.world(parity).matrices(),
            batches,
            sources,
            parity,
            offsets,
        );
        self.bucket_copies = copies;
        recorded
    }

    /// The offsets from the camera of the view culled last to each cell in use.
    pub(super) fn offsets(&self) -> &CellOffsets {
        &self.offsets
    }

    /// The instance count of each bucket of `view` in the frame just culled, or an empty slice
    /// before the view culls.
    pub(super) fn counts(&self, view: ViewId) -> &[u32] {
        self.views
            .get(view.index())
            .map_or(&[], |view| &view.counts[..])
    }
}

/// Writes each bucket's visible sources into the view's compacted instance buffer in the layout
/// that the mesh shaders read, with its matrix moved by its cell's offset from the view's camera.
/// Each bucket's copies go up in one write of their own, so the frame holds the visible copies
/// instead of a copy of every row that the layout could draw.
#[allow(clippy::too_many_arguments)]
fn write_copies(
    list: &mut DrawList,
    arena: &mut UploadArena,
    view: ViewId,
    drawn: &Layout,
    cull: &BucketedCull,
    counts: &mut [u32],
    copies: &mut Vec<u32>,
    scene_matrices: &[f32],
    batches: &BatchTable,
    sources: &Layout,
    parity: usize,
    offsets: &[[f32; 4]],
) -> Result<(), RecordError> {
    let starts = cull.bucket_starts();
    let entries = cull.indices();
    for (index, bucket) in drawn.buckets.iter().enumerate() {
        let words = &entries[starts[index] as usize..starts[index + 1] as usize];
        // A fade bucket lists each instance as a pair: its entry, then its fade value's bits.
        let pair = bucket.pairs;
        let count = if pair { words.len() / 2 } else { words.len() };
        counts[index] = count as u32;
        if count == 0 {
            continue;
        }
        let needed = count * COPY_WORDS;
        if copies.len() < needed {
            copies
                .try_reserve(needed - copies.len())
                .map_err(out_of_memory)?;
            copies.resize(needed, 0);
        }
        for k in 0..count {
            let entry = words[k * if pair { 2 } else { 1 }];
            let source = entry & ENTRY_SOURCE;
            let cell = (entry >> CELL_SHIFT) as usize;
            let offset = offsets.get(cell).copied().unwrap_or([0.0; 4]);
            let matrix = matrix_of(source, scene_matrices, batches, sources, parity);
            let dst = k * COPY_WORDS;
            copies[dst] = matrix[0].to_bits();
            copies[dst + 1] = matrix[1].to_bits();
            copies[dst + 2] = matrix[2].to_bits();
            copies[dst + 3] = (matrix[3] + offset[0]).to_bits();
            copies[dst + 4] = matrix[4].to_bits();
            copies[dst + 5] = matrix[5].to_bits();
            copies[dst + 6] = matrix[6].to_bits();
            copies[dst + 7] = (matrix[7] + offset[1]).to_bits();
            copies[dst + 8] = matrix[8].to_bits();
            copies[dst + 9] = matrix[9].to_bits();
            copies[dst + 10] = matrix[10].to_bits();
            copies[dst + 11] = (matrix[11] + offset[2]).to_bits();
            copies[dst + IDS_MATERIAL] = bucket.material - 1;
            copies[dst + IDS_JOINT] = first_joint(bucket, source, sources);
            copies[dst + IDS_SOURCE] = source;
            copies[dst + IDS_FADE] = if pair { words[k * 2 + 1] } else { 0 };
        }
        let (at, bytes) = arena.push(words_as_bytes(&copies[..needed]))?;
        let offset = bucket.base * drawn.copy_stride();
        list.push(
            Op::WriteBuffer,
            &[super::ids::visible(view), offset, at, bytes],
        )?;
    }
    Ok(())
}

/// The twelve floats of a source's world matrix: a scene slot's from the scene's world buffer, or
/// a batch row's from its batch's.
fn matrix_of<'a>(
    source: u32,
    scene_matrices: &'a [f32],
    batches: &'a BatchTable,
    sources: &Layout,
    parity: usize,
) -> &'a [f32] {
    if source < sources.scene_rows {
        let at = source as usize * MATRIX_FLOATS;
        return &scene_matrices[at..at + MATRIX_FLOATS];
    }
    let bases = sources.batch_bases();
    // The last batch whose first source is at or below this one.
    let k = bases
        .partition_point(|&(_, base)| base <= source)
        .saturating_sub(1);
    let (id, base) = bases[k];
    let batch = batches
        .get(Handle::from_raw(id))
        .expect("the layout names live batches");
    let at = (source - base) as usize * MATRIX_FLOATS;
    &batch.world(parity).matrices()[at..at + MATRIX_FLOATS]
}

/// The first joint of a source's skin: the bucket's shared one, or the source's own where the
/// vertex shaders skin each object.
fn first_joint(bucket: &super::layout::Bucket, source: u32, sources: &Layout) -> u32 {
    if bucket.skins {
        sources
            .skin_firsts()
            .get(source as usize)
            .copied()
            .unwrap_or(0)
    } else {
        bucket.first_joint
    }
}

/// The runs of a view's culling: the scene's slots, or the cells in view, then each batch's rows.
fn push_view_runs(
    runs: &mut Vec<CullRun>,
    scene: &SceneStorage,
    batches: &BatchTable,
    drawn: &Layout,
    cells: &CellCulling,
    visible: &CellMask,
    parity: usize,
) -> Result<(), TryReserveError> {
    if cells.active() {
        let order = cells.scene_order();
        for cell in visible.iter() {
            push_runs(
                runs,
                STILL_SET,
                order.run(cell),
                BY_ROW,
                0,
                RunCells::One(cell),
            )?;
        }
        let moving = RunCells::Listed {
            rows: order.sources(),
            cells: scene.cells(),
        };
        push_runs(runs, MOVING_SET, order.run(MOVING), BY_ROW, 0, moving)?;
    } else {
        // Slots past the highest one ever used hold no object.
        let scene_cells = if scene.cell_table().origin_only() {
            RunCells::One(ORIGIN_CELL)
        } else {
            RunCells::Rows(scene.cells())
        };
        push_runs(
            runs,
            SCENE_SET,
            0..scene.slots().high_water(),
            BY_ROW,
            0,
            scene_cells,
        )?;
    }
    for k in 0..drawn.batch_count() {
        let bucket = drawn.batch_bucket(k);
        if bucket == NO_BUCKET {
            continue;
        }
        let batch = batches
            .get(Handle::from_raw(drawn.batch_id(k)))
            .expect("the layout names live batches");
        let cells = batch
            .common_cell()
            .map_or(RunCells::Rows(batch.cells()), RunCells::One);
        let set = FIRST_BATCH_SET + k as u32;
        let rows = 0..batch.frame_active_count(parity);
        push_runs(runs, set, rows, bucket, drawn.batch_base(k), cells)?;
    }
    Ok(())
}

/// A growth that failed: the culling output asked for more memory than the engine has.
fn out_of_memory(_: TryReserveError) -> RecordError {
    RecordError::OutOfMemory { bytes: u32::MAX }
}
