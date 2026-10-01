//! The material table: each material's parameters in the row layout that the shaders read by
//! material id, the pipeline it draws with, and the textures of its maps.
//!
//! # Rows
//!
//! Each material has one row of [`MATERIAL_FLOATS`] floats, eight `vec4f`s, which the WGSL struct
//! `Material` in `null3d::globals` mirrors field for field. The [`param`] module names where each
//! value sits. A row also holds the texture array layer of each of its maps, which the table
//! writes once the map's image is on the GPU, and [`NO_MAP`] until then. On WebGPU the table is a
//! storage buffer; on WebGL2 it is a data texture with one row of texels per material.
//!
//! A change marks its rows, and the next frame uploads the rows from the first changed one to the
//! last, not the whole table.

use std::ops::Range;

use null3d_core::handle::Handle;
use null3d_gpu::drawlist::{sizes, state_flags, template, vertex};

use crate::pipelines::DepthBias;
use crate::textures::Premultiplied;

/// How a material shades.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Shading {
    /// The standard material: glTF's metallic-roughness model, lit as three.js's
    /// `MeshStandardMaterial` is lit.
    Lit,
    /// The base color only, as three.js's `MeshBasicMaterial`.
    Unlit,
    /// The first texture coordinates as red and green, for the engine's own tests of vertex
    /// formats. Only meshes with those coordinates draw with it.
    TexCoords,
    /// The base color times the material's map, as three.js's `MeshBasicMaterial` with a `map`.
    /// A material without a live map, or on a mesh without texture coordinates, draws as
    /// [`Shading::Unlit`].
    UnlitMap,
    /// The standard material with its texture maps. A standard material draws with it when it
    /// has a live map and its mesh has texture coordinates; nothing creates it.
    StandardMaps,
}

impl Shading {
    /// The render pipeline template that draws with this shading.
    pub const fn template(self) -> u32 {
        match self {
            Shading::Lit => template::INSTANCED_LIT,
            Shading::Unlit => template::INSTANCED_UNLIT,
            Shading::TexCoords => template::INSTANCED_TEXCOORDS,
            Shading::UnlitMap => template::INSTANCED_UNLIT_MAP,
            Shading::StandardMaps => template::INSTANCED_STANDARD_MAPS,
        }
    }

    /// The optional vertex attributes (`vertex::*` bits) that its pipeline reads, which a mesh
    /// needs to draw with it.
    pub const fn attributes(self) -> u32 {
        match self {
            Shading::Lit | Shading::Unlit => 0,
            Shading::TexCoords | Shading::UnlitMap | Shading::StandardMaps => vertex::UV0,
        }
    }

    /// True when its shader reads the material's base color and opacity, which vertex colors
    /// multiply and a mask compares with the material's alpha cutoff.
    pub const fn reads_base_color(self) -> bool {
        !matches!(self, Shading::TexCoords)
    }
}

/// Options fixed when a material is created, which choose its pipeline or its shader's code.
pub mod feature {
    /// Both faces of each triangle draw, and back faces light as if they faced the camera.
    pub const DOUBLE_SIDED: u32 = 1;
    /// The mesh's vertex colors multiply the base color, on meshes that have them.
    pub const VERTEX_COLORS: u32 = 2;
    /// Each triangle lights with one normal, the normal of its face.
    pub const FLAT_SHADING: u32 = 4;
    /// Fragments whose alpha is below the material's cutoff draw nothing: glTF's alpha mode `MASK`.
    pub const ALPHA_MASK: u32 = 8;
    /// The surface blends over what lies behind it, in the transparent pass that draws such
    /// surfaces back to front: glTF's alpha mode `BLEND`. It wins over [`ALPHA_MASK`].
    pub const BLEND: u32 = 16;
    /// The surface writes no depth.
    pub const NO_DEPTH_WRITE: u32 = 32;
    /// The surface draws whatever the depth target holds, and writes no depth.
    pub const NO_DEPTH_TEST: u32 = 64;
    /// With [`BLEND`], the surface's light adds to what lies behind it.
    pub const ADDITIVE: u32 = 128;
    /// With [`BLEND`], the surface tints what lies behind it. It wins over [`ADDITIVE`].
    pub const MULTIPLY: u32 = 256;
    /// The scene's fog leaves the material's color as it is.
    pub const NO_FOG: u32 = 1024;
    /// Every feature.
    pub const ALL: u32 = DOUBLE_SIDED
        | VERTEX_COLORS
        | FLAT_SHADING
        | ALPHA_MASK
        | BLEND
        | NO_DEPTH_WRITE
        | NO_DEPTH_TEST
        | ADDITIVE
        | MULTIPLY
        | NO_FOG;
}

