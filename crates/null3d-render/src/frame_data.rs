//! The per-frame uniform block, laid out as the shaders' `Frame` structure reads it.

use null3d_gpu::drawlist::sizes::FRAME_UNIFORM_BYTES;

use crate::camera::Mat4;
use crate::fog::FogUniform;
use crate::output::OutputUniform;

/// Per-frame values: the camera, the lights, the output settings and the fog. Colors are linear and
/// include the intensity. Shaders work in positions relative to the camera.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct FrameUniform {
    /// The view-projection matrix for positions relative to the camera.
    pub view_proj: Mat4,
    /// The camera's place in the shaders' space, as a homogeneous point: the origin,
    /// `(0, 0, 0, 1)`, for a perspective camera. An orthographic camera's view rays are parallel,
    /// so its point lies at infinity: `w` is 0, and `(x, y, z)` is the unit direction from the
    /// scene toward the camera. From a position `p`, the direction toward the camera is
    /// `(x, y, z) - p × w`, normalized, for both kinds.
    pub camera_position: [f32; 4],
    /// The direction the sun's light travels, normalized.
    pub sun_direction: [f32; 4],
    pub sun_color: [f32; 4],
    pub ambient: [f32; 4],
    /// The exposure and the tone mapping, which the 8-bit path's fragment shaders apply.
    pub output: OutputUniform,
    /// The scene's fog, seen from the view's camera.
    pub fog: FogUniform,
    /// The row that gives a position's slice depth in the light grid: see
    /// [`crate::light_grid::GridUniform`].
    pub cluster_depth: [f32; 4],
    /// The light grid's tiles across, tiles up, slices and slices per doubling of the slice depth.
    /// The slices are 0 for a view whose grid lists no light.
    pub cluster_grid: [f32; 4],
    /// The sketch time in seconds, the seconds since the frame before, the frame's number as the
    /// bits of a `u32`, and a spare: what custom materials read as `frame`.
    pub clock: [f32; 4],
    /// The camera's position in the world, absolute rather than relative to it, and a spare.
    pub camera_world: [f32; 4],
    /// The size of the render target in pixels, and one over each.
    pub target_size: [f32; 4],
    /// The distances of the camera's near and far planes, then the change in normalized device
    /// coordinates across one CSS pixel of the canvas, along x and along y.
    pub camera_range: [f32; 4],
    /// Ambient occlusion's strength, 0 when the view draws none, the scene target's height in
    /// pixels, and the texels of its texture per pixel of the scene, across and down.
    pub occlusion: [f32; 4],
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
