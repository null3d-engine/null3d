//! KTX2 files of cube maps in the two texel formats that every GPU path filters: `rgb9e5ufloat`
//! and `rgba16float`.
//!
//! The layout follows the KTX 2.0 specification: no supercompression, levels stored from the
//! smallest to the largest, the six faces of each level in order, and a data format descriptor
//! as KTX-Software's `createDFD` writes it for the format.

use super::cube::{Cube, FACES};

/// The texel formats of the tool's cube maps.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TexelFormat {
    /// Three 9-bit mantissas with a shared 5-bit exponent in 32 bits.
    Rgb9e5,
    /// Four 16-bit floats in 64 bits. Alpha is 1.
    Rgba16Float,
}

impl TexelFormat {
    /// The Vulkan format number that KTX2 files use.
    fn vk_format(self) -> u32 {
        match self {
            Self::Rgb9e5 => 123,
            Self::Rgba16Float => 97,
        }
    }

    /// Bytes per texel.
    pub fn bytes(self) -> usize {
        match self {
            Self::Rgb9e5 => 4,
            Self::Rgba16Float => 8,
        }
    }

    /// The size of the data type that a reader swaps for byte order.
    fn type_size(self) -> u32 {
        match self {
            Self::Rgb9e5 => 4,
            Self::Rgba16Float => 2,
        }
    }

    /// The largest value the format holds.
    pub fn max(self) -> f32 {
        match self {
            Self::Rgb9e5 => 65_408.0,
            Self::Rgba16Float => 65_504.0,
        }
    }

    /// Appends a texel's bytes.
    fn push(self, out: &mut Vec<u8>, rgb: [f32; 3]) {
        match self {
            Self::Rgb9e5 => out.extend(rgb9e5(rgb).to_le_bytes()),
            Self::Rgba16Float => {
                for c in rgb {
                    out.extend(
                        half::f16::from_f32(c.min(self.max()))
                            .to_bits()
                            .to_le_bytes(),
                    );
                }
                out.extend(half::f16::ONE.to_bits().to_le_bytes());
            }
        }
    }

    /// The data format descriptor's samples: bit offset, bit length less one, channel and
    /// qualifiers, lower and upper values.
    fn samples(self) -> &'static [(u16, u8, u8, u32, u32)] {
        const FLOAT_SIGNED: u8 = 0x80 | 0x40;
        const EXPONENT: u8 = 0x20;
        const ONE: u32 = 0x3f80_0000;
        const MINUS_ONE: u32 = 0xbf80_0000;
        match self {
            Self::Rgb9e5 => &[
                (0, 8, 0, 0, 8448),
                (27, 4, EXPONENT, 15, 31),
                (9, 8, 1, 0, 8448),
                (27, 4, 1 | EXPONENT, 15, 31),
                (18, 8, 2, 0, 8448),
                (27, 4, 2 | EXPONENT, 15, 31),
            ],
            Self::Rgba16Float => &[
                (0, 15, FLOAT_SIGNED, MINUS_ONE, ONE),
                (16, 15, 1 | FLOAT_SIGNED, MINUS_ONE, ONE),
                (32, 15, 2 | FLOAT_SIGNED, MINUS_ONE, ONE),
                (48, 15, 15 | FLOAT_SIGNED, MINUS_ONE, ONE),
            ],
        }
    }
}

/// 2 to the power of `e`, for exponents of normal floats.
fn pow2(e: i32) -> f32 {
    f32::from_bits(((e + 127) as u32) << 23)
}

