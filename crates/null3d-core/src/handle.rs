//! Handles and slots. A handle is a 30-bit integer: the slot index in the low 20 bits and a
//! generation in the next 10 bits. JavaScript engines store integers this small directly in the
//! value, so a handle never allocates on the TypeScript side.
//!
//! Slot 0 is never handed out, so handle 0 means "none". A slot keeps its index for the life of
//! its object, and destroying the object bumps the slot's generation, so an old handle to a reused
//! slot fails with [`CoreError::StaleHandle`]. The highest generation, [`DEAD_GENERATION`], is
//! never handed out: a destroyed object's wrapper keeps a handle with it, which stays stale however
//! often its slot is reused.

use std::collections::TryReserveError;

use crate::alloc::reserve_len;
use crate::bitset::Bitset;
use crate::error::{CoreError, Resource};

/// Bits of a handle that hold the slot index.
pub const SLOT_BITS: u32 = 20;
/// Bits of a handle that hold the generation.
pub const GENERATION_BITS: u32 = 10;
/// The largest slot count an allocator can have: every 20-bit index except 0.
pub const MAX_SLOTS: u32 = (1 << SLOT_BITS) - 1;
/// Freed slots wait in a first-in, first-out queue and are reused only once this many are
/// waiting, or when no fresh slot is left. While fresh slots remain, a slot's generation wraps only
/// after about a million destroys. Once a scene has used every slot, a slot comes back after as few
/// destroys as wait in the queue, so its generation can come round within minutes: only
/// [`DEAD_GENERATION`] keeps an old handle from matching a new object then.
pub const REUSE_DELAY: u32 = 1024;
/// The generation that no live object has, which marks the handle of a destroyed one.
pub const DEAD_GENERATION: u32 = GENERATION_MASK;

const SLOT_MASK: u32 = (1 << SLOT_BITS) - 1;
const GENERATION_MASK: u32 = (1 << GENERATION_BITS) - 1;
const HANDLE_MASK: u32 = (1 << (SLOT_BITS + GENERATION_BITS)) - 1;

/// A 30-bit handle: slot index and generation. `Handle::NONE` (0) names no object.
#[repr(transparent)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Handle(u32);

impl Handle {
    /// The handle that names no object.
    pub const NONE: Handle = Handle(0);

    /// Builds a handle from a slot and a generation. Bits past each field's width are dropped.
    pub const fn new(slot: u32, generation: u32) -> Handle {
        Handle((slot & SLOT_MASK) | ((generation & GENERATION_MASK) << SLOT_BITS))
    }

    /// Wraps a raw value, such as one TypeScript passed. [`SlotAllocator::resolve`] checks it.
    pub const fn from_raw(raw: u32) -> Handle {
        Handle(raw)
    }

    /// The raw 32-bit value.
    pub const fn raw(self) -> u32 {
        self.0
    }

    /// The slot index in the low 20 bits.
    pub const fn slot(self) -> u32 {
        self.0 & SLOT_MASK
    }

    /// The generation in bits 20 to 29.
    pub const fn generation(self) -> u32 {
        (self.0 >> SLOT_BITS) & GENERATION_MASK
    }

    /// True for [`Handle::NONE`].
    pub const fn is_none(self) -> bool {
        self.0 == 0
    }
}

/// Hands out slots and checks handles. Every array is allocated at creation, so no call
/// allocates afterwards.
#[derive(Clone, Debug)]
pub struct SlotAllocator {
    capacity: u32,
    generations: Vec<u16>,
    destroyed_frames: Vec<u32>,
    live: Bitset,
    free: Vec<u32>,
    free_head: u32,
    free_len: u32,
    fresh: u32,
    live_count: u32,
}

impl SlotAllocator {
    /// An allocator for slots 1 to `capacity`. Arrays indexed by slot need `capacity + 1` rows,
    /// because slot 0 is never used.
    ///
    /// # Panics
    /// When `capacity` is over [`MAX_SLOTS`].
    pub fn with_capacity(capacity: u32) -> Self {
        assert!(
            capacity <= MAX_SLOTS,
            "a slot allocator holds at most {MAX_SLOTS} slots, not {capacity}"
        );
        let rows = capacity as usize + 1;
        Self {
            capacity,
            generations: vec![0; rows],
            destroyed_frames: vec![0; rows],
            live: Bitset::new(capacity + 1),
            free: vec![0; capacity as usize],
            free_head: 0,
            free_len: 0,
            fresh: 1,
            live_count: 0,
        }
    }

