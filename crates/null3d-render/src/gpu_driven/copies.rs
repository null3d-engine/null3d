//! Sizes each level's slice of a view's compacted instance buffer to the copies that the frame
//! draws.
//!
//! A bucket of a mesh with levels holds the sources that pick that level in a view, and each
//! source picks one level, or two inside a fading band. So the buckets of one level set hold about
//! as many copies in all as the set has sources, however many levels it has. The build reserves a
//! slice for every source of the set in every level's bucket, since any source may pick any
//! level: a set of four fading levels would take eight times the copies that its sources need, in
//! every view.
//!
//! This module counts the copies that a frame's views place in each bucket, and gives each bucket
//! a slice of that size, so the slices of one set take the room of the set's sources. The count
//! reads the same stateless rule that the culling shader runs ([`null3d_core::levels`]), so a
//! source lands in the bucket that the shader appends it to. A source counts toward every level
//! that it may pick, so a slice never falls short of the shader's writes however the two round
//! the last bits of a distance.
//!
//! The count covers every source of a layout, not only the ones in view, so it reads no frustum.
//! A bucket's slice is the largest count of any view that draws the layout, because the bucket
//! table is one for all of them.

use null3d_core::cells::CellPosition;
use null3d_core::culling::{NO_BUCKET, RowRanges, batch_ranges, row_center};
use null3d_core::handle::Handle;
use null3d_core::instances::BatchTable;
use null3d_core::levels::{DrawRange, LevelRule, NO_LINK, Picked};
use null3d_core::scene::SceneStorage;
use null3d_core::world::UNBOUNDED_RADIUS;

use super::layout::{BUCKET_WORDS, INDEX_ENTRIES_PER_COPY, Layout};
use crate::frame::{CellOffsets, RecordError};
use crate::levels::{StageWatches, key_level};

/// How far from a switch distance a source counts toward both levels that it may pick, as a share
/// of the distance. It dwarfs the difference that a CPU and a GPU can make of the same distance,
/// and only the sources at a switch count twice.
const SLACK: f32 = 1.0e-3;

/// A view that draws a layout's buckets: the rule that picks its levels of detail, and the camera
/// that its instances are placed relative to.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct CopyView {
    /// The view's rule for picking levels.
    pub rule: LevelRule,
    /// The camera that the view places its instances relative to.
    pub camera: CellPosition,
}

impl Layout {
    /// True when a bucket of this layout holds a level's copies.
    pub(super) fn picks_levels(&self) -> bool {
        !self.level_buckets.is_empty()
    }

    /// Notes the levels that the copies counted last were picked at, for the staged levels that a
    /// loader waits on: a level whose bucket holds a copy was picked. A mesh that the layout draws
    /// at no level restarts its warm-up, so a page that loads a model before it draws it keeps its
    /// stages. `counted` says that this frame counted copies; false resets every warm-up. Costs
    /// nothing while no loader waits.
    pub(super) fn note_stage_picks(&self, watches: &mut StageWatches, frame: u64, counted: bool) {
        if watches.is_empty() {
            return;
        }
        if !counted {
            watches.hold(frame, |_| false);
            return;
        }
        watches.hold(frame, |mesh| self.draws_mesh(mesh));
        for &bucket in &self.level_buckets {
            let count = self.copy_counts.get(bucket as usize).copied().unwrap_or(0);
            if count > 0 {
                let (mesh, level) = key_level(self.buckets[bucket as usize].mesh_key);
                watches.picked(mesh, level);
            }
        }
    }

    /// True when a bucket of the layout draws `mesh` at some level: a source of the mesh exists in
    /// the scene, whatever the view shows.
    fn draws_mesh(&self, mesh: u32) -> bool {
        self.level_buckets
            .iter()
            .any(|&bucket| key_level(self.buckets[bucket as usize].mesh_key).0 == mesh)
    }

