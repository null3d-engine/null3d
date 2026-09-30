//! Small helpers for data that several threads share: a raw pointer that a parallel loop's
//! chunks use to write disjoint parts of one buffer, and cache-line padding for hot atomics.
//! Crates that run their own parallel loops on the job system use [`SharedMut`] too.

/// Keeps a value on its own cache line, so threads writing it do not slow down neighbouring
/// data. 128 bytes covers Apple cores and most Arm and x86 cores.
#[repr(align(128))]
pub(crate) struct CachePadded<T>(pub(crate) T);

/// Points at a buffer that several threads write, each in its own part. The pointer itself is
/// safe to share; every access is `unsafe` and states which part the caller owns.
pub struct SharedMut<T> {
    ptr: *mut T,
    len: usize,
}

impl<T> Clone for SharedMut<T> {
    fn clone(&self) -> Self {
        *self
    }
}

impl<T> Copy for SharedMut<T> {}

// SAFETY: the pointer is only dereferenced through the `unsafe` methods below, whose callers
// guarantee that no two threads touch the same element at once.
unsafe impl<T: Send> Send for SharedMut<T> {}
// SAFETY: as above.
unsafe impl<T: Send> Sync for SharedMut<T> {}

impl<T> SharedMut<T> {
    /// Shares `slice`. The caller keeps the mutable borrow alive while the pointer is in use.
    pub fn new(slice: &mut [T]) -> Self {
        Self {
            ptr: slice.as_mut_ptr(),
            len: slice.len(),
        }
    }

    /// The elements `start..start + len`.
    ///
    /// # Safety
    /// The range is inside the buffer, the buffer outlives `'a`, and no other thread accesses the
    /// range while the returned slice is alive.
    #[inline(always)]
    pub unsafe fn slice<'a>(&self, start: usize, len: usize) -> &'a mut [T] {
        debug_assert!(start + len <= self.len);
        // SAFETY: guaranteed by the caller.
        unsafe { std::slice::from_raw_parts_mut(self.ptr.add(start), len) }
    }

    /// Writes element `i`.
    ///
    /// # Safety
    /// `i` is inside the buffer, and no other thread accesses element `i` at the same time.
    #[inline(always)]
    pub unsafe fn write(&self, i: usize, value: T) {
        debug_assert!(i < self.len);
        // SAFETY: guaranteed by the caller.
        unsafe { self.ptr.add(i).write(value) }
    }

    /// Reads element `i`.
    ///
    /// # Safety
    /// `i` is inside the buffer, and no other thread writes element `i` at the same time.
    #[inline(always)]
    pub unsafe fn read(&self, i: usize) -> T
    where
        T: Copy,
    {
        debug_assert!(i < self.len);
        // SAFETY: guaranteed by the caller.
        unsafe { self.ptr.add(i).read() }
    }
}

impl SharedMut<u64> {
    /// Sets `bits` in word `i` with an atomic OR, so several threads can set bits of one word.
    ///
    /// # Safety
    /// `i` is inside the buffer, and every thread that touches word `i` meanwhile uses this call.
    #[inline(always)]
    pub(crate) unsafe fn fetch_or(&self, i: usize, bits: u64) {
        debug_assert!(i < self.len);
        // SAFETY: guaranteed by the caller; `AtomicU64` has the size and alignment of `u64`.
        unsafe {
            std::sync::atomic::AtomicU64::from_ptr(self.ptr.add(i))
                .fetch_or(bits, std::sync::atomic::Ordering::Relaxed);
        }
    }
}
