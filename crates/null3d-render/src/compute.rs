//! Compute passes of the render graph: the sketch's WGSL, run as a compute pipeline that fills the
//! whole target of a view of its own (see [`crate::view::Compute`]). The target is a storage
//! texture, and the render graph keeps it from frame to frame. Materials, effects and other passes
//! sample it in the same frame, and the graph orders the pass before every one that reads it.
//!
//! A pass binds its block of the uniform buffer and its target in group 0, then its own textures
//! in group 1, as a custom effect does. Its block holds what an effect's block holds, so a shader
//! reads the render size, the target size, the clock, the camera and its own values.
//!
//! A pass that keeps history holds its two states in textures of their own: a run writes one and
//! reads the other, and every binding covers a whole texture, as compatibility mode requires. Once
//! the frame's runs have finished, the frame copies both states into the target's layers: the first
//! state into the first layers and the second into the layers after them. Readers name the state
//! they want by its layer. The frame runs the pass's dispatch as often as the pass asks, swapping
//! the states between runs.
//!
//! Each view's block uploads only when it changed, and each view's bind group is made again only
//! when what it binds changed, so passes that stay still record only their dispatches.
//!
//! Only WebGPU records these passes. WebGL2 has no compute shaders, so a page that draws there
//! runs a full-screen pass in place of each compute pass, or runs none.

use null3d_gpu::drawlist::{
    DrawList, Op, buffer_usage as usage, format, layout as bind_layout, resource_kind,
    texture_usage, view,
};

use crate::bloom::bytes_of;
use crate::camera::Mat4;
use crate::effects::{BLOCK, BLOCK_BYTES, Block, IDENTITY};
use crate::frame::{RecordError, UploadArena};
use crate::graph::{RenderScale, Size};
use crate::view::{Compute, MAX_VIEWS};

/// The GPU objects of the compute passes, which the frame builder's id ranges set.
#[derive(Clone, Copy, Debug)]
pub(crate) struct ComputePassIds {
    /// The uniform buffer of every view's block.
    pub(crate) buffer: u32,
    /// Group 0 of each view's first state, from this id on, by the view's place.
    pub(crate) first_group: u32,
    /// Group 0 of each view's second state, from this id on, by the view's place.
    pub(crate) first_history_group: u32,
    /// The compute pipeline of each view's pass, from this id on, by the view's place.
    pub(crate) first_pipeline: u32,
    /// One bind-group view of each state texture for each view, from this id on, by the view's
    /// place.
    pub(crate) first_view: u32,
    /// The two state textures of each view, from this id on, by the view's place.
    pub(crate) first_state: u32,
}

/// Bytes of the uniform buffer: a block for each view.
const BUFFER_BYTES: usize = MAX_VIEWS * BLOCK;

/// The texture that holds one state of the pass at view place `place`.
const fn state_texture(ids: ComputePassIds, place: usize, state: u32) -> u32 {
    ids.first_state + (place * 2) as u32 + state
}

/// The bind-group view of that state texture, which covers all of its layers.
const fn state_view(ids: ComputePassIds, place: usize, state: u32) -> u32 {
    ids.first_view + (place * 2) as u32 + state
}

/// The bind group layout of a compute pass's group 0 for the target format `target`, or for a pass
/// that writes the two buffers of an instance draw.
pub(crate) const fn layout_of(target: u32, buffers: bool) -> u32 {
    if buffers {
        return bind_layout::COMPUTE_INSTANCE_BUFFERS;
    }
    match target {
        format::R32_FLOAT => bind_layout::COMPUTE_R32_FLOAT,
        format::RGBA8_UNORM => bind_layout::COMPUTE_RGBA8_UNORM,
        _ => bind_layout::COMPUTE_RGBA16_FLOAT,
    }
}

