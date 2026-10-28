//! Full-screen passes of the render graph: the sketch's WGSL, built as a custom effect's (see
//! [`crate::effects`]), drawn as one triangle over the whole target of a view of its own (see
//! [`crate::view::Fullscreen`]). The render graph keeps the target from frame to frame, and
//! materials and effects sample it as they sample a scene pass's.
//!
//! A pass reads an input image: the scene color as the camera's passes leave it, the outline mask,
//! or a blank texel. It can read the scene's depth, and textures of its own, which bind in a
//! second bind group as an effect's do. Its block holds what an effect's holds, with the size of
//! its own target in the last vector, which tells the shader that it draws a pass texture: the
//! image's bottom row first, as materials sample it, on both paths.
//!
//! Each view's block of the uniform buffer uploads only when it changed, and each view's bind
//! group is made again only when what it reads changed, so passes that stay still record only
//! their draws.

use null3d_gpu::drawlist::{
    DrawList, NO_TARGET, Op, buffer_usage as usage, format, layout as bind_layout, pass_flags,
    permutation, state_flags, texture_usage, view,
};

use crate::bloom::bytes_of;
use crate::camera::Mat4;
use crate::effects::{
    BLOCK, BLOCK_BYTES, Block, IDENTITY, create_effect_group, create_shared_objects, create_texel,
};
use crate::frame::{RecordError, UploadArena};
use crate::graph::{RenderScale, Size};
use crate::pipelines::{DepthBias, PipelineCache, PipelineKey};
use crate::view::{Fullscreen, MAX_VIEWS, View};

/// Bytes of the uniform buffer: a block for each view.
const BUFFER_BYTES: usize = MAX_VIEWS * BLOCK;

/// The array layers that one fragment form draws, each with a block of its own: a WebGL2 page
/// draws a pass of several layers one layer at a time. The call refuses a pass of more layers.
pub(crate) const MAX_FALLBACK_LAYERS: u32 = 32;

/// Bytes of the buffer that holds one block for each state layer of each view.
const LAYER_BUFFER_BYTES: usize = MAX_VIEWS * MAX_FALLBACK_LAYERS as usize * BLOCK;

/// The GPU objects of the full-screen passes, which the frame builder's id ranges set.
#[derive(Clone, Copy, Debug)]
pub(crate) struct FullscreenIds {
    /// The uniform buffer of every view's block.
    pub(crate) buffer: u32,
    /// The linear sampler that passes read their input with, which clamps at the edges.
    pub(crate) sampler: u32,
    /// The bind group of each view, from this id on, by the view's place.
    pub(crate) first_group: u32,
    /// The texel that a pass without an input image reads.
    pub(crate) blank_color: u32,
    /// The texel that a pass which reads no depth binds in its place.
    pub(crate) blank_depth: u32,
    /// The views of a fallback pass's target: two states of up to [`MAX_FALLBACK_LAYERS`] layers,
    /// from this id on by the view's place.
    pub(crate) first_view: u32,
    /// The scratch texture of a fallback pass's read state, from this id on by the view's place.
    pub(crate) first_scratch: u32,
    /// The group of each state layer of a fallback pass of several layers, from this id on.
    pub(crate) first_layer_group: u32,
    /// The buffer of those groups' blocks.
    pub(crate) layer_buffer: u32,
}

/// The id of the view of one state layer of the fallback pass at `place`.
const fn layer_view(ids: FullscreenIds, place: usize, state: u32, layer: u32) -> u32 {
    ids.first_view + (place as u32 * 2 + state) * MAX_FALLBACK_LAYERS + layer
}

/// What a fallback pass's scratch texture and state views were made for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct FallbackMade {
    target: u32,
    drawn: (u32, u32),
    scratch: u32,
    /// The states that the target holds, and so the layer views that it draws into.
    states: u32,
    /// The array layers of each state.
    layers: u32,
}

/// What a pass reads this frame: its input image and its depth, as textures of the draw list.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct PassInputs {
    pub(crate) color: u32,
    pub(crate) depth: u32,
}

/// The pipeline of a pass: one triangle into a target of `format` with one sample.
const fn pipeline(template: u32, format: u32, multisampled: bool) -> PipelineKey {
    PipelineKey {
        template,
        permutation: if multisampled {
            permutation::DEPTH_MULTISAMPLED
        } else {
            0
        },
        vertex_format: 0,
        color_format: format,
        depth_format: format::NONE,
        samples: 1,
        state: state_flags::CULL_NONE,
        bias: DepthBias::NONE,
    }
}

