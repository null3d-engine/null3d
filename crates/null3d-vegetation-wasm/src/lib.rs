//! The vegetation add-on's near task: which plant copies draw real shoots, and their shoot rows
//! placed in the world, as a WebAssembly module that the add-on runs on the engine's job workers
//! when the camera moves.
//!
//! Each placed species is a *group*: its copies, its variants' shoot rows in plant space, its
//! prototypes' bounds and triangles, its split distance and the distance bands of its leaf mesh
//! tiers. A call picks the copies nearest the camera, at most the copies cap, whose crown reaches
//! inside their group's split distance. It walks those copies' rows, places each in the world and
//! writes it into the instance batch of its prototype and tier, for every tier band that the row
//! stands in. The rows of one call together stay within the triangle budget: when the rows inside
//! the split would draw more, the call cuts every chosen copy at one nearer distance, nearest rows
//! first, and gives each copy that distance as its own split, so its cards cover what its shoots no
//! longer draw. It also writes each chosen copy's place into its species' near table, and each
//! copy's split into the value that its card rows carry.
//!
//! The module imports nothing and keeps no state between calls. The caller hands in every array,
//! so a call allocates nothing: the add-on's task copies the arrays into this module's memory,
//! calls the export, and copies the result out.
//!
//! `near_compose(params)` reads a parameter block of 64-bit floats, `PARAM_*` below, and returns
//! the rows it wrote. Every address in the block is a byte address in this module's memory.
#![cfg_attr(all(target_arch = "wasm32", not(test)), no_std)]

#[cfg(all(target_arch = "wasm32", not(test)))]
#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    // A call reaches this only by reading a parameter block that the caller wrote wrong. A trap
    // fails the task, which the add-on reports; the module keeps no state to repair.
    core::arch::wasm32::unreachable()
}

/// The camera's world position: x, y and z.
pub const PARAM_EYE: usize = 0;
/// The most copies that draw real shoots, at most `MAX_NEAR`.
pub const PARAM_COPIES: usize = 3;
/// The most triangles that the rows of one call may draw together.
pub const PARAM_TRIANGLES: usize = 4;
/// The metres the camera may move before the next call's answer arrives.
pub const PARAM_MARGIN: usize = 5;
/// The groups, and the address of their `GROUP_FLOATS` 64-bit floats each.
pub const PARAM_GROUP_COUNT: usize = 6;
pub const PARAM_GROUPS: usize = 7;
/// The batches, and the address of their first row and capacity, two 32-bit integers each.
pub const PARAM_BATCH_COUNT: usize = 8;
pub const PARAM_BATCHES: usize = 9;
/// Where the rows go: positions (3 floats a row), rotations (4), scales (3) and values (4).
pub const PARAM_POSITIONS: usize = 10;
pub const PARAM_ROTATIONS: usize = 11;
pub const PARAM_SCALES: usize = 12;
pub const PARAM_VALUES: usize = 13;
/// Where each batch's row count goes, one 32-bit integer a batch.
pub const PARAM_COUNTS: usize = 14;
/// The near tables, and the address of their `TABLE_FLOATS` 32-bit floats each.
pub const PARAM_TABLE_COUNT: usize = 15;
pub const PARAM_TABLES: usize = 16;
/// The card rows' values, four 32-bit floats a row, and how many rows every group holds together.
pub const PARAM_CARD_VALUES: usize = 17;
pub const PARAM_CARD_ROWS: usize = 18;
/// Where the call's figures go: `SUMMARY_FLOATS` 64-bit floats.
pub const PARAM_SUMMARY: usize = 19;
/// Floats in the parameter block.
pub const PARAM_FLOATS: usize = 20;

/// A group's split distance in metres: shoot rows nearer than it, cards beyond.
pub const GROUP_SPLIT: usize = 0;
/// The tier bands, at most `MAX_TIERS`: their count, then each band's tier, start and end.
pub const GROUP_TIER_COUNT: usize = 1;
pub const GROUP_TIER: usize = 2;
pub const GROUP_BAND_START: usize = 5;
pub const GROUP_BAND_END: usize = 8;
/// The copies, and the address of their `COPY_FLOATS` 32-bit floats each.
pub const GROUP_COPY_COUNT: usize = 11;
pub const GROUP_COPIES: usize = 12;
/// The address of each copy's card row in its variant's card batch, one 32-bit integer a copy.
pub const GROUP_CARD_ROWS: usize = 13;
/// The group's first row in the card values.
pub const GROUP_CARD_BASE: usize = 14;
/// The variants, and the address of their `VARIANT_FLOATS` 32-bit floats each.
pub const GROUP_VARIANT_COUNT: usize = 15;
pub const GROUP_VARIANTS: usize = 16;
/// The shoot rows of every variant: `ROW_FLOATS` 32-bit floats and `ROW_WORDS` 32-bit integers each.
pub const GROUP_ROW_FLOATS: usize = 17;
pub const GROUP_ROW_WORDS: usize = 18;
/// The prototypes, and the address of their `PROTOTYPE_FLOATS` 32-bit floats each.
pub const GROUP_PROTOTYPE_COUNT: usize = 19;
pub const GROUP_PROTOTYPES: usize = 20;
/// The batch of the first prototype's first tier band; prototype `p`'s band `k` is `p * bands + k`
/// past it.
pub const GROUP_BATCH_BASE: usize = 21;
/// The near table that the group's copies take their slots in.
pub const GROUP_TABLE: usize = 22;
/// The table's first slot that the pool may take: the slots below it belong to fixed placements.
pub const GROUP_FIRST_SLOT: usize = 23;
/// Floats a group takes.
pub const GROUP_FLOATS: usize = 24;