    /// Makes room for `capacity` slots without changing the allocator, so [`SlotAllocator::grow`]
    /// to `capacity` cannot fail.
    pub fn try_reserve(&mut self, capacity: u32) -> Result<(), TryReserveError> {
        let rows = capacity as usize + 1;
        reserve_len(&mut self.generations, rows)?;
        reserve_len(&mut self.destroyed_frames, rows)?;
        self.live.try_reserve(capacity + 1)?;
        reserve_len(&mut self.free, capacity as usize)
    }

    /// Raises the slot count to `capacity`. Live handles, generations and the order in which
    /// freed slots come back all stay as they were; the new slots are fresh.
    ///
    /// # Panics
    /// When `capacity` is over [`MAX_SLOTS`].
    pub fn grow(&mut self, capacity: u32) {
        assert!(
            capacity <= MAX_SLOTS,
            "a slot allocator holds at most {MAX_SLOTS} slots, not {capacity}"
        );
        if capacity <= self.capacity {
            return;
        }
        let rows = capacity as usize + 1;
        self.generations.resize(rows, 0);
        self.destroyed_frames.resize(rows, 0);
        self.live.grow(capacity + 1);
        // The freed slots wrap around the old queue's end; the larger queue starts them at 0.
        self.free.rotate_left(self.free_head as usize);
        self.free.resize(capacity as usize, 0);
        self.free_head = 0;
        self.capacity = capacity;
    }

    /// The number of usable slots.
    pub fn capacity(&self) -> u32 {
        self.capacity
    }

    /// The number of reserved slots.
    pub fn live_count(&self) -> u32 {
        self.live_count
    }

    /// One past the highest slot ever handed out. Loops over slots can stop here.
    pub fn high_water(&self) -> u32 {
        self.fresh
    }

    /// Reserves a slot and returns its handle. Freed slots are reused in the order they were
    /// freed, once [`REUSE_DELAY`] of them are waiting or no fresh slot is left.
    pub fn reserve(&mut self) -> Result<Handle, CoreError> {
        let fresh_left = self.fresh <= self.capacity;
        let slot = if self.free_len > 0 && (self.free_len >= REUSE_DELAY || !fresh_left) {
            let slot = self.free[self.free_head as usize];
            self.free_head = (self.free_head + 1) % self.capacity;
            self.free_len -= 1;
            slot
        } else if fresh_left {
            self.fresh += 1;
            self.fresh - 1
        } else {
            return Err(CoreError::CapacityExceeded {
                resource: Resource::Slots,
                capacity: self.capacity,
            });
        };
        self.live.set(slot);
        self.live_count += 1;
        Ok(Handle::new(
            slot,
            u32::from(self.generations[slot as usize]),
        ))
    }

    /// Frees the handle's slot, records `frame` as the frame it was destroyed in, and bumps the
    /// slot's generation so the handle goes stale.
    pub fn release(&mut self, handle: Handle, frame: u32) -> Result<(), CoreError> {
        let slot = self.resolve(handle)?;
        let s = slot as usize;
        self.live.clear(slot);
        self.live_count -= 1;
        let next = (u32::from(self.generations[s]) + 1) & GENERATION_MASK;
        self.generations[s] = if next == DEAD_GENERATION {
            0
        } else {
            next as u16
        };
        self.destroyed_frames[s] = frame;
        let tail = (self.free_head + self.free_len) % self.capacity;
        self.free[tail as usize] = slot;
        self.free_len += 1;
        Ok(())
    }

    /// The slot of a live handle. Fails with [`CoreError::InvalidHandle`] for values that were
    /// never handles, and with [`CoreError::StaleHandle`] when the object was destroyed.
    #[inline]
    pub fn resolve(&self, handle: Handle) -> Result<u32, CoreError> {
        let raw = handle.raw();
        let slot = handle.slot();
        if raw & !HANDLE_MASK != 0 || slot == 0 || slot >= self.fresh {
            return Err(CoreError::InvalidHandle { raw });
        }
        if !self.live.get(slot) || u32::from(self.generations[slot as usize]) != handle.generation()
        {
            return Err(CoreError::StaleHandle {
                slot,
                destroyed_frame: self.destroyed_frames[slot as usize],
            });
        }
        Ok(slot)
    }