/// The blend state of a material's features (`state_flags::BLEND_*`), or 0 for a material that
/// does not blend.
pub const fn blend_state(features: u32) -> u32 {
    if features & feature::BLEND == 0 {
        0
    } else if features & feature::MULTIPLY != 0 {
        state_flags::BLEND_MULTIPLY
    } else if features & feature::ADDITIVE != 0 {
        state_flags::BLEND_ADDITIVE
    } else {
        state_flags::BLEND_NORMAL
    }
}

/// Bits of a row's flags, which shaders test with no cost worth a shader variant.
pub mod flag {
    /// The shader lights each triangle with its face's normal.
    pub const FLAT_SHADING: u32 = 1;
    /// The shader writes its color times its alpha, beside the alpha, as premultiplied blending
    /// reads them. Other shaders write an alpha of 1.
    pub const BLEND: u32 = 2;
    /// The shader skips the scene's fog.
    pub const NO_FOG: u32 = 4;
    /// The base color map holds sRGB colors that were multiplied by their alpha while encoded, so
    /// the shader divides them by it again before it uses them.
    pub const MAP_PREMULTIPLIED: u32 = 8;
    /// With `MAP_PREMULTIPLIED`, the base color map holds linear colors instead, multiplied by
    /// their alpha.
    pub const MAP_LINEAR: u32 = 16;
    /// The map of slot `s` reads the second texture coordinates when bit `SECOND_UV << s` is set.
    pub const SECOND_UV: u32 = 256;
}

/// The row flags (`flag::*` bits) of a material with `features` (`feature::*` bits). The base
/// color map's flag comes later, from its texels.
const fn row_flags(features: u32) -> u32 {
    let mut flags = 0;
    if features & feature::FLAT_SHADING != 0 {
        flags |= flag::FLAT_SHADING;
    }
    if features & feature::BLEND != 0 {
        flags |= flag::BLEND;
    }
    if features & feature::NO_FOG != 0 {
        flags |= flag::NO_FOG;
    }
    flags
}

/// Floats in each material's row: eight `vec4f`s.
pub const MATERIAL_FLOATS: usize = sizes::MATERIAL_BYTES as usize / 4;
/// Texels in each material's row of the WebGL2 data texture, one `vec4f` each.
pub const MATERIAL_TEXELS: u32 = MATERIAL_FLOATS as u32 / 4;

/// Where each value sits in a material's row, in floats. Colors are linear.
pub mod param {
    /// The base color: 3 floats.
    pub const COLOR: usize = 0;
    /// The opacity, from 0 to 1.
    pub const OPACITY: usize = 3;
    /// The emissive color: 3 floats, which the shaders multiply by [`EMISSIVE_INTENSITY`].
    pub const EMISSIVE: usize = 4;
    /// The alpha below which a masked material draws nothing.
    pub const ALPHA_CUTOFF: usize = 7;
    /// The metalness, from 0 to 1.
    pub const METALNESS: usize = 8;
    /// The perceptual roughness, from 0 to 1.
    pub const ROUGHNESS: usize = 9;
    /// How strongly the normal map bends normals along u and along v: 2 floats.
    pub const NORMAL_SCALE: usize = 10;
    /// How much the occlusion map darkens indirect light, from 0 to 1.
    pub const OCCLUSION_STRENGTH: usize = 12;
    /// The factor of the light map's light.
    pub const LIGHT_MAP_INTENSITY: usize = 13;
    /// Shading switches (`flag::*` bits) as a float, fixed when the material is created.
    pub const FLAGS: usize = 14;
    /// The factor of the emissive color.
    pub const EMISSIVE_INTENSITY: usize = 15;
    /// The transform of the first texture coordinates as two rows of a 2 x 3 matrix. The row that
    /// gives u is 3 floats here, and the row that gives v is 3 floats at [`UV_V`].
    pub const UV_U: usize = 16;
    /// The row of the texture coordinate transform that gives v: 3 floats.
    pub const UV_V: usize = 20;
    /// The texture array layer of each map, in [`super::MapSlot`] order: one float per slot.
    pub const MAP_LAYERS: usize = 24;

