//! A crisp line around the objects that a sketch outlines. The render graph's mask pass runs after
//! the scene passes, and the final pass draws the line from the mask (see [`crate::frame_graph`]):
//!
//! 1. The mask pass draws the outlined objects from the camera's view into a mask of the render
//!    size (see [`crate::view::ViewId::OUTLINE`]). Its depth target is the scene's depth, which it
//!    tests but never writes. Each object draws twice: once with no depth test, which marks every
//!    part of it in the red channel, and once with the test, which marks the parts that nothing
//!    hides in the green channel. The mask has the scene's samples, and resolves into a texture of
//!    one sample, so the edges of its coverage keep the scene's anti-aliasing.
//! 2. The final pass reads the mask at the pixel's place and at 8 places on a circle of the line's
//!    width around it: across, down and on both diagonals. Outside the outlined objects, the
//!    highest coverage among those reads is the line's coverage, so the line ends as sharply as the
//!    objects' own edges, with no blur. The line takes the visible color where a read finds a part
//!    that nothing hides, and the hidden color where the reads find only hidden parts. The pass
//!    paints it over the canvas color after the output transform, so it shows its colors exactly.
//!
//! The line is as wide as the sketch sets it at any pixel ratio and render scale, because the reads
//! space themselves in pixels of the canvas. Parts thinner than the width can fall between the
//! reads, so a wide line can leave a gap beside them.

use null3d_gpu::drawlist::{format, permutation, state_flags, template};

use crate::frame::linear_to_srgb;
use crate::pipelines::{DepthBias, DrawKey};

/// The format of the mask: coverage in red, and the parts that nothing hides in green.
pub const MASK_FORMAT: u32 = format::RGBA8_UNORM;

/// How outlines look.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Outline {
    /// The linear color of the line around the parts that nothing hides.
    pub color: [f32; 3],
    /// The linear color of the line around the parts that other objects hide, or `None` for no
    /// line there.
    pub hidden_color: Option<[f32; 3]>,
    /// The line's width in CSS pixels.
    pub width: f32,
}

impl Default for Outline {
    /// A white line of 2 CSS pixels around the parts that nothing hides.
    fn default() -> Self {
        Self {
            color: [1.0; 3],
            hidden_color: None,
            width: 2.0,
        }
    }
}

impl Outline {
    /// The same outline on a screen of `pixel_ratio` device pixels per CSS pixel, with its width
    /// in pixels of the canvas.
    pub(crate) fn on_canvas(self, pixel_ratio: f32) -> Self {
        Self {
            width: self.width * pixel_ratio,
            ..self
        }
    }

    /// The final pass's two blocks of the outline: the visible color encoded for the display, with
    /// the width in pixels of the canvas, then the hidden color encoded for the display, with 1
    /// where the line draws around hidden parts and 0 where it does not.
    pub(crate) fn uniform(self) -> [[f32; 4]; 2] {
        let display = |c: [f32; 3]| c.map(|channel| linear_to_srgb(channel.clamp(0.0, 1.0)));
        let [r, g, b] = display(self.color);
        // With no hidden line, the hidden color is the visible one, so no mix of the two tints the
        // line beside a hidden part.
        let (hidden, draws) = match self.hidden_color {
            Some(color) => (display(color), 1.0),
            None => ([r, g, b], 0.0),
        };
        let [hr, hg, hb] = hidden;
        [[r, g, b, self.width], [hr, hg, hb, draws]]
    }
}

/// The depth bias of the mask's draw of the parts that nothing hides, toward the camera: it lets a
/// surface pass the depth test against the depth that the scene passes drew for it.
const VISIBLE_BIAS: DepthBias = DepthBias {
    constant: 4,
    slope_bits: 0x3f80_0000,
};

/// The keys of the two pipelines that draw an outlined pair, which draws with `pipeline`, into the
/// mask: every part with no depth test, then the parts that nothing hides, nudged toward the
/// camera so that its own surface passes. Both draw both faces and write no depth, so a part seen
/// from behind still counts. The mask template places the vertices as the depth template does,
/// and skins them in the vertex shader where `pipeline` does.
pub(crate) const fn mask_keys(pipeline: DrawKey) -> (DrawKey, DrawKey) {
    let every = DrawKey {
        template: template::OUTLINE_MASK,
        permutation: pipeline.permutation & permutation::SKIN,
        vertex_format: pipeline.vertex_format,
        state: state_flags::CULL_NONE | state_flags::NO_DEPTH_TEST,
        bias: DepthBias::NONE,
    };
    let visible = DrawKey {
        permutation: every.permutation | permutation::OUTLINE_VISIBLE,
        state: state_flags::CULL_NONE | state_flags::NO_DEPTH_WRITE,
        bias: VISIBLE_BIAS,
        ..every
    };
    (every, visible)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_final_pass_takes_display_colors_and_the_width_on_the_canvas() {
        let outline = Outline {
            color: [1.0, 0.5, 0.0],
            hidden_color: Some([0.0, 0.0, 2.0]),
            width: 1.5,
        };
        let near = |a: [f32; 4], b: [f32; 4]| a.iter().zip(b).all(|(x, y)| (x - y).abs() < 1e-6);
        let [visible, hidden] = outline.on_canvas(2.0).uniform();
        let half = linear_to_srgb(0.5);
        assert!(
            near(visible, [1.0, half, 0.0, 3.0]),
            "the width counts pixels of the canvas"
        );
        assert!(
            near(hidden, [0.0, 0.0, 1.0, 1.0]),
            "colors clamp to what a display shows"
        );

        let [visible, hidden] = Outline::default().uniform();
        assert!(near(visible, [1.0, 1.0, 1.0, 2.0]));
        assert!(
            near(hidden, [1.0, 1.0, 1.0, 0.0]),
            "no line around hidden parts"
        );
    }

    #[test]
    fn the_mask_draws_every_part_then_the_parts_that_nothing_hides() {
        let pair = DrawKey {
            template: template::INSTANCED_LIT,
            permutation: permutation::ALPHA_MASK,
            vertex_format: 5,
            state: state_flags::BLEND_NORMAL,
            bias: DepthBias::from_polygon_offset(1.0, 1.0),
        };
        let (every, visible) = mask_keys(pair);
        assert_eq!(every.vertex_format, 5);
        assert_eq!(every.permutation, 0);
        assert_ne!(every.state & state_flags::NO_DEPTH_TEST, 0);
        assert_eq!(visible.permutation, permutation::OUTLINE_VISIBLE);
        assert_eq!(visible.state & state_flags::NO_DEPTH_TEST, 0);
        assert_ne!(visible.state & state_flags::NO_DEPTH_WRITE, 0);
        assert!(visible.bias.constant > 0, "toward the camera");
        assert_eq!(f32::from_bits(visible.bias.slope_bits), 1.0);
    }
}
