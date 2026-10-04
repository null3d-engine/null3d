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
//! With the depth prepass, a depth prepass comes before each view's opaque pass. It creates the
//! view's depth and draws the opaque objects' depth into it, and the opaque pass then writes into
//! that depth (see [`crate::pipelines`]). Both draw in one render pass, which has the color from
//! the start. The prepass is fixed when the builder starts.
//!
//! A builder that binds a shadow map keeps one texture array for it (see [`crate::shadows`]),
//! which every opaque pass samples. While a directional light casts shadows, each cascade has a
//! shadow pass that draws the casters' depth into its layer of the array, and on WebGPU a culling
//! pass of its own before it. Without shadows the array is one texel of one layer, which no pass
//! draws, so the scene's bindings stay the same.
//!
//! The same builder keeps a second texture array, the shadow atlas of point and spot lights (see
//! [`crate::shadow_tiles`]), which every opaque pass samples too. Each layer of the atlas is a
//! tile, with a shadow pass and on WebGPU a culling pass of its own. A tile keeps its depth from
//! frame to frame, and draws only in frames that need it: the recording skips the render pass of
//! each other tile, and the graph does not compile again.
//!
//! The debug lines pass draws the lines that the sketch drew (see [`crate::debug_lines`]) into the
//! scene color and depth, after the camera's opaque pass and in its render pass. It is on only in
//! frames with lines, so the plan of a frame without them has no such pass.
//!
//! Each view has a transparent pass too, which draws the view's blended objects back to front
//! (see [`crate::sorted`]) over its opaque objects and the debug lines, in the same render pass.
//! The transparent passes are on only while some object blends.
//!
//! Two passes can take the scene color to the canvas, and the scene color's format and the
//! anti-aliasing mode pick one (see [`crate::output`]). On the HDR path the final pass samples the
//! scene color and draws the canvas: it applies the exposure and the tone mapping, and encodes the
//! color. On the 8-bit path the scene shaders did that already. With MSAA the resolve pass runs
//! instead: the render pass that draws the scene resolves its multisampled color straight into
//! the canvas, with no pass, copy or target of its own. With one sample, or while the render scale
//! can drop below the whole canvas, the final pass copies the scene color into the canvas. In the
//! FXAA mode the final pass smooths edges on either path.
//!
//! On the HDR path, bloom's passes come between the transparent passes and the final pass (see
//! [`crate::bloom`]): the bright pass reads the scene color, and each step after it reads the step
//! before it, each into a target of its own at a fraction of the render size. The final pass then
//! runs in its bloom build, which reads bloom's levels too. They are declared with the other
//! passes and switched on only while the sketch turns bloom on, so a frame without bloom has none
//! of their targets. The 8-bit path has no bloom: its scene color holds display color, which no
//! longer knows how bright a pixel was.
//!
//! While the sketch turns outlines on and some object is outlined, the outline passes come after
//! the transparent passes (see [`crate::outline`]). On WebGPU a culling pass culls the outlined
//! objects for the outline view. The mask pass draws them into the outline mask, with the scene's
//! depth as its depth target, so the scene's render pass stores the depth for it. The final pass
//! then runs in a declaration that reads the mask too, and draws the line from it. There is one
//! such declaration for each build of the final pass, and the frame switches on the one that it
//! needs. The outline passes and the mask are off while nothing is outlined, and on every path the
//! final pass then runs as it did.
//!
//! While the sketch turns ambient occlusion on, the camera's view has three ambient occlusion
//! passes between its depth prepass and its opaque pass (see [`crate::ao`]), and the prepass runs
//! for every view even where the builder started without it. The first reads the scene depth as
//! the prepass leaves it, before the opaque pass draws into it again, so the prepass and the
//! opaque pass draw in two render passes. Each step draws into a target of its own at half the
//! render size, and the camera's opaque pass reads the last one. They are declared only while
//! ambient occlusion is on, on either path, since it needs no HDR color.
//!
//! The final pass also grades the canvas color with a color grading table and the vignette (see
//! [`crate::grading`]). Both work on display color, so they draw on the 8-bit path too: while the
//! sketch sets either, the final pass runs there in place of the resolve pass, as it does while
//! the render scale can drop.
//!
//! # Render scale
//!
//! Passes of a relative size draw into the top-left corner of their targets at the render scale,
//! through the viewport and the scissor. The targets keep the canvas's size, so a new scale makes
//! no texture. The final pass scales the corner up to the whole canvas.
//!
//! Targets that live within one render pass, such as the multisampled color and the depth, take
//! the transient attachment usage where the device offers it, so a tile-based GPU can keep them in
//! tile memory. Every target that no later pass reads is discarded at the end of its render pass.
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

use crate::ao::{self, Ao, AoIds, AoPass, StepSources};
use crate::bloom::{self, Bloom, BloomIds, BloomPass, LEVELS, STEPS};
use crate::camera::Mat4;
use crate::final_pass::{BloomInputs, FinalIds, FinalPass, OutlineInputs};
use crate::frame::{CanvasOutput, RecordError, UploadArena};
use crate::grading::Grading;
use crate::graph::{
    CANVAS, LoadOp, Pass, PassId, PassKind, Plan, PlannedTexture, RenderGraph, RenderScale, Size,
    Step, StepKind, StoreOp, Surface, Target,
};
use crate::outline::{self, Outline};
use crate::output::{Antialias, Output, SceneColor};
use crate::pipelines::{PassTargets, PipelineCache};
use crate::shadows::{MAX_CASCADES, ShadowFrame};
use crate::view::{View, ViewId};

/// The format of the scene's depth targets.
pub(crate) const DEPTH_FORMAT: u32 = format::DEPTH32_FLOAT;

/// The GPU object ids that a frame builder gives its graph: its textures take ids from
/// `first_texture` on, and the final pass has its own.
#[derive(Clone, Copy, Debug)]
pub(crate) struct GraphIds {
    pub(crate) first_texture: u32,
    pub(crate) final_pass: FinalIds,
    pub(crate) bloom: BloomIds,
    pub(crate) ao: AoIds,
}

/// The buffers that the culling passes read: the world matrices and the bucket tables, which the
/// frame uploads before its passes run.
const OBJECTS: &str = "objects";
/// The camera's point and spot lights, which the frame uploads before its passes run.
const LIGHTS: &str = "lights";
/// The camera's light grid, which the light clustering pass fills on WebGPU.
const LIGHT_GRID: &str = "lightGrid";
/// The camera's color target, which reaches the canvas.
const SCENE_COLOR: &str = "sceneColor";
/// The camera's depth target.
const SCENE_DEPTH: &str = "sceneDepth";
/// The shadow map: a depth texture array with one layer per cascade, kept between frames.
const SHADOW_MAP: &str = "shadowMap";
/// The buffer of skinned vertices, which the skinning pass writes and the passes that draw skinned
/// meshes read.
const SKINNED: &str = "skinnedVertices";
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
/// Each step of bloom's chain, and the target it creates: the bright pass, then each level's blur
/// across and its blur down. Each step reads the target of the step before it, and the bright pass
/// the scene color.
const BLOOM_PASSES: [&str; STEPS] = [
    "BloomBright",
    "BloomBlurX0",
    "BloomBlurY0",
    "BloomBlurX1",
    "BloomBlurY1",
    "BloomBlurX2",
    "BloomBlurY2",
    "BloomBlurX3",
    "BloomBlurY3",
    "BloomBlurX4",
    "BloomBlurY4",
];
const BLOOM_TARGETS: [&str; STEPS] = [
    "bloomBright",
    "bloomX0",
    "bloomY0",
    "bloomX1",
    "bloomY1",
    "bloomX2",
    "bloomY2",
    "bloomX3",
    "bloomY3",
    "bloomX4",
    "bloomY4",
];
/// The step whose target holds one of bloom's levels, which the final pass reads: its blur down.
const fn bloom_level(level: usize) -> usize {
    2 + 2 * level
}
/// The target that step `step` of bloom reads: the scene color for the bright pass, else the
/// target of the step before it.
const fn bloom_source(step: usize) -> &'static str {
    if step == 0 {
        SCENE_COLOR
    } else {
        BLOOM_TARGETS[step - 1]
    }
}
/// The outline view's culling pass on WebGPU, and the buffer of its compacted instances and
/// indirect draws.
const OUTLINE_CULLING: &str = "OutlineCulling";
const OUTLINE_VISIBLE: &str = "outlineVisible";
/// The outline mask, which the mask pass creates and the final pass reads.
const OUTLINE_MASK: &str = "outlineMask";
/// Each step of ambient occlusion and the target it creates: the depth copy, the horizon search and
/// the denoise, whose target the camera's opaque pass reads.
const AO_PASSES: [&str; ao::STEPS] = ["AoDepth", "AoHorizon", "AoDenoise"];
const AO_TARGETS: [&str; ao::STEPS] = ["aoDepth", "aoHorizon", "aoResult"];
/// The color target of the camera's depth prepass while ambient occlusion splits it from the
/// opaque pass. No pass reads it: it gives the prepass's render pass the formats that its
/// pipelines draw into, so each render pass ends without storing it, and it can share a texture
/// with the scene color, whose life starts after it.
const PREPASS_COLOR: &str = "prepassColor";
/// The shadow atlas of point and spot lights: a depth texture array with one layer per tile,
/// kept between frames.
const SHADOW_ATLAS: &str = "shadowAtlas";
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