/// The passes' GPU objects and what the GPU holds of them, by view place.
#[derive(Debug)]
pub(crate) struct FullscreenPasses {
    ids: FullscreenIds,
    /// True when the scene's depth is multisampled and the shaders read it as such: on WebGPU
    /// with MSAA.
    multisampled_depth: bool,
    /// The format of the passes' targets.
    format: u32,
    /// Each view's pipeline, with the template and depth read it was asked for.
    pipelines: [Option<(u32, bool, u32)>; MAX_VIEWS],
    created: bool,
    /// The block that each view's part of the buffer holds, or `None` before its upload.
    uploaded: [Option<Block>; MAX_VIEWS],
    /// What each view's bind group reads, with its layout, or `None` before the group exists.
    bound: [Option<(PassInputs, u32)>; MAX_VIEWS],
    /// What each fallback pass's scratch texture and state views were made for.
    fallback: [Option<FallbackMade>; MAX_VIEWS],
    /// What each layer of a fallback pass of several layers binds, or `None` before its group
    /// exists.
    bound_layers: [[Option<(PassInputs, u32)>; MAX_FALLBACK_LAYERS as usize]; MAX_VIEWS],
    /// True once the buffer of the layer groups' blocks exists.
    layers_created: bool,
}

impl FullscreenPasses {
    /// Bytes a frame may copy into its arena: every view's block.
    pub(crate) const UPLOAD_BYTES: usize = MAX_VIEWS * BLOCK_BYTES;

    /// Bytes that the frame copies for the views: one block for each pass, or one for each layer
    /// of a pass of several layers.
    pub(crate) fn upload_bound(&self, views: &[View]) -> usize {
        views
            .iter()
            .filter_map(View::fullscreen_pass)
            .filter(|pass| pass.fallback)
            .map(|pass| {
                (pass.layers.clamp(1, MAX_FALLBACK_LAYERS) as usize).saturating_sub(1) * BLOCK_BYTES
            })
            .sum()
    }

    /// The passes, with GPU objects from `ids`, drawing into targets of `format`, whose depth reads
    /// are multisampled when `multisampled_depth` says.
    pub(crate) fn new(ids: FullscreenIds, format: u32, multisampled_depth: bool) -> Self {
        Self {
            ids,
            multisampled_depth,
            format,
            pipelines: [None; MAX_VIEWS],
            created: false,
            uploaded: [None; MAX_VIEWS],
            bound: [None; MAX_VIEWS],
            fallback: [None; MAX_VIEWS],
            bound_layers: [[None; MAX_FALLBACK_LAYERS as usize]; MAX_VIEWS],
            layers_created: false,
        }
    }

    /// True when `pass` reads its depth from a multisampled texture.
    fn reads_multisampled(&self, pass: &Fullscreen) -> bool {
        self.multisampled_depth && pass.depth
    }

    /// Asks `pipelines` for the pipeline of the pass at view place `place`, when its template or
    /// its depth read changed.
    pub(crate) fn request_pipeline(
        &mut self,
        pipelines: &mut PipelineCache,
        place: usize,
        pass: &Fullscreen,
    ) {
        let multisampled = self.reads_multisampled(pass);
        let slot = &mut self.pipelines[place];
        if !matches!(*slot, Some((t, ms, _)) if t == pass.template && ms == multisampled) {
            let id = pipelines.id(pipeline(pass.template, self.format, multisampled));
            *slot = Some((pass.template, multisampled, id));
        }
    }

    /// The output's sizes that the last block of the pass at view place `place` gave its shader.
    #[cfg(test)]
    pub(crate) fn drawn(&self, place: usize) -> Option<[f32; 4]> {
        self.uploaded[place].map(|block| block.drawn)
    }

