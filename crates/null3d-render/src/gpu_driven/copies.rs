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
//! Each view counts only the sources that its frustum holds, with room to spare at its edge, as
//! its culling pass appends no other. A view that draws for a layout without a camera of its own,
//! such as the outlines, and the views of a scene whose staged levels a loader watches, count
//! every source instead. A shadow view picks its casters' levels in its own texels, so two
//! cascades can place one caster in two levels; the frustum keeps the casters of a near cascade
//! out of the levels that a far one picks for its own. A bucket's slice is the largest count of
//! any view that draws the layout, because the bucket table is one for all of them.
//!
//! The count picks levels in every frame, so it visits only the sources whose home bucket takes a
//! level's copies, which the layout lists when it is built. The views that share a camera, as the
//! shadow views do, count in one pass that reads each source's sphere once. A large count runs on
//! the job workers: each thread counts its chunks of sources into a tally of its own, and the
//! tallies add up to each view's counts, the same whatever thread counted which source.

use null3d_core::cells::CellPosition;
use null3d_core::culling::{Frustum, NO_BUCKET, RowRanges, batch_ranges, row_center};
use null3d_core::handle::Handle;
use null3d_core::instances::BatchTable;
use null3d_core::jobs::JobSystem;
use null3d_core::levels::{DrawRange, LevelRule, NO_LINK, Picked};
use null3d_core::scene::SceneStorage;
use null3d_core::shared::SharedMut;
use null3d_core::world::{MATRIX_FLOATS, UNBOUNDED_RADIUS};

use super::layout::{
    BUCKET_WORDS, CANDIDATE_WORDS, FIXED, INDEX_ENTRIES_PER_COPY, Layout, SLOT_CANDIDATES,
    slot_candidate_words,
};
use crate::frame::{CellOffsets, RecordError};
use crate::levels::{StageWatches, key_level};
use crate::pieces::CopyFrame;

/// How far from a switch distance a source counts toward both levels that it may pick, as a share
/// of the distance. It dwarfs the difference that a CPU and a GPU can make of the same distance,
/// and only the sources at a switch count twice. A view that counts by its frustum grows each
/// sphere by the same share, so a source at the frustum's edge counts.
const SLACK: f32 = 1.0e-3;

/// The sources that one job of the count takes: enough to outweigh handing the job out, and few
/// enough that the threads share a large layout evenly.
const SOURCES_PER_CHUNK: u32 = 1024;

/// The words of each thread's tally, rounded up to a whole number of cache lines' words, so that
/// two neighboring tallies share at most one line.
fn tally_stride(buckets: usize) -> usize {
    buckets.next_multiple_of(TALLY_LINE)
}

/// The words of a cache line, which each thread's tally takes a whole number of.
const TALLY_LINE: usize = 16;

/// The frames in a row that a level's bucket must hold no copy before the views' bundles leave its
/// draws out. A copy that picks the level draws it again at once; the wait spares the bundles from
/// being recorded again in every frame while a copy wavers at a switch.
pub(super) const IDLE_FRAMES: u16 = 30;

/// The room that a level's slice takes when `count` copies outgrow it. A slice keeps its place while
/// its count fits, so the spare room spares the frames from moving slices as the camera moves.
const fn with_spare_room(count: u32) -> u32 {
    count + count / 8
}

/// The source of an empty candidate.
const NO_CANDIDATE: u32 = u32::MAX;

/// The indices that a slot's room keeps beyond an eighth of what the pieces that show hold: a few
/// groups' worth, so that the rounding of the CPU's and the GPU's tests never cuts a triangle.
const SLOT_SPARE_INDICES: u32 = 3 * crate::pieces::MAX_GROUP_TRIANGLES * 3;

/// A view that draws a layout's buckets: the rule that picks its levels of detail, the camera
/// that its instances are placed relative to, and the frustum that bounds what it counts.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct CopyView {
    /// The view's rule for picking levels.
    pub rule: LevelRule,
    /// The camera that the view places its instances relative to.
    pub camera: CellPosition,
    /// The frustum, relative to the camera, outside which the view counts no source, or `None` to
    /// count every source.
    pub frustum: Option<Frustum>,
}