impl ShadowPasses {
    /// The passes of `shadow`'s frame.
    pub(crate) fn of(shadow: &ShadowFrame) -> Self {
        Self {
            cascades: shadow.cascades.count as u32,
            map_size: shadow.settings.map_size,
            layers: shadow.layers,
        }
    }
}

/// The tile passes of the shadow atlas: its tiles, and the texels on each side of each.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct TilePasses {
    pub(crate) tiles: u32,
    pub(crate) size: u32,
}

/// What a declared pass records.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Role {
    /// Lists the lights of each cluster of the camera's light grid on the GPU.
    LightClusters,
    /// Skins the skinned meshes that some view draws, on the GPU, into the skinned vertex buffer
    /// that the shadow and scene passes draw.
    Skin,
    /// Culls a view on the GPU into its compacted instances and indirect draws.
    Cull(ViewId),
    /// Draws the depth of a view's opaque objects, before its opaque pass shades them.
    Prepass(ViewId),
    /// Draws a view's opaque objects.
    Opaque(ViewId),
    /// Draws the depth of a shadow cascade's or a shadow tile's casters, by its view.
    Shadow(ViewId),
    /// Draws the frame's debug lines into the camera's view.
    DebugLines,
    /// Draws a view's blended objects, back to front, over its opaque ones.
    Transparent(ViewId),
    /// Resolves the scene color into the canvas on the 8-bit path. It records nothing: the color
    /// attachment of its render pass resolves.
    Resolve,
    /// A step of bloom's chain, by its place in the chain. The graph records it itself.
    Bloom(u8),
    /// Draws the outlined objects into the outline mask, from the outline view.
    OutlineMask,
    /// A step of ambient occlusion, by its place. The graph records it itself.
    Ao(u8),
    /// Tone maps the HDR scene color into the canvas. The graph records it itself.
    Final,
    /// Tone maps the HDR scene color into the canvas, with bloom's levels added. The graph records
    /// it itself.
    FinalBloom,
}

/// The passes that can take the scene color to the canvas: the resolve pass, and the final pass's
/// declarations by whether they read bloom's levels and then the outline mask. Only the HDR path
/// declares the ones with bloom.
#[derive(Clone, Copy, Debug)]
struct Outputs {
    resolve: PassId,
    finals: [[Option<PassId>; 2]; 2],
}

/// A name for a view's pass or resource: `camera` for the camera's view, and `other` followed by
/// the view's number for any other.
fn view_name(view: usize, camera: &'static str, other: &str) -> Cow<'static, str> {
    if view == ViewId::CAMERA.index() {
        return Cow::Borrowed(camera);
    }
    numbered(other, view)
}

/// `name` followed by `number`. It writes the digits itself, which keeps the text formatting code
/// out of the WebAssembly file.
fn numbered(name: &str, number: usize) -> Cow<'static, str> {
    let mut digits = [0u8; 20];
    let mut count = 0;
    let mut rest = number;
    loop {
        digits[count] = b'0' + (rest % 10) as u8;
        count += 1;
        rest /= 10;
        if rest == 0 {
            break;
        }
    }
    let mut text = String::from(name);
    for &digit in digits[..count].iter().rev() {
        text.push(char::from(digit));
    }
    Cow::Owned(text)
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
    /// True when each view has a depth prepass.
    prepass: bool,
    /// True when a skinning pass skins meshes before the passes that draw them.
    skinning: bool,
    /// Each view's depth prepass, by view, with the depth prepass.
    prepasses: Vec<PassId>,
    /// MSAA samples of the scene's color and depth targets.
    samples: u32,
    /// True when the GPU culls each view in a culling pass.
    gpu_culling: bool,
    /// The format of the scene's color targets.
    scene_color: SceneColor,
    /// True when the scene's render pass can resolve its color into the canvas: on the 8-bit path
    /// with MSAA.
    resolves: bool,
    /// True when the render scale may drop below the whole canvas, so the final pass runs to scale
    /// the image up even where the scene could resolve into the canvas.
    scales: bool,
    /// True while the sketch sets a color grading table or the vignette, so the final pass runs to
    /// grade the image even where the scene could resolve into the canvas.
    grades: bool,
    /// The outline's settings while the sketch turns it on.
    outline: Option<Outline>,
    /// True while some object is outlined.
    outlined: bool,
    /// The outline's culling pass on WebGPU and its mask pass, once declared.
    outline_passes: Vec<PassId>,
    /// The render scale of the frame being recorded.
    scale: RenderScale,
    /// The passes that can take the scene color to the canvas, once declared.
    outputs: Option<Outputs>,
    /// Bloom's steps and their GPU objects, on the HDR path.
    bloom_pass: Option<BloomPass>,
    /// The GPU objects that bloom's steps take, once the scene color holds HDR color.
    bloom_ids: BloomIds,
    /// Bloom's passes, once declared, by their place in the chain.
    bloom_passes: Vec<PassId>,
    /// Bloom's settings while the sketch turns it on.
    bloom: Option<Bloom>,
    /// The sample divisor of bloom's blurs.
    bloom_divisor: u32,
    /// Ambient occlusion's steps and their GPU objects, once ambient occlusion first draws.
    ao_pass: Option<AoPass>,
    /// The GPU objects that ambient occlusion's steps take.
    ao_ids: AoIds,
    /// Ambient occlusion's settings while it draws.
    ao: Option<Ao>,
    /// The size of ambient occlusion's targets as a share of the render size.
    ao_scale: f32,
    /// The camera's projection and its inverse, while ambient occlusion draws.
    projection: (Mat4, Mat4),
    /// The number of views the declarations cover.
    views: usize,
    /// The debug lines pass, once the passes are declared.
    debug_lines: Option<PassId>,
    /// Each view's transparent pass, by view.
    transparent: Vec<PassId>,
    /// True while the transparent passes are on.
    transparent_on: bool,
    /// The id of the texture that holds the plan's first texture. The others follow it.
    first_texture: u32,
    /// Each texture of the plan that the draw lists made, with the size it was made at.
    made: Vec<(PlannedTexture, (u32, u32))>,
    /// True when the frame being recorded made or released a texture of the plan.
    textures_made: bool,
    /// The canvas size the draw lists set last, or `(0, 0)` before any.
    canvas: (u32, u32),
    /// True when the builder's scene passes bind a shadow map.
    shadow_map: bool,
    /// The directional light's shadow passes, or `None` without shadows.
    shadows: Option<ShadowPasses>,
    /// Each cascade's shadow pass, once the passes are declared.
    shadow_passes: Vec<PassId>,
    /// The shadow atlas's tile passes, or `None` while no light casts shadows into it.
    tiles: Option<TilePasses>,
    /// True once the passes are declared for the views, the shadows and the shadow map.
    declared: bool,
    /// For each texture of the plan, the first of the views of its layers, counted from the views'
    /// first id, or [`NO_VIEWS`].
    layer_views: Vec<u32>,
    /// The views of layers that the draw lists made.
    made_views: u32,
    final_pass: FinalPass,
}

