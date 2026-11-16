//! Ranges inside one large GPU buffer, placed in constant time by Sebastian Aaltonen's offset
//! allocator.
//!
//! A buffer's ranges come and go: a model's vertices, an instance batch's rows, a staged copy.
//! A placement that appends only keeps the ranges that stay packed, but a range that leaves
//! leaves a hole, and closing the hole moves every range after it and uploads their bytes again.
//! This allocator places a new range in a hole at once, and it moves nothing. A range that leaves
//! merges with the free ranges beside it, so neighbouring holes become one range again.
//!
//! Each range's size picks a bin of the size class that fits it. A class is a power of two with
//! three mantissa bits, so a class holds sizes within an eighth of each other, and a request's
//! remaining waste stays under about 12%. The free lists of the bins, the bitmap that finds a
//! non-empty bin, and the doubly linked list of neighbouring ranges each take constant time. One
//! placement pops a node from a bin, and a range that leaves pushes its neighbour nodes back.
//!
//! The allocator reserves node slots at construction, so placing and freeing never allocate. A
//! request that no free range fits fails with [`AllocError::OutOfSpace`], which names the largest
//! free range.
//!
//! Offsets and sizes count in units of a granularity that the caller chooses: a vertex stride, a
//! word, or a GPU offset's alignment. Every offset is a whole number of units.

/// Top bins: each covers a factor of two, apart from the sizes below the mantissa.
pub const TOP_BINS: usize = 32;
/// Leaf bins of each top bin.
pub const LEAF_BINS: usize = 8;
/// Classes in all: a leaf bin of a top bin.
const CLASSES: usize = TOP_BINS * LEAF_BINS;
/// Bits of a class's mantissa.
const MANTISSA_BITS: u32 = 3;
/// Values that a mantissa holds, which the sizes below it use as themselves.
const MANTISSA_VALUE: u32 = 1 << MANTISSA_BITS;
/// The mask of a mantissa.
const MANTISSA_MASK: u32 = MANTISSA_VALUE - 1;
/// The value that names no node.
const NO_NODE: u32 = u32::MAX;

/// A range that the allocator placed, in units of its granularity.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct OffsetAllocation {
    /// The first unit of the range.
    pub offset: u32,
    /// The units that the request asked for, which the range holds or more.
    pub size: u32,
    /// The allocator's node of the range, which freeing it names.
    node: u32,
}

/// Why the allocator refused a request or could not be made.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AllocError {
    /// No free range fits the request: every free range is smaller than it.
    OutOfSpace {
        /// The units that the request asked for.
        requested: u32,
        /// The largest free range, in units.
        largest_free: u32,
    },
    /// The request names no unit. A range holds at least one unit.
    EmptyRequest,
    /// Every node slot is in use: each live range and each split needs one. Raise the node count
    /// that the allocator was made with.
    TooManyNodes {
        /// The node slots that the allocator was made with.
        nodes: u32,
    },
    /// The engine's memory could not grow by the bytes that the allocator needs.
    OutOfMemory {
        /// The bytes that the allocator needs.
        bytes: u64,
    },
}

/// The bytes of an allocator: free, in use and in all.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct StorageReport {
    /// The bytes that every free range holds together, the waste inside the classes included.
    pub free: u64,
    /// The bytes of the largest free range: no request larger than this fits.
    pub largest_free: u64,
    /// The bytes that the ranges in use asked for.
    pub used: u64,
    /// The buffer's bytes.
    pub capacity: u64,
}

/// One range of the buffer: free or in use.
#[derive(Clone, Copy, Debug)]
struct Node {
    /// Its first unit.
    offset: u32,
    /// Its size in units, or for a range in use the size that its request asked for.
    size: u32,
    /// True while a caller holds the range.
    used: bool,
    /// Its neighbour with a lower offset, or [`NO_NODE`].
    previous: u32,
    /// Its neighbour with a higher offset, or [`NO_NODE`].
    next: u32,
    /// The free range before it in its bin's list, or [`NO_NODE`].
    bin_previous: u32,
    /// The free range after it in its bin's list, or [`NO_NODE`].
    bin_next: u32,
}

