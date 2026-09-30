//! The output transform: how the scene's linear color reaches the canvas.
//!
//! Where the device can, scene passes draw linear HDR color into a float target, the scene color.
//! The final pass then applies the exposure and the tone mapping, encodes sRGB and dithers. Where a
//! float target cannot have MSAA (WebGPU's compatibility mode, and WebGL2 devices that cannot draw
//! float targets with it), scene shaders do that themselves into an 8-bit target: the 8-bit path.
//! That target resolves straight into the canvas, so the path adds no pass.
//!
//! The background is part of the scene: exposure and tone mapping change it as they change the
//! objects, as in three.js's WebGPURenderer. The HDR path clears the scene color to the linear
//! background. The 8-bit path clears its target to the background after the output transform,
//! which this module computes on the CPU with the shaders' formulas.
//!
//! The tone mapping operators follow three.js's formulas, as `null3d::color` in the shader library
//! writes them. Their codes are the same in the core, `null3d::tonemap` and the TypeScript API.

use null3d_gpu::drawlist::{format, permutation, sizes::OUTPUT_UNIFORM_BYTES};

use crate::frame::linear_to_srgb;

/// How the output maps HDR color to the display, named after three.js's operators.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[repr(u32)]
pub enum ToneMapping {
    /// ACES filmic, three.js's `ACESFilmicToneMapping`, and the engine's default.
    #[default]
    Aces = 0,
    /// AgX, three.js's `AgXToneMapping`.
    Agx = 1,
    /// Khronos PBR Neutral, three.js's `NeutralToneMapping`.
    Neutral = 2,
    /// No curve: the exposed color, clipped at 1, as three.js's `LinearToneMapping` gives it.
    None = 3,
}

impl ToneMapping {
    /// Every operator, in code order.
    pub const ALL: [Self; 4] = [Self::Aces, Self::Agx, Self::Neutral, Self::None];

    /// The operator's code, which the shaders and the TypeScript API share.
    pub const fn code(self) -> u32 {
        self as u32
    }

    /// The operator of a code, or `None` for a code that names none.
    pub fn from_code(code: u32) -> Option<Self> {
        Self::ALL.into_iter().find(|mode| mode.code() == code)
    }

    /// The operator's constant's name in the shader library.
    pub const fn shader_name(self) -> &'static str {
        match self {
            Self::Aces => "ACES",
            Self::Agx => "AGX",
            Self::Neutral => "NEUTRAL",
            Self::None => "NONE",
        }
    }

    /// Exposed linear color after the operator: linear color from 0 to 1, as the shaders compute it.
    pub fn apply(self, c: [f32; 3]) -> [f32; 3] {
        match self {
            Self::Aces => aces(c),
            Self::Agx => agx(c),
            Self::Neutral => neutral(c),
            Self::None => c.map(|v| v.clamp(0.0, 1.0)),
        }
    }
}

/// The exposure and the tone mapping that the output applies.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Output {
    pub tone_mapping: ToneMapping,
    /// Scales linear scene color before the tone mapping.
    pub exposure: f32,
}

impl Default for Output {
    fn default() -> Self {
        Self {
            tone_mapping: ToneMapping::Aces,
            exposure: 1.0,
        }
    }
}

impl Output {
    /// Linear scene color after the exposure and the tone mapping, from 0 to 1.
    pub fn tone_map(self, c: [f32; 3]) -> [f32; 3] {
        self.tone_mapping.apply(c.map(|v| v * self.exposure))
    }

    /// The block the shaders read, with no flags and no render size.
    pub fn uniform(self) -> OutputUniform {
        OutputUniform {
            exposure: self.exposure,
            tone_mapping: self.tone_mapping.code(),
            flags: 0,
            render_size: 0,
        }
    }
}

/// Bits of [`OutputUniform::flags`], which the final pass reads.
pub mod output_flags {
    /// The scene color holds display color already, as the 8-bit path's shaders write it, so the
    /// final pass only copies it.
    pub const DISPLAY_COLOR: u32 = 1;
}

/// The output settings as the shaders' `Output` block lays them out. Scene shaders read the
/// exposure and the tone mapping. The final pass also reads the flags and the render size.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct OutputUniform {
    pub exposure: f32,
    pub tone_mapping: u32,
    /// Bits from [`output_flags`].
    pub flags: u32,
    /// The part of the scene color that the scene drew, from its top-left corner: the width in
    /// pixels in the low 16 bits, and the height in the high 16 bits.
    pub render_size: u32,
}

