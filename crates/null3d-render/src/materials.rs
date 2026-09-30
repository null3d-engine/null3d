//! The material table: each material's parameters in the layout the shaders read by material id,
//! the pipeline it draws with, and the maps table, which names the texture layer of each
//! material's maps.

use null3d_core::handle::Handle;
use null3d_gpu::drawlist::{template, vertex};

use crate::textures::NO_LAYER;

/// How a material shades.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Shading {
    /// Lambert lighting from the sun and ambient light, as three.js's `MeshLambertMaterial`.
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
}

impl Shading {
    /// The render pipeline template that draws with this shading.
    pub const fn template(self) -> u32 {
        match self {
            Shading::Lit => template::INSTANCED_LIT,
            Shading::Unlit => template::INSTANCED_UNLIT,
            Shading::TexCoords => template::INSTANCED_TEXCOORDS,
            Shading::UnlitMap => template::INSTANCED_UNLIT_MAP,
        }
    }

    /// The optional vertex attributes (`vertex::*` bits) that its pipeline reads, which a mesh
    /// needs to draw with it.
    pub const fn attributes(self) -> u32 {
        match self {
            Shading::Lit | Shading::Unlit => 0,
            Shading::TexCoords | Shading::UnlitMap => vertex::UV0,
        }
    }
}

/// Material parameters in the GPU layout: a linear base color and opacity.
pub const MATERIAL_FLOATS: usize = 4;
/// Words of each material's entry in the maps table: the layer of its map, then words that other
/// maps will take.
pub const MAP_WORDS: usize = 4;

/// Materials by id, with a fixed capacity so the GPU tables never move.
#[derive(Debug)]
pub struct MaterialTable {
    parameters: Vec<f32>,
    shading: Vec<Shading>,
    /// Each material's map, or `Handle::NONE`.
    maps: Vec<Handle>,
    /// The maps table as the shaders read it.
    map_words: Vec<u32>,
    capacity: u32,
    changed: bool,
    maps_changed: bool,
}

/// Why a material could not be created.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MaterialError {
    /// The table holds its capacity already.
    Full,
    /// No material has this id.
    Unknown(u32),
}

impl MaterialTable {
    pub fn with_capacity(capacity: u32) -> Self {
        Self {
            parameters: Vec::with_capacity(capacity as usize * MATERIAL_FLOATS),
            shading: Vec::with_capacity(capacity as usize),
            maps: Vec::with_capacity(capacity as usize),
            map_words: Vec::with_capacity(capacity as usize * MAP_WORDS),
            capacity,
            changed: false,
            maps_changed: false,
        }
    }

    /// Adds a material with a linear color and returns its id, counting from 0.
    pub fn create(&mut self, shading: Shading, color: [f32; 4]) -> Result<u32, MaterialError> {
        if self.shading.len() as u32 >= self.capacity {
            return Err(MaterialError::Full);
        }
        self.parameters.extend_from_slice(&color);
        self.shading.push(shading);
        self.maps.push(Handle::NONE);
        self.map_words.extend_from_slice(&[NO_LAYER, 0, 0, 0]);
        self.changed = true;
        self.maps_changed = true;
        Ok(self.shading.len() as u32 - 1)
    }

    pub fn set_color(&mut self, id: u32, color: [f32; 4]) -> Result<(), MaterialError> {
        let at = id as usize * MATERIAL_FLOATS;
        let slot = self
            .parameters
            .get_mut(at..at + MATERIAL_FLOATS)
            .ok_or(MaterialError::Unknown(id))?;
        slot.copy_from_slice(&color);
        self.changed = true;
        Ok(())
    }

    /// Gives a material a map, a texture, or none with `Handle::NONE`.
    pub fn set_map(&mut self, id: u32, texture: Handle) -> Result<(), MaterialError> {
        let map = self
            .maps
            .get_mut(id as usize)
            .ok_or(MaterialError::Unknown(id))?;
        *map = texture;
        self.maps_changed = true;
        Ok(())
    }

