//! The Radiance RGBE format (`.hdr`), as Radiance, Poly Haven and three.js's `HDRLoader` read it.

use super::equirect::Equirect;

/// Whether `bytes` start as a Radiance file.
pub fn is_radiance(bytes: &[u8]) -> bool {
    bytes.starts_with(b"#?")
}

/// The light in an RGBE texel. The value is the mantissa times 2 to the power of the exponent
/// less 136, as three.js decodes it.
fn rgbe(texel: [u8; 4]) -> [f32; 3] {
    let e = texel[3];
    if e == 0 {
        return [0.0; 3];
    }
    let factor = f64::from_bits(((i64::from(e) - 136 + 1023) as u64) << 52) as f32;
    [
        f32::from(texel[0]) * factor,
        f32::from(texel[1]) * factor,
        f32::from(texel[2]) * factor,
    ]
}

/// Reads one line of the header, without its newline.
fn line<'a>(bytes: &'a [u8], at: &mut usize) -> Result<&'a str, String> {
    let rest = &bytes[*at..];
    let end = rest
        .iter()
        .position(|&b| b == b'\n')
        .ok_or("the Radiance header ends before its size line")?;
    *at += end + 1;
    std::str::from_utf8(&rest[..end]).map_err(|_| "the Radiance header is not text".to_string())
}

/// The image in a Radiance file.
///
/// # Errors
/// When the file is not a Radiance file in the RGBE format with rows from top to bottom, or its
/// data ends early.
pub fn read(bytes: &[u8]) -> Result<Equirect, String> {
    if !is_radiance(bytes) {
        return Err("the file does not start with a Radiance header (#?RADIANCE)".into());
    }
    let mut at = 0;
    line(bytes, &mut at)?;
    loop {
        let header = line(bytes, &mut at)?;
        if header.trim().is_empty() {
            break;
        }
        if let Some(format) = header.strip_prefix("FORMAT=")
            && format.trim() != "32-bit_rle_rgbe"
        {
            return Err(format!(
                "the Radiance file holds {}, and the tool reads 32-bit_rle_rgbe",
                format.trim()
            ));
        }
    }
    let size = line(bytes, &mut at)?;
    let parts: Vec<&str> = size.split_whitespace().collect();
    let (height, width) = match parts.as_slice() {
        ["-Y", h, "+X", w] => (h.parse::<usize>(), w.parse::<usize>()),
        _ => {
            return Err(format!(
                "the Radiance size line is \"{size}\", and the tool reads images stored from the top row down (-Y height +X width)"
            ));
        }
    };
    let (Ok(height), Ok(width)) = (height, width) else {
        return Err(format!("the Radiance size line \"{size}\" has no numbers"));
    };
    if width == 0
        || height == 0
        || width > super::equirect::MAX_SIDE
        || height > super::equirect::MAX_SIDE
    {
        return Equirect::new(width, height, Vec::new());
    }
    let mut texels = Vec::with_capacity(width * height);
    let mut row = vec![[0u8; 4]; width];
    let data = &bytes[at..];
    let mut p = 0;
    let short = || "the Radiance file ends before its last row".to_string();
    for _ in 0..height {
        let head = data.get(p..p + 4).ok_or_else(short)?;
        let run_length =
            (8..0x8000).contains(&width) && head[0] == 2 && head[1] == 2 && head[2] & 0x80 == 0;
        if run_length {
            if (usize::from(head[2]) << 8 | usize::from(head[3])) != width {
                return Err("a Radiance row's length does not match the image's width".into());
            }
            p += 4;
            for channel in 0..4 {
                let mut x = 0;
                while x < width {
                    let count = *data.get(p).ok_or_else(short)?;
                    p += 1;
                    if count > 128 {
                        let count = usize::from(count - 128);
                        let value = *data.get(p).ok_or_else(short)?;
                        p += 1;
                        if x + count > width {
                            return Err("a Radiance row runs past the image's width".into());
                        }
                        for texel in &mut row[x..x + count] {
                            texel[channel] = value;
                        }
                        x += count;
                    } else {
                        let count = usize::from(count);
                        if count == 0 || x + count > width {
                            return Err("a Radiance row runs past the image's width".into());
                        }
                        let values = data.get(p..p + count).ok_or_else(short)?;
                        p += count;
                        for (texel, &value) in row[x..x + count].iter_mut().zip(values) {
                            texel[channel] = value;
                        }
                        x += count;
                    }
                }
            }
        } else {
            let flat = data.get(p..p + 4 * width).ok_or_else(short)?;
            p += 4 * width;
            for (texel, bytes) in row.iter_mut().zip(flat.as_chunks::<4>().0) {
                *texel = *bytes;
            }
        }
        texels.extend(row.iter().map(|&t| rgbe(t)));
    }
    Equirect::new(width, height, texels)
}

#[cfg(test)]
pub mod tests {
    use super::*;

    /// A Radiance file of flat rows.
    pub fn flat_file(
        width: usize,
        height: usize,
        texel: impl Fn(usize, usize) -> [u8; 4],
    ) -> Vec<u8> {
        let mut out =
            format!("#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y {height} +X {width}\n").into_bytes();
        for y in 0..height {
            for x in 0..width {
                out.extend(texel(x, y));
            }
        }
        out
    }

    #[test]
    fn reads_flat_rows() {
        let image =
            read(&flat_file(3, 2, |x, y| [128, 64, 0, 129 + (x + y) as u8])).expect("an image");
        assert_eq!((image.width, image.height), (3, 2));
        assert_eq!(image.texels[0], [1.0, 0.5, 0.0]);
        assert_eq!(image.texels[5], [8.0, 4.0, 0.0]);
    }

    #[test]
    fn reads_run_length_rows() {
        let width = 10;
        let mut file = b"#?RADIANCE\n\n-Y 1 +X 10\n".to_vec();
        file.extend([2, 2, 0, width as u8]);
        // Red: a run of 10; green: 10 literal values; blue: a run of 4 and 6 literals; exponent: a run.
        file.extend([128 + 10, 64]);
        file.push(10);
        file.extend(0..10);
        file.extend([128 + 4, 7, 6, 1, 2, 3, 4, 5, 6]);
        file.extend([128 + 10, 128]);
        let image = read(&file).expect("an image");
        assert_eq!(image.texels[0], [64.0 / 256.0, 0.0, 7.0 / 256.0]);
        assert_eq!(image.texels[9], [64.0 / 256.0, 9.0 / 256.0, 6.0 / 256.0]);
    }

    #[test]
    fn broken_files_give_messages() {
        assert!(read(b"P6 not a radiance file").is_err());
        assert!(read(b"#?RADIANCE\nFORMAT=32-bit_rle_xyze\n\n-Y 1 +X 1\n\0\0\0\0").is_err());
        assert!(read(b"#?RADIANCE\n\n+Y 1 +X 1\n\0\0\0\0").is_err());
        let file = flat_file(4, 4, |_, _| [1, 1, 1, 128]);
        assert!(read(&file[..file.len() - 1]).is_err());
        let mut runs = b"#?RADIANCE\n\n-Y 1 +X 8\n".to_vec();
        runs.extend([2, 2, 0, 8, 128 + 100, 1]);
        assert!(read(&runs).is_err());
    }
}
