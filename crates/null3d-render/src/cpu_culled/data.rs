//! Data textures: the world matrices of the sources and the index lists, as texels, with their
//! uploads, and the rings that keep each frame's data apart from what the GPU may still read.

use null3d_core::world::{MATRIX_FLOATS, ROW_VALUE_FLOATS};
use null3d_gpu::drawlist::{DrawList, format, sizes};

use super::ids;
use super::layout::Layout;
pub(super) use crate::data_texture::{DataTexture, TextureRows, grown_rows, write_rows};
use crate::frame::{RecordError, address, floats_as_bytes};

/// Frames that the rings of streamed and index list textures cover: the frame being recorded and
/// the two the GPU may still be drawing.
pub(super) const RING: u32 = 3;
/// Bytes of one world matrix: three rows of four floats.
const MATRIX_BYTES: u32 = (MATRIX_FLOATS * 4) as u32;
/// Texels of one light record: four vectors of four 32-bit values.
const LIGHT_TEXELS: u32 = sizes::LIGHT_RECORD_BYTES / 16;
/// The first column of the light grid's words in the light data texture, after the records'.
const GRID_COLUMN: u32 = sizes::LIGHTS_PER_TEXTURE_ROW * LIGHT_TEXELS;
/// Words of the light grid in one texel of the light data texture.
pub(super) const GRID_WORDS_PER_TEXEL: u32 = 4;

/// A slot of one of the frame rings that moves on only when a frame writes new data, so a frame
/// whose data did not change draws from the slot that already holds it. A slot is written again
/// only after the two other slots, so the GPU has finished reading it, as with a ring that moves
/// every frame.
#[derive(Clone, Copy, Debug, Default)]
pub(super) struct RingSlot {
    slot: u32,
    /// The frame whose data the slot holds, or 0 for none.
    holds: u32,
}

impl RingSlot {
    /// The slot that the last frame took.
    pub(super) fn slot(&self) -> u32 {
        self.slot
    }

    /// True when the slot holds data that a frame can draw from.
    pub(super) fn holds_any(&self) -> bool {
        self.holds != 0
    }

    /// True when the slot holds the data of the frame before `frame`.
    pub(super) fn holds_previous(&self, frame: u32) -> bool {
        self.holds_any() && self.holds == null3d_core::frames::previous_frame(frame)
    }

    /// The slot `frame` draws from: the next one when the frame writes new data.
    pub(super) fn take(&mut self, frame: u32, write: bool) -> u32 {
        if write {
            self.slot = (self.slot + 1) % RING;
        }
        self.holds = frame;
        self.slot
    }

    /// Forgets what the slot holds, so the next frame writes its data again.
    pub(super) fn forget(&mut self) {
        self.holds = 0;
    }
}

/// The floats of matrices `start..start + count`.
pub(super) fn matrices_of(matrices: &[f32], start: u32, count: u32) -> &[f32] {
    &matrices[start as usize * MATRIX_FLOATS..(start + count) as usize * MATRIX_FLOATS]
}

/// Writes world matrices into a data texture, from matrix `first` of the texture on.
pub(super) fn write_matrices(
    list: &mut DrawList,
    texture: u32,
    first: u32,
    matrices: &[f32],
) -> Result<(), RecordError> {
    write_rows(
        list,
        texture,
        TextureRows {
            first,
            count: (matrices.len() / MATRIX_FLOATS) as u32,
            column: 0,
            per_row: sizes::MATRICES_PER_TEXTURE_ROW,
            texels: sizes::MATRIX_TEXELS,
            bytes: MATRIX_BYTES,
        },
        address(floats_as_bytes(matrices)),
    )
}

/// Writes the row values of rows `start..start + count` of a batch, whose world output holds them
/// as `values`, into a row values texture whose rows put the batch's first row at `base`.
pub(super) fn write_row_values(
    list: &mut DrawList,
    texture: u32,
    base: u32,
    values: &[f32],
    start: u32,
    count: u32,
) -> Result<(), RecordError> {
    let floats = &values[start as usize * ROW_VALUE_FLOATS..][..count as usize * ROW_VALUE_FLOATS];
    let rows = TextureRows::row_values(base + start, count);
    write_rows(list, texture, rows, address(floats_as_bytes(floats)))
}

