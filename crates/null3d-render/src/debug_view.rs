//! Debug views: the whole scene drawn with one debug shading in place of each material's, for
//! development builds' `debug.view`. Each mesh and material pair keeps its mesh and its faces, and
//! draws with the debug view template, whose permutation bits pick the view:
//!
//! - normals: the world-space normal as a color, each axis from 0 to 1;
//! - depth: the distance from the camera as a gray, white at the near plane and black at the far
//!   plane, on a logarithmic scale for a perspective camera;
//! - overdraw: each fragment adds a little light, with no depth test, so bright areas show where
//!   many surfaces cover the same pixel;
//! - wireframe: each triangle's edges as lines in the material's color, from an edge index list
//!   per mesh part, as WebGL2 has no line fill mode;
//! - shadows: how much of the main directional light's shadow falls on each surface, as a gray
//!   from black in full shadow to white in full light. The gray is the shadow factor that lit
//!   shading multiplies the sun's light by, so tests can read shadows alone, without the lighting
//!   and the materials. A surface that receives no shadows shows white.
//!
//! A debug view also clears to black, hides the background texture and draws without the tone
//! mapping and the exposure, so its colors reach the canvas as the shader writes them.

use null3d_gpu::drawlist::{permutation, state_flags, template};

use crate::pipelines::{DepthBias, DrawKey};

/// Debug views, as the TypeScript API numbers them.
pub mod code {
    /// The materials' own shading.
    pub const LIT: u32 = 0;
    pub const NORMALS: u32 = 1;
    pub const DEPTH: u32 = 2;
    pub const OVERDRAW: u32 = 3;
    pub const WIREFRAME: u32 = 4;
    pub const SHADOWS: u32 = 5;
}

/// How the scene draws: with its materials, or with one debug shading.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum DebugView {
    #[default]
    Lit = code::LIT as isize,
    Normals = code::NORMALS as isize,
    Depth = code::DEPTH as isize,
    Overdraw = code::OVERDRAW as isize,
    Wireframe = code::WIREFRAME as isize,
    Shadows = code::SHADOWS as isize,
}

impl DebugView {
    /// The view of a code in [`code`], or `None` for a code that names none.
    pub fn from_code(view: u32) -> Option<Self> {
        Some(match view {
            code::LIT => Self::Lit,
            code::NORMALS => Self::Normals,
            code::DEPTH => Self::Depth,
            code::OVERDRAW => Self::Overdraw,
            code::WIREFRAME => Self::Wireframe,
            code::SHADOWS => Self::Shadows,
            _ => return None,
        })
    }

    /// True for every view but the materials' own shading.
    pub const fn is_debug(self) -> bool {
        !matches!(self, Self::Lit)
    }

    /// The key that a mesh and material pair draws with in this view, from the key of its
    /// material's shading. Each debug view keeps the pair's mesh and which faces it culls, and
    /// drops the material's blending, depth options and depth bias. Overdraw adds every fragment
    /// without a depth test, so its pairs draw in the transparent pass. Wireframe draws lines. In
    /// the debug view template, the receive shadows bit picks the shadows view, whose low bit marks
    /// a surface that shows no shadows: [`receiving`] clears it on a receiver. The high bit marks a
    /// surface whose shading takes no light, which shows no shadows even where it receives them.
    pub const fn draw_key(self, key: DrawKey) -> DrawKey {
        let faces = key.state & state_flags::CULL_NONE;
        let (bits, state) = match self {
            Self::Lit => return key,
            Self::Normals => (0, faces),
            Self::Depth => (permutation::DEBUG_VIEW_LOW, faces),
            Self::Overdraw => (
                permutation::DEBUG_VIEW_HIGH,
                faces | state_flags::NO_DEPTH_TEST | state_flags::BLEND_ADDITIVE,
            ),
            Self::Wireframe => (
                permutation::DEBUG_VIEW_LOW | permutation::DEBUG_VIEW_HIGH,
                state_flags::LINE_LIST,
            ),
            Self::Shadows if shades_with_lights(key.template) => (
                permutation::RECEIVE_SHADOWS | permutation::DEBUG_VIEW_LOW,
                faces,
            ),
            Self::Shadows => (
                permutation::RECEIVE_SHADOWS
                    | permutation::DEBUG_VIEW_LOW
                    | permutation::DEBUG_VIEW_HIGH,
                faces,
            ),
        };
        DrawKey {
            template: template::DEBUG_VIEW,
            permutation: bits,
            vertex_format: key.vertex_format,
            state,
            bias: DepthBias::NONE,
        }
    }
}

