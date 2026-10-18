//! The opaque passes: one scene pass per view, which replays the view's bundle. The bundle binds
//! the view's frame uniform and draws every bucket from the view's compacted instances with the
//! view's indirect draws, so the draws' first instance stays 0. It is recorded again only when the
//! layout or the mesh buffers change. The shadow passes record and replay their bundles the same
//! way (see [`super::shadow`]).
//!
//! A bucket whose pipelines read their instances by index draws its slice of index entries, which
//! follow the copies in the view's compacted instance buffer, and binds the view's index group
//! after its other groups (see [`super::cull`]).
//!
//! With the depth prepass, each camera view has a second bundle, which the prepass replays before
//! the view's bundle in the same render pass. It draws the same buckets from the same compacted
//! instances and indirect draws, with each bucket's depth pipeline, and leaves out the buckets that
//! have none. It binds the view's frame uniform through a group of the depth template's layout.
//!
//! A camera view that culls in two phases replays the depth bundle in its occluders' pass, a render
//! pass of its own with no color target, from the first set of indirect draws. Its bundle then
//! draws from the second set, which follows the first in the view's indirect buffer.
//!
//! The outline view's bundle draws the outlined layout's buckets into the outline mask, twice: once
//! to mark every part of each object, then again to mark the parts that nothing hides. It binds
//! the outline view's frame uniform through a group of the depth template's layout too.
//!
//! The subsurface view's bundle draws the subsurface layout's buckets into the skin pass's target,
//! with the skin pass's pipelines. They shade with the camera's lights, so the bundle binds the
//! camera view's frame group, and its own compacted instances and indirect draws.

use null3d_gpu::drawlist::{
    DrawList, Op, buffer_usage as usage, index_format, layout as bind_layout, resource_kind, sizes,
};

use super::cull::INDIRECT_BYTES;
use super::ids;
use super::layout::{Bucket, Layout};
use super::skin::DrawGroups;
use crate::environment;
use crate::frame::{MeshBuffers, RecordError, UploadArena};
use crate::frame_data::FrameUniform;
use crate::pipelines::PassTargets;
use crate::probe_grid;
use crate::transmission;
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

/// The binding of the row values texture in the frame group and in the depth template's group,
/// which only vertex shaders read.
pub(super) const ROW_VALUES_BINDING: u32 = 16;

/// The binding of the table of object ranges in the frame group and in the depth template's group,
/// as the mesh shaders declare it.
pub(super) const OBJECT_RANGES_BINDING: u32 = 17;

/// What a view's frame group binds besides the objects that every view shares: the light grid and
/// light records of view `lights`, the view's own once they exist, the camera's before, the main
/// directional light's shadow map, the shadow atlas of point and spot lights, the texture of
/// ambient occlusion, the environment's cube texture, the light probe grids' 3D texture, and the
/// copy of the opaque color that surfaces which let light through sample.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct FrameInputs {
    pub lights: ViewId,
    pub shadow_map: u32,
    pub atlas: u32,
    pub occlusion: u32,
    pub environment: u32,
    pub probe_grid: u32,
    pub transmission: u32,
}

/// The entries of a frame group, before the environment's.
const FRAME_ENTRIES: usize = 16;

/// Records the creation of a camera view's frame group: its frame uniform, the material table,
/// the materials' custom values, the light tables, the shadow map with its cascades and the
/// sampler that reads four of its texels at once, the light grid and light records, the shadow
/// atlas with its comparison sampler and its tiles, the texture of ambient occlusion, the
/// environment's cube texture with its sampler, the light probe grids' texture, the copy of the
/// opaque color, which the environment's sampler reads too, and the row values of instance
/// batches and the table of object ranges. A new shadow map, atlas, occlusion texture,
/// environment, grid, copy, row values texture or light buffers needs the group again.
pub(super) fn bind_frame(
    list: &mut DrawList,
    view: ViewId,
    inputs: &FrameInputs,
) -> Result<(), RecordError> {
    let group = ids::frame_group(view);
    push_frame_group(list, group, bind_layout::FRAME, view, inputs, |_| true)
}

