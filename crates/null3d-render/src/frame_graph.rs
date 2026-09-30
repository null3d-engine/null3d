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
//! Two passes can take the scene color to the canvas, and the scene color's format picks one (see
//! [`crate::output`]). On the HDR path the final pass samples the scene color and draws the canvas:
//! it applies the exposure and the tone mapping, and encodes the color. On the 8-bit path the
//! scene shaders did that already, so the resolve pass runs instead: the render pass that draws
//! the scene resolves its multisampled color straight into the canvas, with no pass, copy or
//! target of its own.
//!
//! # Recording
//!
//! The graph compiles only after its passes change, and walking its plan allocates nothing. A
//! frame records its uploads first, the final pass's settings among them. [`FrameGraph::record`]
//! then begins each render or compute pass of the plan, records the final pass, lets the builder
//! record the commands of each other declared pass, and ends it. A compute pass whose passes
//! record nothing is left out.

use std::borrow::Cow;

use null3d_gpu::drawlist::{DrawList, NO_TARGET, Op, format, pass_flags, view};

use crate::final_pass::{FinalIds, FinalPass};
use crate::frame::{RecordError, UploadArena};
use crate::graph::{
    CANVAS, LoadOp, Pass, PassId, PassKind, Plan, PlannedTexture, RenderGraph, Size, Step,
    StepKind, StoreOp, Surface, Target,
};
use crate::output::{Output, SceneColor};
use crate::view::{View, ViewId};

/// The format of the scene's depth targets.
pub(crate) const DEPTH_FORMAT: u32 = format::DEPTH32_FLOAT;

/// What the scene's render pipelines and bundles draw into: the scene color's format, the depth
/// format and the sample count. The scene color also sets the pipelines' permutation bits.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct SceneTargets {
    pub(crate) color: u32,
    pub(crate) depth: u32,
    pub(crate) samples: u32,
    permutation: u32,
}

impl SceneTargets {
    const fn new(scene_color: SceneColor, samples: u32) -> Self {
        Self {
            color: scene_color.format(),
            depth: DEPTH_FORMAT,
            samples,
            permutation: scene_color.permutation(),
        }
    }

    /// Records the creation of render pipeline `id` from `template`, with the scene color's
    /// permutation bits and `bits` besides, drawing into these targets.
    pub(crate) fn create_pipeline(
        self,
        list: &mut DrawList,
        id: u32,
        template: u32,
        bits: u32,
    ) -> Result<(), RecordError> {
        list.push(
            Op::CreateRenderPipeline,
            &[
                id,
                template,
                self.permutation | bits,
                self.color,
                self.depth,
                self.samples,
                0,
            ],
        )?;
        Ok(())
    }
}

/// The GPU object ids that a frame builder gives its graph: its textures take ids from
/// `first_texture` on, and the final pass has its own.
#[derive(Clone, Copy, Debug)]
pub(crate) struct GraphIds {
    pub(crate) first_texture: u32,
    pub(crate) final_pass: FinalIds,
}

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
    /// Resolves the scene color into the canvas on the 8-bit path. It records nothing: the color
    /// attachment of its render pass resolves.
    Resolve,
    /// Tone maps the HDR scene color into the canvas. The graph records it itself.
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

/// The render graph of a frame builder's passes, the textures its draw lists made for the compiled
/// plan, and the final pass.
#[derive(Debug)]
pub(crate) struct FrameGraph {
    graph: RenderGraph,
    /// What each declared pass records, by the pass's place in the order of declaration.
    roles: Vec<Role>,
    /// MSAA samples of the scene's color and depth targets.
    samples: u32,
    /// True when the GPU culls each view in a culling pass.
    gpu_culling: bool,
    /// The format of the scene's color targets, which picks the final pass or the resolve pass.
    scene_color: SceneColor,
    /// The number of views the declarations cover.
    views: usize,
    /// The id of the texture that holds the plan's first texture. The others follow it.
    first_texture: u32,
    /// Each texture of the plan that the draw lists made, with the size it was made at.
    made: Vec<(PlannedTexture, (u32, u32))>,
    /// True when the frame being recorded made or released a texture of the plan.
    textures_made: bool,
    /// The canvas size the draw lists set last, or `(0, 0)` before any.
    canvas: (u32, u32),
    final_pass: FinalPass,
}

impl FrameGraph {
    /// A graph with no passes yet. The first [`FrameGraph::sync_views`] declares them. The scene's
    /// color and depth targets have `samples` MSAA samples, and scene passes draw color in the
    /// format of `scene_color`.
    pub(crate) fn new(
        samples: u32,
        gpu_culling: bool,
        scene_color: SceneColor,
        ids: GraphIds,
    ) -> Self {
        Self {
            graph: RenderGraph::new(),
            roles: Vec::new(),
            samples,
            gpu_culling,
            scene_color,
            views: 0,
            first_texture: ids.first_texture,
            made: Vec::new(),
            textures_made: false,
            canvas: (0, 0),
            final_pass: FinalPass::new(ids.final_pass),
        }
    }

    /// The render graph.
    pub(crate) fn graph(&self) -> &RenderGraph {
        &self.graph
    }

    /// What the scene's render pipelines and bundles draw into.
    pub(crate) fn scene_targets(&self) -> SceneTargets {
        SceneTargets::new(self.scene_color, self.samples)
    }

