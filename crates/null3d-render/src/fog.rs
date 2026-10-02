//! Fog with three.js's formulas: the scene's fog, and its part of each frame's uniform block.
//!
//! The lit and unlit shaders mix each fragment's linear color toward the fog color, by a factor
//! that grows with the fragment's depth along the camera's view direction (`null3d::fog` in the
//! shader library). The background takes no fog, and a material can opt out.

/// Kinds of fog, as the shaders and the TypeScript API number them.
pub mod kind {
    /// No fog: every fragment keeps its color.
    pub const NONE: u32 = 0;
    /// Fog that starts at a near distance and hides everything from a far distance, as three.js's
    /// `Fog`.
    pub const LINEAR: u32 = 1;
    /// Fog that thickens with the square of the distance, as three.js's `FogExp2`.
    pub const EXP2: u32 = 2;
}

/// The scene's fog. Colors are linear.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub enum Fog {
    #[default]
    None,
    /// None up to `near`, full from `far`, and a smooth step between them.
    Linear {
        color: [f32; 3],
        near: f32,
        far: f32,
    },
    /// A factor of 1 - exp(-(density × depth)²).
    Exp2 { color: [f32; 3], density: f32 },
}

impl Fog {
    /// The fog of a kind code (`kind::*`) with its values: the near and far distances of linear
    /// fog, or the density of exponential squared fog. A code that names no kind gives no fog.
    pub fn from_code(code: u32, color: [f32; 3], near: f32, far: f32, density: f32) -> Self {
        match code {
            kind::LINEAR => Fog::Linear { color, near, far },
            kind::EXP2 => Fog::Exp2 { color, density },
            _ => Fog::None,
        }
    }

    /// The fog's part of the uniform block of a camera that looks along the unit direction
    /// `forward`, which fog depth follows.
    pub fn uniform(&self, forward: [f32; 3]) -> FogUniform {
        let mut uniform = FogUniform {
            forward,
            ..FogUniform::default()
        };
        match *self {
            Fog::None => {}
            Fog::Linear { color, near, far } => {
                uniform.color = color;
                uniform.kind = kind::LINEAR;
                (uniform.near, uniform.far) = (near, far);
            }
            Fog::Exp2 { color, density } => {
                uniform.color = color;
                uniform.kind = kind::EXP2;
                uniform.density = density;
            }
        }
        uniform
    }
}

/// The fog's part of the frame's uniform block, laid out as the WGSL struct `Fog` in `null3d::fog`
/// reads it: each three-component value fills a vector of four with a scalar after it, which every
/// GPU path lays out alike.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct FogUniform {
    /// The linear fog color.
    pub color: [f32; 3],
    /// The density of exponential squared fog.
    pub density: f32,
    /// The camera's unit view direction, in world space.
    pub forward: [f32; 3],
    /// Where linear fog starts.
    pub near: f32,
    /// Where linear fog hides everything.
    pub far: f32,
    /// The kind of fog (`kind::*`).
    pub kind: u32,
    /// Fills the block to a multiple of 16 bytes, as WGSL lays out a struct in a uniform buffer.
    pub spare: [f32; 2],
}

const _: () = assert!(std::mem::size_of::<FogUniform>() == 48);

#[cfg(test)]
mod tests {
    use super::*;

    const GREY: [f32; 3] = [0.5, 0.5, 0.5];
    const AHEAD: [f32; 3] = [0.0, 0.0, -1.0];

    #[test]
    fn each_kind_code_makes_its_fog_and_other_codes_none() {
        assert_eq!(Fog::from_code(kind::NONE, GREY, 1.0, 2.0, 0.1), Fog::None);
        assert_eq!(
            Fog::from_code(kind::LINEAR, GREY, 1.0, 2.0, 0.1),
            Fog::Linear {
                color: GREY,
                near: 1.0,
                far: 2.0
            }
        );
        assert_eq!(
            Fog::from_code(kind::EXP2, GREY, 1.0, 2.0, 0.1),
            Fog::Exp2 {
                color: GREY,
                density: 0.1
            }
        );
        assert_eq!(Fog::from_code(3, GREY, 1.0, 2.0, 0.1), Fog::None);
    }

    #[test]
    fn the_uniform_holds_the_kind_its_values_and_the_view_direction() {
        let linear = Fog::Linear {
            color: GREY,
            near: 10.0,
            far: 50.0,
        }
        .uniform(AHEAD);
        assert_eq!(
            (linear.color, linear.kind, linear.forward),
            (GREY, kind::LINEAR, AHEAD)
        );
        assert_eq!((linear.near, linear.far, linear.density), (10.0, 50.0, 0.0));

        let exp2 = Fog::Exp2 {
            color: GREY,
            density: 0.02,
        }
        .uniform(AHEAD);
        assert_eq!((exp2.kind, exp2.density), (kind::EXP2, 0.02));

        let none = Fog::None.uniform(AHEAD);
        assert_eq!(none.kind, kind::NONE);
        assert_eq!(none.color, [0.0; 3]);
    }
}
