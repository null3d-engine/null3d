//! Blocking and waking threads on a 32-bit atomic word, with one interface for every build.
//!
//! - WebAssembly with atomics: `memory.atomic.wait32` and `memory.atomic.notify`. Only job
//!   workers call [`wait`]; browsers forbid it on the main thread, and the sketch and render
//!   workers must stay responsive.
//! - Native builds (tests and tools): the operating system's futex, through `atomic-wait`.
//! - Single-threaded WebAssembly: no other thread exists to change the word, so [`wait`] returns
//!   at once and the wake calls do nothing.

use std::sync::atomic::AtomicU32;

/// Blocks while `word` holds `expected`. It can return early (spurious wakeups), so callers
/// re-check their condition in a loop.
#[inline]
pub(crate) fn wait(word: &AtomicU32, expected: u32) {
    imp::wait(word, expected);
}

/// Wakes one thread blocked on `word`.
#[inline]
pub(crate) fn wake_one(word: &AtomicU32) {
    imp::wake_one(word);
}

/// Wakes every thread blocked on `word`.
#[inline]
pub(crate) fn wake_all(word: &AtomicU32) {
    imp::wake_all(word);
}

#[cfg(all(target_arch = "wasm32", target_feature = "atomics"))]
mod imp {
    use core::arch::wasm32::{memory_atomic_notify, memory_atomic_wait32};
    use std::sync::atomic::AtomicU32;

    pub(super) fn wait(word: &AtomicU32, expected: u32) {
        // SAFETY: the pointer comes from a live `AtomicU32`, so it is aligned and valid. The
        // instruction compares and sleeps atomically; a negative timeout waits without limit.
        unsafe {
            memory_atomic_wait32(word.as_ptr().cast::<i32>(), expected as i32, -1);
        }
    }

    pub(super) fn wake_one(word: &AtomicU32) {
        // SAFETY: as in `wait`, the pointer is aligned and valid.
        unsafe {
            memory_atomic_notify(word.as_ptr().cast::<i32>(), 1);
        }
    }

    pub(super) fn wake_all(word: &AtomicU32) {
        // SAFETY: as in `wait`, the pointer is aligned and valid.
        unsafe {
            memory_atomic_notify(word.as_ptr().cast::<i32>(), u32::MAX);
        }
    }
}

#[cfg(not(target_arch = "wasm32"))]
mod imp {
    use std::sync::atomic::AtomicU32;

    pub(super) fn wait(word: &AtomicU32, expected: u32) {
        atomic_wait::wait(word, expected);
    }

    pub(super) fn wake_one(word: &AtomicU32) {
        atomic_wait::wake_one(word);
    }

    pub(super) fn wake_all(word: &AtomicU32) {
        atomic_wait::wake_all(word);
    }
}

#[cfg(all(target_arch = "wasm32", not(target_feature = "atomics")))]
mod imp {
    use std::sync::atomic::AtomicU32;

    pub(super) fn wait(_word: &AtomicU32, _expected: u32) {}

    pub(super) fn wake_one(_word: &AtomicU32) {}

    pub(super) fn wake_all(_word: &AtomicU32) {}
}
