//! Grid cells: cubes of space [`CELL_SIZE`] meters wide that keep positions precise far from the
//! origin.
//!
//! A 32-bit float holds about seven significant digits, so a position 100 km from the origin moves
//! in steps of about 8 mm, and a scene drawn straight from such values jitters. The engine
//! therefore keeps each world matrix relative to the center of a cell:
//!
//! - A root object takes the cell that holds its position. Its children take its cell, because
//!   their matrices build on its matrix.
//! - An instance row takes the cell that holds its position.
//!
//! Each frame the frame builder computes, in 64-bit floats, the offset from the camera to the
//! center of each cell in use, and the GPU adds a source's offset to its cell-relative position.
//! Every position the GPU sees is then relative to the camera, and most precise near it. Static
//! matrices stay on the GPU when the camera moves; only the offsets change.
//!
//! Cell `c` spans `(c - 1/2) × CELL_SIZE` to `(c + 1/2) × CELL_SIZE` along each axis, so the origin
//! cell is centered on the origin, and a scene within 512 m of it uses that cell alone. Splitting a
//! position into its cell and its position relative to the cell's center is exact.
//!
//! # The cell table
//!
//! A [`CellTable`] numbers the cells in use. Index [`ORIGIN_CELL`] is always the origin cell; any
//! other cell takes an index when the first source enters it and gives the index back when the last
//! one leaves. Each source keeps its cell's index. The GPU paths pack that index into the top
//! [`CELL_BITS`] bits of a 32-bit word, beside a row or bucket number in the bits below
//! [`CELL_SHIFT`]. The table allocates everything when it is made. It changes only in the serial
//! steps of the transform and batch updates, never while their parallel loops read it.

use std::simd::StdFloat;
use std::simd::prelude::*;

use crate::world::WorldArrays;

/// The width of a cell along each axis, in meters.
pub const CELL_SIZE: f32 = 1024.0;
/// Half a cell: a position this far from a cell's center, or farther, lies in another cell.
pub const HALF_CELL: f32 = CELL_SIZE / 2.0;
/// Bits of a cell index.
pub const CELL_BITS: u32 = 9;
/// The most cells in use at once, the origin cell included.
pub const MAX_CELLS: u32 = 1 << CELL_BITS;
/// Where a cell index starts in a word that packs it above a row or bucket number.
pub const CELL_SHIFT: u32 = 32 - CELL_BITS;
/// The index of the origin cell, which every source starts in.
pub const ORIGIN_CELL: u32 = 0;

/// A cell's integer coordinates: how many cells it lies from the origin cell along each axis.
pub type CellCoords = [i32; 3];

/// Hash slots of the table: twice the cells, so probes stay short.
const HASH_SLOTS: usize = 2 * MAX_CELLS as usize;

/// The cell that holds `position`: along each axis, the whole number of cells nearest to it, with
/// halves rounded up. Coordinates saturate for positions past about 2 × 10^12 m, and a coordinate
/// that is not a number lands in the origin cell.
#[inline(always)]
pub fn cell_of(position: [f32; 3]) -> CellCoords {
    position.map(|v| {
        let cells = v * (1.0 / CELL_SIZE);
        let nearest = (cells + 0.5).floor();
        // Adding a half can round up to the next whole number, one float below a boundary.
        let nearest = if cells < nearest - 0.5 {
            nearest - 1.0
        } else {
            nearest
        };
        nearest as i32
    })
}

/// The center of a cell. It is exact for cells up to 2^24 cells from the origin cell.
#[inline(always)]
pub fn cell_center(cell: CellCoords) -> [f32; 3] {
    cell.map(|c| c as f32 * CELL_SIZE)
}

/// Splits a position into its cell and its position relative to the cell's center. The relative
/// position is exact: the position and the center are within a factor of two of each other, or the
/// center is 0, so the subtraction rounds nothing.
#[inline(always)]
pub fn split(position: [f32; 3]) -> (CellCoords, [f32; 3]) {
    let cell = cell_of(position);
    let center = cell_center(cell);
    (
        cell,
        [
            position[0] - center[0],
            position[1] - center[1],
            position[2] - center[2],
        ],
    )
}

/// Splits a 64-bit position into its cell and its position relative to the cell's center, rounded
/// once to 32 bits. The cell is the nearest whole number of cells, so the relative position is
/// about half a cell long at most, and keeps a 32-bit float's precision near the cell's center:
/// 0.03 mm or better. Coordinates saturate, and one that is not a number gives the origin cell.
#[inline(always)]
pub fn split64(position: [f64; 3]) -> (CellCoords, [f32; 3]) {
    let size = f64::from(CELL_SIZE);
    let cell = position.map(|v| (v / size + 0.5).floor() as i32);
    let local = std::array::from_fn(|k| (position[k] - f64::from(cell[k]) * size) as f32);
    (cell, local)
}

