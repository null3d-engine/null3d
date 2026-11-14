//! Chunked per-instance rows: a cloud cut into chunks, each stored in the core's memory in
//! importance order, and the pass that packs each chunk's chosen prefix into an instance batch's
//! rows. The splats add-on stores its chunks here and asks the core to pack them, so no frame
//! copies rows into the batch from the sketch's heap and no loop over instances runs in
//! TypeScript (hard rule 42).
//!
//! A chunk arrives once, at load, and the add-on writes its arrays straight into this table's
//! memory. The pack then copies the chosen prefix of each chunk, in chunk order, into the batch's
//! rows and sets the batch's active count. It marks the packed range for upload, so a static batch
//! uploads only what changed. The pack allocates nothing: every array is made when a chunk arrives,
//! which is a load step, never a frame step.
//!
//! Each cloud owns its own run of chunk places, so several clouds of one scene share the table
//! without their slots meeting.

use std::collections::TryReserveError;

use crate::error::CoreError;
use crate::instances::InstanceBatch;
use crate::memory::{MemoryRegister, MemoryUse, area, vec_bytes};

/// The positions of a chunk's rows: three floats for each.
pub const POSITIONS: u32 = 0;
/// The rotations of a chunk's rows: four floats for each, as unit quaternions.
pub const ROTATIONS: u32 = 1;
/// The scales of a chunk's rows: three floats for each.
pub const SCALES: u32 = 2;
/// The colors of a chunk's rows: four floats for each, linear RGBA.
pub const COLORS: u32 = 3;
/// The share of the chunk's surface that each prefix covers, one float for each prefix length.
/// The add-on measures it when it cuts the chunk.
pub const COVERAGE: u32 = 4;

/// One chunk's rows, in importance order: its whole count, and the arrays that the add-on wrote.
#[derive(Debug)]
struct ChunkRows {
    count: u32,
    positions: Vec<f32>,
    rotations: Vec<f32>,
    scales: Vec<f32>,
    colors: Vec<f32>,
    /// The share of the chunk's surface that each prefix covers, from the whole chunk down to one
    /// splat, at prefix lengths that halve every two steps. The add-on measures it when it cuts
    /// the chunk, so a pack reads a prefix's share rather than measuring the chunk again.
    coverage: Vec<f32>,
}

/// The most that a prefix's splats grow, so a chunk far away never draws as a few large blobs.
const MOST_GROWTH: f32 = 3.0;

/// The number of prefix shares that a chunk of `count` rows holds: the whole chunk, then each
/// prefix the square root of two times shorter.
fn coverage_steps(count: u32) -> usize {
    if count <= 1 {
        1
    } else {
        // The reference computes this in double precision, so the two packs agree on the step
        // count for every chunk size rather than on most of them.
        (2.0 * f64::from(count).log2()).floor() as usize + 1
    }
}

impl ChunkRows {
    /// Makes room for `count` rows of every array.
    fn try_new(count: u32) -> Result<Self, TryReserveError> {
        let count = count as usize;
        let mut rows = Self {
            count: count as u32,
            positions: Vec::new(),
            rotations: Vec::new(),
            scales: Vec::new(),
            colors: Vec::new(),
            coverage: Vec::new(),
        };
        rows.positions.try_reserve_exact(count * 3)?;
        rows.rotations.try_reserve_exact(count * 4)?;
        rows.scales.try_reserve_exact(count * 3)?;
        rows.colors.try_reserve_exact(count * 4)?;
        rows.coverage
            .try_reserve_exact(coverage_steps(count as u32))?;
        rows.positions.resize(count * 3, 0.0);
        rows.rotations.resize(count * 4, 0.0);
        rows.scales.resize(count * 3, 0.0);
        rows.colors.resize(count * 4, 0.0);
        rows.coverage.resize(coverage_steps(count as u32), 1.0);
        Ok(rows)
    }

    /// The bytes that the chunk's arrays hold.
    fn memory_use(&self) -> MemoryUse {
        let mut use_ = MemoryUse::default();
        for array in [
            vec_bytes(&self.positions),
            vec_bytes(&self.rotations),
            vec_bytes(&self.scales),
            vec_bytes(&self.colors),
            vec_bytes(&self.coverage),
        ] {
            use_.add(array);
        }
        use_
    }

    /// The address of the first float of one array, or 0 for a field this chunk does not have.
    fn field(&self, field: u32) -> usize {
        let array = match field {
            POSITIONS => &self.positions,
            ROTATIONS => &self.rotations,
            SCALES => &self.scales,
            COLORS => &self.colors,
            COVERAGE => &self.coverage,
            _ => return 0,
        };
        if array.is_empty() {
            0
        } else {
            array.as_ptr() as usize
        }
    }
}

