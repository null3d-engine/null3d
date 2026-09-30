//! The point and spot lights of the camera's view: the light grid's words and light records in two
//! storage buffers that fragment shaders read, which every view's frame group binds. The job
//! workers fill the grid each frame, and the frame uploads it when it changed. With the material
//! table, the buffers take three of the four storage buffers that fragment shaders may read in
//! WebGPU's compatibility mode.

use null3d_gpu::drawlist::{DrawList, Op, buffer_usage as usage, sizes};

use super::ids;
use crate::frame::{RecordError, UploadArena};
use crate::light_grid::CameraLights;

/// Records the creation of the two buffers, as large as the grid can fill.
pub(super) fn create(list: &mut DrawList, lights: &CameraLights) -> Result<(), RecordError> {
    let grid = lights.grid();
    list.push(
        Op::CreateBuffer,
        &[
            ids::LIGHT_GRID,
            grid.max_words() * 4,
            usage::STORAGE | usage::COPY_DST,
        ],
    )?;
    list.push(
        Op::CreateBuffer,
        &[
            ids::LIGHTS,
            grid.limits().lights.max(1) * sizes::LIGHT_RECORD_BYTES,
            usage::STORAGE | usage::COPY_DST,
        ],
    )?;
    Ok(())
}

/// Uploads the grid's words and light records when they differ from what the buffers hold.
pub(super) fn upload(
    list: &mut DrawList,
    arena: &mut UploadArena,
    lights: &mut CameraLights,
) -> Result<(), RecordError> {
    if !lights.take_new() {
        return Ok(());
    }
    let (at, bytes) = arena.push(lights.words_bytes())?;
    list.push(Op::WriteBuffer, &[ids::LIGHT_GRID, 0, at, bytes])?;
    let (at, bytes) = arena.push(lights.lights_bytes())?;
    list.push(Op::WriteBuffer, &[ids::LIGHTS, 0, at, bytes])?;
    Ok(())
}
