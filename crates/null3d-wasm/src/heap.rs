//! The heap: dlmalloc behind a spin lock, as the standard library's allocator on this target is, with
//! two additions.
//!
//! A plain `push` cannot report a refused request, so a refusal would trap. The heap therefore keeps
//! room that only small requests may take: the last pages under the memory's declared maximum, which
//! cost nothing until they are used, and a small block that it holds, for a browser that refuses to
//! grow the memory before its maximum. A small request that needs that room still succeeds. The next
//! frame then reads `reserve_spent` and stops with E1109. A larger request reports its refusal.
//!
//! The page keeps the shared memory of an engine that stopped and gives it to the next engine, so a
//! threaded core can start in a memory that has already grown. The page clears the memory's static
//! part first, so the core copies its data again as in a new memory. The heap's first request for
//! memory then takes the pages above the static part, which the last engine's heap used, and clears
//! them. Without that, every reuse would grow the memory past the last engine's heap, until it reached
//! its maximum.
//!
//! Some Safari releases keep, on each thread, the memory size that the thread last saw: when another
//! thread grows the shared memory, this thread's `memory.size`, `memory.copy` and `memory.fill` still
//! use the old size, so a copy or a fill past it traps as an out-of-bounds access. Only a growth that
//! the thread makes itself brings its size up to date; a growth of nothing does not. The heap therefore
//! records how far the memory that it handed out reaches. A thread whose own size ends before that
//! grows the memory by one page, at each request and when [`refresh_view`] asks. The heap keeps those
//! pages at the memory's end and hands them out first at its next growth, so they cost nothing. They
//! do not move the recorded end, so one thread's page never makes the others grow one. Where every
//! thread sees the memory's size at once, no thread ever falls behind and nothing grows.

use core::arch::wasm32;
use core::cell::UnsafeCell;
use core::ptr;
use core::sync::atomic::{AtomicBool, AtomicI32, AtomicUsize, Ordering};
use std::alloc::{GlobalAlloc, Layout};

use dlmalloc::{Allocator, Dlmalloc};
use null3d_core::alloc::{HEAP_RESERVE, memory_maximum};

/// The size of a WebAssembly page.
const PAGE: usize = 64 * 1024;
/// The largest request that may take the reserve. The frame's plain pushes all fit under it, and a
/// layout's rebuild, which can ask for more, checks its room first.
const SMALL_REQUEST: usize = 4 << 20;
/// The block that the heap holds for a browser that refuses growth before the maximum.
const HELD_BLOCK: usize = 2 << 20;
/// True once a small request has taken the reserve, which also lets the memory grow into its last pages.
static RESERVE_SPENT: AtomicBool = AtomicBool::new(false);
/// The address of the block that the heap holds, or 0.
static HELD: AtomicUsize = AtomicUsize::new(0);
/// The end of the memory that the heap has handed out: no allocation reaches past it. Zero before
/// the heap's first request.
static TAKEN_END: AtomicUsize = AtomicUsize::new(0);
/// The start of the pages at the memory's end that threads grew only to bring their own view of the
/// memory's size up to date. The heap hands them out first at its next growth. It and the count
/// below change only under the heap's lock.
static SPARE_START: AtomicUsize = AtomicUsize::new(0);
/// The number of those pages.
static SPARE_PAGES: AtomicUsize = AtomicUsize::new(0);
/// The pages that wasm-bindgen adds after the linker's memory, for its thread counter, its lock and
/// the stack that a new thread uses while it allocates its own. The build checks the count.
#[cfg(target_feature = "atomics")]
const BINDGEN_PAGES: usize = 1;

#[cfg(target_feature = "atomics")]
unsafe extern "C" {
    /// The end of the memory that the linker lays out: the static data and the main stack.
    static __heap_end: u8;
}

#[cfg(target_feature = "atomics")]
/// Where the heap starts: after the linker's memory and the pages that wasm-bindgen adds.
fn heap_start() -> usize {
    (&raw const __heap_end as usize).next_multiple_of(PAGE) + BINDGEN_PAGES * PAGE
}

#[cfg(target_feature = "atomics")]
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
    Some(hand_out(start, held + grown))
}

/// Gives the allocator `len` bytes at `start` and records how far the heap's memory reaches.
fn hand_out(start: usize, len: usize) -> (*mut u8, usize, u32) {
    TAKEN_END.fetch_max(start + len, Ordering::Release);
    (start as *mut u8, len, 0)
}

/// The end of the memory as far as the heap knows it: this thread's view of its size, or the end
/// of the spare pages, which other threads may have grown past that view.
fn memory_end() -> usize {
    let spare_end =
        SPARE_START.load(Ordering::Relaxed) + SPARE_PAGES.load(Ordering::Relaxed) * PAGE;
    (wasm32::memory_size(0) * PAGE).max(spare_end)
}

/// True when this thread's view of the memory's size ends before the memory that the heap handed out.
fn behind() -> bool {
    wasm32::memory_size(0) * PAGE < TAKEN_END.load(Ordering::Acquire)
}

/// Brings this thread's view of the memory's size up to date when it is behind, by growing the
/// memory by one page on this thread. The page joins the spare pages. Call it under the heap's lock.
fn refresh_locked() {
    if !behind() {
        return;
    }
    let before = wasm32::memory_grow(0, 1);
    if before == usize::MAX {
        return;
    }
    let start = before * PAGE;
    let spare_start = SPARE_START.load(Ordering::Relaxed);
    let spare = SPARE_PAGES.load(Ordering::Relaxed);
    if spare > 0 && spare_start + spare * PAGE == start {
        SPARE_PAGES.store(spare + 1, Ordering::Relaxed);
    } else {
        SPARE_START.store(start, Ordering::Relaxed);
        SPARE_PAGES.store(1, Ordering::Relaxed);
    }
}

