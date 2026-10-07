//! The scene's fog, and its part of each frame's uniform block.
//!
//! The lit and unlit shaders mix each fragment's exposed linear color toward the fog color, by a
//! factor that grows with the fragment's straight-line distance from the camera (`null3d::fog` in
//! the shader library). A curve sets how the factor grows. The fog can thin with height, as air
//! does over a valley, and can glow toward the main directional light. The background takes no
//! fog, and a material can opt out.
//!
//! Height fog follows an exponential density, `density × exp(-falloff × (y - height))`, and the
//! shaders integrate it exactly along each view ray, as Filament does. The integral splits into a
//! term of the camera's height, which this module computes once a frame, and a term of each ray's
//! rise, which the shaders compute.

/// Curves of fog, as the shaders and the TypeScript API number them.
pub mod curve {
    /// No fog: every fragment keeps its color.
    pub const NONE: u32 = 0;
    /// Fog that starts at a near distance and hides everything from a far distance, with a smooth
    /// step between them, as three.js's `Fog`.
    pub const LINEAR: u32 = 1;
    /// Fog that thickens with the square of the distance, as three.js's `FogExp2`.
    pub const EXP2: u32 = 2;
    /// Fog that thickens as light through an even haze dims: the default.
    pub const EXPONENTIAL: u32 = 3;
}

/// The largest exponent of the camera's height term, as the shaders limit each ray's term. Both
/// terms then stay finite in 32-bit floats, and so does their product.
const HEIGHT_EXPONENT_LIMIT: f32 = 40.0;

/// How the fog's factor grows with the path through it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Curve {
    /// A factor of 1 - exp(-density × path).
    Exponential { density: f32 },
    /// A factor of 1 - exp(-(density × path)²).
    Exp2 { density: f32 },
    /// None up to `near`, full from `far`, and a smooth step between them.
    Linear { near: f32, far: f32 },
}

/// The scene's fog. Colors are linear.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Fog {
    /// The fog's linear color.
    pub color: [f32; 3],
    /// How the fog's factor grows with the path through it.
    pub curve: Curve,
    /// The height at which the fog has the curve's density, or its distances for linear fog.
    pub height: f32,
    /// How fast the fog thins above `height` and thickens below it: its density falls by a factor
    /// of e every 1 / `height_falloff` units up. 0 makes the fog the same at every height.
    pub height_falloff: f32,
    /// How much of the main directional light the fog scatters toward the camera: 0 for none.
    pub sun_glow: f32,
    /// The power of the glow's fall away from the light's direction: higher values make the glow
    /// smaller.
    pub sun_exponent: f32,
}

impl Fog {
    /// The fog of a curve code (`curve::*`) with its values: the density of exponential and
    /// exponential squared fog, the near and far distances of linear fog, then the height, the
    /// height falloff, the sun glow and its exponent. A code that names no curve gives no fog.
    pub fn from_code(code: u32, color: [f32; 3], values: [f32; 7]) -> Option<Self> {
        let [
            density,
            near,
            far,
            height,
            height_falloff,
            sun_glow,
            sun_exponent,
        ] = values;
        let curve = match code {
            curve::EXPONENTIAL => Curve::Exponential { density },
            curve::EXP2 => Curve::Exp2 { density },
            curve::LINEAR => Curve::Linear { near, far },
            _ => return None,
        };
        Some(Fog {
            color,
            curve,
            height,
            height_falloff,
            sun_glow,
            sun_exponent,
        })
    }

    /// The fog's density at a camera at height `camera_height`, as a share of its density at its
    /// own height.
    pub fn density_share_at(&self, camera_height: f32) -> f32 {
        let exponent = -self.height_falloff * (camera_height - self.height);
        exponent
            .clamp(-HEIGHT_EXPONENT_LIMIT, HEIGHT_EXPONENT_LIMIT)
            .exp()
    }

    /// The fog's part of the uniform block of a camera at height `camera_height` in the world, in
    /// a frame whose exposure is `exposure`. The shaders mix exposed color, so the fog color takes
    /// the exposure too. The sun's color in the frame's values already has it.
    pub fn uniform(&self, camera_height: f32, exposure: f32) -> FogUniform {
        let (code, density, near, far) = match self.curve {
            Curve::Exponential { density } => (curve::EXPONENTIAL, density, 0.0, 0.0),
            Curve::Exp2 { density } => (curve::EXP2, density, 0.0, 0.0),
            Curve::Linear { near, far } => (curve::LINEAR, 0.0, near, far),
        };
        FogUniform {
            color: self.color.map(|c| c * exposure),
            density,
            shape: [
                near,
                far,
                self.height_falloff,
                self.density_share_at(camera_height),
            ],
            sun_glow: self.sun_glow,
            sun_exponent: self.sun_exponent,
            spare: 0.0,
            curve: code,
        }
    }
}