/// The cell `by` cells along each axis from `cell`. Coordinates saturate, as [`cell_of`]'s do.
#[inline(always)]
pub fn offset_cell(cell: CellCoords, by: CellCoords) -> CellCoords {
    std::array::from_fn(|k| cell[k].saturating_add(by[k]))
}

/// [`split`] for four positions at once, one per lane, with the same operations in the same order,
/// so each lane matches [`split`] bit for bit.
#[inline(always)]
pub(crate) fn split4(position: [f32x4; 3]) -> ([i32x4; 3], [f32x4; 3]) {
    let scale = f32x4::splat(1.0 / CELL_SIZE);
    let half = f32x4::splat(0.5);
    let one = f32x4::splat(1.0);
    let cells = position.map(|v| {
        let cells = v * scale;
        let nearest = (cells + half).floor();
        let over = cells.simd_lt(nearest - half);
        over.select(nearest - one, nearest).cast::<i32>()
    });
    let size = f32x4::splat(CELL_SIZE);
    let local = [
        position[0] - cells[0].cast::<f32>() * size,
        position[1] - cells[1].cast::<f32>() * size,
        position[2] - cells[2].cast::<f32>() * size,
    ];
    (cells, local)
}

/// A position as a cell and a 32-bit position relative to the cell's center.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct CellPosition {
    /// The cell.
    pub cell: CellCoords,
    /// The position relative to the cell's center.
    pub local: [f32; 3],
}

impl CellPosition {
    /// The position in 64-bit floats.
    pub fn absolute(&self) -> [f64; 3] {
        std::array::from_fn(|k| {
            f64::from(self.cell[k]) * f64::from(CELL_SIZE) + f64::from(self.local[k])
        })
    }

    /// The offset from this position to the center of `cell`, computed in 64-bit floats and
    /// rounded once to 32 bits. Added to a position relative to that center, it gives the
    /// position relative to this one.
    pub fn offset_to(&self, cell: CellCoords) -> [f32; 3] {
        std::array::from_fn(|k| {
            let cells = f64::from(cell[k]) - f64::from(self.cell[k]);
            (cells * f64::from(CELL_SIZE) - f64::from(self.local[k])) as f32
        })
    }
}

/// The cells in use, by index. See the module documentation.
#[derive(Clone, Debug)]
pub struct CellTable {
    coords: Vec<CellCoords>,
    /// Sources in each cell. The origin cell is never freed, so its count stays 0.
    counts: Vec<u32>,
    /// Free indices; the table hands out the last one first. It starts with the lowest last.
    free: Vec<u32>,
    /// Open addressing with linear probing: a cell's index plus one, or 0 for an empty slot. The
    /// origin cell is not stored.
    slots: Vec<u32>,
    /// Cells in use besides the origin cell.
    live: u32,
    /// One past the highest index in use.
    end: u32,
    /// Times that a source entered a new cell while the table was full.
    refused: u32,
}

impl Default for CellTable {
    fn default() -> Self {
        Self::new()
    }
}

impl CellTable {
    /// A table that holds the origin cell alone, with room for [`MAX_CELLS`] cells.
    pub fn new() -> Self {
        Self {
            coords: vec![[0; 3]; MAX_CELLS as usize],
            counts: vec![0; MAX_CELLS as usize],
            free: (ORIGIN_CELL + 1..MAX_CELLS).rev().collect(),
            slots: vec![0; HASH_SLOTS],
            live: 0,
            end: ORIGIN_CELL + 1,
            refused: 0,
        }
    }

    /// The coordinates of the cell at `index`.
    #[inline(always)]
    pub fn coords(&self, index: u32) -> CellCoords {
        self.coords[index as usize]
    }

    /// The coordinates of every index, for readers on other threads while the table stays still.
    pub fn all_coords(&self) -> &[CellCoords] {
        &self.coords
    }

    /// The sources in the cell at `index`; 0 for the origin cell and for a free index.
    pub fn count(&self, index: u32) -> u32 {
        self.counts[index as usize]
    }

    /// True when every source lies in the origin cell.
    #[inline(always)]
    pub fn origin_only(&self) -> bool {
        self.live == 0
    }

