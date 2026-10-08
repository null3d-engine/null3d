//! The threaded build's heap: dlmalloc behind a spin lock, as the standard library's allocator on
//! this target is, with one addition. The page keeps the shared memory of an engine that stopped and
//! gives it to the next engine, so a core can start in a memory that has already grown. The page
//! clears the memory's static part first, so the core copies its data again as in a new memory. The
//! heap's first request for memory then takes the pages above the static part, which the last
//! engine's heap used, and clears them. Without that, every reuse would grow the memory past the
//! last engine's heap, until it reached its maximum.

use core::arch::wasm32;
use core::cell::UnsafeCell;
use core::ptr;
use core::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::alloc::{GlobalAlloc, Layout};

use dlmalloc::{Allocator, Dlmalloc};

/// The size of a WebAssembly page.
const PAGE: usize = 64 * 1024;
/// The pages that wasm-bindgen adds after the linker's memory, for its thread counter, its lock and
/// the stack that a new thread uses while it allocates its own. The build checks the count.
const BINDGEN_PAGES: usize = 1;

unsafe extern "C" {
    /// The end of the memory that the linker lays out: the static data and the main stack.
    static __heap_end: u8;
}

/// Where the heap starts: after the linker's memory and the pages that wasm-bindgen adds.
fn heap_start() -> usize {
    (&raw const __heap_end as usize).next_multiple_of(PAGE) + BINDGEN_PAGES * PAGE
}

/// The pages that a reused memory has above the static part, cleared, and grown when they hold fewer
/// than `size` bytes. None in a new memory, which has no pages above it yet.
fn reclaim(size: usize) -> Option<(*mut u8, usize, u32)> {
    let start = heap_start();
    let end = wasm32::memory_size(0) * PAGE;
    if end <= start {
        return None;
    }
    let held = end - start;
    // Pages that the heap had are cleared, as dlmalloc takes new pages to hold zeros.
    // SAFETY: no allocation lies above the static part before the heap's first request, and the
    // page cleared the static part only once no thread of the last engine ran.
    unsafe { ptr::write_bytes(start as *mut u8, 0, held) };
    let short = size.saturating_sub(held).div_ceil(PAGE);
    let grown = if short > 0 && wasm32::memory_grow(0, short) != usize::MAX {
        short * PAGE
    } else {
        0
    };
    Some((start as *mut u8, held + grown, 0))
}

/// Grows the memory by enough pages for `size` bytes, as the standard system part does.
fn grow(size: usize) -> (*mut u8, usize, u32) {
    let pages = size.div_ceil(PAGE);
    match wasm32::memory_grow(0, pages) {
        usize::MAX => (ptr::null_mut(), 0, 0),
        before => ((before * PAGE) as *mut u8, pages * PAGE, 0),
    }
}

/// The system part of the heap: it grows the memory, after a first request that takes the pages
/// of a reused memory.
struct Pages {
    first_done: AtomicBool,
}

// SAFETY: each region it hands out is memory that no allocation holds, and it never frees one.
unsafe impl Allocator for Pages {
    fn alloc(&self, size: usize) -> (*mut u8, usize, u32) {
        if !self.first_done.swap(true, Ordering::Relaxed)
            && let Some(region) = reclaim(size)
        {
            return region;
        }
        grow(size)
    }

    fn remap(&self, _ptr: *mut u8, _old_size: usize, _new_size: usize, _can_move: bool) -> *mut u8 {
        ptr::null_mut()
    }

    fn free_part(&self, _ptr: *mut u8, _old_size: usize, _new_size: usize) -> bool {
        false
    }

    fn free(&self, _ptr: *mut u8, _size: usize) -> bool {
        false
    }

    fn can_release_part(&self, _flags: u32) -> bool {
        false
    }

    fn allocates_zeros(&self) -> bool {
        true
    }

    fn page_size(&self) -> usize {
        PAGE
    }
}

/// The heap that every thread shares, which the lock guards.
struct Heap {
    locked: AtomicI32,
    dlmalloc: UnsafeCell<Dlmalloc<Pages>>,
}

// SAFETY: every use of the allocator holds the lock.
unsafe impl Sync for Heap {}

/// Holds the heap's lock until it drops.
struct Lock<'a>(&'a AtomicI32);

impl Drop for Lock<'_> {
    fn drop(&mut self) {
        self.0.store(0, Ordering::Release);
    }
}

impl Heap {
    /// Takes the lock, spinning as the standard allocator does: each hold is short.
    fn lock(&self) -> Lock<'_> {
        while self.locked.swap(1, Ordering::Acquire) != 0 {
            core::hint::spin_loop();
        }
        Lock(&self.locked)
    }

    /// Runs `f` on the allocator under the lock.
    fn with<T>(&self, f: impl FnOnce(&mut Dlmalloc<Pages>) -> T) -> T {
        let _lock = self.lock();
        // SAFETY: the lock gives this thread the only access.
        f(unsafe { &mut *self.dlmalloc.get() })
    }
}

#[global_allocator]
static HEAP: Heap = Heap {
    locked: AtomicI32::new(0),
    dlmalloc: UnsafeCell::new(Dlmalloc::new_with_allocator(Pages {
        first_done: AtomicBool::new(false),
    })),
};

// SAFETY: dlmalloc meets the contract of each call, and the lock serializes them.
unsafe impl GlobalAlloc for Heap {
    #[inline(never)]
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        self.with(|heap| unsafe { heap.malloc(layout.size(), layout.align()) })
    }

    #[inline(never)]
    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        self.with(|heap| unsafe { heap.calloc(layout.size(), layout.align()) })
    }

    #[inline(never)]
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        self.with(|heap| unsafe { heap.free(ptr, layout.size(), layout.align()) })
    }

    #[inline(never)]
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        self.with(|heap| unsafe { heap.realloc(ptr, layout.size(), layout.align(), new_size) })
    }
}