/// One cloud's chunk places, in the order that the add-on names them.
#[derive(Debug, Default)]
struct CloudChunks {
    chunks: Vec<Option<ChunkRows>>,
}

/// The chunks that clouds pack into instance batches' rows, one run of places for each cloud.
#[derive(Debug, Default)]
pub struct ChunkRowTable {
    clouds: Vec<Option<CloudChunks>>,
}

impl ChunkRowTable {
    /// Makes room for `slots` chunk places in `cloud`'s run. A pack never grows the run between
    /// frames.
    pub fn reserve(&mut self, cloud: u32, slots: u32) -> Result<(), CoreError> {
        let cloud = cloud as usize;
        if cloud >= self.clouds.len() {
            self.clouds
                .try_reserve(cloud + 1 - self.clouds.len())
                .map_err(|_| CoreError::OutOfMemory {
                    bytes: u32::try_from((cloud + 1) * size_of::<Option<CloudChunks>>())
                        .unwrap_or(u32::MAX),
                })?;
            self.clouds.resize_with(cloud + 1, || None);
        }
        let entry = &mut self.clouds[cloud];
        if entry.is_none() {
            *entry = Some(CloudChunks::default());
        }
        let chunks = &mut entry.as_mut().expect("the cloud was just made").chunks;
        let slots = slots as usize;
        if slots <= chunks.len() {
            return Ok(());
        }
        chunks
            .try_reserve(slots - chunks.len())
            .map_err(|_| CoreError::OutOfMemory {
                bytes: u32::try_from(slots.saturating_mul(size_of::<Option<ChunkRows>>()))
                    .unwrap_or(u32::MAX),
            })?;
        chunks.resize_with(slots, || None);
        Ok(())
    }

    /// Stores `count` rows at `slot` of `cloud`, replacing what the slot held. The add-on then
    /// writes the arrays at the addresses that [`Self::field`] gives.
    pub fn prepare(&mut self, cloud: u32, slot: u32, count: u32) -> Result<(), CoreError> {
        self.reserve(cloud, slot + 1)?;
        let chunks = &mut self
            .clouds
            .get_mut(cloud as usize)
            .and_then(Option::as_mut)
            .expect("the cloud was just reserved")
            .chunks;
        let rows = ChunkRows::try_new(count).map_err(|_| CoreError::OutOfMemory {
            bytes: u32::try_from(count as u64 * 60).unwrap_or(u32::MAX),
        })?;
        chunks[slot as usize] = Some(rows);
        Ok(())
    }

    /// The address of a chunk's array, or 0 for a cloud, slot or field that holds none.
    pub fn field(&self, cloud: u32, slot: u32, field: u32) -> usize {
        self.chunk(cloud, slot).map_or(0, |rows| rows.field(field))
    }

    /// The number of rows that a chunk holds, or 0 for a slot that holds none.
    pub fn count(&self, cloud: u32, slot: u32) -> u32 {
        self.chunk(cloud, slot).map_or(0, |rows| rows.count)
    }

    /// Forgets a chunk, so its slot draws nothing.
    pub fn destroy(&mut self, cloud: u32, slot: u32) {
        if let Some(chunks) = self
            .clouds
            .get_mut(cloud as usize)
            .and_then(Option::as_mut)
            .map(|cloud| &mut cloud.chunks)
            && let Some(place) = chunks.get_mut(slot as usize)
        {
            *place = None;
        }
    }

    /// Forgets every chunk of a cloud, which a page frees with the cloud.
    pub fn drop_cloud(&mut self, cloud: u32) {
        if let Some(entry) = self.clouds.get_mut(cloud as usize) {
            *entry = None;
        }
    }

    /// Adds the bytes that the chunks hold to the memory register.
    pub fn account(&self, register: &mut MemoryRegister) {
        let mut use_ = vec_bytes(&self.clouds);
        for cloud in self.clouds.iter().flatten() {
            use_.add(vec_bytes(&cloud.chunks));
            for rows in cloud.chunks.iter().flatten() {
                use_.add(rows.memory_use());
            }
        }
        register.add(area::INSTANCES, use_);
    }

