//! The point and spot lights of the camera's view: the light grid's words and light records in two
//! storage buffers that fragment shaders read, which every view's frame group binds. With the
//! material table, the buffers take three of the four storage buffers that fragment shaders may
//! read in WebGPU's compatibility mode.
//!
//! The GPU lists each cluster's lights itself (see [`crate::light_grid::ClusterParams`]). Each
//! frame whose lights or view changed uploads the light list and the parameters of the light
//! clustering passes, and in each frame with lights the light clustering pass, before every other
//! pass, fills the grid with three dispatches. The pass runs in frames that upload nothing too,
//! because the thread that draws skips the dispatches of pipelines that it is still building: the
//! grid then fills in the first frame after they are built.

use null3d_gpu::drawlist::{
    DrawList, Op, buffer_usage as usage, layout as bind_layout, resource_kind, sizes, template,
};

use super::ids;
use crate::frame::{RecordError, UploadArena};
use crate::light_grid::{CLUSTER_PARAMS_BYTES, CameraLights};

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

/// Records the creation of the two buffers, as large as the grid can fill, of the parameters of
/// the light clustering pass, and of the pass's bind group.
pub(super) fn create(list: &mut DrawList, lights: &CameraLights) -> Result<(), RecordError> {
    let grid = lights.grid();
    let buffers = [
        (
            ids::LIGHT_PARAMS,
            CLUSTER_PARAMS_BYTES,
            usage::UNIFORM | usage::COPY_DST,
        ),
        (
            ids::LIGHTS,
            grid.limits().lights.max(1) * sizes::LIGHT_RECORD_BYTES,
            usage::STORAGE | usage::COPY_DST,
        ),
        (ids::LIGHT_GRID, grid.max_words() * 4, usage::STORAGE),
    ];
    for &(id, size, flags) in &buffers {
        list.push(Op::CreateBuffer, &[id, size, flags])?;
    }
    let mut entries = [0u32; 3 + 3 * 5];
    entries[..3].copy_from_slice(&[ids::LIGHT_GROUP, bind_layout::LIGHT_CLUSTERS, 3]);
    for (binding, &(buffer, _, _)) in buffers.iter().enumerate() {
        let at = 3 + binding * 5;
        entries[at..at + 5].copy_from_slice(&[binding as u32, resource_kind::BUFFER, buffer, 0, 0]);
    }
    list.push(Op::CreateBindGroup, &entries)?;
    Ok(())
}

/// The light clustering pass: whether the frame being recorded fills the grid.
#[derive(Debug, Default)]
pub(super) struct LightClusters {
    /// The workgroups of the counting and writing dispatches, or `None` in a frame whose grid lists
    /// no light.
    workgroups: Option<[u32; 3]>,
}

impl LightClusters {
    /// Uploads the light list and the parameters of the light clustering pass when they differ
    /// from what the buffers hold, and has the pass fill the grid in a frame with lights.
    pub(super) fn upload(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        lights: &mut CameraLights,
    ) -> Result<(), RecordError> {
        let grid = lights.grid();
        self.workgroups = (grid.uniform().grid[2] != 0.0).then(|| grid.gpu_workgroups());
        if lights.take_new() {
            let (at, bytes) = arena.push(lights.params_bytes())?;
            list.push(Op::WriteBuffer, &[ids::LIGHT_PARAMS, 0, at, bytes])?;
            let (at, bytes) = arena.push(lights.lights_bytes())?;
            list.push(Op::WriteBuffer, &[ids::LIGHTS, 0, at, bytes])?;
        }
        Ok(())
    }

    /// Records the pass's three dispatches, in a frame with lights.
    pub(super) fn record(&self, list: &mut DrawList) -> Result<(), RecordError> {
        let Some(workgroups) = self.workgroups else {
            return Ok(());
        };
        list.push(Op::SetBindGroup, &[0, ids::LIGHT_GROUP, 0])?;
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
        Ok(())
    }
}
