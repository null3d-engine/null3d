//! Allocation that reports an error instead of aborting when WebAssembly memory cannot grow, for
//! the arrays whose size the scene's author chooses.

use std::collections::TryReserveError;
use std::sync::atomic::{AtomicU64, Ordering};

/// A vector of `len` copies of `value`, or an error when memory cannot grow for it.
pub fn filled<T: Clone>(len: usize, value: T) -> Result<Vec<T>, TryReserveError> {
    let mut v = Vec::new();
    v.try_reserve_exact(len)?;
    v.resize(len, value);
    Ok(v)
}

/// Makes room in `v` for `len` items in all, without changing its length, so a later resize to
/// `len` cannot fail.
pub fn reserve_len<T>(v: &mut Vec<T>, len: usize) -> Result<(), TryReserveError> {
    v.try_reserve_exact(len.saturating_sub(v.len()))
}

/// Makes room in `v` for `len` items in all, without changing its length, and without freeing the
/// memory it held: a list that the thread that draws still replays may point into it. A larger
/// buffer takes the items, and the old one goes into `kept`, which the owner empties once no list
/// can point into it. The larger buffer at least doubles the old one, as a vector's own growth
/// does, so a size that creeps up from frame to frame moves the buffer only a few times.
pub fn reserve_keeping<T: Copy>(
    v: &mut Vec<T>,
    len: usize,
    kept: &mut Vec<Vec<T>>,
) -> Result<(), TryReserveError> {
    if v.capacity() >= len {
        return Ok(());
    }
    kept.try_reserve(1)?;
    let mut larger = Vec::new();
    larger.try_reserve_exact(len.max(v.capacity().saturating_mul(2)))?;
    larger.extend_from_slice(v);
    kept.push(std::mem::replace(v, larger));
    Ok(())
}

/// The room at the top of the memory that only small requests may take, in bytes. They cannot report
/// a refusal, so the heap keeps this for them, and a frame then stops with E1109 once they have used it.
pub const HEAP_RESERVE: u64 = 8 << 20;

/// The memory's maximum in bytes that this core's page declared, or 0 where the memory has none. It
/// and the sizes it meets are 64-bit, since 4 GiB, the largest maximum, does not fit a 32-bit word.
static MEMORY_MAXIMUM: AtomicU64 = AtomicU64::new(0);

/// Notes the memory's declared maximum in MiB, which [`keep_room`] counts from.
pub fn set_memory_maximum(mib: u32) {
    MEMORY_MAXIMUM.store(mib_bytes(mib), Ordering::Relaxed);
}

/// The bytes in `mib` MiB.
fn mib_bytes(mib: u32) -> u64 {
    u64::from(mib) << 20
}

/// The memory's declared maximum in bytes, or 0 where it has none.
pub fn memory_maximum() -> u64 {
    MEMORY_MAXIMUM.load(Ordering::Relaxed)
}

/// Whether the pages under the memory's maximum hold `bytes`, so that the heap can grow to give them.
fn pages_left_hold(maximum: u64, size: u64, bytes: u64) -> bool {
    maximum > 0 && maximum.saturating_sub(size) >= bytes
}

/// The bytes that the memory holds now, or none where no maximum bounds it.
fn memory_size() -> u64 {
    #[cfg(target_arch = "wasm32")]
    return core::arch::wasm32::memory_size(0) as u64 * 64 * 1024;
    #[cfg(not(target_arch = "wasm32"))]
    0
}

/// Checks that the heap can give `bytes`. A step whose later requests cannot report a refusal calls
/// this first with their sum, so they fit. A memory with that many pages left to grow into needs no
/// request. Only a scene near its limit asks the heap for the bytes and gives them back.
pub fn keep_room(bytes: usize) -> Result<(), TryReserveError> {
    if pages_left_hold(
        MEMORY_MAXIMUM.load(Ordering::Relaxed),
        memory_size(),
        bytes as u64,
    ) {
        return Ok(());
    }
    let mut probe: Vec<u8> = Vec::new();
    probe.try_reserve_exact(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pages_left_under_the_maximum_count_as_room() {
        const MIB: u64 = 1 << 20;
        assert!(pages_left_hold(1024 * MIB, 100 * MIB, 8 * MIB));
        assert!(pages_left_hold(108 * MIB, 100 * MIB, 8 * MIB));
        assert!(!pages_left_hold(107 * MIB, 100 * MIB, 8 * MIB));
        assert!(!pages_left_hold(100 * MIB, 200 * MIB, 8 * MIB));
        // A memory with no maximum known asks the heap.
        assert!(!pages_left_hold(0, 0, 8 * MIB));
    }

    /// The largest maximum a page can declare is 4096 MiB, which a 32-bit word would wrap to 0.
    #[test]
    fn the_largest_maximum_keeps_its_value() {
        assert_eq!(mib_bytes(4096), 4 << 30);
        assert!(pages_left_hold(mib_bytes(4096), 9 << 20, 8 << 20));
        // A memory grown to exactly that maximum has no pages left.
        assert!(!pages_left_hold(mib_bytes(4096), 4 << 30, 8 << 20));
    }

    #[test]
    fn keeping_room_reports_a_request_the_heap_cannot_give() {
        assert!(keep_room(usize::MAX / 2).is_err());
        assert!(keep_room(1024).is_ok());
    }

    #[test]
    fn reserving_keeps_the_old_buffer_where_it_was() {
        let mut v = vec![1u32, 2, 3];
        let mut kept = Vec::new();
        reserve_keeping(&mut v, 2, &mut kept).unwrap();
        assert!(kept.is_empty());
        let old = v.as_ptr();
        reserve_keeping(&mut v, 100, &mut kept).unwrap();
        assert_eq!((v.as_slice(), v.capacity() >= 100), (&[1, 2, 3][..], true));
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].as_ptr(), old);
    }

    #[test]
    fn reserving_a_little_more_doubles_the_buffer() {
        let mut v: Vec<u8> = Vec::with_capacity(1_000);
        let mut kept = Vec::new();
        reserve_keeping(&mut v, 1_001, &mut kept).unwrap();
        assert!(v.capacity() >= 2_000);
        // Sizes up to the doubled room move nothing.
        reserve_keeping(&mut v, 1_900, &mut kept).unwrap();
        assert_eq!(kept.len(), 1);
    }
}
