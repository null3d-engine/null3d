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
/// The number of the current hold on the counter. Each hold takes a new one, so a thread marked
/// during an earlier hold no longer counts.
static HOLD: AtomicU64 = AtomicU64::new(0);

thread_local! {
    /// The hold during which this thread was marked, or 0 while it is not marked. Holds count
    /// from 1.
    static TRACKED: Cell<u64> = const { Cell::new(0) };
}

/// A counting test's hold on the shared counter, from [`CountingAllocator::exclusive`]. When it
/// drops, at the end of the test, it stops counting the current thread before it lets the next
/// test take the counter. The test runner's own work on the thread after the test then cannot
/// reach the next test's count. The next hold also stops counting every other thread that this
/// test marked: a thread that a scope has joined can still free memory as it exits.
pub struct Exclusive {
    _lock: MutexGuard<'static, ()>,
}

impl Drop for Exclusive {
    fn drop(&mut self) {
        untrack_this_thread();
    }
}

/// Stops counting the current thread.
fn untrack_this_thread() {
    TRACKED.with(|t| t.set(0));
}

impl CountingAllocator {
    /// Runs counting tests one at a time: they share one counter. Take it before tracking, and
    /// keep it until the test ends.
    pub fn exclusive() -> Exclusive {
        let lock = EXCLUSIVE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        HOLD.fetch_add(1, Ordering::SeqCst);
        Exclusive { _lock: lock }
    }

    /// Counts allocations made from now on by the current thread, until the current hold on the
    /// counter ends.
    pub fn track_this_thread() {
        let hold = HOLD.load(Ordering::SeqCst);
        TRACKED.with(|t| t.set(hold));
    }

    /// Runs `f` with the current thread counted, as [`CountingAllocator::track_this_thread`]
    /// does, and stops counting the thread when `f` returns or panics. A spawned thread runs its
    /// work through this. Its exit then never counts: the thread can free memory after its scope
    /// has returned, while the same test already counts again.
    pub fn track_while<R>(f: impl FnOnce() -> R) -> R {
        struct Untrack;
        impl Drop for Untrack {
            fn drop(&mut self) {
                untrack_this_thread();
            }
        }
        Self::track_this_thread();
        let _untrack = Untrack;
        f()
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
        // Acquire: a thread that sees counting armed also sees the hold that armed it.
        if !ARMED.load(Ordering::Acquire) {
            return;
        }
        let tracked = TRACKED.with(Cell::get);
        if tracked != 0 && tracked == HOLD.load(Ordering::Relaxed) {
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