    /// Writes each chunk's chosen prefix into the batch's rows, in slot order, and sets the
    /// batch's active count. A slot without a chunk, or with a chosen count of zero or less,
    /// writes nothing. Returns the batch's active count after the pack: the rows it wrote, no more
    /// than the batch's capacity, or the count that the batch keeps when it owns no transform rows.
    pub fn pack(
        &self,
        cloud: u32,
        batch: &mut InstanceBatch,
        counts: &[f32],
    ) -> Result<u32, CoreError> {
        // A batch that reads another batch's rows, or a sprite or line batch, holds no transform
        // arrays. It takes no chunked rows, and the pack answers the count that it keeps, so a
        // caller that reads the rows that draw sees the same count the batch has.
        if batch.positions().is_empty() || batch.rotations().is_empty() || batch.scales().is_empty()
        {
            return Ok(batch.active_count());
        }
        let capacity = batch.capacity() as usize;
        let colors = !batch.colors().is_empty();
        let chunks = self
            .clouds
            .get(cloud as usize)
            .and_then(Option::as_ref)
            .map(|cloud| cloud.chunks.as_slice())
            .unwrap_or(&[]);
        let mut at = 0usize;
        for (slot, rows) in chunks.iter().enumerate() {
            let Some(rows) = rows else { continue };
            let chosen = counts.get(slot).copied().unwrap_or(0.0);
            let chosen = if chosen.is_finite() && chosen > 0.0 {
                chosen as u32
            } else {
                0
            };
            let count = chosen.min(rows.count) as usize;
            if count == 0 {
                continue;
            }
            let take = count.min(capacity - at);
            if take == 0 {
                break;
            }
            let end = at + take;
            batch.positions_mut()[at * 3..end * 3].copy_from_slice(&rows.positions[..take * 3]);
            batch.rotations_mut()[at * 4..end * 4].copy_from_slice(&rows.rotations[..take * 4]);
            // A prefix keeps part of the chunk, so it grows the splats it keeps to cover what
            // the whole chunk covered. The reference states the same rule in TypeScript.
            let growth = growth_of(rows, count);
            let out = &mut batch.scales_mut()[at * 3..end * 3];
            if growth == 1.0 {
                out.copy_from_slice(&rows.scales[..take * 3]);
            } else {
                for (to, from) in out.iter_mut().zip(&rows.scales[..take * 3]) {
                    *to = from * growth;
                }
            }
            if colors {
                batch.colors_mut()[at * 4..end * 4].copy_from_slice(&rows.colors[..take * 4]);
            }
            at = end;
            if at == capacity {
                break;
            }
        }
        batch.set_active_count(at as u32)?;
        if at > 0 {
            batch.mark_dirty(0, at as u32)?;
        }
        Ok(at as u32)
    }

    fn chunk(&self, cloud: u32, slot: u32) -> Option<&ChunkRows> {
        self.clouds
            .get(cloud as usize)
            .and_then(Option::as_ref)
            .and_then(|cloud| cloud.chunks.get(slot as usize))
            .and_then(Option::as_ref)
    }
}

/// The share of a chunk's surface that its first `kept` rows cover, read from the table that the
/// add-on measured, between the two prefix lengths the table holds.
fn coverage_at(coverage: &[f32], count: usize, kept: usize) -> f32 {
    if kept >= count || coverage.len() < 2 {
        return 1.0;
    }
    let ratio = count as f32 / kept.max(1) as f32;
    let step = (2.0 * ratio.log2()).min((coverage.len() - 1) as f32);
    let low = step.floor() as usize;
    let high = (low + 1).min(coverage.len() - 1);
    let t = step - low as f32;
    coverage[low] * (1.0 - t) + coverage[high] * t
}

