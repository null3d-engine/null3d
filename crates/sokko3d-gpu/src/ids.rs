//! Resource ids. The core names every GPU object by a small integer. Only the thread that owns the
//! GPU holds the real browser objects, in tables indexed by these ids. Id 0 means "none".

/// Hands out ids from 1 up to a fixed capacity, reusing released ids. Allocates only at creation.
#[derive(Debug)]
pub struct IdAllocator {
    next: u32,
    capacity: u32,
    free: Vec<u32>,
}

impl IdAllocator {
    pub fn with_capacity(capacity: u32) -> Self {
        Self {
            next: 1,
            capacity,
            free: Vec::with_capacity(capacity as usize),
        }
    }

    /// A fresh id, or `None` when every id is in use.
    pub fn allocate(&mut self) -> Option<u32> {
        if let Some(id) = self.free.pop() {
            return Some(id);
        }
        if self.next > self.capacity {
            return None;
        }
        let id = self.next;
        self.next += 1;
        Some(id)
    }

    /// Returns an id for reuse.
    pub fn release(&mut self, id: u32) {
        debug_assert!(
            id != 0 && id < self.next,
            "released an id this allocator never gave out"
        );
        if self.free.len() < self.free.capacity() {
            self.free.push(id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_start_at_one_reuse_released_ids_and_stop_at_capacity() {
        let mut ids = IdAllocator::with_capacity(3);
        assert_eq!(
            (ids.allocate(), ids.allocate(), ids.allocate()),
            (Some(1), Some(2), Some(3))
        );
        assert_eq!(ids.allocate(), None);
        ids.release(2);
        assert_eq!(ids.allocate(), Some(2));
    }
}
