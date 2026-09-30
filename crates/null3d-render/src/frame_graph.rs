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
//! The debug lines pass draws the lines that the sketch drew (see [`crate::debug_lines`]) into the
//! scene color and depth, after the camera's opaque pass and in its render pass. It is on only in
//! frames with lines, so the plan of a frame without them has no such pass.
//!
//! Two passes can take the scene color to the canvas (see [`crate::output`]). The final pass
//! samples the scene color and draws the canvas. On the HDR path it applies the exposure and the
//! tone mapping, and encodes the color. On the 8-bit path the scene shaders did that already, so
//! it only copies the color. There, while the render scale stays at the whole canvas, the resolve
//! pass runs instead: the render pass that draws the scene resolves its multisampled color straight
//! into the canvas, with no pass, copy or target of its own.
//!
//! # Render scale
//!
//! Passes of a relative size draw into the top-left corner of their targets at the render scale,
//! through the viewport and the scissor. The targets keep the canvas's size, so a new scale makes
//! no texture. The final pass scales the corner up to the whole canvas.
//!
//! # Recording
//!
//! The graph compiles only after its passes change, and walking its plan allocates nothing. A
//! frame records its uploads first, the final pass's settings among them. [`FrameGraph::record`]
//! then begins each render or compute pass of the plan, records the final pass, lets the builder
//! record the commands of each other declared pass in it, and ends it. A compute pass whose passes
//! record nothing is left out.
//!
//! A pass draws into one layer of an array target through a view of that layer. The draw lists
//! make a view of each layer beside each such texture of the plan, with ids of their own after the
//! textures' ids.

use std::borrow::Cow;

use null3d_gpu::drawlist::{DrawList, NO_TARGET, Op, format, pass_flags, texture_usage, view};

use crate::final_pass::{FinalIds, FinalPass};
use crate::frame::{RecordError, UploadArena};
use crate::graph::{
    CANVAS, LoadOp, Pass, PassId, PassKind, Plan, PlannedTexture, RenderGraph, RenderScale, Size,
    Step, StepKind, StoreOp, Surface, Target,
};
use crate::output::{Output, SceneColor};
use crate::pipelines::{PassTargets, PipelineCache};
use crate::view::{View, ViewId};

/// The format of the scene's depth targets.
pub(crate) const DEPTH_FORMAT: u32 = format::DEPTH32_FLOAT;

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
/// The camera's depth target.
const SCENE_DEPTH: &str = "sceneDepth";
/// Ids after the first texture's that the views of layers take: the plan's textures take the ones
/// below.
const LAYER_VIEWS: u32 = 128;
/// No views of layers: a texture that no pass draws into by layer.
const NO_VIEWS: u32 = u32::MAX;