/// Records the creation of the decal pass's frame group: the camera's frame group without the
/// light probe grids' texture, which no decal build reads, so that a decal with maps stays within
/// WebGPU's default count of sampled textures per stage. It carries the copy of the opaque color,
/// which the reflections' lit code reads in every lit build, decals included.
pub(super) fn bind_decal_frame(
    list: &mut DrawList,
    inputs: &FrameInputs,
) -> Result<(), RecordError> {
    let (group, layout) = (ids::DECAL_FRAME_GROUP, bind_layout::DECAL_FRAME);
    push_frame_group(list, group, layout, ViewId::CAMERA, inputs, |binding| {
        binding != probe_grid::MAP_BINDING
    })
}

/// Records the creation of frame group `group` of `layout` for `view`, with the entries whose
/// binding `keeps` takes.
fn push_frame_group(
    list: &mut DrawList,
    group: u32,
    layout: u32,
    view: ViewId,
    inputs: &FrameInputs,
    keeps: impl Fn(u32) -> bool,
) -> Result<(), RecordError> {
    let entry = |binding: u32, kind: u32, id: u32| [binding, kind, id, 0, 0];
    let entries: [[u32; 5]; FRAME_ENTRIES] = [
        entry(0, resource_kind::BUFFER, ids::frame(view)),
        entry(1, resource_kind::BUFFER, ids::MATERIALS),
        entry(2, resource_kind::TEXTURE, ids::CUSTOM_VALUES),
        entry(3, resource_kind::TEXTURE, ids::LIGHT_TABLES),
        entry(4, resource_kind::TEXTURE, inputs.shadow_map),
        entry(5, resource_kind::SAMPLER, ids::SHADOW_SAMPLER),
        entry(6, resource_kind::BUFFER, ids::SHADOWS),
        entry(7, resource_kind::BUFFER, ids::light_grid(inputs.lights)),
        entry(8, resource_kind::BUFFER, ids::lights(inputs.lights)),
        entry(9, resource_kind::TEXTURE, inputs.atlas),
        entry(
            probe_grid::MAP_BINDING,
            resource_kind::TEXTURE,
            inputs.probe_grid,
        ),
        entry(11, resource_kind::TEXTURE, inputs.occlusion),
        entry(14, resource_kind::SAMPLER, ids::SHADOW_TEXEL_SAMPLER),
        entry(
            transmission::BINDING,
            resource_kind::TEXTURE,
            inputs.transmission,
        ),
        entry(ROW_VALUES_BINDING, resource_kind::TEXTURE, ids::ROW_VALUES),
        entry(
            OBJECT_RANGES_BINDING,
            resource_kind::BUFFER,
            ids::OBJECT_RANGES,
        ),
    ];
    let mut words = [0u32; 3 + 5 * FRAME_ENTRIES + environment::ENTRY_WORDS];
    let mut end = 3;
    for entry in entries.iter().filter(|entry| keeps(entry[0])) {
        words[end..end + 5].copy_from_slice(entry);
        end += 5;
    }
    words[end..end + environment::ENTRY_WORDS].copy_from_slice(&environment::entries(
        inputs.environment,
        ids::ENVIRONMENT_SAMPLER,
    ));
    end += environment::ENTRY_WORDS;
    let count = ((end - 3) / 5) as u32;
    words[..3].copy_from_slice(&[group, layout, count]);
    list.push(Op::CreateBindGroup, &words[..end])?;
    Ok(())
}

/// Uploads a view's frame uniform.
pub(super) fn upload(
    list: &mut DrawList,
    arena: &mut UploadArena,
    view: ViewId,
    frame: &ViewFrame,
) -> Result<(), RecordError> {
    let (at, bytes) =
        arena.push_masked(frame.uniform.as_bytes(), &FrameUniform::volatile_ranges())?;
    list.push(Op::WriteBuffer, &[ids::frame(view), 0, at, bytes])?;
    Ok(())
}

