//! The memory register: the bytes that each engine table reserves, uses and has used at most, for
//! the stats overlay's development figures.
//!
//! A table reports its own figures when the overlay asks, through [`MemoryRegister::add`]. Nothing
//! runs while no development page shows the overlay, and a report allocates nothing: each table
//! sums the capacities and lengths of the arrays that it owns.
//!
//! `reserved` is the memory an array holds, `used` the part of it that holds values, and `peak` the
//! most that an area has used since the engine started. An allocator that reuses its memory every
//! frame, such as an upload arena, reports its own high-water mark, so a report that misses a busy
//! frame still shows the peak.
//!
//! The areas are numbered for the page, which names them. Keep [`area`] and
//! `packages/engine/src/shared/memory-area.ts` in step.

/// Bytes of one table or allocator.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct MemoryUse {
    /// Bytes that the table's arrays hold.
    pub reserved: u64,
    /// Bytes of them that hold values.
    pub used: u64,
    /// The most bytes that the table has used, as its owner knows it: an array that only grows uses
    /// what it holds, and a reused allocator reports its high-water mark. A zero leaves the peak to
    /// the register, which keeps the most that a report saw.
    pub peak: u64,
}

impl MemoryUse {
    /// The bytes that an array of `reserved` bytes holds, `used` of them in use.
    pub const fn new(reserved: u64, used: u64) -> Self {
        Self {
            reserved,
            used,
            peak: used,
        }
    }

    /// As [`MemoryUse::new`], with the most bytes that the table has used.
    pub const fn with_peak(reserved: u64, used: u64, peak: u64) -> Self {
        Self {
            reserved,
            used,
            peak,
        }
    }

    /// Adds another table's figures to these.
    pub fn add(&mut self, other: Self) {
        self.reserved = self.reserved.saturating_add(other.reserved);
        self.used = self.used.saturating_add(other.used);
        self.peak = self.peak.max(other.peak);
    }
}

/// The bytes that a growable array holds and uses.
pub fn vec_bytes<T>(v: &Vec<T>) -> MemoryUse {
    let size = size_of::<T>() as u64;
    MemoryUse::new(v.capacity() as u64 * size, v.len() as u64 * size)
}

/// The bytes that a fixed array holds and uses.
pub fn buffer_bytes<T>(v: &[T]) -> MemoryUse {
    let bytes = v.len() as u64 * size_of::<T>() as u64;
    MemoryUse::new(bytes, bytes)
}

/// The areas that the stats overlay lists, in its order.
pub mod area {
    /// The scene's own arrays: positions, parents, meshes and the world output.
    pub const SCENE: usize = 0;
    /// Instance batches: the rows of every batch and the batch table.
    pub const INSTANCES: usize = 1;
    /// The grid cells that scene objects and instance rows occupy.
    pub const CELLS: usize = 2;
    /// The scene's level-of-detail table.
    pub const LEVELS: usize = 3;
    /// The frame builder's shared scratch for the bucket keys of a layout rebuild.
    pub const BUCKET_KEYS: usize = 4;
    /// The shadow casters' layout: each casting source's bucket, layer and range.
    pub const CASTERS: usize = 5;
    /// The other draw layouts: the sources that the camera, the outline and the subsurface view
    /// draw.
    pub const LAYOUTS: usize = 6;
    /// The upload arenas that a frame copies its uniforms and small tables into.
    pub const UPLOADS: usize = 7;
    /// The recorded draw lists, and the snapshots that the still-camera accumulation keeps.
    pub const DRAW_LISTS: usize = 8;
    /// The animation table: skeletons, clips and the animated instances' matrices.
    pub const ANIMATION: usize = 9;
}

/// The number of areas.
pub const AREA_COUNT: usize = 10;

/// What each area reserved and used in the last report, and the most that it has used since the
/// register was made.
#[derive(Clone, Debug, Default)]
pub struct MemoryRegister {
    areas: [MemoryUse; AREA_COUNT],
}

