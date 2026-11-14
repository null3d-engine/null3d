//! The table of object ranges, which the vertex shaders of custom materials read to find an
//! instance's index in its batch and its object's id (`object_ids` in `null3d::mesh`).
//!
//! The sources below the scene's rows are the scene's slots, so a scene object's id is its slot
//! and its index is 0. Each instance batch's rows follow in one range, which the table lists by
//! its first key with the batch's id. A key is a source on WebGPU. On WebGL2 it is a row of the
//! resident data texture, or a row of the streamed one with [`STREAMED_KEY`] set. The table is a
//! uniform block of [`sizes::OBJECT_RANGE_BYTES`]: a header of the scene's rows and the count of
//! ranges, then two ranges to each vector of four words. A scene of more batches than the table
//! holds ends it with a range whose rows read 0 for both.
//!
//! Builders fill it when the layout changes and a live material reads ids, so a page whose shaders
//! read none uploads nothing.

use null3d_core::handle::{Handle, SLOT_BITS};
use null3d_core::memory::{MemoryUse, vec_bytes};
use null3d_gpu::drawlist::sizes;

/// The bit of a key that marks a row of WebGL2's streamed data texture.
pub const STREAMED_KEY: u32 = 1 << 31;
/// The id of a range whose rows read 0 for their index and their id.
pub const NO_OBJECT: u32 = u32::MAX;
/// The bit of an id that marks an instance batch's, above every slot of the scene's objects, so
/// that batches and objects never share an id.
pub const BATCH_ID: u32 = 1 << SLOT_BITS;
/// Words of the table's header.
const HEADER_WORDS: usize = 4;
/// Words of one range: its first key and its id.
const RANGE_WORDS: usize = 2;
/// Words of the whole table.
const TABLE_WORDS: usize = sizes::OBJECT_RANGE_BYTES as usize / 4;
/// The most ranges that the table holds.
pub const MAX_RANGES: usize = (TABLE_WORDS - HEADER_WORDS) / RANGE_WORDS;

/// The id that shaders read for the rows of the instance batch with handle `batch`.
pub const fn batch_id(batch: Handle) -> u32 {
    BATCH_ID | batch.slot()
}

/// The table, as the builders upload it, with scratch space for its ranges.
#[derive(Debug, Default)]
pub struct ObjectRanges {
    /// The ranges of the last build, by first key.
    ranges: Vec<(u32, u32)>,
    /// The words of the table: as many as its ranges need, at most [`TABLE_WORDS`].
    words: Vec<u32>,
}

impl ObjectRanges {
    /// The bytes that the table and its scratch hold.
    pub fn memory_use(&self) -> MemoryUse {
        let mut use_ = MemoryUse::default();
        use_.add(vec_bytes(&self.ranges));
        use_.add(vec_bytes(&self.words));
        use_
    }

    /// Builds the table for a scene with `scene_rows` rows and the batches whose first keys and
    /// handles `batches` gives, in any order. The scratch space grows only with the scene.
    pub fn build(&mut self, scene_rows: u32, batches: impl IntoIterator<Item = (u32, Handle)>) {
        self.ranges.clear();
        self.ranges.extend(
            batches
                .into_iter()
                .map(|(first, batch)| (first, batch_id(batch))),
        );
        self.ranges.sort_unstable();
        if self.ranges.len() > MAX_RANGES {
            // The rows past the last range that fits read 0 for their index and their id.
            self.ranges.truncate(MAX_RANGES);
            if let Some(last) = self.ranges.last_mut() {
                last.1 = NO_OBJECT;
            }
        }
        self.words.clear();
        self.words
            .extend_from_slice(&[scene_rows, self.ranges.len() as u32, 0, 0]);
        for &(first, id) in &self.ranges {
            self.words.extend_from_slice(&[first, id]);
        }
        // Whole vectors, as the uniform block reads them.
        self.words.resize(self.words.len().next_multiple_of(4), 0);
    }

    /// The table's words: the header and every range of the last build.
    pub fn words(&self) -> &[u32] {
        &self.words
    }

    /// The table's bytes, for an upload.
    pub fn bytes(&self) -> &[u8] {
        // SAFETY: a `u32` slice reads as bytes, with no padding and every byte initialized.
        unsafe {
            std::slice::from_raw_parts(self.words.as_ptr().cast::<u8>(), self.words.len() * 4)
        }
    }

    /// The instance index and the id that a shader finds for `key`, as `object_ids` in
    /// `null3d::mesh` finds them, for tests.
    pub fn lookup(&self, key: u32) -> (u32, u32) {
        let scene_rows = self.words[0];
        if key < scene_rows {
            return (0, key);
        }
        let found = self.ranges.partition_point(|&(first, _)| first <= key);
        match found.checked_sub(1).map(|k| self.ranges[k]) {
            Some((_, NO_OBJECT)) | None => (0, 0),
            Some((first, id)) => (key - first, id),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn handle(slot: u32) -> Handle {
        Handle::new(slot, 1)
    }

    #[test]
    fn objects_read_their_slot_and_rows_their_place_in_their_batch() {
        let mut table = ObjectRanges::default();
        table.build(10, [(14, handle(3)), (10, handle(2))]);
        assert_eq!(table.words()[..4], [10, 2, 0, 0]);
        assert_eq!(table.lookup(7), (0, 7));
        assert_eq!(table.lookup(10), (0, BATCH_ID | 2));
        assert_eq!(table.lookup(13), (3, BATCH_ID | 2));
        assert_eq!(table.lookup(20), (6, BATCH_ID | 3));
        assert_eq!(table.words().len() % 4, 0);
    }

    #[test]
    fn streamed_rows_have_keys_of_their_own() {
        let mut table = ObjectRanges::default();
        table.build(4, [(STREAMED_KEY, handle(5)), (4, handle(6))]);
        assert_eq!(table.lookup(STREAMED_KEY + 2), (2, BATCH_ID | 5));
        assert_eq!(table.lookup(5), (1, BATCH_ID | 6));
    }

    #[test]
    fn rows_past_a_full_table_read_zeros() {
        let mut table = ObjectRanges::default();
        let count = MAX_RANGES as u32 + 3;
        table.build(1, (0..count).map(|k| (1 + k * 2, handle(k + 1))));
        assert_eq!(table.words().len(), TABLE_WORDS);
        assert_eq!(table.lookup(1), (0, BATCH_ID | 1));
        assert_eq!(table.lookup(1 + count * 2 - 1), (0, 0));
    }
}
