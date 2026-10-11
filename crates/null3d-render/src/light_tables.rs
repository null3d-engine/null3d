//! The light tables: one 2D array texture of half floats, at binding 3 of the frame's group on
//! both GPU paths (`null3d::tables`), which the environment's filtering sampler reads.
//!
//! - Layer 0 is spare. WebGPU reads three.js's split-sum table ([`crate::dfg`]) in the materials'
//!   custom values, and WebGL2 beside the material table, so no layer holds it.
//! - Layers 1 and 2 hold the two tables of area lights in their corner, 64 x 64 texels: the values
//!   of the inverse matrices that fit GGX by linearly transformed cosines, and the scale and bias
//!   of their Fresnel terms, with two zeros. They load on first use. Until they arrive both layers
//!   hold zeros, and the core lists no area light
//!   ([`null3d_core::lights::LightTable::set_area_ready`]).
//! - Each layer from 3 on holds the image of a rectangle light, 128 x 128 texels with every mip
//!   level, in linear light.
//!
//! The texture starts at 64 x 64 texels and 3 layers with one level. A light's first image makes
//! it again at 128 x 128 texels with every level, and room for 4 images, then 8, 16 and 32 as more
//! lights take images. A frame builder then binds it again in every frame group.
//!
//! The tables are those of three.js 0.186.1's `RectAreaLightTexturesLib`, from Heitz, Dupuy, Hill
//! and Neubelt's fit (`selfshadow/ltc_code`, under the BSD two-clause licence that the engine's
//! third-party notices hold). The engine's package ships them in a file of their own, which the
//! sketch thread reads into [`LightTables::area_texels_mut`].

use null3d_gpu::drawlist::{DrawList, Op, format, texture_usage, view};

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
/// The layer of the first light's image.
pub const FIRST_IMAGE_LAYER: u32 = 3;
/// The most lights with images at once.
pub const MAX_IMAGES: usize = 32;
/// The size, layers and mip levels of the light tables' texture.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Shape {
    size: u32,
    layers: u32,
    levels: u32,
}

/// A rectangle light's image in engine memory.
#[derive(Debug)]
struct Image {
    /// The light's row in the light table, or 0 for a free place.
    light: u32,
    /// The half floats of every level, the largest first.
    texels: Vec<u16>,
    /// True while the texture lacks the image's texels.
    pending: bool,
}

/// The area lights' tables and the lights' images in engine memory, and the texture that holds
/// them on the GPU. See the module documentation.
#[derive(Debug, Default)]
pub struct LightTables {
    /// The half floats of layers 1 and 2, texel after texel: empty until the load starts.
    area: Vec<u16>,
    /// True from when the load finishes, so the shaders can read the tables.
    ready: bool,
    /// True while the texture lacks the area tables.
    area_pending: bool,
    /// The lights' images, by place: the place of an image is its layer less the first image's.
    images: Vec<Image>,
    /// The shape of the texture on the GPU, or `None` before the frame builder makes it.
    made: Option<Shape>,
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
    /// in the texture, or `None` when the light has no image.
    pub fn finish_image(&mut self, light: u32) -> Option<u32> {
        let place = self.place_of(light)?;
        self.images[place].pending = true;
        Some(FIRST_IMAGE_LAYER + place as u32)
    }

    /// Frees light `light`'s image's place for another light. The texture keeps its layers.
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

    /// The shape that the texture needs for the tables and the images.
    fn wanted(&self) -> Shape {
        if self.images.is_empty() {
            Shape {
                size: TABLE_SIZE,
                layers: FIRST_IMAGE_LAYER,
                levels: 1,
            }
        } else {
            let room = self.images.len().next_power_of_two().max(4) as u32;
            Shape {
                size: IMAGE_SIZE,
                layers: FIRST_IMAGE_LAYER + room,
                levels: IMAGE_LEVELS,
            }
        }
    }

    /// Forgets the texture, after the GPU is lost: the frame builder makes it again.
    pub fn reset_gpu(&mut self) {
        self.made = None;
    }

