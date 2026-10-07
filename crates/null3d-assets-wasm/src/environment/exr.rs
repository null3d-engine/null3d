//! OpenEXR files (`.exr`), through the `exr` crate, which reads every compression OpenEXR 2 defines
//! apart from DWAA and DWAB, with no unsafe code.

use std::io::Cursor;

use exr::prelude::{ReadChannels, ReadLayers, ReadSpecificChannel, read};

use super::equirect::{Equirect, MAX_SIDE};

/// Whether `bytes` start as an OpenEXR file.
pub fn is_exr(bytes: &[u8]) -> bool {
    bytes.starts_with(&[0x76, 0x2f, 0x31, 0x01])
}

/// The R, G and B channels of the first layer of an OpenEXR file, at full resolution.
///
/// # Errors
/// When the file is not one the reader takes, or it has no R, G and B channels.
pub fn read_exr(bytes: &[u8]) -> Result<Equirect, String> {
    let image = read()
        .no_deep_data()
        .largest_resolution_level()
        .specific_channels()
        .required("R")
        .required("G")
        .required("B")
        .collect_pixels(
            |size, _| {
                let (width, height) = (size.width(), size.height());
                let count = if width <= MAX_SIDE && height <= MAX_SIDE {
                    width * height
                } else {
                    0
                };
                (width, height, vec![[0.0f32; 3]; count])
            },
            |(width, _, texels), at, (r, g, b): (f32, f32, f32)| {
                if let Some(texel) = texels.get_mut(at.y() * *width + at.x()) {
                    *texel = [r, g, b];
                }
            },
        )
        .first_valid_layer()
        .all_attributes()
        .non_parallel()
        .from_buffered(Cursor::new(bytes))
        .map_err(|e| format!("the OpenEXR file could not be read: {e}"))?;
    let (width, height, texels) = image.layer_data.channel_data.pixels;
    if texels.len() != width * height {
        return Equirect::new(width, height, Vec::new());
    }
    Equirect::new(width, height, texels)
}

#[cfg(test)]
mod tests {
    use super::*;
    use exr::prelude::{Encoding, SpecificChannels, Vec2, WritableImage};

    #[test]
    fn reads_the_channels_of_a_compressed_file() {
        let (width, height) = (8, 4);
        let channels =
            SpecificChannels::rgb(|at: Vec2<usize>| (at.x() as f32, at.y() as f32, 0.25f32));
        let image = exr::prelude::Image::from_encoded_channels(
            (width, height),
            Encoding::SMALL_LOSSLESS,
            channels,
        );
        let mut file = Cursor::new(Vec::new());
        image
            .write()
            .non_parallel()
            .to_buffered(&mut file)
            .expect("a file");
        let bytes = file.into_inner();
        assert!(is_exr(&bytes));
        let read = read_exr(&bytes).expect("an image");
        assert_eq!((read.width, read.height), (width, height));
        assert_eq!(read.texels[2 * width + 5], [5.0, 2.0, 0.25]);
    }

    #[test]
    fn a_broken_file_gives_a_message() {
        assert!(read_exr(&[0x76, 0x2f, 0x31, 0x01, 2, 0, 0, 0]).is_err());
    }

    /// The light of the engine's OpenEXR reader fixtures at a texel: smooth waves with one bright
    /// texel. `packages/engine/src/scene/panorama-files.test.ts` computes the same values.
    fn fixture_light(x: usize, y: usize, channel: usize) -> f32 {
        if x == 7 && y == 3 {
            return 5000.0 + channel as f32;
        }
        let wave = (x as f32 * 0.37 + y as f32 * 0.21 + channel as f32)
            .sin()
            .abs();
        wave * 4.0 + 0.01 * (channel + 1) as f32
    }

    /// Writes the engine's OpenEXR reader fixtures: one image of 21 x 37 texels, so chunks of 16
    /// and 32 rows end part full, in R, G, B and A, as half floats in every compression the crate
    /// writes and as floats in the compressions that treat floats apart. Run it with
    /// `cargo test -p null3d-assets-wasm -- --ignored write_reader_fixtures`.
    #[test]
    #[ignore = "writes the engine's test fixtures"]
    fn write_reader_fixtures() {
        use exr::prelude::{Blocks, Compression, LineOrder, f16};
        let folder = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../tests/pages/assets/environments"
        );
        std::fs::create_dir_all(folder).expect("the fixtures' folder");
        let files = [
            ("none", Compression::Uncompressed, true),
            ("rle", Compression::RLE, false),
            ("zips", Compression::ZIP1, false),
            ("zip", Compression::ZIP16, true),
            ("piz", Compression::PIZ, true),
            ("pxr24", Compression::PXR24, true),
            ("b44", Compression::B44, false),
            ("b44a", Compression::B44A, false),
        ];
        for (name, compression, floats) in files {
            let encoding = Encoding {
                compression,
                blocks: Blocks::ScanLines,
                line_order: LineOrder::Increasing,
            };
            let size = (21, 37);
            let light = |at: Vec2<usize>, c| fixture_light(at.x(), at.y(), c);
            let half = SpecificChannels::rgba(|at: Vec2<usize>| {
                let h = |c| f16::from_f32(light(at, c));
                (h(0), h(1), h(2), f16::ONE)
            });
            exr::prelude::Image::from_encoded_channels(size, encoding, half)
                .write()
                .non_parallel()
                .to_file(format!("{folder}/exr-{name}-half.exr"))
                .expect("a half float file");
            if floats {
                let float = SpecificChannels::rgba(|at: Vec2<usize>| {
                    (light(at, 0), light(at, 1), light(at, 2), 1.0f32)
                });
                exr::prelude::Image::from_encoded_channels(size, encoding, float)
                    .write()
                    .non_parallel()
                    .to_file(format!("{folder}/exr-{name}-float.exr"))
                    .expect("a float file");
            }
        }
    }
}
