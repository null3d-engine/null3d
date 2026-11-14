//! The tone mask: the pixels whose visible surface keeps its color as the display shows it, so the
//! HDR path's final pass can skip the tone curve there. The mask pass draws the objects whose
//! material has `toneMapped: false` from the camera's view into the blue channel of the outline
//! mask, with the scene's depth (see [`crate::view::ViewId::TONE`]).
//!
//! The pass draws each object once, with the depth test and with a small bias toward the camera, so
//! only the parts that nothing hides mark a pixel. Blended surfaces are left out: a blended pixel
//! mixes two surfaces, so the mask cannot say which one owns it, and such a material keeps the
//! curve on the HDR path. The 8-bit path applies the flag in the material's own shader.

use null3d_gpu::drawlist::{permutation, state_flags, template};

use crate::pipelines::{DepthBias, DrawKey};

/// The depth bias of the mask's draw toward the camera: it lets a surface pass the depth test
/// against the depth that the scene passes drew for it. The mask places each vertex exactly as the
/// scene passes do, so a few steps suffice. It carries no slope term, which would grow without
/// limit where a surface turns edge-on and lift it past the objects in front.
const VISIBLE_BIAS: DepthBias = DepthBias {
    constant: 4,
    slope_bits: 0,
};

/// The key of the tone mask's pipeline for an object that draws with `pipeline`: the same vertices
/// and skinning, into the mask, with the depth test and no depth write. A surface that the scene
/// passes draw without a depth test is the one that shows, so the mask marks it without one too. It
/// keeps no other permutation bit, since the mask's template reads the instance as the mesh
/// templates do.
pub(crate) const fn tone_key(pipeline: DrawKey) -> DrawKey {
    let lines = pipeline.state & state_flags::LINE_LIST;
    let test = pipeline.state & state_flags::NO_DEPTH_TEST;
    DrawKey {
        template: template::TONE_MASK,
        permutation: pipeline.permutation & (permutation::SKIN | permutation::INSTANCE_INDEX),
        vertex_format: pipeline.vertex_format,
        state: state_flags::CULL_NONE | state_flags::NO_DEPTH_WRITE | lines | test,
        bias: VISIBLE_BIAS,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_mask_tests_depth_against_the_scene_and_toward_the_camera() {
        let pipeline = DrawKey {
            template: template::INSTANCED_LIT,
            permutation: permutation::SKIN | permutation::ALPHA_MASK | permutation::PREPASS,
            vertex_format: 5,
            state: state_flags::BLEND_NORMAL,
            bias: DepthBias::from_polygon_offset(1.0, 1.0),
        };
        let key = tone_key(pipeline);
        assert_eq!(key.template, template::TONE_MASK);
        assert_eq!(key.permutation, permutation::SKIN);
        assert_eq!(key.vertex_format, 5);
        assert_eq!(key.state & state_flags::NO_DEPTH_TEST, 0);
        assert_ne!(key.state & state_flags::NO_DEPTH_WRITE, 0);
        assert!(key.bias.constant > 0, "toward the camera");
        assert_eq!(
            f32::from_bits(key.bias.slope_bits),
            0.0,
            "no slope term, which lifts edge-on parts past the objects in front"
        );
        // A surface that the scene draws over everything is the one that shows, so the mask keeps
        // its depth test off.
        let always = DrawKey {
            state: state_flags::NO_DEPTH_TEST,
            ..pipeline
        };
        assert_ne!(tone_key(always).state & state_flags::NO_DEPTH_TEST, 0);
    }
}