/// The bind group layout of a compute pass's group 0 when it keeps history: the same entries, and
/// the state of the run before as a sampled texture at binding 2.
pub(crate) const fn history_layout_of(target: u32) -> u32 {
    match target {
        format::R32_FLOAT => bind_layout::COMPUTE_HISTORY_R32_FLOAT,
        format::RGBA8_UNORM => bind_layout::COMPUTE_HISTORY_RGBA8_UNORM,
        _ => bind_layout::COMPUTE_HISTORY_RGBA16_FLOAT,
    }
}

/// The bit of a compute pipeline's format code that says the pass samples textures at group 1.
/// The GPU side reads the bit and gives the pipeline the materials' maps layout as well as its
/// target's layout.
pub(crate) const PIPELINE_MAPS_BIT: u32 = 1 << 8;

/// The bit of a compute pipeline's format code that says the pass keeps history, so its group 0
/// also binds the state of the run before.
pub(crate) const PIPELINE_HISTORY_BIT: u32 = 1 << 9;

/// The format code that a compute pass's pipeline names for its bind group layouts: 0 for a pass
/// that fills an instance draw's two buffers, and its target's format otherwise. A pass that keeps
/// the default format writes rgba16float, which a code of 0 would also name, so the default is
/// written out. A pass that samples textures sets the maps bit, since its pipeline takes the maps
/// layout at group 1 and a pass without maps binds nothing there. A pass with history sets the
/// history bit, so its group 0 takes the layout that also binds the previous state.
pub(crate) const fn pipeline_format(format: u32, buffers: bool, maps: bool, history: bool) -> u32 {
    let base = if buffers {
        0
    } else if format == 0 {
        format::RGBA16_FLOAT
    } else {
        format
    };
    let maps = if maps { PIPELINE_MAPS_BIT } else { 0 };
    let history = if history { PIPELINE_HISTORY_BIT } else { 0 };
    base | maps | history
}

/// What a compute pass's group binds: the target's texture, the layout of its group 0, the
/// target's size in texels, and the state that the group writes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Bound {
    target: u32,
    layout: u32,
    drawn: (u32, u32),
    state: u32,
}

/// The passes' GPU objects and what the GPU holds of them, by view place.
#[derive(Debug)]
pub(crate) struct ComputePasses {
    ids: ComputePassIds,
    created: bool,
    /// The template that each view's pipeline was made for, and its history flag.
    pipelines: [Option<(u32, bool)>; MAX_VIEWS],
    /// The block that each view's part of the buffer holds, or `None` before its upload.
    uploaded: [Option<Block>; MAX_VIEWS],
    /// What each view's groups bind, by the state that a group writes, or `None` before the group
    /// exists.
    bound: [[Option<Bound>; 2]; MAX_VIEWS],
    /// The target that a view's states are copied into, or 0 before the frame prepares them.
    viewed: [u32; MAX_VIEWS],
    /// The size of each view's state textures, in texels.
    sized: [(u32, u32); MAX_VIEWS],
    /// True once each view's two state textures exist.
    states: [bool; MAX_VIEWS],
    /// True when each view's pass ran in this frame, so its states must reach the target.
    ran: [bool; MAX_VIEWS],
    /// The state that each view's next run writes: 0 or 1.
    state: [u8; MAX_VIEWS],
    /// The state that the last run wrote, which readers sample.
    newest: [u8; MAX_VIEWS],
    /// The state that each view's first run of the frame writes, which its steps count from.
    draw_state: [u8; MAX_VIEWS],
    /// The reset count that each view's builder has acted on.
    reset_seen: [u32; MAX_VIEWS],
    /// The template and history flag that each view's state belongs to, so another pass at the
    /// same place starts from empty.
    seen: [Option<(u32, bool)>; MAX_VIEWS],
}

impl ComputePasses {
    /// Bytes a frame may copy into its arena: every view's block.
    pub(crate) const UPLOAD_BYTES: usize = MAX_VIEWS * BLOCK_BYTES;