/// Keeps `source` among the nearest [`SLOT_CANDIDATES`] copies of slot level `level` in
/// `candidates`, which holds each level's candidates in distance order.
fn insert_candidate(candidates: &mut [u32], level: usize, distance: f32, source: u32) {
    let at = level * SLOT_CANDIDATES * CANDIDATE_WORDS;
    let bits = distance.to_bits();
    let mut place = SLOT_CANDIDATES;
    for k in 0..SLOT_CANDIDATES {
        let entry = at + k * CANDIDATE_WORDS;
        if candidates[entry + 1] == NO_CANDIDATE {
            place = k;
            break;
        }
        if candidates[entry + 1] == source {
            return;
        }
        if bits < candidates[entry] {
            place = k;
            break;
        }
    }
    if place == SLOT_CANDIDATES {
        return;
    }
    for k in (place + 1..SLOT_CANDIDATES).rev() {
        let entry = at + k * CANDIDATE_WORDS;
        candidates[entry] = candidates[entry - CANDIDATE_WORDS];
        candidates[entry + 1] = candidates[entry - CANDIDATE_WORDS + 1];
    }
    let entry = at + place * CANDIDATE_WORDS;
    candidates[entry] = bits;
    candidates[entry + 1] = source;
}

/// The words of a bucket's record that hold its capacity, the last one.
const BUCKET_CAPACITY_WORD: usize = BUCKET_WORDS as usize - 1;

impl Layout {
    /// Returns whether the slots' records changed since the last call.
    pub(super) fn take_slot_records_dirty(&mut self) -> bool {
        std::mem::take(&mut self.slot_records_dirty)
    }

    /// Returns whether a level's slice moved since the last call.
    pub(super) fn take_slices_moved(&mut self) -> bool {
        std::mem::take(&mut self.slices_moved)
    }

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

    /// True when a bucket of the layout draws `mesh` at some level or draws its tree of cluster
    /// patches: a source of the mesh exists in the scene, whatever the view shows. A staged band's
    /// warm-up counts the frames that drew the tree, as a staged level's counts those that drew
    /// the level.
    fn draws_mesh(&self, mesh: u32) -> bool {
        self.level_buckets
            .iter()
            .any(|&bucket| key_level(self.buckets[bucket as usize].mesh_key).0 == mesh)
            || self.clusters.iter().any(|cluster| cluster.mesh == mesh)
    }

