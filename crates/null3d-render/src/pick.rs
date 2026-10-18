//! GPU picking: which object a pixel of the frame shows.
//!
//! A pick draws the camera's opaque objects once more into an id target, after the opaque pass and
//! against the same depth, and reads back one pixel of it. The target holds, for each pixel, the
//! source key of the object or instance row that owns the depth there, which the sketch turns into
//! an object and a row. A fragment that a material's mask discarded wrote no depth, so it never
//! matches: a masked object picks by its mask, not by its whole geometry. The pick template places
//! each vertex as the shading template of the same draw does, which the depth test compares to the
//! last bit.
//!
//! The pass runs only in a frame with a request. Its target is the render size, because a render
//! pass's targets share a size and a sample count with the scene's depth. The ids pass through a
//! resolve into a target of one sample, which the frame copies into a buffer of a ring, and the
//! GPU's read raises a control slot that the sketch waits for. A pick therefore costs one more
//! draw of the visible opaque objects, the resolve and a read of four bytes.
//!
//! A mesh drawn with a material that moves its vertices in its own WGSL has no pick build. Neither
//! has a blended surface, or one that lets light through: the scene query answers those with a
//! raycast. A custom material with a vertex offset has pick builds of its own template, which move
//! its vertices as its surface draws.

use null3d_gpu::drawlist::{DrawList, Op, format, permutation, state_flags, template};

use crate::frame::RecordError;
use crate::pipelines::{DepthBias, DrawKey, PassTargets, PipelineKey};

/// The format of the id target and of its resolve: four bytes, one per channel, which hold the
/// source key that the pick template's fragment writes.
pub const FORMAT: u32 = null3d_gpu::drawlist::format::RGBA8_UNORM;

/// The reads of the ring that waits for the GPU, one for each pick in flight.
pub const RING: usize = 4;

/// The words of one read's result that land in engine memory: the source key, then three words
/// that the sketch does not read.
pub const RESULT_WORDS: usize = 4;

/// The bytes of the buffer that one read lands in, a row of the one-pixel copy that WebGPU's
/// copies align to.
pub const READ_BYTES: u32 = 256;

/// The key that a pixel holds where no object owns the depth: 0 names no source, as an object's
/// slot starts at 1.
pub const NO_HIT: u32 = 0;

/// The engine's templates that draw a mesh as its vertices give it, which the pick template can
/// place as they do. A sprite, a line and a particle expand a quad in their own vertex shaders.
const MESH_TEMPLATES: [u32; 7] = [
    template::INSTANCED_LIT,
    template::INSTANCED_UNLIT,
    template::INSTANCED_TEXCOORDS,
    template::INSTANCED_UNLIT_MAP,
    template::INSTANCED_STANDARD_MAPS,
    template::PROBE_GRID,
    template::PROBE_GRID_MAPS,
];

/// The bias of the pick pass on WebGL2, toward the camera: two programs that place a vertex with
/// the same steps can still give its depth a step apart, as ANGLE did in Chrome on a Mac (D-43).
/// The pick template holds the position invariant, and the bias covers that step without reaching
/// an object behind the surface.
pub const WEBGL2_BIAS: DepthBias = DepthBias {
    constant: 4,
    slope_bits: 0,
};

/// A pick that a frame draws before it answers, from the sketch's request.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PickRequest {
    /// The point in CSS pixels from the canvas's top-left corner, as `camera.screenToRay` takes it.
    pub x: f32,
    /// The point's y in CSS pixels.
    pub y: f32,
    /// Which read of the ring the frame's copy lands in.
    pub ring: u32,
    /// The control slot that the read raises once its bytes are in engine memory.
    pub slot: u32,
    /// The address in engine memory that the read's bytes land at.
    pub destination: u32,
}

/// A frame's pick that the frame draws and copies back: the request, and the pixel of the render
/// target that it names.
pub type PickFrame = (PickRequest, (u32, u32));

/// The pixel of a render target of `size` that a request names, with its row counted from the
/// target's top, clamped into the target. `pixel_ratio` turns CSS pixels into device pixels, and
/// `scale` turns those into pixels of the render target.
pub fn pixel_of(
    request: &PickRequest,
    pixel_ratio: f32,
    scale: crate::graph::RenderScale,
    size: (u32, u32),
) -> (u32, u32) {
    let thousandths = scale.thousandths() as f64;
    let to_target = |value: f32| (value as f64 * pixel_ratio as f64 * thousandths / 1000.0).floor();
    let clamp = |value: f64, limit: u32| value.clamp(0.0, limit.saturating_sub(1) as f64) as u32;
    (
        clamp(to_target(request.x), size.0),
        clamp(to_target(request.y), size.1),
    )
}

