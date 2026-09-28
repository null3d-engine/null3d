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