/// The factor that a chunk's first `count` rows grow by, so that together they cover what the
/// whole chunk covers: 1 for the whole chunk, and at most the cap for a small prefix.
fn growth_of(rows: &ChunkRows, count: usize) -> f32 {
    if count >= rows.count as usize {
        return 1.0;
    }
    let share = coverage_at(&rows.coverage, rows.count as usize, count);
    // A prefix that covers nothing draws as few, large splats as the cap allows.
    if share <= 0.0 {
        return MOST_GROWTH;
    }
    (1.0 / share).sqrt().clamp(1.0, MOST_GROWTH)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The cloud number that the tests use.
    const CLOUD: u32 = 1;

    /// A batch of `capacity` rows with row colors, as the splats draw makes.
    fn batch(capacity: u32) -> InstanceBatch {
        InstanceBatch::new(capacity, false, true, 1, 1, 1.0)
    }

    /// A chunk whose positions and colors name it, so a test can tell the rows apart.
    fn chunk(table: &mut ChunkRowTable, slot: u32, name: f32, count: u32) {
        table.prepare(CLOUD, slot, count).unwrap();
        let positions = table.field(CLOUD, slot, POSITIONS) as *mut f32;
        let colors = table.field(CLOUD, slot, COLORS) as *mut f32;
        for i in 0..count as usize {
            unsafe {
                *positions.add(i * 3) = name;
                *colors.add(i * 4) = name;
            }
        }
    }

    /// A chunk of `count` rows whose coverage table is the shares given, as the add-on measured
    /// them when it cut the chunk.
    fn chunk_with_shares(table: &mut ChunkRowTable, slot: u32, count: u32, shares: &[f32]) {
        chunk(table, slot, 1.0, count);
        // Every row starts one unit across, so a test reads the growth as a factor of one.
        let scales = table.field(CLOUD, slot, SCALES) as *mut f32;
        for i in 0..count as usize * 3 {
            unsafe { *scales.add(i) = 1.0 };
        }
        let at = table.field(CLOUD, slot, COVERAGE) as *mut f32;
        for (i, share) in shares.iter().enumerate() {
            unsafe { *at.add(i) = *share };
        }
    }

    #[test]
    fn the_coverage_table_holds_as_many_steps_as_the_reference() {
        // The figures come from the reference's formula, floor(2 log2 count) + 1, worked once by
        // hand. A count computed in single precision gives sizes past a million an extra entry,
        // and that entry stays at one, so a small prefix of a large chunk stops growing.
        for (count, steps) in [
            (2u32, 3usize),
            (3, 4),
            (5, 5),
            (11, 7),
            (17, 9),
            (100, 14),
            (1000, 20),
            (25_000, 30),
            (741_455, 39),
            (2_000_000, 42),
            (8_000_000, 46),
        ] {
            assert_eq!(coverage_steps(count), steps, "a chunk of {count} rows");
        }
    }

    #[test]
    fn the_growth_matches_the_fixture_the_typescript_pack_reads() {
        // The same file that the TypeScript reference is held to, so the two packs agree on a
        // grown prefix rather than each keeping its own expectations.
        let text = include_str!("../../../packages/splats/src/pack-growth.fixture");
        let mut count = 0u32;
        let mut shares: Vec<f32> = Vec::new();
        let mut expected = Vec::new();
        for line in text.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let parts: Vec<&str> = line.split_whitespace().collect();
            match parts.first().copied() {
                Some("count") => count = parts[1].parse::<u32>().expect("a count"),
                Some("coverage") => {
                    shares = parts
                        .iter()
                        .skip(1)
                        .map(|value| value.parse::<f32>().expect("a share"))
                        .collect()
                }
                Some("expect") => expected.push((
                    parts[1].parse::<usize>().expect("a prefix"),
                    parts[2].parse::<f32>().expect("a growth"),
                )),
                _ => {}
            }
        }
        let mut table = ChunkRowTable::default();
        chunk_with_shares(&mut table, 0, count, &shares);
        let rows = table.chunk(CLOUD, 0).expect("the chunk was just written");
        for (prefix, growth) in expected {
            let got = growth_of(rows, prefix);
            assert!(
                (got - growth).abs() < 1e-6,
                "a prefix of {prefix} grows by {got}, and the fixture says {growth}"
            );
        }
    }

    #[test]
    fn a_prefix_grows_the_splats_it_keeps_to_cover_the_chunk() {
        let mut table = ChunkRowTable::default();
        // The whole chunk covers 1, and its first quarter covers a quarter of that.
        chunk_with_shares(&mut table, 0, 4, &[1.0, 0.8, 0.5, 0.35, 0.25]);
        let mut batch = batch(8);
        // A quarter of the chunk covers a quarter of its surface, so each kept splat doubles.
        let packed = table.pack(CLOUD, &mut batch, &[1.0]).unwrap();
        assert_eq!(packed, 1);
        assert_eq!(&batch.scales()[0..3], &[2.0, 2.0, 2.0]);
    }

    #[test]
    fn a_whole_chunk_draws_at_its_own_scales() {
        let mut table = ChunkRowTable::default();
        chunk_with_shares(&mut table, 0, 4, &[1.0, 0.8, 0.5, 0.35, 0.25]);
        let mut batch = batch(8);
        let packed = table.pack(CLOUD, &mut batch, &[4.0]).unwrap();
        assert_eq!(packed, 4);
        assert_eq!(&batch.scales()[0..3], &[1.0, 1.0, 1.0]);
    }

    #[test]
    fn a_small_prefix_never_grows_past_the_cap() {
        let mut table = ChunkRowTable::default();
        chunk_with_shares(
            &mut table,
            0,
            16,
            &[1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.2, 0.01],
        );
        let mut batch = batch(16);
        // One row of sixteen covers a hundredth of the surface and would grow past four, so the
        // cap holds it at three.
        table.pack(CLOUD, &mut batch, &[1.0]).unwrap();
        assert_eq!(&batch.scales()[0..3], &[3.0, 3.0, 3.0]);
    }

    #[test]
    fn a_pack_writes_each_chosen_prefix_in_slot_order() {
        let mut table = ChunkRowTable::default();
        chunk(&mut table, 0, 1.0, 4);
        chunk(&mut table, 2, 3.0, 4);
        let mut batch = batch(8);
        let packed = table.pack(CLOUD, &mut batch, &[2.0, 3.0, 1.0]).unwrap();
        assert_eq!(packed, 3);
        assert_eq!(
            &batch.positions()[0..9],
            &[1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 3.0, 0.0, 0.0]
        );
        assert_eq!(batch.active_count(), 3);
    }

    #[test]
    fn a_slot_without_a_chunk_takes_no_row() {
        let mut table = ChunkRowTable::default();
        chunk(&mut table, 0, 1.0, 4);
        let mut batch = batch(8);
        let packed = table.pack(CLOUD, &mut batch, &[4.0, 0.0]).unwrap();
        assert_eq!(packed, 4);
        assert_eq!(
            &batch.positions()[0..12],
            &[1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0]
        );
    }

    #[test]
    fn a_chosen_count_past_the_chunk_takes_the_chunk() {
        let mut table = ChunkRowTable::default();
        chunk(&mut table, 0, 2.0, 4);
        let mut batch = batch(8);
        assert_eq!(table.pack(CLOUD, &mut batch, &[99.0]).unwrap(), 4);
    }

    #[test]
    fn a_pack_writes_no_more_than_the_capacity() {
        let mut table = ChunkRowTable::default();
        chunk(&mut table, 0, 1.0, 4);
        chunk(&mut table, 1, 2.0, 4);
        let mut batch = batch(5);
        assert_eq!(table.pack(CLOUD, &mut batch, &[4.0, 4.0]).unwrap(), 5);
        assert_eq!(batch.active_count(), 5);
        assert_eq!(batch.positions()[12..15], [2.0, 0.0, 0.0]);
    }

    #[test]
    fn an_empty_pack_draws_no_row() {
        let table = ChunkRowTable::default();
        let mut batch = batch(4);
        batch.set_active_count(4).unwrap();
        assert_eq!(table.pack(CLOUD, &mut batch, &[]).unwrap(), 0);
        assert_eq!(batch.active_count(), 0);
    }

    #[test]
    fn a_pack_reads_counts_shorter_than_the_slots() {
        let mut table = ChunkRowTable::default();
        chunk(&mut table, 0, 1.0, 2);
        chunk(&mut table, 1, 2.0, 2);
        let mut batch = batch(4);
        assert_eq!(table.pack(CLOUD, &mut batch, &[2.0]).unwrap(), 2);
    }

    #[test]
    fn a_batch_without_transform_rows_takes_no_rows_and_reports_its_count() {
        // A part reads another batch's rows and owns no arrays of its own, so a chunk store
        // cannot pack it. The pack answers the count that the part keeps.
        let mut batches = crate::instances::BatchTable::with_capacity(2);
        let source = batches.create(4, false, true, 1, 1, 1.0).unwrap();
        let part = batches
            .create_part(
                Some(source),
                0,
                false,
                true,
                1,
                1,
                1.0,
                crate::math::IDENTITY,
            )
            .unwrap();
        let mut table = ChunkRowTable::default();
        chunk(&mut table, 0, 1.0, 2);
        let batch = batches.get_mut(part).unwrap();
        batch.set_active_count(3).unwrap();
        assert_eq!(table.pack(CLOUD, batch, &[2.0]).unwrap(), 3);
        assert_eq!(batch.active_count(), 3);
    }

    #[test]
    fn two_clouds_keep_their_slots_apart() {
        let mut table = ChunkRowTable::default();
        chunk(&mut table, 0, 1.0, 2);
        table.prepare(2, 0, 3).unwrap();
        let positions = table.field(2, 0, POSITIONS) as *mut f32;
        for i in 0..3 {
            unsafe { *positions.add(i * 3) = 9.0 };
        }
        let mut first = batch(4);
        let mut second = batch(4);
        assert_eq!(table.pack(CLOUD, &mut first, &[2.0]).unwrap(), 2);
        assert_eq!(table.pack(2, &mut second, &[3.0]).unwrap(), 3);
        assert_eq!(first.positions()[0], 1.0);
        assert_eq!(second.positions()[0], 9.0);
        // Dropping one cloud leaves the other's chunks in place.
        table.drop_cloud(2);
        assert_eq!(table.count(2, 0), 0);
        assert_eq!(table.count(CLOUD, 0), 2);
    }
}
