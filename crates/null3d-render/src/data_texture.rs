//! Data textures, which both frame builders use where a vertex shader reads per-source data that
//! may not come through a storage buffer: textures of fixed width whose items fill each texel row
//! in turn, each item a few texels, read with `textureLoad`. Their writes go out as at most three
//! rectangles, and they are made again with room to grow.

use null3d_core::world::{MATRIX_FLOATS, ROW_VALUE_FLOATS};
use null3d_gpu::drawlist::{DrawList, Op, format, sizes, texture_usage, view};

use crate::frame::{RecordError, address, floats_as_bytes};

/// Items of a data texture: `count` items from item `first` on, `per_row` items to a texture row
/// from texel `column` of the row, each `texels` texels and `bytes` bytes.
#[derive(Clone, Copy, Debug)]
pub(crate) struct TextureRows {
    pub(crate) first: u32,
    pub(crate) count: u32,
    pub(crate) column: u32,
    pub(crate) per_row: u32,
    pub(crate) texels: u32,
    pub(crate) bytes: u32,
}

impl TextureRows {
    /// `count` 32-bit indices of the index list or cluster textures, from index `first` on.
    pub(crate) fn indices(first: u32, count: u32) -> Self {
        Self {
            first,
            count,
            column: 0,
            per_row: sizes::INDICES_PER_TEXTURE_ROW,
            texels: 1,
            bytes: 4,
        }
    }

    /// `count` world matrices of the textures of matrix rows, from matrix `first` on.
    pub(crate) fn matrices(first: u32, count: u32) -> Self {
        Self {
            first,
            count,
            column: 0,
            per_row: sizes::MATRICES_PER_TEXTURE_ROW,
            texels: sizes::MATRIX_TEXELS,
            bytes: (MATRIX_FLOATS * 4) as u32,
        }
    }

    /// The row values of `count` sources of a row values texture, from source `first` on.
    pub(crate) fn row_values(first: u32, count: u32) -> Self {
        Self {
            first,
            count,
            column: 0,
            per_row: sizes::ROW_VALUES_PER_TEXTURE_ROW,
            texels: sizes::ROW_VALUE_TEXELS,
            bytes: (ROW_VALUE_FLOATS * 4) as u32,
        }
    }
}

/// Writes tightly packed items from `source` into a data texture, as at most three rectangles:
/// the end of the first texture row, the whole rows after it, and the start of the last row.
pub(crate) fn write_rows(
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
                rows.column + column * rows.texels,
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

/// Writes the row values of rows `start..start + count` of a batch, whose world output holds them
/// as `values`, into a row values texture whose rows put the batch's first row at `base`.
pub(crate) fn write_row_values(
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

/// The rows to create a data texture with when it must hold `needed`: room to grow, so a slowly
/// growing scene rarely recreates it, but never past `limit`.
pub(crate) fn grown_rows(needed: u32, limit: u32) -> u32 {
    needed.saturating_add(needed / 2).min(limit).max(needed)
}

/// A kind of data texture: the ids of its textures, one per ring slot or just one, and its width
/// and format.
#[derive(Clone, Copy, Debug)]
pub(crate) struct DataTexture {
    pub(crate) first_id: u32,
    pub(crate) count: u32,
    pub(crate) width: u32,
    pub(crate) format: u32,
}

impl DataTexture {
    /// The textures of world matrices, three texels each.
    pub(crate) const fn matrices(first_id: u32, count: u32) -> Self {
        Self {
            first_id,
            count,
            width: sizes::MATRICES_PER_TEXTURE_ROW * sizes::MATRIX_TEXELS,
            format: format::RGBA32_FLOAT,
        }
    }

    /// The textures of 32-bit indices.
    pub(crate) const fn indices(first_id: u32, count: u32) -> Self {
        Self {
            first_id,
            count,
            width: sizes::INDICES_PER_TEXTURE_ROW,
            format: format::R32_UINT,
        }
    }

    /// The textures of instance batches' row values: each row's color, then its own values.
    pub(crate) const fn row_values(first_id: u32, count: u32) -> Self {
        Self {
            first_id,
            count,
            width: sizes::ROW_VALUES_PER_TEXTURE_ROW * sizes::ROW_VALUE_TEXELS,
            format: format::RGBA32_FLOAT,
        }
    }

    /// Makes the textures again when `rows`, the rows they hold, is fewer than `needed`, with room
    /// to grow but at most `limit`. Returns true when it made them.
    pub(crate) fn grow(
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

#[cfg(test)]
mod tests {
    use super::*;

    fn rectangles(first: u32, count: u32) -> Vec<Vec<u32>> {
        let mut list = DrawList::with_capacity(64);
        let rows = TextureRows {
            first,
            count,
            column: 0,
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