/// The shared-exponent packing of `EXT_texture_shared_exponent`, rounding to nearest.
pub fn rgb9e5(rgb: [f32; 3]) -> u32 {
    const MANTISSA_BITS: i32 = 9;
    const BIAS: i32 = 15;
    let max = TexelFormat::Rgb9e5.max();
    let [r, g, b] = rgb.map(|c| if c > 0.0 { c.min(max) } else { 0.0 });
    let largest = r.max(g).max(b);
    if largest < pow2(-BIAS - MANTISSA_BITS) {
        return 0;
    }
    // floor(log2(largest)) from the float's exponent bits, exact for normal floats.
    let floor_log2 = ((largest.to_bits() >> 23) & 0xff) as i32 - 127;
    let mut exponent = floor_log2.max(-BIAS - 1) + 1 + BIAS;
    let top = (largest / pow2(exponent - BIAS - MANTISSA_BITS) + 0.5).floor();
    if top >= (1 << MANTISSA_BITS) as f32 {
        exponent += 1;
    }
    let unit = pow2(exponent - BIAS - MANTISSA_BITS);
    let m = |c: f32| ((c / unit + 0.5).floor() as u32).min(511);
    m(r) | m(g) << 9 | m(b) << 18 | (exponent as u32) << 27
}

/// Unpacks a shared-exponent texel.
pub fn from_rgb9e5(texel: u32) -> [f32; 3] {
    let unit = pow2(((texel >> 27) as i32) - 15 - 9);
    [0, 9, 18].map(|shift| ((texel >> shift) & 511) as f32 * unit)
}

/// The data format descriptor, with its total size first.
fn descriptor(format: TexelFormat) -> Vec<u8> {
    let samples = format.samples();
    let block = 24 + 16 * samples.len();
    let mut out = Vec::with_capacity(4 + block);
    out.extend(((4 + block) as u32).to_le_bytes());
    // Khronos vendor, basic descriptor type, version 2, block size.
    out.extend(0u32.to_le_bytes());
    out.extend((2u32 | (block as u32) << 16).to_le_bytes());
    // RGBSDA model, BT.709 primaries, linear transfer, straight alpha.
    out.extend([1, 1, 1, 0]);
    // A block of one texel, and its bytes in plane 0.
    out.extend([0u8; 4]);
    out.extend([format.bytes() as u8, 0, 0, 0, 0, 0, 0, 0]);
    for &(offset, length, channel, lower, upper) in samples {
        out.extend(offset.to_le_bytes());
        out.push(length);
        out.push(channel);
        out.extend([0u8; 4]);
        out.extend(lower.to_le_bytes());
        out.extend(upper.to_le_bytes());
    }
    out
}

/// The key-value data: each entry is its length, then the key and value, then padding to 4 bytes.
/// Keys come in byte order.
fn key_values(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut out = Vec::new();
    for (key, value) in entries {
        let length = key.len() + 1 + value.len();
        out.extend((length as u32).to_le_bytes());
        out.extend(key.as_bytes());
        out.push(0);
        out.extend(*value);
        out.resize(out.len().next_multiple_of(4), 0);
    }
    out
}