/// A copy: its position, its turn about +Y in radians, the turn's cosine and sine, the turn as a
/// quaternion's y and w, its scale and its variant.
pub const COPY_FLOATS: usize = 10;
/// A variant: its first row, its rows, its first wind record, its crown's centre in plant space
/// and its crown's radius.
pub const VARIANT_FLOATS: usize = 8;
/// A row: its position in plant space, its rotation as a quaternion and its scale.
pub const ROW_FLOATS: usize = 8;
/// A row: its prototype in the low byte and its wind record in the next two; then its flutter
/// phase, its sky visibility and its bent normal code, a byte each.
pub const ROW_WORDS: usize = 2;
/// A prototype: its bounding radius about its attach point at scale 1, then its triangles at each
/// of the four tiers.
pub const PROTOTYPE_FLOATS: usize = 5;
/// The slots of a near table, and its floats: two texels of four a slot.
pub const NEAR_SLOTS: usize = 16;
pub const TABLE_FLOATS: usize = NEAR_SLOTS * 8;
/// The call's figures: triangles drawn, copies chosen, the cut distance (-1 for none) and rows.
pub const SUMMARY_FLOATS: usize = 4;

/// The most copies that one call chooses, which the near tables' slots hold.
pub const MAX_NEAR: usize = NEAR_SLOTS;
/// The most tier bands a group takes.
pub const MAX_TIERS: usize = 3;
/// The share past its split distance where a group's last band ends: the engine thins that band's
/// rows over its last eighth, so they are gone before the cards give way.
pub const SPLIT_REACH: f64 = 1.04;
/// The share of its split inside which a copy's cards give way to its shoots.
pub const CARD_SHARE: f64 = 0.96;
/// The bins over distance that the budget's cut is found in.
const BINS: usize = 512;

/// One group, read from its block.
#[derive(Clone, Copy)]
pub struct Group<'a> {
    split: f64,
    tiers: usize,
    tier: [usize; MAX_TIERS],
    start: [f64; MAX_TIERS],
    end: [f64; MAX_TIERS],
    copies: &'a [f32],
    card_rows: &'a [u32],
    card_base: usize,
    variants: &'a [f32],
    row_floats: &'a [f32],
    row_words: &'a [u32],
    prototypes: &'a [f32],
    batch_base: usize,
    table: usize,
    first_slot: usize,
}

impl Group<'_> {
    /// The distance past which none of the group's rows draws, for a camera that may move `margin`.
    fn reach(&self, margin: f64) -> f64 {
        self.split * SPLIT_REACH + margin
    }
}

/// Everything one call writes.
pub struct Output<'a> {
    pub positions: &'a mut [f32],
    pub rotations: &'a mut [f32],
    pub scales: &'a mut [f32],
    pub values: &'a mut [f32],
    pub counts: &'a mut [u32],
    pub tables: &'a mut [f32],
    pub card_values: &'a mut [f32],
    pub summary: &'a mut [f64],
}

/// A chosen copy: its distance, its group, its copy and its near slot.
#[derive(Clone, Copy)]
struct Chosen {
    distance: f64,
    group: usize,
    copy: usize,
    slot: usize,
}

