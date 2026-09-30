//! The shadow passes: one depth-only pass per cascade of the main directional light, which replays
//! the cascade's bundle into its layer of the shadow map. A cascade is a view of its own (see
//! [`crate::view::ViewId::cascade`]). It culls the casters' layout with its own frustum into its
//! own compacted instances and indirect draws, as a camera's view culls the scene's, and binds a
//! frame group without the shadow map, so it never reads the texture it draws into.
//!
//! The cascades' uniform block, which receivers read beside the shadow map, uploads once a frame.

use null3d_gpu::drawlist::{
    DrawList, Op, address, buffer_usage as usage, compare, filter, format, layout as bind_layout,
    resource_kind, sizes,
};

use super::ids;
use crate::frame::{RecordError, UploadArena};
use crate::pipelines::PassTargets;
use crate::shadows::ShadowFrame;
use crate::view::ViewId;

/// What the shadow passes draw into: a depth texture of one sample, with no color.
pub(super) const TARGETS: PassTargets = PassTargets {
    color_format: format::NONE,
    depth_format: format::DEPTH32_FLOAT,
    samples: 1,
    permutation: 0,
};

/// Records the creation of the cascades' uniform block and of the comparison sampler that reads the
/// shadow map, which every camera view's frame group binds.
pub(super) fn create_fixed(list: &mut DrawList) -> Result<(), RecordError> {
    list.push(
        Op::CreateBuffer,
        &[
            ids::SHADOWS,
            sizes::SHADOW_UNIFORM_BYTES,
            usage::UNIFORM | usage::COPY_DST,
        ],
    )?;
    // Reversed depth: a point is lit where its depth is at least the caster's, nearer the light.
    // The linear filters blend the comparisons of the four nearest texels.
    let clamp = address::CLAMP_TO_EDGE;
    list.push(
        Op::CreateSampler,
        &[
            ids::SHADOW_SAMPLER,
            clamp,
            clamp,
            clamp,
            filter::LINEAR,
            filter::LINEAR,
            filter::NEAREST,
            0f32.to_bits(),
            0f32.to_bits(),
            compare::GREATER_EQUAL,
            1,
        ],
    )?;
    Ok(())
}

/// Records the creation of a cascade's frame uniform buffer, and of its frame group, which binds
/// the buffer with the material table.
pub(super) fn create_view(list: &mut DrawList, view: ViewId) -> Result<(), RecordError> {
    super::opaque::create_frame_buffer(list, view)?;
    list.push(
        Op::CreateBindGroup,
        &[
            ids::frame_group(view),
            bind_layout::DEPTH,
            2,
            0,
            resource_kind::BUFFER,
            ids::frame(view),
            0,
            0,
            1,
            resource_kind::BUFFER,
            ids::MATERIALS,
            0,
            0,
        ],
    )?;
    Ok(())
}

/// Uploads the cascades' uniform block for the frame.
pub(super) fn upload(
    list: &mut DrawList,
    arena: &mut UploadArena,
    shadow: &ShadowFrame,
) -> Result<(), RecordError> {
    let (at, bytes) = arena.push(shadow.uniform().as_bytes())?;
    list.push(Op::WriteBuffer, &[ids::SHADOWS, 0, at, bytes])?;
    Ok(())
}
