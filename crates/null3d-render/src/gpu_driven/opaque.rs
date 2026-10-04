//! The opaque passes: one scene pass per view, which replays the view's bundle. The bundle binds
//! the view's frame uniform and draws every bucket from the view's compacted instances with the
//! view's indirect draws, so the draws' first instance stays 0. It is recorded again only when the
//! layout or the mesh buffers change. The shadow passes record and replay their bundles the same
//! way (see [`super::shadow`]).
//!
//! With the depth prepass, each camera view has a second bundle, which the prepass replays before
//! the view's bundle in the same render pass. It draws the same buckets from the same compacted
//! instances and indirect draws, with each bucket's depth pipeline, and leaves out the buckets that
//! have none. It binds the view's frame uniform through a group of the depth template's layout.
//!
//! The outline view's bundle draws the outlined layout's buckets into the outline mask, twice: once
//! to mark every part of each object, then again to mark the parts that nothing hides. It binds
//! the outline view's frame uniform through a group of the depth template's layout too.

use null3d_gpu::drawlist::{
    DrawList, Op, buffer_usage as usage, index_format, layout as bind_layout, resource_kind, sizes,
};

use super::cull::INDIRECT_BYTES;
use super::ids;
use super::layout::{Bucket, Layout};
use super::skin::DrawGroups;
use crate::frame::{MeshBuffers, RecordError, UploadArena};
use crate::pipelines::PassTargets;
use crate::view::{ViewFrame, ViewId};

/// Records the creation of a view's frame uniform buffer.
pub(super) fn create_frame_buffer(list: &mut DrawList, view: ViewId) -> Result<(), RecordError> {
    list.push(
        Op::CreateBuffer,
        &[
            ids::frame(view),
            sizes::FRAME_UNIFORM_BYTES,
            usage::UNIFORM | usage::COPY_DST,
        ],
    )?;
    Ok(())
}

/// Records the creation of a camera view's frame group: its frame uniform, the material table,
/// the materials' custom values, three.js's table of the split-sum terms of specular light, the
/// main directional light's shadow map, which is `shadow_map`, with its comparison sampler and its
/// cascades, the camera's light grid and light records, and the shadow atlas of point and spot
/// lights, which is `atlas`, with its tiles, and the texture of ambient occlusion, `occlusion`. A
/// new shadow map, atlas or occlusion texture needs the group again.
pub(super) fn bind_frame(
    list: &mut DrawList,
    view: ViewId,
    shadow_map: u32,
    atlas: u32,
    occlusion: u32,
) -> Result<(), RecordError> {
    let entry = |binding: u32, kind: u32, id: u32| [binding, kind, id, 0, 0];
    let entries = [
        entry(0, resource_kind::BUFFER, ids::frame(view)),
        entry(1, resource_kind::BUFFER, ids::MATERIALS),
        entry(2, resource_kind::TEXTURE, ids::CUSTOM_VALUES),
        entry(3, resource_kind::TEXTURE, ids::DFG),
        entry(4, resource_kind::TEXTURE, shadow_map),
        entry(5, resource_kind::SAMPLER, ids::SHADOW_SAMPLER),
        entry(6, resource_kind::BUFFER, ids::SHADOWS),
        entry(7, resource_kind::BUFFER, ids::LIGHT_GRID),
        entry(8, resource_kind::BUFFER, ids::LIGHTS),
        entry(9, resource_kind::TEXTURE, atlas),
        entry(10, resource_kind::BUFFER, ids::SHADOW_TILES),
        entry(11, resource_kind::TEXTURE, occlusion),
    ];
    let mut words = [0u32; 3 + 5 * 12];
    words[..3].copy_from_slice(&[ids::frame_group(view), bind_layout::FRAME, 12]);
    words[3..].copy_from_slice(entries.as_flattened());
    list.push(Op::CreateBindGroup, &words)?;
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

/// What a view's bundle draws.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Bundle {
    /// The view's objects, each bucket with its pipeline and its material's maps.
    Opaque,
    /// The depth of the camera view's opaque objects, for the depth prepass.
    Prepass,
    /// The outline view's objects into the outline mask: every bucket with the pipeline that marks
    /// every part, then every bucket again with the pipeline that marks the parts nothing hides.
    Outline,
}