/// A number rounded to the nearest half float, ties to even, as the GPU's upload rounds it. The
/// exponent comes from exact doublings, so the result is the add-on's `toHalf` exactly.
pub fn to_half(value: f64) -> f64 {
    if value == 0.0 || value.is_nan() || value.is_infinite() {
        return value;
    }
    let size = if value < 0.0 { -value } else { value };
    let sign = if value < 0.0 { -1.0 } else { 1.0 };
    if size >= 65520.0 {
        return sign * f64::INFINITY;
    }
    let mut exponent = 0;
    let mut scale = 1.0;
    while size >= scale * 2.0 && exponent < 15 {
        scale *= 2.0;
        exponent += 1;
    }
    while size < scale && exponent > -14 {
        scale /= 2.0;
        exponent -= 1;
    }
    let quantum = scale / 1024.0;
    let steps = size / quantum;
    let mut whole = libm::floor(steps);
    let rest = steps - whole;
    if rest > 0.5 || (rest == 0.5 && libm::fmod(whole, 2.0) == 1.0) {
        whole += 1.0;
    }
    sign * whole * quantum
}

/// A point of a copy's plant space in the world: turned about +Y, scaled and moved to the copy.
#[inline]
fn copy_point(copy: &[f32], x: f64, y: f64, z: f64) -> [f64; 3] {
    let cos = copy[4] as f64;
    let sin = copy[5] as f64;
    let scale = copy[8] as f64;
    [
        copy[0] as f64 + (cos * x + sin * z) * scale,
        copy[1] as f64 + y * scale,
        copy[2] as f64 + (cos * z - sin * x) * scale,
    ]
}

/// The distance from the eye to the nearest point of a sphere, 0 inside it.
#[inline]
fn sphere_distance(eye: [f64; 3], centre: [f64; 3], radius: f64) -> f64 {
    let dx = centre[0] - eye[0];
    let dy = centre[1] - eye[1];
    let dz = centre[2] - eye[2];
    let distance = libm::sqrt(dx * dx + dy * dy + dz * dz) - radius;
    if distance > 0.0 { distance } else { 0.0 }
}

/// A row of a chosen copy in the world: its place, its rotation, its scale and its distance.
struct Placed {
    position: [f64; 3],
    rotation: [f64; 4],
    scale: f64,
    distance: f64,
    prototype: usize,
}

/// Places row `row` of a copy in the world.
#[inline]
fn place_row(group: &Group, copy: &[f32], row: usize, eye: [f64; 3]) -> Placed {
    let f = &group.row_floats[row * ROW_FLOATS..row * ROW_FLOATS + ROW_FLOATS];
    let prototype = (group.row_words[row * ROW_WORDS] & 255) as usize;
    let position = copy_point(copy, f[0] as f64, f[1] as f64, f[2] as f64);
    let scale = f[7] as f64 * copy[8] as f64;
    let radius = if prototype < group.prototypes.len() / PROTOTYPE_FLOATS {
        group.prototypes[prototype * PROTOTYPE_FLOATS] as f64 * scale
    } else {
        0.0
    };
    // The copy's turn about +Y times the row's own rotation.
    let (ty, tw) = (copy[6] as f64, copy[7] as f64);
    let (qx, qy, qz, qw) = (f[3] as f64, f[4] as f64, f[5] as f64, f[6] as f64);
    let rotation = [
        tw * qx + ty * qz,
        tw * qy + ty * qw,
        tw * qz - ty * qx,
        tw * qw - ty * qy,
    ];
    Placed {
        position,
        rotation,
        scale,
        distance: sphere_distance(eye, position, radius),
        prototype,
    }
}

/// Whether a row at `distance` stands in band `k` of its group, for a camera that may move `margin`.
#[inline]
fn in_band(group: &Group, k: usize, distance: f64, margin: f64) -> bool {
    distance >= group.start[k] - margin && distance <= group.end[k] + margin
}

/// The triangles of a prototype at a tier.
#[inline]
fn triangles(group: &Group, prototype: usize, tier: usize) -> f64 {
    if prototype >= group.prototypes.len() / PROTOTYPE_FLOATS {
        return 0.0;
    }
    group.prototypes[prototype * PROTOTYPE_FLOATS + 1 + tier] as f64
}

