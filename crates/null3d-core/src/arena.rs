//! Frame arenas: bump allocators over buffers allocated once, reset at the start of each frame.
//!
//! Frame code takes scratch memory (culling lists, draw lists, temporary math) from an arena
//! instead of the global allocator. Running out returns [`CoreError::CapacityExceeded`]; an arena
//! never grows.
//!
//! [`ArenaPool`] holds one arena per worker id, and each thread bumps its own arena first, so
//! threads do not contend. A thread can run any number of a loop's chunks, from none to all of
//! them (see [`crate::jobs`]), so its share of a frame's scratch changes from frame to frame. A
//! thread whose arena is full therefore continues in the other arenas, and the pool as a whole
//! holds the frame's scratch however the chunks fall. [`ArenaPool::new`] sizes the arenas from the
//! frame's total and its largest allocation, both counted with [`FrameArena::bytes_for`].
//!
//! Allocation takes `&self` and claims its bytes with an atomic compare-and-swap, so two
//! allocations never overlap, even from two threads. [`FrameArena::reset`] takes `&mut self`, so
//! no slice from the previous frame can outlive the reset.

use std::cell::UnsafeCell;
use std::sync::atomic::{AtomicUsize, Ordering};

use crate::error::{CoreError, Resource};
use crate::jobs::{JobSystem, WorkerId};

/// The largest alignment an arena hands out, in bytes.
pub const ARENA_ALIGN: usize = 16;

/// Plain data a frame arena can hand out.
///
/// # Safety
/// Implement it only for `Copy` types with no padding bytes and no interior mutability, for
/// which every bit pattern is a valid value, and whose alignment is at most [`ARENA_ALIGN`].
/// Arena memory keeps whatever the previous frame wrote, so reading it must be sound for any
/// bytes.
pub unsafe trait Pod: Copy + 'static {}

macro_rules! impl_pod {
    ($($t:ty),*) => {
        // SAFETY: primitive numbers have no padding, and every bit pattern is a valid value.
        $(unsafe impl Pod for $t {})*
    };
}
impl_pod!(u8, i8, u16, i16, u32, i32, u64, i64, usize, isize, f32, f64);

// SAFETY: an array of plain data has no padding between elements and no invalid bit patterns.
unsafe impl<T: Pod, const N: usize> Pod for [T; N] {}

/// One 16-byte unit of arena storage. The cell allows writes through a shared reference.
#[repr(C, align(16))]
struct Block(UnsafeCell<[u8; ARENA_ALIGN]>);

/// A bump allocator over a fixed buffer. See the module documentation.
pub struct FrameArena {
    blocks: Box<[Block]>,
    used: AtomicUsize,
    high_water: usize,
}

// SAFETY: every allocation claims a byte range no other allocation shares (an atomic
// compare-and-swap moves the bump offset past it), and ranges are only reused after
// `reset(&mut self)`, which no outstanding slice can survive.
unsafe impl Sync for FrameArena {}

impl FrameArena {
    /// An arena of at least `bytes` bytes, rounded up to [`ARENA_ALIGN`]. The buffer is zeroed
    /// once, here.
    pub fn with_capacity(bytes: usize) -> Self {
        let blocks = (0..bytes.div_ceil(ARENA_ALIGN))
            .map(|_| Block(UnsafeCell::new([0; ARENA_ALIGN])))
            .collect();
        Self {
            blocks,
            used: AtomicUsize::new(0),
            high_water: 0,
        }
    }

    /// The buffer size in bytes.
    pub fn capacity(&self) -> usize {
        self.blocks.len() * ARENA_ALIGN
    }

    /// Bytes handed out since the last reset, alignment padding included.
    pub fn used(&self) -> usize {
        self.used.load(Ordering::Relaxed)
    }

    /// The most bytes in use at any moment since the arena was created.
    pub fn high_water(&self) -> usize {
        self.high_water.max(self.used())
    }

    /// The most bytes that an allocation of `len` values of `T` takes from an arena: the values,
    /// and the padding that aligns them after an earlier allocation.
    pub const fn bytes_for<T: Pod>(len: usize) -> usize {
        size_of::<T>()
            .saturating_mul(len)
            .saturating_add(align_of::<T>() - 1)
    }

    /// Hands out `len` values of `T`, aligned for `T`. The values are whatever an earlier frame
    /// left there (zero at first), which is sound because `T` is plain data. Fails with
    /// [`CoreError::CapacityExceeded`] when the arena is full.
    pub fn alloc<T: Pod>(&self, len: usize) -> Result<&mut [T], CoreError> {
        self.try_alloc(len)
            .ok_or_else(|| arena_full(self.capacity()))
    }