impl Default for Node {
    fn default() -> Self {
        Self {
            offset: 0,
            size: 0,
            used: false,
            previous: NO_NODE,
            next: NO_NODE,
            bin_previous: NO_NODE,
            bin_next: NO_NODE,
        }
    }
}

/// The head of each class's list of free ranges: the node, or [`NO_NODE`].
const NO_CLASS: u32 = NO_NODE;

/// Ranges inside one buffer, placed and freed in constant time.
#[derive(Debug)]
pub struct OffsetAllocator {
    /// The bytes of one unit.
    unit: u32,
    /// The buffer's size in units.
    capacity: u32,
    /// The units that every free range holds together.
    free: u32,
    /// The nodes of every free range that no bin holds: a stack that placing a range pops.
    free_nodes: Vec<u32>,
    /// The top bins that hold a free range.
    used_top: u32,
    /// The leaf bins of each top bin that hold a free range.
    used_leaves: [u8; TOP_BINS],
    /// The head of each class's list of free ranges.
    bins: [u32; CLASSES],
    /// The range of each node index.
    nodes: Vec<Node>,
    /// The live ranges.
    allocations: u32,
    /// The node with the lowest offset.
    first_node: u32,
}

impl OffsetAllocator {
    /// An allocator of `capacity` units, each of `unit` bytes, with room for `nodes` nodes: one
    /// for each live range and one for each free range that a split makes. Each plausible
    /// workload needs about as many nodes as it holds live ranges, plus a few. A unit of 0 counts
    /// as one byte. Fails when memory cannot grow for the node slots.
    pub fn new(capacity: u32, unit: u32, nodes: u32) -> Result<Self, AllocError> {
        let mut allocator = Self {
            unit: unit.max(1),
            capacity,
            free: 0,
            free_nodes: Vec::new(),
            used_top: 0,
            used_leaves: [0; TOP_BINS],
            bins: [NO_CLASS; CLASSES],
            nodes: Vec::new(),
            allocations: 0,
            first_node: NO_NODE,
        };
        allocator
            .nodes
            .try_reserve_exact(nodes as usize)
            .map_err(|_| AllocError::OutOfMemory {
                bytes: nodes as u64 * size_of::<Node>() as u64,
            })?;
        allocator.nodes.resize(nodes as usize, Node::default());
        allocator
            .free_nodes
            .try_reserve_exact(nodes as usize)
            .map_err(|_| AllocError::OutOfMemory {
                bytes: nodes as u64 * size_of::<u32>() as u64,
            })?;
        allocator.free_nodes.extend((0..nodes).rev());
        if capacity > 0 {
            if nodes == 0 {
                return Err(AllocError::TooManyNodes { nodes });
            }
            let index = allocator.take_node()?;
            allocator.nodes[index as usize] = Node {
                size: capacity,
                ..Node::default()
            };
            allocator.first_node = index;
            allocator.insert_into_bin(capacity, index);
        }
        Ok(allocator)
    }

    /// The bytes of one unit.
    pub fn unit(&self) -> u32 {
        self.unit
    }

    /// The buffer's size in bytes.
    pub fn capacity_bytes(&self) -> u64 {
        u64::from(self.capacity) * u64::from(self.unit)
    }

    /// The live ranges.
    pub fn len(&self) -> u32 {
        self.allocations
    }

    /// True when no range is in use.
    pub fn is_empty(&self) -> bool {
        self.allocations == 0
    }