const _: () = assert!(std::mem::size_of::<OutputUniform>() == OUTPUT_UNIFORM_BYTES as usize);

impl OutputUniform {
    /// Says whether the scene color holds display color already.
    pub fn set_display_color(&mut self, display: bool) {
        if display {
            self.flags |= output_flags::DISPLAY_COLOR;
        } else {
            self.flags &= !output_flags::DISPLAY_COLOR;
        }
    }

    /// Sets the size the scene drew at, in pixels. Each side keeps its low 16 bits, which hold any
    /// texture size a GPU makes.
    pub fn set_render_size(&mut self, (width, height): (u32, u32)) {
        self.render_size = (width & 0xffff) | (height & 0xffff) << 16;
    }

    /// The block as bytes, for an upload.
    pub fn as_bytes(&self) -> &[u8] {
        // SAFETY: the struct is `repr(C)` and made only of 4-byte fields, so it has no padding, and
        // any bytes of it are initialized.
        unsafe {
            std::slice::from_raw_parts(
                (self as *const Self).cast::<u8>(),
                std::mem::size_of::<Self>(),
            )
        }
    }
}

/// The target that scene passes draw into.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SceneColor {
    format: u32,
}

impl SceneColor {
    /// The 8-bit path: a target of the canvas's format, which the scene shaders tone map into.
    pub const EIGHT_BIT: Self = Self {
        format: format::CANVAS,
    };

    /// The scene color in a format: `RGBA16_FLOAT` or `RG11B10_UFLOAT` for HDR color, and the
    /// 8-bit path for any other.
    pub const fn from_format(code: u32) -> Self {
        match code {
            format::RGBA16_FLOAT | format::RG11B10_UFLOAT => Self { format: code },
            _ => Self::EIGHT_BIT,
        }
    }

    /// The target's format.
    pub const fn format(self) -> u32 {
        self.format
    }

    /// True for HDR color, which the final pass tone maps.
    pub const fn is_hdr(self) -> bool {
        self.format != format::CANVAS
    }

    /// The permutation bits of the scene pipelines: the 8-bit path's shaders tone map themselves.
    pub const fn permutation(self) -> u32 {
        if self.is_hdr() {
            0
        } else {
            permutation::TONE_MAP
        }
    }

    /// The color that clears the scene color: the linear background for HDR color, and the
    /// background after the output transform, encoded as sRGB, on the 8-bit path. `None` for no
    /// background clears to transparent black on a transparent canvas, and to opaque black
    /// elsewhere.
    pub fn clear_color(
        self,
        background: Option<[f32; 3]>,
        transparent: bool,
        output: Output,
    ) -> [f32; 4] {
        let Some(background) = background else {
            return [0.0, 0.0, 0.0, if transparent { 0.0 } else { 1.0 }];
        };
        let [r, g, b] = if self.is_hdr() {
            background
        } else {
            output.tone_map(background).map(linear_to_srgb)
        };
        [r, g, b, 1.0]
    }
}

impl Default for SceneColor {
    fn default() -> Self {
        Self::EIGHT_BIT
    }
}

/// A 3 x 3 matrix by columns, as the shaders declare them.
type Mat3 = [[f32; 3]; 3];

fn mul(m: &Mat3, v: [f32; 3]) -> [f32; 3] {
    std::array::from_fn(|row| m[0][row] * v[0] + m[1][row] * v[1] + m[2][row] * v[2])
}

const ACES_INPUT: Mat3 = [
    [0.59719, 0.07600, 0.02840],
    [0.35458, 0.90834, 0.13383],
    [0.04823, 0.01566, 0.83777],
];
const ACES_OUTPUT: Mat3 = [
    [1.60475, -0.10208, -0.00327],
    [-0.53108, 1.10813, -0.07276],
    [-0.07367, -0.00605, 1.07602],
];

fn aces(c: [f32; 3]) -> [f32; 3] {
    let fitted = mul(&ACES_INPUT, c.map(|v| v / 0.6)).map(|v| {
        let a = v * (v + 0.024_578_6) - 0.000_090_537;
        let b = v * (0.983_729 * v + 0.432_951) + 0.238_081;
        a / b
    });
    mul(&ACES_OUTPUT, fitted).map(|v| v.clamp(0.0, 1.0))
}

