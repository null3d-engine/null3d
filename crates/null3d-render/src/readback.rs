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