    /// Places a range of `units` units, and returns it. The range moves nothing: its offset is
    /// the first free range of a class that fits, or a part of one.
    ///
    /// A request's class starts at a size at least as large as the request, so the class's first
    /// range always fits. That leaves one case where a free range fits but its class is too low:
    /// the range's size and the request share a class, and the range is the smaller of the two.
    /// The allocator then searches the free ranges for the smallest that fits, which costs one
    /// pass over them. Only a request that would otherwise be refused pays that pass.
    ///
    /// # Errors
    /// [`AllocError::OutOfSpace`] when no free range fits, which names the largest free range;
    /// [`AllocError::EmptyRequest`] for a request of no units, since a range holds at least one;
    /// and [`AllocError::TooManyNodes`] when every node slot is in use.
    pub fn alloc(&mut self, units: u32) -> Result<OffsetAllocation, AllocError> {
        if units == 0 {
            return Err(AllocError::EmptyRequest);
        }
        let least = class_of_request(units);
        let least_top = (least / LEAF_BINS as u32) as usize;
        let least_leaf = (least % LEAF_BINS as u32) as usize;
        let mut found = None;
        if self.used_top & (1 << least_top) != 0 {
            let mask = u32::from(u8::MAX) << least_leaf;
            let above = u32::from(self.used_leaves[least_top]) & mask;
            if above != 0 {
                let leaf = above.trailing_zeros() as usize;
                found = Some(least_top * LEAF_BINS + leaf);
            }
        }
        let class = match found {
            Some(class) => class,
            None => {
                // Every class above this top bin holds ranges at least as large as its least
                // size, which fits the request.
                let above = if least_top + 1 < TOP_BINS {
                    self.used_top >> (least_top + 1)
                } else {
                    0
                };
                if above == 0 {
                    // A lower class may still hold a range that fits, as the docs say.
                    return self.place_fitting(units);
                }
                let top = least_top + 1 + above.trailing_zeros() as usize;
                let leaf = self.used_leaves[top].trailing_zeros() as usize;
                top * LEAF_BINS + leaf
            }
        };
        let index = self.bins[class];
        debug_assert_ne!(index, NO_NODE);
        if self.nodes[index as usize].size < units {
            // The only case that this class cannot serve, explained above.
            return self.place_fitting(units);
        }
        self.place_in_class(class, index, units)
    }

    /// Places a request in the free range `index` of class `class`.
    fn place_in_class(
        &mut self,
        class: usize,
        index: u32,
        units: u32,
    ) -> Result<OffsetAllocation, AllocError> {
        let node = self.nodes[index as usize];
        let remainder = node.size - units;
        // A split needs a node slot of its own, which a full allocator cannot give.
        if remainder > 0 && self.free_nodes.is_empty() {
            return Err(AllocError::TooManyNodes {
                nodes: self.nodes.len() as u32,
            });
        }
        self.unlink_from_bin(class, index);
        self.nodes[index as usize].size = units;
        self.nodes[index as usize].used = true;
        self.allocations += 1;
        if remainder > 0 {
            let made = self.take_node()?;
            let at = node.offset + units;
            self.nodes[made as usize] = Node {
                offset: at,
                size: remainder,
                ..Node::default()
            };
            self.insert_into_bin(remainder, made);
            self.link_neighbours(index, Some(made));
        }
        Ok(OffsetAllocation {
            offset: node.offset,
            size: units,
            node: index,
        })
    }

    /// Places a request in the smallest free range that fits, which the fast path missed. Costs
    /// one pass over the free ranges, and runs only where the allocator would otherwise refuse.
    fn place_fitting(&mut self, units: u32) -> Result<OffsetAllocation, AllocError> {
        let mut best: Option<u32> = None;
        let mut largest = 0;
        let mut at = self.first_node;
        while at != NO_NODE {
            let node = self.nodes[at as usize];
            if !node.used {
                largest = largest.max(node.size);
                if node.size >= units
                    && best.is_none_or(|b| node.size < self.nodes[b as usize].size)
                {
                    best = Some(at);
                }
            }
            at = node.next;
        }
        match best {
            Some(index) => {
                let class = class_of_range(self.nodes[index as usize].size) as usize;
                self.place_in_class(class, index, units)
            }
            None => Err(AllocError::OutOfSpace {
                requested: units,
                largest_free: largest,
            }),
        }
    }