    /// The passes, with GPU objects from `ids`.
    pub(crate) fn new(ids: ComputePassIds) -> Self {
        Self {
            ids,
            created: false,
            pipelines: [None; MAX_VIEWS],
            uploaded: [None; MAX_VIEWS],
            bound: [[None; 2]; MAX_VIEWS],
            viewed: [0; MAX_VIEWS],
            sized: [(0, 0); MAX_VIEWS],
            states: [false; MAX_VIEWS],
            ran: [false; MAX_VIEWS],
            state: [0; MAX_VIEWS],
            newest: [0; MAX_VIEWS],
            draw_state: [0; MAX_VIEWS],
            reset_seen: [0; MAX_VIEWS],
            seen: [None; MAX_VIEWS],
        }
    }

    /// Starts the view's frame: the state that its first run writes, and the state that its last
    /// run leaves for readers. A frame of no runs, or of an even number of steps, leaves the state
    /// that the frame before left. `textures_made` says the graph made the plan's textures again,
    /// so both states are empty and the first one is next.
    pub(crate) fn begin_frame(
        &mut self,
        place: usize,
        pass: &Compute,
        runs: bool,
        textures_made: bool,
    ) {
        let seen = (pass.template, pass.history);
        if textures_made || self.seen[place] != Some(seen) {
            self.state[place] = 0;
            self.newest[place] = 0;
            self.viewed[place] = 0;
            self.bound[place] = [None; 2];
            self.seen[place] = Some(seen);
        }
        self.draw_state[place] = self.state[place];
        self.ran[place] = pass.history && runs && pass.steps > 0;
        if pass.history && runs && pass.steps > 0 {
            // Each run writes the state that the one before read, so the last run of an odd count
            // leaves the state that the frame started from, and one of an even count the other.
            self.newest[place] = self.state[place] ^ ((pass.steps - 1) & 1) as u8;
            self.state[place] ^= (pass.steps & 1) as u8;
        }
    }

    /// The array layer of the state that a history pass last wrote, or 0 for a pass that keeps no
    /// history. Readers sample the pass's texture from this layer.
    pub(crate) fn reader_layer(&self, place: usize, pass: &Compute) -> u32 {
        if !pass.history {
            return 0;
        }
        u32::from(self.newest.get(place).copied().unwrap_or(0)) * pass.layers.max(1)
    }

    /// Starts the view at `place` again from the first state, after the page cleared its states.
    /// Returns true, once for each request, when the builder must record the clear.
    pub(crate) fn take_reset(&mut self, place: usize, pass: &Compute) -> bool {
        if pass.reset == self.reset_seen[place] {
            return false;
        }
        self.reset_seen[place] = pass.reset;
        self.state[place] = 0;
        self.newest[place] = 0;
        // The states start empty, so the next frame makes their textures again.
        self.states[place] = false;
        self.ran[place] = false;
        true
    }

