//! Draws of an add-on feature whose instance count the GPU writes (D-173, hook H2). A draw names
//! the scene object that places it, the most instances that it may draw, and the count that a page
//! without compute sets. The draw's own per-instance buffer belongs to the add-on's compute pass,
//! and the count word is the add-on's to write each frame.
//!
//! The layout gives such an object a bucket of its own, which the culling shader never visits, so
//! the count stays whatever the add-on's feature wrote. The frame copies each draw's count word
//! into the instance count of the bucket's indirect draws before the pass that draws it, in the
//! camera's view and in every shadow view: an instance that the GPU counts casts its shadow by that
//! same count (D-241).
//!
//! A draw whose feature reports itself not ready records nothing at all: no draw in any view, no
//! count copy and no conversion, which is the no-cost promise that a feature's `ready` callback
//! makes. The layout is built again when that answer changes.
//!
//! The table holds no GPU object: the renderer makes the add-on's instance and count buffers from
//! the ids that a draw's place in this table names.

use std::collections::TryReserveError;

/// The most feature-instance draws that a scene holds at once.
pub const MAX_FEATURE_INSTANCES: u32 = 64;

/// Floats of one instance that the page writes: the three rows of its world matrix and its ids,
/// as the engine's instance buffers hold them.
pub const INSTANCE_FLOATS: u32 = 16;

/// Bytes of one instance in the add-on's buffer, as the compacted instance buffer holds it.
pub const INSTANCE_BYTES: u32 = INSTANCE_FLOATS * size_of::<f32>() as u32;

/// Bytes of a draw's count word.
pub const COUNT_BYTES: u32 = 4;

/// The most instances that a draw may hold, which bounds its buffer's bytes.
pub const MAX_CAPACITY: u32 = 1 << 20;

/// One draw: the scene object that places it, its capacity and its CPU count.
#[derive(Clone, Debug)]
struct FeatureInstance {
    /// The scene slot of the object that places the draw.
    slot: u32,
    /// The most instances that the draw may hold.
    capacity: u32,
    /// The count that a page without compute sets, which the count word starts each frame from.
    count: u32,
    /// The per-instance rows that the page wrote, or empty before its first write.
    rows: Vec<f32>,
    /// The number of rows from the start that the page has written.
    written: u32,
    /// The first row and the row count that the next frame uploads, or `None` when no row waits.
    changed: Option<(u32, u32)>,
    /// True while the add-on's feature says that it draws. A draw that is not ready records no
    /// draw, no conversion and no count copy, which is the no-cost promise of a feature's `ready`.
    ready: bool,
}

/// The scene's feature-instance draws, by id from 1.
#[derive(Debug, Default)]
pub struct FeatureInstanceTable {
    draws: Vec<Option<FeatureInstance>>,
    /// Each live draw's object slot and id, by slot.
    by_slot: Vec<(u32, u32)>,
    /// Steps each time a draw's readiness changes, so a frame knows that its layouts are stale.
    readiness: u64,
}

impl FeatureInstanceTable {
    /// Makes a draw of at most `capacity` instances for the object in scene slot `slot`, and
    /// returns its id, or 0 when the scene holds the most draws already.
    pub fn create(&mut self, slot: u32, capacity: u32) -> Result<u32, TryReserveError> {
        let capacity = capacity.clamp(1, MAX_CAPACITY);
        let free = self.draws.iter().position(Option::is_none);
        let index = match free {
            Some(index) => index,
            None if self.draws.len() < MAX_FEATURE_INSTANCES as usize => {
                self.draws.try_reserve(1)?;
                self.draws.push(None);
                self.draws.len() - 1
            }
            None => return Ok(0),
        };
        self.draws[index] = Some(FeatureInstance {
            slot,
            capacity,
            count: 0,
            rows: Vec::new(),
            written: 0,
            changed: None,
            ready: true,
        });
        let id = index as u32 + 1;
        // A slot whose object died with its draw still made takes the new draw. The old one keeps
        // its place until the page destroys it, but draws nothing.
        let at = self.by_slot.partition_point(|&(s, _)| s < slot);
        if self.by_slot.get(at).is_some_and(|&(s, _)| s == slot) {
            self.by_slot[at] = (slot, id);
        } else {
            self.by_slot.try_reserve(1)?;
            self.by_slot.insert(at, (slot, id));
        }
        Ok(id)
    }

