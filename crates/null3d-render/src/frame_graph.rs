//! The engine's passes on the render graph, which both frame builders declare the same way, and
//! the recording of a compiled plan: the canvas size, the plan's textures, and its render and
//! compute passes.
//!
//! # The passes
//!
//! Each view has an opaque pass, a scene pass that draws the view's objects. The camera's opaque
//! pass draws into the scene color and depth, and another view's into color and depth targets of
//! its own. On WebGPU each view also has a culling pass, a compute pass that fills the view's
//! compacted instances and indirect draws, which its opaque pass reads. On WebGL2 the job workers
//! cull each view before the frame records, so that graph has no culling passes.
//!
//! Two passes can take the scene color to the canvas. The final pass samples it and draws the
//! canvas. It has no work yet, so it stays off. The resolve pass runs instead: the render pass
//! that draws the scene resolves its multisampled color straight into the canvas, with no pass,
//! copy or target of its own.
//!
//! # Recording
//!
//! The graph compiles only after its passes change, and walking its plan allocates nothing. A
//! frame records its uploads first. [`FrameGraph::record`] then begins each render or compute pass
//! of the plan, lets the builder record the commands of each declared pass in it, and ends it. A
//! compute pass whose passes record nothing is left out.

use std::borrow::Cow;

use null3d_gpu::drawlist::{DrawList, NO_TARGET, Op, format, pass_flags, view};

use crate::frame::RecordError;
use crate::graph::{
    CANVAS, LoadOp, Pass, PassId, PassKind, Plan, PlannedTexture, RenderGraph, Size, Step,
    StepKind, StoreOp, Surface, Target,
};
use crate::pipelines::PassTargets;
use crate::view::{View, ViewId};

/// The format of the scene's color targets: the canvas's, as the shaders write sRGB-encoded color.
pub(crate) const COLOR_FORMAT: u32 = format::CANVAS;
/// The format of the scene's depth targets.
pub(crate) const DEPTH_FORMAT: u32 = format::DEPTH32_FLOAT;

/// The buffers that the culling passes read: the world matrices and the bucket tables, which the
/// frame uploads before its passes run.
const OBJECTS: &str = "objects";
/// The camera's color target, which reaches the canvas.
const SCENE_COLOR: &str = "sceneColor";

/// What a declared pass records.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Role {
    /// Culls a view on the GPU into its compacted instances and indirect draws.
    Cull(ViewId),
    /// Draws a view's opaque objects.
    Opaque(ViewId),
    /// Resolves the scene color into the canvas. It records nothing: the color attachment of its
    /// render pass resolves.
    Resolve,
    /// Draws the canvas from the scene color. It has no work yet, so it stays off.
    Final,
}