/// What a view's bundle draws.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Bundle {
    /// The view's objects, each bucket with its pipeline and its material's maps: a camera view's
    /// opaque pass, or a shadow pass.
    Opaque,
    /// The depth of the camera view's opaque objects, for the depth prepass or the occluders' pass.
    Prepass,
    /// The outline view's objects into the outline mask: every bucket with the pipeline that marks
    /// every part, then every bucket again with the pipeline that marks the parts nothing hides.
    Outline,
    /// The casters' depth into a tile of the shadow atlas, each bucket with its pipeline for the
    /// tiles, whose depth format may differ from the cascades'.
    Tile,
    /// The subsurface view's objects into the skin pass's target, each bucket with its skin pass
    /// pipeline and its material's maps, lit through the camera view's frame group.
    Subsurface,
}

impl Bundle {
    fn id(self, view: ViewId) -> u32 {
        match self {
            Self::Opaque | Self::Outline | Self::Tile | Self::Subsurface => ids::bundle(view),
            Self::Prepass => ids::prepass_bundle(view),
        }
    }
}

/// Records a view's bundle of `kind`: each draw of every bucket of the layout, with the bucket's
/// slice of the view's compacted instances and, where the bucket shades or its prepass draws with
/// its own vertex shader, the bind group of its material's map, from its mesh page's buffers in
/// `meshes`, into `targets`. Its draws start `first_draw` draws into the view's indirect buffer.
/// It leaves out each bucket whose maps' group `hidden` names: a group that binds a target that
/// the view draws into, or one that it does not read.
#[allow(clippy::too_many_arguments)]
pub(super) fn record_bundle(
    list: &mut DrawList,
    view: ViewId,
    layout: &Layout,
    meshes: &MeshBuffers,
    targets: PassTargets,
    kind: Bundle,
    first_draw: u32,
    hidden: &dyn Fn(u32) -> bool,
) -> Result<(), RecordError> {
    let frame_group = match kind {
        Bundle::Prepass => ids::prepass_group(view),
        Bundle::Subsurface => ids::frame_group(ViewId::CAMERA),
        _ => ids::frame_group(view),
    };
    let shading_group = match kind {
        Bundle::Subsurface => frame_group,
        _ => ids::frame_group(view),
    };
    list.push(
        Op::BeginBundle,
        &[
            kind.id(view),
            targets.color_format,
            targets.depth_format,
            targets.samples,
        ],
    )?;
    let draws = Draws {
        view,
        layout,
        meshes,
        frame_group,
        shading_group,
        first_draw,
        hidden,
        counts: None,
    };
    match kind {
        Bundle::Opaque | Bundle::Subsurface => draws.record(list, |b| b.pipeline, |_| true)?,
        Bundle::Prepass => draws.record(list, |b| b.prepass, |b| b.prepass_own)?,
        Bundle::Tile => draws.record(list, |b| b.prepass, |_| true)?,
        Bundle::Outline => {
            draws.record(list, |b| b.pipeline, |_| false)?;
            draws.record(list, |b| b.prepass, |_| false)?;
        }
    }
    list.push(Op::EndBundle, &[])?;
    Ok(())
}

/// Records a view's pass on the direct-draw path: the buckets of `kind`, each with the instance
/// count that the CPU culling gave it, from `meshes` into the pass that the render graph began.
/// No bundle holds them: a bundle's draws keep the counts they were recorded with, and a direct
/// draw's count changes every frame. `counts` holds each bucket's count, in the layout's bucket
/// order.
pub(super) fn record_direct(
    list: &mut DrawList,
    view: ViewId,
    layout: &Layout,
    meshes: &MeshBuffers,
    kind: Bundle,
    counts: &[u32],
    hidden: &dyn Fn(u32) -> bool,
) -> Result<(), RecordError> {
    let frame_group = match kind {
        Bundle::Prepass => ids::prepass_group(view),
        Bundle::Subsurface => ids::frame_group(ViewId::CAMERA),
        _ => ids::frame_group(view),
    };
    let shading_group = match kind {
        Bundle::Subsurface => frame_group,
        _ => ids::frame_group(view),
    };
    let draws = Draws {
        view,
        layout,
        meshes,
        frame_group,
        shading_group,
        first_draw: 0,
        hidden,
        counts: Some(counts),
    };
    match kind {
        Bundle::Opaque | Bundle::Subsurface => draws.record(list, |b| b.pipeline, |_| true)?,
        Bundle::Prepass => draws.record(list, |b| b.prepass, |b| b.prepass_own)?,
        Bundle::Tile => draws.record(list, |b| b.prepass, |_| true)?,
        Bundle::Outline => {
            draws.record(list, |b| b.pipeline, |_| false)?;
            draws.record(list, |b| b.prepass, |_| false)?;
        }
    }
    Ok(())
}