impl FrameGraph {
    /// A graph with no passes yet. The first [`FrameGraph::sync_views`] declares them. Scene
    /// passes draw color in the format of the canvas output's scene color, and the scene's color
    /// and depth targets have the samples of its anti-aliasing mode. Targets that live within one
    /// render pass are transient when `transient_attachments` says the device has them.
    pub(crate) fn new(
        gpu_culling: bool,
        canvas: CanvasOutput,
        transient_attachments: bool,
        ids: GraphIds,
    ) -> Self {
        let CanvasOutput {
            scene_color,
            antialias,
            ..
        } = canvas;
        let mut graph = RenderGraph::new();
        graph.set_transient_attachments(transient_attachments);
        Self {
            graph,
            roles: Vec::new(),
            opaque: Vec::new(),
            prepass: false,
            skinning: false,
            prepasses: Vec::new(),
            samples: antialias.samples(),
            gpu_culling,
            scene_color,
            resolves: !scene_color.is_hdr() && antialias == Antialias::Msaa,
            scales: false,
            grades: false,
            outline: None,
            outlined: false,
            outline_passes: Vec::new(),
            scale: RenderScale::FULL,
            outputs: None,
            bloom_pass: scene_color
                .is_hdr()
                .then(|| BloomPass::new(ids.bloom, scene_color.format(), !gpu_culling)),
            bloom_passes: Vec::new(),
            bloom_ids: ids.bloom,
            bloom: None,
            bloom_divisor: 1,
            ao_pass: None,
            ao_ids: ids.ao,
            ao: None,
            ao_scale: ao::MAX_SCALE,
            projection: ([0.0; 16], [0.0; 16]),
            views: 0,
            debug_lines: None,
            transparent: Vec::new(),
            transparent_on: false,
            first_texture: ids.first_texture,
            made: Vec::new(),
            textures_made: false,
            canvas: (0, 0),
            layer_views: Vec::new(),
            made_views: 0,
            shadow_map: false,
            shadows: None,
            shadow_passes: Vec::new(),
            tiles: None,
            declared: false,
            final_pass: FinalPass::new(ids.final_pass, scene_color, antialias),
        }
    }

    /// Draws the scene into a target of `canvas`'s scene color, with the samples of its
    /// anti-aliasing mode, from the next frame on. The passes are declared again, and the plan's
    /// targets made again where they changed. The final pass takes the new mode, and bloom's steps
    /// exist only for HDR color.
    pub(crate) fn set_canvas(&mut self, canvas: CanvasOutput) {
        let CanvasOutput {
            scene_color,
            antialias,
            ..
        } = canvas;
        self.scene_color = scene_color;
        self.samples = antialias.samples();
        self.resolves = !scene_color.is_hdr() && antialias == Antialias::Msaa;
        self.final_pass.set_mode(scene_color, antialias);
        let rows_from_bottom = !self.gpu_culling;
        self.bloom_pass = scene_color
            .is_hdr()
            .then(|| BloomPass::new(self.bloom_ids, scene_color.format(), rows_from_bottom));
        // The depth step reads the depth's samples, which the new mode may change.
        self.ao_pass = None;
        self.declared = false;
    }

    /// Makes the scene passes sample a shadow map, which the builder binds with every view's
    /// objects. Without shadows the map is one texel of one layer.
    pub(crate) fn bind_shadow_map(&mut self) {
        self.shadow_map = true;
        self.declared = false;
    }

    /// Gives each view a depth prepass before its opaque pass, or none.
    pub(crate) fn set_depth_prepass(&mut self, on: bool) {
        self.prepass = on;
        self.declared = false;
    }

    /// Switches the skinning pass on while the scene draws skinned meshes that a compute pass
    /// skins, and off otherwise. The passes are declared again when it changes.
    pub(crate) fn set_skinning(&mut self, on: bool) {
        if on != self.skinning {
            self.skinning = on;
            self.declared = false;
        }
    }

    /// True when each view has a depth prepass: from the builder's start, or while ambient
    /// occlusion draws, as it reads the prepass's depth.
    pub(crate) fn depth_prepass(&self) -> bool {
        self.prepass || self.ao.is_some()
    }

    /// Turns ambient occlusion on with its settings, the camera's projection and its inverse, and
    /// the size of its targets as a share of the render size, or off with `None`, for the next
    /// frames. The passes are declared again only when it turns on or off.
    pub(crate) fn set_ao(&mut self, ao: Option<(Ao, (Mat4, Mat4))>, scale: f32) {
        if ao.is_some() != self.ao.is_some() {
            self.declared = false;
        }
        self.ao = ao.map(|(settings, _)| settings);
        if let Some((_, projection)) = ao {
            self.projection = projection;
        }
        self.ao_scale = scale;
    }

    /// The draw list's id of the texture that the camera's opaque pass reads ambient occlusion
    /// from, or `None` while ambient occlusion draws no frame. Valid once the frame's
    /// [`FrameGraph::prepare`] made the plan's textures.
    pub(crate) fn ao_texture(&self) -> Option<u32> {
        self.ao
            .and_then(|_| self.sampled_id(AO_TARGETS[ao::STEPS - 1]))
    }