/// Runs one call over the groups: the work of `near_compose` on plain slices.
fn compose(
    eye: [f64; 3],
    cap_copies: usize,
    budget: f64,
    margin: f64,
    groups: &[Group],
    batches: &[u32],
    out: &mut Output,
) -> u32 {
    let cap_copies = cap_copies.min(MAX_NEAR);
    for count in out.counts.iter_mut() {
        *count = 0;
    }
    // Slots below a table's first free slot belong to fixed placements and keep what they hold;
    // the rest are cleared, so a slot no copy takes reads as empty.
    let mut next_slot = [0usize; MAX_TABLES];
    for group in groups {
        if group.table < MAX_TABLES && group.first_slot > next_slot[group.table] {
            next_slot[group.table] = group.first_slot.min(NEAR_SLOTS);
        }
    }
    for (table, chunk) in out.tables.chunks_mut(TABLE_FLOATS).enumerate() {
        let first = if table < MAX_TABLES {
            next_slot[table]
        } else {
            0
        };
        for value in chunk.iter_mut().skip(first * 8) {
            *value = 0.0;
        }
    }
    for value in out.card_values.iter_mut() {
        *value = 0.0;
    }

    // The copies whose crowns reach inside their group's split, nearest first.
    let mut chosen = [Chosen {
        distance: 0.0,
        group: 0,
        copy: 0,
        slot: 0,
    }; MAX_NEAR];
    let mut picked = 0usize;
    for (g, group) in groups.iter().enumerate() {
        let reach = group.reach(margin);
        let variants = group.variants.len() / VARIANT_FLOATS;
        for c in 0..group.copies.len() / COPY_FLOATS {
            let copy = &group.copies[c * COPY_FLOATS..c * COPY_FLOATS + COPY_FLOATS];
            let variant = copy[9] as usize;
            if variant >= variants {
                continue;
            }
            let v = &group.variants
                [variant * VARIANT_FLOATS..variant * VARIANT_FLOATS + VARIANT_FLOATS];
            let centre = copy_point(copy, v[3] as f64, v[4] as f64, v[5] as f64);
            let distance = sphere_distance(eye, centre, v[6] as f64 * copy[8] as f64);
            if distance >= reach || cap_copies == 0 {
                continue;
            }
            if picked == cap_copies && distance >= chosen[picked - 1].distance {
                continue;
            }
            // Insert in order, dropping the farthest when the list is full.
            let mut at = if picked < cap_copies {
                picked
            } else {
                picked - 1
            };
            while at > 0 && chosen[at - 1].distance > distance {
                chosen[at] = chosen[at - 1];
                at -= 1;
            }
            chosen[at] = Chosen {
                distance,
                group: g,
                copy: c,
                slot: 0,
            };
            if picked < cap_copies {
                picked += 1;
            }
        }
    }

    // Each chosen copy takes the next free slot of its species' near table.
    let mut kept = 0usize;
    for i in 0..picked {
        let entry = chosen[i];
        let group = &groups[entry.group];
        let table = group.table;
        if table >= next_slot.len()
            || next_slot[table] >= NEAR_SLOTS
            || (table + 1) * TABLE_FLOATS > out.tables.len()
        {
            continue;
        }
        let slot = next_slot[table];
        next_slot[table] += 1;
        let copy = &group.copies[entry.copy * COPY_FLOATS..entry.copy * COPY_FLOATS + COPY_FLOATS];
        let at = table * TABLE_FLOATS + slot * 8;
        for k in 0..3 {
            let value = copy[k] as f64;
            let high = to_half(value);
            out.tables[at + k] = high as f32;
            out.tables[at + 4 + k] = (value - high) as f32;
        }
        out.tables[at + 3] = copy[3];
        out.tables[at + 7] = copy[8];
        chosen[kept] = Chosen { slot, ..entry };
        kept += 1;
    }
    let picked = kept;

    // The triangles the chosen copies' rows would draw, binned by distance.
    let mut far = 0.0f64;
    for entry in chosen.iter().take(picked) {
        let reach = groups[entry.group].reach(margin);
        if reach > far {
            far = reach;
        }
    }
    let bin_of = |distance: f64| -> usize {
        if far <= 0.0 {
            return 0;
        }
        let bin = (distance / far * BINS as f64) as usize;
        if bin >= BINS { BINS - 1 } else { bin }
    };
    let mut bins = [0.0f64; BINS];
    let mut total = 0.0f64;
    for entry in chosen.iter().take(picked) {
        let group = &groups[entry.group];
        let copy = &group.copies[entry.copy * COPY_FLOATS..entry.copy * COPY_FLOATS + COPY_FLOATS];
        let v = &group.variants[copy[9] as usize * VARIANT_FLOATS..][..VARIANT_FLOATS];
        let (first, rows) = (v[0] as usize, v[1] as usize);
        let reach = group.reach(margin);
        for row in first..first + rows {
            let placed = place_row(group, copy, row, eye);
            if placed.distance >= reach {
                continue;
            }
            let mut cost = 0.0;
            for k in 0..group.tiers {
                if in_band(group, k, placed.distance, margin) {
                    cost += triangles(group, placed.prototype, group.tier[k]);
                }
            }
            bins[bin_of(placed.distance)] += cost;
            total += cost;
        }
    }

    // Past the budget, every chosen copy is cut at the nearest bin edge that keeps the rows inside:
    // the rows of the bins before `cut_bin` draw, and no others.
    let mut cut_bin = BINS;
    if total > budget {
        let mut sum = 0.0;
        cut_bin = 0;
        for cost in bins.iter() {
            if sum + cost > budget {
                break;
            }
            sum += cost;
            cut_bin += 1;
        }
    }
    let cut = if cut_bin < BINS {
        far * cut_bin as f64 / BINS as f64
    } else {
        f64::INFINITY
    };

    // The rows, into their batches.
    let batch_count = batches.len() / 2;
    let mut drawn = 0.0f64;
    let mut written = 0u32;
    for entry in chosen.iter().take(picked) {
        let group = &groups[entry.group];
        let copy = &group.copies[entry.copy * COPY_FLOATS..entry.copy * COPY_FLOATS + COPY_FLOATS];
        let v = &group.variants[copy[9] as usize * VARIANT_FLOATS..][..VARIANT_FLOATS];
        let (first, rows, record_base) = (v[0] as usize, v[1] as usize, v[2] as u32);
        let reach = group.reach(margin);
        for row in first..first + rows {
            let placed = place_row(group, copy, row, eye);
            if placed.distance >= reach || bin_of(placed.distance) >= cut_bin {
                continue;
            }
            let words = &group.row_words[row * ROW_WORDS..row * ROW_WORDS + ROW_WORDS];
            let record = record_base + ((words[0] >> 8) & 0xffff);
            let phase = words[1] & 255;
            let sky = (words[1] >> 8) & 255;
            let bent = (words[1] >> 16) & 255;
            for k in 0..group.tiers {
                if !in_band(group, k, placed.distance, margin) {
                    continue;
                }
                let batch = group.batch_base + placed.prototype * group.tiers + k;
                if batch >= batch_count || batch >= out.counts.len() {
                    continue;
                }
                let start = batches[batch * 2] as usize;
                let capacity = batches[batch * 2 + 1] as usize;
                let n = out.counts[batch] as usize;
                if n >= capacity {
                    continue;
                }
                let at = start + n;
                out.counts[batch] += 1;
                written += 1;
                drawn += triangles(group, placed.prototype, group.tier[k]);
                for i in 0..3 {
                    out.positions[at * 3 + i] = placed.position[i] as f32;
                    out.scales[at * 3 + i] = placed.scale as f32;
                }
                for i in 0..4 {
                    out.rotations[at * 4 + i] = placed.rotation[i] as f32;
                }
                out.values[at * 4] = (record >> 5) as f32;
                out.values[at * 4 + 1] = (record & 31) as f32 + (phase >> 2) as f32 / 64.0;
                out.values[at * 4 + 2] = (sky * 8 + (bent >> 5)) as f32;
                out.values[at * 4 + 3] = ((bent & 31) * 16 + entry.slot as u32) as f32;
            }
        }
        // The copy's cards give way inside its split: the group's, or nearer where the budget cut.
        let split = if cut.is_finite() {
            let given = (cut - margin) / CARD_SHARE;
            if given < 0.0 {
                0.0
            } else if given > group.split {
                group.split
            } else {
                given
            }
        } else {
            group.split
        };
        let card = group.card_base + group.card_rows[entry.copy] as usize;
        if card * 4 < out.card_values.len() {
            out.card_values[card * 4] = split as f32;
        }
    }
    if out.summary.len() >= SUMMARY_FLOATS {
        out.summary[0] = drawn;
        out.summary[1] = picked as f64;
        out.summary[2] = if cut.is_finite() { cut } else { -1.0 };
        out.summary[3] = written as f64;
    }
    written
}