    /// Counts the copies that `views` place in each bucket, and gives each bucket a slice of that
    /// size in every view's compacted instance buffer, with the buckets of one level set packed
    /// together. Marks the records of the buckets whose slices moved for the frame's one table
    /// upload. A layout whose buckets take no level, and one that no view draws, keeps its slices.
    /// Allocates nothing once the working lists have their room.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn fit_copies(
        &mut self,
        scene: &SceneStorage,
        batches: &BatchTable,
        views: &[CopyView],
        parity: usize,
        offsets: &mut CellOffsets,
    ) -> Result<(), RecordError> {
        if !self.picks_levels() || views.is_empty() {
            return Ok(());
        }
        let buckets = self.buckets.len();
        let mut counts = std::mem::take(&mut self.copy_counts);
        let mut fits = std::mem::take(&mut self.copy_fits);
        counts.clear();
        counts.resize(buckets, 0);
        fits.clear();
        fits.resize(buckets, 0);
        for view in views {
            counts.fill(0);
            offsets.update(scene, &view.camera);
            self.count_view(
                scene,
                batches,
                view.rule,
                parity,
                offsets.as_slice(),
                &mut counts,
            );
            for &bucket in &self.level_buckets {
                let count = counts[bucket as usize];
                let fit = &mut fits[bucket as usize];
                *fit = (*fit).max(count);
            }
        }
        self.place_slices(&fits);
        self.copy_counts = counts;
        self.copy_fits = fits;
        Ok(())
    }

    /// Counts the copies that one view places in each bucket of the layout.
    fn count_view(
        &self,
        scene: &SceneStorage,
        batches: &BatchTable,
        rule: LevelRule,
        parity: usize,
        cells: &[[f32; 4]],
        counts: &mut [u32],
    ) {
        let spheres = scene.world(parity).spheres();
        let slots = scene.cells();
        let radii = scene.local_radii();
        let biases = scene.level_biases();
        let ranges = scene.draw_ranges();
        for source in 0..self.scene_rows as usize {
            let home = self.cull_buckets[source];
            if home == NO_BUCKET || self.marks[home as usize] == 0 {
                continue;
            }
            let center = row_center(&spheres, slots[source], cells, source);
            let radius = spheres.radii[source];
            let bias = biases[source];
            let range = RowRanges::Rows(ranges).range(source);
            self.count_source(
                counts,
                rule,
                home,
                center,
                radius,
                radii[source],
                bias,
                range,
                false,
            );
        }
        for &(id, first) in &self.batch_bases {
            let Ok(batch) = batches.get(Handle::from_raw(id)) else {
                continue;
            };
            let spheres = batch.world(parity).spheres();
            let local = batch.local_radius();
            let batch_cells = batch.cells();
            for row in 0..batch.capacity() as usize {
                let Some(&home) = self.cull_buckets.get(first as usize + row) else {
                    break;
                };
                if home == NO_BUCKET || self.marks[home as usize] == 0 {
                    continue;
                }
                let center = row_center(&spheres, batch_cells[row], cells, row);
                let range = batch_ranges(batches, batch).range(row);
                // A batch's rows carry the batch's own radius, which the culling shader tests
                // around each row in place of its bucket's sphere.
                self.count_source(
                    counts,
                    rule,
                    home,
                    center,
                    spheres.radii[row],
                    local,
                    1.0,
                    range,
                    true,
                );
            }
        }
    }

    /// Counts one source's copies: the buckets of base bucket `home` that the rule may place it
    /// in, for a source whose world bounding sphere is at `center` relative to the camera, with
    /// the world radius `radius`, the local radius `local` and the threshold `bias`. `own` is true
    /// for a source that carries a bound of its own, as a batch whose rows move do, and false for
    /// one that tests its bucket's sphere.
    #[allow(clippy::too_many_arguments)]
    fn count_source(
        &self,
        counts: &mut [u32],
        rule: LevelRule,
        home: u32,
        center: [f32; 3],
        radius: f32,
        local: f32,
        bias: f32,
        range: DrawRange,
        own: bool,
    ) {
        // A sphere that covers all of space, and an object whose local radius is 0, have no scale
        // to read here. Its buckets hold the room for every level that it may pick.
        if !(local > 0.0 && radius < UNBOUNDED_RADIUS) {
            self.count_chain(counts, home);
            return;
        }
        let scale = radius / local;
        // The sphere that the culling shader tests: a source's own radius where it carries one,
        // otherwise the bucket's local radius scaled by the source's. A bucket of a mesh's bounds
        // holds the mesh's radius, which a scaled source grows.
        let radius = if own {
            radius
        } else {
            self.buckets[home as usize].radius * scale
        };
        let distance = rule.distance(center, radius);
        // A source at a switch distance counts toward both levels, and one inside a band toward
        // both levels' fade buckets, so the slices hold whatever the shader picks.
        let mut picked = [u32::MAX; 4];
        let mut len = 0;
        for near in [distance * (1.0 - SLACK), distance * (1.0 + SLACK)] {
            let mut keep = |bucket: u32| {
                if len < picked.len() && !picked[..len].contains(&bucket) {
                    picked[len] = bucket;
                    len += 1;
                }
            };
            match rule.pick(&self.level_links, home, scale, radius, near, bias, range) {
                Picked::One(bucket) => keep(bucket),
                Picked::Fade { new, old, .. } => {
                    keep(new);
                    keep(old);
                }
                Picked::FadeIn { bucket, .. } => keep(bucket),
                Picked::FadeOut { old, .. } => keep(old),
                Picked::Hidden => {}
            }
        }
        for &bucket in &picked[..len] {
            counts[bucket as usize] += 1;
        }
    }

    /// Counts a source toward every bucket of its set, for a source whose level this count cannot
    /// place.
    fn count_chain(&self, counts: &mut [u32], home: u32) {
        let mut bucket = home;
        loop {
            counts[bucket as usize] += 1;
            let link = self.level_links[bucket as usize];
            if link.fade != NO_LINK {
                counts[link.fade as usize] += 1;
            }
            if link.next == NO_LINK {
                return;
            }
            bucket = link.next;
        }
    }

    /// Places each bucket's slice of a view's copies: the buckets without levels first, in their
    /// order, then the buckets of the level sets, so a count that moves resizes the slices of
    /// those sets alone. Marks the records of the buckets whose slice moved for the frame's one
    /// table upload.
    fn place_slices(&mut self, fits: &[u32]) {
        let Layout { buckets, marks, .. } = self;
        let (mut copied, mut indexed) = (0u32, 0u32);
        for level in [false, true] {
            for (index, bucket) in buckets.iter_mut().enumerate() {
                if (marks[index] != 0) != level {
                    continue;
                }
                let capacity = if level { fits[index] } else { bucket.capacity };
                bucket.capacity = capacity;
                let total = if bucket.indexed {
                    &mut indexed
                } else {
                    &mut copied
                };
                bucket.base = *total;
                *total = total.saturating_add(capacity);
            }
        }
        self.copied = copied;
        self.indexed = indexed;
        // A view's index entries follow its copies, so their bases count entries from the
        // buffer's start.
        let copied = self.copied;
        for (index, bucket) in self.buckets.iter_mut().enumerate() {
            if bucket.indexed {
                bucket.base += copied * INDEX_ENTRIES_PER_COPY;
            }
            self.bucket_records[index * BUCKET_WORDS as usize] = bucket.base;
        }
        // The table goes up whole: every bucket's slice is this frame's, and the culling shader
        // reads the table before it places a copy.
        self.mark_records(0..self.buckets.len() as u32);
    }
}