    /// Records the creation of the texture under id `texture`, in the shape that the tables and
    /// images need, and marks everything it holds for an upload.
    pub(crate) fn create(&mut self, list: &mut DrawList, texture: u32) -> Result<(), RecordError> {
        let shape = self.wanted();
        list.push(
            Op::CreateTexture,
            &[
                texture,
                shape.size,
                shape.size,
                shape.layers,
                format::RGBA16_FLOAT,
                texture_usage::TEXTURE_BINDING | texture_usage::COPY_DST,
                1,
                shape.levels,
                view::D2_ARRAY,
            ],
        )?;
        self.made = Some(shape);
        self.area_pending = self.ready;
        for image in &mut self.images {
            image.pending = image.light != 0;
        }
        Ok(())
    }

    /// Records what the texture lacks: the texture again in a new shape when the images need more
    /// room, the area tables once they arrive, and each image once it is filled. The copies read
    /// the tables and images where they stay in engine memory. Returns true when it made the
    /// texture again, so the frame builder uploads the split-sum table and binds the texture
    /// again.
    pub(crate) fn record(
        &mut self,
        list: &mut DrawList,
        texture: u32,
    ) -> Result<bool, RecordError> {
        let remade = self.made.is_some_and(|made| made != self.wanted());
        if remade {
            list.push(Op::DestroyTexture, &[texture])?;
            self.create(list, texture)?;
        }
        if self.area_pending {
            let bytes = halves_as_bytes(&self.area);
            list.push(
                Op::WriteTexture,
                &[
                    texture,
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
            if !image.pending {
                continue;
            }
            let mut from = 0;
            for level in 0..IMAGE_LEVELS {
                let side = IMAGE_SIZE >> level;
                let halves = (4 * side * side) as usize;
                let bytes = halves_as_bytes(&image.texels[from..from + halves]);
                list.push(
                    Op::WriteTexture,
                    &[
                        texture,
                        level,
                        0,
                        0,
                        FIRST_IMAGE_LAYER + place as u32,
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
        Ok(remade)
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
        assert_eq!(tables.made, None);
    }

    #[test]
    fn images_take_free_places_and_grow_the_texture_in_steps() {
        let mut tables = LightTables::default();
        assert_eq!(tables.wanted().layers, FIRST_IMAGE_LAYER);
        assert_eq!(
            tables.image_texels_mut(7).map(|t| t.len()),
            Some(IMAGE_HALVES)
        );
        assert_eq!(tables.finish_image(7), Some(FIRST_IMAGE_LAYER));
        assert_eq!(tables.finish_image(8), None);
        assert_eq!(
            tables.wanted(),
            Shape {
                size: IMAGE_SIZE,
                layers: FIRST_IMAGE_LAYER + 4,
                levels: IMAGE_LEVELS,
            }
        );
        // A light keeps its place for a new image, and a freed place goes to the next light.
        tables.image_texels_mut(9).unwrap();
        assert_eq!(tables.finish_image(9), Some(FIRST_IMAGE_LAYER + 1));
        tables.image_texels_mut(7).unwrap();
        assert_eq!(tables.finish_image(7), Some(FIRST_IMAGE_LAYER));
        tables.remove_image(7);
        tables.image_texels_mut(11).unwrap();
        assert_eq!(tables.finish_image(11), Some(FIRST_IMAGE_LAYER));
        for light in 20..(20 + MAX_IMAGES as u32 - 2) {
            assert!(tables.image_texels_mut(light).is_some());
        }
        assert!(tables.image_texels_mut(99).is_none());
        assert_eq!(
            tables.wanted().layers,
            FIRST_IMAGE_LAYER + MAX_IMAGES as u32
        );
    }

    #[test]
    fn the_shaders_find_the_tables_where_this_module_puts_them() {
        let tables = include_str!("../../null3d-shaders/wgsl/lib/tables.wgsl");
        for line in [
            format!("const AREA_SIZE: u32 = {TABLE_SIZE}u;"),
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