impl TextureRows {
    /// `count` light records of the light data textures, from record `first` on.
    pub(super) fn lights(first: u32, count: u32) -> Self {
        Self {
            first,
            count,
            column: 0,
            per_row: sizes::LIGHTS_PER_TEXTURE_ROW,
            texels: LIGHT_TEXELS,
            bytes: sizes::LIGHT_RECORD_BYTES,
        }
    }

    /// `count` texels of the light grid's words in the light data textures, four words each, from
    /// texel `first` of the words on.
    pub(super) fn grid_words(first: u32, count: u32) -> Self {
        Self {
            first,
            count,
            column: GRID_COLUMN,
            per_row: sizes::GRID_WORDS_PER_TEXTURE_ROW / GRID_WORDS_PER_TEXEL,
            texels: 1,
            bytes: 4 * GRID_WORDS_PER_TEXEL,
        }
    }
}

impl DataTexture {
    /// The light data textures: the light records, four texels each, then the light grid's
    /// words, four to a texel, all as 32-bit integers.
    pub(super) const fn light_data(first_id: u32, count: u32) -> Self {
        Self {
            first_id,
            count,
            width: GRID_COLUMN + sizes::GRID_WORDS_PER_TEXTURE_ROW / GRID_WORDS_PER_TEXEL,
            format: format::RGBA32_UINT,
        }
    }
}

/// What the resident, streamed and cluster textures hold, which every view reads, and the row
/// values textures beside the resident and the streamed ones.
const SHARED: [DataTexture; 5] = [
    DataTexture::matrices(ids::RESIDENT, 1),
    DataTexture::matrices(ids::STREAMED, RING),
    DataTexture::indices(ids::CLUSTERS, 1),
    DataTexture::row_values(ids::RESIDENT_VALUES, 1),
    DataTexture::row_values(ids::STREAMED_VALUES, RING),
];

/// The data textures that every view reads: the resident texture, the ring of streamed textures,
/// the cluster texture, and the row values textures of the resident and the streamed rows, with
/// the rows each holds, 0 before it exists. A row values texture holds one texel row while no
/// batch of its rows has row values, for the instance groups to bind.
#[derive(Debug, Default)]
pub(super) struct SharedTextures {
    rows: [u32; 5],
}

/// Which shared textures a resize made again.
#[derive(Clone, Copy, Debug, Default)]
pub(super) struct Remade {
    /// The resident texture, which then needs every row again.
    pub(super) resident: bool,
    /// The resident row values texture, which then needs every row's values again.
    pub(super) resident_values: bool,
    /// Any of them, which the views' instance groups bind.
    pub(super) any: bool,
}

impl SharedTextures {
    /// Makes the textures big enough for the layout, with room to grow, at most `limit` rows each.
    /// A new cluster texture needs every batch's clusters again, which the layout rebuild before it
    /// has already asked for.
    pub(super) fn size(
        &mut self,
        list: &mut DrawList,
        layout: &Layout,
        limit: u32,
    ) -> Result<Remade, RecordError> {
        let needed = [
            layout
                .resident_rows
                .div_ceil(sizes::MATRICES_PER_TEXTURE_ROW),
            layout
                .streamed_rows
                .div_ceil(sizes::MATRICES_PER_TEXTURE_ROW),
            layout.cluster_rows.div_ceil(sizes::INDICES_PER_TEXTURE_ROW),
            (layout.resident_value_rows).div_ceil(sizes::ROW_VALUES_PER_TEXTURE_ROW),
            (layout.streamed_value_rows).div_ceil(sizes::ROW_VALUES_PER_TEXTURE_ROW),
        ];
        let mut remade = Remade::default();
        for (k, texture) in SHARED.into_iter().enumerate() {
            let new = texture.grow(list, &mut self.rows[k], needed[k], limit)?;
            remade.resident |= new && k == 0;
            remade.resident_values |= new && k == 3;
            remade.any |= new;
        }
        Ok(remade)
    }

    /// Forgets the textures, so each is made again, after the thread that draws replaced the GPU.
    pub(super) fn forget_gpu(&mut self) {
        self.rows = [0; 5];
    }
}
