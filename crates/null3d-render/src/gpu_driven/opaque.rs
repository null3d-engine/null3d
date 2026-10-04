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

use null3d_gpu::drawlist::{
    DrawList, Op, buffer_usage as usage, index_format, layout as bind_layout, resource_kind, sizes,
};

use super::cull::INDIRECT_BYTES;
use super::ids;
use super::layout::Layout;
use super::skin::DrawGroups;
use crate::environment;
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
/// cascades, the camera's light grid and light records, the shadow atlas of point and spot
/// lights, which is `atlas`, with its tiles, the texture of ambient occlusion, `occlusion`, and the
/// environment's cube texture, which is `environment`, with its sampler. A new shadow map, atlas,
/// occlusion texture or environment needs the group again.
pub(super) fn bind_frame(
    list: &mut DrawList,
    view: ViewId,
    shadow_map: u32,
    atlas: u32,
    occlusion: u32,
    environment: u32,
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
    let mut words = [0u32; 3 + 5 * 12 + environment::ENTRY_WORDS];
    words[..3].copy_from_slice(&[ids::frame_group(view), bind_layout::FRAME, 14]);
    words[3..3 + 5 * 12].copy_from_slice(entries.as_flattened());
    words[3 + 5 * 12..]
        .copy_from_slice(&environment::entries(environment, ids::ENVIRONMENT_SAMPLER));
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

/// Words of a bundle's own commands: its start, its view's frame group and its end.
const BUNDLE_WORDS: usize = 5 + 4 + 1;
/// The most words that a bucket adds before its draws: its pipeline, its maps' group and the joint
/// texture's, and its slice of the view's instances.
const BUCKET_WORDS: usize = 2 + 4 + 4 + 5;
/// The most words that a draw adds: its vertex buffer, its index buffer and the draw.
const DRAW_WORDS: usize = 5 + 5 + 3;

/// The most words that a bundle of `layout` records. Each skinned object draws from a bucket of
/// its own, so a crowd's bundles grow with it.
pub(super) fn bundle_words(layout: &Layout) -> usize {
    BUNDLE_WORDS + layout.buckets.len() * BUCKET_WORDS + layout.draws.len() * DRAW_WORDS
}

/// Records a view's bundle: each draw of every bucket of the layout, with the bucket's slice of
/// the view's compacted instances and the bind group of its material's map, from its mesh page's
/// buffers in `meshes`, into `targets`. With `prepass`, it records the view's bundle of the depth
/// prepass instead.
pub(super) fn record_bundle(
    list: &mut DrawList,
    view: ViewId,
    layout: &Layout,
    meshes: &MeshBuffers,
    targets: PassTargets,
    prepass: bool,
) -> Result<(), RecordError> {
    let (bundle, frame_group) = if prepass {
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
    let (mut pipeline, mut vertices, mut indices) = (None, None, None);
    let mut groups = DrawGroups::default();
    let mut bound = None;
    for bucket in &layout.buckets {
        let id = if prepass {
            bucket.prepass
        } else {
            bucket.pipeline
        };
        if id == 0 {
            continue;
        }
        // In the prepass, a pair that draws with its own vertex shader reads the frame group and
        // its maps' group as its shading does, and the depth template reads the depth group.
        let own = !prepass || bucket.prepass_own;
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
    list.push(Op::EndBundle, &[])?;
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