/// The part of the frame's uniform block for `fog`, or for no fog.
pub fn uniform_of(fog: Option<&Fog>, camera_height: f32, exposure: f32) -> FogUniform {
    fog.map_or_else(FogUniform::default, |fog| {
        fog.uniform(camera_height, exposure)
    })
}

/// The fog's part of the frame's uniform block, laid out as the WGSL struct `Fog` in `null3d::fog`
/// reads it: two vectors of four, then four scalars, which every GPU path lays out alike.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct FogUniform {
    /// The exposed linear fog color.
    pub color: [f32; 3],
    /// The density of exponential and exponential squared fog at the fog's height.
    pub density: f32,
    /// Where linear fog starts, where it hides everything, the height falloff, and the fog's
    /// density at the camera's height as a share of its density at the fog's height.
    pub shape: [f32; 4],
    /// How much of the main directional light the fog scatters toward the camera.
    pub sun_glow: f32,
    /// The power of the glow's fall away from the light's direction.
    pub sun_exponent: f32,
    /// Fills the block to a multiple of 16 bytes, as WGSL lays out a struct in a uniform buffer.
    pub spare: f32,
    /// The fog's curve (`curve::*`).
    pub curve: u32,
}

const _: () = assert!(std::mem::size_of::<FogUniform>() == 48);

#[cfg(test)]
mod tests {
    use super::*;

    const GREY: [f32; 3] = [0.5, 0.5, 0.5];
    const VALUES: [f32; 7] = [0.1, 1.0, 2.0, 3.0, 0.5, 0.25, 8.0];

    fn close(a: f32, b: f32) -> bool {
        (a - b).abs() <= 1e-6 * b.abs().max(1.0)
    }

    #[test]
    fn each_curve_code_makes_its_fog_and_other_codes_none() {
        let fog = |code| Fog::from_code(code, GREY, VALUES).map(|fog| fog.curve);
        assert_eq!(fog(curve::NONE), None);
        assert_eq!(
            fog(curve::EXPONENTIAL),
            Some(Curve::Exponential { density: 0.1 })
        );
        assert_eq!(fog(curve::EXP2), Some(Curve::Exp2 { density: 0.1 }));
        assert_eq!(
            fog(curve::LINEAR),
            Some(Curve::Linear {
                near: 1.0,
                far: 2.0
            })
        );
        assert_eq!(fog(4), None);
        let fog = Fog::from_code(curve::EXPONENTIAL, GREY, VALUES).unwrap();
        assert_eq!(
            (
                fog.height,
                fog.height_falloff,
                fog.sun_glow,
                fog.sun_exponent
            ),
            (3.0, 0.5, 0.25, 8.0)
        );
    }

    #[test]
    fn the_uniform_holds_the_curve_its_values_and_the_sun_glow() {
        let linear = Fog::from_code(curve::LINEAR, GREY, VALUES)
            .unwrap()
            .uniform(3.0, 1.0);
        assert_eq!((linear.color, linear.curve), (GREY, curve::LINEAR));
        assert_eq!(linear.shape, [1.0, 2.0, 0.5, 1.0]);
        assert_eq!((linear.sun_glow, linear.sun_exponent), (0.25, 8.0));

        let exp2 = Fog::from_code(curve::EXP2, GREY, VALUES)
            .unwrap()
            .uniform(3.0, 0.5);
        assert_eq!((exp2.curve, exp2.density), (curve::EXP2, 0.1));
        assert_eq!(
            exp2.color,
            GREY.map(|c| c * 0.5),
            "the exposure scales the color"
        );

        let none = uniform_of(None, 3.0, 2.0);
        assert_eq!(none.curve, curve::NONE);
        assert_eq!(none.color, [0.0; 3]);
    }

    #[test]
    fn the_density_share_falls_with_the_camera_height_and_stays_finite() {
        let fog = Fog::from_code(curve::EXPONENTIAL, GREY, VALUES).unwrap();
        assert!(close(fog.density_share_at(3.0), 1.0));
        assert!(close(fog.density_share_at(5.0), (-1.0f32).exp()));
        assert!(close(fog.density_share_at(1.0), 1.0f32.exp()));
        let limit = HEIGHT_EXPONENT_LIMIT.exp();
        assert!(close(fog.density_share_at(-1e9), limit));
        assert!(close(fog.density_share_at(1e9), 1.0 / limit));
        let even = Fog {
            height_falloff: 0.0,
            ..fog
        };
        assert_eq!(even.density_share_at(1e9), 1.0);
    }
}
