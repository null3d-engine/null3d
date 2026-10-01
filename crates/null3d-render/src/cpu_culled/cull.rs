//! Culling on the job workers, view by view. WebGL2 has no compute shaders, so the job workers
//! test every object and instance against each view's frustum, and list the visible ones, bucket
//! by bucket, in the view's index list: one 32-bit index per visible source, where full matrices
//! would take 48 bytes. Each view's list goes into the next of three textures of its own, and a
//! frame whose list equals the previous frame's draws from the texture that already holds it.
//!
//! A static batch at rest is culled in clusters of nearby rows (see [`null3d_core::clusters`]),
//! one sphere per cluster, and its index list entries name clusters instead of rows. A static
//! batch that changed in the frame is culled row by row. The next frame's update copies the change
//! into the other world buffer, so both buffers hold the same rows: that frame builds the batch's
//! clusters again, and the cluster texture gets their order. Every view culls the same runs of
//! rows and clusters.
//!
//! Each view lists only the sources on its layers (see [`null3d_core::layers`]): the job workers
//! test each scene object's mask, and a batch's one mask for all its rows and clusters. A mask
//! change needs no rebuild, as the next frame culls with the new mask.
//!
//! Each index list entry holds its row, or its cluster, with the row's cell index above it (see
//! [`null3d_core::cells`]). The job workers cull each run of rows in one cell against the view's
//! frustum moved into that cell, and add each row's offset from the view's camera to its sphere
//! where a run's rows lie in different cells.
//!
//! # Grid cells
//!
//! When the scene's sources lie in more than one grid cell, each view first finds the cells whose
//! still sources it can see (see [`crate::cells`]), and culls only those cells' still sources.
//! Still scene objects are reached through the scene's cell order, from copies of their spheres in
//! that order, so each cell's are one run. Moving scene objects follow, reached through the same
//! order, each with its own cell. A static batch at rest builds its clusters inside cells, so each
//! cell's clusters are one run too; a static batch that changes, or whose rows lie in more cells
//! than its room for clusters allows, is culled row by row, with no cell skipped. Without cells in
//! use, clusters form only in a batch whose rows share one cell, and every source is culled.
//!
//! Each frame parity keeps its own culling output, because the render worker replays a frame's
//! list while the next frame culls, and the list uploads the index list straight from that output.
//!
//! Each camera view then sorts the rows whose material blends (see [`crate::sorted`]). Their
//! entries follow the opaque entries in the view's index list, farthest first, and the transparent
//! pass draws them in that order. They are kept per frame parity too.
//!
//! One [`Culling`] culls the views of cameras against the scene's layout, and another culls the
//! shadow cascades against the casters' layout (see [`super::layout::Drawn`]), with no sort. Each
//! keeps its own runs, since the layouts put different sources in buckets.

use std::collections::TryReserveError;

use null3d_core::cells::ORIGIN_CELL;
use null3d_core::clusters::RowCells;
use null3d_core::culling::{
    BY_ROW, BucketedCull, CullRun, CullSet, CullView, NO_BUCKET, SetLayers, SetOrder,
};
use null3d_gpu::drawlist::DrawList;

use super::data::{DataTexture, RING, RingSlot, TextureRows, write_rows};
use super::ids;
use super::layout::{Clusters, CullRoom, Layout};
use crate::cells::{CellCulling, CellMask, MOVING};
use crate::frame::{
    CellOffsets, FrameInput, RecordError, RunCells, address, push_runs, words_as_bytes,
};
use crate::sorted::{SortedLayout, SortedView};
use crate::view::{ViewFrame, ViewId};

/// The culling sets: the scene's slots in place, the still scene objects through the scene's cell
/// order, the moving scene objects through it, then each batch's rows, then each batch's
/// clusters.
const SCENE_SET: u32 = 0;
const STILL_SET: u32 = 1;
const MOVING_SET: u32 = 2;
const FIRST_BATCH_SET: u32 = 3;

