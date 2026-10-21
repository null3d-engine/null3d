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
use null3d_core::culling::{NO_BUCKET, row_center};
use null3d_core::handle::Handle;
use null3d_core::instances::BatchTable;
use null3d_core::levels::{LevelRule, NO_LINK, Picked};
use null3d_core::scene::SceneStorage;
use null3d_core::world::UNBOUNDED_RADIUS;
use null3d_gpu::drawlist::{DrawList, Op};

use super::layout::{BUCKET_WORDS, INDEX_ENTRIES_PER_COPY, Layout};
use crate::frame::{CellOffsets, RecordError, UploadArena, words_as_bytes};

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

    /// Counts the copies that `views` place in each bucket, and gives each bucket a slice of that
    /// size in every view's compacted instance buffer, with the buckets of one level set packed
    /// together. Uploads the records of the buckets whose slices moved. A layout whose buckets
    /// take no level, and one that no view draws, keeps its slices. Allocates nothing once the
    /// working lists have their room.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn fit_copies(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
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
        self.place_slices(list, arena, &fits)?;
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
        for source in 0..self.scene_rows as usize {
            let home = self.cull_buckets[source];
            if home == NO_BUCKET || self.marks[home as usize] == 0 {
                continue;
            }
            let center = row_center(&spheres, slots[source], cells, source);
            let radius = spheres.radii[source];
            let bias = biases[source];
            self.count_source(counts, rule, home, center, radius, radii[source], bias);
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
                self.count_source(counts, rule, home, center, spheres.radii[row], local, 1.0);
            }
        }
    }

    /// Counts one source's copies: the buckets of base bucket `home` that the rule may place it
    /// in, for a source whose world bounding sphere is at `center` relative to the camera, with
    /// the world radius `radius`, the local radius `local` and the threshold `bias`.
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
    ) {
        // A sphere that covers all of space, and an object whose local radius is 0, have no scale
        // to read here. Its buckets hold the room for every level that it may pick.
        if !(local > 0.0 && radius < UNBOUNDED_RADIUS) {
            self.count_chain(counts, home);
            return;
        }
        let scale = radius / local;
        // The sphere that the culling shader tests: the bucket's own local radius, scaled by the
        // source's. A bucket of a mesh's bounds holds the mesh's radius, which a scaled source
        // grows.
        let radius = self.buckets[home as usize].radius * scale;
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
            match rule.pick(&self.level_links, home, scale, radius, near, bias) {
                Picked::One(bucket) => keep(bucket),
                Picked::Fade { new, old, .. } => {
                    keep(new);
                    keep(old);
                }
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
    /// those sets alone. Uploads the records of the buckets whose slice moved.
    fn place_slices(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        fits: &[u32],
    ) -> Result<(), RecordError> {
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
        let mut changed: Option<std::ops::Range<usize>> = None;
        for (index, bucket) in self.buckets.iter_mut().enumerate() {
            if bucket.indexed {
                bucket.base += copied * INDEX_ENTRIES_PER_COPY;
            }
            if self.placed[index] == bucket.base {
                continue;
            }
            self.placed[index] = bucket.base;
            self.bucket_records[index * BUCKET_WORDS as usize] = bucket.base;
            changed = Some(match changed {
                Some(range) => range.start.min(index)..range.end.max(index + 1),
                None => index..index + 1,
            });
        }
        if let Some(range) = changed {
            let words = &self.bucket_records
                [range.start * BUCKET_WORDS as usize..range.end * BUCKET_WORDS as usize];
            let (at, bytes) = arena.push(words_as_bytes(words))?;
            let offset = range.start as u32 * BUCKET_WORDS * 4;
            let (_, records) = self.table_ids();
            list.push(Op::WriteBuffer, &[records, offset, at, bytes])?;
        }
        Ok(())
    }
}
