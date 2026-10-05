//! Data textures: the world matrices of the sources and the index lists, as texels, with their
//! uploads, and the rings that keep each frame's data apart from what the GPU may still read.

use null3d_core::world::MATRIX_FLOATS;
use null3d_gpu::drawlist::{DrawList, Op, format, sizes, texture_usage, view};

use super::ids;
use super::layout::Layout;
use crate::frame::{RecordError, address, floats_as_bytes};

/// Frames that the rings of streamed and index list textures cover: the frame being recorded and
/// the two the GPU may still be drawing.
pub(super) const RING: u32 = 3;
/// Bytes of one world matrix: three rows of four floats.
const MATRIX_BYTES: u32 = (MATRIX_FLOATS * 4) as u32;
/// Texels of one light record: four vectors of four 32-bit values.
const LIGHT_TEXELS: u32 = sizes::LIGHT_RECORD_BYTES / 16;

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
            per_row: sizes::MATRICES_PER_TEXTURE_ROW,
            texels: sizes::MATRIX_TEXELS,
            bytes: MATRIX_BYTES,
        },
        address(floats_as_bytes(matrices)),
    )
}

/// Items of a data texture: `count` items from item `first` on, `per_row` items to a texture row,
/// each `texels` texels and `bytes` bytes.
#[derive(Clone, Copy, Debug)]
pub(super) struct TextureRows {
    first: u32,
    count: u32,
    per_row: u32,
    texels: u32,
    bytes: u32,
}

impl TextureRows {
    /// `count` 32-bit indices of the index list or cluster textures, from index `first` on.
    pub(super) fn indices(first: u32, count: u32) -> Self {
        Self {
            first,
            count,
            per_row: sizes::INDICES_PER_TEXTURE_ROW,
            texels: 1,
            bytes: 4,
        }
    }

    /// `count` light records of the light list's textures, from record `first` on.
    pub(super) fn lights(first: u32, count: u32) -> Self {
        Self {
            first,
            count,
            per_row: sizes::LIGHTS_PER_TEXTURE_ROW,
            texels: LIGHT_TEXELS,
            bytes: sizes::LIGHT_RECORD_BYTES,
        }
    }
}

/// Writes tightly packed items from `source` into a data texture, as at most three rectangles:
/// the end of the first texture row, the whole rows after it, and the start of the last row.
pub(super) fn write_rows(
    list: &mut DrawList,
    texture: u32,
    rows: TextureRows,
    source: u32,
) -> Result<(), RecordError> {
    let end = rows.first + rows.count;
    let (mut item, mut at) = (rows.first, source);
    while item < end {
        let column = item % rows.per_row;
        let (width, height) = if column == 0 && end - item >= rows.per_row {
            (rows.per_row, (end - item) / rows.per_row)
        } else {
            ((rows.per_row - column).min(end - item), 1)
        };
        let items = width * height;
        list.push(
            Op::WriteTexture,
            &[
                texture,
                0,
                column * rows.texels,
                item / rows.per_row,
                0,
                width * rows.texels,
                height,
                1,
                at,
                items * rows.bytes,
            ],
        )?;
        item += items;
        at += items * rows.bytes;
    }
    Ok(())
}

/// The rows to create a data texture with when it must hold `needed`: room to grow, so a slowly
/// growing scene rarely recreates it, but never past `limit`.
pub(super) fn grown_rows(needed: u32, limit: u32) -> u32 {
    needed.saturating_add(needed / 2).min(limit).max(needed)
}

/// A kind of data texture: the ids of its textures, one per ring slot or just one, and its width
/// and format.
#[derive(Clone, Copy, Debug)]
pub(super) struct DataTexture {
    pub(super) first_id: u32,
    pub(super) count: u32,
    pub(super) width: u32,
    pub(super) format: u32,
}

impl DataTexture {
    /// The textures of world matrices, three texels each.
    pub(super) const fn matrices(first_id: u32, count: u32) -> Self {
        Self {
            first_id,
            count,
            width: sizes::MATRICES_PER_TEXTURE_ROW * sizes::MATRIX_TEXELS,
            format: format::RGBA32_FLOAT,
        }
    }