/// A view's culling output: its index list of each frame parity, and the textures it goes into.
#[derive(Debug, Default)]
struct ViewCull {
    /// Each frame parity's index list, grouped by bucket.
    culls: [BucketedCull; 2],
    /// The view's values in the frame that culled last, or `None` when it has no camera.
    frame: Option<ViewFrame>,
    /// The offset from the view's camera to each cell in use, in the frame that culled last.
    offsets: CellOffsets,
    /// The slot of the index list textures, which the view's draw records share.
    listed: RingSlot,
    /// Rows of each index list texture, 0 before they exist.
    rows: u32,
    /// The objects, rows and clusters that the view's runs covered in the frame that culled last.
    tested: u32,
    /// The view's blended rows, sorted back to front, in the frame that culled last.
    sorted: SortedView,
    /// Each frame parity's index list entries of the sorted rows, in their order.
    sorted_entries: [Vec<u32>; 2],
}

/// Each view's culling output, and the runs of rows that a view culls. The views are of one kind,
/// in order from the first: the views of cameras, or the shadow cascades.
#[derive(Debug)]
pub(super) struct Culling {
    /// The first view, whose output is the first of `views`.
    first: ViewId,
    views: Vec<ViewCull>,
    /// The runs of the view being culled.
    runs: Vec<CullRun>,
    /// Whether each batch of the layout culls by cluster in the frame.
    clustered: Vec<bool>,
    /// The frame whose culling the views hold for its parity, or 0 for none.
    culled: u32,
}

/// Pushes the runs that one view culls. With cells in use, the still scene objects of each cell in
/// `visible` come from the scene's cell order, then every moving scene object, and a clustered
/// batch culls the clusters of the visible cells alone. Otherwise every scene slot is culled in
/// place, and `visible` holds every cell. A batch that culls by row culls every active row.
fn push_view_runs(
    runs: &mut Vec<CullRun>,
    input: &FrameInput<'_>,
    layout: &Layout,
    clusters: &Clusters,
    cells: &CellCulling,
    visible: &CellMask,
    clustered: &[bool],
) -> Result<(), TryReserveError> {
    let (parity, scene) = (input.parity(), input.scene);
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
        let slots = 0..scene.slots().high_water();
        push_runs(runs, SCENE_SET, slots, BY_ROW, 0, scene_cells)?;
    }
    let first_cluster_set = FIRST_BATCH_SET + layout.batches.len() as u32;
    for (k, slot) in layout.batches.iter().enumerate() {
        if slot.bucket == NO_BUCKET {
            continue;
        }
        if clustered[k] {
            let set = first_cluster_set + k as u32;
            for run in clusters.set(slot).clusters.cells() {
                if visible.contains(run.cell) {
                    let (range, bucket) = (run.start..run.end, slot.bucket + 1);
                    let cell = RunCells::One(run.cell);
                    push_runs(runs, set, range, bucket, slot.first_cluster, cell)?;
                }
            }
            continue;
        }
        let batch = input
            .batches
            .get(slot.id)
            .expect("the layout names live batches");
        let rows = 0..batch.frame_active_count(parity);
        let cells = batch
            .common_cell()
            .map_or(RunCells::Rows(batch.cells()), RunCells::One);
        let set = FIRST_BATCH_SET + k as u32;
        push_runs(runs, set, rows, slot.bucket, slot.base, cells)?;
    }
    Ok(())
}

impl Culling {
    /// No culling output yet, for views from `first` on.
    pub(super) fn new(first: ViewId) -> Self {
        Self {
            first,
            views: Vec::new(),
            runs: Vec::new(),
            clustered: Vec::new(),
            culled: 0,
        }
    }

    /// The place of a view's output in `views`.
    fn slot(&self, view: ViewId) -> usize {
        view.index() - self.first.index()
    }

    /// The view whose output is `k`-th in `views`.
    pub(super) fn view(&self, k: usize) -> ViewId {
        ViewId::from_index(self.first.index() + k)
    }

    /// The number of views with culling output.
    pub(super) fn views(&self) -> usize {
        self.views.len()
    }

    /// The frame that culled last, or 0 for none.
    pub(super) fn culled_frame(&self) -> u32 {
        self.culled
    }

    /// A view's values in the frame that culled last, or `None` when it has no camera.
    pub(super) fn frame(&self, view: ViewId) -> Option<&ViewFrame> {
        self.output(view)?.frame.as_ref()
    }

