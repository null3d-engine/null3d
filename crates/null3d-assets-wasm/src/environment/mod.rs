//! Environment maps for image-based light: a prefiltered reflection cube map and nine spherical
//! harmonics coefficients of diffuse light, in one KTX2 file.
//!
//! Level 0 of the cube map holds the environment itself. Each smaller level holds it filtered for
//! a rougher surface (see [`prefilter`]), down to faces of [`SMALLEST_FACE`] texels. The file's
//! key-value data holds the coefficients and each level's roughness under [`KEY`], as JSON.

mod cube;
mod equirect;
mod exr;
mod hdr;
mod ktx2;
mod prefilter;
mod room;
mod sh;
mod vector;

pub use ktx2::{TexelFormat, from_rgb9e5};

use cube::{Chain, Cube};
use equirect::Equirect;

/// The key of the environment's data in the KTX2 file's key-value data.
pub const KEY: &str = "null3d.environment";

/// The version of the data under [`KEY`].
pub const VERSION: u32 = 1;

/// The width of the smallest level's faces.
pub const SMALLEST_FACE: usize = 8;

/// The face widths the tool writes: powers of 2 from 32 to the engine's cube texture limit.
pub const SIZES: std::ops::RangeInclusive<usize> = 32..=2048;

/// The filter's directions per texel of level 1 when the request names none. Each smaller level
/// takes twice as many as the one before, up to [`MAX_SAMPLES`]: it has a quarter of the texels,
/// and its wider lobe needs more directions for the same smoothness.
pub const DEFAULT_SAMPLES: u32 = 512;

/// The most directions per texel of any level.
pub const MAX_SAMPLES: u32 = 8192;

/// Where the environment's light comes from.
pub enum Source<'a> {
    /// A Radiance (`.hdr`) or OpenEXR (`.exr`) file of an equirectangular image.
    File(&'a [u8]),
    /// One of the engine's built-in environments, by name.
    Builtin(&'a str),
}

/// The names of the built-in environments.
pub const BUILTINS: [&str; 1] = ["room"];

/// How to build an environment map.
pub struct Settings {
    /// The width of level 0's faces.
    pub size: usize,
    pub format: TexelFormat,
    /// The filter's directions per texel of level 1.
    pub samples: u32,
}

/// The number of levels for faces `size` texels wide: down to [`SMALLEST_FACE`].
pub fn level_count(size: usize) -> usize {
    (size / SMALLEST_FACE).ilog2() as usize + 1
}

/// The perceptual roughness that level `level` of `count` levels holds.
pub fn level_roughness(level: usize, count: usize) -> f32 {
    let t = level as f32 / (count - 1) as f32;
    1.0 - (1.0 - t).sqrt()
}

/// The environment map's KTX2 file.
///
/// # Errors
/// When the size is not a power of 2 in [`SIZES`], or the source cannot be read.
pub fn build(source: &Source, settings: &Settings) -> Result<Vec<u8>, String> {
    let size = settings.size;
    if !size.is_power_of_two() || !SIZES.contains(&size) {
        return Err(format!(
            "the size {size} is not a power of 2 from {} to {}",
            SIZES.start(),
            SIZES.end()
        ));
    }
    let base = match source {
        Source::File(bytes) => {
            let image = read(bytes)?;
            let sub = image.samples_per_texel(size);
            Cube::from_fn(size, sub, |d| image.sample(d))
        }
        Source::Builtin("room") => Cube::from_fn(size, 4, room::light),
        Source::Builtin(name) => {
            return Err(format!(
                "there is no built-in environment named \"{name}\". The built-in environments: {}",
                BUILTINS.join(", ")
            ));
        }
    };
    Ok(encode(base, settings))
}

/// The image in a Radiance or OpenEXR file.
fn read(bytes: &[u8]) -> Result<Equirect, String> {
    if hdr::is_radiance(bytes) {
        hdr::read(bytes)
    } else if exr::is_exr(bytes) {
        exr::read_exr(bytes)
    } else {
        Err("the file is neither a Radiance file (.hdr) nor an OpenEXR file (.exr)".into())
    }
}

/// The file for a cube map of the environment's light at full size.
fn encode(base: Cube, settings: &Settings) -> Vec<u8> {
    let count = level_count(base.size);
    let chain = Chain::new(&base);
    let sh = sh::project(&base);
    let mut levels = vec![base];
    for level in 1..count {
        let size = settings.size >> level;
        let roughness = level_roughness(level, count);
        let samples = (settings.samples << (level - 1)).min(MAX_SAMPLES);
        levels.push(prefilter::level(&chain, size, roughness, samples));
    }
    let data = metadata(&sh, count);
    ktx2::write(
        &levels,
        settings.format,
        &[
            ("KTXwriter", b"null3D asset tool\0"),
            (KEY, data.as_bytes()),
        ],
    )
}

/// The JSON under [`KEY`], with a closing NUL as KTX2 asks of text values.
fn metadata(sh: &[[f32; 3]; 9], count: usize) -> String {
    let numbers = |values: &mut dyn Iterator<Item = f32>| {
        values.map(|v| format!("{v}")).collect::<Vec<_>>().join(",")
    };
    format!(
        "{{\"version\":{VERSION},\"sh\":[{}],\"roughness\":[{}]}}\0",
        numbers(&mut sh.iter().flatten().copied()),
        numbers(&mut (0..count).map(|l| level_roughness(l, count))),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes_give_levels_down_to_the_smallest_face() {
        assert_eq!(level_count(256), 6);
        assert_eq!(level_count(32), 3);
        assert_eq!(level_roughness(0, 6), 0.0);
        assert_eq!(level_roughness(5, 6), 1.0);
    }

    #[test]
    fn the_room_builds_and_names_its_data() {
        let settings = Settings {
            size: 32,
            format: TexelFormat::Rgb9e5,
            samples: 64,
        };
        let file = build(&Source::Builtin("room"), &settings).expect("a file");
        let text = String::from_utf8_lossy(&file);
        assert!(text.contains("{\"version\":1,\"sh\":["));
        assert!(build(&Source::Builtin("garden"), &settings).is_err());
        let odd = Settings {
            size: 48,
            ..settings
        };
        assert!(build(&Source::Builtin("room"), &odd).is_err());
    }

    #[test]
    fn unknown_files_give_a_message() {
        let settings = Settings {
            size: 32,
            format: TexelFormat::Rgb9e5,
            samples: 16,
        };
        let error = build(&Source::File(b"GIF89a"), &settings).expect_err("an error");
        assert!(error.contains("neither"));
    }
}