    /// Cells in use, the origin cell included.
    pub fn len(&self) -> u32 {
        self.live + 1
    }

    /// Always false: the origin cell is always in use.
    pub fn is_empty(&self) -> bool {
        false
    }

    /// One past the highest index in use. Offsets for indices below it cover every cell in use.
    pub fn end(&self) -> u32 {
        self.end
    }

    /// True when the table has no room for another cell.
    pub fn is_full(&self) -> bool {
        self.free.is_empty()
    }

    /// The times that a source entered a new cell while the table was full, so that it went into
    /// the origin cell instead. A moving source counts again on each move that finds no room.
    pub fn refused(&self) -> u32 {
        self.refused
    }

    /// The index of `cell`, when it is in use.
    pub fn find(&self, cell: CellCoords) -> Option<u32> {
        if cell == [0; 3] {
            return Some(ORIGIN_CELL);
        }
        let mask = HASH_SLOTS - 1;
        let mut at = hash(cell);
        loop {
            match self.slots[at] {
                0 => return None,
                entry if self.coords[(entry - 1) as usize] == cell => return Some(entry - 1),
                _ => at = (at + 1) & mask,
            }
        }
    }

    /// Adds one source to `cell` and returns its index, taking a new index when the cell was not
    /// in use. Returns `None` when the cell is new and the table is full, and counts the refusal.
    pub fn acquire(&mut self, cell: CellCoords) -> Option<u32> {
        if let Some(index) = self.find(cell) {
            self.retain(index);
            return Some(index);
        }
        let Some(index) = self.free.pop() else {
            self.refused = self.refused.saturating_add(1);
            return None;
        };
        let mask = HASH_SLOTS - 1;
        let mut at = hash(cell);
        while self.slots[at] != 0 {
            at = (at + 1) & mask;
        }
        self.slots[at] = index + 1;
        self.coords[index as usize] = cell;
        self.counts[index as usize] = 1;
        self.live += 1;
        self.end = self.end.max(index + 1);
        Some(index)
    }

    /// Adds one source to the cell at `index`, which is in use.
    #[inline(always)]
    pub fn retain(&mut self, index: u32) {
        if index != ORIGIN_CELL {
            self.counts[index as usize] += 1;
        }
    }

    /// Removes one source from the cell at `index`, and frees the index when the cell empties.
    #[inline(always)]
    pub fn release(&mut self, index: u32) {
        self.release_many(index, 1);
    }

    /// Removes `n` sources from the cell at `index`, and frees the index when the cell empties.
    pub fn release_many(&mut self, index: u32, n: u32) {
        if index == ORIGIN_CELL || n == 0 {
            return;
        }
        let count = &mut self.counts[index as usize];
        debug_assert!(*count >= n, "cell {index} holds {count} sources, not {n}");
        *count = count.saturating_sub(n);
        if *count == 0 {
            self.remove(index);
        }
    }

    /// Frees `index`: takes it out of the hash slots with backward-shift deletion, so no
    /// tombstones build up, and lowers the end past free indices.
    fn remove(&mut self, index: u32) {
        let mask = HASH_SLOTS - 1;
        let mut hole = hash(self.coords[index as usize]);
        while self.slots[hole] != index + 1 {
            hole = (hole + 1) & mask;
        }
        let mut next = hole;
        loop {
            next = (next + 1) & mask;
            let entry = self.slots[next];
            if entry == 0 {
                break;
            }
            let home = hash(self.coords[(entry - 1) as usize]);
            // The entry may move into the hole when its home slot is not between the hole and it.
            let stays = if hole <= next {
                hole < home && home <= next
            } else {
                hole < home || home <= next
            };
            if !stays {
                self.slots[hole] = entry;
                hole = next;
            }
        }
        self.slots[hole] = 0;
        self.coords[index as usize] = [0; 3];
        self.free.push(index);
        self.live -= 1;
        while self.end > ORIGIN_CELL + 1 && self.counts[(self.end - 1) as usize] == 0 {
            self.end -= 1;
        }
    }

    /// Writes the offset from `camera` to the center of each cell below [`CellTable::end`] into
    /// `out`, as `(x, y, z, 0)`, and returns how many it wrote. A free index gets zeros.
    ///
    /// # Panics
    /// When `out` is shorter than [`CellTable::end`].
    pub fn write_offsets(&self, camera: &CellPosition, out: &mut [[f32; 4]]) -> usize {
        let end = self.end as usize;
        for (index, offset) in out[..end].iter_mut().enumerate() {
            *offset = if index == ORIGIN_CELL as usize || self.counts[index] > 0 {
                let [x, y, z] = camera.offset_to(self.coords[index]);
                [x, y, z, 0.0]
            } else {
                [0.0; 4]
            };
        }
        end
    }
}

