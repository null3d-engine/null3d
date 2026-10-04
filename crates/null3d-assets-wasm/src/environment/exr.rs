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
}