    /// Bytes that one frame may copy into its arena for the graph's own passes.
    pub(crate) fn upload_bound(&self) -> usize {
        if self.scene_color.is_hdr() {
            FinalPass::UPLOAD_BYTES
        } else {
            0
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
    /// opaque pass, then the resolve pass and the final pass, of which the scene color's format
    /// switches one on.
    fn declare(&mut self, views: &[View]) {
        self.graph.clear();
        self.roles.clear();
        let color = Target::color(self.scene_color.format()).samples(self.samples);
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
        let resolve = self.add(resolve, Role::Resolve);
        let final_pass = Pass::new("Final", PassKind::Fullscreen)
            .size(Size::Canvas)
            .reads(SCENE_COLOR)
            .writes(CANVAS);
        let final_pass = self.add(final_pass, Role::Final);
        let hdr = self.scene_color.is_hdr();
        self.graph.set_enabled(resolve, !hdr);
        self.graph.set_enabled(final_pass, hdr);
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
        self.textures_made = (compiled || resized) && self.make_textures(list)?;
        Ok(())
    }

    /// Records what the graph's own passes need before the frame's passes, from copies in the
    /// frame's arena: on the HDR path, the final pass's objects, its settings when they changed,
    /// and its binding of the scene color when the frame made the plan's textures. Call it after
    /// [`FrameGraph::prepare`].
    pub(crate) fn upload(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        output: Output,
    ) -> Result<(), RecordError> {
        if !self.scene_color.is_hdr() {
            return Ok(());
        }
        let plan = self
            .graph
            .plan()
            .expect("the graph compiled before the frame uploads");
        let scene_color = self
            .graph
            .find_resource(SCENE_COLOR)
            .and_then(|resource| plan.sampled_texture_of(resource))
            .map(|surface| self.texture_id(surface))
            .expect("the final pass samples the scene color");
        self.final_pass.prepare(
            list,
            arena,
            output.uniform(),
            scene_color,
            self.textures_made,
        )
    }

    /// Makes each texture of the plan whose shape or size differs from what the draw lists made,
    /// and releases the textures the plan no longer has. Returns true when it made or released
    /// any.
    fn make_textures(&mut self, list: &mut DrawList) -> Result<bool, RecordError> {
        let start = list.len();
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
        Ok(list.len() != start)
    }

    /// Records the plan's render and compute passes, then submits them. The graph records the
    /// final pass, and `record` the commands of each other declared pass. Each render pass clears
    /// its color targets to `clear`.
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
                        match self.roles[pass.index()] {
                            Role::Final => self.final_pass.record(list)?,
                            role => record(list, role)?,
                        }
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

    /// Forgets the canvas size, the textures the draw lists made and the final pass's objects, so
    /// the next frame makes them all again, after the thread that draws replaced the GPU.
    pub(crate) fn reset_gpu(&mut self) {
        self.made.clear();
        self.canvas = (0, 0);
        self.final_pass.reset_gpu();
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

    const IDS: GraphIds = GraphIds {
        first_texture: 1,
        final_pass: FinalIds {
            pipeline: 9,
            settings: 9,
            group: 9,
        },
    };

    #[test]
    fn each_view_adds_its_passes_and_the_8_bit_path_resolves_into_the_canvas() {
        let mut frames = FrameGraph::new(4, true, SceneColor::EIGHT_BIT, IDS);
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
        assert!(graph.is_enabled(graph.find_pass("Resolve").unwrap()));
        assert_eq!(frames.upload_bound(), 0);

        // The WebGL2 path culls on the job workers, so its graph has no culling passes.
        let mut frames = FrameGraph::new(4, false, SceneColor::EIGHT_BIT, IDS);
        frames.sync_views(&[View::default()]);
        assert_eq!(frames.graph().pass_count(), 3);
        assert_eq!(frames.roles[0], Role::Opaque(ViewId::CAMERA));
    }

    #[test]
    fn hdr_color_runs_the_final_pass_instead_of_the_resolve_pass() {
        for hdr in [format::RGBA16_FLOAT, format::RG11B10_UFLOAT] {
            let mut frames = FrameGraph::new(4, false, SceneColor::from_format(hdr), IDS);
            frames.sync_views(&[View::default()]);
            let graph = &mut frames.graph;
            assert!(graph.compile().unwrap());
            assert!(graph.is_enabled(graph.find_pass("Final").unwrap()));
            assert!(!graph.is_enabled(graph.find_pass("Resolve").unwrap()));
            let plan = graph.plan().unwrap();
            // The scene's render pass resolves the multisampled color into a texture of one
            // sample, which the final pass reads in a render pass of its own into the canvas.
            let textures: Vec<_> = plan.textures().iter().map(|t| t.target).collect();
            assert!(textures.contains(&Target::color(hdr).samples(4)));
            assert!(textures.contains(&Target::color(hdr)));
            let scene = graph.find_resource(SCENE_COLOR).unwrap();
            assert!(matches!(
                plan.sampled_texture_of(scene),
                Some(Surface::Texture(_))
            ));
            assert_eq!(plan.steps().len(), 2);
            assert_eq!(frames.upload_bound(), FinalPass::UPLOAD_BYTES);
        }
    }
}
