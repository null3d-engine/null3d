//! The noise field of the sky's volumetric cloud tier: a 64-cube of four tiling noises that the
//! cloud march samples with a linear filter. The renderer makes it on the first frame that draws
//! the tier and writes it into GPU memory, so no file ships and every page's clouds come from the
//! same bytes. The field repeats at its edges, so the march wraps it without a seam.
//!
//! Each voxel holds four numbers, from 0 to 1:
//!
//! - red: the shape of a cloud, two octaves of value noise of the lowest frequency;
//! - green: the detail that breaks its edge;
//! - blue: billows, shaped so their middle is full and their edges thin;
//! - alpha: the coverage across the sky, at the lowest frequency of all.

use null3d_gpu::drawlist::{DrawList, Op, address, compare, filter, format, texture_usage, view};

use crate::frame::{RecordError, UploadArena};

/// The texels across a side of the field.
pub(crate) const SIZE: u32 = 64;

/// The bytes of the field's texels.
pub(crate) const BYTES: usize = (SIZE * SIZE * SIZE * 4) as usize;

/// The bytes that a frame may copy into its arena for the field: its texels until they are on the
/// GPU, and none after that or while the tier draws the flat layer.
pub(crate) fn upload_bytes(made: bool, steps: u32) -> usize {
    if made || steps == 0 { 0 } else { BYTES }
}

/// Records the field's texture and its sampler once, and its texels. A page that never draws the
/// tier makes neither.
pub(crate) fn prepare(
    list: &mut DrawList,
    arena: &mut UploadArena,
    texture: u32,
    sampler: u32,
    made: &mut bool,
) -> Result<(), RecordError> {
    if *made {
        return Ok(());
    }
    *made = true;
    list.push(
        Op::CreateTexture,
        &[
            texture,
            SIZE,
            SIZE,
            SIZE,
            format::RGBA8_UNORM,
            texture_usage::TEXTURE_BINDING | texture_usage::COPY_DST,
            1,
            1,
            view::D3,
        ],
    )?;
    list.push(
        Op::CreateSampler,
        &[
            sampler,
            address::REPEAT,
            address::REPEAT,
            address::REPEAT,
            filter::LINEAR,
            filter::LINEAR,
            filter::LINEAR,
            0f32.to_bits(),
            0f32.to_bits(),
            compare::NONE,
            1,
        ],
    )?;
    let mut texels = vec![0u8; BYTES];
    fill(&mut texels);
    let (at, bytes) = arena.push(&texels)?;
    list.push(
        Op::WriteTexture,
        &[texture, 0, 0, 0, 0, SIZE, SIZE, SIZE, at, bytes],
    )?;
    Ok(())
}

/// Fills `texels` with the field's four noises, in the layout of the texture's rows.
pub(crate) fn fill(texels: &mut [u8]) {
    for z in 0..SIZE {
        for y in 0..SIZE {
            for x in 0..SIZE {
                let at = ((z * SIZE * SIZE + y * SIZE + x) * 4) as usize;
                let p = [x as f32, y as f32, z as f32];
                let shape = value(p, 8.0, 0x9e37_79b9) * 0.65 + value(p, 16.0, 0x85eb_ca6b) * 0.35;
                let detail = value(p, 32.0, 0xc2b2_ae35) * 0.6 + value(p, 64.0, 0x27d4_eb2f) * 0.4;
                let billow = 1.0 - (2.0 * value(p, 12.0, 0x1656_67b1) - 1.0).abs();
                let cover = value(p, 4.0, 0x7feb_352d);
                texels[at] = (shape * 255.0) as u8;
                texels[at + 1] = (detail * 255.0) as u8;
                texels[at + 2] = (billow * 255.0) as u8;
                texels[at + 3] = (cover * 255.0) as u8;
            }
        }
    }
}

/// Value noise at `p`, whose coordinates are texels of a side of [`SIZE`], with `period` cells
/// across that side, so the noise repeats at the texture's edges. `seed` picks the pattern.
fn value(p: [f32; 3], period: f32, seed: u32) -> f32 {
    let cells = [
        p[0] * period / SIZE as f32,
        p[1] * period / SIZE as f32,
        p[2] * period / SIZE as f32,
    ];
    let base = [cells[0].floor(), cells[1].floor(), cells[2].floor()];
    let fraction = [cells[0] - base[0], cells[1] - base[1], cells[2] - base[2]];
    let fade = fraction.map(|f| f * f * f * (f * (f * 6.0 - 15.0) + 10.0));
    let wrap = period as i32;
    let lattice = |dx: i32, dy: i32, dz: i32| {
        let x = (base[0] as i32 + dx).rem_euclid(wrap);
        let y = (base[1] as i32 + dy).rem_euclid(wrap);
        let z = (base[2] as i32 + dz).rem_euclid(wrap);
        hash(x, y, z, seed)
    };
    let x00 = lerp(lattice(0, 0, 0), lattice(1, 0, 0), fade[0]);
    let x10 = lerp(lattice(0, 1, 0), lattice(1, 1, 0), fade[0]);
    let x01 = lerp(lattice(0, 0, 1), lattice(1, 0, 1), fade[0]);
    let x11 = lerp(lattice(0, 1, 1), lattice(1, 1, 1), fade[0]);
    let y0 = lerp(x00, x10, fade[1]);
    let y1 = lerp(x01, x11, fade[1]);
    lerp(y0, y1, fade[2])
}

fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

/// A number from 0 to 1 for a lattice point, from an integer hash, as the shaders' own hashes give
/// the same pattern on every GPU.
fn hash(x: i32, y: i32, z: i32, seed: u32) -> f32 {
    let mut h = (x as u32).wrapping_mul(0x8da6_b343)
        ^ (y as u32).wrapping_mul(0xd816_3841)
        ^ (z as u32).wrapping_mul(0xcb1a_b31f)
        ^ seed;
    h ^= h >> 15;
    h = h.wrapping_mul(0x2c1b_3c6d);
    h ^= h >> 12;
    h = h.wrapping_mul(0x297a_2d39);
    h ^= h >> 15;
    (h >> 8) as f32 / 16777216.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_field_repeats_at_its_edges() {
        let mut texels = vec![0u8; BYTES];
        fill(&mut texels);
        // A texel at the far edge continues the texel before the near edge, as the linear filter
        // reads across the wrap.
        let first = value([0.0, 0.0, 0.0], 8.0, 1);
        let wrapped = value([SIZE as f32, 0.0, 0.0], 8.0, 1);
        assert!((first - wrapped).abs() < 1e-4);
    }

    #[test]
    fn every_channel_varies() {
        let mut texels = vec![0u8; BYTES];
        fill(&mut texels);
        for channel in 0..4 {
            let values = texels.iter().skip(channel).step_by(4);
            let low = values.clone().min().unwrap();
            let high = values.max().unwrap();
            assert!(high - low > 100, "channel {channel} spans {low} to {high}");
        }
    }
}