/// What a bundle's buckets draw from: the view, its layout and the mesh pages' buffers, the
/// group that the depth and mask templates read, the group that shading reads, the first of the
/// view's indirect draws, and, on the direct-draw path, each bucket's instance count.
struct Draws<'a> {
    view: ViewId,
    layout: &'a Layout,
    meshes: &'a MeshBuffers,
    frame_group: u32,
    shading_group: u32,
    first_draw: u32,
    hidden: &'a dyn Fn(u32) -> bool,
    counts: Option<&'a [u32]>,
}

impl Draws<'_> {
    /// Records the draws of every bucket of the layout with the pipeline that `pipeline_of` picks,
    /// leaving out the buckets for which it gives 0. A bucket for which `own_of` is true draws with
    /// its own template's vertex shader: it reads the view's frame group and its maps' group as its
    /// shading does. The others read the depth group alone, as the depth and mask templates do.
    fn record(
        &self,
        list: &mut DrawList,
        pipeline_of: impl Fn(&Bucket) -> u32,
        own_of: impl Fn(&Bucket) -> bool,
    ) -> Result<(), RecordError> {
        let Self {
            view,
            layout,
            meshes,
            frame_group,
            shading_group,
            first_draw,
            hidden,
            counts,
        } = *self;
        let (mut pipeline, mut vertices, mut indices) = (None, None, None);
        let mut groups = DrawGroups::default();
        let mut bound = None;
        for (b, bucket) in layout.buckets.iter().enumerate() {
            let id = pipeline_of(bucket);
            if id == 0 || (bucket.group != 0 && hidden(bucket.group)) {
                continue;
            }
            let own = own_of(bucket);
            let group = if own { shading_group } else { frame_group };
            if bound != Some(group) {
                list.push(Op::SetBindGroup, &[0, group, 0])?;
                bound = Some(group);
            }
            if pipeline != Some(id) {
                list.push(Op::SetPipeline, &[id])?;
                pipeline = Some(id);
            }
            let maps = if own { bucket.group } else { 0 };
            let (stride, index) = if bucket.indexed {
                (sizes::INDEX_STRIDE, ids::index_group(view))
            } else {
                (sizes::INSTANCE_STRIDE, 0)
            };
            groups.set(list, maps, bucket.skins, index)?;
            list.push(
                Op::SetVertexBuffer,
                &[
                    1,
                    ids::visible(view),
                    bucket.base * stride,
                    bucket.capacity.max(1) * stride,
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
                match counts {
                    Some(counts) => {
                        let instances = counts.get(b).copied().unwrap_or(0);
                        list.push(
                            Op::DrawIndexed,
                            &[
                                draw.index_count,
                                instances,
                                draw.first_index,
                                draw.base_vertex,
                                0,
                            ],
                        )?;
                    }
                    None => list.push(
                        Op::DrawIndexedIndirect,
                        &[ids::indirect(view), (first_draw + index) * INDIRECT_BYTES],
                    )?,
                }
            }
        }
        Ok(())
    }
}

/// Records a view's pass, which replays one of its bundles inside the render pass that the
/// render graph began.
pub(super) fn record(list: &mut DrawList, view: ViewId, bundle: Bundle) -> Result<(), RecordError> {
    list.push(Op::ExecuteBundles, &[1, bundle.id(view)])?;
    Ok(())
}
