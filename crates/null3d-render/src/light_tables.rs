//! The light tables: three.js's split-sum table (WebGL2 only), the two tables of area lights and
//! the images of lights, kept in the frame group's shared texture array ([`crate::probes`]
//! owns that array; its module notes describe the layers). The array is one 2D array texture of
//! half floats at binding 3 of the frame's group on both GPU paths (`null3d::tables`), which the
//! environment's filtering sampler reads.
//!
//! - Layer 0 is spare: it held the split-sum table before the probes took the array over. WebGL2
//!   reads the split-sum table beside the material table, and WebGPU in the materials' custom
//!   values, so no layer holds it.
//! - Layers 1 and 2 ([`AREA_LAYER`]) hold the two tables of area lights in their corner, 64 x 64
//!   texels: the values of the inverse matrices that fit GGX by linearly transformed cosines, and
//!   the scale and bias of their Fresnel terms, with two zeros. They load on first use. Until they
//!   arrive both layers hold zeros, and the core lists no area light
//!   ([`null3d_core::lights::LightTable::set_area_ready`]).
//! - The reflection probes' maps take the layers from [`FIRST_IMAGE_LAYER`] on, one each.
//! - Each layer after the probes holds a light's image, 128 x 128 texels with every mip level, in
//!   linear light, in its corner: the picture that a rectangle light shows over its area, or the
//!   map that a spot light projects over its cone.
//!
//! The texture starts at 64 x 64 texels and 3 layers with one level, and grows on demand: a probe
//! or a light's first image makes it again at the size and layers that both need. A regrow copies
//! the existing layers into the new texture, so no probe captures again and the images are
//! re-uploaded from engine memory, which costs nothing.
//!
//! The tables are those of three.js 0.186.1's `RectAreaLightTexturesLib`, from Heitz, Dupuy, Hill
//! and Neubelt's fit (`selfshadow/ltc_code`, under the BSD two-clause licence that the engine's
//! third-party notices hold). The engine's package ships them in a file of their own, which the
//! sketch thread reads into [`LightTables::area_texels_mut`].

use null3d_gpu::drawlist::{DrawList, Op};

use crate::frame::{RecordError, address};

/// Texels along each side of each area table.
pub const TABLE_SIZE: u32 = 64;
/// The first layer of the area lights' tables.
pub const AREA_LAYER: u32 = 1;
/// Half floats in the two area tables: four per texel.
pub const AREA_HALVES: usize = (4 * TABLE_SIZE * TABLE_SIZE * 2) as usize;
/// Texels along each side of a light's image.
pub const IMAGE_SIZE: u32 = 128;
/// Mip levels of a light's image, down to one texel.
pub const IMAGE_LEVELS: u32 = 8;
/// Half floats of one image with every level: four per texel.
pub const IMAGE_HALVES: usize = 4 * (4usize.pow(IMAGE_LEVELS) - 1) / 3;
/// The first layer of the probes' maps, and so of the images that follow them.
pub const FIRST_IMAGE_LAYER: u32 = 3;
/// The most lights with images at once.
pub const MAX_IMAGES: usize = 32;

/// The size, layers and mip levels that the light tables need of the shared texture, beside the
/// probes' maps.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Shape {
    /// Texels across a side of each layer.
    pub size: u32,
    /// The layers: the area tables, the probes' maps, then the images' room.
    pub layers: u32,
    /// Mip levels the light images need, or 1 while no image is present.
    pub levels: u32,
}

/// A light's image in engine memory.
#[derive(Debug)]
struct Image {
    /// The light's row in the light table, or 0 for a free place.
    light: u32,
    /// The half floats of every level, the largest first.
    texels: Vec<u16>,
    /// True while the texture lacks the image's texels.
    pending: bool,
}

/// The area lights' tables and the lights' images in engine memory, and the layers of the frame
/// group's shared array that hold them. See the module documentation.
#[derive(Debug, Default)]
pub struct LightTables {
    /// The half floats of layers 1 and 2, texel after texel: empty until the load starts.
    area: Vec<u16>,
    /// True from when the load finishes, so the shaders can read the tables.
    ready: bool,
    /// True while the array lacks the area tables.
    area_pending: bool,
    /// The lights' images, by place: an image's layer is the probes' layers, then its place.
    images: Vec<Image>,
    /// The probe layers that the array holds, from the last frame's shape: the images follow them.
    probe_layers: u32,
}

impl LightTables {
    /// The half floats of the two area tables, for the sketch thread to fill. The first call makes
    /// room for them, outside any frame. Returns `None` when memory cannot grow.
    pub fn area_texels_mut(&mut self) -> Option<&mut [u16]> {
        if self.area.is_empty() {
            self.area.try_reserve_exact(AREA_HALVES).ok()?;
            self.area.resize(AREA_HALVES, 0);
        }
        Some(&mut self.area)
    }

    /// Marks the area tables as filled, so the next frame uploads them. It does nothing before
    /// [`LightTables::area_texels_mut`] makes room for them.
    pub fn finish_area(&mut self) {
        if self.area.len() == AREA_HALVES {
            self.ready = true;
            self.area_pending = true;
        }
    }