    /// A view's output, or `None` for a view of another kind or one without output yet.
    fn output(&self, view: ViewId) -> Option<&ViewCull> {
        let slot = view.index().checked_sub(self.first.index())?;
        self.views.get(slot)
    }

    /// The offset from a view's camera to each cell in use, in the frame that culled last.
    pub(super) fn offsets(&self, view: ViewId) -> &CellOffsets {
        &self.views[self.slot(view)].offsets
    }

    /// The objects, rows and clusters that a view's culling tested in the frame that culled last.
    pub(super) fn tested(&self, view: ViewId) -> u32 {
        self.output(view).map_or(0, |view| view.tested)
    }

    /// The culling output of a frame's parity for a view: its visible sources, bucket by bucket.
    pub(super) fn culled(&self, frame: u32, view: ViewId) -> &BucketedCull {
        &self.views[self.slot(view)].culls[(frame & 1) as usize]
    }

    /// The index list entries that a frame draws over all its views, or 0 for a frame that did
    /// not cull, whose parity's output is still an older frame's.
    pub(super) fn visible_entries(&self, frame: u32) -> u32 {
        if self.culled != frame {
            return 0;
        }
        let parity = (frame & 1) as usize;
        self.views
            .iter()
            .filter(|view| view.frame.is_some())
            .map(|view| (view.culls[parity].len() + view.sorted_entries[parity].len()) as u32)
            .sum()
    }

    /// A view's blended rows, sorted back to front, in the frame that culled last.
    pub(super) fn sorted(&self, view: ViewId) -> &SortedView {
        &self.views[self.slot(view)].sorted
    }

    /// Makes room in every view's output for the transparent pass's rows and draws.
    pub(super) fn reserve_sorted(&mut self, sorted: &SortedLayout) -> Result<(), TryReserveError> {
        let rows = sorted.rows() as usize;
        for view in &mut self.views {
            sorted.reserve_view(&mut view.sorted)?;
            for entries in &mut view.sorted_entries {
                entries.try_reserve(rows.saturating_sub(entries.len()))?;
            }
        }
        Ok(())
    }

    /// Makes room for the layout's runs, and for every view's output of both parities, with a
    /// view for each of `views`. Each view writes its index list again, into textures that may
    /// be new.
    pub(super) fn reserve(&mut self, room: CullRoom, views: usize) -> Result<(), TryReserveError> {
        // Emptied first, so the room asked for is the whole run count, not more on top of the
        // previous frame's runs.
        self.runs.clear();
        self.runs.try_reserve(room.runs as usize)?;
        self.clustered.clear();
        self.clustered.try_reserve(room.batches as usize)?;
        self.add_views(room, views)?;
        for view in &mut self.views {
            for cull in &mut view.culls {
                cull.try_reserve(room.rows, room.runs, room.by_row, room.buckets)?;
            }
            view.listed.forget();
        }
        Ok(())
    }

    /// Adds the views that have no output yet, up to `views`, each with room for the layout.
    pub(super) fn add_views(
        &mut self,
        room: CullRoom,
        views: usize,
    ) -> Result<(), TryReserveError> {
        if self.views.len() < views {
            self.views.try_reserve(views - self.views.len())?;
        }
        while self.views.len() < views {
            let mut view = ViewCull::default();
            for cull in &mut view.culls {
                cull.try_reserve(room.rows, room.runs, room.by_row, room.buckets)?;
            }
            self.views.push(view);
        }
        Ok(())
    }

    /// Makes room for `sources` visible sources in every view's output.
    pub(super) fn reserve_sources(&mut self, sources: u32) -> Result<(), TryReserveError> {
        for view in &mut self.views {
            for cull in &mut view.culls {
                cull.try_reserve(sources, 0, 0, 0)?;
            }
        }
        Ok(())
    }