    /// Gives a range back, and merges it with each free range beside it. Moves nothing.
    pub fn free(&mut self, allocation: OffsetAllocation) {
        let index = allocation.node;
        let node = self.nodes[index as usize];
        debug_assert!(node.used, "a range is freed once");
        let mut offset = node.offset;
        let mut size = node.size;
        if node.previous != NO_NODE && !self.nodes[node.previous as usize].used {
            let previous = self.nodes[node.previous as usize];
            offset = previous.offset;
            size += previous.size;
            self.remove_from_bin(node.previous);
            self.nodes[index as usize].previous = previous.previous;
        }
        if node.next != NO_NODE && !self.nodes[node.next as usize].used {
            let next = self.nodes[node.next as usize];
            size += next.size;
            self.remove_from_bin(node.next);
            self.nodes[index as usize].next = next.next;
        }
        let previous = self.nodes[index as usize].previous;
        let next = self.nodes[index as usize].next;
        self.nodes[index as usize].used = false;
        self.allocations -= 1;
        // The merged range takes the node that the freed range held.
        self.nodes[index as usize] = Node {
            offset,
            size,
            ..Node::default()
        };
        self.insert_into_bin(size, index);
        if previous != NO_NODE {
            self.nodes[previous as usize].next = index;
            self.nodes[index as usize].previous = previous;
        } else {
            // The merged range reaches the start of the buffer, so it is the first one.
            self.first_node = index;
        }
        if next != NO_NODE {
            self.nodes[next as usize].previous = index;
            self.nodes[index as usize].next = next;
        }
    }

    /// The free bytes and the largest free range. The largest is exact: the highest non-empty
    /// class holds the largest free range, and its list is scanned for the largest of them.
    pub fn report(&self) -> StorageReport {
        let mut used = 0u64;
        for node in &self.nodes {
            if node.used {
                used += u64::from(node.size);
            }
        }
        StorageReport {
            free: u64::from(self.free) * u64::from(self.unit),
            largest_free: u64::from(self.largest_free_units()) * u64::from(self.unit),
            used: used * u64::from(self.unit),
            capacity: self.capacity_bytes(),
        }
    }

    /// The largest free range, in units.
    pub fn largest_free_units(&self) -> u32 {
        let Some(top) = self.highest_top_bin() else {
            return 0;
        };
        let leaves = self.used_leaves[top];
        if leaves == 0 {
            return 0;
        }
        let leaf = 31 - u32::from(leaves).leading_zeros();
        let class = top * LEAF_BINS + leaf as usize;
        let mut largest = 0;
        let mut index = self.bins[class];
        while index != NO_NODE {
            largest = largest.max(self.nodes[index as usize].size);
            index = self.nodes[index as usize].bin_next;
        }
        largest
    }

    /// The units that every free range holds together.
    pub fn free_units(&self) -> u32 {
        self.free
    }

    /// The top bin with the largest free ranges, or `None` when every range is in use.
    fn highest_top_bin(&self) -> Option<usize> {
        if self.used_top == 0 {
            None
        } else {
            Some(31 - self.used_top.leading_zeros() as usize)
        }
    }

    /// Takes a node from the stack, or fails when every slot is in use.
    fn take_node(&mut self) -> Result<u32, AllocError> {
        self.free_nodes.pop().ok_or(AllocError::TooManyNodes {
            nodes: self.nodes.len() as u32,
        })
    }

