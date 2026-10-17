//! The scene's light probe grid (D-146): a grid of irradiance probes, each holding L1 spherical
//! harmonics of the light that reaches its point, in one RGBA16F 3D texture of the texture store.
//! Three sub-volumes along z hold a probe's four RGB coefficients, each with one padding slice at
//! either end, so hardware trilinear filtering never blends across sub-volumes.
//!
//! The grid is a value of the frame uniform, not a build of the shaders: the frame's group always
//! binds a 3D texture, a blank one of one texel while the scene has no grid, and the uniform says
//! whether to read it. So setting a grid builds no pipeline.

use null3d_core::handle::Handle;
use null3d_gpu::drawlist::{DrawList, Op, format, resource_kind, texture_usage, view};

use crate::frame::RecordError;

/// The frame group's binding of the grid's 3D texture, which the shadow settings' merge freed.
pub(crate) const MAP_BINDING: u32 = 10;
/// Words of the frame group's entry for the grid's texture.
pub(crate) const ENTRY_WORDS: usize = 5;

/// The scene's light probe grid as the sketch sets it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ProbeGrid {
    /// The 3D texture of the probes' coefficients, in the texture store.
    pub texture: Handle,
    /// The grid's corner of least x, y and z.
    pub origin: [f32; 3],
    /// The spacing between probes along each axis.
    pub spacing: [f32; 3],
    /// The probes along each axis.
    pub counts: [u32; 3],
    /// The factor of the grid's light on every surface. 0 lights nothing from the grid, and the
    /// grid still takes the share of the environment's light that `environment_weight` names.
    pub intensity: f32,
    /// The share of the environment's diffuse light that the grid takes over.
    pub environment_weight: f32,
}

/// The grid's part of the frame uniform, laid out as the shaders' `ProbeGrid`.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct ProbeGridUniform {
    pub origin: [f32; 4],
    pub inverse_spacing: [f32; 4],
    pub counts: [f32; 4],
    pub params: [f32; 4],
}

impl ProbeGrid {
    /// The uniform values for a frame whose exposure is `exposure`. The shaders add the grid's
    /// light to exposed color, as every light's, so its intensity takes the exposure.
    pub(crate) fn uniform(&self, exposure: f32) -> ProbeGridUniform {
        let mut origin = [0.0; 4];
        origin[..3].copy_from_slice(&self.origin);
        origin[3] = 1.0;
        let mut inverse_spacing = [0.0; 4];
        for (out, spacing) in inverse_spacing.iter_mut().zip(self.spacing) {
            *out = if spacing > 0.0 { 1.0 / spacing } else { 0.0 };
        }
        ProbeGridUniform {
            origin,
            inverse_spacing,
            counts: [
                self.counts[0] as f32,
                self.counts[1] as f32,
                self.counts[2] as f32,
                (self.counts[2] + 2) as f32,
            ],
            params: [self.intensity * exposure, self.environment_weight, 0.0, 0.0],
        }
    }
}

/// Records the creation of the blank 3D texture of one black texel, which the frame's groups bind
/// while the scene has no grid. The grid reads it with the environment's sampler.
pub(crate) fn create_objects(list: &mut DrawList, blank: u32) -> Result<(), RecordError> {
    list.push(
        Op::CreateTexture,
        &[
            blank,
            1,
            1,
            1,
            format::RGBA16_FLOAT,
            texture_usage::TEXTURE_BINDING,
            1,
            1,
            view::D3,
        ],
    )?;
    Ok(())
}

/// The frame group's entry that binds 3D texture `map`.
pub(crate) fn entries(map: u32) -> [u32; ENTRY_WORDS] {
    [MAP_BINDING, resource_kind::TEXTURE, map, 0, 0]
}