#[cfg(test)]
mod tests {
    use null3d_core::levels::{DrawRange, LevelLink, LevelRule, NO_LINK, Switch};

    use super::*;
    use crate::gpu_driven::layout::Bucket;

    /// A batch row whose vertex shader carries it across a long lane must count its copies by the
    /// batch's own bound, as the culling shader picks them. The row is 20 m from the camera, and
    /// the bucket's 0.9 m sphere puts its nearest point 19.1 m out, past a level's 5 m switch,
    /// while the row's own 2600 m bound reaches the camera and keeps the base level.
    #[test]
    fn a_batch_row_counts_by_its_own_bound() {
        let mut layout = Layout::default();
        layout.level_links = vec![
            LevelLink {
                value: 0.0,
                switch: Switch::Error,
                next: 1,
                fade: NO_LINK,
            },
            LevelLink {
                value: 0.01,
                switch: Switch::Error,
                next: NO_LINK,
                fade: NO_LINK,
            },
        ];
        layout.buckets = vec![
            Bucket {
                radius: 0.9,
                ..Bucket::default()
            },
            Bucket {
                radius: 0.9,
                ..Bucket::default()
            },
        ];
        let rule = LevelRule::new(1000.0, 1.0, false, 1.0, 0.0);
        let count = |own: bool| {
            let mut counts = [0u32; 2];
            layout.count_source(
                &mut counts,
                rule,
                0,
                [0.0, 0.0, 20.0],
                2600.0,
                2600.0,
                1.0,
                DrawRange::NONE,
                own,
            );
            counts
        };
        assert_eq!(
            count(true),
            [1, 0],
            "a row with its own bound keeps its base level"
        );
        assert_eq!(
            count(false),
            [0, 1],
            "the bucket's sphere alone would move the row to the coarser level"
        );
    }
}
