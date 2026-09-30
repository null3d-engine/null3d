//! The opaque passes: one scene pass per view, which replays the view's bundle. The bundle binds
//! the view's frame uniform and draws every bucket from the view's compacted instances with the
//! view's indirect draws, so the draws' first instance stays 0. It is recorded again only when the
//! layout or the mesh buffers change.

use null3d_gpu::drawlist::{
    DrawList, Op, buffer_usage as usage, index_format, layout as bind_layout, resource_kind, sizes,
};

use super::cull::INDIRECT_BYTES;
use super::ids;
use super::layout::Layout;
use crate::frame::{MeshBuffers, RecordError, UploadArena};
use crate::frame_graph::{COLOR_FORMAT, DEPTH_FORMAT};
use crate::view::{ViewFrame, ViewId};

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

/// Records a view's bundle: each draw of every bucket of the layout, with the bucket's slice of
/// the view's compacted instances, from its mesh page's buffers in `meshes`, into targets with
/// `samples` samples.
pub(super) fn record_bundle(
    list: &mut DrawList,
    view: ViewId,
    layout: &Layout,
    meshes: &MeshBuffers,
    samples: u32,
) -> Result<(), RecordError> {
    list.push(
        Op::BeginBundle,
        &[ids::bundle(view), COLOR_FORMAT, DEPTH_FORMAT, samples],
    )?;
    list.push(Op::SetBindGroup, &[0, ids::frame_group(view), 0])?;
    let (mut pipeline, mut page) = (None, None);
    for bucket in &layout.buckets {
        if pipeline != Some(bucket.pipeline) {
            list.push(Op::SetPipeline, &[bucket.pipeline])?;
            pipeline = Some(bucket.pipeline);
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
        for index in bucket.first_draw..bucket.first_draw + bucket.draws {
            let draw = layout.draws[index as usize];
            if page != Some(draw.page) {
                let (vertices, indices) = meshes.ids(draw.page);
                list.push(Op::SetVertexBuffer, &[0, vertices, 0, 0])?;
                list.push(Op::SetIndexBuffer, &[indices, index_format::UINT16, 0, 0])?;
                page = Some(draw.page);
            }
            list.push(
                Op::DrawIndexedIndirect,
                &[ids::indirect(view), index * INDIRECT_BYTES],
            )?;
        }
    }
    list.push(Op::EndBundle, &[])?;
    Ok(())
}

/// Records a view's opaque pass: its bundle, inside the render pass that the render graph began.
pub(super) fn record(list: &mut DrawList, view: ViewId) -> Result<(), RecordError> {
    list.push(Op::ExecuteBundles, &[1, ids::bundle(view)])?;
    Ok(())
}