    /// Finds each view's visible sources of `layout` for the frame, on the calling thread and the
    /// job workers. `frame_of` gives each view's values, or `None` for a view that the frame does
    /// not draw. With `sorted`, each view also sorts the blended rows back to front. The clusters that come to rest are the same for every view, so they are built
    /// once; each view then culls runs of its own, which skip the cells it cannot see. Fails only
    /// when memory cannot grow for a view that sees more cells than any view did before.
    pub(super) fn cull(
        &mut self,
        input: &FrameInput<'_>,
        layout: &Layout,
        clusters: &mut Clusters,
        cells: &CellCulling,
        frame_of: impl Fn(ViewId) -> Option<ViewFrame>,
        sorted: Option<&SortedLayout>,
    ) -> Result<(), TryReserveError> {
        let (parity, scene, batches) = (input.parity(), input.scene, input.batches);
        self.culled = input.frame;
        let mut any = false;
        let first = self.first.index();
        for (k, view) in self.views.iter_mut().enumerate() {
            view.frame = frame_of(ViewId::from_index(first + k));
            if let Some(frame) = &view.frame {
                view.offsets.update(scene, &frame.camera);
                any = true;
            }
            let entries = &mut view.sorted_entries[parity];
            entries.clear();
            if let Some(sorted) = sorted {
                let frame = view.frame.as_ref();
                sorted.sort(input.jobs, frame, scene, batches, parity, &mut view.sorted);
                for &item in view.sorted.items() {
                    entries.push(sorted.row(item, batches).entry);
                }
            }
        }
        if !any {
            return Ok(());
        }
        self.refresh_clusters(input, layout, clusters, cells.active());
        let (batches, clusters) = (input.batches, &*clusters);
        let slots = &layout.batches;
        // Scene objects test their own masks, unless every one has the same mask.
        let scene_layers = scene
            .common_layers()
            .map_or(SetLayers::Rows(scene.layers()), SetLayers::All);
        let order = cells.scene_order().sources();
        let sets = |set: u32| -> CullSet<'_> {
            let world = scene.world(parity).spheres();
            let (spheres, order) = match set {
                SCENE_SET => (world, SetOrder::Rows),
                STILL_SET => (cells.still_spheres(), SetOrder::Copied(order)),
                MOVING_SET => (world, SetOrder::Gathered(order)),
                _ => {
                    // Each batch's rows, then each batch's clusters, with the batch's mask.
                    let k = (set - FIRST_BATCH_SET) as usize;
                    let slot = &slots[k % slots.len()];
                    let batch = batches.get(slot.id).expect("the layout names live batches");
                    let layers = SetLayers::All(batch.layers());
                    if k >= slots.len() {
                        return CullSet {
                            spheres: clusters.set(slot).clusters.spheres(),
                            cells: &[],
                            order: SetOrder::Rows,
                            layers,
                        };
                    }
                    return CullSet {
                        spheres: batch.world(parity).spheres(),
                        cells: batch.cells(),
                        order: SetOrder::Rows,
                        layers,
                    };
                }
            };
            // The scene's sets list slots, whose masks the scene holds.
            CullSet {
                spheres,
                cells: scene.cells(),
                order,
                layers: scene_layers,
            }
        };
        for view in &mut self.views {
            let Some(frame) = &view.frame else {
                continue;
            };
            let visible = if cells.active() {
                cells.visible(&frame.frustum, view.offsets.as_slice())
            } else {
                CellMask::ALL
            };
            self.runs.clear();
            push_view_runs(
                &mut self.runs,
                input,
                layout,
                clusters,
                cells,
                &visible,
                &self.clustered,
            )?;
            view.tested = self.runs.iter().map(|run| run.end - run.start).sum();
            // Room for the view's runs, which the cells in view decide; it grows only when a view
            // sees more cells than any view did before.
            let by_row = self.runs.iter().filter(|run| run.bucket == BY_ROW).count();
            let room = &layout.room;
            view.culls[parity].try_reserve(
                room.rows,
                self.runs.len() as u32,
                by_row as u32,
                room.buckets,
            )?;
            let cull_view = CullView {
                frustum: &frame.frustum,
                offsets: view.offsets.as_slice(),
                layers: frame.layers,
            };
            null3d_core::culling::cull_into_buckets(
                input.jobs,
                cull_view,
                &sets,
                &self.runs,
                &layout.scene_buckets,
                layout.buckets.len() as u32,
                &mut view.culls[parity],
            );
        }
        Ok(())
    }

    /// Keeps the clusters of each static batch that the layout draws in step with its rows, and
    /// notes which batches cull by cluster in the frame: the static batches at rest whose rows
    /// share one cell, or, with `in_cells`, whose rows fit their room for clusters inside cells.
    fn refresh_clusters(
        &mut self,
        input: &FrameInput<'_>,
        layout: &Layout,
        clusters: &mut Clusters,
        in_cells: bool,
    ) {
        let parity = input.parity();
        self.clustered.clear();
        for slot in &layout.batches {
            let mut clustered = false;
            if slot.clustered() && slot.bucket != NO_BUCKET {
                let batch = input
                    .batches
                    .get(slot.id)
                    .expect("the layout names live batches");
                let active = batch.frame_active_count(parity);
                // At rest: nothing changed in this frame's update, which also copies the previous
                // frame's changes into this buffer, so both world buffers hold the same rows.
                let at_rest = batch.frame() == input.frame
                    && batch.changed_ranges().is_empty()
                    && batch.frame_active_count(parity ^ 1) == active;
                let cells = match batch.common_cell() {
                    Some(cell) => Some(RowCells::One(cell)),
                    None if in_cells => Some(RowCells::Each(batch.cells())),
                    None => None,
                };
                let spheres = batch.world(parity).spheres();
                clustered = clusters
                    .refresh(
                        slot,
                        at_rest && cells.is_some(),
                        spheres,
                        active,
                        cells.unwrap_or(RowCells::One(ORIGIN_CELL)),
                    )
                    .is_some();
            }
            self.clustered.push(clustered);
        }
    }

    /// Makes a view's ring of index list textures big enough for the layout, at most `limit`
    /// rows each. Returns true when it made them again.
    pub(super) fn size(
        &mut self,
        list: &mut DrawList,
        view: ViewId,
        layout: &Layout,
        limit: u32,
    ) -> Result<bool, RecordError> {
        let slot = self.slot(view);
        let needed = layout
            .room
            .rows
            .div_ceil(null3d_gpu::drawlist::sizes::INDICES_PER_TEXTURE_ROW);
        DataTexture::indices(ids::visible(view), RING).grow(
            list,
            &mut self.views[slot].rows,
            needed,
            limit,
        )
    }

    /// Takes the slot of a view's index list textures for the frame, and writes the frame's
    /// index list there, unless the slot holds the previous frame's list and it is the same: the
    /// same entries in the same buckets. Returns the slot, and true when the list is new.
    pub(super) fn upload(
        &mut self,
        list: &mut DrawList,
        view: ViewId,
        frame: u32,
    ) -> Result<(u32, bool), RecordError> {
        let parity = (frame & 1) as usize;
        let k = self.slot(view);
        let state = &mut self.views[k];
        let entries = &state.sorted_entries;
        let kept = state.listed.holds_previous(frame)
            && state.culls[parity].same_entries(&state.culls[parity ^ 1])
            && entries[parity] == entries[parity ^ 1];
        let slot = state.listed.take(frame, !kept);
        if !kept {
            let indices = state.culls[parity].indices();
            let texture = ids::visible(view) + slot;
            let opaque = indices.len() as u32;
            write_rows(
                list,
                texture,
                TextureRows::indices(0, opaque),
                address(words_as_bytes(indices)),
            )?;
            // The sorted rows follow the opaque ones, back to front.
            let sorted = &entries[parity];
            if !sorted.is_empty() {
                write_rows(
                    list,
                    texture,
                    TextureRows::indices(opaque, sorted.len() as u32),
                    address(words_as_bytes(sorted)),
                )?;
            }
        }
        Ok((slot, !kept))
    }

    /// Forgets every view's textures and the frame that culled, so the next frame culls, makes
    /// the textures and writes the lists again, after the thread that draws replaced the GPU.
    pub(super) fn forget_gpu(&mut self) {
        self.culled = 0;
        for view in &mut self.views {
            view.rows = 0;
            view.listed.forget();
        }
    }
}