    /// True once the area tables have arrived.
    pub fn ready(&self) -> bool {
        self.ready
    }

    /// The half floats of light `light`'s image, for the sketch thread to fill: its own place, or
    /// a free one. Returns `None` when every place is taken or memory cannot grow.
    pub fn image_texels_mut(&mut self, light: u32) -> Option<&mut [u16]> {
        let place = match self.place_of(light) {
            Some(place) => place,
            None => {
                let free = self.images.iter().position(|image| image.light == 0);
                let place = match free {
                    Some(place) => place,
                    None if self.images.len() < MAX_IMAGES => {
                        self.images.try_reserve(1).ok()?;
                        let mut texels = Vec::new();
                        texels.try_reserve_exact(IMAGE_HALVES).ok()?;
                        texels.resize(IMAGE_HALVES, 0);
                        self.images.push(Image {
                            light: 0,
                            texels,
                            pending: false,
                        });
                        self.images.len() - 1
                    }
                    None => return None,
                };
                self.images[place].light = light;
                place
            }
        };
        Some(&mut self.images[place].texels)
    }

    /// Marks light `light`'s image as filled, so the next frame uploads it, and returns its layer
    /// in the shared array, or `None` when the light has no image. The images follow the probe
    /// layers, which `probe_layers` gives.
    pub fn finish_image(&mut self, light: u32, probe_layers: u32) -> Option<u32> {
        let place = self.place_of(light)?;
        self.images[place].pending = true;
        Some(FIRST_IMAGE_LAYER + probe_layers + place as u32)
    }

    /// Frees light `light`'s image's place for another light. The array keeps its layers.
    pub fn remove_image(&mut self, light: u32) {
        if let Some(place) = self.place_of(light) {
            let image = &mut self.images[place];
            image.light = 0;
            image.pending = false;
        }
    }

    fn place_of(&self, light: u32) -> Option<usize> {
        (light != 0)
            .then(|| self.images.iter().position(|image| image.light == light))
            .flatten()
    }

    /// The image layers' room: a power of two of at least four once a light has an image, else 0.
    fn image_room(&self) -> u32 {
        if self.images.is_empty() {
            0
        } else {
            self.images.len().next_power_of_two().max(4) as u32
        }
    }

    /// The shape the shared array needs for the light content beside `probe_layers` layers of
    /// `probe_size` texels: the size the larger of the two needs, the layers of the tables, the
    /// probes and the images, and the levels the images need.
    pub fn shape(&self, probe_size: u32, probe_layers: u32) -> Shape {
        let images = self.image_room();
        let size = if probe_layers > 0 {
            probe_size.max(IMAGE_SIZE)
        } else if images > 0 {
            IMAGE_SIZE
        } else {
            TABLE_SIZE
        };
        Shape {
            size,
            layers: FIRST_IMAGE_LAYER + probe_layers + images,
            levels: if images > 0 { IMAGE_LEVELS } else { 1 },
        }
    }

    /// Forgets the array, after the GPU is lost: the next frame uploads everything again.
    pub fn reset_gpu(&mut self) {
        self.area_pending = self.ready;
        for image in &mut self.images {
            image.pending = image.light != 0;
        }
    }

    /// Records what the array lacks: the area tables once they arrive, and each image once it is
    /// filled, into `array`, which the probes own. `probe_layers` gives the probe layers that the
    /// images follow, as the frame's shape set them.
    pub(crate) fn record(
        &mut self,
        list: &mut DrawList,
        array: u32,
        probe_layers: u32,
    ) -> Result<bool, RecordError> {
        let changed = self.probe_layers != probe_layers
            || self
                .images
                .iter()
                .any(|image| image.pending && image.light != 0);
        self.probe_layers = probe_layers;
        if self.area_pending {
            let bytes = halves_as_bytes(&self.area);
            list.push(
                Op::WriteTexture,
                &[
                    array,
                    0,
                    0,
                    0,
                    AREA_LAYER,
                    TABLE_SIZE,
                    TABLE_SIZE,
                    2,
                    address(bytes),
                    bytes.len() as u32,
                ],
            )?;
            self.area_pending = false;
        }
        for (place, image) in self.images.iter_mut().enumerate() {
            if !image.pending || image.light == 0 {
                continue;
            }
            let layer = FIRST_IMAGE_LAYER + probe_layers + place as u32;
            let mut from = 0;
            for level in 0..IMAGE_LEVELS {
                let side = IMAGE_SIZE >> level;
                let halves = (4 * side * side) as usize;
                let bytes = halves_as_bytes(&image.texels[from..from + halves]);
                list.push(
                    Op::WriteTexture,
                    &[
                        array,
                        level,
                        0,
                        0,
                        layer,
                        side,
                        side,
                        1,
                        address(bytes),
                        bytes.len() as u32,
                    ],
                )?;
                from += halves;
            }
            image.pending = false;
        }
        Ok(changed)
    }
}

