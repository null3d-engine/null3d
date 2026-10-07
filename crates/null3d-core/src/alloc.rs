//! Allocation that reports an error instead of aborting when WebAssembly memory cannot grow, for
//! the arrays whose size the scene's author chooses.

use std::collections::TryReserveError;

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

#[cfg(test)]
mod tests {
    use super::*;

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
