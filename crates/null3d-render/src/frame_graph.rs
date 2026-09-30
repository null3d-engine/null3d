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
//! A builder that binds a shadow map keeps one texture array for it (see [`crate::shadows`]),
//! which every opaque pass samples. While a directional light casts shadows, each cascade has a
//! shadow pass that draws the casters' depth into its layer of the array, and on WebGPU a culling
//! pass of its own before it. Without shadows the array is one texel of one layer, which no pass
//! draws, so the scene's bindings stay the same.
//!
//! The debug lines pass draws the lines that the sketch drew (see [`crate::debug_lines`]) into the
//! scene color and depth, after the camera's opaque pass and in its render pass. It is on only in
//! frames with lines, so the plan of a frame without them has no such pass.
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
//!
//! A pass draws into one layer of an array target through a view of that layer. The draw lists
//! make a view of each layer beside each such texture of the plan, with ids of their own after the
//! textures' ids.

use std::borrow::Cow;

use null3d_gpu::drawlist::{DrawList, NO_TARGET, Op, format, pass_flags, texture_usage, view};

use crate::frame::RecordError;
use crate::graph::{
    CANVAS, LoadOp, Pass, PassId, PassKind, Plan, PlannedTexture, RenderGraph, Size, Step,
    StepKind, StoreOp, Surface, Target,
};
use crate::pipelines::PassTargets;
use crate::shadows::MAX_CASCADES;
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
/// The camera's depth target.
const SCENE_DEPTH: &str = "sceneDepth";
/// The shadow map: a depth texture array with one layer per cascade, kept between frames.
const SHADOW_MAP: &str = "shadowMap";
/// Each cascade's culling pass, the buffer of its compacted instances and indirect draws, and its
/// shadow pass.
const SHADOW_CULLING: [&str; MAX_CASCADES] = [
    "ShadowCulling0",
    "ShadowCulling1",
    "ShadowCulling2",
    "ShadowCulling3",
];
const SHADOW_VISIBLE: [&str; MAX_CASCADES] = [
    "shadowVisible0",
    "shadowVisible1",
    "shadowVisible2",
    "shadowVisible3",
];
const SHADOW_CASCADES: [&str; MAX_CASCADES] = [
    "ShadowCascade0",
    "ShadowCascade1",
    "ShadowCascade2",
    "ShadowCascade3",
];
/// Ids after the first texture's that the views of layers take: the plan's textures take the ones
/// below.
const LAYER_VIEWS: u32 = 128;
/// No views of layers: a texture that no pass draws into by layer.
const NO_VIEWS: u32 = u32::MAX;

/// The shadow passes of a directional light: its cascades, the texels on each side of each
/// cascade's layer, and the light's layer mask, which selects the casters.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct ShadowPasses {
    pub(crate) cascades: u32,
    pub(crate) map_size: u32,
    pub(crate) layers: u32,
}

/// What a declared pass records.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Role {
    /// Culls a view on the GPU into its compacted instances and indirect draws.
    Cull(ViewId),
    /// Draws a view's opaque objects.
    Opaque(ViewId),
    /// Draws the depth of a shadow cascade's casters, by the cascade's view.
    Shadow(ViewId),
    /// Draws the frame's debug lines into the camera's view.
    DebugLines,
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
    /// Each view's opaque pass, by view.
    opaque: Vec<PassId>,
    /// MSAA samples of the scene's color and depth targets.
    samples: u32,
    /// True when the GPU culls each view in a culling pass.
    gpu_culling: bool,
    /// The number of views the declarations cover.
    views: usize,
    /// The debug lines pass, once the passes are declared.
    debug_lines: Option<PassId>,
    /// The id of the texture that holds the plan's first texture. The others follow it.
    first_texture: u32,
    /// Each texture of the plan that the draw lists made, with the size it was made at.
    made: Vec<(PlannedTexture, (u32, u32))>,
    /// The canvas size the draw lists set last, or `(0, 0)` before any.
    canvas: (u32, u32),
    /// True when the builder's scene passes bind a shadow map.
    shadow_map: bool,
    /// The directional light's shadow passes, or `None` without shadows.
    shadows: Option<ShadowPasses>,
    /// Each cascade's shadow pass, once the passes are declared.
    shadow_passes: Vec<PassId>,
    /// True once the passes are declared for the views, the shadows and the shadow map.
    declared: bool,
    /// True when the last [`FrameGraph::prepare`] made or released a texture of the plan.
    textures_made: bool,
    /// For each texture of the plan, the first of the views of its layers, counted from the views'
    /// first id, or [`NO_VIEWS`].
    layer_views: Vec<u32>,
    /// The views of layers that the draw lists made.
    made_views: u32,
}

