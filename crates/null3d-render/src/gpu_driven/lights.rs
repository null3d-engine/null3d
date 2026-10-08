//! The point and spot lights of each camera view: the light grid's words and light records in two
//! storage buffers that fragment shaders read, which the view's frame group binds. With the
//! material table, the buffers take three of the four storage buffers that fragment shaders may
//! read in WebGPU's compatibility mode. The camera's view has its buffers from the start; any other
//! camera view gets its own when its grid is made, on the first frame that it sees a light, and
//! binds the camera's until then, which it never reads, as its grid lists no light.
//!
//! The GPU lists each cluster's lights itself (see [`crate::light_grid::ClusterParams`]). Each
//! frame whose lights or view changed uploads the view's light list and the parameters of the
//! light clustering passes, and in each frame with lights the light clustering pass, before every
//! other pass, fills each view's grid with three dispatches. The pass runs in frames that upload
//! nothing too, because the thread that draws skips the dispatches of pipelines that it is still
//! building: the grid then fills in the first frame after they are built.

use null3d_gpu::drawlist::{
    DrawList, Op, buffer_usage as usage, layout as bind_layout, resource_kind, sizes, template,
};

use super::ids;
use crate::frame::{RecordError, UploadArena};
use crate::light_grid::{CLUSTER_PARAMS_BYTES, LightGrids, ViewLights};
use crate::view::{MAX_VIEWS, ViewId};

/// The compute pipelines of the light clustering pass, in the order the pass dispatches them.
const PIPELINES: [(u32, u32); 3] = [
    (ids::LIGHT_COUNT, template::LIGHT_COUNT),
    (ids::LIGHT_PLACE, template::LIGHT_PLACE),
    (ids::LIGHT_WRITE, template::LIGHT_WRITE),
];

/// Records the creation of the light clustering pass's compute pipelines.
pub(super) fn create_pipelines(list: &mut DrawList) -> Result<(), RecordError> {
    for (id, template) in PIPELINES {
        list.push(Op::CreateComputePipeline, &[id, template, 0])?;
    }
    Ok(())
}

/// Records the creation of camera view `view`'s two buffers, as large as its grid `lights` can
/// fill, of the parameters of its light clustering dispatches, and of their bind group.
pub(super) fn create(
    list: &mut DrawList,
    view: ViewId,
    lights: &ViewLights,
) -> Result<(), RecordError> {
    let grid = lights.grid();
    let buffers = [
        (
            ids::light_params(view),
            CLUSTER_PARAMS_BYTES,
            usage::UNIFORM | usage::COPY_DST,
        ),
        (
            ids::lights(view),
            grid.limits().lights.max(1) * sizes::LIGHT_RECORD_BYTES,
            usage::STORAGE | usage::COPY_DST,
        ),
        (ids::light_grid(view), grid.max_words() * 4, usage::STORAGE),
    ];
    for &(id, size, flags) in &buffers {
        list.push(Op::CreateBuffer, &[id, size, flags])?;
    }
    let mut entries = [0u32; 3 + 3 * 5];
    entries[..3].copy_from_slice(&[ids::light_group(view), bind_layout::LIGHT_CLUSTERS, 3]);
    for (binding, &(buffer, _, _)) in buffers.iter().enumerate() {
        let at = 3 + binding * 5;
        entries[at..at + 5].copy_from_slice(&[binding as u32, resource_kind::BUFFER, buffer, 0, 0]);
    }
    list.push(Op::CreateBindGroup, &entries)?;
    Ok(())
}

/// The light clustering pass: the views whose grids the frame being recorded fills.
#[derive(Debug)]
pub(super) struct LightClusters {
    /// The workgroups of each camera view's counting and writing dispatches, or `None` for a view
    /// whose grid lists no light in the frame.
    workgroups: [Option<[u32; 3]>; MAX_VIEWS],
}

impl Default for LightClusters {
    fn default() -> Self {
        Self {
            workgroups: [None; MAX_VIEWS],
        }
    }
}

impl LightClusters {
    /// Uploads each grid's light list and the parameters of its dispatches when they differ from
    /// what its buffers hold, and has the pass fill each grid that lists lights in the frame. A
    /// view whose GPU objects are not made yet, outside `made`, a mask of camera views, waits.
    pub(super) fn upload(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        grids: &mut LightGrids,
        made: u32,
    ) -> Result<(), RecordError> {
        self.workgroups = [None; MAX_VIEWS];
        for (view, lights) in grids.iter_mut() {
            if made & (1 << view.index()) == 0 {
                continue;
            }
            let grid = lights.grid();
            self.workgroups[view.index()] =
                (grid.uniform().grid[2] != 0.0).then(|| grid.gpu_workgroups());
            if lights.take_new() {
                let (at, bytes) = arena.push(lights.params_bytes())?;
                list.push(Op::WriteBuffer, &[ids::light_params(view), 0, at, bytes])?;
                let (at, bytes) = arena.push(lights.lights_bytes())?;
                list.push(Op::WriteBuffer, &[ids::lights(view), 0, at, bytes])?;
            }
        }
        Ok(())
    }

    /// Records the pass's three dispatches for each view with lights.
    pub(super) fn record(&self, list: &mut DrawList) -> Result<(), RecordError> {
        for (index, workgroups) in self.workgroups.iter().enumerate() {
            let Some(workgroups) = *workgroups else {
                continue;
            };
            let group = ids::light_group(ViewId::from_index(index));
            list.push(Op::SetBindGroup, &[0, group, 0])?;
            for (id, template) in PIPELINES {
                // One workgroup adds up the counts of every cluster.
                let groups = if template == template::LIGHT_PLACE {
                    [1, 1, 1]
                } else {
                    workgroups
                };
                list.push(Op::SetComputePipeline, &[id])?;
                list.push(Op::Dispatch, &groups)?;
            }
        }
        Ok(())
    }
}
