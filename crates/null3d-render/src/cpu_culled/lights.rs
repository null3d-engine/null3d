//! The point and spot lights of each camera view on WebGL2: the light records and the light grid's
//! words in one data texture of 32-bit integers, so they take one texture unit of the fragment
//! stage. The records fill the columns of the texture's first half, four texels each, and the
//! words the columns of its second half, four to a texel. Fragment shaders read both with
//! `texelFetch`, and turn the records' bits into floats. Each view's texture has a ring of three,
//! as the index lists do, so a frame never writes a texture that the GPU may still read for an
//! earlier frame. Every view has a frame group for each ring slot, which binds that slot's
//! texture.
//!
//! The camera's view has its textures from the first frame. Any other camera view gets its own
//! when its grid is made, on the first frame that it sees a light, and binds the camera's until
//! then, which it never reads, as its grid lists no light.
//!
//! The textures grow with the lists, with room to spare. When a view's textures grow, its frame
//! groups bind them again, and the next frame writes its lists into them again.

use null3d_gpu::drawlist::{DrawList, sizes};

use super::data::{DataTexture, GRID_WORDS_PER_TEXEL, RING, RingSlot, TextureRows, write_rows};
use super::ids;
use crate::frame::{RecordError, UploadArena};
use crate::light_grid::{LightGrids, ViewLights};
use crate::view::{MAX_VIEWS, ViewId};

/// The ring of light data textures of camera view `view`.
const fn texture(view: ViewId) -> DataTexture {
    DataTexture::light_data(ids::light_data(view), RING)
}

/// One view's ring slot, and the rows each of its textures holds, 0 before they exist.
#[derive(Clone, Copy, Debug, Default)]
struct ViewTextures {
    slot: RingSlot,
    rows: u32,
}

/// The light textures of every camera view.
#[derive(Debug, Default)]
pub(super) struct LightTextures {
    views: [ViewTextures; MAX_VIEWS],
}

impl LightTextures {
    /// The camera view whose light textures `view`'s frame groups bind: its own once they exist,
    /// or the camera's.
    pub(super) fn owner(&self, view: ViewId) -> ViewId {
        match self.views.get(view.index()) {
            Some(own) if own.rows > 0 => view,
            _ => ViewId::CAMERA,
        }
    }

    /// The ring slot whose textures `view`'s frame reads.
    pub(super) fn slot(&self, view: ViewId) -> u32 {
        self.views[self.owner(view).index()].slot.slot()
    }

    /// Makes each view's textures big enough for its frame's lists, with room to grow but at most
    /// `limit` rows: the camera's always, and every other view's once it has a grid. Before any
    /// light, each texture has one row. Returns the views whose textures it made again, as a mask
    /// of view places, so their frame groups must bind them again.
    pub(super) fn size(
        &mut self,
        list: &mut DrawList,
        grids: &mut LightGrids,
        limit: u32,
    ) -> Result<u32, RecordError> {
        let mut remade = 0;
        for (view, lights) in grids.iter_mut() {
            let own = &mut self.views[view.index()];
            if grow(list, own, view, lights, limit)? {
                remade |= 1 << view.index();
            }
        }
        Ok(remade)
    }

    /// Takes each view's ring slot for frame `frame`, and writes its grid's lists into it when they
    /// differ from the ones its ring holds, for the views of `drawn`, a mask of view places.
    pub(super) fn upload(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        grids: &mut LightGrids,
        frame: u32,
        drawn: u32,
    ) -> Result<(), RecordError> {
        for (view, lights) in grids.iter_mut() {
            let own = &mut self.views[view.index()];
            if drawn & (1 << view.index()) != 0 && own.rows > 0 {
                upload(list, arena, own, view, lights, frame)?;
            }
        }
        Ok(())
    }

    /// Forgets the textures, so they are made again, after the thread that draws replaced the GPU.
    pub(super) fn forget_gpu(&mut self) {
        *self = Self::default();
    }
}

/// Makes `view`'s textures big enough for its lists, as [`LightTextures::size`] says. Returns true
/// when it made them again.
fn grow(
    list: &mut DrawList,
    own: &mut ViewTextures,
    view: ViewId,
    lights: &mut ViewLights,
    limit: u32,
) -> Result<bool, RecordError> {
    let grid = lights.grid();
    let needed = (grid.words().len() as u32)
        .div_ceil(sizes::GRID_WORDS_PER_TEXTURE_ROW)
        .max((grid.lights().len() as u32).div_ceil(sizes::LIGHTS_PER_TEXTURE_ROW));
    let remade = texture(view).grow(list, &mut own.rows, needed, limit)?;
    if remade {
        own.slot.forget();
        lights.forget_gpu();
    }
    Ok(remade)
}

/// Takes `view`'s ring slot of frame `frame`, and writes its grid's lists into it when they differ
/// from the ones the ring holds.
fn upload(
    list: &mut DrawList,
    arena: &mut UploadArena,
    own: &mut ViewTextures,
    view: ViewId,
    lights: &mut ViewLights,
    frame: u32,
) -> Result<(), RecordError> {
    let new = lights.take_new();
    let slot = own.slot.take(frame, new);
    if !new {
        return Ok(());
    }
    let texture = ids::light_data(view) + slot;
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
