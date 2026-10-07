//! A fixed-length bitset stored as 64-bit words, so loops can skip 64 clear bits at a time.
//!
//! WebAssembly is little-endian, so TypeScript can view the words as a `Uint32Array`: bit `i` is
//! bit `i % 32` of 32-bit word `i / 32`.

use std::collections::TryReserveError;

use crate::alloc::{filled, reserve_len};

/// A bitset with a fixed number of bits, which only [`Bitset::grow`] changes. Bits past [`Bitset::len`] in the last
/// word are always clear.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Bitset {
    words: Vec<u64>,
    len: u32,
}

impl Bitset {
    /// A bitset of `len` clear bits.
    pub fn new(len: u32) -> Self {
        let Ok(bits) = Self::try_new(len) else {
            panic!("no memory for a bitset")
        };
        bits
    }

    /// A bitset of `len` clear bits, or an error when memory cannot grow for it.
    pub fn try_new(len: u32) -> Result<Self, TryReserveError> {
        Ok(Self {
            words: filled(len.div_ceil(64) as usize, 0)?,
            len,
        })
    }

    /// Makes room for `len` bits without changing the length, so [`Bitset::grow`] to `len` cannot
    /// fail.
    pub fn try_reserve(&mut self, len: u32) -> Result<(), TryReserveError> {
        reserve_len(&mut self.words, len.div_ceil(64) as usize)
    }

    /// Lengthens the bitset to `len` bits, the new ones clear. A shorter `len` does nothing.
    pub fn grow(&mut self, len: u32) {
        if len > self.len {
            self.words.resize(len.div_ceil(64) as usize, 0);
            self.len = len;
        }
    }

    /// The number of bits.
    pub fn len(&self) -> u32 {
        self.len
    }

    /// True when the bitset holds no bits at all (a length of zero).
    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    /// The words, 64 bits each, lowest bit first.
    pub fn words(&self) -> &[u64] {
        &self.words
    }

    /// The words, for bulk writes. Callers must keep bits past [`Bitset::len`] clear.
    pub fn words_mut(&mut self) -> &mut [u64] {
        &mut self.words
    }

    /// True when bit `i` is set. Bits past the length read as clear.
    #[inline]
    pub fn get(&self, i: u32) -> bool {
        i < self.len && self.words[(i / 64) as usize] & (1 << (i % 64)) != 0
    }

    /// Sets bit `i`.
    ///
    /// # Panics
    /// When `i` is past the length.
    #[inline]
    pub fn set(&mut self, i: u32) {
        assert!(
            i < self.len,
            "bit {i} is past the bitset length {}",
            self.len
        );
        self.words[(i / 64) as usize] |= 1 << (i % 64);
    }

    /// Clears bit `i`. Bits past the length are ignored.
    #[inline]
    pub fn clear(&mut self, i: u32) {
        if i < self.len {
            self.words[(i / 64) as usize] &= !(1 << (i % 64));
        }
    }

    /// Sets `count` bits starting at `start`, a word at a time.
    ///
    /// # Panics
    /// When the range goes past the length.
    pub fn set_range(&mut self, start: u32, count: u32) {
        if count == 0 {
            return;
        }
        let end = start
            .checked_add(count)
            .filter(|&end| end <= self.len)
            .expect("bit range is past the bitset length");
        let (first, last) = ((start / 64) as usize, ((end - 1) / 64) as usize);
        let head = !0u64 << (start % 64);
        let tail = !0u64 >> (63 - (end - 1) % 64);
        if first == last {
            self.words[first] |= head & tail;
        } else {
            self.words[first] |= head;
            self.words[first + 1..last].fill(!0);
            self.words[last] |= tail;
        }
    }

    /// Clears every bit.
    pub fn clear_all(&mut self) {
        self.words.fill(0);
    }

    /// True when any bit is set.
    pub fn any(&self) -> bool {
        self.words.iter().any(|&w| w != 0)
    }

    /// The number of set bits.
    pub fn count_ones(&self) -> u32 {
        self.words.iter().map(|w| w.count_ones()).sum()
    }

    /// The first set bit at or after `from`.
    pub fn next_set(&self, from: u32) -> Option<u32> {
        if from >= self.len {
            return None;
        }
        let mut w = (from / 64) as usize;
        let mut word = self.words[w] & (!0u64 << (from % 64));
        loop {
            if word != 0 {
                return Some(w as u32 * 64 + word.trailing_zeros());
            }
            w += 1;
            word = *self.words.get(w)?;
        }
    }

    /// The first clear bit at or after `from`, or the length when every later bit is set.
    pub fn next_clear(&self, from: u32) -> u32 {
        if from >= self.len {
            return self.len;
        }
        let mut w = (from / 64) as usize;
        let mut word = !self.words[w] & (!0u64 << (from % 64));
        loop {
            if word != 0 {
                return (w as u32 * 64 + word.trailing_zeros()).min(self.len);
            }
            w += 1;
            match self.words.get(w) {
                Some(&next) => word = !next,
                None => return self.len,
            }
        }
    }