const LINEAR_REC2020_TO_LINEAR_SRGB: Mat3 = [
    [1.6605, -0.1246, -0.0182],
    [-0.5876, 1.1329, -0.1006],
    [-0.0728, -0.0083, 1.1187],
];
const LINEAR_SRGB_TO_LINEAR_REC2020: Mat3 = [
    [0.6274, 0.0691, 0.0164],
    [0.3293, 0.9195, 0.0880],
    [0.0433, 0.0113, 0.8956],
];
const AGX_INSET: Mat3 = [
    [0.856_627_17, 0.137_318_97, 0.111_898_21],
    [0.095_121_24, 0.761_242, 0.076_799_415],
    [0.048_251_607, 0.101_439_04, 0.811_302_36],
];
const AGX_OUTSET: Mat3 = [
    [1.127_100_6, -0.141_329_77, -0.141_329_77],
    [-0.110_606_64, 1.157_823_7, -0.110_606_64],
    [-0.016_493_939, -0.016_493_939, 1.251_936_4],
];
const AGX_MIN_EV: f32 = -12.47393;
const AGX_MAX_EV: f32 = 4.026069;

fn agx(c: [f32; 3]) -> [f32; 3] {
    let inset = mul(&AGX_INSET, mul(&LINEAR_SRGB_TO_LINEAR_REC2020, c));
    let curved = inset.map(|v| {
        let x = ((v.max(1e-10).log2() - AGX_MIN_EV) / (AGX_MAX_EV - AGX_MIN_EV)).clamp(0.0, 1.0);
        let x2 = x * x;
        let x4 = x2 * x2;
        15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x
            - 0.00232
    });
    let rec2020 = mul(&AGX_OUTSET, curved).map(|v| v.max(0.0).powf(2.2));
    mul(&LINEAR_REC2020_TO_LINEAR_SRGB, rec2020).map(|v| v.clamp(0.0, 1.0))
}

