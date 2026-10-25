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
//! - Each layer after the probes holds a light's image in linear light, in its corner: the
//!   picture that a rectangle light shows over its area, or the map that a spot light projects
//!   over its cone. An image keeps the detail of its picture up to [`MAX_IMAGE_SIZE`] texels a
//!   side, with every mip level; its record names the size along with its layer.
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
/// The fewest texels along each side of a light's image: a small picture keeps this detail.
pub const IMAGE_SIZE: u32 = 128;
/// The most texels along each side of a light's image: a detailed picture keeps this detail.
pub const MAX_IMAGE_SIZE: u32 = 512;
/// Mip levels of an image at [`IMAGE_SIZE`], down to one texel.
pub const IMAGE_LEVELS: u32 = 8;
/// Half floats of an image at [`IMAGE_SIZE`] with every level: four per texel.
pub const IMAGE_HALVES: usize = halves(IMAGE_SIZE);
/// The first layer of the probes' maps, and so of the images that follow them.
pub const FIRST_IMAGE_LAYER: u32 = 3;
/// The most lights with images at once.
pub const MAX_IMAGES: usize = 32;

/// The mip levels of an image of `size` texels a side: every level down to one texel.
pub const fn levels_of(size: u32) -> u32 {
    size.ilog2() + 1
}

/// The half floats of an image of `size` texels a side, with every level: four per texel.
pub const fn halves(size: u32) -> usize {
    let mut total = 0;
    let mut side = size as usize;
    let mut level = 0;
    while level < levels_of(size) {
        total += 4 * side * side;
        side >>= 1;
        level += 1;
    }
    total
}

/// The number that a light's record keeps for its image's size, or `None` for a size that an
/// image cannot take: a power of two from [`IMAGE_SIZE`] to [`MAX_IMAGE_SIZE`]. The record packs
/// it above the image's layer, so the two travel in one float.
pub fn size_index(size: u32) -> Option<u32> {
    (size.is_power_of_two() && (IMAGE_SIZE..=MAX_IMAGE_SIZE).contains(&size))
        .then(|| size.ilog2() - IMAGE_SIZE.ilog2())
}

/// The texels across a side of an image whose record keeps `index` above its layer.
pub const fn size_of_index(index: u32) -> u32 {
    IMAGE_SIZE << index
}