    /// Like [`FrameArena::alloc`], or `None` when the arena is full.
    // Each call claims bytes that no other call shares, so the slices never alias.
    #[allow(clippy::mut_from_ref)]
    #[inline]
    fn try_alloc<T: Pod>(&self, len: usize) -> Option<&mut [T]> {
        const { assert!(align_of::<T>() <= ARENA_ALIGN) };
        let size = size_of::<T>().checked_mul(len)?;
        let mut current = self.used.load(Ordering::Relaxed);
        let start = loop {
            let start = current.next_multiple_of(align_of::<T>());
            let end = start
                .checked_add(size)
                .filter(|&end| end <= self.capacity())?;
            match self.used.compare_exchange_weak(
                current,
                end,
                Ordering::Relaxed,
                Ordering::Relaxed,
            ) {
                Ok(_) => break start,
                Err(now) => current = now,
            }
        };
        let base = UnsafeCell::raw_get(self.blocks.as_ptr().cast::<UnsafeCell<[u8; 16]>>());
        // SAFETY: `start..start + size` lies inside the buffer, is aligned for `T` (the buffer
        // starts on a 16-byte boundary), and belongs to this call alone until the next reset. The
        // bytes were initialized at creation and only ever overwritten with plain data, so they
        // are valid values of `T`.
        Some(unsafe {
            std::slice::from_raw_parts_mut(base.cast::<u8>().add(start).cast::<T>(), len)
        })
    }

    /// Like [`FrameArena::alloc`], with every value set to `value`.
    pub fn alloc_filled<T: Pod>(&self, len: usize, value: T) -> Result<&mut [T], CoreError> {
        let slice = self.alloc(len)?;
        slice.fill(value);
        Ok(slice)
    }

    /// Makes the whole buffer available again. Call it once per frame, before the frame's first
    /// allocation.
    pub fn reset(&mut self) {
        let used = *self.used.get_mut();
        self.high_water = self.high_water.max(used);
        *self.used.get_mut() = 0;
    }
}

/// The error of an arena, or of a pool of arenas, that holds `capacity` bytes and is full.
fn arena_full(capacity: usize) -> CoreError {
    CoreError::CapacityExceeded {
        resource: Resource::FrameArena,
        capacity: u32::try_from(capacity).unwrap_or(u32::MAX),
    }
}

/// One [`FrameArena`] per worker id: the calling thread and each job worker. A thread allocates
/// from its own arena first and continues in the others when it is full (see the module
/// documentation).
pub struct ArenaPool {
    arenas: Box<[FrameArena]>,
}

impl ArenaPool {
    /// Arenas for `threads` worker ids that together hold a frame's scratch however the frame's
    /// chunks fall across the threads. `frame_bytes` is the most bytes the frame takes and
    /// `largest` the most that one allocation takes, both counted with [`FrameArena::bytes_for`].
    ///
    /// Each arena holds an even share of `frame_bytes` and `largest` bytes more. An allocation
    /// that finds no room leaves each arena with fewer than `largest` bytes free, so the arenas
    /// would already hold more than `frame_bytes`. A frame within its bounds therefore never
    /// runs out.
    pub fn new(threads: u32, frame_bytes: usize, largest: usize) -> Self {
        let threads = threads.max(1);
        let bytes_per_arena = frame_bytes
            .div_ceil(threads as usize)
            .saturating_add(largest);
        Self {
            arenas: (0..threads)
                .map(|_| FrameArena::with_capacity(bytes_per_arena))
                .collect(),
        }
    }

    /// Arenas for each worker id of `jobs` that together hold a frame's scratch, as
    /// [`ArenaPool::new`] sizes them.
    pub fn for_jobs(jobs: &JobSystem, frame_bytes: usize, largest: usize) -> Self {
        Self::new(jobs.thread_count(), frame_bytes, largest)
    }

    /// The number of arenas.
    pub fn len(&self) -> usize {
        self.arenas.len()
    }

    /// Always false: a pool holds at least one arena.
    pub fn is_empty(&self) -> bool {
        self.arenas.is_empty()
    }

    /// The bytes of every arena together.
    pub fn capacity(&self) -> usize {
        self.arenas.iter().map(FrameArena::capacity).sum()
    }

    /// Bytes handed out from every arena since the last reset, alignment padding included.
    pub fn used(&self) -> usize {
        self.arenas.iter().map(FrameArena::used).sum()
    }