/// The pipeline that copies the resolved ids: one triangle over the target, of one sample, that
/// reads the id target at group 0.
pub fn resolve_key(color_format: u32) -> PipelineKey {
    PipelineKey {
        template: template::PICK_RESOLVE,
        permutation: 0,
        vertex_format: 0,
        color_format,
        depth_format: format::NONE,
        samples: 1,
        state: 0,
        bias: DepthBias::NONE,
    }
}

/// Records the copy of the picked pixel of `texture` into `buffer`, and the read of its four bytes
/// into engine memory at the request's destination, which raises the request's control slot once
/// the bytes are there. `size` is the target's own size, which a render scale below 1 leaves larger
/// than the corner the frame drew. `rows_from_bottom` is true on WebGL2, whose first stored row of
/// a target a render pass drew is the image's bottom row.
pub fn record_readback(
    list: &mut DrawList,
    request: &PickRequest,
    pixel: (u32, u32),
    size: (u32, u32),
    texture: u32,
    buffer: u32,
    rows_from_bottom: bool,
) -> Result<(), RecordError> {
    let y = if rows_from_bottom {
        size.1.saturating_sub(1).saturating_sub(pixel.1)
    } else {
        pixel.1
    };
    list.push(
        Op::CopyTextureToBuffer,
        &[texture, 0, pixel.0, y, 0, buffer, 0, READ_BYTES, 1, 1, 1],
    )?;
    list.push(
        Op::ReadBuffer,
        &[buffer, 0, 4, request.destination, request.slot],
    )?;
    Ok(())
}

/// The GPU objects that a frame builder keeps for picking: the pipeline of the resolve pass, the
/// bind group that reads the id target, and whether the ring's read buffers exist.
#[derive(Clone, Copy, Debug, Default)]
pub struct PickState {
    /// The id of the resolve pass's pipeline and the format it draws into, or `None`.
    pub resolve: Option<(u32, u32)>,
    /// The bind group that reads the id target, or 0 before a pick made one.
    pub group: u32,
    /// The texture that the group binds, or 0.
    pub bound: u32,
    /// True once the ring's read buffers exist.
    pub buffers_made: bool,
}

impl PickState {
    /// Forgets the GPU objects, so the next frame makes them again after the thread that draws
    /// replaced its device. The ring's buffers are created again too.
    pub fn reset_gpu(&mut self) {
        *self = Self {
            resolve: self.resolve,
            ..Self::default()
        };
    }
}

/// What the pick pass draws into: the id format, the scene depth's format and samples, and the
/// pass's permutation bits, which are the draw index where WebGL2 reads it.
pub fn targets(depth_format: u32, samples: u32, permutation: u32) -> PassTargets {
    PassTargets {
        color_format: FORMAT,
        depth_format,
        samples,
        permutation,
    }
}