    /// Counts the copies that `views` place in each bucket, and gives each bucket a slice of that
    /// size in every view's compacted instance buffer, with the buckets of one level set packed
    /// together. Marks the records of the buckets whose slices moved for the frame's one table
    /// upload. A layout whose buckets take no level, and one that no view draws, keeps its slices.
    /// The sets whose slices hold every source of the set count only with `count_fixed`, and keep
    /// their slices' size. Counts on `jobs`' threads. Allocates nothing once the working lists
    /// have their room.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn fit_copies(
        &mut self,
        scene: &SceneStorage,
        batches: &BatchTable,
        views: &[CopyView],
        parity: usize,
        offsets: &mut CellOffsets,
        jobs: &JobSystem,
        count_fixed: bool,
        slot_view: bool,
    ) -> Result<(), RecordError> {
        let nothing_counted = self.level_sources.is_empty() && !count_fixed;
        if !self.picks_levels() || views.is_empty() || (self.slices_placed && nothing_counted) {
            return Ok(());
        }
        let buckets = self.buckets.len();
        let mut tallies = std::mem::take(&mut self.copy_tallies);
        let mut fits = std::mem::take(&mut self.copy_fits);
        let mut candidates = std::mem::take(&mut self.slot_candidates);
        fits.clear();
        fits.resize(buckets, 0);
        // The views that place their instances relative to one camera, as the shadow views do,
        // count in one pass, which reads each source's sphere once for all of them.
        let mut start = 0;
        while let Some(first) = views.get(start) {
            let shared = views[start..]
                .iter()
                .take_while(|view| view.camera == first.camera)
                .count();
            offsets.update(scene, &first.camera);
            let fixed = if count_fixed {
                &self.fixed_sources[..]
            } else {
                &[]
            };
            for (index, sources) in [&self.level_sources[..], fixed].into_iter().enumerate() {
                if sources.is_empty() {
                    continue;
                }
                // The slots draw for the camera's own view, which the first group holds, and only
                // for the sources that a level's buckets take.
                let counted_for_slots = slot_view && start == 0 && index == 0;
                self.count_views(
                    scene,
                    batches,
                    &views[start..start + shared],
                    sources,
                    parity,
                    offsets.as_slice(),
                    &mut tallies,
                    &mut fits,
                    jobs,
                    counted_for_slots.then_some(&mut candidates),
                );
            }
            start += shared;
        }
        self.slot_candidates = candidates;
        // The slots take the nearest copies that the count kept, with the room that the pieces
        // showing for each copy need in the view's list.
        if let Some(view) = views.first().filter(|_| slot_view) {
            offsets.update(scene, &view.camera);
            self.assign_slots(scene, batches, parity, offsets.as_slice(), view, &mut fits);
        }
        self.copy_counts.clear();
        self.copy_counts.extend_from_slice(&fits);
        // A set whose slices hold every source of the set keeps them as the build sized them.
        for &bucket in &self.level_buckets {
            let b = bucket as usize;
            if self.marks[b] == FIXED {
                fits[b] = self.buckets[b].capacity;
            }
        }
        // A level that no view places a copy in draws nothing, so its draws and its pieces' wait
        // out of the bundles, which the frame records again when that changes.
        if self.note_idle(&fits) {
            self.slices_moved = true;
        }
        // Each piece's slice holds every copy that picks its bucket, whichever pieces it shows.
        for &bucket in &self.level_buckets {
            if let Some((first, count)) = self.buckets[bucket as usize].pieces {
                let fit = fits[bucket as usize];
                fits[first as usize..(first + count) as usize].fill(fit);
            }
        }
        // A view's bundle and its buffer name the slices, so slices stay where they are while each
        // count fits. A new layout places them from its counts, and a count that outgrows its slice
        // moves them, which the frame answers by recording the bundles and sizing the buffers again.
        let placed = self.slices_placed;
        let fits_now = placed
            && self
                .level_buckets
                .iter()
                .all(|&b| fits[b as usize] <= self.buckets[b as usize].capacity);
        if !fits_now {
            for &b in &self.level_buckets {
                let (b, fit) = (b as usize, &mut fits[b as usize]);
                let capacity = self.buckets[b].capacity;
                if placed {
                    *fit = if *fit <= capacity {
                        capacity
                    } else {
                        with_spare_room(*fit)
                    };
                }
            }
            self.place_slices(&fits);
            self.slices_placed = true;
            self.slices_moved = true;
        }
        self.copy_tallies = tallies;
        self.copy_fits = fits;
        Ok(())
    }

    /// Notes which buckets of a level hold no copy, by the largest count of any view in `fits`: a
    /// level's bucket that held none for [`IDLE_FRAMES`] frames in a row turns idle, with its
    /// pieces, and one that holds a copy draws again at once. Returns true when a bucket turned
    /// idle or drew again, so the views' bundles must be recorded again. A piece's own count is 0,
    /// since the shader appends a copy to a piece after it picks the piece's level, so a piece
    /// follows the bucket that it is a piece of.
    pub(super) fn note_idle(&mut self, fits: &[u32]) -> bool {
        let buckets = self.buckets.len();
        self.idle.resize(buckets, false);
        self.idle_frames.resize(buckets, 0);
        let mut changed = false;
        for &bucket in &self.level_buckets {
            // A piece follows the level that it draws, so its own count says nothing. A set that no
            // frame counts draws each of its levels.
            if self.buckets[bucket as usize].cone.is_some() || self.marks[bucket as usize] == FIXED
            {
                continue;
            }
            let b = bucket as usize;
            let pieces = self.buckets[b].pieces;
            let frames = &mut self.idle_frames[b];
            *frames = if fits[b] == 0 {
                frames.saturating_add(1).min(IDLE_FRAMES)
            } else {
                0
            };
            let idle = *frames >= IDLE_FRAMES;
            changed |= self.idle[b] != idle;
            self.idle[b] = idle;
            if let Some((first, count)) = pieces {
                for piece in &mut self.idle[first as usize..(first + count) as usize] {
                    changed |= *piece != idle;
                    *piece = idle;
                }
            }
        }
        changed
    }

    /// Counts the copies that each of `views`, which share one camera, places of `sources` in each
    /// bucket of the layout, and raises each level bucket's count in `fits` to the largest. Each
    /// of `jobs`'
    /// threads that runs a chunk counts into a tally of its own in `tallies`: a count for each
    /// view, then a word that marks the tally as begun, so a thread that runs no chunk costs
    /// neither a clear nor a sum.
    #[allow(clippy::too_many_arguments)]
    fn count_views(
        &self,
        scene: &SceneStorage,
        batches: &BatchTable,
        views: &[CopyView],
        sources: &[u32],
        parity: usize,
        cells: &[[f32; 4]],
        tallies: &mut Vec<u32>,
        fits: &mut [u32],
        jobs: &JobSystem,
        slot_candidates: Option<&mut Vec<u32>>,
    ) {
        let stride = tally_stride(self.buckets.len());
        let slots = slot_candidate_words(self.slot_levels.len());
        let area = stride + slots;
        let begun_at = area * views.len();
        let width = begun_at + TALLY_LINE;
        let threads = jobs.thread_count() as usize;
        tallies.resize(width * threads, 0);
        for thread in 0..threads {
            tallies[thread * width + begun_at] = 0;
        }
        let shared = SharedMut::new(tallies);
        jobs.parallel_for(sources.len() as u32, SOURCES_PER_CHUNK, &|chunk, worker| {
            // SAFETY: each thread writes only the tally of its own worker id, which is below
            // the thread count that sized the tallies, and a thread runs one chunk at a time.
            let tally = unsafe { shared.slice(worker.index() * width, width) };
            if tally[begun_at] == 0 {
                tally[..begun_at].fill(0);
                for view in 0..views.len() {
                    tally[view * area + stride..(view + 1) * area].fill(NO_CANDIDATE);
                }
                tally[begun_at] = 1;
            }
            let chunk = &sources[chunk.start as usize..chunk.end as usize];
            self.count_sources(
                scene,
                batches,
                views,
                parity,
                cells,
                chunk,
                tally,
                area,
                stride,
                slot_candidates.is_some(),
            );
        });
        let begun = |thread: &usize| tallies[thread * width + begun_at] != 0;
        let Some(first) = (0..threads).find(begun) else {
            return;
        };
        let sum = first * width;
        for other in first + 1..threads {
            if tallies[other * width + begun_at] == 0 {
                continue;
            }
            let other = other * width;
            for view in 0..views.len() {
                let (into, from) = (sum + view * area, other + view * area);
                for &bucket in &self.level_buckets {
                    tallies[into + bucket as usize] += tallies[from + bucket as usize];
                }
                // The slot candidates merge as sorted lists: each of the other thread's copies
                // takes its place among the nearest of this one.
                for level in 0..self.slot_levels.len() {
                    for k in 0..SLOT_CANDIDATES {
                        let at = from + stride + (level * SLOT_CANDIDATES + k) * CANDIDATE_WORDS;
                        let source = tallies[at + 1];
                        if source == NO_CANDIDATE {
                            continue;
                        }
                        let distance = f32::from_bits(tallies[at]);
                        insert_candidate(
                            &mut tallies[into + stride..into + area],
                            level,
                            distance,
                            source,
                        );
                    }
                }
            }
        }
        for view in 0..views.len() {
            let counts = &tallies[sum + view * area..sum + (view + 1) * area];
            for &bucket in &self.level_buckets {
                let fit = &mut fits[bucket as usize];
                *fit = (*fit).max(counts[bucket as usize]);
            }
        }
        if let Some(candidates) = slot_candidates {
            candidates.clear();
            candidates.extend_from_slice(&tallies[sum + stride..sum + area]);
        }
    }

    /// Counts the copies that each of `views` places of `sources`, by their index in the layout's
    /// tables in ascending order, into `tally`, which holds each view's counts `stride` words
    /// apart.
    #[allow(clippy::too_many_arguments)]
    fn count_sources(
        &self,
        scene: &SceneStorage,
        batches: &BatchTable,
        views: &[CopyView],
        parity: usize,
        cells: &[[f32; 4]],
        sources: &[u32],
        tally: &mut [u32],
        area: usize,
        stride: usize,
        slot_view: bool,
    ) {
        let scene_end = sources.partition_point(|&source| source < self.scene_rows);
        let (slots_part, rows_part) = sources.split_at(scene_end);
        if !slots_part.is_empty() {
            let spheres = scene.world(parity).spheres();
            let slots = scene.cells();
            let radii = scene.local_radii();
            let biases = scene.level_biases();
            let ranges = RowRanges::Rows(scene.draw_ranges());
            for &source in slots_part {
                let source = source as usize;
                let home = self.cull_buckets[source];
                if home == NO_BUCKET || self.marks[home as usize] == 0 {
                    continue;
                }
                let center = row_center(&spheres, slots[source], cells, source);
                let (radius, local, bias) = (spheres.radii[source], radii[source], biases[source]);
                let range = ranges.range(source);
                for (view, counts) in views.iter().zip(tally.chunks_exact_mut(area)) {
                    let (counts, candidates) = counts.split_at_mut(stride);
                    let slot = slot_view.then_some((candidates, source as u32));
                    self.count_source(
                        counts, slot, view, home, center, radius, local, bias, range, false,
                    );
                }
            }
        }
        if rows_part.is_empty() {
            return;
        }
        for &(id, first) in &self.batch_bases {
            let Ok(batch) = batches.get(Handle::from_raw(id)) else {
                continue;
            };
            let end = first + batch.capacity();
            let low = rows_part.partition_point(|&source| source < first);
            let high = rows_part.partition_point(|&source| source < end);
            if low >= high {
                continue;
            }
            let first = first as usize;
            let spheres = batch.world(parity).spheres();
            let local = batch.local_radius();
            let batch_cells = batch.cells();
            let ranges = batch_ranges(batches, batch);
            for &source in &rows_part[low..high] {
                let source = source as usize;
                let home = self.cull_buckets[source];
                if home == NO_BUCKET || self.marks[home as usize] == 0 {
                    continue;
                }
                let row = source - first;
                let center = row_center(&spheres, batch_cells[row], cells, row);
                // A batch's rows carry the batch's own radius, which the culling shader tests
                // around each row in place of its bucket's sphere.
                let (radius, range) = (spheres.radii[row], ranges.range(row));
                for (view, counts) in views.iter().zip(tally.chunks_exact_mut(area)) {
                    let (counts, candidates) = counts.split_at_mut(stride);
                    let slot = slot_view.then_some((candidates, source as u32));
                    self.count_source(
                        counts, slot, view, home, center, radius, local, 1.0, range, true,
                    );
                }
            }
        }
    }

    /// Counts one source's copies: the buckets of base bucket `home` that `view`'s rule may place
    /// it in, for a source whose world bounding sphere is at `center` relative to the camera, with
    /// the world radius `radius`, the local radius `local` and the threshold `bias`. `own` is true
    /// for a source that carries a bound of its own, as a batch whose rows move do, and false for
    /// one that tests its bucket's sphere. A view with a frustum counts nothing for a source
    /// outside it.
    #[allow(clippy::too_many_arguments)]
    fn count_source(
        &self,
        counts: &mut [u32],
        slot: Option<(&mut [u32], u32)>,
        view: &CopyView,
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
        let [x, y, z] = center;
        if view.frustum.is_some_and(|frustum| {
            !frustum.contains_sphere(x, y, z, radius * (1.0 + SLACK) + SLACK)
        }) {
            return;
        }
        let rule = view.rule;
        let distance = rule.distances(center, radius);
        // A source at a switch distance counts toward both levels, and one inside a band toward
        // both levels' fade buckets, so the slices hold whatever the shader picks. One walk of the
        // source's levels picks at both edges of the slack.
        let mut picked = [u32::MAX; 4];
        let mut len = 0;
        let edges = rule.pick_both(
            &self.level_links,
            home,
            scale,
            radius,
            distance.scaled(1.0 - SLACK),
            distance.scaled(1.0 + SLACK),
            bias,
            range,
        );
        // A copy inside a fading band or at a switch between levels draws two levels, so it may
        // draw a level other than the one a slot was given.
        let mut settled = true;
        for edge in edges {
            let mut keep = |bucket: u32| {
                if len < picked.len() && !picked[..len].contains(&bucket) {
                    picked[len] = bucket;
                    len += 1;
                }
            };
            match edge {
                Picked::One(bucket) => keep(bucket),
                Picked::Fade { new, old, .. } => {
                    settled = false;
                    keep(new);
                    keep(old);
                }
                Picked::FadeIn { bucket, .. } => {
                    settled = false;
                    keep(bucket);
                }
                Picked::FadeOut { old, .. } => {
                    settled = false;
                    keep(old);
                }
                // A levels debug view draws a hidden source at its base level, marked with the
                // hidden bit, so the home bucket's slice holds it.
                Picked::Hidden if self.codes => {
                    settled = false;
                    keep(home);
                }
                Picked::Hidden => settled = false,
            }
        }
        for &bucket in &picked[..len] {
            counts[bucket as usize] += 1;
        }
        // A copy that picks one level of a set with slots, away from a switch, offers itself to
        // that level's slot: the nearest few of each level take them.
        let Some((candidates, source)) = slot else {
            return;
        };
        if !settled || len != 1 {
            return;
        }
        let Some(&level) = self
            .slot_level_of
            .get(picked[0] as usize)
            .filter(|&&level| level != super::layout::NO_SLOT_LEVEL)
        else {
            return;
        };
        let level = level as usize;
        let nearest = ((center[0] * center[0] + center[1] * center[1] + center[2] * center[2])
            .sqrt()
            - radius)
            .max(0.0);
        insert_candidate(candidates, level, nearest, source);
    }

    /// The rows of the world matrix of `source`, moved by its cell's offset from the view's
    /// camera, or `None` for a source that no row holds.
    fn copy_rows(
        &self,
        scene: &SceneStorage,
        batches: &BatchTable,
        parity: usize,
        cells: &[[f32; 4]],
        source: u32,
    ) -> Option<[[f32; 4]; 3]> {
        let source = source as usize;
        let (matrices, at, cell) = if source < self.scene_rows as usize {
            let matrices = scene.world(parity).matrices();
            (
                matrices,
                source,
                scene.cells().get(source).copied().unwrap_or(0),
            )
        } else {
            let mut found = None;
            for &(id, first) in &self.batch_bases {
                if source < first as usize {
                    break;
                }
                let Ok(batch) = batches.get(Handle::from_raw(id)) else {
                    continue;
                };
                let row = source - first as usize;
                if row < batch.capacity() as usize {
                    let cell = batch.cells().get(row).copied().unwrap_or(0);
                    found = Some((batch.world(parity).matrices(), row, cell));
                    break;
                }
            }
            found?
        };
        let m = matrices.get(at * MATRIX_FLOATS..(at + 1) * MATRIX_FLOATS)?;
        let offset = cells.get(cell as usize).copied().unwrap_or([0.0; 4]);
        Some([
            [m[0], m[1], m[2], m[3] + offset[0]],
            [m[4], m[5], m[6], m[7] + offset[1]],
            [m[8], m[9], m[10], m[11] + offset[2]],
        ])
    }

    /// Gives each slot level's nearest copies its slots, and sizes each slot's room in the view's
    /// list to the triangles of the pieces that show for that copy, with room to spare. A slot
    /// that the pick left empty takes no copy, and a copy whose level the culling pass picks
    /// another way draws through its pieces, so the picture stays right. Marks every slot whose
    /// record's copy changed for the frame's one table upload.
    #[allow(clippy::too_many_arguments)]
    fn assign_slots(
        &mut self,
        scene: &SceneStorage,
        batches: &BatchTable,
        parity: usize,
        cells: &[[f32; 4]],
        view: &CopyView,
        fits: &mut [u32],
    ) {
        if self.slot_levels.is_empty() {
            return;
        }
        for level in 0..self.slot_levels.len() {
            let slot_level = self.slot_levels[level];
            for k in 0..slot_level.slots as usize {
                let slot = slot_level.first_slot as usize + k;
                let bucket = self.slot_buckets[slot] as usize;
                let at = level * SLOT_CANDIDATES * CANDIDATE_WORDS + k * CANDIDATE_WORDS;
                let source = self
                    .slot_candidates
                    .get(at + 1)
                    .copied()
                    .unwrap_or(u32::MAX);
                let room = if source == u32::MAX {
                    0
                } else {
                    let pieces = &self.slot_pieces[slot_level.first_piece as usize
                        ..(slot_level.first_piece + slot_level.piece_count) as usize];
                    let triangles: u32 = self
                        .copy_rows(scene, batches, parity, cells, source)
                        .map_or_else(
                            || pieces.iter().map(|piece| piece.triangles).sum(),
                            |rows| {
                                let frame = CopyFrame::new(rows);
                                let cone = view.frustum.is_some();
                                pieces
                                    .iter()
                                    .filter(|piece| {
                                        view.frustum.is_none_or(|frustum| {
                                            frame.shows(&frustum, piece, cone)
                                        })
                                    })
                                    .map(|piece| piece.triangles)
                                    .sum()
                            },
                        );
                    let indices = triangles.saturating_mul(3);
                    indices
                        .saturating_add(indices / 8)
                        .saturating_add(SLOT_SPARE_INDICES)
                };
                self.slot_records_dirty |= self.slot_room[slot] != room;
                self.slot_room[slot] = room;
                fits[bucket] = u32::from(room > 0);
                let copy = if room > 0 { source + 1 } else { 0 };
                if self.buckets[bucket].slot_copy != copy {
                    self.buckets[bucket].slot_copy = copy;
                    self.mark_records(bucket as u32..bucket as u32 + 1);
                    self.slot_records_dirty = true;
                }
            }
        }
    }

    /// Counts a source toward every bucket of its set, for a source whose level this count cannot
    /// place.
    fn count_chain(&self, counts: &mut [u32], home: u32) {
        let mut bucket = home;
        loop {
            counts[bucket as usize] += 1;
            let link = self.level_links[bucket as usize];
            // A levels debug view's fade link names the level's own bucket, which this counts
            // already.
            if link.fade != NO_LINK && link.fade != bucket {
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
        self.slot_records_dirty |= !self.slot_buckets.is_empty();
        // A view's index entries follow its copies, so their bases count entries from the
        // buffer's start.
        let copied = self.copied;
        for (index, bucket) in self.buckets.iter_mut().enumerate() {
            if bucket.indexed {
                bucket.base += copied * INDEX_ENTRIES_PER_COPY;
            }
            self.bucket_records[index * BUCKET_WORDS as usize] = bucket.base;
            self.bucket_records[index * BUCKET_WORDS as usize + BUCKET_CAPACITY_WORD] =
                bucket.capacity;
            // A tree's record names its one copy's place in the view's compacted instances, which
            // the cluster pass reads, so it follows its bucket's slice. The plain buckets come
            // before the levels' here, unlike in the build's order, so a plain bucket moves too.
            if let Some(tree) = bucket.cluster {
                self.clusters[tree as usize].slot = bucket.base;
            }
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

    /// The groups of a piece nest in it: a group's sphere and cone lie inside its piece's, so a
    /// group whose bounds show for a copy lies in a piece that shows too. The slot pass tests the
    /// piece first and then the group, so the groups that a slot keeps never pass the pieces that
    /// the CPU sized its room from: no overflow, whatever the copy's place and turn.
    #[test]
    fn the_groups_of_a_piece_nest_in_it() {
        use crate::pieces::{CopyFrame, Piece};
        use null3d_core::culling::Frustum;
        let frustum = Frustum::from_planes([
            [1.0, 0.0, 0.0, 30.0],
            [-1.0, 0.0, 0.0, 30.0],
            [0.0, 1.0, 0.0, 20.0],
            [0.0, -1.0, 0.0, 20.0],
            [0.0, 0.0, 1.0, 40.0],
            [0.0, 0.0, -1.0, 40.0],
        ]);
        // A piece of radius 2 around its centre, with a cone that drops half its facings, and
        // groups of radius 1 inside it with the same cutoff.
        let piece = Piece {
            triangles: 4_096,
            sphere: [0.0, 0.0, 0.0, 2.0],
            cone: [0.0, 0.0, 1.0, 0.5],
        };
        let group = |k: usize| Piece {
            triangles: 64,
            sphere: [
                ((k % 5) as f32 - 2.0) * 0.3,
                ((k / 5 % 5) as f32 - 2.0) * 0.3,
                ((k / 25) % 5) as f32 * 0.3,
                0.4,
            ],
            cone: [0.0, 0.0, 1.0, 0.5],
        };
        let groups: Vec<Piece> = (0..125).map(group).collect();
        let mut seed = 0x2545_f491u32;
        let mut next = || {
            seed ^= seed << 13;
            seed ^= seed >> 17;
            seed ^= seed << 5;
            (seed as f32 / u32::MAX as f32) * 2.0 - 1.0
        };
        for _ in 0..2_000 {
            let angle = next() * std::f32::consts::PI;
            let (s, c) = angle.sin_cos();
            let other = next() * std::f32::consts::PI;
            let (s2, c2) = other.sin_cos();
            let scale = 0.2 + next().abs() * 2.0;
            // A turn about z, then about y, and a place within the frustum.
            let rows = [
                [c * s2 * scale, -s * scale, c * c2 * scale, next() * 10.0],
                [s * s2 * scale, c * scale, s * c2 * scale, next() * 10.0],
                [c2 * scale, 0.0, -s2 * scale, next() * 20.0],
            ];
            let frame = CopyFrame::new(rows);
            let cone = true;
            let shows_piece = frame.shows(&frustum, &piece, cone);
            let shows_any = groups
                .iter()
                .any(|group| frame.shows(&frustum, group, cone));
            assert!(
                !shows_any || shows_piece,
                "a group showed where its piece did not"
            );
        }
    }

    /// Both shaders read the bucket records as an array, so a structure of another length reads
    /// every record after the first at the wrong place.
    #[test]
    fn each_shader_reads_a_bucket_record_at_its_stride() {
        let words = |text: &str, name: &str| {
            let start = text
                .find(&format!("struct {name} {{"))
                .expect("the structure");
            let body = &text[start..text[start..].find("\n}").unwrap() + start];
            body.lines()
                .skip(1)
                .filter(|line| !line.trim_start().starts_with("//") && line.contains(':'))
                .count() as u32
        };
        let cull = include_str!("../../../null3d-shaders/wgsl/cull.wgsl");
        let mesh = include_str!("../../../null3d-shaders/wgsl/lib/mesh.wgsl");
        assert_eq!(words(cull, "Bucket"), BUCKET_WORDS);
        assert_eq!(words(mesh, "InstanceBucket"), BUCKET_WORDS);
    }

    #[test]
    fn a_level_slice_keeps_spare_room_past_its_count() {
        assert_eq!(with_spare_room(1), 1);
        assert_eq!(with_spare_room(1000), 1125);
    }

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
        let view = CopyView {
            rule: LevelRule::new(1000.0, 1.0, false, 1.0, 0.0),
            camera: CellPosition::default(),
            frustum: None,
        };
        let count = |own: bool| {
            let mut counts = [0u32; 2];
            layout.count_source(
                &mut counts,
                None,
                &view,
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