    /// Hands out `len` values of `T` to `worker`: from its own arena, or from the next arena
    /// with room when that one is full. Otherwise as [`FrameArena::alloc`], and fails with
    /// [`CoreError::CapacityExceeded`] when no arena has room.
    ///
    /// # Panics
    /// When the pool has no arena for that worker id.
    #[inline]
    pub fn alloc<T: Pod>(&self, worker: WorkerId, len: usize) -> Result<&mut [T], CoreError> {
        let own = worker.index();
        if let Some(values) = self.arenas[own].try_alloc(len) {
            return Ok(values);
        }
        self.alloc_elsewhere(own, len)
    }

    /// Like [`ArenaPool::alloc`], with every value set to `value`.
    pub fn alloc_filled<T: Pod>(
        &self,
        worker: WorkerId,
        len: usize,
        value: T,
    ) -> Result<&mut [T], CoreError> {
        let slice = self.alloc(worker, len)?;
        slice.fill(value);
        Ok(slice)
    }

    /// Hands out `len` values of `T` from the first arena after arena `own`, in turn, that has
    /// room. Starting after the full arena spreads threads that run out across the others.
    #[cold]
    fn alloc_elsewhere<T: Pod>(&self, own: usize, len: usize) -> Result<&mut [T], CoreError> {
        let (before, after) = self.arenas.split_at(own);
        after[1..]
            .iter()
            .chain(before)
            .find_map(|arena| arena.try_alloc(len))
            .ok_or_else(|| arena_full(self.capacity()))
    }

    /// Resets every arena. Call it once per frame.
    pub fn reset_all(&mut self) {
        for arena in &mut self.arenas {
            arena.reset();
        }
    }

    /// The largest high-water mark of any arena, in bytes.
    pub fn high_water(&self) -> usize {
        self.arenas
            .iter()
            .map(FrameArena::high_water)
            .max()
            .unwrap_or(0)
    }

