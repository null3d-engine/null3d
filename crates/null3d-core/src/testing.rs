//! Helpers for tests, in this crate and in the crates built on it: a global allocator that counts
//! the allocations of chosen threads, for checks that frame code allocates nothing. Available with
//! the `testing` feature.

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};

/// A global allocator that counts allocations made by marked threads while counting is armed.
/// A test binary installs it with `#[global_allocator]`.
pub struct CountingAllocator;

static ARMED: AtomicBool = AtomicBool::new(false);
static ALLOCATIONS: AtomicU64 = AtomicU64::new(0);
static EXCLUSIVE: Mutex<()> = Mutex::new(());

thread_local! {
    static TRACKED: Cell<bool> = const { Cell::new(false) };
}

/// A counting test's hold on the shared counter, from [`CountingAllocator::exclusive`]. When it
/// drops, at the end of the test, it stops counting the current thread before it lets the next
/// test take the counter. The test runner's own work on the thread after the test then cannot
/// reach the next test's count.
pub struct Exclusive {
    _lock: MutexGuard<'static, ()>,
}

impl Drop for Exclusive {
    fn drop(&mut self) {
        TRACKED.with(|t| t.set(false));
    }
}

impl CountingAllocator {
    /// Runs counting tests one at a time: they share one counter. Take it before tracking, and
    /// keep it until the test ends.
    pub fn exclusive() -> Exclusive {
        Exclusive {
            _lock: EXCLUSIVE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()),
        }
    }

    /// Counts allocations made from now on by the current thread.
    pub fn track_this_thread() {
        TRACKED.with(|t| t.set(true));
    }

    /// Starts counting from zero.
    pub fn arm() {
        ALLOCATIONS.store(0, Ordering::SeqCst);
        ARMED.store(true, Ordering::SeqCst);
    }

    /// Stops counting and returns the number of allocations counted.
    pub fn disarm() -> u64 {
        ARMED.store(false, Ordering::SeqCst);
        ALLOCATIONS.load(Ordering::SeqCst)
    }

    fn count() {
        if ARMED.load(Ordering::Relaxed) && TRACKED.with(Cell::get) {
            ALLOCATIONS.fetch_add(1, Ordering::Relaxed);
        }
    }
}

// SAFETY: every call forwards to the system allocator unchanged; counting touches only atomics
// and a thread-local flag, neither of which allocates.
unsafe impl GlobalAlloc for CountingAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        Self::count();
        // SAFETY: the caller's contract is forwarded as is.
        unsafe { System.alloc(layout) }
    }

    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        Self::count();
        // SAFETY: the caller's contract is forwarded as is.
        unsafe { System.alloc_zeroed(layout) }
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        Self::count();
        // SAFETY: the caller's contract is forwarded as is.
        unsafe { System.realloc(ptr, layout, new_size) }
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        Self::count();
        // SAFETY: the caller's contract is forwarded as is.
        unsafe { System.dealloc(ptr, layout) }
    }
}
