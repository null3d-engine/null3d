//! The shadow passes: one depth-only pass per cascade of the main directional light, which replays
//! the cascade's bundle into its layer of the shadow map. A cascade is a view of its own (see
//! [`crate::view::ViewId::cascade`]). It culls the casters' layout with its own frustum into its
//! own compacted instances and indirect draws, as a camera's view culls the scene's, and binds a
//! frame group without the shadow map, so it never reads the texture it draws into.
//!
//! The cascades' uniform block and the shadow map's sampler, which receivers read beside the map,
//! are the shared module's (see [`crate::shadows`]).

use null3d_gpu::drawlist::{DrawList, Op, layout as bind_layout, resource_kind};

use super::ids;
use crate::frame::RecordError;
use crate::view::ViewId;

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