    /// A material's map, or `Handle::NONE`.
    pub fn map(&self, id: u32) -> Handle {
        self.maps.get(id as usize).copied().unwrap_or(Handle::NONE)
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

    /// Every material's parameters, in id order.
    pub fn parameters(&self) -> &[f32] {
        &self.parameters
    }

    /// Marks both tables changed, so the next frame uploads them again.
    pub fn mark_changed(&mut self) {
        self.changed = true;
        self.maps_changed = true;
    }

    /// True once after any change, so the table is uploaded only when it changed.
    pub fn take_changed(&mut self) -> bool {
        std::mem::take(&mut self.changed)
    }

    /// The maps table, written again from `ready_layer`, when a map changed or `layers_changed`
    /// says that a texture's layer became ready or stopped drawing. `ready_layer` gives the layer
    /// of a texture whose image is on the GPU.
    pub fn changed_map_words(
        &mut self,
        layers_changed: bool,
        ready_layer: impl Fn(Handle) -> Option<u32>,
    ) -> Option<&[u32]> {
        if !std::mem::take(&mut self.maps_changed) && !layers_changed {
            return None;
        }
        let (entries, _) = self.map_words.as_chunks_mut::<MAP_WORDS>();
        for (words, &map) in entries.iter_mut().zip(&self.maps) {
            words[0] = if map.is_none() {
                NO_LAYER
            } else {
                ready_layer(map).unwrap_or(NO_LAYER)
            };
        }
        Some(&self.map_words)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn materials_get_ids_in_order_and_report_changes_once() {
        let mut table = MaterialTable::with_capacity(2);
        assert_eq!(table.create(Shading::Lit, [1.0, 0.0, 0.0, 1.0]), Ok(0));
        assert_eq!(table.create(Shading::Unlit, [0.0, 1.0, 0.0, 1.0]), Ok(1));
        assert_eq!(
            table.create(Shading::Lit, [0.0; 4]),
            Err(MaterialError::Full)
        );
        assert!(table.take_changed());
        assert!(!table.take_changed());
        table.set_color(1, [0.5, 0.5, 0.5, 1.0]).unwrap();
        assert!(table.take_changed());
        assert_eq!(&table.parameters()[4..8], &[0.5, 0.5, 0.5, 1.0]);
        assert_eq!(table.shading(1), Ok(Shading::Unlit));
        assert_eq!(table.set_color(2, [0.0; 4]), Err(MaterialError::Unknown(2)));
    }

    #[test]
    fn the_maps_table_names_the_layer_of_each_map_that_is_ready() {
        let mut table = MaterialTable::with_capacity(3);
        let plain = table.create(Shading::Unlit, [1.0; 4]).unwrap();
        let mapped = table.create(Shading::UnlitMap, [1.0; 4]).unwrap();
        let waiting = table.create(Shading::UnlitMap, [1.0; 4]).unwrap();
        let (ready, on_its_way) = (Handle::new(1, 0), Handle::new(2, 0));
        table.set_map(mapped, ready).unwrap();
        table.set_map(waiting, on_its_way).unwrap();
        assert_eq!(table.map(mapped), ready);
        assert_eq!(table.map(plain), Handle::NONE);
        let layer = |texture: Handle| (texture == ready).then_some(7);
        let words = table.changed_map_words(false, layer).unwrap().to_vec();
        assert_eq!(words.len(), 3 * MAP_WORDS);
        assert_eq!([words[0], words[4], words[8]], [NO_LAYER, 7, NO_LAYER]);
        assert_eq!(
            table.changed_map_words(false, layer),
            None,
            "nothing changed"
        );
        // A texture whose layer became ready writes the table again.
        let both = |_: Handle| Some(3);
        let words = table.changed_map_words(true, both).unwrap();
        assert_eq!([words[4], words[8]], [3, 3]);
        assert_eq!(table.set_map(9, ready), Err(MaterialError::Unknown(9)));
    }
}