/// Records a view's bundle of `kind`: each draw of every bucket of the layout, with the bucket's
/// slice of the view's compacted instances and, where the bucket shades or its prepass draws with
/// its own vertex shader, the bind group of its material's map, from its mesh page's buffers in
/// `meshes`, into `targets`.
pub(super) fn record_bundle(
    list: &mut DrawList,
    view: ViewId,
    layout: &Layout,
    meshes: &MeshBuffers,
    targets: PassTargets,
    kind: Bundle,
) -> Result<(), RecordError> {
    let (bundle, frame_group) = if kind == Bundle::Prepass {
        (ids::prepass_bundle(view), ids::prepass_group(view))
    } else {
        (ids::bundle(view), ids::frame_group(view))
    };
    list.push(
        Op::BeginBundle,
        &[
            bundle,
            targets.color_format,
            targets.depth_format,
            targets.samples,
        ],
    )?;
    match kind {
        Bundle::Opaque => {
            draw_buckets(
                list,
                view,
                layout,
                meshes,
                frame_group,
                |b| b.pipeline,
                |_| true,
            )?;
        }
        Bundle::Prepass => {
            let pipeline = |b: &Bucket| b.prepass;
            draw_buckets(list, view, layout, meshes, frame_group, pipeline, |b| {
                b.prepass_own
            })?;
        }
        Bundle::Outline => {
            draw_buckets(
                list,
                view,
                layout,
                meshes,
                frame_group,
                |b| b.pipeline,
                |_| false,
            )?;
            draw_buckets(
                list,
                view,
                layout,
                meshes,
                frame_group,
                |b| b.prepass,
                |_| false,
            )?;
        }
    }
    list.push(Op::EndBundle, &[])?;
    Ok(())
}

/// Records the draws of every bucket of the layout with the pipeline that `pipeline_of` picks,
/// leaving out the buckets for which it gives 0. A bucket for which `own_of` is true draws with its
/// own template's vertex shader: it reads the view's frame group and its maps' group as its
/// shading does. The others read `frame_group` alone, as the depth and mask templates do.
#[allow(clippy::too_many_arguments)]
fn draw_buckets(
    list: &mut DrawList,
    view: ViewId,
    layout: &Layout,
    meshes: &MeshBuffers,
    frame_group: u32,
    pipeline_of: impl Fn(&Bucket) -> u32,
    own_of: impl Fn(&Bucket) -> bool,
) -> Result<(), RecordError> {
    let (mut pipeline, mut vertices, mut indices) = (None, None, None);
    let mut groups = DrawGroups::default();
    let mut bound = None;
    for bucket in &layout.buckets {
        let id = pipeline_of(bucket);
        if id == 0 {
            continue;
        }
        let own = own_of(bucket);
        let group = if own {
            ids::frame_group(view)
        } else {
            frame_group
        };
        if bound != Some(group) {
            list.push(Op::SetBindGroup, &[0, group, 0])?;
            bound = Some(group);
        }
        if pipeline != Some(id) {
            list.push(Op::SetPipeline, &[id])?;
            pipeline = Some(id);
        }
        let maps = if own { bucket.group } else { 0 };
        groups.set(list, maps, bucket.skins)?;
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
            let (page_vertices, page_indices) = meshes.ids(draw.page);
            // A skinned part draws its own region of skinned vertices with its page's indices.
            let source = draw.vertices.unwrap_or((page_vertices, 0));
            if vertices != Some(source) {
                list.push(Op::SetVertexBuffer, &[0, source.0, source.1, 0])?;
                vertices = Some(source);
            }
            if indices != Some(page_indices) {
                list.push(
                    Op::SetIndexBuffer,
                    &[page_indices, index_format::UINT16, 0, 0],
                )?;
                indices = Some(page_indices);
            }
            list.push(
                Op::DrawIndexedIndirect,
                &[ids::indirect(view), index * INDIRECT_BYTES],
            )?;
        }
    }
    Ok(())
}

/// Records a view's pass: its bundle, or with `prepass` its bundle of the depth prepass, inside
/// the render pass that the render graph began.
pub(super) fn record(list: &mut DrawList, view: ViewId, prepass: bool) -> Result<(), RecordError> {
    let bundle = if prepass {
        ids::prepass_bundle(view)
    } else {
        ids::bundle(view)
    };
    list.push(Op::ExecuteBundles, &[1, bundle])?;
    Ok(())
}