/// The pipeline that finds a pair's pixels in the pick pass, and whether it binds the material's
/// maps. `custom_sways` is true for a custom material with a vertex offset, whose own template
/// has pick builds. `None` means the pair has no pick build, and the query must answer it another
/// way.
pub fn key_of(shading: DrawKey, custom_sways: bool, webgl2: bool) -> Option<(DrawKey, bool)> {
    // The faces match the shading pass, so the same pixels pass the depth test.
    let faces = shading.state & (state_flags::CULL_NONE | state_flags::CULL_FRONT);
    // WebGL2 draws where the fragment is nearer by the bias; WebGPU keeps only the pixels whose
    // depth is exactly the scene's.
    let (state, bias) = if webgl2 {
        (state_flags::NO_DEPTH_WRITE, WEBGL2_BIAS)
    } else {
        (
            state_flags::DEPTH_EQUAL | state_flags::NO_DEPTH_WRITE,
            DepthBias::NONE,
        )
    };
    if shading.template >= template::CUSTOM_FIRST {
        // The custom template's builds read their instances by index only where the pick builds
        // keep that bit, which they do not: such a pair keeps to a raycast.
        if !custom_sways || shading.permutation & permutation::INSTANCE_INDEX != 0 {
            return None;
        }
        // The custom template's pick build keeps the row values its vertex offset may read and its
        // skin, and writes the ids in the fragment stage.
        let pick = DrawKey {
            template: shading.template,
            permutation: (shading.permutation & (permutation::ROW_VALUES | permutation::SKIN))
                | permutation::PICK,
            vertex_format: shading.vertex_format,
            state: faces | state,
            bias,
        };
        return Some((pick, true));
    }
    // Only a mesh's template places its vertices as the pick template does. A sprite's, a line's
    // and a particle's expand their quads in their own vertex shaders, so they keep to a raycast.
    if !MESH_TEMPLATES.contains(&shading.template) {
        return None;
    }
    // The engine's mesh templates draw into the id target with the pick template's own builds.
    let pick = DrawKey {
        template: template::PICK,
        permutation: shading.permutation
            & (permutation::SKIN | permutation::INSTANCE_INDEX | permutation::MORPH),
        vertex_format: shading.vertex_format,
        state: faces | state,
        bias,
    };
    Some((pick, false))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shading(template: u32, state: u32, permutation: u32) -> DrawKey {
        DrawKey {
            template,
            permutation,
            vertex_format: 5,
            state,
            bias: DepthBias::from_polygon_offset(1.0, 2.0),
        }
    }

    #[test]
    fn an_engine_mesh_picks_with_the_pick_template_and_its_skin() {
        let pair = shading(
            template::INSTANCED_LIT,
            state_flags::CULL_NONE | state_flags::BLEND_NORMAL,
            permutation::SKIN | permutation::ALPHA_MASK | permutation::TONE_MAP,
        );
        let (key, maps) = key_of(pair, false, false).expect("an engine mesh picks");
        assert_eq!(key.template, template::PICK);
        assert_eq!(key.permutation, permutation::SKIN);
        assert_eq!(key.vertex_format, pair.vertex_format);
        assert_eq!(key.state & state_flags::CULL_NONE, state_flags::CULL_NONE);
        assert_eq!(key.state & state_flags::BLEND, 0);
        assert_ne!(key.state & state_flags::DEPTH_EQUAL, 0);
        assert_ne!(key.state & state_flags::NO_DEPTH_WRITE, 0);
        assert!(!maps, "the pick template reads no maps");
        assert_eq!(key.bias, DepthBias::NONE, "WebGPU needs no bias");
    }

    #[test]
    fn webgl2_keeps_the_near_surface_with_a_bias() {
        let pair = shading(template::INSTANCED_UNLIT, 0, 0);
        let (key, _) = key_of(pair, false, true).expect("an engine mesh picks");
        assert_eq!(key.state & state_flags::DEPTH_EQUAL, 0);
        assert_eq!(key.bias, WEBGL2_BIAS);
        assert!(key.bias.constant > 0, "toward the camera");
    }

    #[test]
    fn a_custom_material_with_a_vertex_offset_picks_with_its_own_template() {
        let pair = shading(
            template::CUSTOM_FIRST + 3,
            state_flags::CULL_FRONT,
            permutation::ROW_VALUES | permutation::ALPHA_MASK,
        );
        let (key, maps) = key_of(pair, true, false).expect("its pick builds exist");
        assert_eq!(key.template, pair.template);
        assert_eq!(key.permutation, permutation::ROW_VALUES | permutation::PICK);
        assert_eq!(key.state & state_flags::CULL_FRONT, state_flags::CULL_FRONT);
        assert!(maps, "the custom build still binds its maps");
    }

    #[test]
    fn a_custom_material_without_a_vertex_offset_has_no_pick_build() {
        let pair = shading(template::CUSTOM_FIRST + 1, 0, 0);
        assert_eq!(key_of(pair, false, false), None);
    }

    #[test]
    fn a_sprite_a_line_and_a_particle_have_no_pick_build() {
        for template in [
            template::SPRITE,
            template::SPRITE_MAP,
            template::LINE,
            template::LINE_LIT,
            template::PARTICLE,
            template::PARTICLE_MAP,
            template::DEBUG_VIEW,
        ] {
            let pair = shading(template, 0, 0);
            assert_eq!(key_of(pair, false, false), None, "template {template}");
        }
    }

    #[test]
    fn a_point_outside_the_target_names_no_pixel() {
        let request = PickRequest {
            x: 10.5,
            y: 4.5,
            ring: 0,
            slot: 0,
            destination: 0,
        };
        let scale = crate::graph::RenderScale::FULL;
        assert_eq!(pixel_of(&request, 2.0, scale, (40, 40)), (21, 9));
        assert_eq!(pixel_of(&request, 2.0, scale, (20, 20)), (19, 9));
        let half = crate::graph::RenderScale::from_thousandths(500);
        assert_eq!(pixel_of(&request, 2.0, half, (20, 20)), (10, 4));
        let outside = PickRequest { x: -1.0, ..request };
        assert_eq!(pixel_of(&outside, 2.0, scale, (40, 40)), (0, 9));
    }
}