    /// The floats of the value that starts at `at`, for a value that sketches set, or `None` for
    /// the flags, the map layers, a spare float or a float inside a value.
    pub const fn width(at: usize) -> Option<usize> {
        match at {
            COLOR | EMISSIVE | UV_U | UV_V => Some(3),
            NORMAL_SCALE => Some(2),
            OPACITY | ALPHA_CUTOFF | METALNESS | ROUGHNESS | OCCLUSION_STRENGTH
            | LIGHT_MAP_INTENSITY | EMISSIVE_INTENSITY => Some(1),
            _ => None,
        }
    }
}

/// A map layer in a row for a map that draws nothing: none is set, or its image is not on the
/// GPU yet. Shaders test for a layer of 0 or more.
pub const NO_MAP: f32 = -1.0;

/// The maps a material can sample, in the order their layers sit in its row.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MapSlot {
    /// The base color and opacity, in sRGB.
    BaseColor = 0,
    /// Roughness in green and metalness in blue, as glTF packs them.
    MetalRough = 1,
    /// Normals in tangent space.
    Normal = 2,
    /// Ambient occlusion in red.
    Occlusion = 3,
    /// The emissive color, in sRGB.
    Emissive = 4,
    /// Baked light, read at the second texture coordinates.
    Light = 5,
}

/// The number of map slots in a row.
pub const MAP_SLOTS: usize = 6;

impl MapSlot {
    /// Every slot, in the order of a row's maps, so a slot's number indexes it.
    pub const ALL: [MapSlot; MAP_SLOTS] = [
        MapSlot::BaseColor,
        MapSlot::MetalRough,
        MapSlot::Normal,
        MapSlot::Occlusion,
        MapSlot::Emissive,
        MapSlot::Light,
    ];
}

/// A row's values before the sketch changes any: white, opaque, not metal, fully rough, the
/// identity texture coordinate transform, and no maps. The metalness and roughness are three.js's
/// `MeshStandardMaterial` defaults; the alpha cutoff is glTF's.
const DEFAULT_ROW: [f32; MATERIAL_FLOATS] = {
    let mut row = [0.0; MATERIAL_FLOATS];
    let mut k = 0;
    while k < 4 {
        row[param::COLOR + k] = 1.0;
        k += 1;
    }
    row[param::ALPHA_CUTOFF] = 0.5;
    row[param::ROUGHNESS] = 1.0;
    row[param::NORMAL_SCALE] = 1.0;
    row[param::NORMAL_SCALE + 1] = 1.0;
    row[param::OCCLUSION_STRENGTH] = 1.0;
    row[param::LIGHT_MAP_INTENSITY] = 1.0;
    row[param::EMISSIVE_INTENSITY] = 1.0;
    row[param::UV_U] = 1.0;
    row[param::UV_V + 1] = 1.0;
    let mut slot = 0;
    while slot < MAP_SLOTS {
        row[param::MAP_LAYERS + slot] = NO_MAP;
        slot += 1;
    }
    row
};

/// Materials by id, with a fixed capacity so the GPU table never moves.
#[derive(Debug)]
pub struct MaterialTable {
    /// Each material's row, in id order.
    rows: Vec<f32>,
    shading: Vec<Shading>,
    /// Each material's features (`feature::*` bits).
    features: Vec<u32>,
    /// Each material's maps by slot, `Handle::NONE` where it has none.
    maps: Vec<[Handle; MAP_SLOTS]>,
    /// Each material's depth bias.
    biases: Vec<DepthBias>,
    capacity: u32,
    /// The ids whose rows changed since the last upload; empty when none did.
    changed: Range<u32>,
    /// True when a map changed since its layer was last written.
    maps_changed: bool,
}

/// Why a material could not be created or changed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MaterialError {
    /// The table holds its capacity already.
    Full,
    /// No material has this id.
    Unknown(u32),
    /// No value that sketches set starts at this float of a row, or the value has another width.
    Value(u32),
}