fn neutral(c: [f32; 3]) -> [f32; 3] {
    const START_COMPRESSION: f32 = 0.8 - 0.04;
    const DESATURATION: f32 = 0.15;
    let x = c[0].min(c[1]).min(c[2]);
    let toe = if x < 0.08 { x - 6.25 * x * x } else { 0.04 };
    let shifted = c.map(|v| v - toe);
    let peak = shifted[0].max(shifted[1]).max(shifted[2]);
    if peak < START_COMPRESSION {
        return shifted;
    }
    let d = 1.0 - START_COMPRESSION;
    let new_peak = 1.0 - d * d / (peak + d - START_COMPRESSION);
    let g = 1.0 - 1.0 / (DESATURATION * (peak - new_peak) + 1.0);
    shifted.map(|v| {
        let scaled = v * (new_peak / peak);
        scaled + (new_peak - scaled) * g
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Values from three.js's formulas, ported to JavaScript in double precision, at an exposure
    /// of 1.
    const THREE: [(ToneMapping, [f32; 3], [f32; 3]); 12] = [
        (
            ToneMapping::Aces,
            [0.18, 0.18, 0.18],
            [0.213_105, 0.213_105, 0.213_103],
        ),
        (
            ToneMapping::Aces,
            [1.0, 0.5, 0.25],
            [0.789_263, 0.569_175, 0.364_231],
        ),
        (
            ToneMapping::Aces,
            [8.0, 2.0, 0.1],
            [1.0, 0.905_924, 0.583_989],
        ),
        (
            ToneMapping::Agx,
            [0.18, 0.18, 0.18],
            [0.214_549, 0.214_502, 0.214_499],
        ),
        (
            ToneMapping::Agx,
            [1.0, 0.5, 0.25],
            [0.607_567, 0.424_799, 0.305_538],
        ),
        (
            ToneMapping::Agx,
            [8.0, 2.0, 0.1],
            [1.0, 0.772_171, 0.541_901],
        ),
        (ToneMapping::Neutral, [0.18, 0.18, 0.18], [0.14, 0.14, 0.14]),
        (
            ToneMapping::Neutral,
            [1.0, 0.5, 0.25],
            [0.869_091, 0.422_529, 0.199_248],
        ),
        (
            ToneMapping::Neutral,
            [8.0, 2.0, 0.1],
            [0.992_258, 0.626_549, 0.510_742],
        ),
        (ToneMapping::None, [0.18, 0.18, 0.18], [0.18, 0.18, 0.18]),
        (ToneMapping::None, [1.0, 0.5, 0.25], [1.0, 0.5, 0.25]),
        (ToneMapping::None, [8.0, 2.0, 0.1], [1.0, 1.0, 0.1]),
    ];

    #[test]
    fn each_operator_gives_three_js_values() {
        for (mode, input, expected) in THREE {
            let found = mode.apply(input);
            for (channel, (&got, &want)) in found.iter().zip(&expected).enumerate() {
                assert!(
                    (got - want).abs() < 2e-4,
                    "{mode:?} of {input:?}, channel {channel}: {got}, and three.js gives {want}"
                );
            }
        }
    }

    #[test]
    fn codes_name_each_operator_once_and_the_shader_library_agrees() {
        let library = include_str!("../../null3d-shaders/wgsl/lib/tonemap.wgsl");
        for mode in ToneMapping::ALL {
            assert_eq!(ToneMapping::from_code(mode.code()), Some(mode));
            let line = format!("const {}: u32 = {}u;", mode.shader_name(), mode.code());
            assert!(library.contains(&line), "tonemap.wgsl lacks {line}");
        }
        assert_eq!(ToneMapping::from_code(4), None);
        assert_eq!(ToneMapping::default(), ToneMapping::Aces);
    }

    #[test]
    fn exposure_scales_the_color_before_the_tone_mapping() {
        let brighter = Output {
            tone_mapping: ToneMapping::Aces,
            exposure: 2.0,
        };
        assert_eq!(
            brighter.tone_map([0.5, 0.25, 0.1]),
            ToneMapping::Aces.apply([1.0, 0.5, 0.2])
        );
        let uniform = brighter.uniform();
        assert_eq!((uniform.exposure, uniform.tone_mapping), (2.0, 0));
        assert_eq!(uniform.as_bytes().len(), OUTPUT_UNIFORM_BYTES as usize);
    }

    #[test]
    fn the_final_pass_reads_its_flags_and_the_render_size_from_the_spare_words() {
        let mut uniform = Output::default().uniform();
        assert_eq!((uniform.flags, uniform.render_size), (0, 0));
        uniform.set_display_color(true);
        uniform.set_render_size((1001, 600));
        assert_eq!(uniform.flags, output_flags::DISPLAY_COLOR);
        assert_eq!(uniform.render_size & 0xffff, 1001);
        assert_eq!(uniform.render_size >> 16, 600);
        uniform.set_display_color(false);
        assert_eq!(uniform.flags, 0);
        // The shader library's block has the same words in the same order.
        let library = include_str!("../../null3d-shaders/wgsl/lib/tonemap.wgsl");
        let block =
            "    exposure: f32,\n    tone_mapping: u32,\n    flags: u32,\n    render_size: u32,\n";
        assert!(
            library.contains(block),
            "tonemap.wgsl's Output block differs"
        );
    }

    #[test]
    fn the_background_clears_linear_for_hdr_and_after_the_output_on_the_8_bit_path() {
        let hdr = SceneColor::from_format(format::RGBA16_FLOAT);
        let eight_bit = SceneColor::from_format(format::CANVAS);
        assert!(hdr.is_hdr() && !eight_bit.is_hdr());
        assert_eq!(
            SceneColor::from_format(format::RGBA8_UNORM),
            SceneColor::EIGHT_BIT
        );
        assert_eq!(hdr.permutation(), 0);
        assert_eq!(eight_bit.permutation(), permutation::TONE_MAP);

        let output = Output::default();
        let background = Some([0.5, 0.2, 0.1]);
        assert_eq!(
            hdr.clear_color(background, false, output),
            [0.5, 0.2, 0.1, 1.0]
        );
        let [r, g, b, a] = eight_bit.clear_color(background, false, output);
        let expected = output.tone_map([0.5, 0.2, 0.1]).map(linear_to_srgb);
        assert_eq!([r, g, b], expected);
        assert_eq!(a, 1.0);
        // Without a background the canvas shows black, or nothing when it is transparent. Every
        // operator maps black to black, so both paths agree.
        for scene_color in [hdr, eight_bit] {
            assert_eq!(
                scene_color.clear_color(None, false, output),
                [0.0, 0.0, 0.0, 1.0]
            );
            assert_eq!(scene_color.clear_color(None, true, output), [0.0; 4]);
        }
        for mode in ToneMapping::ALL {
            assert_eq!(mode.apply([0.0; 3]), [0.0; 3], "{mode:?}");
        }
    }
}