impl FrameGraph {
    /// A graph with no passes yet. The first [`FrameGraph::sync_views`] declares them. Its
    /// textures take ids from `first_texture` on.
    pub(crate) fn new(samples: u32, gpu_culling: bool, first_texture: u32) -> Self {
        Self {
            graph: RenderGraph::new(),
            roles: Vec::new(),
            opaque: Vec::new(),
            samples,
            gpu_culling,
            views: 0,
            debug_lines: None,
            first_texture,
            made: Vec::new(),
            canvas: (0, 0),
            layer_views: Vec::new(),
            made_views: 0,
            shadow_map: false,
            shadows: None,
            shadow_passes: Vec::new(),
            declared: false,
            textures_made: false,
        }
    }

    /// Makes the scene passes sample a shadow map, which the builder binds with every view's
    /// objects. Without shadows the map is one texel of one layer.
    pub(crate) fn bind_shadow_map(&mut self) {
        self.shadow_map = true;
        self.declared = false;
    }

    /// Sets the directional light's shadow passes for the next frames, or none. A new cascade count
    /// or map size declares the passes again, which makes the shadow map again. A new layer mask
    /// only changes the passes' masks. A builder that binds no shadow map draws no shadows.
    pub(crate) fn set_shadows(&mut self, shadows: Option<ShadowPasses>) {
        let shadows = shadows.filter(|_| self.shadow_map).map(|s| ShadowPasses {
            cascades: s.cascades.clamp(1, MAX_CASCADES as u32),
            map_size: s.map_size.max(1),
            layers: s.layers,
        });
        let shape = |s: Option<ShadowPasses>| s.map(|s| (s.cascades, s.map_size));
        if shape(shadows) != shape(self.shadows) {
            self.declared = false;
        } else if let Some(shadows) = shadows {
            for &pass in &self.shadow_passes {
                self.graph.set_layers(pass, shadows.layers);
            }
        }
        self.shadows = shadows;
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

    /// Declares the passes again when the number of views changed, and gives each view's opaque
    /// pass the view's layers, which change without a new plan.
    pub(crate) fn sync_views(&mut self, views: &[View]) {
        if views.len() != self.views || !self.declared {
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

    /// Declares the engine's passes for `views`: each view's culling pass on WebGPU, each shadow
    /// cascade's culling and shadow passes, each view's opaque pass, the debug lines pass and the
    /// final pass, which are off, and the resolve pass.
    fn declare(&mut self, views: &[View]) {
        self.graph.clear();
        self.roles.clear();
        self.opaque.clear();
        self.shadow_passes.clear();
        let color = Target::color(COLOR_FORMAT).samples(self.samples);
        let depth = Target::depth(DEPTH_FORMAT).samples(self.samples);
        if self.shadow_map {
            let (layers, size) = self.shadows.map_or((1, 1), |s| (s.cascades, s.map_size));
            let map = Target::depth(DEPTH_FORMAT).layers(layers).array();
            let size = Size::Fixed {
                width: size,
                height: size,
            };
            self.graph.keep(SHADOW_MAP, map, size);
        }
        if self.gpu_culling {
            self.graph.import_buffer(OBJECTS);
            for index in 0..views.len() {
                let pass = Pass::new(view_name(index, "Culling", "Culling"), PassKind::Compute)
                    .reads(OBJECTS)
                    .creates_buffer(view_name(index, "visible", "visible"));
                self.add(pass, Role::Cull(ViewId::from_index(index)));
            }
        }
        if let Some(shadows) = self.shadows {
            self.declare_shadows(shadows);
        }
        for (index, view) in views.iter().enumerate() {
            let mut pass = Pass::new(view_name(index, "Opaque", "Opaque"), PassKind::Scene)
                .layers(view.layers())
                .creates(view_name(index, SCENE_COLOR, "color"), color)
                .creates(view_name(index, SCENE_DEPTH, "depth"), depth);
            if self.gpu_culling {
                pass = pass.reads(view_name(index, "visible", "visible"));
            }
            if self.shadow_map {
                pass = pass.reads(SHADOW_MAP);
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
        self.add(resolve, Role::Resolve);
        let final_pass = Pass::new("Final", PassKind::Fullscreen)
            .size(Size::Canvas)
            .reads(SCENE_COLOR)
            .writes(CANVAS);
        let final_pass = self.add(final_pass, Role::Final);
        self.graph.set_enabled(final_pass, false);
        self.views = views.len();
        self.declared = true;
    }

    /// Declares each cascade's culling pass on WebGPU, and its shadow pass, which draws into the
    /// cascade's layer of the shadow map.
    fn declare_shadows(&mut self, shadows: ShadowPasses) {
        let size = Size::Fixed {
            width: shadows.map_size,
            height: shadows.map_size,
        };
        for cascade in 0..shadows.cascades as usize {
            let view = ViewId::cascade(cascade);
            let mut pass = Pass::new(SHADOW_CASCADES[cascade], PassKind::Shadow)
                .size(size)
                .layers(shadows.layers)
                .writes_layer(SHADOW_MAP, cascade as u32);
            if self.gpu_culling {
                let culling = Pass::new(SHADOW_CULLING[cascade], PassKind::Compute)
                    .reads(OBJECTS)
                    .creates_buffer(SHADOW_VISIBLE[cascade]);
                self.add(culling, Role::Cull(view));
                pass = pass.reads(SHADOW_VISIBLE[cascade]);
            }
            let pass = self.add(pass, Role::Shadow(view));
            self.shadow_passes.push(pass);
        }
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
        self.textures_made = false;
        if compiled || resized {
            let start = list.len();
            self.make_textures(list)?;
            self.textures_made = list.len() != start;
        }
        Ok(())
    }

    /// Makes each texture of the plan whose shape or size differs from what the draw lists made,
    /// with the views of its layers where passes draw into it by layer, and releases the textures
    /// and views the plan no longer has.
    fn make_textures(&mut self, list: &mut DrawList) -> Result<(), RecordError> {
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
        Ok(())
    }

    /// The id of the view of `layer` of a texture whose views start at `first_view`.
    fn view_id(&self, first_view: u32, layer: u32) -> u32 {
        self.first_texture + LAYER_VIEWS + first_view + layer
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

    /// True when the frame's [`FrameGraph::prepare`] made or released a texture of the plan, so
    /// bind groups that name one must be made again.
    pub(crate) fn textures_made(&self) -> bool {
        self.textures_made
    }

    /// The draw list's id of the shadow map, which bind groups name, or `None` for a builder that
    /// binds none. Valid once the frame's [`FrameGraph::prepare`] made the plan's textures.
    pub(crate) fn shadow_map(&self) -> Option<u32> {
        if !self.shadow_map {
            return None;
        }
        let plan = self.graph.plan()?;
        let surface = plan.texture_of(self.graph.find_resource(SHADOW_MAP)?)?;
        Some(self.texture_id(surface))
    }

    /// Forgets the canvas size and the textures and views the draw lists made, so the next frame
    /// sets the size and makes every texture again, after the thread that draws replaced the GPU.
    pub(crate) fn reset_gpu(&mut self) {
        self.made.clear();
        self.layer_views.clear();
        self.made_views = 0;
        self.canvas = (0, 0);
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

    #[test]
    fn each_view_adds_its_passes_and_the_final_pass_stays_off() {
        let mut frames = FrameGraph::new(4, true, 1);
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

        // The WebGL2 path culls on the job workers, so its graph has no culling passes.
        let mut frames = FrameGraph::new(4, false, 1);
        frames.sync_views(&[View::default()]);
        assert_eq!(frames.graph().pass_count(), 4);
        assert_eq!(frames.roles[0], Role::Opaque(ViewId::CAMERA));
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
        let mut frames = FrameGraph::new(4, true, 1);
        frames.sync_views(&[View::default(), View::default()]);
        let mut list = DrawList::with_capacity(256);
        frames.prepare(&mut list, (64, 64)).unwrap();
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
        frames.prepare(&mut list, (64, 64)).unwrap();
        assert_eq!(
            steps(&frames)[1],
            ["Opaque", "DebugLines", "Resolve"],
            "the lines draw over the camera's opaque objects, before the color resolves"
        );
        // The lines change no texture of the plan.
        list.clear();
        frames.set_debug_lines(false);
        frames.prepare(&mut list, (64, 64)).unwrap();
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
    /// into and a pass after them samples.
    fn layered(layers: u32) -> FrameGraph {
        let mut frames = FrameGraph::new(4, false, 1);
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
            frames.add(pass, Role::Final);
        }
        let sampler = Pass::new("Sampler", PassKind::Scene)
            .creates("seen", Target::color(COLOR_FORMAT))
            .reads("layers");
        frames.add(sampler, Role::Final);
        frames
    }

    #[test]
    fn passes_draw_into_views_of_the_layers_of_array_targets() {
        let mut frames = layered(3);
        let mut list = DrawList::with_capacity(512);
        frames.prepare(&mut list, (64, 64)).unwrap();
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
        frames.prepare(&mut list, (64, 64)).unwrap();
        assert!(list.is_empty());
    }

    #[test]
    fn an_array_of_one_layer_is_still_an_array_and_fewer_layers_release_their_views() {
        let mut frames = layered(2);
        let mut list = DrawList::with_capacity(512);
        frames.prepare(&mut list, (64, 64)).unwrap();
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
        frames.prepare(&mut list, (64, 64)).unwrap();
        let created = operands(&list, Op::CreateTexture);
        assert_eq!(created.len(), 1);
        assert_eq!(created[0][3], 1);
        assert_eq!(created[0][8], view::D2_ARRAY);
        assert_eq!(operands(&list, Op::CreateTextureView), [[129, 1, 0, 0]]);
        assert_eq!(operands(&list, Op::DestroyTexture), [[130]]);

        // A new device has none of them.
        frames.reset_gpu();
        list.clear();
        frames.prepare(&mut list, (64, 64)).unwrap();
        assert_eq!(operands(&list, Op::CreateTextureView), [[129, 1, 0, 0]]);
    }
}