impl MaterialTable {
    pub fn with_capacity(capacity: u32) -> Self {
        Self {
            rows: Vec::with_capacity(capacity as usize * MATERIAL_FLOATS),
            shading: Vec::with_capacity(capacity as usize),
            features: Vec::with_capacity(capacity as usize),
            maps: Vec::with_capacity(capacity as usize),
            biases: Vec::with_capacity(capacity as usize),
            capacity,
            changed: 0..0,
            maps_changed: false,
        }
    }

    /// Adds a material with its features (`feature::*` bits, fixed from now on), a linear color
    /// and opacity, and the default values of the rest of its row. Returns its id, counting from 0.
    pub fn create(
        &mut self,
        shading: Shading,
        features: u32,
        color: [f32; 4],
    ) -> Result<u32, MaterialError> {
        let id = self.len();
        if id >= self.capacity {
            return Err(MaterialError::Full);
        }
        let features = features & feature::ALL;
        self.rows.extend_from_slice(&DEFAULT_ROW);
        let row = &mut self.rows[id as usize * MATERIAL_FLOATS..];
        row[..4].copy_from_slice(&color);
        row[param::FLAGS] = row_flags(features) as f32;
        self.shading.push(shading);
        self.features.push(features);
        self.maps.push([Handle::NONE; MAP_SLOTS]);
        self.biases.push(DepthBias::NONE);
        self.mark_row(id);
        Ok(id)
    }

    /// Gives a material a depth bias. It is part of the material's pipeline, so it is set once,
    /// right after [`MaterialTable::create`].
    pub fn set_depth_bias(&mut self, id: u32, bias: DepthBias) -> Result<(), MaterialError> {
        let slot = self
            .biases
            .get_mut(id as usize)
            .ok_or(MaterialError::Unknown(id))?;
        *slot = bias;
        Ok(())
    }

    /// A material's depth bias, or none for an id that names no material.
    pub fn depth_bias(&self, id: u32) -> DepthBias {
        self.biases
            .get(id as usize)
            .copied()
            .unwrap_or(DepthBias::NONE)
    }

    /// Changes the value that starts at float `at` of a material's row (`param::*`) and keeps the
    /// others. `values` holds as many floats as the value has.
    pub fn set(&mut self, id: u32, at: usize, values: &[f32]) -> Result<(), MaterialError> {
        if param::width(at) != Some(values.len()) {
            return Err(MaterialError::Value(at as u32));
        }
        let start = id as usize * MATERIAL_FLOATS + at;
        let row = self.rows.get_mut(start..start + values.len());
        row.ok_or(MaterialError::Unknown(id))?
            .copy_from_slice(values);
        self.mark_row(id);
        Ok(())
    }

    /// Adds a row to the range that the next frame uploads.
    fn mark_row(&mut self, id: u32) {
        self.changed = if self.changed.is_empty() {
            id..id + 1
        } else {
            self.changed.start.min(id)..self.changed.end.max(id + 1)
        };
    }

    /// Gives a material a map in `slot`: a texture, or none with `Handle::NONE`, which the
    /// shader reads at the second texture coordinates when `second_uv` is true.
    pub fn set_map(
        &mut self,
        id: u32,
        slot: MapSlot,
        texture: Handle,
        second_uv: bool,
    ) -> Result<(), MaterialError> {
        let maps = self
            .maps
            .get_mut(id as usize)
            .ok_or(MaterialError::Unknown(id))?;
        maps[slot as usize] = texture;
        let flags = &mut self.rows[id as usize * MATERIAL_FLOATS + param::FLAGS];
        let bit = flag::SECOND_UV << slot as u32;
        let bits = *flags as u32 & !bit | if second_uv { bit } else { 0 };
        *flags = bits as f32;
        self.mark_row(id);
        self.maps_changed = true;
        Ok(())
    }

    /// A material's maps by slot, `Handle::NONE` where it has none.
    pub fn maps(&self, id: u32) -> [Handle; MAP_SLOTS] {
        self.maps
            .get(id as usize)
            .copied()
            .unwrap_or([Handle::NONE; MAP_SLOTS])
    }

    /// A material's map in `slot`, or `Handle::NONE`.
    pub fn map(&self, id: u32, slot: MapSlot) -> Handle {
        self.maps
            .get(id as usize)
            .map_or(Handle::NONE, |maps| maps[slot as usize])
    }

