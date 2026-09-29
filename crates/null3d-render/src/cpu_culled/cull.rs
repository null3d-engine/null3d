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
//! Each frame parity keeps its own culling output, because the render worker replays a frame's
//! list while the next frame culls, and the list uploads the index list straight from that output.

use std::collections::TryReserveError;

use null3d_core::culling::{BY_ROW, BucketedCull, CULL_CHUNK, CullRun, NO_BUCKET};
use null3d_core::world::SphereArrays;
use null3d_gpu::drawlist::DrawList;

use super::data::{DataTexture, RING, RingSlot, TextureRows, write_rows};
use super::ids;
use super::layout::{Clusters, CullRoom, Layout};
use crate::frame::{FrameInput, RecordError, SceneSettings, address, words_as_bytes};
use crate::view::{ViewFrame, ViewId};

/// A view's culling output: its index list of each frame parity, and the textures it goes into.
#[derive(Debug, Default)]
struct ViewCull {
    /// Each frame parity's index list, grouped by bucket.
    culls: [BucketedCull; 2],
    /// The view's values in the frame that culled last, or `None` when it has no camera.
    frame: Option<ViewFrame>,
    /// The slot of the index list textures, which the view's draw records share.
    listed: RingSlot,
    /// Rows of each index list texture, 0 before they exist.
    rows: u32,
}

/// Each view's culling output, and the runs of rows that every view culls.
#[derive(Debug, Default)]
pub(super) struct Culling {
    views: Vec<ViewCull>,
    /// The frame's culling runs.
    runs: Vec<CullRun>,
    /// The frame whose culling the views hold for its parity, or 0 for none.
    culled: u32,
}

/// Splits rows `0..rows` of a set into culling runs of at most one chunk each.
fn push_runs(runs: &mut Vec<CullRun>, set: u32, rows: u32, bucket: u32, base: u32) {
    let mut start = 0;
    while start < rows {
        let end = (start + CULL_CHUNK).min(rows);
        runs.push(CullRun {
            set,
            start,
            end,
            bucket,
            base,
        });
        start = end;
    }
}

impl Culling {
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
        self.views.get(view.index())?.frame.as_ref()
    }

    /// The culling output of a frame's parity for a view: its visible sources, bucket by bucket.
    pub(super) fn culled(&self, frame: u32, view: ViewId) -> &BucketedCull {
        &self.views[view.index()].culls[(frame & 1) as usize]
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
            .map(|view| view.culls[parity].len() as u32)
            .sum()
    }

    /// Makes room for the layout's runs, and for every view's output of both parities, with a
    /// view for each of `views`. Each view writes its index list again, into textures that may
    /// be new.
    pub(super) fn reserve(&mut self, room: CullRoom, views: usize) -> Result<(), TryReserveError> {
        // Emptied first, so the room asked for is the whole run count, not more on top of the
        // previous frame's runs.
        self.runs.clear();
        self.runs.try_reserve(room.runs as usize)?;
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

    /// Finds each view's visible sources for the frame, on the calling thread and the job
    /// workers. The runs of rows and clusters, and the clusters that come to rest, are the same
    /// for every view, so they are made once.
    pub(super) fn cull(
        &mut self,
        input: &FrameInput<'_>,
        settings: &SceneSettings,
        layout: &Layout,
        clusters: &mut Clusters,
    ) {
        let parity = input.parity();
        self.culled = input.frame;
        let mut any = false;
        for (index, view) in self.views.iter_mut().enumerate() {
            let id = ViewId::from_index(index);
            view.frame = settings.view_frame(id, input.scene, parity, input.canvas);
            any |= view.frame.is_some();
        }
        if !any {
            return;
        }
        self.runs.clear();
        // Slots past the highest one ever used hold no object.
        push_runs(
            &mut self.runs,
            0,
            input.scene.slots().high_water(),
            BY_ROW,
            0,
        );
        // Set 0 is the scene, sets 1 to n the batches' rows, and the next n the batches' clusters.
        let first_cluster_set = layout.batches.len() as u32 + 1;
        for (k, slot) in layout.batches.iter().enumerate() {
            if slot.bucket == NO_BUCKET {
                continue;
            }
            let batch = input
                .batches
                .get(slot.id)
                .expect("the layout names live batches");
            let active = batch.frame_active_count(parity);
            if slot.clustered() {
                // At rest: nothing changed in this frame's update, which also copies the previous
                // frame's changes into this buffer, so both world buffers hold the same rows.
                let at_rest = batch.frame() == input.frame
                    && batch.changed_ranges().is_empty()
                    && batch.frame_active_count(parity ^ 1) == active;
                let spheres = batch.world(parity).spheres();
                if let Some(count) = clusters.refresh(slot, at_rest, spheres, active) {
                    let set = first_cluster_set + k as u32;
                    push_runs(
                        &mut self.runs,
                        set,
                        count,
                        slot.bucket + 1,
                        slot.first_cluster,
                    );
                    continue;
                }
            }
            push_runs(&mut self.runs, k as u32 + 1, active, slot.bucket, slot.base);
        }
        let (scene, batches, clusters) = (input.scene, input.batches, &*clusters);
        let slots = &layout.batches;
        let sets = |set: u32| -> SphereArrays<'_> {
            let set = set as usize;
            if set == 0 {
                return scene.world(parity).spheres();
            }
            if set <= slots.len() {
                return batches
                    .get(slots[set - 1].id)
                    .expect("the layout names live batches")
                    .world(parity)
                    .spheres();
            }
            clusters
                .set(&slots[set - 1 - slots.len()])
                .clusters
                .spheres()
        };
        for view in &mut self.views {
            let Some(frame) = &view.frame else {
                continue;
            };
            null3d_core::culling::cull_into_buckets(
                input.jobs,
                &frame.frustum,
                &sets,
                &self.runs,
                &layout.scene_buckets,
                layout.buckets.len() as u32,
                &mut view.culls[parity],
            );
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
        let needed = (layout.resident_rows + layout.streamed_rows)
            .div_ceil(null3d_gpu::drawlist::sizes::INDICES_PER_TEXTURE_ROW);
        DataTexture::indices(ids::visible(view), RING).grow(
            list,
            &mut self.views[view.index()].rows,
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
        let state = &mut self.views[view.index()];
        let kept = state.listed.holds_previous(frame)
            && state.culls[parity].same_entries(&state.culls[parity ^ 1]);
        let slot = state.listed.take(frame, !kept);
        if !kept {
            let indices = state.culls[parity].indices();
            write_rows(
                list,
                ids::visible(view) + slot,
                TextureRows::indices(0, indices.len() as u32),
                address(words_as_bytes(indices)),
            )?;
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