    /// Forgets a draw. Its object draws nothing from then on.
    pub fn destroy(&mut self, id: u32) {
        if self.get(id).is_none() {
            return;
        }
        self.draws[id as usize - 1] = None;
        self.by_slot.retain(|&(_, i)| i != id);
    }

    /// Sets the count that a page without compute draws, which the count word starts each frame
    /// from. Returns false for no such draw.
    pub fn set_count(&mut self, id: u32, count: u32) -> bool {
        let Some(draw) = self.get_mut(id) else {
            return false;
        };
        draw.count = count.min(draw.capacity);
        true
    }

    /// Sets whether the add-on's feature draws now, and returns false for no such draw. A draw that
    /// is not ready takes no room in a view and draws nothing; the frame after the answer changes
    /// rebuilds its views, which steps [`Self::readiness`].
    pub fn set_ready(&mut self, id: u32, ready: bool) -> bool {
        let Some(draw) = self.get_mut(id) else {
            return false;
        };
        if draw.ready != ready {
            draw.ready = ready;
            self.readiness += 1;
        }
        true
    }

    /// True while the add-on's feature says that draw `id` draws, and false for no such draw.
    pub fn is_ready(&self, id: u32) -> bool {
        self.get(id).is_some_and(|draw| draw.ready)
    }

    /// The count of readiness changes, which tells a frame that its views must be built again.
    pub fn readiness(&self) -> u64 {
        self.readiness
    }

    /// Writes `count` per-instance rows from `values` at row `start`, as the page's own data. The
    /// next frame uploads them to the draw's per-instance buffer. Returns false for no such draw,
    /// and eats a write past the capacity.
    pub fn set_rows(&mut self, id: u32, values: &[f32], start: u32, count: u32) -> bool {
        let Some(draw) = self.get_mut(id) else {
            return false;
        };
        if count == 0 {
            return true;
        }
        let capacity = draw.capacity as usize;
        let end = (start as usize)
            .saturating_add(count as usize)
            .min(capacity);
        if start as usize >= end || values.len() < (count as usize) * INSTANCE_FLOATS as usize {
            return false;
        }
        let floats = capacity * INSTANCE_FLOATS as usize;
        if draw.rows.len() < floats {
            draw.rows.resize(floats, 0.0);
        }
        let from = start as usize * INSTANCE_FLOATS as usize;
        let take = (end - start as usize) * INSTANCE_FLOATS as usize;
        draw.rows[from..from + take].copy_from_slice(&values[..take]);
        draw.written = draw.written.max(end as u32);
        draw.changed = Some((start, (end - start as usize) as u32));
        true
    }

    /// The per-instance rows that the page wrote, or an empty slice before its first write.
    pub fn rows(&self, id: u32) -> &[f32] {
        self.get(id).map_or(&[], |draw| &draw.rows)
    }

    /// The first row and the row count that the next frame uploads, taken so that the frame after
    /// it uploads nothing.
    pub fn take_changed(&mut self, id: u32) -> Option<(u32, u32)> {
        self.get_mut(id).and_then(|draw| draw.changed.take())
    }

    /// Bytes that the next frame uploads: the live draws' rows that the page wrote since the frame
    /// before.
    pub fn pending_bytes(&self) -> usize {
        self.draws
            .iter()
            .flatten()
            .filter_map(|draw| draw.changed)
            .map(|(_, rows)| rows as usize * INSTANCE_BYTES as usize)
            .sum()
    }

    /// Marks every row that the page wrote for upload, so a buffer that the device made again
    /// gets them back.
    pub fn mark_all_changed(&mut self, id: u32) {
        let Some(draw) = self.get_mut(id) else {
            return;
        };
        if draw.written > 0 {
            draw.changed = Some((0, draw.written));
        }
    }

