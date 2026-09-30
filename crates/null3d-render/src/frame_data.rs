//! The per-frame uniform block, laid out as the shaders' `Frame` structure reads it.

use null3d_gpu::drawlist::sizes::FRAME_UNIFORM_BYTES;

use crate::camera::Mat4;
use crate::output::OutputUniform;

/// Per-frame values: the camera, the lights and the output settings. Colors are linear and include
/// the intensity. Shaders work in positions relative to the camera.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct FrameUniform {
    /// The view-projection matrix for positions relative to the camera.
    pub view_proj: Mat4,
    /// The camera's position in the shaders' space: the origin. The fourth value is unused.
    pub camera_position: [f32; 4],
    /// The direction the sun's light travels, normalized.
    pub sun_direction: [f32; 4],
    pub sun_color: [f32; 4],
    pub ambient: [f32; 4],
    /// The exposure and the tone mapping, which the 8-bit path's fragment shaders apply.
    pub output: OutputUniform,
}

const _: () = assert!(std::mem::size_of::<FrameUniform>() == FRAME_UNIFORM_BYTES as usize);

impl FrameUniform {
    /// The block as bytes, for an upload.
    pub fn as_bytes(&self) -> &[u8] {
        // SAFETY: the struct is `repr(C)` and made only of 4-byte fields, so it has no padding,
        // and any bytes of it are initialized.
        unsafe {
            std::slice::from_raw_parts(
                (self as *const Self).cast::<u8>(),
                std::mem::size_of::<Self>(),
            )
        }
    }
}

/// A light direction scaled to unit length, or straight down when it has no length.
pub fn normalized_direction(direction: [f32; 3]) -> [f32; 4] {
    let length = direction.iter().map(|v| v * v).sum::<f32>().sqrt();
    if length > 0.0 {
        [
            direction[0] / length,
            direction[1] / length,
            direction[2] / length,
            0.0,
        ]
    } else {
        [0.0, -1.0, 0.0, 0.0]
    }
}