/// What a declared pass records.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Role {
    /// Culls a view on the GPU into its compacted instances and indirect draws.
    Cull(ViewId),
    /// Draws a view's opaque objects.
    Opaque(ViewId),
    /// Draws the frame's debug lines into the camera's view.
    DebugLines,
    /// Resolves the scene color into the canvas on the 8-bit path, at the whole canvas's scale. It
    /// records nothing: the color attachment of its render pass resolves.
    Resolve,
    /// Takes the scene color to the whole canvas: it tone maps HDR color, and scales the render
    /// scale's corner up. The graph records it itself.
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
    /// Each view's opaque pass, by view.
    opaque: Vec<PassId>,
    /// MSAA samples of the scene's color and depth targets.
    samples: u32,
    /// True when the GPU culls each view in a culling pass.
    gpu_culling: bool,
    /// The format of the scene's color targets, which picks the final pass or the resolve pass.
    scene_color: SceneColor,
    /// True when the render scale may drop below the whole canvas, so the 8-bit path needs the
    /// final pass to scale the image up.
    scales: bool,
    /// The render scale of the frame being recorded.
    scale: RenderScale,
    /// The final pass and the resolve pass, once declared.
    outputs: Option<(PassId, PassId)>,
    /// The number of views the declarations cover.
    views: usize,
    /// The debug lines pass, once the passes are declared.
    debug_lines: Option<PassId>,
    /// The id of the texture that holds the plan's first texture. The others follow it.
    first_texture: u32,
    /// Each texture of the plan that the draw lists made, with the size it was made at.
    made: Vec<(PlannedTexture, (u32, u32))>,
    /// True when the frame being recorded made or released a texture of the plan.
    textures_made: bool,
    /// The canvas size the draw lists set last, or `(0, 0)` before any.
    canvas: (u32, u32),
    /// For each texture of the plan, the first of the views of its layers, counted from the views'
    /// first id, or [`NO_VIEWS`].
    layer_views: Vec<u32>,
    /// The views of layers that the draw lists made.
    made_views: u32,
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
            opaque: Vec::new(),
            samples,
            gpu_culling,
            scene_color,
            scales: false,
            scale: RenderScale::FULL,
            outputs: None,
            views: 0,
            debug_lines: None,
            first_texture: ids.first_texture,
            made: Vec::new(),
            textures_made: false,
            canvas: (0, 0),
            layer_views: Vec::new(),
            made_views: 0,
            final_pass: FinalPass::new(ids.final_pass),
        }
    }

    /// The render graph.
    pub(crate) fn graph(&self) -> &RenderGraph {
        &self.graph
    }

    /// What the scene's render pipelines and bundles draw into: the scene color's format, the depth
    /// format and the sample count, with the permutation bits that the scene color sets.
    pub(crate) fn scene_targets(&self) -> PassTargets {
        PassTargets {
            color_format: self.scene_color.format(),
            depth_format: DEPTH_FORMAT,
            samples: self.samples,
            permutation: self.scene_color.permutation(),
        }
    }

    /// Bytes that one frame may copy into its arena for the graph's own passes.
    pub(crate) fn upload_bound(&self) -> usize {
        FinalPass::UPLOAD_BYTES
    }

    /// True when the resolve pass takes the scene color to the canvas instead of the final pass:
    /// on the 8-bit path, while the render scale cannot drop below the whole canvas.
    fn resolves_to_canvas(&self) -> bool {
        !self.scene_color.is_hdr() && !self.scales
    }

    /// Says whether the render scale may drop below the whole canvas. On the 8-bit path that
    /// switches the final pass on in place of the resolve pass, and the graph compiles again.
    pub(crate) fn set_scaling(&mut self, scales: bool) {
        self.scales = scales;
        self.enable_outputs();
    }

    /// Switches on the pass that takes the scene color to the canvas, and off the other.
    fn enable_outputs(&mut self) {
        if let Some((final_pass, resolve)) = self.outputs {
            let resolves = self.resolves_to_canvas();
            self.graph.set_enabled(resolve, resolves);
            self.graph.set_enabled(final_pass, !resolves);
        }
    }

    /// Declares the passes again when the number of views changed, and gives each view's opaque
    /// pass the view's layers, which change without a new plan.
    pub(crate) fn sync_views(&mut self, views: &[View]) {
        if views.len() != self.views {
            self.declare(views);
        }
        for (&pass, view) in self.opaque.iter().zip(views) {
            self.graph.set_layers(pass, view.layers());
        }
    }

    /// Switches the debug lines pass on for a frame with lines, and off for one without. The
    /// graph compiles again only when that changes.
    pub(crate) fn set_debug_lines(&mut self, on: bool) {
        if let Some(pass) = self.debug_lines {
            self.graph.set_enabled(pass, on);
        }
    }

    fn add(&mut self, pass: Pass, role: Role) -> PassId {
        self.roles.push(role);
        self.graph.add_pass(pass)
    }

    /// Declares the engine's passes for `views`: each view's culling pass on WebGPU, each view's
    /// opaque pass, the debug lines pass, which is off, then the resolve pass and the final pass,
    /// of which the scene color's format switches one on.
    fn declare(&mut self, views: &[View]) {
        self.graph.clear();
        self.roles.clear();
        self.opaque.clear();
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
                .creates(view_name(index, SCENE_DEPTH, "depth"), depth);
            if self.gpu_culling {
                pass = pass.reads(view_name(index, "visible", "visible"));
            }
            let pass = self.add(pass, Role::Opaque(ViewId::from_index(index)));
            self.opaque.push(pass);
        }
        let lines = Pass::new("DebugLines", PassKind::Scene)
            .writes(SCENE_COLOR)
            .writes(SCENE_DEPTH);
        let lines = self.add(lines, Role::DebugLines);
        self.graph.set_enabled(lines, false);
        self.debug_lines = Some(lines);
        let resolve = Pass::new("Resolve", PassKind::Resolve)
            .reads(SCENE_COLOR)
            .writes(CANVAS);
        let resolve = self.add(resolve, Role::Resolve);
        let final_pass = Pass::new("Final", PassKind::Fullscreen)
            .size(Size::Canvas)
            .reads(SCENE_COLOR)
            .writes(CANVAS);
        let final_pass = self.add(final_pass, Role::Final);
        self.outputs = Some((final_pass, resolve));
        self.enable_outputs();
        self.views = views.len();
    }

    /// Compiles the graph if its passes changed, then sets the canvas size and makes the plan's
    /// textures where the canvas or the plan changed, so the frame's targets match the canvas. The
    /// frame draws at render scale `scale`, which makes no texture.
    pub(crate) fn prepare(
        &mut self,
        list: &mut DrawList,
        canvas: (u32, u32),
        scale: RenderScale,
    ) -> Result<(), RecordError> {
        self.scale = if self.resolves_to_canvas() {
            RenderScale::FULL
        } else {
            scale
        };
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

    /// Asks `pipelines` for the pipelines of the graph's own passes: the final pass's. A builder
    /// asks before it records the pipelines that its frame creates. On the 8-bit path, frames
    /// that resolve into the canvas ask too, so the pipeline is ready once the render scale can
    /// drop.
    pub(crate) fn request_pipelines(&mut self, pipelines: &mut PipelineCache) {
        self.final_pass.request_pipeline(pipelines);
    }

    /// Records what the graph's own passes need before the frame's passes, from copies in the
    /// frame's arena: the final pass's objects, its settings when they changed, and its binding of
    /// the scene color when the frame made the plan's textures. Call it after
    /// [`FrameGraph::prepare`].
    pub(crate) fn upload(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        output: Output,
    ) -> Result<(), RecordError> {
        if self.resolves_to_canvas() {
            return Ok(());
        }
        let mut settings = output.uniform();
        settings.set_display_color(!self.scene_color.is_hdr());
        settings.set_render_size(Size::Full.viewport(self.canvas, self.scale));
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
        self.final_pass
            .prepare(list, arena, settings, scene_color, self.textures_made)
    }

    /// Makes each texture of the plan whose shape or size differs from what the draw lists made,
    /// with the views of its layers where passes draw into it by layer, and releases the textures
    /// and views the plan no longer has. Returns true when it made or released any.
    fn make_textures(&mut self, list: &mut DrawList) -> Result<bool, RecordError> {
        let start = list.len();
        let textures = self
            .graph
            .plan()
            .expect("the graph compiled before its textures are made")
            .textures();
        let mut views = 0;
        for (index, texture) in textures.iter().enumerate() {
            let made = (*texture, texture.size.extent(self.canvas));
            let target = texture.target;
            let by_layer =
                target.is_array() && texture.usage & texture_usage::RENDER_ATTACHMENT != 0;
            let first_view = if by_layer { views } else { NO_VIEWS };
            if by_layer {
                views += target.layers;
            }
            let moved = self.layer_views.get(index) != Some(&first_view);
            match self.layer_views.get_mut(index) {
                Some(slot) => *slot = first_view,
                None => self.layer_views.push(first_view),
            }
            let remade = self.made.get(index) != Some(&made);
            if remade {
                create_texture(list, self.first_texture + index as u32, made)?;
                match self.made.get_mut(index) {
                    Some(slot) => *slot = made,
                    None => self.made.push(made),
                }
            }
            if by_layer && (remade || moved) {
                let texture_id = self.first_texture + index as u32;
                for layer in 0..target.layers {
                    let view_id = self.view_id(first_view, layer);
                    list.push(Op::CreateTextureView, &[view_id, texture_id, 0, layer])?;
                }
            }
        }
        debug_assert!(
            textures.len() as u32 <= LAYER_VIEWS && views <= LAYER_VIEWS,
            "the plan's textures and views fit the ids the graph has"
        );
        for view in views..self.made_views {
            list.push(Op::DestroyTexture, &[self.view_id(view, 0)])?;
        }
        self.made_views = views;
        self.layer_views.truncate(textures.len());
        for index in textures.len()..self.made.len() {
            list.push(Op::DestroyTexture, &[self.first_texture + index as u32])?;
        }
        self.made.truncate(textures.len());
        Ok(list.len() != start)
    }

    /// The id of the view of `layer` of a texture whose views start at `first_view`.
    fn view_id(&self, first_view: u32, layer: u32) -> u32 {
        self.first_texture + LAYER_VIEWS + first_view + layer
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
                StepKind::Render { size, .. } => {
                    self.begin_render_pass(list, plan, step, clear)?;
                    self.set_render_area(list, size)?;
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
            let (clears, stores) = if attachment.depth {
                depth = self.attachment_id(attachment.texture, attachment.layer);
                (pass_flags::CLEAR_DEPTH, pass_flags::STORE_DEPTH)
            } else {
                debug_assert!(
                    color == NO_TARGET,
                    "a render pass draws into one color target"
                );
                color = self.attachment_id(attachment.texture, attachment.layer);
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

    /// Limits the render pass to the corner of its targets that a step of `size` draws into at the
    /// frame's render scale. A render pass starts with its whole targets, so a step that draws
    /// into all of them records nothing.
    fn set_render_area(&self, list: &mut DrawList, size: Size) -> Result<(), RecordError> {
        let (width, height) = size.viewport(self.canvas, self.scale);
        if (width, height) == size.extent(self.canvas) {
            return Ok(());
        }
        list.push(
            Op::SetViewport,
            &[0, 0, width, height, 0f32.to_bits(), 1f32.to_bits()],
        )?;
        list.push(Op::SetScissor, &[0, 0, width, height])?;
        Ok(())
    }

    /// The draw list's id of a surface: 0 for the canvas.
    fn texture_id(&self, surface: Surface) -> u32 {
        match surface {
            Surface::Canvas => 0,
            Surface::Texture(index) => self.first_texture + u32::from(index),
        }
    }

    /// The draw list's id of what a render pass draws into: a surface, or the view of one of its
    /// layers where passes draw into it by layer.
    fn attachment_id(&self, surface: Surface, layer: u32) -> u32 {
        match surface {
            Surface::Texture(index) => match self.layer_views.get(usize::from(index)) {
                Some(&first) if first != NO_VIEWS => self.view_id(first, layer),
                _ => {
                    debug_assert!(layer == 0, "a pass draws into a layer through a view");
                    self.texture_id(surface)
                }
            },
            Surface::Canvas => 0,
        }
    }

    /// Forgets the canvas size, the textures and views the draw lists made and the final pass's
    /// objects, so the next frame makes them all again, after the thread that draws replaced the
    /// GPU.
    pub(crate) fn reset_gpu(&mut self) {
        self.made.clear();
        self.layer_views.clear();
        self.made_views = 0;
        self.canvas = (0, 0);
        self.final_pass.reset_gpu();
    }
}

/// Records the creation of a plan's texture under `id`, with its shape and the size it takes,
/// `made`. Bind groups see an array target as an array, whatever its layer count.
fn create_texture(
    list: &mut DrawList,
    id: u32,
    (texture, (width, height)): (PlannedTexture, (u32, u32)),
) -> Result<(), RecordError> {
    let target = texture.target;
    let binding = if target.is_array() {
        view::D2_ARRAY
    } else {
        view::D2
    };
    list.push(
        Op::CreateTexture,
        &[
            id,
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
    Ok(())
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
            "Culling",
            "Culling1",
            "Opaque",
            "Opaque1",
            "DebugLines",
            "Resolve",
            "Final",
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
                Role::DebugLines,
                Role::Resolve,
                Role::Final,
            ]
        );
        for off in ["DebugLines", "Final"] {
            assert!(!graph.is_enabled(graph.find_pass(off).unwrap()), "{off}");
        }
        assert!(graph.is_enabled(graph.find_pass("Resolve").unwrap()));

        // A render scale that can drop needs the final pass to scale the image up.
        frames.set_scaling(true);
        let graph = frames.graph();
        assert!(graph.is_enabled(graph.find_pass("Final").unwrap()));
        assert!(!graph.is_enabled(graph.find_pass("Resolve").unwrap()));

        // The WebGL2 path culls on the job workers, so its graph has no culling passes.
        let mut frames = FrameGraph::new(4, false, SceneColor::EIGHT_BIT, IDS);
        frames.sync_views(&[View::default()]);
        assert_eq!(frames.graph().pass_count(), 4);
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

    /// The names of the passes in each step of the compiled plan.
    fn steps(frames: &FrameGraph) -> Vec<Vec<String>> {
        let graph = frames.graph();
        let plan = graph.plan().expect("the graph compiled");
        plan.steps()
            .iter()
            .map(|step| {
                plan.passes(step)
                    .iter()
                    .map(|&pass| graph.pass_name(pass).to_owned())
                    .collect()
            })
            .collect()
    }

    #[test]
    fn debug_lines_join_the_camera_render_pass_only_in_frames_with_lines() {
        let mut frames = FrameGraph::new(4, true, SceneColor::EIGHT_BIT, IDS);
        frames.sync_views(&[View::default(), View::default()]);
        let mut list = DrawList::with_capacity(256);
        frames
            .prepare(&mut list, (64, 64), RenderScale::FULL)
            .unwrap();
        let without = steps(&frames);
        assert_eq!(
            without,
            [
                vec!["Culling", "Culling1"],
                vec!["Opaque", "Resolve"],
                vec!["Opaque1"]
            ]
        );

        frames.set_debug_lines(true);
        frames
            .prepare(&mut list, (64, 64), RenderScale::FULL)
            .unwrap();
        assert_eq!(
            steps(&frames)[1],
            ["Opaque", "DebugLines", "Resolve"],
            "the lines draw over the camera's opaque objects, before the color resolves"
        );
        // The lines change no texture of the plan.
        list.clear();
        frames.set_debug_lines(false);
        frames
            .prepare(&mut list, (64, 64), RenderScale::FULL)
            .unwrap();
        assert_eq!(steps(&frames), without);
        assert!(list.is_empty(), "switching the lines makes no texture");
    }

    /// The operands of each command of a list with `op`.
    fn operands(list: &DrawList, op: Op) -> Vec<Vec<u32>> {
        null3d_gpu::drawlist::decode(list.words())
            .map(|command| command.unwrap())
            .filter(|command| command.op == op)
            .map(|command| command.operands.to_vec())
            .collect()
    }

    /// A camera's passes, then a kept depth array of `layers` layers that a pass per layer draws
    /// into and a pass after them samples. The test passes take the role of the resolve pass,
    /// which records nothing of its own.
    fn layered(layers: u32) -> FrameGraph {
        let mut frames = FrameGraph::new(4, false, SceneColor::EIGHT_BIT, IDS);
        frames.sync_views(&[View::default()]);
        let size = Size::Fixed {
            width: 256,
            height: 256,
        };
        let map = Target::depth(DEPTH_FORMAT).layers(layers).array();
        frames.graph.keep("layers", map, size);
        for layer in 0..layers {
            let pass = Pass::new(format!("Layer{layer}"), PassKind::Shadow)
                .size(size)
                .writes_layer("layers", layer);
            frames.add(pass, Role::Resolve);
        }
        let sampler = Pass::new("Sampler", PassKind::Scene)
            .creates("seen", Target::color(format::CANVAS))
            .reads("layers");
        frames.add(sampler, Role::Resolve);
        frames
    }

    #[test]
    fn passes_draw_into_views_of_the_layers_of_array_targets() {
        let mut frames = layered(3);
        let mut list = DrawList::with_capacity(512);
        frames
            .prepare(&mut list, (64, 64), RenderScale::FULL)
            .unwrap();
        // The kept array comes first, bound as an array, with a view of each layer after the ids
        // of the plan's textures.
        let usage = texture_usage::RENDER_ATTACHMENT | texture_usage::TEXTURE_BINDING;
        let array = [1, 256, 256, 3, DEPTH_FORMAT, usage, 1, 1, view::D2_ARRAY];
        assert_eq!(operands(&list, Op::CreateTexture)[0], array);
        let views = [[129, 1, 0, 0], [130, 1, 0, 1], [131, 1, 0, 2]];
        assert_eq!(operands(&list, Op::CreateTextureView), views);
        frames.record(&mut list, [0.0; 4], |_, _| Ok(())).unwrap();
        let depth_only = pass_flags::CLEAR_DEPTH | pass_flags::STORE_DEPTH;
        let passes = operands(&list, Op::BeginRenderPass);
        let depth_passes: Vec<_> = passes.iter().filter(|p| p[0] == NO_TARGET).collect();
        assert_eq!(depth_passes.len(), 3);
        for (layer, pass) in depth_passes.into_iter().enumerate() {
            let [color, resolve, depth] = [pass[0], pass[1], pass[2]];
            assert_eq!([color, resolve], [NO_TARGET; 2]);
            assert_eq!(depth, 129 + layer as u32);
            assert_eq!(pass[8], depth_only);
        }
        null3d_gpu::mock::MockBackend::default()
            .replay(list.words())
            .unwrap();

        // Nothing changed: nothing is made again.
        list.clear();
        frames
            .prepare(&mut list, (64, 64), RenderScale::FULL)
            .unwrap();
        assert!(list.is_empty());
    }

    #[test]
    fn an_array_of_one_layer_is_still_an_array_and_fewer_layers_release_their_views() {
        let mut frames = layered(2);
        let mut list = DrawList::with_capacity(512);
        frames
            .prepare(&mut list, (64, 64), RenderScale::FULL)
            .unwrap();
        assert_eq!(operands(&list, Op::CreateTextureView).len(), 2);

        // The array shrinks to one layer: the texture and its one view are made again, bound as
        // an array, and the second view is released.
        frames = FrameGraph {
            made: std::mem::take(&mut frames.made),
            layer_views: std::mem::take(&mut frames.layer_views),
            made_views: frames.made_views,
            canvas: frames.canvas,
            ..layered(1)
        };
        list.clear();
        frames
            .prepare(&mut list, (64, 64), RenderScale::FULL)
            .unwrap();
        let created = operands(&list, Op::CreateTexture);
        assert_eq!(created.len(), 1);
        assert_eq!(created[0][3], 1);
        assert_eq!(created[0][8], view::D2_ARRAY);
        assert_eq!(operands(&list, Op::CreateTextureView), [[129, 1, 0, 0]]);
        assert_eq!(operands(&list, Op::DestroyTexture), [[130]]);

        // A new device has none of them.
        frames.reset_gpu();
        list.clear();
        frames
            .prepare(&mut list, (64, 64), RenderScale::FULL)
            .unwrap();
        assert_eq!(operands(&list, Op::CreateTextureView), [[129, 1, 0, 0]]);
    }
}