    /// The number of places the table holds, used or not.
    pub fn capacity(&self) -> usize {
        self.draws.len()
    }

    /// A draw's object slot, capacity and CPU count, or `None` for no such draw.
    pub fn record(&self, id: u32) -> Option<(u32, u32, u32)> {
        self.get(id)
            .map(|draw| (draw.slot, draw.capacity, draw.count))
    }

    /// The id of the draw whose object is in scene slot `slot`.
    pub fn id_of(&self, slot: u32) -> Option<u32> {
        let at = self.by_slot.partition_point(|&(s, _)| s < slot);
        self.by_slot
            .get(at)
            .filter(|&&(s, _)| s == slot)
            .map(|&(_, id)| id)
    }

    /// True when the scene holds no feature-instance draw.
    pub fn is_empty(&self) -> bool {
        self.by_slot.is_empty()
    }

    /// The live draws, as their ids and records.
    pub fn iter(&self) -> impl Iterator<Item = (u32, (u32, u32, u32))> + '_ {
        self.draws.iter().enumerate().filter_map(|(index, draw)| {
            draw.as_ref()
                .map(|draw| (index as u32 + 1, (draw.slot, draw.capacity, draw.count)))
        })
    }

    fn get(&self, id: u32) -> Option<&FeatureInstance> {
        self.draws.get((id as usize).wrapping_sub(1))?.as_ref()
    }

    fn get_mut(&mut self, id: u32) -> Option<&mut FeatureInstance> {
        self.draws.get_mut((id as usize).wrapping_sub(1))?.as_mut()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_draw_takes_a_free_place_and_a_slot_keeps_one_draw() {
        let mut table = FeatureInstanceTable::default();
        assert_eq!(table.create(3, 100).unwrap(), 1);
        assert_eq!(table.create(5, 20).unwrap(), 2);
        assert_eq!(table.id_of(3), Some(1));
        assert_eq!(table.id_of(5), Some(2));
        assert_eq!(table.id_of(4), None);
        // A second draw for the same slot replaces the slot's name, and the old draw draws nothing.
        assert_eq!(table.create(3, 7).unwrap(), 3);
        assert_eq!(table.id_of(3), Some(3));
        assert_eq!(table.record(1), Some((3, 100, 0)));
        table.destroy(3);
        assert_eq!(table.id_of(3), None);
        assert_eq!(table.id_of(5), Some(2));
    }

    #[test]
    fn a_count_stays_within_the_capacity() {
        let mut table = FeatureInstanceTable::default();
        let id = table.create(1, 10).unwrap();
        assert!(table.set_count(id, 4));
        assert_eq!(table.record(id), Some((1, 10, 4)));
        assert!(table.set_count(id, 40));
        assert_eq!(table.record(id), Some((1, 10, 10)));
        assert!(!table.set_count(99, 1));
    }

    #[test]
    fn a_made_buffer_uploads_the_rows_the_page_wrote() {
        let mut table = FeatureInstanceTable::default();
        let id = table.create(1, 8).unwrap();
        let values = vec![1.0; 3 * INSTANCE_FLOATS as usize];
        assert!(table.set_rows(id, &values, 0, 3));
        // The frame's first upload takes the change, and the frame after uploads nothing.
        assert_eq!(table.take_changed(id), Some((0, 3)));
        assert_eq!(table.take_changed(id), None);
        // A buffer that the device made again takes the rows that the page wrote, once more.
        table.mark_all_changed(id);
        assert_eq!(table.take_changed(id), Some((0, 3)));
        assert_eq!(table.take_changed(id), None);
    }

    #[test]
    fn the_table_refuses_more_draws_than_it_holds() {
        let mut table = FeatureInstanceTable::default();
        for slot in 0..MAX_FEATURE_INSTANCES {
            assert_ne!(table.create(slot, 1).unwrap(), 0);
        }
        assert_eq!(table.create(MAX_FEATURE_INSTANCES, 1).unwrap(), 0);
    }
}