    /// A material's features (`feature::*` bits), or none for an id that names no material.
    pub fn features(&self, id: u32) -> u32 {
        self.features.get(id as usize).copied().unwrap_or(0)
    }

    pub fn shading(&self, id: u32) -> Result<Shading, MaterialError> {
        self.shading
            .get(id as usize)
            .copied()
            .ok_or(MaterialError::Unknown(id))
    }

    pub fn len(&self) -> u32 {
        self.shading.len() as u32
    }

    pub fn is_empty(&self) -> bool {
        self.shading.is_empty()
    }

    pub fn capacity(&self) -> u32 {
        self.capacity
    }

    /// The rows of the materials in `ids`, one after another.
    pub fn rows(&self, ids: Range<u32>) -> &[f32] {
        &self.rows[ids.start as usize * MATERIAL_FLOATS..ids.end as usize * MATERIAL_FLOATS]
    }

    /// Marks every row changed, so the next frame uploads the whole table.
    pub fn mark_changed(&mut self) {
        self.changed = 0..self.len();
    }

    /// Writes each map's layer into its row when a map changed, or when `layers_changed` says
    /// that a texture's layer became ready or stopped drawing. `ready_layer` gives the layer of a
    /// texture whose image is on the GPU, and `premultiplied` says whether that image holds colors
    /// multiplied by their alpha, which the row's flags then say for the base color map. Only rows
    /// whose layers or flags differ count as changed.
    pub fn update_map_layers(
        &mut self,
        layers_changed: bool,
        ready_layer: impl Fn(Handle) -> Option<u32>,
        premultiplied: impl Fn(Handle) -> Premultiplied,
    ) {
        if !std::mem::take(&mut self.maps_changed) && !layers_changed {
            return;
        }
        for id in 0..self.len() {
            let maps = self.maps[id as usize];
            let row = &mut self.rows[id as usize * MATERIAL_FLOATS..][..MATERIAL_FLOATS];
            let mut changed = false;
            let layers = &mut row[param::MAP_LAYERS..param::MAP_LAYERS + MAP_SLOTS];
            for (layer, map) in layers.iter_mut().zip(maps) {
                let ready = if map.is_none() {
                    None
                } else {
                    ready_layer(map)
                };
                let value = ready.map_or(NO_MAP, |layer| layer as f32);
                changed |= *layer != value;
                *layer = value;
            }
            // The base color map's texels decide whether its colors are premultiplied.
            let base = maps[MapSlot::BaseColor as usize];
            let base_flags = if row[param::MAP_LAYERS] == NO_MAP {
                0
            } else {
                match premultiplied(base) {
                    Premultiplied::No => 0,
                    Premultiplied::Srgb => flag::MAP_PREMULTIPLIED,
                    Premultiplied::Linear => flag::MAP_PREMULTIPLIED | flag::MAP_LINEAR,
                }
            };
            let map_flags = flag::MAP_PREMULTIPLIED | flag::MAP_LINEAR;
            let flags = ((row[param::FLAGS] as u32 & !map_flags) | base_flags) as f32;
            changed |= row[param::FLAGS] != flags;
            row[param::FLAGS] = flags;
            if changed {
                self.mark_row(id);
            }
        }
    }