/// A name for a view's pass or resource: `camera` for the camera's view, and `other` followed by
/// the view's number for any other. It writes the digits itself, which keeps the text formatting
/// code out of the WebAssembly file.
fn view_name(view: usize, camera: &'static str, other: &str) -> Cow<'static, str> {
    if view == ViewId::CAMERA.index() {
        return Cow::Borrowed(camera);
    }
    let mut digits = [0u8; 20];
    let mut count = 0;
    let mut rest = view;
    while rest > 0 {
        digits[count] = b'0' + (rest % 10) as u8;
        count += 1;
        rest /= 10;
    }
    let mut name = String::from(other);
    for &digit in digits[..count].iter().rev() {
        name.push(char::from(digit));
    }
    Cow::Owned(name)
}

/// The render graph of a frame builder's passes, and the textures its draw lists made for the
/// compiled plan.
#[derive(Debug)]
pub(crate) struct FrameGraph {
    graph: RenderGraph,
    /// What each declared pass records, by the pass's place in the order of declaration.
    roles: Vec<Role>,
    /// MSAA samples of the scene's color and depth targets.
    samples: u32,
    /// True when the GPU culls each view in a culling pass.
    gpu_culling: bool,
    /// The number of views the declarations cover.
    views: usize,
    /// The id of the texture that holds the plan's first texture. The others follow it.
    first_texture: u32,
    /// Each texture of the plan that the draw lists made, with the size it was made at.
    made: Vec<(PlannedTexture, (u32, u32))>,
    /// The canvas size the draw lists set last, or `(0, 0)` before any.
    canvas: (u32, u32),
}

impl FrameGraph {
    /// A graph with no passes yet. The first [`FrameGraph::sync_views`] declares them. Its
    /// textures take ids from `first_texture` on.
    pub(crate) fn new(samples: u32, gpu_culling: bool, first_texture: u32) -> Self {
        Self {
            graph: RenderGraph::new(),
            roles: Vec::new(),
            samples,
            gpu_culling,
            views: 0,
            first_texture,
            made: Vec::new(),
            canvas: (0, 0),
        }
    }

    /// The render graph.
    pub(crate) fn graph(&self) -> &RenderGraph {
        &self.graph
    }

    /// What the scene's render pipelines and bundles draw into: the scene's color and depth
    /// formats and its sample count. The scene sets no permutation bits of its own.
    pub(crate) fn scene_targets(&self) -> PassTargets {
        PassTargets {
            color_format: COLOR_FORMAT,
            depth_format: DEPTH_FORMAT,
            samples: self.samples,
            permutation: 0,
        }
    }

    /// Declares the passes again when the number of views changed.
    pub(crate) fn sync_views(&mut self, views: &[View]) {
        if views.len() != self.views {
            self.declare(views);
        }
    }

    fn add(&mut self, pass: Pass, role: Role) -> PassId {
        self.roles.push(role);
        self.graph.add_pass(pass)
    }

    /// Declares the engine's passes for `views`: each view's culling pass on WebGPU, each view's
    /// opaque pass, then the resolve pass and the final pass, which is off.
    fn declare(&mut self, views: &[View]) {
        self.graph.clear();
        self.roles.clear();
        let color = Target::color(COLOR_FORMAT).samples(self.samples);
        let depth = Target::depth(DEPTH_FORMAT).samples(self.samples);
        if self.gpu_culling {
            self.graph.import_buffer(OBJECTS);
            for index in 0..views.len() {
                let pass = Pass::new(view_name(index, "Culling", "Culling"), PassKind::Compute)
                    .reads(OBJECTS)
                    .creates_buffer(view_name(index, "visible", "visible"));
                self.add(pass, Role::Cull(ViewId::from_index(index)));
            }
        }
        for (index, view) in views.iter().enumerate() {
            let mut pass = Pass::new(view_name(index, "Opaque", "Opaque"), PassKind::Scene)
                .layers(view.layers())
                .creates(view_name(index, SCENE_COLOR, "color"), color)
                .creates(view_name(index, "sceneDepth", "depth"), depth);
            if self.gpu_culling {
                pass = pass.reads(view_name(index, "visible", "visible"));
            }
            self.add(pass, Role::Opaque(ViewId::from_index(index)));
        }
        let resolve = Pass::new("Resolve", PassKind::Resolve)
            .reads(SCENE_COLOR)
            .writes(CANVAS);
        self.add(resolve, Role::Resolve);
        let final_pass = Pass::new("Final", PassKind::Fullscreen)
            .size(Size::Canvas)
            .reads(SCENE_COLOR)
            .writes(CANVAS);
        let final_pass = self.add(final_pass, Role::Final);
        self.graph.set_enabled(final_pass, false);
        self.views = views.len();
    }

    /// Compiles the graph if its passes changed, then sets the canvas size and makes the plan's
    /// textures where the canvas or the plan changed, so the frame's targets match the canvas.
    pub(crate) fn prepare(
        &mut self,
        list: &mut DrawList,
        canvas: (u32, u32),
    ) -> Result<(), RecordError> {
        let compiled = self.graph.compile().map_err(RecordError::Graph)?;
        let canvas = (canvas.0.max(1), canvas.1.max(1));
        let resized = canvas != self.canvas;
        if resized {
            list.push(Op::ResizeCanvas, &[canvas.0, canvas.1])?;
            self.canvas = canvas;
        }
        if compiled || resized {
            self.make_textures(list)?;
        }
        Ok(())
    }

    /// Makes each texture of the plan whose shape or size differs from what the draw lists made,
    /// and releases the textures the plan no longer has.
    fn make_textures(&mut self, list: &mut DrawList) -> Result<(), RecordError> {
        let textures = self
            .graph
            .plan()
            .expect("the graph compiled before its textures are made")
            .textures();
        for (index, texture) in textures.iter().enumerate() {
            let made = (*texture, texture.size.extent(self.canvas));
            if self.made.get(index) == Some(&made) {
                continue;
            }
            let (width, height) = made.1;
            let target = texture.target;
            let binding = if target.layers > 1 {
                view::D2_ARRAY
            } else {
                view::D2
            };
            list.push(
                Op::CreateTexture,
                &[
                    self.first_texture + index as u32,
                    width,
                    height,
                    target.layers,
                    target.format,
                    texture.usage,
                    target.samples,
                    1,
                    binding,
                ],
            )?;
            match self.made.get_mut(index) {
                Some(slot) => *slot = made,
                None => self.made.push(made),
            }
        }
        for index in textures.len()..self.made.len() {
            list.push(Op::DestroyTexture, &[self.first_texture + index as u32])?;
        }
        self.made.truncate(textures.len());
        Ok(())
    }

    /// Records the plan's render and compute passes, then submits them. `record` records the
    /// commands of each declared pass. Each render pass clears its color targets to `clear`.
    pub(crate) fn record(
        &self,
        list: &mut DrawList,
        clear: [f32; 4],
        mut record: impl FnMut(&mut DrawList, Role) -> Result<(), RecordError>,
    ) -> Result<(), RecordError> {
        let plan = self
            .graph
            .plan()
            .expect("the graph compiled before the frame records");
        for step in plan.steps() {
            match step.kind {
                StepKind::Compute => {
                    let start = list.len();
                    list.push(Op::BeginComputePass, &[])?;
                    let begun = list.len();
                    for &pass in plan.passes(step) {
                        record(list, self.roles[pass.index()])?;
                    }
                    if list.len() == begun {
                        list.truncate(start);
                    } else {
                        list.push(Op::EndComputePass, &[])?;
                    }
                }
                StepKind::Render { .. } => {
                    self.begin_render_pass(list, plan, step, clear)?;
                    for &pass in plan.passes(step) {
                        record(list, self.roles[pass.index()])?;
                    }
                    list.push(Op::EndRenderPass, &[])?;
                }
            }
        }
        list.push(Op::Submit, &[])?;
        Ok(())
    }

    /// Begins a render pass with the step's attachments and their load and store operations.
    /// Depth clears to 0, the far plane of reversed depth.
    fn begin_render_pass(
        &self,
        list: &mut DrawList,
        plan: &Plan,
        step: &Step,
        clear: [f32; 4],
    ) -> Result<(), RecordError> {
        let (mut color, mut resolve, mut depth) = (NO_TARGET, NO_TARGET, NO_TARGET);
        let mut flags = 0;
        for attachment in plan.attachments(step) {
            debug_assert!(
                attachment.layer == 0,
                "render targets are textures of one layer"
            );
            let (clears, stores) = if attachment.depth {
                depth = self.texture_id(attachment.texture);
                (pass_flags::CLEAR_DEPTH, pass_flags::STORE_DEPTH)
            } else {
                debug_assert!(
                    color == NO_TARGET,
                    "a render pass draws into one color target"
                );
                color = self.texture_id(attachment.texture);
                resolve = attachment
                    .resolve
                    .map_or(NO_TARGET, |into| self.texture_id(into));
                (pass_flags::CLEAR_COLOR, pass_flags::STORE_COLOR)
            };
            if attachment.load == LoadOp::Clear {
                flags |= clears;
            }
            if attachment.store == StoreOp::Store {
                flags |= stores;
            }
        }
        let [r, g, b, a] = clear;
        list.push(
            Op::BeginRenderPass,
            &[
                color,
                resolve,
                depth,
                r.to_bits(),
                g.to_bits(),
                b.to_bits(),
                a.to_bits(),
                0f32.to_bits(),
                flags,
            ],
        )?;
        Ok(())
    }

    /// The draw list's id of a surface: 0 for the canvas.
    fn texture_id(&self, surface: Surface) -> u32 {
        match surface {
            Surface::Canvas => 0,
            Surface::Texture(index) => self.first_texture + u32::from(index),
        }
    }

    /// Forgets the canvas size and the textures the draw lists made, so the next frame sets the
    /// size and makes every texture again, after the thread that draws replaced the GPU.
    pub(crate) fn reset_gpu(&mut self) {
        self.made.clear();
        self.canvas = (0, 0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn views_after_the_camera_take_their_number_in_their_names() {
        assert_eq!(view_name(0, "sceneColor", "color"), "sceneColor");
        assert_eq!(view_name(1, "sceneColor", "color"), "color1");
        assert_eq!(view_name(10, "Opaque", "Opaque"), "Opaque10");
        assert_eq!(view_name(31, "Opaque", "Opaque"), "Opaque31");
    }

    #[test]
    fn each_view_adds_its_passes_and_the_final_pass_stays_off() {
        let mut frames = FrameGraph::new(4, true, 1);
        frames.sync_views(&[View::default(), View::default()]);
        let graph = frames.graph();
        let names = [
            "Culling", "Culling1", "Opaque", "Opaque1", "Resolve", "Final",
        ];
        assert_eq!(graph.pass_count(), names.len());
        for (place, name) in names.into_iter().enumerate() {
            assert_eq!(graph.find_pass(name).map(PassId::index), Some(place));
        }
        assert_eq!(
            frames.roles,
            [
                Role::Cull(ViewId::CAMERA),
                Role::Cull(ViewId::from_index(1)),
                Role::Opaque(ViewId::CAMERA),
                Role::Opaque(ViewId::from_index(1)),
                Role::Resolve,
                Role::Final,
            ]
        );
        let final_pass = graph.find_pass("Final").unwrap();
        assert!(!graph.is_enabled(final_pass));

        // The WebGL2 path culls on the job workers, so its graph has no culling passes.
        let mut frames = FrameGraph::new(4, false, 1);
        frames.sync_views(&[View::default()]);
        assert_eq!(frames.graph().pass_count(), 3);
        assert_eq!(frames.roles[0], Role::Opaque(ViewId::CAMERA));
    }
}