/// A KTX2 file of a cube map with its levels, largest first, and its key-value entries.
pub fn write(levels: &[Cube], format: TexelFormat, entries: &[(&str, &[u8])]) -> Vec<u8> {
    const IDENTIFIER: [u8; 12] = [
        0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a,
    ];
    let size = levels[0].size as u32;
    let header = 12 + 9 * 4 + 4 * 4 + 2 * 8;
    let index = 24 * levels.len();
    let dfd = descriptor(format);
    let kvd = key_values(entries);
    let dfd_offset = header + index;
    let kvd_offset = dfd_offset + dfd.len();
    let alignment = format.bytes().max(4);
    let mut data_offset = (kvd_offset + kvd.len()).next_multiple_of(alignment);

    let mut out = Vec::new();
    out.extend(IDENTIFIER);
    for word in [
        format.vk_format(),
        format.type_size(),
        size,
        size,
        0,
        0,
        FACES as u32,
        levels.len() as u32,
        0,
    ] {
        out.extend(word.to_le_bytes());
    }
    for word in [dfd_offset, dfd.len(), kvd_offset, kvd.len()] {
        out.extend((word as u32).to_le_bytes());
    }
    out.extend([0u8; 16]);
    // The level index lists level 0 first, while the data holds the smallest level first.
    let lengths: Vec<usize> = levels
        .iter()
        .map(|l| FACES * l.size * l.size * format.bytes())
        .collect();
    let mut offsets = vec![0; levels.len()];
    for i in (0..levels.len()).rev() {
        offsets[i] = data_offset;
        data_offset = (data_offset + lengths[i]).next_multiple_of(alignment);
    }
    for (offset, length) in offsets.iter().zip(&lengths) {
        out.extend((*offset as u64).to_le_bytes());
        out.extend((*length as u64).to_le_bytes());
        out.extend((*length as u64).to_le_bytes());
    }
    out.extend(dfd);
    out.extend(kvd);
    for level in levels.iter().rev() {
        out.resize(out.len().next_multiple_of(alignment), 0);
        for &texel in &level.texels {
            format.push(&mut out, texel);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_exponents_round_trip_within_a_step() {
        for rgb in [
            [1.0, 0.5, 0.25],
            [1000.0, 3.0, 0.0],
            [0.001, 0.002, 0.0005],
            [65_408.0, 1.0, 0.0],
        ] {
            let back = from_rgb9e5(rgb9e5(rgb));
            let largest = rgb[0].max(rgb[1]).max(rgb[2]);
            for (a, b) in rgb.iter().zip(back) {
                assert!((a - b).abs() <= largest / 256.0, "{rgb:?} {back:?}");
            }
        }
        assert_eq!(from_rgb9e5(rgb9e5([1.0, 0.0, 0.0])), [1.0, 0.0, 0.0]);
        assert_eq!(rgb9e5([0.0; 3]), 0);
        assert_eq!(from_rgb9e5(rgb9e5([1e9, -1.0, f32::NAN]))[0], 65_408.0);
        // A value that rounds up to the next power of 2 takes the next exponent.
        assert_eq!(from_rgb9e5(rgb9e5([1.999_99, 0.0, 0.0])), [2.0, 0.0, 0.0]);
    }

    #[test]
    fn the_file_lays_out_its_levels_smallest_first() {
        let levels = [
            Cube::from_fn(4, 1, |_| [1.0; 3]),
            Cube::from_fn(2, 1, |_| [2.0; 3]),
        ];
        let file = write(&levels, TexelFormat::Rgb9e5, &[("KTXwriter", b"test\0")]);
        let word = |at: usize| u32::from_le_bytes(file[at..at + 4].try_into().unwrap());
        let long = |at: usize| u64::from_le_bytes(file[at..at + 8].try_into().unwrap()) as usize;
        assert_eq!(word(12), 123);
        assert_eq!((word(20), word(24), word(36), word(40)), (4, 4, 6, 2));
        let (level0, level1) = (long(80), long(104));
        assert_eq!(long(88), 6 * 16 * 4);
        assert!(level1 < level0);
        assert_eq!(level0 % 4, 0);
        assert_eq!(from_rgb9e5(word(level1)), [2.0; 3]);
        assert_eq!(from_rgb9e5(word(level0)), [1.0; 3]);
        assert_eq!(level0 + long(88), file.len());
        // The descriptor's total size matches the index, and the key-value data names the writer.
        assert_eq!(word(word(48) as usize) as usize, word(52) as usize);
        let kvd = word(56) as usize;
        assert_eq!(&file[kvd + 4..kvd + 13], b"KTXwriter");
    }

    #[test]
    fn half_float_texels_carry_an_opaque_alpha() {
        let file = write(
            &[Cube::from_fn(1, 1, |_| [0.5, 1.0, 2.0])],
            TexelFormat::Rgba16Float,
            &[],
        );
        let at = u64::from_le_bytes(file[80..88].try_into().unwrap()) as usize;
        assert_eq!(at % 8, 0);
        let half = |i: usize| {
            half::f16::from_bits(u16::from_le_bytes([file[at + 2 * i], file[at + 2 * i + 1]]))
                .to_f32()
        };
        assert_eq!([half(0), half(1), half(2), half(3)], [0.5, 1.0, 2.0, 1.0]);
    }
}