    /// The textures of 32-bit indices.
    pub(super) const fn indices(first_id: u32, count: u32) -> Self {
        Self {
            first_id,
            count,
            width: sizes::INDICES_PER_TEXTURE_ROW,
            format: format::R32_UINT,
        }
    }

    /// The textures of light records, four texels each.
    pub(super) const fn lights(first_id: u32, count: u32) -> Self {
        Self {
            first_id,
            count,
            width: sizes::LIGHTS_PER_TEXTURE_ROW * LIGHT_TEXELS,
            format: format::RGBA32_FLOAT,
        }
    }

    /// Makes the textures again when `rows`, the rows they hold, is fewer than `needed`, with room
    /// to grow but at most `limit`. Returns true when it made them.
    pub(super) fn grow(
        self,
        list: &mut DrawList,
        rows: &mut u32,
        needed: u32,
        limit: u32,
    ) -> Result<bool, RecordError> {
        let needed = needed.max(1);
        if *rows >= needed {
            return Ok(false);
        }
        *rows = grown_rows(needed, limit);
        for id in self.first_id..self.first_id + self.count {
            list.push(
                Op::CreateTexture,
                &[
                    id,
                    self.width,
                    *rows,
                    1,
                    self.format,
                    texture_usage::TEXTURE_BINDING | texture_usage::COPY_DST,
                    1,
                    1,
                    view::D2,
                ],
            )?;
        }
        Ok(true)
    }
}

/// What the resident, streamed and cluster textures hold, which every view reads.
const SHARED: [DataTexture; 3] = [
    DataTexture::matrices(ids::RESIDENT, 1),
    DataTexture::matrices(ids::STREAMED, RING),
    DataTexture::indices(ids::CLUSTERS, 1),
];

/// The data textures that every view reads: the resident texture, the ring of streamed textures
/// and the cluster texture, with the rows each holds, 0 before it exists.
#[derive(Debug, Default)]
pub(super) struct SharedTextures {
    rows: [u32; 3],
}

/// Which shared textures a resize made again.
#[derive(Clone, Copy, Debug, Default)]
pub(super) struct Remade {
    /// The resident texture, which then needs every row again.
    pub(super) resident: bool,
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
        ];
        let mut remade = Remade::default();
        for (k, texture) in SHARED.into_iter().enumerate() {
            let new = texture.grow(list, &mut self.rows[k], needed[k], limit)?;
            remade.resident |= new && k == 0;
            remade.any |= new;
        }
        Ok(remade)
    }

    /// Forgets the textures, so each is made again, after the thread that draws replaced the GPU.
    pub(super) fn forget_gpu(&mut self) {
        self.rows = [0; 3];
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rectangles(first: u32, count: u32) -> Vec<Vec<u32>> {
        let mut list = DrawList::with_capacity(64);
        let rows = TextureRows {
            first,
            count,
            per_row: 512,
            texels: 3,
            bytes: 48,
        };
        write_rows(&mut list, 9, rows, 1000).unwrap();
        null3d_gpu::drawlist::decode(list.words())
            .map(|c| c.unwrap().operands.to_vec())
            .collect()
    }

    #[test]
    fn rows_go_out_in_at_most_three_rectangles() {
        // Each write is to mip level 0 and layer 0, one layer deep.
        // Inside one texture row.
        assert_eq!(
            rectangles(10, 5),
            vec![vec![9, 0, 30, 0, 0, 15, 1, 1, 1000, 240]]
        );
        // Whole rows only.
        assert_eq!(
            rectangles(512, 1024),
            vec![vec![9, 0, 0, 1, 0, 1536, 2, 1, 1000, 1024 * 48]]
        );
        // The end of a row, whole rows, then the start of a row.
        let parts = rectangles(500, 12 + 1024 + 7);
        assert_eq!(parts.len(), 3);
        assert_eq!(parts[0], vec![9, 0, 1500, 0, 0, 36, 1, 1, 1000, 12 * 48]);
        assert_eq!(
            parts[1],
            vec![9, 0, 0, 1, 0, 1536, 2, 1, 1000 + 12 * 48, 1024 * 48]
        );
        assert_eq!(
            parts[2],
            vec![9, 0, 0, 3, 0, 21, 1, 1, 1000 + 1036 * 48, 7 * 48]
        );
        assert!(rectangles(7, 0).is_empty());
    }
}