/// True for a template whose shading reflects the lights, so shadows fall on it: the standard
/// material's two templates and custom materials, which light their surfaces as it does.
pub const fn shades_with_lights(template: u32) -> bool {
    template == template::INSTANCED_LIT
        || template == template::INSTANCED_STANDARD_MAPS
        || template >= template::CUSTOM_FIRST
}

/// The key of a pair that receives shadows, from the key that [`DebugView::draw_key`] gave it: the
/// shadows view reads the shadow maps where the pair's material takes light, and every other debug
/// view keeps its key.
pub const fn receiving(key: DrawKey) -> DrawKey {
    let shadows_view = permutation::RECEIVE_SHADOWS | permutation::DEBUG_VIEW_LOW;
    let unlit = permutation::DEBUG_VIEW_HIGH;
    if key.template == template::DEBUG_VIEW
        && key.permutation & (shadows_view | unlit) == shadows_view
    {
        DrawKey {
            permutation: key.permutation & !permutation::DEBUG_VIEW_LOW,
            ..key
        }
    } else {
        key
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const BLENDED: DrawKey = DrawKey {
        template: template::INSTANCED_LIT,
        permutation: permutation::VERTEX_COLOR | permutation::ALPHA_MASK,
        vertex_format: 3,
        state: state_flags::CULL_NONE | state_flags::BLEND_NORMAL | state_flags::NO_DEPTH_WRITE,
        bias: DepthBias {
            constant: -2,
            slope_bits: 0,
        },
    };

    #[test]
    fn codes_name_each_view_once() {
        for view in 0..6 {
            assert_eq!(DebugView::from_code(view).map(|v| v as u32), Some(view));
        }
        assert_eq!(DebugView::from_code(6), None);
        assert!(!DebugView::Lit.is_debug());
        assert!(DebugView::Wireframe.is_debug());
    }

    #[test]
    fn the_lit_view_keeps_the_material_key() {
        assert_eq!(DebugView::Lit.draw_key(BLENDED), BLENDED);
    }

    #[test]
    fn debug_views_keep_the_mesh_and_its_faces_and_drop_the_material() {
        let normals = DebugView::Normals.draw_key(BLENDED);
        assert_eq!(normals.template, template::DEBUG_VIEW);
        assert_eq!(normals.permutation, 0);
        assert_eq!(normals.vertex_format, 3);
        assert_eq!(normals.state, state_flags::CULL_NONE);
        assert_eq!(normals.bias, DepthBias::NONE);
        assert!(!normals.blends());
        let depth = DebugView::Depth.draw_key(BLENDED);
        assert_eq!(depth.permutation, permutation::DEBUG_VIEW_LOW);
        let overdraw = DebugView::Overdraw.draw_key(BLENDED);
        assert_eq!(overdraw.permutation, permutation::DEBUG_VIEW_HIGH);
        assert!(overdraw.blends());
        assert_eq!(
            overdraw.state & !state_flags::BLEND,
            state_flags::CULL_NONE | state_flags::NO_DEPTH_TEST
        );
        let wireframe = DebugView::Wireframe.draw_key(BLENDED);
        assert_eq!(
            wireframe.permutation,
            permutation::DEBUG_VIEW_LOW | permutation::DEBUG_VIEW_HIGH
        );
        assert_eq!(wireframe.state, state_flags::LINE_LIST);
    }

    #[test]
    fn the_shadows_view_reads_the_shadow_maps_only_on_receivers() {
        let shadows = DebugView::Shadows.draw_key(BLENDED);
        assert_eq!(
            shadows.permutation,
            permutation::RECEIVE_SHADOWS | permutation::DEBUG_VIEW_LOW
        );
        assert_eq!(shadows.state, state_flags::CULL_NONE);
        assert!(!shadows.blends());
        assert_eq!(receiving(shadows).permutation, permutation::RECEIVE_SHADOWS);
        // The other debug views keep their keys on a receiver.
        let depth = DebugView::Depth.draw_key(BLENDED);
        assert_eq!(receiving(depth), depth);
        let wireframe = DebugView::Wireframe.draw_key(BLENDED);
        assert_eq!(receiving(wireframe), wireframe);
        // An unlit material shows no shadows.
        let unlit = DebugView::Shadows.draw_key(DrawKey {
            template: template::INSTANCED_UNLIT,
            ..BLENDED
        });
        assert_eq!(receiving(unlit), unlit);
    }
}