    /// Sets the directional light's shadow passes for the next frames, or none. A new cascade count
    /// or map size declares the passes again, which makes the shadow map again. A new layer mask
    /// only changes the passes' masks, and new cascades to draw change only which passes run. A
    /// builder that binds no shadow map draws no shadows.
    pub(crate) fn set_shadows(&mut self, shadows: Option<ShadowPasses>) {
        let shadows = shadows.filter(|_| self.shadow_map).map(|s| ShadowPasses {
            cascades: s.cascades.clamp(1, MAX_CASCADES as u32),
            map_size: s.map_size.max(1),
            ..s
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

    /// Sets the shadow atlas's tile passes for the next frames, or none. A new tile count or size
    /// declares the passes again, which makes the atlas again. A builder that binds no shadow map
    /// draws no tiles.
    pub(crate) fn set_tiles(&mut self, tiles: Option<TilePasses>) {
        let tiles = tiles.filter(|t| self.shadow_map && t.tiles > 0);
        if tiles != self.tiles {
            self.declared = false;
        }
        self.tiles = tiles;
    }

    /// The render graph.
    pub(crate) fn graph(&self) -> &RenderGraph {
        &self.graph
    }

    /// What the outline mask's pipelines and bundles draw into: the mask's format, the depth format
    /// and the scene's sample count.
    pub(crate) fn outline_targets(&self) -> PassTargets {
        PassTargets {
            color_format: outline::MASK_FORMAT,
            depth_format: DEPTH_FORMAT,
            samples: self.samples,
            permutation: 0,
        }
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

    /// Bytes that one frame may copy into its arena for the graph's own passes. The final pass can
    /// start to run in any frame, once the render scale can drop.
    pub(crate) fn upload_bound(&self) -> usize {
        let bloom = if self.bloom_pass.is_some() {
            BloomPass::UPLOAD_BYTES
        } else {
            0
        };
        let ao = if self.ao.is_some() {
            AoPass::UPLOAD_BYTES
        } else {
            0
        };
        FinalPass::UPLOAD_BYTES + bloom + ao
    }

    /// True when the final pass takes the scene color to the canvas, and false when the resolve
    /// pass does.
    fn final_runs(&self) -> bool {
        !self.resolves || self.scales || self.grades || self.outline_draws()
    }

    /// Says whether the render scale may drop below the whole canvas. Where the scene could
    /// resolve into the canvas, that switches the final pass on in place of the resolve pass, and
    /// the graph compiles again.
    pub(crate) fn set_scaling(&mut self, scales: bool) {
        self.scales = scales;
        self.enable_outputs();
    }

    /// Says whether the sketch sets a color grading table or the vignette. Where the scene could
    /// resolve into the canvas, a change switches the final pass on or off in place of the
    /// resolve pass, and the graph compiles again.
    pub(crate) fn set_grading(&mut self, grades: bool) {
        if grades != self.grades {
            self.grades = grades;
            self.enable_outputs();
        }
    }

    /// Switches on the pass that takes the scene color to the canvas, and off the others, with
    /// bloom's passes while bloom draws and the outline's while it draws.
    fn enable_outputs(&mut self) {
        let blooms = self.bloom_draws();
        let outlines = self.outline_draws();
        if let Some(Outputs { resolve, finals }) = self.outputs {
            let final_runs = self.final_runs();
            self.graph.set_enabled(resolve, !final_runs);
            for (bloom, passes) in finals.into_iter().enumerate() {
                for (outline, pass) in passes.into_iter().enumerate() {
                    if let Some(pass) = pass {
                        let on = final_runs && blooms == (bloom == 1) && outlines == (outline == 1);
                        self.graph.set_enabled(pass, on);
                    }
                }
            }
        }
        for &pass in &self.bloom_passes {
            self.graph.set_enabled(pass, blooms);
        }
        for &pass in &self.outline_passes {
            self.graph.set_enabled(pass, outlines);
        }
    }

    /// Turns outlines on with their settings, or off with `None`, for the next frames, while
    /// `outlined` says that some object is outlined. The graph compiles again only when outlines
    /// start or stop drawing.
    pub(crate) fn set_outline(&mut self, outline: Option<Outline>, outlined: bool) {
        let was = self.outline_draws();
        self.outline = outline;
        self.outlined = outlined;
        if self.outline_draws() != was {
            self.enable_outputs();
        }
    }

    /// True while outlines draw: the sketch turned them on, and some object is outlined.
    pub(crate) fn outline_draws(&self) -> bool {
        self.outline.is_some() && self.outlined
    }

    /// Turns bloom on with its settings, or off with `None`, for the next frames, with each blur
    /// reading `divisor` times fewer taps than three.js's. The graph compiles again only when
    /// bloom turns on or off. The 8-bit path draws no bloom.
    pub(crate) fn set_bloom(&mut self, bloom: Option<Bloom>, divisor: u32) {
        let was = self.bloom_draws();
        self.bloom = bloom;
        self.bloom_divisor = divisor.clamp(1, bloom::MAX_SAMPLE_DIVISOR);
        if self.bloom_draws() != was {
            self.enable_outputs();
        }
    }

    /// True while bloom draws: the sketch turned it on, and the scene color holds HDR color.
    pub(crate) fn bloom_draws(&self) -> bool {
        self.bloom.is_some() && self.bloom_pass.is_some()
    }

    /// Declares the passes again when the number of views changed, and gives each view's opaque
    /// pass and depth prepass the view's layers, which change without a new plan.
    pub(crate) fn sync_views(&mut self, views: &[View]) {
        if views.len() != self.views || !self.declared {
            self.declare(views);
        }
        for (&pass, view) in self.opaque.iter().zip(views) {
            self.graph.set_layers(pass, view.layers());
        }
        for (&pass, view) in self.prepasses.iter().zip(views) {
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

    /// Switches the views' transparent passes on while some object blends, and off otherwise. The
    /// graph compiles again only when that changes.
    pub(crate) fn set_transparent(&mut self, on: bool) {
        self.transparent_on = on;
        for &pass in &self.transparent {
            self.graph.set_enabled(pass, on);
        }
    }

    /// True when the skinning pass runs: with skinned meshes, where the GPU culls.
    fn skins(&self) -> bool {
        self.skinning && self.gpu_culling
    }

    fn add(&mut self, pass: Pass, role: Role) -> PassId {
        self.roles.push(role);
        self.graph.add_pass(pass)
    }

    /// Declares the engine's passes for `views`: each view's culling pass on WebGPU, each shadow
    /// cascade's and each shadow tile's culling and shadow passes, each view's depth prepass with
    /// the prepass and its opaque pass, the debug lines pass, which is off, each view's
    /// transparent pass, then the resolve pass and the final pass, of which one runs.
    fn declare(&mut self, views: &[View]) {
        self.graph.clear();
        self.roles.clear();
        self.opaque.clear();
        self.prepasses.clear();
        self.transparent.clear();
        self.shadow_passes.clear();
        self.bloom_passes.clear();
        self.outline_passes.clear();
        let prepass = self.depth_prepass();
        let color = Target::color(self.scene_color.format()).samples(self.samples);
        let depth = Target::depth(DEPTH_FORMAT).samples(self.samples);
        if self.shadow_map {
            let (layers, size) = self.shadows.map_or((1, 1), |s| (s.cascades, s.map_size));
            let map = Target::depth(DEPTH_FORMAT).layers(layers).array();
            let size = Size::Fixed {
                width: size,
                height: size,
            };
            self.graph.keep(SHADOW_MAP, map, size);
            let (tiles, size) = self.tiles.map_or((1, 1), |t| (t.tiles, t.size));
            let atlas = Target::depth(DEPTH_FORMAT).layers(tiles).array();
            let size = Size::Fixed {
                width: size,
                height: size,
            };
            self.graph.keep(SHADOW_ATLAS, atlas, size);
        }
        if self.gpu_culling {
            self.graph.import_buffer(LIGHTS);
            let clusters = Pass::new("LightClusters", PassKind::Compute)
                .reads(LIGHTS)
                .creates_buffer(LIGHT_GRID);
            self.add(clusters, Role::LightClusters);
            self.graph.import_buffer(OBJECTS);
            for index in 0..views.len() {
                let pass = Pass::new(view_name(index, "Culling", "Culling"), PassKind::Compute)
                    .reads(OBJECTS)
                    .creates_buffer(view_name(index, "visible", "visible"));
                self.add(pass, Role::Cull(ViewId::from_index(index)));
            }
            if self.skinning {
                let skin = Pass::new("Skinning", PassKind::Compute).creates_buffer(SKINNED);
                self.add(skin, Role::Skin);
            }
        }
        if let Some(shadows) = self.shadows {
            self.declare_shadows(shadows);
        }
        if let Some(tiles) = self.tiles {
            self.declare_tiles(tiles);
        }
        for (index, view) in views.iter().enumerate() {
            let depth_name = view_name(index, SCENE_DEPTH, "depth");
            let mut pass = Pass::new(view_name(index, "Opaque", "Opaque"), PassKind::Scene)
                .layers(view.layers())
                .creates(view_name(index, SCENE_COLOR, "color"), color);
            if prepass {
                let mut prepass = Pass::new(
                    view_name(index, "DepthPrepass", "DepthPrepass"),
                    PassKind::Scene,
                )
                .layers(view.layers())
                .creates(depth_name.clone(), depth);
                if self.gpu_culling {
                    prepass = prepass.reads(view_name(index, "visible", "visible"));
                }
                if self.skins() {
                    prepass = prepass.reads(SKINNED);
                }
                let occludes = index == ViewId::CAMERA.index() && self.ao.is_some();
                if occludes {
                    prepass = prepass.creates(PREPASS_COLOR, color);
                }
                let prepass = self.add(prepass, Role::Prepass(ViewId::from_index(index)));
                self.prepasses.push(prepass);
                if occludes {
                    self.declare_ao();
                    pass = pass.reads(AO_TARGETS[ao::STEPS - 1]);
                }
                pass = pass.writes(depth_name);
            } else {
                pass = pass.creates(depth_name, depth);
            }
            if self.gpu_culling {
                pass = pass.reads(view_name(index, "visible", "visible"));
                if index == ViewId::CAMERA.index() {
                    pass = pass.reads(LIGHT_GRID);
                }
            }
            if self.skins() {
                pass = pass.reads(SKINNED);
            }
            if self.shadow_map {
                pass = pass.reads(SHADOW_MAP).reads(SHADOW_ATLAS);
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
        for index in 0..views.len() {
            let pass = Pass::new(
                view_name(index, "Transparent", "Transparent"),
                PassKind::Scene,
            )
            .writes(view_name(index, SCENE_COLOR, "color"))
            .writes(view_name(index, SCENE_DEPTH, "depth"));
            let pass = self.add(pass, Role::Transparent(ViewId::from_index(index)));
            self.graph.set_enabled(pass, self.transparent_on);
            self.transparent.push(pass);
        }
        self.declare_outline(color.samples);
        let resolve = Pass::new("Resolve", PassKind::Resolve)
            .reads(SCENE_COLOR)
            .writes(CANVAS);
        let resolve = self.add(resolve, Role::Resolve);
        let final_pass = Pass::new("Final", PassKind::Fullscreen)
            .size(Size::Canvas)
            .reads(SCENE_COLOR)
            .writes(CANVAS);
        let final_outline = with_outline(final_pass.clone()).named("FinalOutline");
        let final_pass = self.add(final_pass, Role::Final);
        let final_outline = self.add(final_outline, Role::Final);
        let mut finals = [[Some(final_pass), Some(final_outline)], [None, None]];
        if self.bloom_pass.is_some() {
            let final_bloom = self.declare_bloom();
            let final_bloom_outline = with_outline(final_bloom.clone()).named("FinalBloomOutline");
            finals[1] = [
                Some(self.add(final_bloom, Role::FinalBloom)),
                Some(self.add(final_bloom_outline, Role::FinalBloom)),
            ];
        }
        self.outputs = Some(Outputs { resolve, finals });
        self.enable_outputs();
        self.views = views.len();
        self.declared = true;
    }

    /// Declares the outline's passes: on WebGPU the outline view's culling pass, then the mask
    /// pass, which draws into a mask of the scene's `samples` with the scene's depth.
    fn declare_outline(&mut self, samples: u32) {
        let mask = Target::color(outline::MASK_FORMAT).samples(samples);
        let mut pass = Pass::new("OutlineMask", PassKind::Scene)
            .creates(OUTLINE_MASK, mask)
            .writes(SCENE_DEPTH);
        if self.gpu_culling {
            let culling = Pass::new(OUTLINE_CULLING, PassKind::Compute)
                .reads(OBJECTS)
                .creates_buffer(OUTLINE_VISIBLE);
            let culling = self.add(culling, Role::Cull(ViewId::OUTLINE));
            self.outline_passes.push(culling);
            pass = pass.reads(OUTLINE_VISIBLE);
        }
        if self.skins() {
            pass = pass.reads(SKINNED);
        }
        let pass = self.add(pass, Role::OutlineMask);
        self.outline_passes.push(pass);
    }

    /// Declares ambient occlusion's steps: the depth copy reads the scene depth as the prepass
    /// leaves it, the horizon search reads the copy, and the denoise reads both.
    fn declare_ao(&mut self) {
        self.ao_steps();
        for step in 0..ao::STEPS {
            let mut pass = Pass::new(AO_PASSES[step], PassKind::Fullscreen)
                .size(ao::SIZE)
                .creates(AO_TARGETS[step], Target::color(ao::FORMATS[step]));
            pass = match step {
                0 => pass.reads_so_far(SCENE_DEPTH),
                1 => pass.reads(AO_TARGETS[0]),
                _ => pass.reads(AO_TARGETS[0]).reads(AO_TARGETS[1]),
            };
            self.add(pass, Role::Ao(step as u8));
        }
    }

    /// Ambient occlusion's steps, made for the scene depth's samples when first asked for.
    fn ao_steps(&mut self) -> &mut AoPass {
        // WebGL2 has no multisampled textures: its backend gives the depth step a copy of one
        // sample.
        let samples = if self.gpu_culling { self.samples } else { 1 };
        self.ao_pass
            .get_or_insert_with(|| AoPass::new(self.ao_ids, samples))
    }

    /// Declares bloom's steps, each reading the target of the step before it, and returns the
    /// declaration of the final pass with bloom, which reads every level.
    fn declare_bloom(&mut self) -> Pass {
        let target = Target::color(self.scene_color.format());
        for step in 0..STEPS {
            let pass = Pass::new(BLOOM_PASSES[step], PassKind::Fullscreen)
                .size(bloom::step_size(step))
                .reads(bloom_source(step))
                .creates(BLOOM_TARGETS[step], target);
            let pass = self.add(pass, Role::Bloom(step as u8));
            self.bloom_passes.push(pass);
        }
        let mut final_bloom = Pass::new("FinalBloom", PassKind::Fullscreen)
            .size(Size::Canvas)
            .reads(SCENE_COLOR)
            .writes(CANVAS);
        for level in 0..LEVELS {
            final_bloom = final_bloom.reads(BLOOM_TARGETS[bloom_level(level)]);
        }
        final_bloom
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
            if self.skins() {
                pass = pass.reads(SKINNED);
            }
            let pass = self.add(pass, Role::Shadow(view));
            self.shadow_passes.push(pass);
        }
    }

    /// Declares each tile's culling pass on WebGPU, and its shadow pass, which draws into the
    /// tile's layer of the shadow atlas.
    fn declare_tiles(&mut self, tiles: TilePasses) {
        let size = Size::Fixed {
            width: tiles.size,
            height: tiles.size,
        };
        for tile in 0..tiles.tiles as usize {
            let view = ViewId::tile(tile);
            let mut pass = Pass::new(numbered("ShadowTile", tile), PassKind::Shadow)
                .size(size)
                .writes_layer(SHADOW_ATLAS, tile as u32);
            if self.gpu_culling {
                let visible = numbered("tileVisible", tile);
                let culling = Pass::new(numbered("TileCulling", tile), PassKind::Compute)
                    .reads(OBJECTS)
                    .creates_buffer(visible.clone());
                self.add(culling, Role::Cull(view));
                pass = pass.reads(visible);
            }
            if self.skins() {
                pass = pass.reads(SKINNED);
            }
            self.add(pass, Role::Shadow(view));
        }
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
        self.scale = if self.final_runs() {
            scale
        } else {
            RenderScale::FULL
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
    /// asks before it records the pipelines that its frame creates. Frames that resolve into the
    /// canvas ask too, so the pipeline is ready once the render scale can drop.
    pub(crate) fn request_pipelines(&mut self, pipelines: &mut PipelineCache) {
        let blooms = self.bloom_draws();
        self.final_pass.request_pipeline(pipelines, blooms);
        if self.ao.is_some() {
            self.ao_steps().request_pipelines(pipelines);
        }
        if let (true, Some(bloom)) = (blooms, self.bloom_pass.as_mut()) {
            bloom.request_pipeline(pipelines);
        }
    }

    /// Records what the graph's own passes need before the frame's passes, from copies in the
    /// frame's arena: when the final pass runs, its objects, its settings when they changed, and
    /// its binding of the scene color when the frame made the plan's textures. The final pass
    /// grades with `grading`. Call it after [`FrameGraph::prepare`], and after the frame's texture
    /// uploads, so a color grading table whose last texels this frame uploads grades it.
    pub(crate) fn upload(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        output: Output,
        grading: Grading,
    ) -> Result<(), RecordError> {
        self.upload_ao(list, arena)?;
        if !self.final_runs() {
            return Ok(());
        }
        let scene_color = self
            .sampled_id(SCENE_COLOR)
            .expect("the final pass samples the scene color");
        let render_size = Size::Full.viewport(self.canvas, self.scale);
        let bloom = if self.bloom_draws() {
            let sources: [u32; STEPS] = std::array::from_fn(|step| {
                self.sampled_id(bloom_source(step))
                    .expect("each step of bloom reads a planned texture")
            });
            let levels = std::array::from_fn(|level| {
                self.sampled_id(BLOOM_TARGETS[bloom_level(level)])
                    .expect("the final pass reads each of bloom's levels")
            });
            let (canvas, scale, divisor, made) = (
                self.canvas,
                self.scale,
                self.bloom_divisor,
                self.textures_made,
            );
            match (self.bloom, self.bloom_pass.as_mut()) {
                (Some(settings), Some(pass)) => {
                    pass.prepare(
                        list, arena, canvas, scale, settings, divisor, &sources, made,
                    )?;
                    Some(BloomInputs::new(pass.ids(), levels))
                }
                _ => None,
            }
        } else {
            None
        };
        let outline = match (self.outline, self.outline_draws()) {
            (Some(outline), true) => Some(OutlineInputs {
                mask: self
                    .sampled_id(OUTLINE_MASK)
                    .expect("the final pass reads the outline mask while outlines draw"),
                outline,
            }),
            _ => None,
        };
        self.final_pass.prepare(
            list,
            arena,
            output,
            render_size,
            scene_color,
            bloom,
            grading,
            outline,
            self.textures_made,
        )
    }

    /// Records ambient occlusion's objects and settings while it draws, and binds each step to the
    /// textures it reads.
    fn upload_ao(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
    ) -> Result<(), RecordError> {
        let Some(settings) = self.ao else {
            return Ok(());
        };
        let id = |name: &str| {
            self.sampled_id(name)
                .expect("each step of ambient occlusion reads a planned texture")
        };
        let [depth, horizon] = [id(AO_TARGETS[0]), id(AO_TARGETS[1])];
        let sources: StepSources = [[id(SCENE_DEPTH); 2], [depth, depth], [depth, horizon]];
        let (canvas, scale, ao_scale, made) =
            (self.canvas, self.scale, self.ao_scale, self.textures_made);
        let projection = self.projection;
        let pass = self
            .ao_pass
            .as_mut()
            .expect("ambient occlusion's steps exist once it is declared");
        pass.prepare(
            list, arena, settings, projection, canvas, scale, ao_scale, &sources, made,
        )
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
    /// its color targets to `clear`, except the outline mask's pass, which clears to zero: no
    /// object covers the mask there. A render pass whose passes all have roles that `skips` names
    /// is left out, so its targets keep what earlier frames drew.
    pub(crate) fn record(
        &self,
        list: &mut DrawList,
        clear: [f32; 4],
        skips: impl Fn(Role) -> bool,
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
                    let passes = plan.passes(step);
                    if passes.iter().all(|&pass| skips(self.roles[pass.index()])) {
                        continue;
                    }
                    let masks = passes
                        .iter()
                        .any(|&pass| self.roles[pass.index()] == Role::OutlineMask);
                    let clear = if masks { [0.0; 4] } else { clear };
                    self.begin_render_pass(list, plan, step, clear)?;
                    self.set_render_area(list, size)?;
                    for &pass in plan.passes(step) {
                        match self.roles[pass.index()] {
                            Role::Final => self.final_pass.record(list, false)?,
                            Role::FinalBloom => self.final_pass.record(list, true)?,
                            Role::Bloom(step) => self
                                .bloom_pass
                                .as_ref()
                                .expect("bloom's passes run only on the HDR path")
                                .record(list, usize::from(step))?,
                            Role::Ao(step) => self
                                .ao_pass
                                .as_ref()
                                .expect("ambient occlusion's passes run once it is declared")
                                .record(
                                    list,
                                    usize::from(step),
                                    ao::corner(self.canvas, self.scale, self.ao_scale),
                                )?,
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

    /// The draw list's id of the texture that passes sample for the resource of `name`, once the
    /// graph compiled, or `None` for a resource that the plan does not sample.
    fn sampled_id(&self, name: &str) -> Option<u32> {
        let plan = self.graph.plan()?;
        let surface = plan.sampled_texture_of(self.graph.find_resource(name)?)?;
        Some(self.texture_id(surface))
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

    /// The draw list's id of the shadow atlas, which bind groups name, or `None` for a builder that
    /// binds no shadow map. Valid once the frame's [`FrameGraph::prepare`] made the plan's textures.
    pub(crate) fn shadow_atlas(&self) -> Option<u32> {
        if !self.shadow_map {
            return None;
        }
        let plan = self.graph.plan()?;
        let surface = plan.texture_of(self.graph.find_resource(SHADOW_ATLAS)?)?;
        Some(self.texture_id(surface))
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
        if let Some(bloom) = self.bloom_pass.as_mut() {
            bloom.reset_gpu();
        }
        if let Some(ao) = self.ao_pass.as_mut() {
            ao.reset_gpu();
        }
    }
}

/// The same declaration of a final pass, which reads the outline mask too.
fn with_outline(pass: Pass) -> Pass {
    pass.reads(OUTLINE_MASK)
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
            blank_lut: 900,
            lut_sampler: 9,
            blank_outline: 901,
        },
        bloom: BloomIds {
            buffer: 10,
            sampler: 10,
            first_group: 10,
        },
        ao: AoIds {
            buffer: 11,
            first_group: 20,
        },
    };

    /// A graph for a scene color in `format`, in the `antialias` mode, with or without GPU culling
    /// and transient attachments.
    fn frame_graph(
        format: u32,
        antialias: Antialias,
        gpu_culling: bool,
        transient: bool,
    ) -> FrameGraph {
        let canvas = CanvasOutput {
            scene_color: SceneColor::from_format(format),
            antialias,
            transparent: false,
        };
        FrameGraph::new(gpu_culling, canvas, transient, IDS)
    }

    #[test]
    fn each_view_adds_its_passes_and_the_8_bit_path_resolves_into_the_canvas() {
        let mut frames = frame_graph(format::CANVAS, Antialias::Msaa, true, false);
        frames.sync_views(&[View::default(), View::default()]);
        let graph = frames.graph();
        let names = [
            "LightClusters",
            "Culling",
            "Culling1",
            "Opaque",
            "Opaque1",
            "DebugLines",
            "Transparent",
            "Transparent1",
            "OutlineCulling",
            "OutlineMask",
            "Resolve",
            "Final",
            "FinalOutline",
        ];
        assert_eq!(graph.pass_count(), names.len());
        for (place, name) in names.into_iter().enumerate() {
            assert_eq!(graph.find_pass(name).map(PassId::index), Some(place));
        }
        assert_eq!(
            frames.roles,
            [
                Role::LightClusters,
                Role::Cull(ViewId::CAMERA),
                Role::Cull(ViewId::from_index(1)),
                Role::Opaque(ViewId::CAMERA),
                Role::Opaque(ViewId::from_index(1)),
                Role::DebugLines,
                Role::Transparent(ViewId::CAMERA),
                Role::Transparent(ViewId::from_index(1)),
                Role::Cull(ViewId::OUTLINE),
                Role::OutlineMask,
                Role::Resolve,
                Role::Final,
                Role::Final,
            ]
        );
        for (place, name) in names.into_iter().enumerate() {
            let on = matches!(name, "LightClusters" | "Culling" | "Culling1" | "Resolve")
                || name.starts_with("Opaque");
            let pass = graph.find_pass(name).unwrap();
            assert_eq!(
                (pass.index(), graph.is_enabled(pass)),
                (place, on),
                "{name}"
            );
        }
        assert!(graph.is_enabled(graph.find_pass("Resolve").unwrap()));

        // A render scale that can drop needs the final pass to scale the image up.
        frames.set_scaling(true);
        let graph = frames.graph();
        assert!(graph.is_enabled(graph.find_pass("Final").unwrap()));
        assert!(!graph.is_enabled(graph.find_pass("Resolve").unwrap()));

        // The WebGL2 path culls on the job workers, so its graph has no culling passes.
        let mut frames = frame_graph(format::CANVAS, Antialias::Msaa, false, false);
        frames.sync_views(&[View::default()]);
        assert_eq!(frames.graph().pass_count(), 7);
        assert_eq!(frames.roles[0], Role::Opaque(ViewId::CAMERA));
    }

    #[test]
    fn hdr_color_runs_the_final_pass_instead_of_the_resolve_pass() {
        for hdr in [format::RGBA16_FLOAT, format::RG11B10_UFLOAT] {
            let mut frames = frame_graph(hdr, Antialias::Msaa, false, false);
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
            assert_eq!(
                frames.upload_bound(),
                FinalPass::UPLOAD_BYTES + BloomPass::UPLOAD_BYTES
            );
        }
    }

    #[test]
    fn one_sample_modes_draw_the_scene_color_that_the_final_pass_reads_on_both_paths() {
        for scene_color in [format::RGBA16_FLOAT, format::CANVAS] {
            for antialias in [Antialias::Fxaa, Antialias::None] {
                let mut frames = frame_graph(scene_color, antialias, true, false);
                frames.sync_views(&[View::default()]);
                assert_eq!(frames.scene_targets().samples, 1);
                let graph = &mut frames.graph;
                assert!(graph.compile().unwrap());
                assert!(graph.is_enabled(graph.find_pass("Final").unwrap()));
                assert!(!graph.is_enabled(graph.find_pass("Resolve").unwrap()));
                // No texture has more than one sample, and the final pass reads the color that
                // the scene draws into, which nothing resolves.
                let plan = graph.plan().unwrap();
                assert!(plan.textures().iter().all(|t| t.target.samples == 1));
                assert_eq!(plan.textures().len(), 2);
                let scene = graph.find_resource(SCENE_COLOR).unwrap();
                assert!(matches!(
                    plan.sampled_texture_of(scene),
                    Some(Surface::Texture(_))
                ));
                for step in plan.steps() {
                    assert!(plan.attachments(step).iter().all(|a| a.resolve.is_none()));
                }
                let bloom = if scene_color == format::CANVAS {
                    0
                } else {
                    BloomPass::UPLOAD_BYTES
                };
                assert_eq!(frames.upload_bound(), FinalPass::UPLOAD_BYTES + bloom);
            }
        }
    }

    #[test]
    fn transient_attachments_only_where_the_device_has_them() {
        use null3d_gpu::drawlist::texture_usage::TRANSIENT_ATTACHMENT;
        for transient in [false, true] {
            let mut frames = frame_graph(format::RGBA16_FLOAT, Antialias::Msaa, true, transient);
            frames.sync_views(&[View::default()]);
            let graph = &mut frames.graph;
            graph.compile().unwrap();
            // The multisampled color and the depth live within the scene's render pass. The
            // texture that the color resolves into lasts until the final pass reads it.
            let short_lived: Vec<_> = graph
                .plan()
                .unwrap()
                .textures()
                .iter()
                .filter(|t| t.usage & TRANSIENT_ATTACHMENT != 0)
                .map(|t| t.target)
                .collect();
            let expected = if transient {
                vec![
                    Target::depth(DEPTH_FORMAT).samples(4),
                    Target::color(format::RGBA16_FLOAT).samples(4),
                ]
            } else {
                Vec::new()
            };
            assert_eq!(short_lived.len(), expected.len());
            for target in expected {
                assert!(short_lived.contains(&target), "{target:?}");
            }
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
        let mut frames = frame_graph(format::CANVAS, Antialias::Msaa, true, false);
        frames.sync_views(&[View::default(), View::default()]);
        let mut list = DrawList::with_capacity(256);
        frames
            .prepare(&mut list, (64, 64), RenderScale::FULL)
            .unwrap();
        let without = steps(&frames);
        assert_eq!(
            without,
            [
                vec!["LightClusters", "Culling", "Culling1"],
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

    #[test]
    fn each_view_depth_prepass_draws_first_in_its_render_pass_and_creates_its_depth() {
        let mut frames = frame_graph(format::CANVAS, Antialias::Msaa, true, false);
        frames.set_depth_prepass(true);
        frames.sync_views(&[View::default(), View::default()]);
        assert_eq!(
            frames.roles[..7],
            [
                Role::LightClusters,
                Role::Cull(ViewId::CAMERA),
                Role::Cull(ViewId::from_index(1)),
                Role::Prepass(ViewId::CAMERA),
                Role::Opaque(ViewId::CAMERA),
                Role::Prepass(ViewId::from_index(1)),
                Role::Opaque(ViewId::from_index(1)),
            ]
        );
        let mut list = DrawList::with_capacity(256);
        frames
            .prepare(&mut list, (64, 64), RenderScale::FULL)
            .unwrap();
        let with = steps(&frames);
        assert_eq!(
            with,
            [
                vec!["LightClusters", "Culling", "Culling1"],
                vec!["DepthPrepass", "Opaque", "Resolve"],
                vec!["DepthPrepass1", "Opaque1"]
            ]
        );
        // The prepass begins the render pass, which clears the color and the depth.
        list.clear();
        frames
            .record(&mut list, [0.0; 4], |_| false, |_, _| Ok(()))
            .unwrap();
        let passes = operands(&list, Op::BeginRenderPass);
        let both = pass_flags::CLEAR_COLOR | pass_flags::CLEAR_DEPTH;
        assert!(passes[..2].iter().all(|pass| pass[8] & both == both));
        // The prepass makes no texture of its own.
        let textures = frames.graph().plan().unwrap().textures().len();
        let mut without = frame_graph(format::CANVAS, Antialias::Msaa, true, false);
        without.sync_views(&[View::default(), View::default()]);
        without
            .prepare(&mut list, (64, 64), RenderScale::FULL)
            .unwrap();
        assert_eq!(without.graph().plan().unwrap().textures().len(), textures);
        // Views keep their prepass when they change.
        frames.sync_views(&[View::default()]);
        frames
            .prepare(&mut list, (64, 64), RenderScale::FULL)
            .unwrap();
        assert_eq!(steps(&frames)[1], ["DepthPrepass", "Opaque", "Resolve"]);
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
        let mut frames = frame_graph(format::CANVAS, Antialias::Msaa, false, false);
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
        frames
            .record(&mut list, [0.0; 4], |_| false, |_, _| Ok(()))
            .unwrap();
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

    #[test]
    fn transparent_passes_draw_last_in_each_view_render_pass_while_something_blends() {
        let mut frames = frame_graph(format::CANVAS, Antialias::Msaa, true, false);
        frames.sync_views(&[View::default(), View::default()]);
        let mut list = DrawList::with_capacity(256);
        frames.set_debug_lines(true);
        frames.set_transparent(true);
        frames
            .prepare(&mut list, (64, 64), RenderScale::FULL)
            .unwrap();
        assert_eq!(
            steps(&frames),
            [
                vec!["LightClusters", "Culling", "Culling1"],
                vec!["Opaque", "DebugLines", "Transparent", "Resolve"],
                vec!["Opaque1", "Transparent1"]
            ],
            "blended objects draw over the opaque ones and the lines, before the color resolves"
        );
        // Views declared later take the passes' state.
        frames.sync_views(&[View::default(); 3]);
        frames
            .prepare(&mut list, (64, 64), RenderScale::FULL)
            .unwrap();
        assert_eq!(steps(&frames)[3], ["Opaque2", "Transparent2"]);
        frames.set_transparent(false);
        frames
            .prepare(&mut list, (64, 64), RenderScale::FULL)
            .unwrap();
        assert_eq!(steps(&frames)[3], ["Opaque2"]);

        // On the HDR path the final pass reads the scene color after the blended objects.
        let mut frames = frame_graph(format::RGBA16_FLOAT, Antialias::Msaa, true, false);
        frames.sync_views(&[View::default()]);
        frames.set_transparent(true);
        frames
            .prepare(&mut list, (64, 64), RenderScale::FULL)
            .unwrap();
        assert_eq!(
            &steps(&frames)[1..],
            [vec!["Opaque", "Transparent"], vec!["Final"]]
        );
    }

    #[test]
    fn bloom_runs_its_steps_between_the_scene_and_the_final_pass_only_while_it_is_on() {
        let mut frames = frame_graph(format::RGBA16_FLOAT, Antialias::Msaa, true, false);
        frames.sync_views(&[View::default()]);
        let mut list = DrawList::with_capacity(4096);
        frames
            .prepare(&mut list, (320, 180), RenderScale::FULL)
            .unwrap();
        let without = frames.graph().plan().unwrap().textures().len();
        assert_eq!(steps(&frames).last().unwrap(), &["Final"]);

        frames.set_bloom(Some(Bloom::default()), 1);
        frames.request_pipelines(&mut PipelineCache::default());
        frames
            .prepare(&mut list, (320, 180), RenderScale::FULL)
            .unwrap();
        let names = steps(&frames);
        let mut expected: Vec<Vec<String>> = BLOOM_PASSES
            .iter()
            .map(|name| vec![name.to_string()])
            .collect();
        expected.push(vec!["FinalBloom".into()]);
        assert_eq!(names[names.len() - expected.len()..], expected[..]);
        // Each step draws at its size into a target of its own: the bright pass and level 0's blur
        // down share one texture, as their steps do not overlap, and every other target has one.
        let plan = frames.graph().plan().unwrap();
        let textures = plan.textures();
        assert_eq!(textures.len(), without + STEPS - 1);
        let texture = |name: &str| plan.texture_of(frames.graph().find_resource(name).unwrap());
        assert_eq!(texture("bloomBright"), texture("bloomY0"));
        for step in 1..STEPS {
            let surface = texture(BLOOM_TARGETS[step]).unwrap();
            let Surface::Texture(index) = surface else {
                panic!("bloom draws into textures")
            };
            assert_eq!(textures[usize::from(index)].size, bloom::step_size(step));
            assert_ne!(
                texture(BLOOM_TARGETS[step - 1]),
                Some(surface),
                "no step reads its target"
            );
        }

        // A new render scale makes no GPU object: the frame only uploads new settings.
        let mut arena = UploadArena::default();
        let output = Output::default();
        arena.reset(frames.upload_bound());
        frames
            .upload(&mut list, &mut arena, output, Grading::default())
            .unwrap();
        list.clear();
        frames.set_scaling(true);
        frames
            .prepare(&mut list, (320, 180), RenderScale::from_thousandths(500))
            .unwrap();
        arena.reset(frames.upload_bound());
        frames
            .upload(&mut list, &mut arena, output, Grading::default())
            .unwrap();
        let ops: Vec<Op> = null3d_gpu::drawlist::decode(list.words())
            .map(|command| command.unwrap().op)
            .collect();
        assert!(ops.iter().all(|&op| op == Op::WriteBuffer), "{ops:?}");
        list.clear();
        frames
            .record(&mut list, [0.0; 4], |_| false, |_, _| Ok(()))
            .unwrap();
        // Each step draws its corner: half of each side, rounded up.
        let viewports = operands(&list, Op::SetViewport);
        assert_eq!(viewports[1][2..4], [80, 45]);
        assert_eq!(viewports.last().unwrap()[2..4], [5, 3]);

        // Off again, the steps and their targets are gone.
        frames.set_bloom(None, 1);
        frames
            .prepare(&mut list, (320, 180), RenderScale::FULL)
            .unwrap();
        assert_eq!(frames.graph().plan().unwrap().textures().len(), without);
    }

    #[test]
    fn outlines_run_their_mask_with_the_scene_depth_only_while_something_is_outlined() {
        for (scene_color, gpu_culling) in [(format::RGBA16_FLOAT, true), (format::CANVAS, false)] {
            let mut frames = frame_graph(scene_color, Antialias::Msaa, gpu_culling, true);
            frames.sync_views(&[View::default()]);
            let mut list = DrawList::with_capacity(4096);
            frames
                .prepare(&mut list, (320, 180), RenderScale::FULL)
                .unwrap();
            let without = steps(&frames);
            let textures = frames.graph().plan().unwrap().textures().len();

            // Outlines on with nothing outlined change nothing.
            frames.set_outline(Some(Outline::default()), false);
            frames
                .prepare(&mut list, (320, 180), RenderScale::FULL)
                .unwrap();
            assert_eq!(steps(&frames), without);

            frames.set_outline(Some(Outline::default()), true);
            frames.request_pipelines(&mut PipelineCache::default());
            frames
                .prepare(&mut list, (320, 180), RenderScale::FULL)
                .unwrap();
            let names = steps(&frames);
            let tail: Vec<&str> = names[names.len() - 2..]
                .iter()
                .map(|step| step[0].as_str())
                .collect();
            assert_eq!(
                tail,
                ["OutlineMask", "FinalOutline"],
                "the final pass runs in place of the resolve pass, after the mask pass"
            );
            let graph = frames.graph();
            let plan = graph.plan().unwrap();
            let opaque = plan.step_of(graph.find_pass("Opaque").unwrap()).unwrap();
            let depth = plan.attachments(&plan.steps()[opaque])[1];
            assert_eq!(depth.store, StoreOp::Store, "the mask pass needs the depth");
            let mask = plan
                .step_of(graph.find_pass("OutlineMask").unwrap())
                .unwrap();
            let mask = plan.attachments(&plan.steps()[mask]);
            assert_eq!(
                (mask[0].format, mask[0].load, mask[1].load, mask[1].depth),
                (outline::MASK_FORMAT, LoadOp::Clear, LoadOp::Load, true)
            );
            assert!(mask[0].resolve.is_some(), "the multisampled mask resolves");
            list.clear();
            let background = [0.25f32, 0.5, 0.75, 1.0].map(f32::to_bits);
            frames
                .record(&mut list, [0.25, 0.5, 0.75, 1.0], |_| false, |_, _| Ok(()))
                .unwrap();
            let passes = operands(&list, Op::BeginRenderPass);
            let cleared_to_zero: Vec<_> =
                passes.iter().filter(|pass| pass[3..7] == [0; 4]).collect();
            assert_eq!(cleared_to_zero.len(), 1, "only the mask clears to zero");
            let flags = cleared_to_zero[0][8];
            assert_eq!(
                flags & (pass_flags::CLEAR_COLOR | pass_flags::CLEAR_DEPTH),
                pass_flags::CLEAR_COLOR,
                "the mask clears its color and keeps the scene's depth"
            );
            assert_eq!(
                passes[0][3..7],
                background,
                "the scene clears to the background"
            );

            let mut arena = UploadArena::default();
            arena.reset(frames.upload_bound());
            list.clear();
            let output = Output::default();
            frames
                .upload(&mut list, &mut arena, output, Grading::default())
                .unwrap();
            let groups = operands(&list, Op::CreateBindGroup);
            assert_eq!(
                groups.len(),
                1,
                "the final pass binds the mask in its own group"
            );
            let outline_entries: Vec<_> = groups[0][3..]
                .chunks(5)
                .filter(|entry| entry[0] >= 11)
                .map(|entry| entry[2])
                .collect();
            assert_eq!(outline_entries.len(), 1);
            assert_ne!(outline_entries[0], 901, "the mask, not the blank texture");

            // Nothing outlined: the mask pass and the mask are gone.
            frames.set_outline(Some(Outline::default()), false);
            frames
                .prepare(&mut list, (320, 180), RenderScale::FULL)
                .unwrap();
            assert_eq!(steps(&frames), without);
            assert_eq!(frames.graph().plan().unwrap().textures().len(), textures);
        }
    }

    #[test]
    fn ambient_occlusion_runs_between_the_camera_prepass_and_its_opaque_pass_on_every_path() {
        let lens = ([1.0; 16], [1.0; 16]);
        for (format, antialias, gpu_culling) in [
            (format::RGBA16_FLOAT, Antialias::Msaa, true),
            (format::CANVAS, Antialias::Msaa, true),
            (format::CANVAS, Antialias::Msaa, false),
            (format::RGBA16_FLOAT, Antialias::Fxaa, false),
        ] {
            let mut frames = frame_graph(format, antialias, gpu_culling, true);
            frames.sync_views(&[View::default(), View::default()]);
            let mut list = DrawList::with_capacity(4096);
            frames
                .prepare(&mut list, (320, 180), RenderScale::FULL)
                .unwrap();
            let without = frames.graph().plan().unwrap().textures().len();
            assert!(!frames.depth_prepass());

            frames.set_ao(Some((Ao::default(), lens)), 0.5);
            assert!(
                frames.depth_prepass(),
                "ambient occlusion needs the prepass's depth"
            );
            frames.sync_views(&[View::default(), View::default()]);
            frames.request_pipelines(&mut PipelineCache::default());
            frames
                .prepare(&mut list, (320, 180), RenderScale::FULL)
                .unwrap();
            let names = steps(&frames);
            let at = |name: &str| names.iter().position(|step| step.iter().any(|p| p == name));
            let (prepass, opaque) = (at("DepthPrepass").unwrap(), at("Opaque").unwrap());
            assert_eq!(names[prepass], ["DepthPrepass"], "the prepass draws alone");
            assert_eq!(
                [at("AoDepth"), at("AoHorizon"), at("AoDenoise")],
                [Some(prepass + 1), Some(prepass + 2), Some(prepass + 3)]
            );
            assert_eq!(opaque, prepass + 4);
            // The other view keeps one render pass for its prepass and its opaque pass.
            assert!(
                names
                    .iter()
                    .any(|step| step[..] == ["DepthPrepass1", "Opaque1"])
            );
            // The prepass stores the depth that the depth step reads and the opaque pass loads,
            // and drops its stand-in color.
            let plan = frames.graph().plan().unwrap();
            let attachments = plan.attachments(&plan.steps()[prepass]);
            for attachment in attachments {
                let store = if attachment.depth {
                    StoreOp::Store
                } else {
                    StoreOp::Discard
                };
                assert_eq!(attachment.store, store);
                assert_eq!(attachment.load, LoadOp::Clear);
            }
            let attachments = plan.attachments(&plan.steps()[opaque]);
            let depth = attachments.iter().find(|a| a.depth).unwrap();
            assert_eq!(depth.load, LoadOp::Load);
            // Three targets of half the size, and the camera's depth readable, which no longer
            // shares a texture with the side view's depth, whose usage differs.
            assert_eq!(plan.textures().len(), without + 4);
            let texture = |name: &str| plan.texture_of(frames.graph().find_resource(name).unwrap());
            let depth = texture(SCENE_DEPTH).unwrap();
            let Surface::Texture(index) = depth else {
                panic!("the depth is a texture")
            };
            assert_ne!(
                plan.textures()[usize::from(index)].usage & texture_usage::TEXTURE_BINDING,
                0
            );
            for (step, name) in AO_TARGETS.iter().enumerate() {
                let Surface::Texture(index) = texture(name).unwrap() else {
                    panic!("the steps draw into textures")
                };
                let made = plan.textures()[usize::from(index)];
                assert_eq!(made.size, ao::SIZE);
                assert_eq!(made.target, Target::color(ao::FORMATS[step]));
            }
            assert!(frames.ao_texture().is_some());

            // A lower scale draws a smaller corner of the same targets.
            let mut arena = UploadArena::default();
            arena.reset(frames.upload_bound());
            frames
                .upload(&mut list, &mut arena, Output::default(), Grading::default())
                .unwrap();
            list.clear();
            frames.set_ao(Some((Ao::default(), lens)), 0.25);
            frames
                .prepare(&mut list, (320, 180), RenderScale::FULL)
                .unwrap();
            assert!(list.is_empty(), "a new scale makes no texture");
            list.clear();
            frames
                .record(&mut list, [0.0; 4], |_| false, |_, _| Ok(()))
                .unwrap();
            let viewports = operands(&list, Op::SetViewport);
            assert!(viewports.iter().any(|v| v[2..4] == [80, 45]));

            // Off again, the steps and their targets are gone, and the prepass with them.
            frames.set_ao(None, 0.5);
            assert!(!frames.depth_prepass());
            frames.sync_views(&[View::default(), View::default()]);
            frames
                .prepare(&mut list, (320, 180), RenderScale::FULL)
                .unwrap();
            assert_eq!(frames.graph().plan().unwrap().textures().len(), without);
            assert!(frames.graph().find_pass("AoDepth").is_none());
            assert_eq!(frames.ao_texture(), None);
        }
    }

    #[test]
    fn the_8_bit_path_draws_no_bloom() {
        let mut frames = frame_graph(format::CANVAS, Antialias::Msaa, false, false);
        frames.sync_views(&[View::default()]);
        frames.set_bloom(Some(Bloom::default()), 1);
        assert!(!frames.bloom_draws());
        let mut list = DrawList::with_capacity(1024);
        frames
            .prepare(&mut list, (64, 64), RenderScale::FULL)
            .unwrap();
        assert!(frames.graph().find_pass("BloomBright").is_none());
        assert_eq!(steps(&frames), [vec!["Opaque", "Resolve"]]);
    }
}