    /// Makes the buffer, the sampler and the blank texels when the GPU lacks them, uploads the
    /// block of the pass at view place `place` when it changed, and binds the pass to `inputs`
    /// when its group is new or the frame made the plan's textures again (`textures_made`).
    /// `drawn` is the pass's target size in texels, `canvas` the canvas's size and `scale` the
    /// render scale, which place the input image, `clock` the sketch time and the seconds since
    /// the frame before, and `inverse_projection` the inverse of the camera's projection.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn prepare(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        (place, pass, inputs): (usize, &Fullscreen, PassInputs),
        drawn: (u32, u32),
        (canvas, scale): ((u32, u32), RenderScale),
        clock: [f32; 2],
        inverse_projection: Option<Mat4>,
        textures_made: bool,
    ) -> Result<(), RecordError> {
        let ids = self.ids;
        if !self.created {
            create_objects(list, ids)?;
            self.created = true;
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
        let inputs = PassInputs {
            color: if inputs.color == 0 {
                ids.blank_color
            } else {
                inputs.color
            },
            depth: if pass.depth && inputs.depth != 0 {
                inputs.depth
            } else {
                ids.blank_depth
            },
        };
        let layout = if self.reads_multisampled(pass) {
            bind_layout::EFFECT_DEPTH_MS
        } else {
            bind_layout::EFFECT
        };
        if !textures_made && self.bound[place] == Some((inputs, layout)) {
            return Ok(());
        }
        create_effect_group(
            list,
            (ids.first_group + place as u32, layout),
            (ids.buffer, (place * BLOCK) as u32, BLOCK_BYTES as u32),
            (inputs.color, ids.sampler, inputs.depth),
            0,
        )?;
        self.bound[place] = Some((inputs, layout));
        Ok(())
    }

    /// Prepares the fragment form of a compute pass: its scratch texture holds the state that
    /// each step reads, and its group samples that state as the pass's input image. A pass of
    /// several layers draws one layer at a time, each with a block that names its layer.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn prepare_fallback(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        (place, pass, target, inputs): (usize, &Fullscreen, u32, PassInputs),
        drawn: (u32, u32),
        (canvas, scale): ((u32, u32), RenderScale),
        clock: [f32; 2],
        inverse_projection: Option<Mat4>,
        textures_made: bool,
    ) -> Result<(), RecordError> {
        let ids = self.ids;
        if !self.created {
            create_objects(list, ids)?;
            self.created = true;
        }
        let states = if pass.history { 2 } else { 1 };
        let layers = pass.layers.clamp(1, MAX_FALLBACK_LAYERS);
        let made = FallbackMade {
            target,
            drawn,
            scratch: ids.first_scratch + place as u32,
            states,
            layers,
        };
        if textures_made || self.fallback[place] != Some(made) {
            if let Some(old) = self.fallback[place] {
                list.push(Op::DestroyTexture, &[old.scratch])?;
                for state in 0..old.states {
                    for layer in 0..old.layers {
                        list.push(Op::DestroyTexture, &[layer_view(ids, place, state, layer)])?;
                    }
                }
            }
            if pass.history {
                // The scratch holds the state that each run reads. A pass without history reads
                // its own input image instead.
                let (width, height) = (drawn.0.max(1), drawn.1.max(1));
                list.push(
                    Op::CreateTexture,
                    &[
                        made.scratch,
                        width,
                        height,
                        1,
                        self.format,
                        texture_usage::TEXTURE_BINDING | texture_usage::COPY_DST,
                        1,
                        1,
                        view::D2,
                    ],
                )?;
            }
            for state in 0..states {
                for layer in 0..layers {
                    list.push(
                        Op::CreateTextureView,
                        &[
                            layer_view(ids, place, state, layer),
                            target,
                            0,
                            state * layers + layer,
                        ],
                    )?;
                }
            }
            self.fallback[place] = Some(made);
            self.bound[place] = None;
            self.bound_layers[place] = [None; MAX_FALLBACK_LAYERS as usize];
        }
        if layers == 1 {
            let inputs = if pass.history {
                PassInputs {
                    color: made.scratch,
                    depth: 0,
                }
            } else {
                inputs
            };
            return self.prepare(
                list,
                arena,
                (place, pass, inputs),
                drawn,
                (canvas, scale),
                clock,
                inverse_projection,
                textures_made,
            );
        }
        // A pass of several layers gives each layer a block of its own, which names the layer that
        // the fragment form writes. The blocks share a buffer of their own.
        if !self.layers_created {
            list.push(
                Op::CreateBuffer,
                &[
                    ids.layer_buffer,
                    LAYER_BUFFER_BYTES as u32,
                    usage::UNIFORM | usage::COPY_DST,
                ],
            )?;
            self.layers_created = true;
        }
        let render = Size::Full.viewport(canvas, scale);
        let (width, height) = (drawn.0.max(1) as f32, drawn.1.max(1) as f32);
        let layout = if self.reads_multisampled(pass) {
            bind_layout::EFFECT_DEPTH_MS
        } else {
            bind_layout::EFFECT
        };
        for layer in 0..layers {
            let slot = place as u32 * MAX_FALLBACK_LAYERS + layer;
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
                // The engine writes the layer plus one, so each layer takes the pass-texture path.
                drawn: [width, height, height, (layer + 1) as f32],
                bloom: [0.0; 4],
            };
            let (at, bytes) = arena.push(bytes_of(&block))?;
            list.push(
                Op::WriteBuffer,
                &[ids.layer_buffer, slot * BLOCK as u32, at, bytes],
            )?;
            let read = PassInputs {
                color: if inputs.color == 0 {
                    ids.blank_color
                } else if pass.history {
                    made.scratch
                } else {
                    inputs.color
                },
                depth: if pass.depth && inputs.depth != 0 {
                    inputs.depth
                } else {
                    ids.blank_depth
                },
            };
            if self.bound_layers[place][layer as usize] == Some((read, layout)) {
                continue;
            }
            create_effect_group(
                list,
                (ids.first_layer_group + slot, layout),
                (ids.layer_buffer, slot * BLOCK as u32, BLOCK_BYTES as u32),
                (read.color, ids.sampler, read.depth),
                0,
            )?;
            self.bound_layers[place][layer as usize] = Some((read, layout));
        }
        Ok(())
    }

    /// Records the runs of a fallback pass: each step copies the state that it reads into the
    /// scratch texture, then draws the next state into the other state's layer. The target keeps
    /// both states as its two layers, so a reader samples either. A pass without history draws
    /// once, into its only layer. A pass of several layers draws each layer of each step.
    pub(crate) fn record_fallback(
        &self,
        list: &mut DrawList,
        place: usize,
        pass: &Fullscreen,
        target: u32,
        state: u8,
    ) -> Result<(), RecordError> {
        let Some((_, _, pipeline)) = self.pipelines[place] else {
            return Ok(());
        };
        let Some(made) = self.fallback[place].filter(|made| made.target == target) else {
            return Ok(());
        };
        let ids = self.ids;
        let (width, height) = made.drawn;
        let layers = made.layers;
        let steps = if pass.history { pass.steps } else { 1 };
        let mut state = state;
        for _ in 0..steps {
            let read = 1 - state;
            for layer in 0..layers {
                if pass.history {
                    // The state that this run reads goes into the scratch texture that it samples.
                    list.push(
                        Op::CopyTextureToTexture,
                        &[
                            target,
                            0,
                            0,
                            0,
                            u32::from(read) * layers + layer,
                            made.scratch,
                            0,
                            0,
                            0,
                            0,
                            width,
                            height,
                            1,
                        ],
                    )?;
                }
                list.push(
                    Op::BeginRenderPass,
                    &[
                        layer_view(ids, place, u32::from(state), layer),
                        NO_TARGET,
                        NO_TARGET,
                        0,
                        0,
                        0,
                        0,
                        0,
                        pass_flags::STORE_COLOR,
                    ],
                )?;
                list.push(Op::SetPipeline, &[pipeline])?;
                let group = if layers == 1 {
                    ids.first_group + place as u32
                } else {
                    ids.first_layer_group + place as u32 * MAX_FALLBACK_LAYERS + layer
                };
                list.push(Op::SetBindGroup, &[0, group, 0])?;
                if pass.maps.any() {
                    if pass.maps.group == 0 {
                        list.push(Op::EndRenderPass, &[])?;
                        return Ok(());
                    }
                    list.push(Op::SetBindGroup, &[1, pass.maps.group, 0])?;
                }
                list.push(Op::Draw, &[3, 1, 0, 0])?;
                list.push(Op::EndRenderPass, &[])?;
            }
            state = read;
        }
        Ok(())
    }

    /// Records the pass at view place `place` inside the render pass that the render graph began
    /// into its target. A pass whose textures have no bind group yet, or that has no pipeline,
    /// draws nothing, and its target keeps its last image.
    pub(crate) fn record(
        &self,
        list: &mut DrawList,
        place: usize,
        pass: &Fullscreen,
    ) -> Result<(), RecordError> {
        let Some((_, _, pipeline)) = self.pipelines[place] else {
            return Ok(());
        };
        if pass.maps.any() {
            if pass.maps.group == 0 {
                return Ok(());
            }
            list.push(Op::SetBindGroup, &[1, pass.maps.group, 0])?;
        }
        list.push(Op::SetPipeline, &[pipeline])?;
        list.push(
            Op::SetBindGroup,
            &[0, self.ids.first_group + place as u32, 0],
        )?;
        list.push(Op::Draw, &[3, 1, 0, 0])?;
        Ok(())
    }

    /// Forgets the GPU objects, so the next frame makes them again, after the thread that draws
    /// replaced the GPU. The pipelines keep their ids, which the cache creates again.
    pub(crate) fn reset_gpu(&mut self) {
        self.created = false;
        self.uploaded = [None; MAX_VIEWS];
        self.bound = [None; MAX_VIEWS];
        self.fallback = [None; MAX_VIEWS];
        self.bound_layers = [[None; MAX_FALLBACK_LAYERS as usize]; MAX_VIEWS];
        self.layers_created = false;
    }
}

/// Records the creation of the uniform buffer, the linear sampler, which clamps at the edges, and
/// the blank color and depth texels.
fn create_objects(list: &mut DrawList, ids: FullscreenIds) -> Result<(), RecordError> {
    create_shared_objects(list, (ids.buffer, BUFFER_BYTES), ids.sampler)?;
    create_texel(list, ids.blank_color, format::RGBA16_FLOAT)?;
    create_texel(list, ids.blank_depth, format::R32_FLOAT)
}