    /// The indices of the set bits in increasing order, found 64 bits at a time.
    pub fn iter_ones(&self) -> Ones<'_> {
        Ones {
            words: &self.words,
            word: 0,
            bits: self.words.first().copied().unwrap_or(0),
        }
    }

    /// The maximal runs of set bits in increasing order, as `(start, count)` pairs.
    pub fn runs(&self) -> Runs<'_> {
        Runs { set: self, pos: 0 }
    }
}

/// The iterator [`Bitset::iter_ones`] returns.
#[derive(Clone, Debug)]
pub struct Ones<'a> {
    words: &'a [u64],
    word: usize,
    bits: u64,
}

impl Iterator for Ones<'_> {
    type Item = u32;

    #[inline]
    fn next(&mut self) -> Option<u32> {
        while self.bits == 0 {
            self.word += 1;
            self.bits = *self.words.get(self.word)?;
        }
        let bit = self.bits.trailing_zeros();
        self.bits &= self.bits - 1;
        Some(self.word as u32 * 64 + bit)
    }
}

/// The iterator [`Bitset::runs`] returns.
#[derive(Clone, Debug)]
pub struct Runs<'a> {
    set: &'a Bitset,
    pos: u32,
}

impl Iterator for Runs<'_> {
    type Item = (u32, u32);

    fn next(&mut self) -> Option<(u32, u32)> {
        let start = self.set.next_set(self.pos)?;
        let end = self.set.next_clear(start);
        self.pos = end;
        Some((start, end - start))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A small deterministic generator for test data.
    fn lcg(state: &mut u64) -> u32 {
        *state = state
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        (*state >> 33) as u32
    }

    fn naive_runs(bits: &[bool]) -> Vec<(u32, u32)> {
        let mut out = Vec::new();
        let mut i = 0;
        while i < bits.len() {
            if bits[i] {
                let start = i;
                while i < bits.len() && bits[i] {
                    i += 1;
                }
                out.push((start as u32, (i - start) as u32));
            } else {
                i += 1;
            }
        }
        out
    }

    #[test]
    fn grow_keeps_bits_and_adds_clear_ones() {
        let mut b = Bitset::new(70);
        b.set(3);
        b.set(69);
        b.try_reserve(200).unwrap();
        assert_eq!(b.len(), 70);
        b.grow(200);
        assert_eq!((b.len(), b.words().len()), (200, 4));
        assert_eq!(b.iter_ones().collect::<Vec<_>>(), [3, 69]);
        b.set(199);
        b.grow(100);
        assert_eq!(b.len(), 200);
        assert_eq!(b.next_clear(69), 70);
    }

    #[test]
    fn set_get_clear() {
        let mut b = Bitset::new(130);
        assert_eq!(b.words().len(), 3);
        b.set(0);
        b.set(64);
        b.set(129);
        assert!(b.get(0) && b.get(64) && b.get(129));
        assert!(!b.get(1) && !b.get(130) && !b.get(1000));
        assert_eq!(b.count_ones(), 3);
        b.clear(64);
        assert!(!b.get(64));
        b.clear_all();
        assert!(!b.any());
    }

    #[test]
    fn ranges_match_a_naive_model() {
        let mut state = 1;
        for len in [1u32, 63, 64, 65, 127, 128, 129, 300] {
            let mut b = Bitset::new(len);
            let mut model = vec![false; len as usize];
            for _ in 0..40 {
                let start = lcg(&mut state) % len;
                let count = lcg(&mut state) % (len - start + 1);
                b.set_range(start, count);
                for m in &mut model[start as usize..(start + count) as usize] {
                    *m = true;
                }
                let ones: Vec<u32> = b.iter_ones().collect();
                let expected: Vec<u32> = (0..len).filter(|&i| model[i as usize]).collect();
                assert_eq!(ones, expected, "len {len}");
                assert_eq!(b.runs().collect::<Vec<_>>(), naive_runs(&model));
                if lcg(&mut state).is_multiple_of(4) {
                    b.clear_all();
                    model.fill(false);
                }
            }
            // Bits past the length stay clear.
            let spare = b.words().len() as u32 * 64 - len;
            if spare > 0 {
                assert_eq!(b.words().last().unwrap() >> (64 - spare), 0);
            }
        }
    }

    #[test]
    fn next_set_and_next_clear_stop_at_the_length() {
        let mut b = Bitset::new(70);
        b.set_range(0, 70);
        assert_eq!(b.next_clear(0), 70);
        assert_eq!(b.next_set(69), Some(69));
        assert_eq!(b.next_set(70), None);
        assert_eq!(b.runs().collect::<Vec<_>>(), vec![(0, 70)]);
        let empty = Bitset::new(0);
        assert_eq!(empty.iter_ones().count(), 0);
        assert_eq!(empty.runs().count(), 0);
    }
}