/// The bytes of half floats, in the engine's little-endian memory.
fn halves_as_bytes(halves: &[u16]) -> &[u8] {
    // SAFETY: a u16 has no padding bytes, and the slice covers exactly the halves' bytes.
    unsafe { std::slice::from_raw_parts(halves.as_ptr().cast::<u8>(), size_of_val(halves)) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_area_tables_finish_only_once_they_have_room_and_upload_again_after_a_loss() {
        let mut tables = LightTables::default();
        tables.finish_area();
        assert!(!tables.ready());
        assert_eq!(tables.area_texels_mut().map(|t| t.len()), Some(AREA_HALVES));
        assert!(!tables.ready());
        tables.finish_area();
        assert!(tables.ready() && tables.area_pending);
        tables.area_pending = false;
        tables.reset_gpu();
        assert!(tables.area_pending);
    }

    #[test]
    fn images_take_free_places_and_the_shape_grows_in_steps() {
        let mut tables = LightTables::default();
        assert_eq!(
            tables.shape(256, 0),
            Shape {
                size: TABLE_SIZE,
                layers: FIRST_IMAGE_LAYER,
                levels: 1,
            }
        );
        assert_eq!(
            tables.image_texels_mut(7).map(|t| t.len()),
            Some(IMAGE_HALVES)
        );
        assert_eq!(tables.finish_image(7, 4), Some(FIRST_IMAGE_LAYER + 4));
        assert_eq!(tables.finish_image(8, 4), None);
        assert_eq!(
            tables.shape(256, 4),
            Shape {
                size: IMAGE_SIZE.max(256),
                layers: FIRST_IMAGE_LAYER + 4 + 4,
                levels: IMAGE_LEVELS,
            }
        );
        // A light keeps its place for a new image, and a freed place goes to the next light.
        tables.image_texels_mut(9).unwrap();
        assert_eq!(tables.finish_image(9, 4), Some(FIRST_IMAGE_LAYER + 5));
        tables.image_texels_mut(7).unwrap();
        assert_eq!(tables.finish_image(7, 4), Some(FIRST_IMAGE_LAYER + 4));
        tables.remove_image(7);
        tables.image_texels_mut(11).unwrap();
        assert_eq!(tables.finish_image(11, 4), Some(FIRST_IMAGE_LAYER + 4));
        for light in 20..(20 + MAX_IMAGES as u32 - 2) {
            assert!(tables.image_texels_mut(light).is_some());
        }
        assert!(tables.image_texels_mut(99).is_none());
        assert_eq!(
            tables.shape(128, 2).layers,
            FIRST_IMAGE_LAYER + 2 + MAX_IMAGES as u32
        );
    }

    #[test]
    fn the_shaders_find_the_tables_where_this_module_puts_them() {
        let tables = include_str!("../../null3d-shaders/wgsl/lib/tables.wgsl");
        for line in [
            format!("const AREA_SIZE: u32 = {TABLE_SIZE}u;"),
            format!("const IMAGE_SIZE: u32 = {IMAGE_SIZE}u;"),
            format!("const IMAGE_LEVELS: f32 = {IMAGE_LEVELS}.0;"),
            "@group(0) @binding(3) var light_tables: texture_2d_array<f32>;".to_string(),
            format!("table({AREA_LAYER}, uv), table({}, uv).xy", AREA_LAYER + 1),
        ] {
            assert!(tables.contains(&line), "lib/tables.wgsl lacks {line}");
        }
    }

    #[test]
    fn the_light_loop_knows_the_core_s_area_light_kinds() {
        use null3d_core::lights::kind;
        let lights = include_str!("../../null3d-shaders/wgsl/lib/lights.wgsl");
        for line in [
            format!("const KIND_RECT: u32 = {}u;", kind::RECT),
            format!("const KIND_TUBE: u32 = {}u;", kind::TUBE),
        ] {
            assert!(lights.contains(&line), "lib/lights.wgsl lacks {line}");
        }
        // Every kind from RECT on is an area light.
        assert_eq!(kind::LAST, kind::TUBE);
    }

    #[test]
    fn the_light_loops_leave_out_the_area_lights_that_they_cannot_shade() {
        // The light grid lists area lights while the lit templates draw with their `AREA_LIGHTS`
        // builds. Decals, particles, sprites and the fog's light step draw with templates that
        // never take that bit, and a record's fields hold a rectangle's shape and image layer
        // where a point light keeps its decay, cone and shadow tile. So a light loop that has no
        // tables must leave an area light out (D-145's addendum of 16 October).
        let lights = include_str!("../../null3d-shaders/wgsl/lib/lights.wgsl");
        assert_eq!(
            lights.matches("if kind >= KIND_RECT {").count(),
            2,
            "lib/lights.wgsl must test the kind in both arms of its light loop"
        );
        assert!(
            lights.contains("#else\n"),
            "lib/lights.wgsl must give a build without the tables an arm that leaves area lights out"
        );
        let fog = include_str!("../../null3d-shaders/wgsl/fog_light.wgsl");
        assert_eq!(
            fog.matches(">= KIND_RECT {\n            continue;").count(),
            1,
            "fog_light.wgsl must skip an area light rather than read its record as a lamp"
        );
    }
}