    /// Puts a free range into its class's list, which a placement of that class pops.
    fn insert_into_bin(&mut self, size: u32, index: u32) {
        let class = class_of_range(size) as usize;
        let top = class / LEAF_BINS;
        let leaf = class % LEAF_BINS;
        let head = self.bins[class];
        if head == NO_NODE {
            self.used_leaves[top] |= 1 << leaf;
            self.used_top |= 1 << top;
        }
        self.nodes[index as usize].bin_previous = NO_NODE;
        self.nodes[index as usize].bin_next = head;
        if head != NO_NODE {
            self.nodes[head as usize].bin_previous = index;
        }
        self.bins[class] = index;
        self.free += size;
    }

    /// Takes a free range out of its class's list and returns its node to the stack.
    fn remove_from_bin(&mut self, index: u32) {
        let class = class_of_range(self.nodes[index as usize].size) as usize;
        self.unlink_from_bin(class, index);
        self.free_nodes.push(index);
    }

    /// Takes a free range out of its class's list, without returning its node: a placement takes
    /// the node for the range that it places.
    fn unlink_from_bin(&mut self, class: usize, index: u32) {
        let node = self.nodes[index as usize];
        let top = class / LEAF_BINS;
        let leaf = class % LEAF_BINS;
        if node.bin_previous != NO_NODE {
            self.nodes[node.bin_previous as usize].bin_next = node.bin_next;
        } else {
            self.bins[class] = node.bin_next;
        }
        if node.bin_next != NO_NODE {
            self.nodes[node.bin_next as usize].bin_previous = node.bin_previous;
        }
        if self.bins[class] == NO_NODE {
            self.used_leaves[top] &= !(1 << leaf);
            if self.used_leaves[top] == 0 {
                self.used_top &= !(1 << top);
            }
        }
        self.free -= node.size;
        self.nodes[index as usize].bin_previous = NO_NODE;
        self.nodes[index as usize].bin_next = NO_NODE;
    }

    /// Links `made` after `node` in the list of ranges by offset, which is empty until then.
    fn link_neighbours(&mut self, node: u32, made: Option<u32>) {
        let Some(made) = made else { return };
        let next = self.nodes[node as usize].next;
        self.nodes[made as usize].previous = node;
        self.nodes[made as usize].next = next;
        if next != NO_NODE {
            self.nodes[next as usize].previous = made;
        }
        self.nodes[node as usize].next = made;
    }
}

/// The class whose least size fits a request of `size` units: the least class at or above it.
#[inline]
fn class_of_request(size: u32) -> u32 {
    if size < MANTISSA_VALUE {
        return size;
    }
    let highest = 31 - size.leading_zeros();
    let start = highest - MANTISSA_BITS;
    let exponent = start + 1;
    let mut mantissa = (size >> start) & MANTISSA_MASK;
    if size & ((1 << start) - 1) != 0 {
        mantissa += 1;
    }
    // A mantissa that rounds past its range spills into the next exponent, as a float's does.
    (exponent << MANTISSA_BITS) + mantissa
}