/// Moves the source in `row` of `world` out of cell `old` and into `cell`, the cell that holds its
/// position, and returns that cell's index. The row's matrix is already relative to that cell.
/// When the table has no room for a new cell, the source goes into the origin cell instead, and
/// its row moves there, with the precision of a 32-bit translation.
pub(crate) fn enter_cell(
    table: &mut CellTable,
    world: &mut WorldArrays,
    row: usize,
    cell: CellCoords,
    old: u32,
) -> u32 {
    let index = table.acquire(cell).unwrap_or_else(|| {
        world.shift_row(row, cell_center(cell));
        ORIGIN_CELL
    });
    table.release(old);
    index
}

/// The home slot of a cell in the table's hash slots.
#[inline(always)]
fn hash(cell: CellCoords) -> usize {
    let h = (cell[0] as u32).wrapping_mul(0x9E37_79B1)
        ^ (cell[1] as u32).wrapping_mul(0x85EB_CA77)
        ^ (cell[2] as u32).wrapping_mul(0xC2B2_AE3D);
    (h ^ (h >> 15)) as usize & (HASH_SLOTS - 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_origin_cell_is_centred_on_the_origin() {
        assert_eq!(cell_of([0.0, 511.9, -512.0]), [0, 0, 0]);
        assert_eq!(cell_of([512.0, -512.1, 1535.9]), [1, -1, 1]);
        assert_eq!(cell_of([1536.0, -1536.0, 0.0]), [2, -1, 0]);
        assert_eq!(cell_of([f32::NAN, 0.0, 0.0]), [0, 0, 0]);
        assert_eq!(
            cell_of([f32::INFINITY, f32::NEG_INFINITY, 0.0])[..2],
            [i32::MAX, i32::MIN]
        );
    }

    #[test]
    fn a_split_is_exact() {
        for position in [
            [100_000.25, -3.5, 1.0e6],
            [6_378_137.0, 511.999_97, -512.0],
            [-1.0e9, 0.1, 99_999.99],
        ] {
            let (cell, local) = split(position);
            for k in 0..3 {
                assert!(local[k].abs() <= HALF_CELL, "{position:?}: {local:?}");
                let back = f64::from(cell[k]) * f64::from(CELL_SIZE) + f64::from(local[k]);
                assert_eq!(back, f64::from(position[k]), "{position:?}, axis {k}");
            }
        }
    }

    #[test]
    fn a_64_bit_split_keeps_a_tenth_of_a_millimeter_at_the_earths_radius() {
        for position in [
            [6_378_137.000_1, -0.000_05, 1_000_000.333_3],
            [-6_378_137.75, 511.999_9, -512.000_1],
            [4.0e9, 1_536.0, -1_535.999_9],
        ] {
            let (cell, local) = split64(position);
            for k in 0..3 {
                assert!(local[k].abs() <= HALF_CELL, "{position:?}: {local:?}");
                let back = f64::from(cell[k]) * f64::from(CELL_SIZE) + f64::from(local[k]);
                assert!((back - position[k]).abs() < 3e-5, "{position:?}, axis {k}");
            }
        }
        // A 32-bit position there is off by up to 0.25 m.
        let rounded = f64::from(6_378_137.3f64 as f32);
        assert!((rounded - 6_378_137.3).abs() > 0.1);
        // The cell of a 32-bit position is the one that `cell_of` gives it.
        for v in [6_378_137.0f32, -512.0, 512.0, 1_535.999_9, -1.0e9] {
            assert_eq!(split64([f64::from(v); 3]).0, cell_of([v; 3]), "{v}");
        }
        assert_eq!(
            split64([f64::NAN, f64::INFINITY, f64::NEG_INFINITY]).0,
            [0, i32::MAX, i32::MIN]
        );
        assert_eq!(offset_cell([i32::MAX, -3, 4], [1, 5, -4]), [i32::MAX, 2, 0]);
    }

    #[test]
    fn four_lanes_split_like_one() {
        let xs = [0.0, 511.999_97, -512.0, 1.0e7];
        let ys = [100_000.25, -700.5, 3.0, f32::NAN];
        let zs = [-1.0e6, 2.5, 512.0, -0.0];
        let (cells, local) = split4([
            f32x4::from_array(xs),
            f32x4::from_array(ys),
            f32x4::from_array(zs),
        ]);
        for lane in 0..4 {
            let (cell, one) = split([xs[lane], ys[lane], zs[lane]]);
            for k in 0..3 {
                assert_eq!(cells[k].to_array()[lane], cell[k]);
                assert_eq!(local[k].to_array()[lane].to_bits(), one[k].to_bits());
            }
        }
    }

    #[test]
    fn offsets_are_computed_in_64_bits() {
        // A camera 1,000 km out, a little way into its cell.
        let camera = CellPosition {
            cell: [976, 0, -977],
            local: [-0.1, 1.5, 511.75],
        };
        let far = camera.absolute();
        assert_eq!(far, [999_424.0 - f64::from(0.1f32), 1.5, -999_936.25]);
        // A cell next to the camera's keeps the camera's fraction of a meter.
        assert_eq!(camera.offset_to([977, 0, -977]), [1024.1, -1.5, -511.75]);
        // The same offset from absolute 32-bit positions is off by 2.5 cm.
        let camera_x = 976.0f32 * CELL_SIZE + -0.1;
        assert_eq!(cell_center([977, 0, -977])[0] - camera_x, 1024.125);
        // A cell past the Earth's radius from the camera rounds only once.
        let beyond = camera.offset_to([976 + 7_000, 0, -977]);
        assert_eq!(
            beyond[0],
            (7_000.0 * f64::from(CELL_SIZE) + f64::from(0.1f32)) as f32
        );
    }

    #[test]
    fn cells_take_and_give_back_indices() {
        let mut table = CellTable::new();
        assert!(table.origin_only());
        assert_eq!(table.acquire([0, 0, 0]), Some(ORIGIN_CELL));
        assert!(table.origin_only(), "the origin cell counts no sources");
        let a = table.acquire([97, 0, 0]).unwrap();
        let b = table.acquire([-6_229, 3, 1]).unwrap();
        assert_eq!((a, b), (1, 2));
        assert_eq!(table.acquire([97, 0, 0]), Some(a));
        assert_eq!((table.count(a), table.len(), table.end()), (2, 3, 3));
        assert_eq!(table.find([-6_229, 3, 1]), Some(b));
        assert_eq!(table.coords(b), [-6_229, 3, 1]);

        table.release(b);
        assert_eq!((table.find([-6_229, 3, 1]), table.end()), (None, 2));
        table.release(a);
        assert_eq!(table.find([97, 0, 0]), Some(a), "one source is left");
        table.release(a);
        assert!(table.origin_only());
        assert_eq!(table.end(), 1);
        // The last index freed is the first handed out again.
        assert_eq!(table.acquire([5, 5, 5]), Some(1));
    }

    #[test]
    fn a_full_table_refuses_new_cells_and_keeps_its_own() {
        let mut table = CellTable::new();
        for k in 1..MAX_CELLS as i32 {
            assert_eq!(table.acquire([k, -k, k * 7]), Some(k as u32));
        }
        assert!(table.is_full());
        assert_eq!(table.refused(), 0);
        assert_eq!(table.acquire([0, 1, 0]), None);
        assert_eq!(table.acquire([3, -3, 21]), Some(3));
        // Only the cell that found no room counts as refused.
        assert_eq!(table.refused(), 1);
        // Every cell is still found after removals shift the probe chains. Cell 3 holds two
        // sources, so it stays.
        for k in (3..MAX_CELLS as i32).step_by(3) {
            table.release(k as u32);
        }
        for k in 1..MAX_CELLS as i32 {
            let expected = (k % 3 != 0 || k == 3).then_some(k as u32);
            assert_eq!(table.find([k, -k, k * 7]), expected, "cell {k}");
        }
        assert_eq!(table.acquire([0, 1, 0]), Some(510));
        assert_eq!(table.refused(), 1);
    }

    #[test]
    fn offsets_cover_the_cells_in_use() {
        let mut table = CellTable::new();
        let a = table.acquire([2, 0, 0]).unwrap();
        let b = table.acquire([0, 0, -1]).unwrap();
        table.release(a);
        let camera = CellPosition {
            cell: [0, 0, 0],
            local: [1.0, 2.0, 3.0],
        };
        let mut out = [[9.0; 4]; MAX_CELLS as usize];
        assert_eq!(table.write_offsets(&camera, &mut out), 3);
        assert_eq!(out[0], [-1.0, -2.0, -3.0, 0.0]);
        assert_eq!(out[a as usize], [0.0; 4]);
        assert_eq!(out[b as usize], [-1.0, -2.0, -1027.0, 0.0]);
    }
}