    /// True when the handle names a reserved slot with the same generation.
    pub fn is_live(&self, handle: Handle) -> bool {
        self.resolve(handle).is_ok()
    }

    /// One bit per slot, set while the slot is reserved. Walk it with [`Bitset::iter_ones`] or
    /// word by word to skip 64 free slots at a time.
    pub fn live(&self) -> &Bitset {
        &self.live
    }

    /// The generation of each slot, indexed by slot.
    pub fn generations(&self) -> &[u16] {
        &self.generations
    }

    /// The frame in which `slot` was last destroyed, or 0 when it never was.
    pub fn destroyed_frame(&self, slot: u32) -> u32 {
        self.destroyed_frames
            .get(slot as usize)
            .copied()
            .unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn handle_layout() {
        let h = Handle::new(MAX_SLOTS, 1023);
        assert_eq!(h.raw(), 0x3FFF_FFFF);
        assert_eq!(h.slot(), MAX_SLOTS);
        assert_eq!(h.generation(), 1023);
        assert!(Handle::NONE.is_none());
        assert_eq!(Handle::new(5, 1024).generation(), 0);
    }

    #[test]
    fn create_destroy_and_stale_handles() {
        let mut slots = SlotAllocator::with_capacity(8);
        let a = slots.reserve().unwrap();
        let b = slots.reserve().unwrap();
        assert_eq!((a.slot(), a.generation()), (1, 0));
        assert_eq!((b.slot(), b.generation()), (2, 0));
        assert_eq!(slots.resolve(a), Ok(1));
        assert!(slots.is_live(b));
        assert_eq!(slots.live_count(), 2);

        slots.release(a, 17).unwrap();
        assert!(!slots.is_live(a));
        assert_eq!(
            slots.resolve(a),
            Err(CoreError::StaleHandle {
                slot: 1,
                destroyed_frame: 17
            })
        );
        assert_eq!(slots.release(a, 18).unwrap_err().code(), 1101);
        assert_eq!(slots.destroyed_frame(1), 17);
        assert_eq!(slots.live_count(), 1);
    }

    #[test]
    fn reuse_changes_the_generation() {
        let mut slots = SlotAllocator::with_capacity(3);
        let handles: Vec<Handle> = (0..3).map(|_| slots.reserve().unwrap()).collect();
        slots.release(handles[1], 5).unwrap();
        slots.release(handles[0], 6).unwrap();
        // No fresh slot is left, so freed slots come back in the order they were freed.
        let c = slots.reserve().unwrap();
        let d = slots.reserve().unwrap();
        assert_eq!((c.slot(), c.generation()), (2, 1));
        assert_eq!((d.slot(), d.generation()), (1, 1));
        assert_eq!(slots.resolve(c), Ok(2));
        assert_eq!(slots.resolve(handles[1]).unwrap_err().code(), 1101);
    }

    #[test]
    fn fresh_slots_come_first_until_the_reuse_delay() {
        let mut slots = SlotAllocator::with_capacity(4000);
        let first: Vec<Handle> = (0..REUSE_DELAY).map(|_| slots.reserve().unwrap()).collect();
        for &h in &first[..10] {
            slots.release(h, 1).unwrap();
        }
        // Only 10 slots are waiting, so the next slot is fresh.
        assert_eq!(slots.reserve().unwrap().slot(), REUSE_DELAY + 1);
        for &h in &first[10..] {
            slots.release(h, 2).unwrap();
        }
        // Now the queue is long enough: the first slot freed comes back first.
        let reused = slots.reserve().unwrap();
        assert_eq!((reused.slot(), reused.generation()), (1, 1));
    }

    #[test]
    fn the_generation_wraps_after_ten_bits_and_skips_the_dead_one() {
        let mut slots = SlotAllocator::with_capacity(1);
        let mut h = slots.reserve().unwrap();
        for _ in 0..DEAD_GENERATION {
            assert_ne!(h.generation(), DEAD_GENERATION);
            slots.release(h, 0).unwrap();
            h = slots.reserve().unwrap();
        }
        assert_eq!((h.slot(), h.generation()), (1, 0));
    }

    #[test]
    fn a_dead_handle_never_resolves_however_often_its_slot_is_reused() {
        // A full scene: the slot comes back at once after each destroy.
        let mut slots = SlotAllocator::with_capacity(1);
        let first = slots.reserve().unwrap();
        let dead = Handle::from_raw(first.raw() | (DEAD_GENERATION << SLOT_BITS));
        let mut h = first;
        for _ in 0..5000 {
            slots.release(h, 0).unwrap();
            h = slots.reserve().unwrap();
            assert!(matches!(
                slots.resolve(dead),
                Err(CoreError::StaleHandle { .. })
            ));
        }
    }

    #[test]
    fn capacity_limit() {
        let mut slots = SlotAllocator::with_capacity(2);
        slots.reserve().unwrap();
        slots.reserve().unwrap();
        assert_eq!(
            slots.reserve(),
            Err(CoreError::CapacityExceeded {
                resource: Resource::Slots,
                capacity: 2
            })
        );
        let big = SlotAllocator::with_capacity(MAX_SLOTS);
        assert_eq!(big.capacity(), 1_048_575);
    }

    #[test]
    fn grow_keeps_handles_and_the_order_of_freed_slots() {
        let mut slots = SlotAllocator::with_capacity(4);
        let handles: Vec<Handle> = (0..4).map(|_| slots.reserve().unwrap()).collect();
        // Free slots 3 then 1, and move the queue's head past the end once, so the queue wraps.
        slots.release(handles[0], 5).unwrap();
        let again = slots.reserve().unwrap();
        slots.release(handles[2], 6).unwrap();
        slots.release(handles[1], 7).unwrap();
        slots.try_reserve(9).unwrap();
        assert_eq!(slots.capacity(), 4);
        slots.grow(9);
        assert_eq!((slots.capacity(), slots.live_count()), (9, 2));
        assert_eq!(slots.resolve(again), Ok(1));
        assert_eq!(slots.resolve(handles[3]), Ok(4));
        assert!(matches!(
            slots.resolve(handles[1]),
            Err(CoreError::StaleHandle {
                slot: 2,
                destroyed_frame: 7
            })
        ));
        // Fresh slots come first, as in an allocator that started this large.
        let fresh: Vec<u32> = (0..5).map(|_| slots.reserve().unwrap().slot()).collect();
        assert_eq!(fresh, [5, 6, 7, 8, 9]);
        // Then the freed slots, in the order they were freed, with new generations.
        let reused: Vec<(u32, u32)> = (0..2)
            .map(|_| slots.reserve().map(|h| (h.slot(), h.generation())).unwrap())
            .collect();
        assert_eq!(reused, [(3, 1), (2, 1)]);
        assert!(slots.reserve().is_err());
        slots.grow(3);
        assert_eq!(slots.capacity(), 9);
    }

    #[test]
    #[should_panic(expected = "at most")]
    fn capacity_over_the_maximum_panics() {
        let _ = SlotAllocator::with_capacity(MAX_SLOTS + 1);
    }

    #[test]
    fn invalid_handles() {
        let mut slots = SlotAllocator::with_capacity(4);
        let h = slots.reserve().unwrap();
        for raw in [0, 3, 9, h.raw() | (1 << 30), h.raw() | (1 << 31)] {
            assert_eq!(
                slots.resolve(Handle::from_raw(raw)),
                Err(CoreError::InvalidHandle { raw }),
                "raw {raw:#x}"
            );
        }
        // Right slot, wrong generation.
        assert_eq!(
            slots.resolve(Handle::new(1, 3)).unwrap_err().code(),
            CoreError::STALE_HANDLE
        );
    }

    #[test]
    fn live_bitset_walk() {
        let mut slots = SlotAllocator::with_capacity(300);
        let handles: Vec<Handle> = (0..300).map(|_| slots.reserve().unwrap()).collect();
        for (i, &h) in handles.iter().enumerate() {
            if i % 3 == 0 || (64..192).contains(&i) {
                slots.release(h, 1).unwrap();
            }
        }
        let expected: Vec<u32> = handles
            .iter()
            .enumerate()
            .filter(|&(i, _)| i % 3 != 0 && !(64..192).contains(&i))
            .map(|(_, h)| h.slot())
            .collect();
        assert_eq!(slots.live().iter_ones().collect::<Vec<_>>(), expected);
        assert_eq!(slots.live().count_ones(), slots.live_count());
        // Word by word: the words that cover freed slots 65 to 192 are empty except at the edges.
        let words = slots.live().words();
        assert_eq!(words[2], 0);
        let walked: u32 = words.iter().map(|w| w.count_ones()).sum();
        assert_eq!(walked, expected.len() as u32);
    }
}
