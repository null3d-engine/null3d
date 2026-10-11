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
use super::opaque::ROW_VALUES_BINDING;
use crate::frame::RecordError;
use crate::view::ViewId;

/// Records the creation of a cascade's frame uniform buffer, and of its frame group.
pub(super) fn create_view(list: &mut DrawList, view: ViewId) -> Result<(), RecordError> {
    super::opaque::create_frame_buffer(list, view)?;
    bind_depth(list, ids::frame_group(view), view)
}

/// Records the creation of bind group `group` of the depth template, which binds a view's frame
/// uniform buffer with the material table, and for the vertex shaders of custom materials' shadow
/// casters, the materials' custom values and the row values of instance batches: a cascade's or a
/// tile's frame group, the outline view's, or the group of a camera view's depth prepass. A new
/// row values texture needs it again.
pub(super) fn bind_depth(list: &mut DrawList, group: u32, view: ViewId) -> Result<(), RecordError> {
    let entry = |binding: u32, kind: u32, id: u32| [binding, kind, id, 0, 0];
    let entries = [
        entry(0, resource_kind::BUFFER, ids::frame(view)),
        entry(1, resource_kind::BUFFER, ids::MATERIALS),
        entry(2, resource_kind::TEXTURE, ids::CUSTOM_VALUES),
        entry(ROW_VALUES_BINDING, resource_kind::TEXTURE, ids::ROW_VALUES),
    ];
    let mut words = [0u32; 3 + 5 * 4];
    words[..3].copy_from_slice(&[group, bind_layout::DEPTH, entries.len() as u32]);
    words[3..].copy_from_slice(entries.as_flattened());
    list.push(Op::CreateBindGroup, &words)?;
    Ok(())
}