/// Bits of a light's record that hold its image's layer, above the bits that hold the size's
/// number. The record holds the layer plus one, so 0 names an image that the light lacks.
pub const IMAGE_LAYER_BITS: u32 = 6;

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
    /// The texels across a side of the image's largest level.
    size: u32,
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

    /// The half floats of light `light`'s image of `size` texels a side, for the sketch thread to
    /// fill: its own place, or a free one. A new size makes the image's memory again. Returns
    /// `None` when every place is taken or memory cannot grow.
    pub fn image_texels_mut(&mut self, light: u32, size: u32) -> Option<&mut [u16]> {
        let halves = halves(size);
        let place = match self.place_of(light) {
            Some(place) => place,
            None => {
                let free = self.images.iter().position(|image| image.light == 0);
                let place = match free {
                    Some(place) => place,
                    None if self.images.len() < MAX_IMAGES => {
                        self.images.try_reserve(1).ok()?;
                        self.images.push(Image {
                            light: 0,
                            size,
                            texels: Vec::new(),
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
        let image = &mut self.images[place];
        image.size = size;
        if image.texels.len() != halves {
            image.texels.try_reserve_exact(halves).ok()?;
            image.texels.resize(halves, 0);
        }
        Some(&mut image.texels)
    }

    /// Marks light `light`'s image as filled, so the next frame uploads it, and returns the number
    /// that the light's record keeps for it: its layer in the shared array, and the number of its
    /// size above that (see [`size_index`]). The images follow the probe layers, which
    /// `probe_layers` gives. Returns `None` when the light has no image.
    pub fn finish_image(&mut self, light: u32, probe_layers: u32) -> Option<f32> {
        let place = self.place_of(light)?;
        let image = &mut self.images[place];
        image.pending = true;
        let layer = FIRST_IMAGE_LAYER + probe_layers + place as u32;
        let index = size_index(image.size)?;
        Some(((layer + 1) | (index << IMAGE_LAYER_BITS)) as f32)
    }

    /// The texels across a side of the largest image, or [`IMAGE_SIZE`] while no light has one.
    pub fn image_size(&self) -> u32 {
        self.images
            .iter()
            .filter(|image| image.light != 0)
            .map(|image| image.size)
            .max()
            .unwrap_or(IMAGE_SIZE)
    }

    /// The record that each light with an image needs once the array holds `probe_layers` probe
    /// layers: its layer in the shared array, and the number of its size above that (see
    /// [`size_index`]). A probe's layers come before the images', so a probe that a scene adds or
    /// removes moves every image, and the light records name the new place.
    pub fn image_records(&self, probe_layers: u32) -> impl Iterator<Item = (u32, f32)> + '_ {
        self.images
            .iter()
            .enumerate()
            .filter(|(_, image)| image.light != 0)
            .filter_map(move |(place, image)| {
                let layer = FIRST_IMAGE_LAYER + probe_layers + place as u32;
                let index = size_index(image.size)?;
                Some((
                    image.light,
                    ((layer + 1) | (index << IMAGE_LAYER_BITS)) as f32,
                ))
            })
    }

    /// True when the images moved to another place in the array since the last frame recorded
    /// them, so their lights need the records that [`LightTables::image_records`] gives.
    pub fn image_layers_moved(&self, probe_layers: u32) -> bool {
        self.probe_layers != probe_layers && self.images.iter().any(|image| image.light != 0)
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
        let image = self.image_size();
        let size = if probe_layers > 0 {
            probe_size.max(image)
        } else if images > 0 {
            image
        } else {
            TABLE_SIZE
        };
        Shape {
            size,
            layers: FIRST_IMAGE_LAYER + probe_layers + images,
            levels: if images > 0 { levels_of(image) } else { 1 },
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
        let moved = self.probe_layers != probe_layers;
        // A probe's layers come before the images', so an image whose place moved uploads again
        // into its new layer.
        if moved {
            for image in &mut self.images {
                image.pending = image.light != 0;
            }
        }
        let changed = moved
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
            for level in 0..levels_of(image.size) {
                let side = image.size >> level;
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
            tables.image_texels_mut(7, IMAGE_SIZE).map(|t| t.len()),
            Some(IMAGE_HALVES)
        );
        let first = (FIRST_IMAGE_LAYER + 4 + 1) as f32;
        assert_eq!(tables.finish_image(7, 4), Some(first));
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
        tables.image_texels_mut(9, IMAGE_SIZE).unwrap();
        assert_eq!(tables.finish_image(9, 4), Some(first + 1.0));
        tables.image_texels_mut(7, IMAGE_SIZE).unwrap();
        assert_eq!(tables.finish_image(7, 4), Some(first));
        tables.remove_image(7);
        tables.image_texels_mut(11, IMAGE_SIZE).unwrap();
        assert_eq!(tables.finish_image(11, 4), Some(first));
        for light in 20..(20 + MAX_IMAGES as u32 - 2) {
            assert!(tables.image_texels_mut(light, IMAGE_SIZE).is_some());
        }
        assert!(tables.image_texels_mut(99, IMAGE_SIZE).is_none());
        assert_eq!(
            tables.shape(128, 2).layers,
            FIRST_IMAGE_LAYER + 2 + MAX_IMAGES as u32
        );
    }

    #[test]
    fn an_image_keeps_its_own_size_and_its_record_names_it() {
        let mut tables = LightTables::default();
        tables.image_texels_mut(3, IMAGE_SIZE).unwrap();
        let layer = FIRST_IMAGE_LAYER;
        let small = tables.finish_image(3, 0).unwrap();
        // The smallest image's record holds its layer alone, as a light without one holds 0.
        assert_eq!(small, (layer + 1) as f32);
        assert_eq!(tables.image_size(), IMAGE_SIZE);
        assert_eq!(tables.shape(128, 0).size, IMAGE_SIZE);
        assert_eq!(tables.shape(128, 0).levels, levels_of(IMAGE_SIZE));

        // A larger image sets the array's size, and its record packs the number of its size above
        // the layer's bits.
        tables.image_texels_mut(4, MAX_IMAGE_SIZE).unwrap();
        let big = tables.finish_image(4, 0).unwrap();
        assert_eq!(tables.image_size(), MAX_IMAGE_SIZE);
        let index = size_index(MAX_IMAGE_SIZE).unwrap();
        assert_eq!(big, ((layer + 1 + 1) | (index << IMAGE_LAYER_BITS)) as f32);
        assert_eq!((big as u32) & ((1 << IMAGE_LAYER_BITS) - 1), layer + 2);
        assert_eq!(
            size_of_index((big as u32) >> IMAGE_LAYER_BITS),
            MAX_IMAGE_SIZE
        );
        // The smaller image keeps its own size, so the shader reads each one at its own detail.
        assert_eq!(
            size_of_index((small as u32) >> IMAGE_LAYER_BITS),
            IMAGE_SIZE
        );
    }

    #[test]
    fn an_image_size_is_a_power_of_two_from_the_smallest_to_the_largest() {
        assert_eq!(size_index(IMAGE_SIZE), Some(0));
        assert_eq!(size_index(256), Some(1));
        assert_eq!(size_index(MAX_IMAGE_SIZE), Some(2));
        for bad in [0, 1, 100, 192, MAX_IMAGE_SIZE * 2] {
            assert_eq!(size_index(bad), None, "{bad} is not an image size");
        }
        assert_eq!(halves(IMAGE_SIZE), IMAGE_HALVES);
        assert_eq!(halves(256), 4 * (4usize.pow(9) - 1) / 3);
        assert_eq!(halves(MAX_IMAGE_SIZE), 4 * (4usize.pow(10) - 1) / 3);
    }

    #[test]
    fn a_probe_moves_the_images_and_their_records() {
        let mut tables = LightTables::default();
        tables.image_texels_mut(4, 256).unwrap();
        let before = tables.finish_image(4, 0).unwrap();
        assert_eq!((before as u32) & 63, FIRST_IMAGE_LAYER + 1);
        // Two probe layers arrive, so the image moves two layers along and uploads again.
        assert!(tables.image_layers_moved(2));
        let records: Vec<(u32, f32)> = tables.image_records(2).collect();
        assert_eq!(records.len(), 1);
        let (light, after) = records[0];
        assert_eq!(light, 4);
        assert_eq!((after as u32) & 63, FIRST_IMAGE_LAYER + 2 + 1);
        assert_eq!((after as u32) >> IMAGE_LAYER_BITS, size_index(256).unwrap());

        let mut list = DrawList::with_capacity(1024);
        tables.record(&mut list, 7, 2).unwrap();
        // The frame's list writes every level of the image into its new layer.
        let writes = null3d_gpu::drawlist::decode(list.words())
            .filter(|command| command.as_ref().map(|c| c.op) == Ok(Op::WriteTexture))
            .count();
        assert_eq!(writes, levels_of(256) as usize);
        assert!(
            !tables.image_layers_moved(2),
            "the records now name the layers"
        );
    }

    #[test]
    fn the_shaders_find_the_tables_where_this_module_puts_them() {
        let tables = include_str!("../../null3d-shaders/wgsl/lib/tables.wgsl");
        for line in [
            format!("const AREA_SIZE: u32 = {TABLE_SIZE}u;"),
            format!("const IMAGE_SIZE: f32 = {IMAGE_SIZE}.0;"),
            format!(
                "const IMAGE_BASE_LEVELS: f32 = {}.0;",
                levels_of(IMAGE_SIZE)
            ),
            format!("const IMAGE_LAYER_BITS: u32 = {IMAGE_LAYER_BITS}u;"),
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
        // tables must leave an area light out (D-145).
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