impl MemoryRegister {
    /// An empty register.
    pub const fn new() -> Self {
        Self {
            areas: [MemoryUse::new(0, 0); AREA_COUNT],
        }
    }

    /// Starts a report: clears what each area reserved and used, and keeps its peak.
    pub fn begin(&mut self) {
        for area in &mut self.areas {
            area.reserved = 0;
            area.used = 0;
        }
    }

    /// Adds a table's figures to its area.
    ///
    /// # Panics
    /// When `area` is not one of [`area`]'s constants.
    pub fn add(&mut self, area: usize, table: MemoryUse) {
        let slot = &mut self.areas[area];
        slot.reserved = slot.reserved.saturating_add(table.reserved);
        slot.used = slot.used.saturating_add(table.used);
        slot.peak = slot.peak.max(table.peak).max(slot.used);
    }

    /// One area's figures.
    pub fn area(&self, area: usize) -> MemoryUse {
        self.areas[area]
    }

    /// Every area's figures, in the order of [`area`].
    pub fn areas(&self) -> &[MemoryUse; AREA_COUNT] {
        &self.areas
    }

    /// Writes three numbers per area, in order: its reserved bytes, its used bytes and its peak.
    ///
    /// # Panics
    /// When `out` is shorter than three numbers per area.
    pub fn report(&self, out: &mut [f64]) {
        assert!(out.len() >= AREA_COUNT * 3, "room for every area's figures");
        for (k, area) in self.areas.iter().enumerate() {
            out[k * 3] = area.reserved as f64;
            out[k * 3 + 1] = area.used as f64;
            out[k * 3 + 2] = area.peak as f64;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_report_clears_the_figures_and_keeps_the_peaks() {
        let mut register = MemoryRegister::new();
        register.begin();
        register.add(area::SCENE, MemoryUse::new(1_000, 800));
        assert_eq!(register.area(area::SCENE), MemoryUse::new(1_000, 800));
        register.begin();
        assert_eq!(register.area(area::SCENE), MemoryUse::with_peak(0, 0, 800));
        register.add(area::SCENE, MemoryUse::new(400, 300));
        assert_eq!(
            register.area(area::SCENE),
            MemoryUse::with_peak(400, 300, 800)
        );
    }

    #[test]
    fn tables_in_one_area_add_up() {
        let mut register = MemoryRegister::new();
        register.begin();
        register.add(area::LAYOUTS, MemoryUse::new(100, 60));
        register.add(area::LAYOUTS, MemoryUse::new(50, 40));
        assert_eq!(register.area(area::LAYOUTS), MemoryUse::new(150, 100));
    }

    #[test]
    fn a_tables_own_peak_outlasts_a_report() {
        let mut register = MemoryRegister::new();
        register.begin();
        register.add(area::UPLOADS, MemoryUse::with_peak(100, 20, 90));
        register.begin();
        assert_eq!(register.area(area::UPLOADS).peak, 90);
    }

    #[test]
    fn an_array_counts_the_room_it_reserved() {
        let mut v: Vec<u32> = Vec::with_capacity(10);
        v.extend_from_slice(&[1, 2, 3]);
        assert_eq!(vec_bytes(&v), MemoryUse::new(40, 12));
        assert_eq!(buffer_bytes(&[0u8; 7][..]), MemoryUse::new(7, 7));
    }

    #[test]
    fn the_report_writes_three_numbers_for_each_area() {
        let mut register = MemoryRegister::new();
        register.begin();
        register.add(area::CELLS, MemoryUse::new(9, 4));
        let mut out = [0.0; AREA_COUNT * 3];
        register.report(&mut out);
        assert_eq!(&out[area::CELLS * 3..][..3], &[9.0, 4.0, 4.0]);
        assert_eq!(&out[area::SCENE * 3..][..3], &[0.0, 0.0, 0.0]);
    }
}