    /// The ids whose rows changed since the last call, once, or `None` when none did.
    pub fn take_changed(&mut self) -> Option<Range<u32>> {
        let changed = std::mem::replace(&mut self.changed, 0..0);
        (!changed.is_empty()).then_some(changed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(table: &MaterialTable, id: u32) -> &[f32] {
        table.rows(id..id + 1)
    }

    fn layers(table: &MaterialTable, id: u32) -> Vec<f32> {
        row(table, id)[param::MAP_LAYERS..][..MAP_SLOTS].to_vec()
    }

    #[test]
    fn materials_get_ids_in_order_and_report_changes_once() {
        let mut table = MaterialTable::with_capacity(2);
        assert_eq!(table.create(Shading::Lit, 0, [1.0, 0.0, 0.0, 1.0]), Ok(0));
        assert_eq!(table.create(Shading::Unlit, 0, [0.0, 1.0, 0.0, 1.0]), Ok(1));
        assert_eq!(
            table.create(Shading::Lit, 0, [0.0; 4]),
            Err(MaterialError::Full)
        );
        assert_eq!(table.take_changed(), Some(0..2));
        assert_eq!(table.take_changed(), None);
        table.set(1, param::COLOR, &[0.5, 0.5, 0.5]).unwrap();
        assert_eq!(table.take_changed(), Some(1..2));
        assert_eq!(&row(&table, 1)[..4], &[0.5, 0.5, 0.5, 1.0]);
        assert_eq!(table.shading(1), Ok(Shading::Unlit));
        assert_eq!(
            table.set(2, param::COLOR, &[0.0; 3]),
            Err(MaterialError::Unknown(2))
        );
    }

    #[test]
    fn a_new_row_holds_the_default_values_where_the_shaders_read_them() {
        let mut table = MaterialTable::with_capacity(1);
        table.create(Shading::Lit, 0, [0.2, 0.3, 0.4, 0.5]).unwrap();
        let row = row(&table, 0);
        assert_eq!(row.len(), MATERIAL_FLOATS);
        assert_eq!(&row[param::COLOR..param::COLOR + 3], &[0.2, 0.3, 0.4]);
        assert_eq!(row[param::OPACITY], 0.5);
        assert_eq!(&row[param::EMISSIVE..param::EMISSIVE + 3], &[0.0; 3]);
        assert_eq!(row[param::ALPHA_CUTOFF], 0.5);
        assert_eq!([row[param::METALNESS], row[param::ROUGHNESS]], [0.0, 1.0]);
        assert_eq!(
            &row[param::NORMAL_SCALE..param::NORMAL_SCALE + 2],
            &[1.0; 2]
        );
        assert_eq!(row[param::OCCLUSION_STRENGTH], 1.0);
        assert_eq!(row[param::LIGHT_MAP_INTENSITY], 1.0);
        assert_eq!(row[param::FLAGS], 0.0);
        assert_eq!(row[param::EMISSIVE_INTENSITY], 1.0);
        assert_eq!(&row[param::UV_U..param::UV_U + 3], &[1.0, 0.0, 0.0]);
        assert_eq!(&row[param::UV_V..param::UV_V + 3], &[0.0, 1.0, 0.0]);
        assert_eq!(
            &row[param::MAP_LAYERS..param::MAP_LAYERS + MAP_SLOTS],
            &[NO_MAP; MAP_SLOTS]
        );
    }

    #[test]
    fn each_value_has_its_own_floats_and_vectors_hold_whole_values() {
        let mut starts = [
            (param::COLOR, 3),
            (param::OPACITY, 1),
            (param::EMISSIVE, 3),
            (param::ALPHA_CUTOFF, 1),
            (param::METALNESS, 1),
            (param::ROUGHNESS, 1),
            (param::NORMAL_SCALE, 2),
            (param::OCCLUSION_STRENGTH, 1),
            (param::LIGHT_MAP_INTENSITY, 1),
            (param::FLAGS, 1),
            (param::EMISSIVE_INTENSITY, 1),
            (param::UV_U, 3),
            (param::UV_V, 3),
            (param::MAP_LAYERS, MAP_SLOTS),
        ];
        starts.sort();
        for pair in starts.windows(2) {
            let ((start, length), (next, _)) = (pair[0], pair[1]);
            assert!(start + length <= next, "values overlap at float {next}");
        }
        for (start, length) in starts {
            // The shaders read a value of up to four floats from one vec4f, so none crosses one;
            // the map layers take one and a half.
            if length <= 4 {
                assert_eq!(start / 4, (start + length - 1) / 4, "float {start}");
            }
            assert!(start + length <= MATERIAL_FLOATS);
        }
        assert_eq!(MATERIAL_TEXELS * 16, MATERIAL_FLOATS as u32 * 4);
    }

    #[test]
    fn color_and_opacity_change_apart() {
        let mut table = MaterialTable::with_capacity(2);
        table.create(Shading::Lit, 0, [1.0, 0.0, 0.0, 1.0]).unwrap();
        table
            .create(Shading::Unlit, 0, [0.0, 1.0, 0.0, 1.0])
            .unwrap();
        table.take_changed();
        table.set(0, param::OPACITY, &[0.25]).unwrap();
        assert_eq!(table.take_changed(), Some(0..1));
        table.set(0, param::COLOR, &[0.0, 0.0, 1.0]).unwrap();
        assert_eq!(table.take_changed(), Some(0..1));
        assert_eq!(&row(&table, 0)[..4], &[0.0, 0.0, 1.0, 0.25]);
        assert_eq!(&row(&table, 1)[..4], &[0.0, 1.0, 0.0, 1.0]);
        assert_eq!(
            table.set(2, param::OPACITY, &[0.5]),
            Err(MaterialError::Unknown(2))
        );
        assert_eq!(table.take_changed(), None);
    }

    #[test]
    fn sketches_set_whole_values_only() {
        let mut table = MaterialTable::with_capacity(1);
        table.create(Shading::Lit, 0, [1.0; 4]).unwrap();
        table.take_changed();
        table.set(0, param::METALNESS, &[0.75]).unwrap();
        table.set(0, param::ROUGHNESS, &[0.25]).unwrap();
        table.set(0, param::EMISSIVE, &[1.0, 0.5, 0.0]).unwrap();
        table.set(0, param::EMISSIVE_INTENSITY, &[2.0]).unwrap();
        table.set(0, param::NORMAL_SCALE, &[0.5, -0.5]).unwrap();
        table.set(0, param::UV_V, &[0.0, 2.0, 0.25]).unwrap();
        let row = row(&table, 0);
        assert_eq!([row[param::METALNESS], row[param::ROUGHNESS]], [0.75, 0.25]);
        assert_eq!(&row[param::EMISSIVE..param::EMISSIVE + 3], &[1.0, 0.5, 0.0]);
        assert_eq!(row[param::EMISSIVE_INTENSITY], 2.0);
        assert_eq!(&row[param::NORMAL_SCALE..][..2], &[0.5, -0.5]);
        assert_eq!(&row[param::UV_V..][..3], &[0.0, 2.0, 0.25]);
        for (at, values) in [
            (param::FLAGS, &[1.0][..]),
            (param::MAP_LAYERS, &[3.0][..]),
            (param::COLOR + 1, &[0.0][..]),
            (param::METALNESS, &[0.0, 0.0][..]),
            (param::COLOR, &[0.0][..]),
        ] {
            assert_eq!(
                table.set(0, at, values),
                Err(MaterialError::Value(at as u32))
            );
        }
    }

    #[test]
    fn features_are_kept_and_flat_shading_and_no_fog_are_flags_in_the_row() {
        let mut table = MaterialTable::with_capacity(4);
        let flat = feature::FLAT_SHADING | feature::DOUBLE_SIDED;
        table
            .create(Shading::Lit, flat | 1 << 30, [1.0; 4])
            .unwrap();
        table
            .create(Shading::Unlit, feature::VERTEX_COLORS, [1.0; 4])
            .unwrap();
        table
            .create(Shading::Unlit, feature::NO_FOG, [1.0; 4])
            .unwrap();
        table
            .create(
                Shading::Lit,
                feature::NO_FOG | feature::FLAT_SHADING,
                [1.0; 4],
            )
            .unwrap();
        assert_eq!(table.features(0), flat, "unknown bits are dropped");
        assert_eq!(table.features(1), feature::VERTEX_COLORS);
        assert_eq!(table.features(2), feature::NO_FOG);
        assert_eq!(table.features(9), 0);
        assert_eq!(row(&table, 0)[param::FLAGS], flag::FLAT_SHADING as f32);
        assert_eq!(row(&table, 1)[param::FLAGS], 0.0);
        assert_eq!(row(&table, 2)[param::FLAGS], flag::NO_FOG as f32);
        let both = flag::FLAT_SHADING | flag::NO_FOG;
        assert_eq!(row(&table, 3)[param::FLAGS], both as f32);
    }

    #[test]
    fn each_material_keeps_its_depth_bias_and_none_is_the_default() {
        let mut table = MaterialTable::with_capacity(2);
        let plain = table.create(Shading::Lit, 0, [1.0; 4]).unwrap();
        let decal = table
            .create(Shading::Unlit, feature::NO_DEPTH_WRITE, [1.0; 4])
            .unwrap();
        let bias = DepthBias::from_polygon_offset(-2.0, -1.0);
        table.set_depth_bias(decal, bias).unwrap();
        assert_eq!(table.depth_bias(plain), DepthBias::NONE);
        assert_eq!(table.depth_bias(decal), bias);
        assert_eq!(table.features(decal), feature::NO_DEPTH_WRITE);
        assert_eq!(
            table.set_depth_bias(2, bias),
            Err(MaterialError::Unknown(2))
        );
        assert_eq!(table.depth_bias(2), DepthBias::NONE);
    }

    #[test]
    fn changes_upload_the_rows_from_the_first_changed_to_the_last() {
        let mut table = MaterialTable::with_capacity(5);
        for _ in 0..5 {
            table.create(Shading::Lit, 0, [1.0; 4]).unwrap();
        }
        table.take_changed();
        table.set(3, param::COLOR, &[0.0; 3]).unwrap();
        table.set(1, param::OPACITY, &[0.5]).unwrap();
        assert_eq!(table.take_changed(), Some(1..4));
        table.mark_changed();
        assert_eq!(table.take_changed(), Some(0..5));
    }

    #[test]
    fn rows_hold_the_layer_of_each_map_that_is_ready() {
        let mut table = MaterialTable::with_capacity(3);
        let plain = table.create(Shading::Unlit, 0, [1.0; 4]).unwrap();
        let mapped = table.create(Shading::UnlitMap, 0, [1.0; 4]).unwrap();
        let waiting = table.create(Shading::UnlitMap, 0, [1.0; 4]).unwrap();
        table.take_changed();
        let (ready, on_its_way) = (Handle::new(1, 0), Handle::new(2, 0));
        table
            .set_map(mapped, MapSlot::BaseColor, ready, false)
            .unwrap();
        table
            .set_map(waiting, MapSlot::Emissive, on_its_way, true)
            .unwrap();
        assert_eq!(table.map(mapped, MapSlot::BaseColor), ready);
        assert_eq!(table.map(mapped, MapSlot::Emissive), Handle::NONE);
        assert_eq!(table.map(plain, MapSlot::BaseColor), Handle::NONE);
        let layer = |texture: Handle| (texture == ready).then_some(7);
        assert_eq!(
            row(&table, waiting)[param::FLAGS],
            (flag::SECOND_UV << MapSlot::Emissive as u32) as f32,
            "the emissive map reads the second texture coordinates"
        );
        assert_eq!(table.maps(waiting)[MapSlot::Emissive as usize], on_its_way);
        table.take_changed();
        table.update_map_layers(false, layer, |_| Premultiplied::No);
        assert_eq!(
            table.take_changed(),
            Some(mapped..mapped + 1),
            "only it changed"
        );
        assert_eq!(layers(&table, mapped), [7.0, -1.0, -1.0, -1.0, -1.0, -1.0]);
        assert_eq!(layers(&table, waiting), [NO_MAP; MAP_SLOTS]);
        table.update_map_layers(false, layer, |_| Premultiplied::No);
        assert_eq!(table.take_changed(), None, "nothing changed");
        // A texture whose layer became ready writes the layers again.
        let both = |_: Handle| Some(3);
        table.update_map_layers(true, both, |_| Premultiplied::No);
        assert_eq!(table.take_changed(), Some(mapped..waiting + 1));
        assert_eq!(layers(&table, waiting)[MapSlot::Emissive as usize], 3.0);
        // A premultiplied base color map's encoding sets the flags; an emissive map's does not.
        let map_flags = |table: &MaterialTable, id| {
            row(table, id)[param::FLAGS] as u32 & (flag::MAP_PREMULTIPLIED | flag::MAP_LINEAR)
        };
        for (premultiplied, flags) in [
            (Premultiplied::Srgb, flag::MAP_PREMULTIPLIED),
            (
                Premultiplied::Linear,
                flag::MAP_PREMULTIPLIED | flag::MAP_LINEAR,
            ),
            (Premultiplied::No, 0),
        ] {
            table.update_map_layers(true, both, |_| premultiplied);
            assert_eq!(map_flags(&table, mapped), flags, "{premultiplied:?}");
            assert_eq!(map_flags(&table, waiting), 0);
        }
        assert_eq!(
            table.set_map(9, MapSlot::BaseColor, ready, false),
            Err(MaterialError::Unknown(9))
        );
    }
}