    /// Makes the buffer when the GPU lacks it, records the pipeline of the pass at view place
    /// `place` when its template changed, uploads its block when it changed, and binds it to its
    /// target in `target` when the group is new or the frame made the plan's textures again
    /// (`textures_made`). `drawn` is the pass's target size in texels, `canvas` the canvas's size
    /// and `scale` the render scale, `clock` the sketch time and the seconds since the frame
    /// before, and `inverse_projection` the inverse of the camera's projection.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn prepare(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        (place, pass, target): (usize, &Compute, u32),
        drawn: (u32, u32),
        (canvas, scale): ((u32, u32), RenderScale),
        clock: [f32; 2],
        inverse_projection: Option<Mat4>,
        textures_made: bool,
    ) -> Result<(), RecordError> {
        let ids = self.ids;
        if !self.created {
            list.push(
                Op::CreateBuffer,
                &[
                    ids.buffer,
                    BUFFER_BYTES as u32,
                    usage::UNIFORM | usage::COPY_DST,
                ],
            )?;
            self.created = true;
        }
        let pipeline = (pass.template, pass.history);
        if self.pipelines[place] != Some(pipeline) {
            list.push(
                Op::CreateComputePipeline,
                &[
                    ids.first_pipeline + place as u32,
                    pass.template,
                    pipeline_format(
                        pass.format,
                        pass.buffers.is_some(),
                        pass.maps.any(),
                        pass.history,
                    ),
                ],
            )?;
            self.pipelines[place] = Some(pipeline);
            self.bound[place] = [None; 2];
        }
        let render = Size::Full.viewport(canvas, scale);
        let (width, height) = (drawn.0.max(1) as f32, drawn.1.max(1) as f32);
        let block = Block {
            size: [
                render.0 as f32,
                render.1 as f32,
                canvas.0.max(1) as f32,
                canvas.1.max(1) as f32,
            ],
            clock: [clock[0], clock[1], 0.0, 0.0],
            inverse_projection: inverse_projection.unwrap_or(IDENTITY),
            values: pass.values,
            drawn: [width, height, height, 1.0],
            bloom: [0.0; 4],
        };
        if self.uploaded[place] != Some(block) {
            let (at, bytes) = arena.push(bytes_of(&block))?;
            let offset = (place * BLOCK) as u32;
            list.push(Op::WriteBuffer, &[ids.buffer, offset, at, bytes])?;
            self.uploaded[place] = Some(block);
        }
        let layout = match pass.history {
            true => history_layout_of(pass.format),
            false => layout_of(pass.format, pass.buffers.is_some()),
        };
        match pass.buffers {
            // Group 0 of a pass that writes an instance draw: the pass's block, the draw's count
            // word and its per-instance rows.
            Some(buffers) => {
                let bound = Bound {
                    target,
                    layout,
                    drawn,
                    state: 0,
                };
                if !textures_made && self.bound[place][0] == Some(bound) {
                    return Ok(());
                }
                let words = [
                    ids.first_group + place as u32,
                    layout,
                    3,
                    0,
                    resource_kind::BUFFER,
                    ids.buffer,
                    (place * BLOCK) as u32,
                    BLOCK_BYTES as u32,
                    1,
                    resource_kind::BUFFER,
                    buffers.counts,
                    0,
                    crate::feature_instances::COUNT_BYTES,
                    2,
                    resource_kind::BUFFER,
                    buffers.instances,
                    0,
                    buffers.instances_bytes,
                ];
                list.push(Op::CreateBindGroup, &words)?;
                self.bound[place][0] = Some(bound);
            }
            None if pass.history => {
                let layers = pass.layers.max(1);
                // Two textures hold the states, so a run writes one and samples the other, and
                // every binding covers a whole texture, which compatibility mode requires.
                if textures_made || !self.states[place] {
                    if self.states[place] {
                        for state in 0..2u32 {
                            list.push(Op::DestroyTexture, &[state_view(ids, place, state)])?;
                            list.push(Op::DestroyTexture, &[state_texture(ids, place, state)])?;
                        }
                    }
                    let code = if pass.format == 0 {
                        format::RGBA16_FLOAT
                    } else {
                        pass.format
                    };
                    for state in 0..2u32 {
                        let texture = state_texture(ids, place, state);
                        list.push(
                            Op::CreateTexture,
                            &[
                                texture,
                                drawn.0.max(1),
                                drawn.1.max(1),
                                layers,
                                code,
                                texture_usage::STORAGE_BINDING
                                    | texture_usage::TEXTURE_BINDING
                                    | texture_usage::COPY_SRC
                                    | texture_usage::COPY_DST,
                                1,
                                1,
                                view::D2_ARRAY,
                            ],
                        )?;
                        list.push(
                            Op::CreateBindView,
                            &[state_view(ids, place, state), texture, 0, layers],
                        )?;
                    }
                    self.states[place] = true;
                    self.bound[place] = [None; 2];
                }
                self.viewed[place] = target;
                self.sized[place] = drawn;
                for state in 0..2u32 {
                    let bound = Bound {
                        target,
                        layout,
                        drawn,
                        state,
                    };
                    if !textures_made && self.bound[place][state as usize] == Some(bound) {
                        continue;
                    }
                    let write = state_view(ids, place, state);
                    let read = state_view(ids, place, 1 - state);
                    let group = match state {
                        0 => ids.first_group + place as u32,
                        _ => ids.first_history_group + place as u32,
                    };
                    let words = [
                        group,
                        layout,
                        3,
                        0,
                        resource_kind::BUFFER,
                        ids.buffer,
                        (place * BLOCK) as u32,
                        BLOCK_BYTES as u32,
                        1,
                        resource_kind::TEXTURE,
                        write,
                        0,
                        0,
                        2,
                        resource_kind::TEXTURE,
                        read,
                        0,
                        0,
                    ];
                    list.push(Op::CreateBindGroup, &words)?;
                    self.bound[place][state as usize] = Some(bound);
                }
            }
            // Group 0: the pass's block, then the storage texture that it fills.
            None => {
                let bound = Bound {
                    target,
                    layout,
                    drawn,
                    state: 0,
                };
                if !textures_made && self.bound[place][0] == Some(bound) {
                    return Ok(());
                }
                let words = [
                    ids.first_group + place as u32,
                    layout,
                    2,
                    0,
                    resource_kind::BUFFER,
                    ids.buffer,
                    (place * BLOCK) as u32,
                    BLOCK_BYTES as u32,
                    1,
                    resource_kind::TEXTURE,
                    target,
                    0,
                    0,
                ];
                list.push(Op::CreateBindGroup, &words)?;
                self.bound[place][0] = Some(bound);
            }
        }
        Ok(())
    }

    /// Records the dispatch of the pass at view place `place` inside the compute pass that the
    /// render graph began, once for each step that the pass asks for. A history pass swaps its two
    /// states between steps, so a frame of `n` steps leaves the state that run `n` wrote. A pass
    /// without a pipeline or a bind group dispatches nothing, and its target keeps its last image.
    pub(crate) fn record(
        &mut self,
        list: &mut DrawList,
        place: usize,
        pass: &Compute,
        drawn: (u32, u32),
    ) -> Result<(), RecordError> {
        if self.pipelines[place] != Some((pass.template, pass.history)) {
            return Ok(());
        }
        if pass.maps.any() {
            if pass.maps.group == 0 {
                return Ok(());
            }
            list.push(Op::SetBindGroup, &[1, pass.maps.group, 0])?;
        }
        list.push(
            Op::SetComputePipeline,
            &[self.ids.first_pipeline + place as u32],
        )?;
        let steps = if pass.history { pass.steps } else { 1 };
        let [x, y, z] = pass.workgroups(drawn);
        let mut state = if pass.history {
            self.draw_state[place]
        } else {
            0
        };
        for _ in 0..steps {
            if self.bound[place][state as usize].is_none() {
                return Ok(());
            }
            let group = match state {
                0 => self.ids.first_group + place as u32,
                _ => self.ids.first_history_group + place as u32,
            };
            list.push(Op::SetBindGroup, &[0, group, 0])?;
            list.push(Op::Dispatch, &[x, y, z])?;
            if pass.history {
                state = 1 - state;
            }
        }
        Ok(())
    }

    /// Copies the view's two states into the target's blocks once the frame's runs have finished,
    /// so a reader sees both states as layers of the pass's texture. A pass that did not run left
    /// its target holding them, so nothing copies.
    pub(crate) fn copy_states(
        &self,
        list: &mut DrawList,
        place: usize,
        pass: &Compute,
    ) -> Result<(), RecordError> {
        if !pass.history || !self.ran[place] || !self.states[place] {
            return Ok(());
        }
        let target = self.viewed[place];
        if target == 0 {
            return Ok(());
        }
        let layers = pass.layers.max(1);
        let (width, height) = self.sized[place];
        for state in 0..2u32 {
            list.push(
                Op::CopyTextureToTexture,
                &[
                    state_texture(self.ids, place, state),
                    0,
                    0,
                    0,
                    0,
                    target,
                    0,
                    0,
                    0,
                    state * layers,
                    width,
                    height,
                    layers,
                ],
            )?;
        }
        Ok(())
    }

    /// Forgets the GPU objects, so the next frame makes them again, after the thread that draws
    /// replaced the GPU. The states start empty again, so the first one is next.
    pub(crate) fn reset_gpu(&mut self) {
        self.created = false;
        self.pipelines = [None; MAX_VIEWS];
        self.uploaded = [None; MAX_VIEWS];
        self.bound = [[None; 2]; MAX_VIEWS];
        self.viewed = [0; MAX_VIEWS];
        self.sized = [(0, 0); MAX_VIEWS];
        self.states = [false; MAX_VIEWS];
        self.ran = [false; MAX_VIEWS];
        self.state = [0; MAX_VIEWS];
        self.newest = [0; MAX_VIEWS];
        self.draw_state = [0; MAX_VIEWS];
        self.seen = [None; MAX_VIEWS];
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_pass_that_fills_buffers_takes_the_buffer_layout() {
        // A texture pass takes the layout of its target's format, and a pass that fills an
        // instance draw takes the buffer layout whatever its format field says.
        assert_eq!(
            layout_of(format::RGBA16_FLOAT, false),
            bind_layout::COMPUTE_RGBA16_FLOAT
        );
        assert_eq!(
            layout_of(format::R32_FLOAT, false),
            bind_layout::COMPUTE_R32_FLOAT
        );
        assert_eq!(
            layout_of(format::RGBA8_UNORM, false),
            bind_layout::COMPUTE_RGBA8_UNORM
        );
        assert_eq!(layout_of(0, true), bind_layout::COMPUTE_INSTANCE_BUFFERS);
        assert_eq!(
            layout_of(format::RGBA16_FLOAT, true),
            bind_layout::COMPUTE_INSTANCE_BUFFERS
        );
    }

    #[test]
    fn a_history_pass_takes_the_layout_that_binds_the_previous_state() {
        assert_eq!(
            history_layout_of(format::RGBA16_FLOAT),
            bind_layout::COMPUTE_HISTORY_RGBA16_FLOAT
        );
        assert_eq!(
            history_layout_of(format::R32_FLOAT),
            bind_layout::COMPUTE_HISTORY_R32_FLOAT
        );
        assert_eq!(
            history_layout_of(format::RGBA8_UNORM),
            bind_layout::COMPUTE_HISTORY_RGBA8_UNORM
        );
    }

    #[test]
    fn a_texture_pass_pipeline_names_its_format() {
        // The GPU side reads a format code of 0 as the instance buffers' layout, so a pass that
        // writes a texture names its format, and the default rgba16float as well.
        assert_eq!(
            pipeline_format(0, false, false, false),
            format::RGBA16_FLOAT
        );
        assert_eq!(
            pipeline_format(format::R32_FLOAT, false, false, false),
            format::R32_FLOAT
        );
        assert_eq!(
            pipeline_format(format::RGBA8_UNORM, false, false, false),
            format::RGBA8_UNORM
        );
        assert_eq!(pipeline_format(0, true, false, false), 0);
        assert_eq!(pipeline_format(format::RGBA16_FLOAT, true, false, false), 0);
    }

    #[test]
    fn a_pass_that_samples_textures_sets_the_maps_bit() {
        // A pass that samples textures takes the maps layout at group 1, and one without maps
        // binds nothing there, so its pipeline takes group 0 alone.
        assert_eq!(
            pipeline_format(format::RGBA16_FLOAT, false, true, false),
            format::RGBA16_FLOAT | PIPELINE_MAPS_BIT
        );
        assert_eq!(
            pipeline_format(0, true, true, false),
            PIPELINE_MAPS_BIT,
            "a pass that fills buffers and samples textures still takes the buffer layout"
        );
    }

    #[test]
    fn a_history_pass_sets_the_history_bit() {
        assert_eq!(
            pipeline_format(format::RGBA16_FLOAT, false, true, true),
            format::RGBA16_FLOAT | PIPELINE_MAPS_BIT | PIPELINE_HISTORY_BIT
        );
        assert_eq!(
            pipeline_format(format::R32_FLOAT, false, false, true),
            format::R32_FLOAT | PIPELINE_HISTORY_BIT
        );
    }

    #[test]
    fn a_rebuilt_target_starts_the_states_again_from_empty() {
        let pass = Compute {
            template: 1,
            workgroup: [8, 8, 1],
            dispatch: None,
            format: format::RGBA16_FLOAT,
            after_scene: false,
            values: [0.0; crate::effects::EFFECT_FLOATS],
            maps: crate::effects::EffectMaps::NONE,
            buffers: None,
            history: true,
            layers: 1,
            steps: 3,
            reset: 0,
        };
        let ids = ComputePassIds {
            buffer: 1,
            first_group: 10,
            first_history_group: 20,
            first_pipeline: 30,
            first_view: 40,
            first_state: 60,
        };
        let mut passes = ComputePasses::new(ids);
        passes.begin_frame(1, &pass, true, false);
        assert_eq!(
            passes.state[1], 1,
            "an odd count of steps leaves the second state"
        );
        // A lost device makes every texture again, so the next frame starts from the first, empty
        // state and records no run.
        let idle = Compute { steps: 0, ..pass };
        passes.begin_frame(1, &idle, true, true);
        assert_eq!(passes.state[1], 0);
        // The first run after the loss writes the empty state, not the one that the old device left.
        let once = Compute { steps: 1, ..pass };
        passes.begin_frame(1, &once, true, false);
        assert_eq!(passes.state[1], 1);
    }

    #[test]
    fn a_history_pass_keeps_the_state_that_its_last_step_wrote() {
        let pass = Compute {
            template: 1,
            workgroup: [8, 8, 1],
            dispatch: None,
            format: format::RGBA16_FLOAT,
            after_scene: false,
            values: [0.0; crate::effects::EFFECT_FLOATS],
            maps: crate::effects::EffectMaps::NONE,
            buffers: None,
            history: true,
            layers: 1,
            steps: 3,
            reset: 0,
        };
        let ids = ComputePassIds {
            buffer: 1,
            first_group: 10,
            first_history_group: 20,
            first_pipeline: 30,
            first_view: 40,
            first_state: 60,
        };
        let mut passes = ComputePasses::new(ids);
        assert_eq!(pass.target_layers(), 2);
        assert_eq!(pass.workgroups((64, 64)), [8, 8, 1]);
        // An even count of steps leaves the state that the odd one wrote, so readers sample it.
        passes.newest[1] = 1;
        assert_eq!(passes.reader_layer(1, &pass), 1);
    }

    #[test]
    fn a_layered_pass_runs_once_along_z_for_each_layer() {
        let pass = Compute {
            template: 1,
            workgroup: [8, 8, 1],
            dispatch: None,
            format: format::RGBA16_FLOAT,
            after_scene: false,
            values: [0.0; crate::effects::EFFECT_FLOATS],
            maps: crate::effects::EffectMaps::NONE,
            buffers: None,
            history: true,
            layers: 4,
            steps: 1,
            reset: 0,
        };
        assert_eq!(pass.target_layers(), 8);
        assert_eq!(pass.workgroups((64, 64)), [8, 8, 4]);
    }
}
