//! A read of a small region of a compute pass's texture, through a promise and never a waiting
//! thread. A frame copies the region into one buffer of a ring after the pass's runs, and reads
//! that buffer into engine memory: the GPU's read raises a control slot, which the sketch's frame
//! loop waits for. The region comes back in the target's own format, so the page decodes the
//! values that the pass wrote.
//!
//! A read lands a few frames after the frame that records it, because the browser maps the buffer
//! asynchronously. The ring holds one read for each that may wait, so a page can ask again before
//! the first answer lands; the sketch waits for an answer before it asks again by default.

use null3d_gpu::drawlist::{DrawList, Op};

use crate::frame::RecordError;

/// The reads of the ring that may wait for the GPU at once.
pub const RING: usize = 4;

/// The longest side of a region that a read takes, in texels.
pub const MAX_SIDE: u32 = 64;

/// The bytes of one read's destination: a region of the longest side, at four 32-bit channels.
pub const MAX_BYTES: u32 = MAX_SIDE * MAX_SIDE * 16;

/// The bytes of each row of a copy, which WebGPU aligns to 256.
const COPY_ROW_ALIGNMENT: u32 = 256;

/// A read that a frame records: where the region lies in the pass's texture, and where its bytes
/// land in engine memory.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PassRead {
    /// The pass's view place, from 1.
    pub view: u32,
    /// The region's first texel, from the texture's stored first row.
    pub x: u32,
    pub y: u32,
    /// The region's size in texels.
    pub width: u32,
    pub height: u32,
    /// The array layer the region lies in.
    pub layer: u32,
    /// Which read of the ring it uses.
    pub ring: u32,
    /// The control slot that rises once the bytes are in engine memory.
    pub slot: u32,
    /// The address in engine memory that the bytes land at.
    pub destination: u32,
    /// The bytes of one texel of the pass's format.
    pub texel_bytes: u32,
}

/// True when a read's region lies inside a texture of `size` texels. A canvas that shrank after
/// the call can leave the region past the edge.
pub fn fits(read: &PassRead, size: (u32, u32)) -> bool {
    read.x.saturating_add(read.width) <= size.0 && read.y.saturating_add(read.height) <= size.1
}

/// Records a read's copy and its buffer read, when the region lies inside the texture of `size`.
/// Returns false, with no command recorded, when the region reaches past it: a copy there would
/// reject the frame's commands, so the read waits for its timeout instead. `size` is the texture's
/// size at the frame that copies it, which a canvas that shrank since the call has changed.
pub fn record_region(
    list: &mut DrawList,
    read: &PassRead,
    texture: u32,
    buffer: u32,
    rows_from_bottom: bool,
    size: (u32, u32),
) -> Result<bool, RecordError> {
    if !fits(read, size) {
        return Ok(false);
    }
    record(list, read, texture, buffer, rows_from_bottom, size.1)?;
    Ok(true)
}

/// The copied rows of a read, and the buffer it reads: a copy of the region follows the pass, and
/// the read raises the request's slot once its bytes land. `rows_from_bottom` is true on WebGL2,
/// whose first stored row of a target that a pass drew is the image's bottom row.
pub fn record(
    list: &mut DrawList,
    read: &PassRead,
    texture: u32,
    buffer: u32,
    rows_from_bottom: bool,
    texture_height: u32,
) -> Result<(), RecordError> {
    let y = if rows_from_bottom {
        texture_height
            .saturating_sub(read.y)
            .saturating_sub(read.height)
    } else {
        read.y
    };
    let row = row_bytes(read.width * read.texel_bytes);
    list.push(
        Op::CopyTextureToBuffer,
        &[
            texture,
            0,
            read.x,
            y,
            read.layer,
            buffer,
            0,
            row,
            read.height,
            read.width,
            read.height,
        ],
    )?;
    list.push(
        Op::ReadBuffer,
        &[buffer, 0, row * read.height, read.destination, read.slot],
    )?;
    Ok(())
}

/// The bytes of one row of a copy, rounded up to WebGPU's copy alignment.
pub const fn row_bytes(bytes: u32) -> u32 {
    bytes.div_ceil(COPY_ROW_ALIGNMENT) * COPY_ROW_ALIGNMENT
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_copy_lands_rows_at_the_aligned_pitch_and_reads_them_into_engine_memory() {
        let mut list = DrawList::with_capacity(16);
        let read = PassRead {
            view: 1,
            x: 2,
            y: 3,
            width: 4,
            height: 5,
            layer: 1,
            ring: 0,
            slot: 52,
            destination: 128,
            texel_bytes: 8,
        };
        record(&mut list, &read, 7, 9, false, 32).unwrap();
        let commands: Vec<_> = null3d_gpu::drawlist::decode(list.words())
            .map(|command| command.unwrap())
            .collect();
        assert_eq!(commands[0].op, Op::CopyTextureToBuffer);
        assert_eq!(commands[0].operands[..5], [7, 0, 2, 3, 1]);
        assert_eq!(
            commands[0].operands[7], 256,
            "four texels of eight bytes round to 256"
        );
        assert_eq!(commands[0].operands[9..11], [4, 5]);
        assert_eq!(commands[1].op, Op::ReadBuffer);
        assert_eq!(commands[1].operands, [9, 0, 256 * 5, 128, 52]);
    }

    #[test]
    fn a_region_past_the_textures_edge_is_not_copied() {
        let mut list = DrawList::with_capacity(16);
        let read = PassRead {
            view: 1,
            x: 1,
            y: 1,
            width: 2,
            height: 2,
            layer: 0,
            ring: 0,
            slot: 52,
            destination: 0,
            texel_bytes: 8,
        };
        // The texture the read was asked against, and the smaller one a shrunken canvas leaves.
        assert!(record_region(&mut list, &read, 7, 9, false, (4, 4)).unwrap());
        assert_eq!(null3d_gpu::drawlist::decode(list.words()).count(), 2);
        list.clear();
        assert!(!record_region(&mut list, &read, 7, 9, false, (2, 2)).unwrap());
        assert_eq!(list.len(), 0, "no copy past the edge reaches the frame");
        assert!(
            !fits(&read, (2, 4)),
            "x 1 with width 2 reaches past a 2-wide texture"
        );
    }

    #[test]
    fn a_webgl2_copy_counts_the_row_from_the_bottom() {
        let mut list = DrawList::with_capacity(16);
        let read = PassRead {
            view: 1,
            x: 0,
            y: 3,
            width: 4,
            height: 5,
            layer: 0,
            ring: 0,
            slot: 52,
            destination: 0,
            texel_bytes: 4,
        };
        record(&mut list, &read, 7, 9, true, 32).unwrap();
        let command = null3d_gpu::drawlist::decode(list.words())
            .next()
            .expect("a copy")
            .unwrap();
        assert_eq!(command.operands[3], 24, "32 - 3 - 5");
    }
}