/// Reads the parameter at `index`.
///
/// # Safety
/// `params` points at a block that holds at least `index + 1` 64-bit floats.
#[inline]
unsafe fn param(params: *const f64, index: usize) -> f64 {
    unsafe { *params.add(index) }
}

/// A slice of `count` items at the byte address that parameter `index` holds.
///
/// # Safety
/// The address points at `count` items of `T`, aligned for `T`.
#[inline]
unsafe fn slice<'a, T>(address: f64, count: usize) -> &'a [T] {
    if count == 0 {
        return &[];
    }
    unsafe { core::slice::from_raw_parts(address as usize as *const T, count) }
}

/// A mutable slice of `count` items at a byte address.
///
/// # Safety
/// The address points at `count` items of `T`, aligned for `T`, that nothing else reads meanwhile.
#[inline]
unsafe fn slice_mut<'a, T>(address: f64, count: usize) -> &'a mut [T] {
    if count == 0 {
        return &mut [];
    }
    unsafe { core::slice::from_raw_parts_mut(address as usize as *mut T, count) }
}

/// The most groups one call reads.
pub const MAX_GROUPS: usize = 64;
/// The most near tables one call writes: one per kit.
pub const MAX_TABLES: usize = MAX_GROUPS;

/// Picks the copies that draw real shoots, writes their rows into the batches' rows, their places
/// into the near tables and their splits into the card values, and returns the rows it wrote.
///
/// # Safety
/// `params` points at the `PARAM_FLOATS` 64-bit floats that the module's documentation describes,
/// and every address in it points at a buffer long enough for what the call reads and writes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn near_compose(params: *const f64) -> u32 {
    let p = |index: usize| unsafe { param(params, index) };
    let eye = [p(PARAM_EYE), p(PARAM_EYE + 1), p(PARAM_EYE + 2)];
    let group_count = (p(PARAM_GROUP_COUNT) as usize).min(MAX_GROUPS);
    let blocks: &[f64] = unsafe { slice(p(PARAM_GROUPS), group_count * GROUP_FLOATS) };
    let empty = Group {
        split: 0.0,
        tiers: 0,
        tier: [0; MAX_TIERS],
        start: [0.0; MAX_TIERS],
        end: [0.0; MAX_TIERS],
        copies: &[],
        card_rows: &[],
        card_base: 0,
        variants: &[],
        row_floats: &[],
        row_words: &[],
        prototypes: &[],
        batch_base: 0,
        table: 0,
        first_slot: 0,
    };
    let mut groups = [empty; MAX_GROUPS];
    for g in 0..group_count {
        let b = &blocks[g * GROUP_FLOATS..g * GROUP_FLOATS + GROUP_FLOATS];
        let tiers = (b[GROUP_TIER_COUNT] as usize).min(MAX_TIERS);
        let copies = b[GROUP_COPY_COUNT] as usize;
        let variants = b[GROUP_VARIANT_COUNT] as usize;
        let variant_floats: &[f32] = unsafe { slice(b[GROUP_VARIANTS], variants * VARIANT_FLOATS) };
        let mut rows = 0usize;
        for v in 0..variants {
            let end = variant_floats[v * VARIANT_FLOATS] as usize
                + variant_floats[v * VARIANT_FLOATS + 1] as usize;
            if end > rows {
                rows = end;
            }
        }
        let mut group = Group {
            split: b[GROUP_SPLIT],
            tiers,
            tier: [0; MAX_TIERS],
            start: [0.0; MAX_TIERS],
            end: [0.0; MAX_TIERS],
            copies: unsafe { slice(b[GROUP_COPIES], copies * COPY_FLOATS) },
            card_rows: unsafe { slice(b[GROUP_CARD_ROWS], copies) },
            card_base: b[GROUP_CARD_BASE] as usize,
            variants: variant_floats,
            row_floats: unsafe { slice(b[GROUP_ROW_FLOATS], rows * ROW_FLOATS) },
            row_words: unsafe { slice(b[GROUP_ROW_WORDS], rows * ROW_WORDS) },
            prototypes: unsafe {
                slice(
                    b[GROUP_PROTOTYPES],
                    b[GROUP_PROTOTYPE_COUNT] as usize * PROTOTYPE_FLOATS,
                )
            },
            batch_base: b[GROUP_BATCH_BASE] as usize,
            table: b[GROUP_TABLE] as usize,
            first_slot: b[GROUP_FIRST_SLOT] as usize,
        };
        for k in 0..tiers {
            group.tier[k] = (b[GROUP_TIER + k] as usize).min(3);
            group.start[k] = b[GROUP_BAND_START + k];
            group.end[k] = b[GROUP_BAND_END + k];
        }
        groups[g] = group;
    }
    let batch_count = p(PARAM_BATCH_COUNT) as usize;
    let batches: &[u32] = unsafe { slice(p(PARAM_BATCHES), batch_count * 2) };
    let mut rows = 0usize;
    for b in 0..batch_count {
        let end = batches[b * 2] as usize + batches[b * 2 + 1] as usize;
        if end > rows {
            rows = end;
        }
    }
    let table_count = p(PARAM_TABLE_COUNT) as usize;
    let card_rows = p(PARAM_CARD_ROWS) as usize;
    let mut out = Output {
        positions: unsafe { slice_mut(p(PARAM_POSITIONS), rows * 3) },
        rotations: unsafe { slice_mut(p(PARAM_ROTATIONS), rows * 4) },
        scales: unsafe { slice_mut(p(PARAM_SCALES), rows * 3) },
        values: unsafe { slice_mut(p(PARAM_VALUES), rows * 4) },
        counts: unsafe { slice_mut(p(PARAM_COUNTS), batch_count) },
        tables: unsafe { slice_mut(p(PARAM_TABLES), table_count * TABLE_FLOATS) },
        card_values: unsafe { slice_mut(p(PARAM_CARD_VALUES), card_rows * 4) },
        summary: unsafe { slice_mut(p(PARAM_SUMMARY), SUMMARY_FLOATS) },
    };
    compose(
        eye,
        p(PARAM_COPIES) as usize,
        p(PARAM_TRIANGLES),
        p(PARAM_MARGIN),
        &groups[..group_count],
        batches,
        &mut out,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A scene of one group: copies along +X, each of one variant whose rows stand on a line
    /// along +X from the copy, one prototype of radius 0.1 that draws 100, 50, 20 and 10 triangles.
    struct Scene {
        copies: Vec<f32>,
        card_rows: Vec<u32>,
        variants: Vec<f32>,
        row_floats: Vec<f32>,
        row_words: Vec<u32>,
        prototypes: Vec<f32>,
    }

    fn scene(copies: &[f32], rows: usize, spacing: f32) -> Scene {
        let mut c = Vec::new();
        for (k, x) in copies.iter().enumerate() {
            c.extend_from_slice(&[*x, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0]);
            let _ = k;
        }
        let mut row_floats = Vec::new();
        let mut row_words = Vec::new();
        for r in 0..rows {
            row_floats.extend_from_slice(&[r as f32 * spacing, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0]);
            row_words.extend_from_slice(&[(r as u32 % 7) << 8, 200 << 8 | 136 << 16 | 64]);
        }
        Scene {
            card_rows: (0..copies.len() as u32).collect(),
            copies: c,
            variants: vec![
                0.0,
                rows as f32,
                8000.0,
                0.0,
                1.0,
                0.0,
                rows as f32 * spacing,
                0.0,
            ],
            row_floats,
            row_words,
            prototypes: vec![0.1, 100.0, 50.0, 20.0, 10.0],
        }
    }

    fn group<'a>(s: &'a Scene, split: f64, tiers: &[(usize, f64, f64)]) -> Group<'a> {
        let mut g = Group {
            split,
            tiers: tiers.len(),
            tier: [0; MAX_TIERS],
            start: [0.0; MAX_TIERS],
            end: [0.0; MAX_TIERS],
            copies: &s.copies,
            card_rows: &s.card_rows,
            card_base: 0,
            variants: &s.variants,
            row_floats: &s.row_floats,
            row_words: &s.row_words,
            prototypes: &s.prototypes,
            batch_base: 0,
            table: 0,
            first_slot: 0,
        };
        for (k, (tier, start, end)) in tiers.iter().enumerate() {
            g.tier[k] = *tier;
            g.start[k] = *start;
            g.end[k] = *end;
        }
        g
    }

    struct Buffers {
        positions: Vec<f32>,
        rotations: Vec<f32>,
        scales: Vec<f32>,
        values: Vec<f32>,
        counts: Vec<u32>,
        tables: Vec<f32>,
        card_values: Vec<f32>,
        summary: Vec<f64>,
    }

    fn buffers(batches: usize, rows: usize, cards: usize) -> Buffers {
        Buffers {
            positions: vec![0.0; rows * 3],
            rotations: vec![0.0; rows * 4],
            scales: vec![0.0; rows * 3],
            values: vec![0.0; rows * 4],
            counts: vec![0; batches],
            tables: vec![0.0; TABLE_FLOATS],
            card_values: vec![0.0; cards * 4],
            summary: vec![0.0; SUMMARY_FLOATS],
        }
    }

    fn run(groups: &[Group], batches: &[u32], b: &mut Buffers, copies: usize, budget: f64) -> u32 {
        let mut out = Output {
            positions: &mut b.positions,
            rotations: &mut b.rotations,
            scales: &mut b.scales,
            values: &mut b.values,
            counts: &mut b.counts,
            tables: &mut b.tables,
            card_values: &mut b.card_values,
            summary: &mut b.summary,
        };
        compose(
            [0.0, 1.0, 0.0],
            copies,
            budget,
            0.5,
            groups,
            batches,
            &mut out,
        )
    }

    #[test]
    fn writes_every_row_inside_the_split_and_gives_the_cards_the_split() {
        let s = scene(&[0.0], 40, 1.0);
        let g = group(&s, 9.8, &[(3, 0.0, 9.8 * SPLIT_REACH)]);
        let mut b = buffers(1, 100, 1);
        let written = run(&[g], &[0, 100], &mut b, 1, 1e9);
        // Rows stand at 0 to 39 m with a radius of 0.1 m. The band ends at 10.19 m, and the camera
        // may move 0.5 m: the rows from 0 to 10 m stand inside.
        assert_eq!(written, 11);
        assert_eq!(b.counts[0], 11);
        assert_eq!(b.card_values[0], 9.8);
        assert_eq!(b.summary[0], 11.0 * 10.0);
        assert_eq!(b.summary[2], -1.0);
        for r in 0..11 {
            assert!(b.positions[r * 3] <= 10.9);
        }
    }

    #[test]
    fn holds_the_budget_nearest_rows_first_and_cuts_the_cards_to_match() {
        let s = scene(&[0.0], 40, 0.25);
        let g = group(&s, 10.0, &[(1, 0.0, 10.4)]);
        let mut b = buffers(1, 100, 1);
        let written = run(&[g], &[0, 100], &mut b, 1, 500.0);
        assert!(b.summary[0] <= 500.0);
        assert!(written > 0 && written <= 10);
        let cut = b.summary[2];
        assert!(cut > 0.0);
        let farthest = (0..written as usize)
            .map(|r| b.positions[r * 3])
            .fold(0.0f32, f32::max);
        assert!((farthest as f64) < cut + 0.1);
        // The cards give way only where the rows still draw, less the margin the camera may move.
        assert!((b.card_values[0] as f64) <= (cut - 0.5) / CARD_SHARE + 1e-6);
    }

    #[test]
    fn takes_the_nearest_copies_up_to_the_cap() {
        let s = scene(&[30.0, 2.0, 12.0, 5.0], 4, 0.5);
        let g = group(&s, 20.0, &[(2, 0.0, 20.8)]);
        let mut b = buffers(1, 100, 4);
        run(&[g], &[0, 100], &mut b, 2, 1e9);
        assert_eq!(b.summary[1], 2.0);
        // Copies at 2 m and 5 m draw shoots; the copies at 12 m and 30 m stay all cards.
        assert_eq!(b.card_values[4], 20.0);
        assert_eq!(b.card_values[12], 20.0);
        assert_eq!(b.card_values[8], 0.0);
        assert_eq!(b.card_values[0], 0.0);
        // Their places fill the first two slots of the near table, nearest first.
        assert_eq!(b.tables[0], 2.0);
        assert_eq!(b.tables[8], 5.0);
        assert_eq!(b.tables[7], 1.0);
    }

    #[test]
    fn writes_a_row_in_an_overlap_into_both_tiers() {
        let s = scene(&[0.0], 20, 1.0);
        let g = group(&s, 16.0, &[(2, 0.0, 6.0), (1, 5.0, 16.64)]);
        let mut b = buffers(2, 200, 1);
        run(&[g], &[0, 100, 100, 100], &mut b, 1, 1e9);
        let near: Vec<f32> = (0..b.counts[0] as usize)
            .map(|r| b.positions[r * 3])
            .collect();
        let far: Vec<f32> = (0..b.counts[1] as usize)
            .map(|r| b.positions[(100 + r) * 3])
            .collect();
        for x in [5.0, 6.0] {
            assert!(near.contains(&x) && far.contains(&x), "{x} in both bands");
        }
        assert!(!far.contains(&0.0) && !near.contains(&12.0));
    }

    #[test]
    fn encodes_the_row_values_as_the_plant_shader_reads_them() {
        let s = scene(&[0.0], 1, 1.0);
        let g = group(&s, 10.0, &[(0, 0.0, 10.4)]);
        let mut b = buffers(1, 4, 1);
        run(&[g], &[0, 4], &mut b, 1, 1e9);
        // Record 8000 + 0; phase 64, sky 200, bent 136 in slot 0.
        assert_eq!(b.values[0], (8000 >> 5) as f32);
        assert_eq!(b.values[1], (8000 & 31) as f32 + 16.0 / 64.0);
        assert_eq!(b.values[2], (200 * 8 + (136 >> 5)) as f32);
        assert_eq!(b.values[3], ((136 & 31) * 16) as f32);
    }

    #[test]
    fn takes_slots_past_those_that_fixed_placements_hold() {
        let s = scene(&[4.0], 2, 0.5);
        let mut g = group(&s, 20.0, &[(2, 0.0, 20.8)]);
        g.first_slot = 3;
        let mut b = buffers(1, 10, 1);
        b.tables.fill(7.0);
        run(&[g], &[0, 10], &mut b, 4, 1e9);
        assert!(b.tables[..24].iter().all(|v| *v == 7.0));
        assert_eq!(b.tables[24], 4.0);
        assert!(b.tables[32..].iter().all(|v| *v == 0.0));
        assert_eq!(b.values[3] as u32 % 16, 3);
    }

    #[test]
    fn rounds_to_half_floats_as_the_add_on_does() {
        assert_eq!(to_half(1.0), 1.0);
        assert_eq!(to_half(0.1), 0.0999755859375);
        assert_eq!(to_half(2049.0), 2048.0);
        assert_eq!(to_half(2051.0), 2052.0);
        assert_eq!(to_half(-37.123), -37.125);
        assert_eq!(to_half(70000.0), f64::INFINITY);
    }
}
