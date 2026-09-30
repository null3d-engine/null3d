//! The point and spot lights of the camera's view on WebGL2: the light grid's words in a data
//! texture of 32-bit integers, and the light records in a data texture of floats, four texels
//! each. Fragment shaders read both with `texelFetch`. Each has a ring of three textures, as the
//! index lists do, so a frame never writes a texture that the GPU may still read for an earlier
//! frame. Every view has a frame group for each ring slot, which binds that slot's textures.
//!
//! The textures grow with the lists, with room to spare. When they grow, every view binds them
//! again, and the next frame writes the lists into them again.

use null3d_gpu::drawlist::{DrawList, sizes};

use super::data::{DataTexture, RING, RingSlot, TextureRows, write_rows};
use super::ids;
use crate::frame::{RecordError, UploadArena};
use crate::light_grid::CameraLights;

/// The ring of light grid textures, then the ring of light record textures.
const TEXTURES: [DataTexture; 2] = [
    DataTexture::indices(ids::LIGHT_GRID, RING),
    DataTexture::lights(ids::LIGHTS, RING),
];

/// The light textures' ring slot, and the rows each kind of texture holds, 0 before it exists.
#[derive(Debug, Default)]
pub(super) struct LightTextures {
    slot: RingSlot,
    rows: [u32; 2],
}

impl LightTextures {
    /// The ring slot whose textures the frame reads.
    pub(super) fn slot(&self) -> u32 {
        self.slot.slot()
    }

    /// Makes the textures big enough for the frame's lists, with room to grow but at most `limit`
    /// rows. Before any light, each texture has one row. Returns true when it made them again, so
    /// every view's frame groups must bind them again.
    pub(super) fn size(
        &mut self,
        list: &mut DrawList,
        lights: &mut CameraLights,
        limit: u32,
    ) -> Result<bool, RecordError> {
        let grid = lights.grid();
        let needed = [
            (grid.words().len() as u32).div_ceil(sizes::INDICES_PER_TEXTURE_ROW),
            (grid.lights().len() as u32).div_ceil(sizes::LIGHTS_PER_TEXTURE_ROW),
        ];
        let mut remade = false;
        for ((texture, rows), needed) in TEXTURES.into_iter().zip(&mut self.rows).zip(needed) {
            remade |= texture.grow(list, rows, needed, limit)?;
        }
        if remade {
            self.slot.forget();
            lights.forget_gpu();
        }
        Ok(remade)
    }

    /// Takes the ring slot of frame `frame`, and writes the grid's lists into it when they differ
    /// from the ones the ring holds.
    pub(super) fn upload(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        lights: &mut CameraLights,
        frame: u32,
    ) -> Result<(), RecordError> {
        let new = lights.take_new();
        let slot = self.slot.take(frame, new);
        if !new {
            return Ok(());
        }
        let (words, count) = (lights.words_bytes(), lights.grid().lights().len() as u32);
        let (at, _) = arena.push(words)?;
        let rows = TextureRows::indices(0, (words.len() / 4) as u32);
        write_rows(list, ids::LIGHT_GRID + slot, rows, at)?;
        let (at, _) = arena.push(lights.lights_bytes())?;
        write_rows(list, ids::LIGHTS + slot, TextureRows::lights(0, count), at)
    }

    /// Forgets the textures, so they are made again, after the thread that draws replaced the GPU.
    pub(super) fn forget_gpu(&mut self) {
        *self = Self::default();
    }
}
