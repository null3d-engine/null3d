//! The scene's environment: light from every direction around the scene, from an environment map
//! that the asset tool prefilters (D-19). Standard materials reflect it, sharp on smooth surfaces
//! and blurred on rough ones, and take its diffuse light.
//!
//! The map is a cube texture of the texture store (see [`crate::textures`]). Its level 0 holds the
//! light as it is, and each smaller level holds the light that a rougher surface reflects. Nine
//! spherical harmonics coefficients hold the diffuse light, in three.js's order, as its
//! `LightProbe` holds them.
//!
//! The environment is a value of the frame uniform, not a build of the shaders: the frame's group
//! always binds a cube, a blank one of one texel while the scene has no environment, and the
//! uniform says whether to read it. So setting an environment builds no pipeline, and a shader's
//! variants do not double.

use null3d_core::handle::Handle;
use null3d_gpu::drawlist::{
    DrawList, Op, address, compare, filter, format, resource_kind, texture_usage, view,
};

use crate::frame::RecordError;

/// The frame group's binding of the environment's cube texture; its sampler takes the next one.
pub(crate) const MAP_BINDING: u32 = 11;
/// Words of the frame group's entries for the map and its sampler.
pub(crate) const ENTRY_WORDS: usize = 10;

/// The scene's environment as the sketch sets it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Environment {
    /// The cube texture of the prefiltered light, in the texture store.
    pub texture: Handle,
    /// The factor of the environment's light on every surface, as three.js's
    /// `scene.environmentIntensity`.
    pub intensity: f32,
    /// The turn of the environment about the scene, as Euler angles in radians in three.js's
    /// default order, X then Y then Z, as `scene.environmentRotation`.
    pub rotation: [f32; 3],
    /// The nine coefficients of the diffuse light: red, green and blue for each.
    pub sh: [[f32; 3]; 9],
}

/// The environment's part of the frame uniform, laid out as the shaders' `Frame` reads it.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct EnvironmentUniform {
    /// The nine coefficients of the diffuse light, each in the first three floats.
    pub sh: [[f32; 4]; 9],
    /// The rows of the matrix that turns a direction in the world into the map's direction: the
    /// inverse of the environment's rotation.
    pub rotation: [[f32; 4]; 3],
    /// The map's last mip level, the environment's intensity, 1 while the map draws and 0 while
    /// the scene has none, and a spare.
    pub params: [f32; 4],
}

impl Environment {
    /// The uniform values for a map whose cube texture has `levels` mip levels on the GPU.
    pub(crate) fn uniform(&self, levels: u32) -> EnvironmentUniform {
        let mut sh = [[0.0; 4]; 9];
        for (out, coefficient) in sh.iter_mut().zip(&self.sh) {
            out[..3].copy_from_slice(coefficient);
        }
        EnvironmentUniform {
            sh,
            rotation: inverse_rotation(self.rotation),
            params: [levels.saturating_sub(1) as f32, self.intensity, 1.0, 0.0],
        }
    }
}

/// Records the creation of the blank cube of one black texel per face, which the frame's groups
/// bind while the scene has no environment, and of the map's sampler: linear within and between
/// levels, clamped at the edges, as cube maps filter across their faces' edges anyway.
pub(crate) fn create_objects(
    list: &mut DrawList,
    blank: u32,
    sampler: u32,
) -> Result<(), RecordError> {
    list.push(
        Op::CreateTexture,
        &[
            blank,
            1,
            1,
            view::CUBE_FACES,
            format::RGBA8_UNORM,
            texture_usage::TEXTURE_BINDING,
            1,
            1,
            view::CUBE,
        ],
    )?;
    list.push(
        Op::CreateSampler,
        &[
            sampler,
            address::CLAMP_TO_EDGE,
            address::CLAMP_TO_EDGE,
            address::CLAMP_TO_EDGE,
            filter::LINEAR,
            filter::LINEAR,
            filter::LINEAR,
            0f32.to_bits(),
            32f32.to_bits(),
            compare::NONE,
            1,
        ],
    )?;
    Ok(())
}

/// The frame group's entries that bind cube texture `map` and the map's sampler.
pub(crate) fn entries(map: u32, sampler: u32) -> [u32; ENTRY_WORDS] {
    [
        MAP_BINDING,
        resource_kind::TEXTURE,
        map,
        0,
        0,
        MAP_BINDING + 1,
        resource_kind::SAMPLER,
        sampler,
        0,
        0,
    ]
}

/// The rows of the inverse of the rotation by Euler angles `[x, y, z]` in the order X, Y, Z, as
/// three.js's `Matrix4.makeRotationFromEuler` builds the rotation. A rotation's inverse is its
/// transpose, so each row here is a column of the rotation, as three.js's `envMapRotation` holds
/// it.
fn inverse_rotation([x, y, z]: [f32; 3]) -> [[f32; 4]; 3] {
    let (b, a) = x.sin_cos();
    let (d, c) = y.sin_cos();
    let (f, e) = z.sin_cos();
    let (ae, af, be, bf) = (a * e, a * f, b * e, b * f);
    [
        [c * e, af + be * d, bf - ae * d, 0.0],
        [-c * f, ae - bf * d, be + af * d, 0.0],
        [d, -b * c, a * c, 0.0],
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn turn(rows: &[[f32; 4]; 3], v: [f32; 3]) -> [f32; 3] {
        rows.map(|row| row[0] * v[0] + row[1] * v[1] + row[2] * v[2])
    }

    fn close(a: [f32; 3], b: [f32; 3]) -> bool {
        a.iter().zip(&b).all(|(x, y)| (x - y).abs() < 1e-6)
    }

    #[test]
    fn no_rotation_keeps_directions() {
        let rows = inverse_rotation([0.0; 3]);
        assert!(close(turn(&rows, [0.3, -0.5, 0.8]), [0.3, -0.5, 0.8]));
    }

    #[test]
    fn a_turn_about_y_reads_the_map_turned_back() {
        // Turning the environment a quarter turn about +Y moves the light from +X to -Z, so a
        // surface facing -Z reads the map's +X.
        let rows = inverse_rotation([0.0, std::f32::consts::FRAC_PI_2, 0.0]);
        assert!(close(turn(&rows, [0.0, 0.0, -1.0]), [1.0, 0.0, 0.0]));
    }

    #[test]
    fn the_rows_are_the_columns_of_three_js_rotation() {
        // three.js's makeRotationFromEuler for (0.3, -0.7, 1.1) in the order XYZ, column by column.
        let columns = [
            [0.346_929_45, 0.765_047_6, 0.542_533_1],
            [-0.681_633, 0.603_004_4, -0.414_442],
            [-0.644_217_7, -0.226_026_3, 0.730_681_65],
        ];
        let rows = inverse_rotation([0.3, -0.7, 1.1]);
        for (row, column) in rows.iter().zip(&columns) {
            assert!(
                close([row[0], row[1], row[2]], *column),
                "{row:?} != {column:?}"
            );
        }
    }

    #[test]
    fn the_uniform_holds_the_last_level_and_the_intensity() {
        let mut sh = [[0.0; 3]; 9];
        sh[0] = [1.0, 2.0, 3.0];
        let env = Environment {
            texture: Handle::NONE,
            intensity: 0.5,
            rotation: [0.0; 3],
            sh,
        };
        let uniform = env.uniform(6);
        assert_eq!(uniform.params, [5.0, 0.5, 1.0, 0.0]);
        assert_eq!(uniform.sh[0], [1.0, 2.0, 3.0, 0.0]);
    }
}
