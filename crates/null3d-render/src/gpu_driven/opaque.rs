//! The opaque passes: one scene pass per view, which replays the view's bundle. The bundle binds
//! the view's frame uniform and draws every bucket from the view's compacted instances with the
//! view's indirect draws, so the draws' first instance stays 0. It is recorded again only when the
//! layout changes.

use null3d_gpu::drawlist::{
    DrawList, Op, buffer_usage as usage, index_format, layout as bind_layout, resource_kind, sizes,
    template,
};

use super::cull::INDIRECT_BYTES;
use super::ids;
use super::layout::Layout;
use crate::frame::{RecordError, UploadArena};
use crate::frame_graph::SceneTargets;
use crate::materials::Shading;
use crate::view::{ViewFrame, ViewId};

/// Records the creation of the render pipelines, which draw into the scene's color and depth
/// targets.
pub(super) fn create_pipelines(
    list: &mut DrawList,
    targets: SceneTargets,
) -> Result<(), RecordError> {
    targets.create_pipeline(list, ids::LIT, template::INSTANCED_LIT, 0)?;
    targets.create_pipeline(list, ids::UNLIT, template::INSTANCED_UNLIT, 0)
}

/// Records the creation of a view's frame uniform buffer, and of the group that binds it with the
/// material table.
pub(super) fn create_view(list: &mut DrawList, view: ViewId) -> Result<(), RecordError> {
    list.push(
        Op::CreateBuffer,
        &[
            ids::frame(view),
            sizes::FRAME_UNIFORM_BYTES,
            usage::UNIFORM | usage::COPY_DST,
        ],
    )?;
    list.push(
        Op::CreateBindGroup,
        &[
            ids::frame_group(view),
            bind_layout::FRAME,
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

/// Uploads a view's frame uniform.
pub(super) fn upload(
    list: &mut DrawList,
    arena: &mut UploadArena,
    view: ViewId,
    frame: &ViewFrame,
) -> Result<(), RecordError> {
    let (at, bytes) = arena.push(frame.uniform.as_bytes())?;
    list.push(Op::WriteBuffer, &[ids::frame(view), 0, at, bytes])?;
    Ok(())
}

/// Records a view's bundle: every bucket of the layout, drawn from the view's compacted instances
/// with its indirect draws, into the scene's targets.
pub(super) fn record_bundle(
    list: &mut DrawList,
    view: ViewId,
    layout: &Layout,
    targets: SceneTargets,
) -> Result<(), RecordError> {
    list.push(
        Op::BeginBundle,
        &[
            ids::bundle(view),
            targets.color,
            targets.depth,
            targets.samples,
        ],
    )?;
    list.push(Op::SetBindGroup, &[0, ids::frame_group(view), 0])?;
    list.push(Op::SetVertexBuffer, &[0, ids::VERTICES, 0, 0])?;
    list.push(
        Op::SetIndexBuffer,
        &[ids::INDICES, index_format::UINT16, 0, 0],
    )?;
    let mut pipeline = None;
    for (index, bucket) in layout.buckets.iter().enumerate() {
        let wanted = match bucket.shading {
            Shading::Lit => ids::LIT,
            Shading::Unlit => ids::UNLIT,
        };
        if pipeline != Some(wanted) {
            list.push(Op::SetPipeline, &[wanted])?;
            pipeline = Some(wanted);
        }
        list.push(
            Op::SetVertexBuffer,
            &[
                1,
                ids::visible(view),
                bucket.base * sizes::INSTANCE_STRIDE,
                bucket.capacity.max(1) * sizes::INSTANCE_STRIDE,
            ],
        )?;
        list.push(
            Op::DrawIndexedIndirect,
            &[ids::indirect(view), index as u32 * INDIRECT_BYTES],
        )?;
    }
    list.push(Op::EndBundle, &[])?;
    Ok(())
}

/// Records a view's opaque pass: its bundle, inside the render pass that the render graph began.
pub(super) fn record(list: &mut DrawList, view: ViewId) -> Result<(), RecordError> {
    list.push(Op::ExecuteBundles, &[1, ids::bundle(view)])?;
    Ok(())
}