/// The class that holds a free range of `size` units: the greatest class at or below it.
#[inline]
fn class_of_range(size: u32) -> u32 {
    if size < MANTISSA_VALUE {
        return size;
    }
    let highest = 31 - size.leading_zeros();
    let start = highest - MANTISSA_BITS;
    let exponent = start + 1;
    let mantissa = (size >> start) & MANTISSA_MASK;
    (exponent << MANTISSA_BITS) | mantissa
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The least size of a class, in units.
    fn class_size(class: u32) -> u32 {
        let exponent = class >> MANTISSA_BITS;
        let mantissa = class & MANTISSA_MASK;
        if exponent == 0 {
            mantissa
        } else {
            (mantissa | MANTISSA_VALUE) << (exponent - 1)
        }
    }

    /// A placement that covers the buffer, with no two ranges overlapping.
    fn check_placement(allocator: &OffsetAllocator, held: &[OffsetAllocation]) {
        let mut ranges: Vec<(u32, u32)> =
            held.iter().map(|a| (a.offset, a.offset + a.size)).collect();
        ranges.sort_unstable();
        for pair in ranges.windows(2) {
            assert!(
                pair[0].1 <= pair[1].0,
                "ranges {:?} and {:?} overlap",
                pair[0],
                pair[1]
            );
        }
        for allocation in held {
            assert!(allocation.size > 0);
            assert!(allocation.offset + allocation.size <= allocator.capacity);
        }
        // Every unit of the buffer belongs to exactly one live range or to free space.
        let report = allocator.report();
        assert_eq!(
            report.used,
            u64::from(allocator.unit) * u64::from(sum(held))
        );
        assert_eq!(
            report.capacity,
            report.used + report.free,
            "the report adds up"
        );
        assert!(report.largest_free <= report.free);
    }

    fn invariants(allocator: &OffsetAllocator) {
        let mut total = 0u32;
        let mut free_count = 0u32;
        let mut free = 0u32;
        let mut linked = 0u32;
        let mut at = allocator.first_node;
        while at != NO_NODE {
            let node = allocator.nodes[at as usize];
            total += node.size;
            if !node.used {
                free_count += 1;
                free += node.size;
            }
            linked += 1;
            assert!(
                linked <= allocator.nodes.len() as u32,
                "the neighbour list ends"
            );
            at = node.next;
        }
        assert_eq!(total, allocator.capacity, "nodes cover the buffer");
        assert_eq!(
            free_count + allocator.allocations + allocator.free_nodes.len() as u32,
            allocator.nodes.len() as u32,
            "every node is a live range, a free range, or a spare slot"
        );
        assert_eq!(free, allocator.free, "free bytes add up");
    }

    fn sum(held: &[OffsetAllocation]) -> u32 {
        held.iter().map(|a| a.size).sum()
    }

    #[test]
    fn ranges_are_placed_without_overlap_and_freed_once() {
        let mut allocator = OffsetAllocator::new(1000, 4, 64).unwrap();
        let mut held = Vec::new();
        for size in [10u32, 20, 30, 40, 50] {
            let allocation = allocator.alloc(size).unwrap();
            assert_eq!(allocation.size, size);
            held.push(allocation);
        }
        check_placement(&allocator, &held);
        assert_eq!(allocator.free_units(), 1000 - sum(&held));
        for allocation in held.drain(..) {
            allocator.free(allocation);
        }
        assert!(allocator.is_empty());
        assert_eq!(allocator.free_units(), 1000);
        assert_eq!(allocator.largest_free_units(), 1000);
        let report = allocator.report();
        assert_eq!(report.free, 4000);
        assert_eq!(report.largest_free, 4000);
        assert_eq!(report.used, 0);
    }

    #[test]
    fn a_freed_range_merges_with_both_neighbours_into_one() {
        let mut allocator = OffsetAllocator::new(300, 1, 16).unwrap();
        let first = allocator.alloc(100).unwrap();
        let middle = allocator.alloc(100).unwrap();
        let last = allocator.alloc(100).unwrap();
        assert_eq!(allocator.largest_free_units(), 0);
        allocator.free(middle);
        assert_eq!(allocator.largest_free_units(), 100);
        allocator.free(first);
        assert_eq!(allocator.largest_free_units(), 200);
        allocator.free(last);
        assert_eq!(allocator.largest_free_units(), 300);
        assert_eq!(allocator.free_units(), 300);
        // One free range in all, so the allocator holds one node for it.
        assert_eq!(allocator.bins.iter().filter(|&&b| b != NO_NODE).count(), 1);
    }

    #[test]
    fn a_freed_range_satisfies_the_next_request_for_its_size() {
        let mut allocator = OffsetAllocator::new(64, 1, 16).unwrap();
        let first = allocator.alloc(8).unwrap();
        let second = allocator.alloc(8).unwrap();
        assert_ne!(first.offset, second.offset);
        allocator.free(first);
        let again = allocator.alloc(8).unwrap();
        assert_eq!(again.offset, first.offset);
    }

    #[test]
    fn a_request_that_does_not_fit_names_the_largest_free_range() {
        let mut allocator = OffsetAllocator::new(100, 1, 8).unwrap();
        let big = allocator.alloc(60).unwrap();
        let small = allocator.alloc(30).unwrap();
        assert_eq!(
            allocator.alloc(20),
            Err(AllocError::OutOfSpace {
                requested: 20,
                largest_free: 10
            })
        );
        allocator.free(big);
        assert_eq!(allocator.alloc(20).unwrap().size, 20);
        allocator.free(small);
        assert_eq!(allocator.largest_free_units(), 100 - 20);
    }

    #[test]
    fn a_request_that_fits_a_lower_class_still_uses_its_own() {
        // A range in a lower class may still fit a request, but the allocator takes the least
        // class at or above the request, so the waste stays under one class's width.
        let mut allocator = OffsetAllocator::new(1000, 1, 8).unwrap();
        let first = allocator.alloc(500).unwrap();
        let second = allocator.alloc(400).unwrap();
        allocator.free(first);
        // The hole is 500 units, and the request 450: the class of 450 starts at 448, so it fits.
        let again = allocator.alloc(450).unwrap();
        assert_eq!(again.offset, first.offset);
        assert!(again.size >= 450);
        let _ = second;
    }

    #[test]
    fn every_unit_is_placed_once_through_a_long_churn() {
        let mut allocator = OffsetAllocator::new(4096, 16, 1024).unwrap();
        let mut held: Vec<OffsetAllocation> = Vec::new();
        // A deterministic mix of sizes and frees, with no randomness in the test.
        let mut seed = 0x1234_5678u32;
        for _step in 0..20_000u32 {
            seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            if held.len() > 200 || (seed >> 28).is_multiple_of(3) {
                let index = (seed as usize) % held.len().max(1);
                if !held.is_empty() {
                    let allocation = held.swap_remove(index);
                    allocator.free(allocation);
                }
            }
            invariants(&allocator);
            let units = 1 + (seed >> 10) % 700;
            if let Ok(allocation) = allocator.alloc(units) {
                held.push(allocation);
            }
            invariants(&allocator);
        }
        check_placement(&allocator, &held);
        let report = allocator.report();
        assert!(report.largest_free <= report.free);
        assert_eq!(report.capacity, report.free + report.used);
        for allocation in held.drain(..) {
            allocator.free(allocation);
        }
        assert_eq!(allocator.free_units(), 4096);
        assert_eq!(allocator.largest_free_units(), 4096);
    }

    #[test]
    fn a_busy_allocator_refuses_with_its_node_count() {
        let mut allocator = OffsetAllocator::new(1000, 1, 2).unwrap();
        allocator.alloc(100).unwrap();
        assert_eq!(
            allocator.alloc(100),
            Err(AllocError::TooManyNodes { nodes: 2 })
        );
    }

    #[test]
    fn a_request_of_no_units_is_refused() {
        let mut allocator = OffsetAllocator::new(10, 1, 4).unwrap();
        assert_eq!(allocator.alloc(0), Err(AllocError::EmptyRequest));
    }

    #[test]
    fn the_classes_fit_the_sizes_that_they_hold() {
        for size in 1..100_000u32 {
            let request = class_of_request(size);
            let range = class_of_range(size);
            assert!(
                class_size(request) >= size,
                "the request's class fits {size}"
            );
            assert!(class_size(range) <= size, "the range's class holds {size}");
        }
    }

    #[test]
    fn a_placement_wastes_under_an_eighth_of_a_class() {
        // A request's class starts at most an eighth of the class above it, so the waste stays
        // under 12.5% for sizes past the mantissa's own range.
        for size in 64..64_000u32 {
            let request = class_of_request(size);
            let least = class_size(request);
            assert!(least >= size);
            assert!(
                (least - size) * 8 <= least,
                "the waste of {size} stays small"
            );
        }
    }
}
