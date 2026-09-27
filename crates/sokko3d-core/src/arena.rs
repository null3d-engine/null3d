//! Frame arenas: bump allocators over buffers allocated once, reset at the start of each frame.
//!
//! Frame code takes scratch memory (culling lists, draw lists, temporary math) from an arena
//! instead of the global allocator. Running out returns [`CoreError::CapacityExceeded`]; an arena
//! never grows. [`ArenaPool`] holds one arena per worker id, so each thread bumps its own arena
//! and threads never contend.
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

    /// Hands out `len` values of `T`, aligned for `T`. The values are whatever an earlier frame
    /// left there (zero at first), which is sound because `T` is plain data. Fails with
    /// [`CoreError::CapacityExceeded`] when the arena is full.
    // Each call claims bytes that no other call shares, so the slices never alias.
    #[allow(clippy::mut_from_ref)]
    pub fn alloc<T: Pod>(&self, len: usize) -> Result<&mut [T], CoreError> {
        const { assert!(align_of::<T>() <= ARENA_ALIGN) };
        let full = CoreError::CapacityExceeded {
            resource: Resource::FrameArena,
            capacity: u32::try_from(self.capacity()).unwrap_or(u32::MAX),
        };
        let size = size_of::<T>().checked_mul(len).ok_or(full)?;
        let mut current = self.used.load(Ordering::Relaxed);
        let start = loop {
            let start = current.next_multiple_of(align_of::<T>());
            let end = start
                .checked_add(size)
                .filter(|&end| end <= self.capacity())
                .ok_or(full)?;
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
        Ok(
            unsafe {
                std::slice::from_raw_parts_mut(base.cast::<u8>().add(start).cast::<T>(), len)
            },
        )
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

/// One [`FrameArena`] per worker id: the calling thread and each job worker.
pub struct ArenaPool {
    arenas: Box<[FrameArena]>,
}

impl ArenaPool {
    /// `threads` arenas of `bytes_per_arena` bytes each.
    pub fn new(threads: u32, bytes_per_arena: usize) -> Self {
        Self {
            arenas: (0..threads.max(1))
                .map(|_| FrameArena::with_capacity(bytes_per_arena))
                .collect(),
        }
    }

    /// One arena for each worker id of `jobs`.
    pub fn for_jobs(jobs: &JobSystem, bytes_per_arena: usize) -> Self {
        Self::new(jobs.thread_count(), bytes_per_arena)
    }

    /// The number of arenas.
    pub fn len(&self) -> usize {
        self.arenas.len()
    }

    /// Always false: a pool holds at least one arena.
    pub fn is_empty(&self) -> bool {
        self.arenas.is_empty()
    }

    /// The arena of `worker`.
    ///
    /// # Panics
    /// When the pool has no arena for that worker id.
    pub fn arena(&self, worker: WorkerId) -> &FrameArena {
        &self.arenas[worker.index()]
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
        let mut pool = ArenaPool::for_jobs(&jobs, 256);
        assert_eq!(pool.len(), 4);
        pool.arena(WorkerId::job_worker(2))
            .alloc::<u8>(100)
            .unwrap();
        assert_eq!(pool.high_water(), 100);
        pool.reset_all();
        assert_eq!(pool.arena(WorkerId::job_worker(2)).used(), 0);
    }
}