/// Brings this thread's view of the memory's size up to date, so that it can copy and fill memory
/// that another thread allocated. A thread calls it before it uses what another thread handed it.
pub fn refresh_view() {
    if behind() {
        HEAP.with(|_| ());
    }
}

/// Whether growing by `pages` would take the pages kept for small requests, while they are still kept.
fn takes_kept_pages(pages: usize) -> bool {
    let maximum = memory_maximum();
    let grown = memory_end() as u64 + pages as u64 * PAGE as u64;
    maximum > 0 && !RESERVE_SPENT.load(Ordering::Relaxed) && grown + HEAP_RESERVE > maximum
}

/// Grows the memory by enough pages for `size` bytes, as the standard system part does, after the
/// spare pages at its end. Under the heap's lock.
fn grow(size: usize) -> (*mut u8, usize, u32) {
    let pages = size.div_ceil(PAGE);
    let spare_start = SPARE_START.load(Ordering::Relaxed);
    let spare = SPARE_PAGES.load(Ordering::Relaxed);
    let region = if spare >= pages {
        SPARE_START.store(spare_start + pages * PAGE, Ordering::Relaxed);
        SPARE_PAGES.store(spare - pages, Ordering::Relaxed);
        hand_out(spare_start, pages * PAGE)
    } else {
        let extra = pages - spare;
        if takes_kept_pages(extra) {
            return (ptr::null_mut(), 0, 0);
        }
        let before = wasm32::memory_grow(0, extra);
        if before == usize::MAX {
            return (ptr::null_mut(), 0, 0);
        }
        SPARE_PAGES.store(0, Ordering::Relaxed);
        if spare_start + spare * PAGE == before * PAGE {
            hand_out(spare_start, pages * PAGE)
        } else {
            // Something outside the heap grew the memory after the spare pages, which are left
            // where they are: the rest comes from growing again, straight after this growth.
            if spare > 0 && wasm32::memory_grow(0, spare) != before + extra {
                return (ptr::null_mut(), 0, 0);
            }
            hand_out(before * PAGE, pages * PAGE)
        }
    };
    // Spare pages that another thread grew can lie past this thread's view of the memory.
    refresh_locked();
    region
}

/// The system part of the heap: it grows the memory, after a first request that takes the pages
/// of a reused memory.
struct Pages {
    first_done: AtomicBool,
}

// SAFETY: each region it hands out is memory that no allocation holds, and it never frees one.
unsafe impl Allocator for Pages {
    fn alloc(&self, size: usize) -> (*mut u8, usize, u32) {
        #[cfg(target_feature = "atomics")]
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

    /// Runs `f` on the allocator under the lock, after it brings this thread's view of the memory's
    /// size up to date: a request can hand the thread memory that another thread grew, which dlmalloc
    /// clears and copies with `memory.fill` and `memory.copy`.
    fn with<T>(&self, f: impl FnOnce(&mut Dlmalloc<Pages>) -> T) -> T {
        let _lock = self.lock();
        refresh_locked();
        // SAFETY: the lock gives this thread the only access.
        f(unsafe { &mut *self.dlmalloc.get() })
    }
}

/// Runs a request. A small one that the heap refuses takes the reserve: first the kept pages, then
/// the held block. A larger one comes back refused, for its caller to report.
fn with_reserve(
    heap: &mut Dlmalloc<Pages>,
    size: usize,
    request: impl Fn(&mut Dlmalloc<Pages>) -> *mut u8,
) -> *mut u8 {
    let got = request(heap);
    if !got.is_null() || size > SMALL_REQUEST {
        return got;
    }
    RESERVE_SPENT.store(true, Ordering::Relaxed);
    let got = request(heap);
    if !got.is_null() {
        return got;
    }
    let held = HELD.swap(0, Ordering::Relaxed);
    if held == 0 {
        return got;
    }
    // SAFETY: the block came from this heap at this size and alignment, and only `HELD` names it.
    unsafe { heap.free(held as *mut u8, HELD_BLOCK, 16) };
    request(heap)
}

/// Takes the block that the heap holds for a browser that refuses growth. A new engine's first call.
pub fn hold_reserve() {
    RESERVE_SPENT.store(false, Ordering::Relaxed);
    if HELD.load(Ordering::Relaxed) == 0 {
        // SAFETY: the size and alignment are valid, and `with_reserve` frees it with the same ones.
        let block = HEAP.with(|heap| unsafe { heap.malloc(HELD_BLOCK, 16) });
        HELD.store(block as usize, Ordering::Relaxed);
    }
}

/// True once a small request has taken the reserve, so the engine should stop with E1109.
pub fn reserve_spent() -> bool {
    RESERVE_SPENT.load(Ordering::Relaxed)
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
        self.with(|heap| {
            with_reserve(heap, layout.size(), |heap| unsafe {
                heap.malloc(layout.size(), layout.align())
            })
        })
    }

    #[inline(never)]
    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        self.with(|heap| {
            with_reserve(heap, layout.size(), |heap| unsafe {
                heap.calloc(layout.size(), layout.align())
            })
        })
    }

    #[inline(never)]
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        self.with(|heap| unsafe { heap.free(ptr, layout.size(), layout.align()) })
    }

    #[inline(never)]
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        self.with(|heap| {
            with_reserve(heap, new_size, |heap| unsafe {
                heap.realloc(ptr, layout.size(), layout.align(), new_size)
            })
        })
    }
}
