//! The point and spot lights of the camera's view on WebGL2: the light records and the light
//! grid's words in one data texture of 32-bit integers, so they take one texture unit of the
//! fragment stage. The records fill the columns of the texture's first half, four texels each, and
//! the words the columns of its second half, four to a texel. Fragment shaders read both with
//! `texelFetch`, and turn the records' bits into floats. The texture has a ring of three, as the
//! index lists do, so a frame never writes a texture that the GPU may still read for an earlier
//! frame. Every view has a frame group for each ring slot, which binds that slot's texture.
//!
//! The textures grow with the lists, with room to spare. When they grow, every view binds them
//! again, and the next frame writes the lists into them again.

use null3d_gpu::drawlist::{DrawList, sizes};

use super::data::{DataTexture, GRID_WORDS_PER_TEXEL, RING, RingSlot, TextureRows, write_rows};
use super::ids;
use crate::frame::{RecordError, UploadArena};
use crate::light_grid::CameraLights;

/// The ring of light data textures.
const TEXTURE: DataTexture = DataTexture::light_data(ids::LIGHT_DATA, RING);

/// The light textures' ring slot, and the rows each texture holds, 0 before they exist.
#[derive(Debug, Default)]
pub(super) struct LightTextures {
    slot: RingSlot,
    rows: u32,
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
        let needed = (grid.words().len() as u32)
            .div_ceil(sizes::GRID_WORDS_PER_TEXTURE_ROW)
            .max((grid.lights().len() as u32).div_ceil(sizes::LIGHTS_PER_TEXTURE_ROW));
        let remade = TEXTURE.grow(list, &mut self.rows, needed, limit)?;
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
        let texture = ids::LIGHT_DATA + slot;
        let words = lights.words_bytes();
        let texel_bytes = 4 * GRID_WORDS_PER_TEXEL as usize;
        let (at, padded) = arena.push_zeroed(words.len().next_multiple_of(texel_bytes))?;
        padded[..words.len()].copy_from_slice(words);
        let texels = (padded.len() / texel_bytes) as u32;
        write_rows(list, texture, TextureRows::grid_words(0, texels), at)?;
        let count = lights.grid().lights().len() as u32;
        let (at, _) = arena.push(lights.lights_bytes())?;
        write_rows(list, texture, TextureRows::lights(0, count), at)
    }

    /// Forgets the textures, so they are made again, after the thread that draws replaced the GPU.
    pub(super) fn forget_gpu(&mut self) {
        *self = Self::default();
    }
}