    /// The high-water mark of the arena that `worker` allocates from first, in bytes.
    ///
    /// # Panics
    /// When the pool has no arena for that worker id.
    pub fn high_water_of(&self, worker: WorkerId) -> usize {
        self.arenas[worker.index()].high_water()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A value that needs 16-byte alignment, like a SIMD vector.
    #[derive(Clone, Copy)]
    #[repr(C, align(16))]
    struct Vec4([f32; 4]);

    // SAFETY: four floats fill the 16 bytes, so there is no padding, and any bits are valid.
    unsafe impl Pod for Vec4 {}

    #[test]
    fn allocations_are_aligned_and_disjoint() {
        let arena = FrameArena::with_capacity(1000);
        assert_eq!(arena.capacity(), 1008);
        let a = arena.alloc::<u8>(3).unwrap();
        let b = arena.alloc::<u32>(5).unwrap();
        let c = arena.alloc::<Vec4>(2).unwrap();
        let d = arena.alloc::<u64>(0).unwrap();
        assert_eq!(b.as_ptr() as usize % 4, 0);
        assert_eq!(c.as_ptr() as usize % 16, 0);
        assert_eq!(d.as_ptr() as usize % 8, 0);
        a.fill(0xAB);
        b.fill(7);
        c.fill(Vec4([1.0; 4]));
        assert!(a.iter().all(|&v| v == 0xAB));
        assert!(b.iter().all(|&v| v == 7));
        let a_end = a.as_ptr() as usize + a.len();
        assert!(b.as_ptr() as usize >= a_end);
        assert!(c.as_ptr() as usize >= b.as_ptr() as usize + 20);
        assert_eq!(arena.used(), 64);
    }

    #[test]
    fn running_out_is_an_error_and_reset_reclaims() {
        let mut arena = FrameArena::with_capacity(64);
        let filled = arena.alloc_filled::<u32>(10, 9).unwrap();
        assert_eq!(filled, &[9; 10]);
        let err = arena.alloc::<u32>(10).unwrap_err();
        assert_eq!(
            err,
            CoreError::CapacityExceeded {
                resource: Resource::FrameArena,
                capacity: 64
            }
        );
        assert_eq!(err.code(), 1102);
        assert_eq!(arena.alloc::<u64>(usize::MAX).unwrap_err().code(), 1102);
        arena.reset();
        assert_eq!(arena.used(), 0);
        assert_eq!(arena.high_water(), 40);
        assert_eq!(arena.alloc::<u32>(16).unwrap().len(), 16);
        assert_eq!(arena.high_water(), 64);
    }

    #[test]
    fn a_pool_has_one_arena_per_worker_id() {
        let jobs = JobSystem::new(3);
        let mut pool = ArenaPool::for_jobs(&jobs, 1024, 256);
        assert_eq!(pool.len(), 4);
        assert_eq!(pool.capacity(), 4 * (256 + 256));
        pool.alloc::<u8>(WorkerId::job_worker(2), 100).unwrap();
        assert_eq!(pool.high_water_of(WorkerId::job_worker(2)), 100);
        assert_eq!(pool.high_water(), 100);
        assert_eq!(pool.used(), 100);
        pool.reset_all();
        assert_eq!(pool.used(), 0);
    }

    #[test]
    fn a_full_arena_continues_in_the_next_ones() {
        // Three arenas of 64 bytes, each full after one allocation.
        let mut pool = ArenaPool::new(3, 3 * 48, 16);
        let worker = WorkerId::job_worker(0);
        let a = pool.alloc_filled::<u32>(worker, 16, 1).unwrap();
        let b = pool.alloc_filled::<u32>(worker, 16, 2).unwrap();
        let c = pool.alloc_filled::<u32>(worker, 16, 3).unwrap();
        assert!(a.iter().all(|&v| v == 1) && b.iter().all(|&v| v == 2));
        assert!(c.iter().all(|&v| v == 3));
        for id in [
            WorkerId::CALLER,
            WorkerId::job_worker(0),
            WorkerId::job_worker(1),
        ] {
            assert_eq!(pool.high_water_of(id), 64);
        }
        let err = pool.alloc::<u8>(WorkerId::CALLER, 1).unwrap_err();
        assert_eq!(
            err,
            CoreError::CapacityExceeded {
                resource: Resource::FrameArena,
                capacity: 192
            }
        );
        pool.reset_all();
        assert_eq!(pool.used(), 0);
        assert_eq!(pool.alloc::<u32>(worker, 16).unwrap().len(), 16);
    }

    /// The bytes that [`FrameArena::bytes_for`] counts for `len` values of one of four plain
    /// types, which `kind` picks.
    fn bytes_for_kind(kind: u32, len: usize) -> usize {
        match kind % 4 {
            0 => FrameArena::bytes_for::<u8>(len),
            1 => FrameArena::bytes_for::<u32>(len),
            2 => FrameArena::bytes_for::<u64>(len),
            _ => FrameArena::bytes_for::<Vec4>(len),
        }
    }

    /// Takes `len` values of the type that `kind` picks from `pool` for `worker`.
    fn take(pool: &ArenaPool, worker: WorkerId, kind: u32, len: usize) -> Result<(), CoreError> {
        match kind % 4 {
            0 => pool.alloc::<u8>(worker, len).map(drop),
            1 => pool.alloc::<u32>(worker, len).map(drop),
            2 => pool.alloc::<u64>(worker, len).map(drop),
            _ => pool.alloc::<Vec4>(worker, len).map(drop),
        }
    }

    #[test]
    fn a_pool_holds_its_frame_however_the_allocations_fall() {
        let mut seed = 7u32;
        let mut next = move || {
            seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            seed >> 8
        };
        for threads in [1u32, 2, 5, 17] {
            // Mixed sizes and alignments leave padding and an unusable tail in every arena.
            let allocations: Vec<(u32, usize)> =
                (0..400).map(|_| (next(), next() as usize % 900)).collect();
            let bytes = allocations
                .iter()
                .map(|&(kind, len)| bytes_for_kind(kind, len));
            let (frame_bytes, largest) = (bytes.clone().sum(), bytes.max().unwrap());
            let mut pool = ArenaPool::new(threads, frame_bytes, largest);
            // One thread takes every allocation, then the threads take turns, then a random
            // thread takes each one.
            let picks: [&dyn Fn(usize, u32) -> u32; 3] = [
                &|_, _| threads - 1,
                &|i, _| i as u32 % threads,
                &|_, random| random % threads,
            ];
            for pick in picks {
                for (i, &(kind, len)) in allocations.iter().enumerate() {
                    let worker = worker_id(pick(i, kind >> 3));
                    take(&pool, worker, kind, len).expect("the pool holds its frame");
                }
                assert!(pool.used() <= frame_bytes);
                pool.reset_all();
            }
        }
    }

    /// Worker id `w` of a system with job workers: 0 is the calling thread.
    fn worker_id(w: u32) -> WorkerId {
        if w == 0 {
            WorkerId::CALLER
        } else {
            WorkerId::job_worker(w - 1)
        }
    }
}
