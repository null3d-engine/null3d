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
//! With two-phase occlusion culling on WebGPU, each camera view culls twice before its opaque pass
//! (see [`crate::gpu_driven`]). Its culling pass keeps the objects that drew in the view's last
//! frame, and its occluders' pass draws their depth alone into a depth target of its own. A compute
//! pass builds the view's depth pyramid from that depth, and the late culling pass tests every
//! object in view against the pyramid. The opaque pass then draws what the late pass kept, as it
//! does without occlusion culling, so its targets never leave tile memory between passes. The
//! occluders' pass reads the compacted instances as the first culling pass leaves them, before the
//! late pass writes them again. Occlusion culling and the depth prepass do not run together; the
//! prepass wins.
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
//! The transparent passes are on only while some object blends or lets light through.
//!
//! While some object lets light through, the transmission copy pass comes between the camera's
//! opaque pass and its transparent pass (see [`crate::transmission`]). It reads the scene color as
//! the opaque pass and the debug lines leave it, and draws it into the first level of a target
//! with a whole chain of mip levels. After its render pass the frame makes the other levels, and
//! the camera's transparent pass reads the target. The opaque pass and the transparent pass then
//! draw in two render passes, so the scene's targets leave tile memory between them, and a
//! multisampled scene color resolves at the end of each. Nothing of it runs while no object lets
//! light through.
//!
//! Two passes can take the scene color to the canvas, and the scene color's format and the
//! anti-aliasing mode pick one (see [`crate::output`]). On the HDR path the final pass samples the
//! scene color, which holds exposed color, and draws the canvas: it applies the tone mapping, and
//! encodes the color. On the 8-bit path the scene shaders did that already. With MSAA the resolve pass runs
//! instead: the render pass that draws the scene resolves its multisampled color straight into
//! the canvas, with no pass, copy or target of its own. With one sample, or while the render scale
//! can drop below the whole canvas, the final pass copies the scene color into the canvas. In the
//! FXAA mode the final pass smooths edges on either path.
//!
//! On the HDR path, the sketch's custom effects come after the transparent passes (see
//! [`crate::effects`]): one full-screen pass each, in the sketch's order, each reading the color
//! that the pass before it left and creating a target of its own. Bloom's first step and the final
//! pass then read the last effect's target in place of the scene color. An effect that reads the
//! scene's depth reads it after every pass that draws it. The passes are declared again when the
//! number of effects or their depth reads change.
//!
//! On the HDR path, bloom's passes come between the transparent passes and the final pass (see
//! [`crate::bloom`]): a step down into each level of its mip chain, the first from the scene
//! color, then a step up into each level but the last, which blends the level below into it. The
//! final pass then runs in its bloom build, which reads the base level too. They are declared with
//! the other passes and switched on only while the sketch turns bloom on, so a frame without bloom
//! has none of their targets. The governor's step leaves the plan as it is: the recording skips
//! the render passes of the levels that the frame drops. The 8-bit path has no bloom: its scene color holds display color, which no
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
use crate::bloom::{self, Bloom, BloomIds, BloomPass, ChainFrame, LEVELS, STEPS};
use crate::camera::Mat4;
use crate::dof::{self, DofFrame, DofIds, DofPass, DofSources};
use crate::effects::{self, Effect, EffectIds, EffectJoins, EffectPass, MAX_EFFECTS, Unit};
use crate::final_pass::{BloomInputs, FinalIds, FinalPass, FoldInputs, OutlineInputs};
use crate::frame::{CanvasOutput, RecordError, UploadArena};
use crate::grading::Grading;
use crate::graph::{
    CANVAS, GraphError, LoadOp, Pass, PassId, PassKind, Plan, PlannedTexture, RenderGraph,
    RenderScale, ResourceId, Size, Step, StepKind, StoreOp, Surface, Target,
};
use crate::outline::{self, Outline};
use crate::output::{Antialias, Output, SceneColor};
use crate::pipelines::{PassTargets, PipelineCache, Prepass};
use crate::shadow_tiles;
use crate::shadows::{CascadeDepth, MAX_CASCADES, ShadowFrame};
use crate::transmission::{TransmissionCopy, TransmissionIds};
use crate::view::{View, ViewId, ViewNames};
use crate::view_copy::{ViewCopies, ViewCopyIds};

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
    pub(crate) effects: EffectIds,
    pub(crate) dof: DofIds,
    /// The copies of views' images into their targets, which only WebGPU makes.
    pub(crate) view_copy: Option<ViewCopyIds>,
    /// The copy of the camera's opaque color that surfaces which let light through sample.
    pub(crate) transmission: TransmissionIds,
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
/// Bloom's steps down, each creating its level's target, its steps up, each blending the level
/// below into its level's target, and the levels' targets. The final pass reads the first level.
const BLOOM_DOWN: [&str; LEVELS] = [
    "BloomDown0",
    "BloomDown1",
    "BloomDown2",
    "BloomDown3",
    "BloomDown4",
    "BloomDown5",
    "BloomDown6",
    "BloomDown7",
    "BloomDown8",
    "BloomDown9",
];
const BLOOM_UP: [&str; LEVELS] = [
    "BloomUp0", "BloomUp1", "BloomUp2", "BloomUp3", "BloomUp4", "BloomUp5", "BloomUp6", "BloomUp7",
    "BloomUp8", "BloomUp9",
];
const BLOOM_LEVELS: [&str; LEVELS] = [
    "bloomLevel0",
    "bloomLevel1",
    "bloomLevel2",
    "bloomLevel3",
    "bloomLevel4",
    "bloomLevel5",
    "bloomLevel6",
    "bloomLevel7",
    "bloomLevel8",
    "bloomLevel9",
];
/// Each custom effect's pass, and the target it creates, which the next effect, bloom and the
/// final pass read.
const EFFECT_PASSES: [&str; MAX_EFFECTS] = [
    "Effect0", "Effect1", "Effect2", "Effect3", "Effect4", "Effect5", "Effect6", "Effect7",
];
const EFFECT_TARGETS: [&str; MAX_EFFECTS] = [
    "effectColor0",
    "effectColor1",
    "effectColor2",
    "effectColor3",
    "effectColor4",
    "effectColor5",
    "effectColor6",
    "effectColor7",
];
/// Depth of field's steps and the targets they create: the setup, the gather and the tent at half
/// the render size, then the composite at the render size, whose target bloom and the final pass
/// read.
const DOF_PASSES: [&str; dof::STEPS] = ["DofSetup", "DofGather", "DofTent", "DofComposite"];
const DOF_TARGETS: [&str; dof::STEPS] = ["dofHalf0", "dofHalf1", "dofHalf2", "dofColor"];
/// An effect slot that holds no effect.
const NO_EFFECT: Effect = Effect {
    template: 0,
    depth: false,
    values: [0.0; effects::EFFECT_FLOATS],
};
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
/// The copy of the camera's opaque color for surfaces that let light through, and the target with
/// a mip chain that it creates, which the camera's transparent pass reads.
const TRANSMISSION_PASS: &str = "Transmission";
const TRANSMISSION_COLOR: &str = "transmissionColor";
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
    /// Draws the depth of the objects that a camera view's first culling phase kept, for occlusion
    /// culling.
    Occluders(ViewId),
    /// Builds a camera view's depth pyramid from its occluders' depth, for occlusion culling.
    Pyramid(ViewId),
    /// Culls a camera view against its depth pyramid, for its opaque pass.
    LateCull(ViewId),
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
    /// A pass of the custom effects, a lone effect or a group, by its place among the effects'
    /// passes. The graph records it itself.
    Effect(u8),
    /// A step of depth of field, by its place. The graph records it itself.
    Dof(u8),
    /// Copies a view's image into its target with its rows turned around, on WebGPU. The graph
    /// records it itself.
    ViewCopy(ViewId),
    /// Copies the camera's opaque color into the first level of the target that surfaces which
    /// let light through sample. The graph records it, and the mip levels after its render pass.
    TransmissionCopy,
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
    /// True when each camera view culls in two phases against its depth pyramid, on WebGPU.
    occlusion: bool,
    /// Each view's occluders' pass, and the depth that its depth pyramid reads, by view, with
    /// occlusion culling.
    occluder_passes: Vec<(u16, PassId)>,
    pyramid_depths: Vec<Option<ResourceId>>,
    /// Every pass of each view, with the view's place: its culling pass, depth prepass, opaque
    /// pass and transparent pass.
    view_passes: Vec<(u16, PassId)>,
    /// True for each view that is switched on, by view.
    view_on: Vec<bool>,
    /// The target of each view other than the camera's, by view: `None` for the camera's.
    view_colors: Vec<Option<ResourceId>>,
    /// The image that each view other than the camera's draws, and the pass that copies it into
    /// the view's target, by view, where the graph copies them: on WebGPU.
    view_images: Vec<Option<(ResourceId, PassId)>>,
    /// The copies of the views' images, on WebGPU.
    view_copies: Option<ViewCopies>,
    /// True once the copies' pipeline is built, so they draw.
    view_copy_built: bool,
    /// True when the graph compiled outside a frame, so the next frame makes the plan's textures.
    compiled_early: bool,
    /// The views and their names that the declarations cover.
    declared_views: Vec<View>,
    declared_names: Vec<ViewNames>,
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
    /// True once bloom's pipelines draw: built, after the frame whose list created them.
    bloom_built: bool,
    /// True once ambient occlusion's pipelines draw: built, after the frame whose list created them.
    ao_built: bool,
    /// The size of bloom's base and the governor's halvings of it.
    bloom_chain: ChainFrame,
    /// The texture that each of bloom's steps reads, and the base level's, found once for each
    /// compile of the graph, which the count says.
    bloom_textures: Option<(u32, [u32; STEPS], u32)>,
    /// The custom effects' passes and their GPU objects, on the HDR path.
    effect_pass: Option<EffectPass>,
    /// The GPU objects that the effects take.
    effect_ids: EffectIds,
    /// The effects that run, in order: the first `effect_count` slots.
    effects: [Effect; MAX_EFFECTS],
    effect_count: usize,
    /// A bit for each effect that reads the scene's depth, by its place.
    effect_depths: u32,
    /// How the sketch joins its effects into groups and folds them into the final pass.
    effect_joins: EffectJoins,
    /// The effects' passes, as the graph declares them: each a lone effect, or a group whose
    /// pipeline is built. The first `unit_count` hold units.
    effect_units: [Unit; MAX_EFFECTS],
    unit_count: usize,
    /// The place of the first effect that folds into the final pass, while effects fold.
    folded: Option<usize>,
    /// The color that each unit reads and the scene depth's texture, or 0 while no effect reads
    /// depth, found once for each compile of the graph, which the count says.
    effect_textures: Option<(u32, [u32; MAX_EFFECTS], u32)>,
    /// The sketch time and the seconds since the frame before, which effects read.
    effect_clock: [f32; 2],
    /// The inverse of the camera's projection, which effects that read depth use, or `None`
    /// without a camera.
    inverse_projection: Option<Mat4>,
    /// Depth of field's steps and their GPU objects, once the sketch first turns it on.
    dof_pass: Option<DofPass>,
    /// The GPU objects that depth of field's steps take.
    dof_ids: DofIds,
    /// What depth of field draws with in the frame, while the sketch turns it on.
    dof: Option<DofFrame>,
    /// True once depth of field's pipelines draw: built, after the frame whose list created them.
    dof_built: bool,
    /// True when the declared passes hold depth of field's steps.
    dof_declared: bool,
    /// The textures that depth of field's steps read, found once for each compile of the graph,
    /// which the count says.
    dof_textures: Option<(u32, DofSources)>,
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
    /// The copy of the camera's opaque color for surfaces that let light through.
    transmission: TransmissionCopy,
    /// True while some object lets light through.
    transmission_wanted: bool,
    /// True once the copy's pipeline is built, after the frame whose list created it.
    transmission_built: bool,
    /// True when the declared passes hold the copy.
    transmission_declared: bool,
    /// The textures that the copy reads and draws into, found once for each compile of the graph,
    /// which the count says.
    transmission_target: Option<(u32, u32, u32)>,
    /// The id of the texture that holds the plan's first texture. The others follow it.
    first_texture: u32,
    /// Each texture of the plan that the draw lists made, with the size it was made at and, for a
    /// multisampled target, whether it resolved into the canvas.
    made: Vec<(PlannedTexture, (u32, u32), bool)>,
    /// True when the frame being recorded made or released a texture of the plan.
    textures_made: bool,
    /// The canvas size the draw lists set last, or `(0, 0)` before any.
    canvas: (u32, u32),
    /// True when the builder's scene passes bind a shadow map.
    shadow_map: bool,
    /// The depth format of the cascades' shadow map.
    cascade_format: u32,
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
            occlusion: false,
            occluder_passes: Vec::new(),
            pyramid_depths: Vec::new(),
            view_passes: Vec::new(),
            view_on: Vec::new(),
            view_colors: Vec::new(),
            view_images: Vec::new(),
            view_copies: ids.view_copy.filter(|_| gpu_culling).map(ViewCopies::new),
            view_copy_built: false,
            compiled_early: false,
            declared_views: Vec::new(),
            declared_names: Vec::new(),
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
                .then(|| BloomPass::new(ids.bloom, bloom::MAX_SIZE, !gpu_culling)),
            bloom_passes: Vec::new(),
            bloom_ids: ids.bloom,
            bloom: None,
            bloom_built: false,
            ao_built: false,
            bloom_chain: ChainFrame::default(),
            bloom_textures: None,
            effect_pass: scene_color
                .is_hdr()
                .then(|| EffectPass::new(ids.effects, gpu_culling && antialias.samples() > 1)),
            effect_ids: ids.effects,
            effects: [NO_EFFECT; MAX_EFFECTS],
            effect_count: 0,
            effect_depths: 0,
            effect_joins: EffectJoins::default(),
            effect_units: [Unit::default(); MAX_EFFECTS],
            unit_count: 0,
            folded: None,
            effect_textures: None,
            effect_clock: [0.0; 2],
            inverse_projection: None,
            dof_pass: None,
            dof_ids: ids.dof,
            dof: None,
            dof_built: false,
            dof_declared: false,
            dof_textures: None,
            ao_pass: None,
            ao_ids: ids.ao,
            ao: None,
            ao_scale: ao::MAX_SCALE,
            projection: ([0.0; 16], [0.0; 16]),
            views: 0,
            debug_lines: None,
            transparent: Vec::new(),
            transparent_on: false,
            transmission: TransmissionCopy::new(ids.transmission),
            transmission_wanted: false,
            transmission_built: false,
            transmission_declared: false,
            transmission_target: None,
            first_texture: ids.first_texture,
            made: Vec::new(),
            textures_made: false,
            canvas: (0, 0),
            layer_views: Vec::new(),
            made_views: 0,
            shadow_map: false,
            cascade_format: CascadeDepth::default().format(),
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
        self.make_bloom_pass();
        // Effects run on HDR color only, and read the depth's samples, which the new mode may
        // change.
        self.effect_pass = scene_color
            .is_hdr()
            .then(|| EffectPass::new(self.effect_ids, self.gpu_culling && self.samples > 1));
        self.effect_count = 0;
        self.effect_depths = 0;
        self.unit_count = 0;
        self.folded = None;
        self.effect_textures = None;
        // The depth step reads the depth's samples, which the new mode may change, as depth of
        // field's steps do.
        self.ao_pass = None;
        self.dof_pass = None;
        self.dof_built = false;
        // The copy's target takes the scene color's format, which its pipeline draws into.
        self.transmission_built = false;
        self.declared = false;
    }

    /// Makes the scene passes sample a shadow map whose cascades store `depth`, which the builder
    /// binds with every view's objects. Without shadows the map is one texel of one layer.
    pub(crate) fn bind_shadow_map(&mut self, depth: CascadeDepth) {
        self.shadow_map = true;
        self.cascade_format = depth.format();
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

    /// Culls each camera view in two phases against its depth pyramid, or in one. It takes effect
    /// on WebGPU without the depth prepass, which ambient occlusion also turns on while it draws.
    pub(crate) fn set_occlusion(&mut self, on: bool) {
        if on != self.occlusion {
            self.occlusion = on;
            self.declared = false;
        }
    }

    /// How the opaque objects' depth draws before the pass that shades them: in the depth prepass,
    /// the way that the builder's `prepass` names, in the occluders' pass of occlusion culling, or
    /// not at all.
    pub(crate) fn depth_pass(&self, prepass: Prepass) -> Prepass {
        if self.depth_prepass() {
            prepass
        } else {
            Prepass::Occluders.if_on(self.occlusion())
        }
    }

    /// True when each camera view culls in two phases against its depth pyramid.
    pub(crate) fn occlusion(&self) -> bool {
        self.occlusion && self.gpu_culling && !self.depth_prepass()
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
        self.ao_draws()
            .then(|| self.sampled_id(AO_TARGETS[ao::STEPS - 1]))
            .flatten()
    }

    /// True while ambient occlusion draws: the sketch turned it on, and its pipelines are built.
    /// Until then the prepass runs, so its pipelines build too, and the opaque pass reads no
    /// ambient occlusion.
    pub(crate) fn ao_draws(&self) -> bool {
        self.ao.is_some() && self.ao_built
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

    /// Declares the passes for `views` and their `names` where they changed, and compiles the
    /// graph outside a frame, so a sketch learns at once whether its passes fit together. The next
    /// frame makes the plan's textures.
    pub(crate) fn check(&mut self, views: &[View], names: &[ViewNames]) -> Result<(), GraphError> {
        self.sync_views(views, names);
        let compiled = self.graph.compile()?;
        self.compiled_early |= compiled;
        Ok(())
    }

    /// The graph as Graphviz DOT text, compiled first (see [`RenderGraph::dot`]).
    pub(crate) fn dot(&mut self) -> String {
        let compiles = self.graph.compiles();
        let text = self.graph.dot();
        self.compiled_early |= self.graph.compiles() != compiles;
        text
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
        let ao = if self.ao_draws() {
            AoPass::UPLOAD_BYTES
        } else {
            0
        };
        let effects = if self.effect_count > 0 {
            EffectPass::UPLOAD_BYTES
        } else {
            0
        };
        let dof = if self.dof.is_some() {
            DofPass::UPLOAD_BYTES
        } else {
            0
        };
        FinalPass::UPLOAD_BYTES + bloom + ao + effects + dof
    }

    /// True when the final pass takes the scene color to the canvas, and false when the resolve
    /// pass does. The resolve pass resolves the scene color into the canvas alone, so the copy
    /// for surfaces that let light through, which reads it before the transparent pass, needs the
    /// final pass.
    fn final_runs(&self) -> bool {
        !self.resolves
            || self.scales
            || self.grades
            || self.outline_draws()
            || self.transmission_declared
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

    /// Turns bloom on with its settings, or off with `None`, for the next frames, with the chain's
    /// base size and the governor's halvings from `chain`. The graph compiles again only when
    /// bloom turns on or off, or its base size changes, which declares the passes again with new
    /// targets. The governor's halvings change only what the frames draw. The 8-bit path draws no
    /// bloom.
    pub(crate) fn set_bloom(&mut self, bloom: Option<Bloom>, chain: ChainFrame) {
        let resized = chain.size != self.bloom_chain.size;
        self.bloom_chain = chain;
        if resized && self.bloom_pass.is_some() {
            self.make_bloom_pass();
            self.declared = false;
        }
        let was = self.bloom_draws();
        self.bloom = bloom;
        if self.bloom_draws() != was {
            self.enable_outputs();
        }
    }

    /// Sets the custom effects that run, in order, from the next frame on, joined by `joins`, with
    /// the sketch time and the seconds since the frame before, and the camera's projection and its
    /// inverse. Effects run only on the HDR path, at most [`MAX_EFFECTS`] of them. The passes are
    /// declared again when the number of effects, their depth reads or their joins change, each
    /// effect then alone until [`FrameGraph::request_pipelines`] finds its group's pipeline built;
    /// new templates or uniforms change only what the frames draw.
    pub(crate) fn set_effects(
        &mut self,
        effects: &[Effect],
        joins: &EffectJoins,
        clock: [f32; 2],
        projection: Option<(Mat4, Mat4)>,
    ) {
        let count = if self.effect_pass.is_some() {
            effects.len().min(MAX_EFFECTS)
        } else {
            0
        };
        let depths = effects[..count]
            .iter()
            .enumerate()
            .fold(0, |bits, (index, effect)| {
                bits | (u32::from(effect.depth) << index)
            });
        if count != self.effect_count || depths != self.effect_depths || *joins != self.effect_joins
        {
            self.effect_count = count;
            self.effect_depths = depths;
            self.effect_joins = *joins;
            self.plan_effects(|_| false, None);
        }
        self.effects[..count].copy_from_slice(&effects[..count]);
        self.effect_clock = clock;
        self.inverse_projection = projection.map(|(_, inverse)| inverse);
    }

    /// Makes the final pass draw with the custom tone curve whose pipelines take the templates from
    /// `template` on, or with its own curves with `None`, from the next frame on.
    pub(crate) fn set_tone_curve(&mut self, template: Option<u32>) {
        self.final_pass.set_tone_curve(template);
    }

    /// The resource that holds the scene's color after the custom effects' passes: the last unit's
    /// target, or the scene color without one. Depth of field reads it.
    fn effects_output(&self) -> &'static str {
        match self.unit_count {
            0 => SCENE_COLOR,
            count => EFFECT_TARGETS[count - 1],
        }
    }

    /// The resource that holds the scene's color before bloom and the final pass: depth of field's
    /// target while its steps are declared, or else the custom effects' output. Bloom and the final
    /// pass read it, and the effects that fold into the final pass.
    fn color_output(&self) -> &'static str {
        if self.dof_declared {
            DOF_TARGETS[dof::STEPS - 1]
        } else {
            self.effects_output()
        }
    }

    /// Turns depth of field on with what the frame draws it with, or off with `None`, for the next
    /// frames. The passes are declared again only when it starts or stops drawing, so a moving
    /// focus or a new lens changes only the steps' blocks. The 8-bit path draws no depth of field.
    pub(crate) fn set_dof(&mut self, dof: Option<DofFrame>) {
        let was = self.dof_draws();
        self.dof = dof.filter(|_| self.scene_color.is_hdr());
        if self.dof_draws() != was {
            self.declared = false;
        }
    }

    /// True while depth of field draws: the sketch turned it on on the HDR path, and its pipelines
    /// are built. Until then the frames draw without it.
    pub(crate) fn dof_draws(&self) -> bool {
        self.dof.is_some() && self.dof_built
    }

    /// Depth of field's steps, made for the scene depth's samples when first asked for. WebGL2 has
    /// no multisampled textures: its backend gives the steps a copy of one sample.
    fn dof_steps(&mut self) -> &mut DofPass {
        let samples = if self.gpu_culling { self.samples } else { 1 };
        let rows_from_bottom = !self.gpu_culling;
        self.dof_pass
            .get_or_insert_with(|| DofPass::new(self.dof_ids, samples, rows_from_bottom))
    }

    /// Plans the effects' passes: the units of the effects before `fold`, with each group whose
    /// pipeline `built` says is built as one. When the plan changes, the passes are declared again.
    fn plan_effects(&mut self, built: impl Fn(usize) -> bool, fold: Option<usize>) {
        let mut units = [Unit::default(); MAX_EFFECTS];
        let count = effects::plan_units(
            self.effect_count,
            &self.effect_joins,
            built,
            fold,
            &mut units,
        );
        if count != self.unit_count || units != self.effect_units || fold != self.folded {
            self.effect_units = units;
            self.unit_count = count;
            self.folded = fold;
            self.effect_textures = None;
            self.declared = false;
        }
    }

    /// True when the effects from `first` on can fold into the final pass now: no bloom or FXAA
    /// reads the image between them, and the final pass reads one texel for each pixel.
    fn may_fold(&self) -> bool {
        !self.bloom_wanted()
            && self.dof.is_none()
            && !self.final_pass.fxaa()
            && Size::Full.viewport(self.canvas, self.scale) == self.canvas
    }

    /// True when an effect from place `first` on reads the scene's depth.
    fn folded_depth(&self, first: usize) -> bool {
        self.effects[first..self.effect_count]
            .iter()
            .any(|effect| effect.depth)
    }

    /// Makes bloom's steps for the chain's base size on the HDR path. Its GPU objects keep their
    /// ids, so the new steps make them again over the old ones.
    fn make_bloom_pass(&mut self) {
        let rows_from_bottom = !self.gpu_culling;
        self.bloom_pass = self
            .scene_color
            .is_hdr()
            .then(|| BloomPass::new(self.bloom_ids, self.bloom_chain.size, rows_from_bottom));
        self.bloom_textures = None;
    }

    /// True while bloom draws: the sketch turned it on, the scene color holds HDR color, and
    /// bloom's pipelines are built.
    pub(crate) fn bloom_draws(&self) -> bool {
        self.bloom_wanted() && self.bloom_built
    }

    /// True while the sketch turns bloom on and the scene color holds HDR color.
    fn bloom_wanted(&self) -> bool {
        self.bloom.is_some() && self.bloom_pass.is_some()
    }

    /// Declares the passes again when the views or their names changed in a way that changes the
    /// passes: a view added or removed, a new target size, a texture that starts or stops showing
    /// a target, or new reads. A view switched on or off switches its passes, and new layers go to
    /// each view's opaque pass, depth prepass and occluders' pass, which change no plan.
    pub(crate) fn sync_views(&mut self, views: &[View], names: &[ViewNames]) {
        let declares = |view: &View| {
            let target = view.target();
            let size = (target.size, target.halvings);
            (view.is_removed(), size, target.shown, target.reads)
        };
        let same = self.declared
            && views.len() == self.declared_views.len()
            && names == self.declared_names.as_slice()
            && views
                .iter()
                .zip(&self.declared_views)
                .all(|(view, declared)| declares(view) == declares(declared));
        if !same {
            self.declared_views.clear();
            self.declared_views.extend_from_slice(views);
            self.declared_names.clear();
            self.declared_names.extend_from_slice(names);
            self.declare(views, names);
        }
        self.declared_views.copy_from_slice(views);
        if views
            .iter()
            .zip(&self.view_on)
            .any(|(view, &on)| view.target().draws() != on)
        {
            self.view_on.clear();
            self.view_on
                .extend(views.iter().map(|view| view.target().draws()));
            self.enable_views();
        }
        for (&pass, view) in self.opaque.iter().zip(views) {
            self.graph.set_layers(pass, view.layers());
        }
        for (&pass, view) in self.prepasses.iter().zip(views) {
            self.graph.set_layers(pass, view.layers());
        }
        for &(index, pass) in &self.occluder_passes {
            self.graph
                .set_layers(pass, views[usize::from(index)].layers());
        }
    }

    /// Switches the debug lines pass on for a frame with lines, and off for one without. The
    /// graph compiles again only when that changes.
    pub(crate) fn set_debug_lines(&mut self, on: bool) {
        if let Some(pass) = self.debug_lines {
            self.graph.set_enabled(pass, on);
        }
    }

    /// Switches the views' transparent passes on while some object blends or lets light through,
    /// and off otherwise. The graph compiles again only when that changes.
    pub(crate) fn set_transparent(&mut self, on: bool) {
        self.transparent_on = on;
        self.enable_views();
    }

    /// Turns the copy of the camera's opaque color on while some object lets light through, and
    /// off otherwise, for the next frames. The passes are declared again only when it starts or
    /// stops drawing. Call it before [`FrameGraph::request_pipelines`], which asks for the copy's
    /// pipeline, so the frame that first wants the copy declares it once the pipeline is built.
    pub(crate) fn set_transmission(&mut self, on: bool) {
        let was = self.transmission_draws();
        self.transmission_wanted = on;
        if self.transmission_draws() != was {
            self.declared = false;
        }
    }

    /// True while the copy of the camera's opaque color draws: some object lets light through,
    /// and the copy's pipeline is built. Until then such objects draw nothing either, as their
    /// pipelines load from the same shader file.
    pub(crate) fn transmission_draws(&self) -> bool {
        self.transmission_wanted && self.transmission_built
    }

    /// True while the frame copies the camera's opaque color for surfaces that let light through,
    /// which the camera's frame values then say.
    pub(crate) fn transmission_copied(&self) -> bool {
        self.transmission_declared
    }

    /// The draw list's id of the texture that the camera's frame group binds for surfaces that
    /// let light through: the copy's target while it draws, else a blank texel. Valid once the
    /// frame's [`FrameGraph::prepare`] made the plan's textures.
    pub(crate) fn transmission_texture(&self) -> u32 {
        self.transmission_declared
            .then(|| self.sampled_id(TRANSMISSION_COLOR))
            .flatten()
            .unwrap_or_else(|| self.transmission.blank())
    }

    /// Switches each view's passes on or off with the view, and its transparent pass only while
    /// some object blends too.
    fn enable_views(&mut self) {
        for &(index, pass) in &self.view_passes {
            let on = self
                .view_on
                .get(usize::from(index))
                .copied()
                .unwrap_or(true);
            self.graph.set_enabled(pass, on);
        }
        for (index, &pass) in self.transparent.iter().enumerate() {
            let on = self.view_on.get(index).copied().unwrap_or(true);
            self.graph.set_enabled(pass, on && self.transparent_on);
        }
    }

    /// True when a view culls in two phases against its depth pyramid: with occlusion culling,
    /// for a view that draws at the render size. A view with a target size of its own, or a
    /// mirror view, culls once.
    fn view_occludes(&self, view: &View, index: usize) -> bool {
        let full = view.target().graph_size() == Size::Full && view.mirrored().is_none();
        self.occlusion() && (index == ViewId::CAMERA.index() || full)
    }

    /// The draw list's id of the texture that materials sample a view's target from, or `None`
    /// for the camera's view, or a target that the plan gives no texture. Valid once the frame's
    /// [`FrameGraph::prepare`] made the plan's textures.
    pub(crate) fn view_target(&self, view: ViewId) -> Option<u32> {
        if self.view_copies.is_some() && !self.view_copy_built {
            // The target holds no image until the copies draw.
            return None;
        }
        let target = (*self.view_colors.get(view.index())?)?;
        let surface = self.graph.plan()?.sampled_texture_of(target)?;
        Some(self.texture_id(surface))
    }

    /// True when the view culls in two phases against its depth pyramid.
    pub(crate) fn occludes(&self, view: ViewId) -> bool {
        self.pyramid_depths
            .get(view.index())
            .is_some_and(Option::is_some)
    }

    /// The view whose objects a render pass draws, the camera's for a pass of no view.
    fn view_of(&self, passes: &[PassId]) -> ViewId {
        passes
            .iter()
            .find_map(|&pass| match self.roles[pass.index()] {
                Role::Opaque(view) | Role::Prepass(view) | Role::Transparent(view) => Some(view),
                _ => None,
            })
            .unwrap_or(ViewId::CAMERA)
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
    fn declare(&mut self, views: &[View], names: &[ViewNames]) {
        self.graph.clear();
        self.roles.clear();
        self.opaque.clear();
        self.prepasses.clear();
        self.occluder_passes.clear();
        self.pyramid_depths.clear();
        self.view_passes.clear();
        self.transparent.clear();
        self.shadow_passes.clear();
        self.bloom_passes.clear();
        self.outline_passes.clear();
        let prepass = self.depth_prepass();
        let color = Target::color(self.scene_color.format()).samples(self.samples);
        let depth = Target::depth(DEPTH_FORMAT).samples(self.samples);
        if self.shadow_map {
            let (layers, size) = self.shadows.map_or((1, 1), |s| (s.cascades, s.map_size));
            let map = Target::depth(self.cascade_format).layers(layers).array();
            let size = Size::Fixed {
                width: size,
                height: size,
            };
            self.graph.keep(SHADOW_MAP, map, size);
            let (tiles, size) = self.tiles.map_or((1, 1), |t| (t.tiles, t.size));
            let atlas = Target::depth(shadow_tiles::TARGETS.depth_format)
                .layers(tiles)
                .array();
            let size = Size::Fixed {
                width: size,
                height: size,
            };
            self.graph.keep(SHADOW_ATLAS, atlas, size);
        }
        let named: Vec<ViewPassNames> = views
            .iter()
            .zip(names)
            .enumerate()
            .map(|(index, (view, names))| ViewPassNames::of(index, view, names))
            .collect();
        // Where a pass copies each view's image into its target, the target has one sample.
        let copies = self.view_copies.is_some();
        let kept = if copies {
            Target::color(self.view_target_format()).array()
        } else {
            color.array()
        };
        self.view_colors.clear();
        self.view_colors.push(None);
        self.view_images.clear();
        self.view_images.push(None);
        for (index, view) in views.iter().enumerate().skip(1) {
            let size = view_size(view);
            let target = self.graph.keep(named[index].color.clone(), kept, size);
            self.view_colors.push(Some(target));
        }
        if self.gpu_culling {
            self.graph.import_buffer(LIGHTS);
            let clusters = Pass::new("LightClusters", PassKind::Compute)
                .reads(LIGHTS)
                .creates_buffer(LIGHT_GRID);
            self.add(clusters, Role::LightClusters);
            self.graph.import_buffer(OBJECTS);
            for (index, names) in named.iter().enumerate() {
                let pass = Pass::new(names.culling.clone(), PassKind::Compute)
                    .reads(OBJECTS)
                    .creates_buffer(names.visible.clone());
                let pass = optional_beyond_camera(pass, index);
                let pass = self.add(pass, Role::Cull(ViewId::from_index(index)));
                self.view_passes.push((index as u16, pass));
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
            let id = ViewId::from_index(index);
            let names = &named[index];
            let size = view_size(view);
            let camera = id == ViewId::CAMERA;
            let mut pass = Pass::new(names.opaque.clone(), PassKind::Scene)
                .size(size)
                .layers(view.layers());
            pass = if camera {
                pass.creates(SCENE_COLOR, color)
            } else if copies {
                pass.creates(names.image.clone(), color)
            } else {
                pass.writes(names.color.clone())
            };
            if prepass {
                let mut prepass = Pass::new(names.prepass.clone(), PassKind::Scene)
                    .size(size)
                    .layers(view.layers())
                    .creates(names.depth.clone(), depth);
                if self.gpu_culling {
                    prepass = prepass.reads(names.visible.clone());
                }
                if self.skins() {
                    prepass = prepass.reads(SKINNED);
                }
                let occludes = camera && self.ao_draws();
                if occludes {
                    prepass = prepass.creates(PREPASS_COLOR, color);
                }
                prepass = reads_targets(prepass, views, &named, index);
                let prepass = optional_beyond_camera(prepass, index);
                let prepass = self.add(prepass, Role::Prepass(id));
                self.prepasses.push(prepass);
                self.view_passes.push((index as u16, prepass));
                if occludes {
                    self.declare_ao();
                    pass = pass.reads(AO_TARGETS[ao::STEPS - 1]);
                }
                pass = pass.writes(names.depth.clone());
            } else {
                pass = pass.creates(names.depth.clone(), depth);
            }
            if self.view_occludes(view, index) {
                self.declare_occluders(view, index);
            } else {
                self.pyramid_depths.push(None);
            }
            if self.gpu_culling {
                pass = pass.reads(names.visible.clone());
                if camera {
                    pass = pass.reads(LIGHT_GRID);
                }
            }
            if self.skins() {
                pass = pass.reads(SKINNED);
            }
            if self.shadow_map {
                pass = pass.reads(SHADOW_MAP).reads(SHADOW_ATLAS);
            }
            pass = reads_targets(pass, views, &named, index);
            let pass = optional_beyond_camera(pass, index);
            let pass = self.add(pass, Role::Opaque(id));
            self.opaque.push(pass);
            self.view_passes.push((index as u16, pass));
        }
        let lines = Pass::new("DebugLines", PassKind::Scene)
            .writes(SCENE_COLOR)
            .writes(SCENE_DEPTH);
        let lines = self.add(lines, Role::DebugLines);
        self.graph.set_enabled(lines, false);
        self.debug_lines = Some(lines);
        self.transmission_declared = self.transmission_draws() && !views.is_empty();
        if self.transmission_declared {
            // The copy reads the scene color as the opaque pass and the debug lines leave it,
            // before the transparent pass draws into it.
            let target = Target::color(self.view_target_format()).mipmapped();
            let copy = Pass::new(TRANSMISSION_PASS, PassKind::Fullscreen)
                .optional()
                .size(view_size(&views[ViewId::CAMERA.index()]))
                .reads_so_far(SCENE_COLOR)
                .creates(TRANSMISSION_COLOR, target);
            self.add(copy, Role::TransmissionCopy);
        }
        for (index, view) in views.iter().enumerate() {
            let names = &named[index];
            let drawn = if copies && index != ViewId::CAMERA.index() {
                &names.image
            } else {
                &names.color
            };
            let mut pass = Pass::new(names.transparent.clone(), PassKind::Scene)
                .size(view_size(view))
                .writes(drawn.clone())
                .writes(names.depth.clone());
            if self.transmission_declared && index == ViewId::CAMERA.index() {
                pass = pass.reads(TRANSMISSION_COLOR);
            }
            let pass = reads_targets(pass, views, &named, index);
            let pass = optional_beyond_camera(pass, index);
            let pass = self.add(pass, Role::Transparent(ViewId::from_index(index)));
            self.transparent.push(pass);
        }
        if copies {
            for (index, view) in views.iter().enumerate().skip(1) {
                let names = &named[index];
                let pass = Pass::new(names.copy.clone(), PassKind::Fullscreen)
                    .optional()
                    .size(view_size(view))
                    .reads(names.image.clone())
                    .writes(names.color.clone());
                let pass = self.add(pass, Role::ViewCopy(ViewId::from_index(index)));
                self.view_passes.push((index as u16, pass));
                let image = self
                    .graph
                    .find_resource(&names.image)
                    .expect("the view's opaque pass creates its image");
                self.view_images.push(Some((image, pass)));
            }
        }
        self.view_on.clear();
        self.view_on
            .extend(views.iter().map(|view| view.target().draws()));
        self.enable_views();
        self.declare_outline(color.samples);
        self.declare_effects();
        self.dof_declared = self.dof_draws();
        if self.dof_declared {
            self.declare_dof();
        }
        let resolve = Pass::new("Resolve", PassKind::Resolve)
            .reads(SCENE_COLOR)
            .writes(CANVAS);
        let resolve = self.add(resolve, Role::Resolve);
        let mut final_pass = Pass::new("Final", PassKind::Fullscreen)
            .size(Size::Canvas)
            .reads(self.color_output())
            .writes(CANVAS);
        if self.folded.is_some_and(|first| self.folded_depth(first)) {
            final_pass = final_pass.reads(SCENE_DEPTH);
        }
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

    /// Declares a camera view's occlusion culling before its opaque pass: the occluders' pass,
    /// which draws the depth of the objects that its first culling phase kept into a depth target
    /// of its own, of one sample; the compute pass that builds the view's depth pyramid from that
    /// depth; and the late culling pass, which tests every object against the pyramid and writes
    /// the compacted instances that the opaque pass draws.
    fn declare_occluders(&mut self, view: &View, index: usize) {
        let id = ViewId::from_index(index);
        let visible = view_name(index, "visible", "visible");
        let occluders = view_name(index, "occluderDepth", "occluderDepth");
        let pyramid = view_name(index, "depthPyramid", "depthPyramid");
        let mut pass = Pass::new(view_name(index, "Occluders", "Occluders"), PassKind::Scene)
            .layers(view.layers())
            .creates(occluders.clone(), Target::depth(DEPTH_FORMAT))
            .reads_so_far(visible.clone());
        if self.skins() {
            pass = pass.reads(SKINNED);
        }
        let pass = self.add(pass, Role::Occluders(id));
        self.occluder_passes.push((index as u16, pass));
        let build = Pass::new(
            view_name(index, "DepthPyramid", "DepthPyramid"),
            PassKind::Compute,
        )
        .reads(occluders.clone())
        .creates_buffer(pyramid.clone());
        self.add(build, Role::Pyramid(id));
        let late = Pass::new(
            view_name(index, "LateCulling", "LateCulling"),
            PassKind::Compute,
        )
        .reads(OBJECTS)
        .reads(pyramid)
        .writes(visible);
        self.add(late, Role::LateCull(id));
        let occluders = self
            .graph
            .find_resource(&occluders)
            .expect("the occluders' pass creates its depth");
        self.pyramid_depths.push(Some(occluders));
    }

    /// The draw list's id of the occluders' depth of a view that culls in two phases, which its
    /// depth pyramid reads. Valid once the frame's [`FrameGraph::prepare`] made the plan's
    /// textures.
    pub(crate) fn depth_texture(&self, view: ViewId) -> Option<u32> {
        let depth = (*self.pyramid_depths.get(view.index())?)?;
        let surface = self.graph.plan()?.sampled_texture_of(depth)?;
        Some(self.texture_id(surface))
    }

    /// The render size of the frame being recorded: the part of the full-size targets that scene
    /// passes draw into, in pixels.
    pub(crate) fn render_size(&self) -> (u32, u32) {
        Size::Full.viewport(self.canvas, self.scale)
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

    /// Declares the custom effects' passes, one for each unit: each reads the color that the pass
    /// before it left, and the scene's depth as every pass leaves it when one of its effects reads
    /// depth, and creates a target of its own.
    fn declare_effects(&mut self) {
        let mut input = SCENE_COLOR;
        for index in 0..self.unit_count {
            let unit = self.effect_units[index];
            let mut pass = Pass::new(EFFECT_PASSES[index], PassKind::Fullscreen)
                .reads(input)
                .creates(EFFECT_TARGETS[index], Target::color(effects::FORMAT));
            if self.effects[unit.places()]
                .iter()
                .any(|effect| effect.depth)
            {
                pass = pass.reads(SCENE_DEPTH);
            }
            self.add(pass, Role::Effect(index as u8));
            input = EFFECT_TARGETS[index];
        }
    }

    /// Declares depth of field's steps: the setup reads the custom effects' output and the scene
    /// depth as every pass leaves them, the gather and the tent each read the target before them,
    /// and the composite reads the setup's inputs and the tent's target.
    fn declare_dof(&mut self) {
        let input = self.effects_output();
        let half = Target::color(dof::HALF_FORMAT);
        for step in 0..dof::STEPS {
            let pass = Pass::new(DOF_PASSES[step], PassKind::Fullscreen);
            let pass = match step {
                0 => pass
                    .size(dof::HALF)
                    .reads(input)
                    .reads(SCENE_DEPTH)
                    .creates(DOF_TARGETS[0], half),
                1 | 2 => pass
                    .size(dof::HALF)
                    .reads(DOF_TARGETS[step - 1])
                    .creates(DOF_TARGETS[step], half),
                _ => pass
                    .reads(input)
                    .reads(SCENE_DEPTH)
                    .reads(DOF_TARGETS[2])
                    .creates(DOF_TARGETS[3], Target::color(dof::FORMAT)),
            };
            self.add(pass, Role::Dof(step as u8));
        }
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

    /// Declares bloom's steps: a step down into each level, the first from the scene color and
    /// each later one from the level above as the steps before it leave it, then a step up into
    /// each level but the last, which reads the level below and blends into its own. Returns the
    /// declaration of the final pass with bloom, which reads the base level.
    fn declare_bloom(&mut self) -> Pass {
        let target = Target::color(bloom::FORMAT);
        let size = self.bloom_chain.size;
        let levels = self.bloom_pass.as_ref().map_or(LEVELS, BloomPass::levels);
        for level in 0..levels {
            let pass = Pass::new(BLOOM_DOWN[level], PassKind::Fullscreen)
                .size(bloom::level_size(size, level))
                .creates(BLOOM_LEVELS[level], target);
            let pass = match level {
                0 => pass.reads(self.color_output()),
                _ => pass.reads_so_far(BLOOM_LEVELS[level - 1]),
            };
            let pass = self.add(pass, Role::Bloom(level as u8));
            self.bloom_passes.push(pass);
        }
        for level in (0..levels - 1).rev() {
            let step = 2 * levels - 2 - level;
            let pass = Pass::new(BLOOM_UP[level], PassKind::Fullscreen)
                .size(bloom::level_size(size, level))
                .reads(BLOOM_LEVELS[level + 1])
                .writes(BLOOM_LEVELS[level]);
            let pass = self.add(pass, Role::Bloom(step as u8));
            self.bloom_passes.push(pass);
        }
        Pass::new("FinalBloom", PassKind::Fullscreen)
            .size(Size::Canvas)
            .reads(self.color_output())
            .reads(BLOOM_LEVELS[0])
            .writes(CANVAS)
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
        let compiled = self.graph.compile().map_err(RecordError::Graph)?
            | std::mem::take(&mut self.compiled_early);
        let canvas = (canvas.0.max(1), canvas.1.max(1));
        let resized = canvas != self.canvas;
        if resized {
            list.push(Op::ResizeCanvas, &[canvas.0, canvas.1])?;
            self.canvas = canvas;
        }
        self.textures_made = (compiled || resized) && self.make_textures(list)?;
        Ok(())
    }

    /// Asks `pipelines` for the pipelines of the graph's own passes: the final pass's, and those of
    /// bloom and ambient occlusion while the sketch turns them on. A builder asks before it records
    /// the pipelines that its frame creates. Frames that resolve into the canvas ask too, so the
    /// pipeline is ready once the render scale can drop. Bloom's and ambient occlusion's passes
    /// draw once their pipelines are built, by `pipelines_built`, the newest frame that the thread
    /// that draws drew with every pipeline built. Until then the frame keeps its passes without
    /// them: a pass whose pipeline still builds, or waits for its shader file, draws nothing, and a
    /// final pass that draws nothing leaves the canvas without its frame.
    pub(crate) fn request_pipelines(
        &mut self,
        pipelines: &mut PipelineCache,
        pipelines_built: u32,
    ) {
        let wanted = self.bloom_wanted();
        let final_bloom = self.final_pass.request_pipeline(pipelines, wanted);
        if let Some(pass) = self.effect_pass.as_mut() {
            pass.request_pipelines(
                pipelines,
                &self.effects[..self.effect_count],
                &self.effect_joins,
                pipelines_built,
            );
        }
        self.request_effect_joins(pipelines, pipelines_built);
        let built = match (wanted, final_bloom, self.bloom_pass.as_mut()) {
            (true, Some(final_bloom), Some(bloom)) => {
                let (down, up) = bloom.request_pipelines(pipelines);
                pipelines.built(down, pipelines_built)
                    && pipelines.built(up, pipelines_built)
                    && pipelines.built(final_bloom, pipelines_built)
            }
            _ => false,
        };
        let dof_built = self.dof.is_some() && {
            let steps = self.dof_steps();
            steps.request_pipelines(pipelines);
            pipelines.all_built(steps.pipeline_ids(), pipelines_built)
        };
        if dof_built != self.dof_built {
            let was = self.dof_draws();
            self.dof_built = dof_built;
            if self.dof_draws() != was {
                self.declared = false;
            }
        }
        let ao_built = self.ao.is_some() && {
            let steps = self.ao_steps();
            steps.request_pipelines(pipelines);
            pipelines.all_built(steps.pipeline_ids(), pipelines_built)
        };
        if ao_built != self.ao_built {
            let was = self.ao_draws();
            self.ao_built = ao_built;
            if self.ao_draws() != was {
                self.declared = false;
            }
        }
        if built != self.bloom_built {
            let was = self.bloom_draws();
            self.bloom_built = built;
            if self.bloom_draws() != was {
                self.enable_outputs();
            }
        }
        let (format, permutation) = (self.view_target_format(), self.scene_color.permutation());
        let transmission_built = self.transmission_wanted && {
            let id = self
                .transmission
                .request_pipeline(pipelines, format, permutation);
            pipelines.built(id, pipelines_built)
        };
        if transmission_built != self.transmission_built {
            let was = self.transmission_draws();
            self.transmission_built = transmission_built;
            if self.transmission_draws() != was {
                self.declared = false;
            }
        }
        let views = self.view_colors.len() > 1;
        self.view_copy_built = match self.view_copies.as_mut() {
            Some(copies) if views => {
                let id = copies.request_pipeline(pipelines, format, permutation);
                pipelines.built(id, pipelines_built)
            }
            _ => false,
        };
    }

    /// The format of the targets that the copies fill on WebGPU: the scene color's, or on the
    /// 8-bit path an sRGB texture, which the copy fills with the display color decoded, so that
    /// materials which sample a view's texture read linear color on both paths.
    fn view_target_format(&self) -> u32 {
        if self.scene_color.is_hdr() {
            self.scene_color.format()
        } else {
            format::RGBA8_UNORM_SRGB
        }
    }

    /// Asks for the pipeline of the final pass's fold build while the sketch folds effects, once
    /// the folded effects draw alone, as a group waits (see [`EffectPass::request_pipelines`]), and
    /// plans the effects' passes with each group and the fold whose pipeline is built.
    fn request_effect_joins(&mut self, pipelines: &mut PipelineCache, pipelines_built: u32) {
        let count = self.effect_count;
        let alone = |first: usize, pipelines: &PipelineCache| {
            self.effect_pass
                .as_ref()
                .is_some_and(|pass| pass.alone_built(first..count, pipelines, pipelines_built))
        };
        let fold = match self.effect_joins.fold_of(count) {
            Some((first, template)) if alone(first, pipelines) => {
                let multisampled = self.gpu_culling && self.samples > 1 && self.folded_depth(first);
                let id = self
                    .final_pass
                    .request_fold(pipelines, template, multisampled);
                (self.may_fold() && pipelines.built(id, pipelines_built)).then_some(first)
            }
            _ => None,
        };
        let pass = self.effect_pass.as_ref();
        let built: [bool; MAX_EFFECTS] = std::array::from_fn(|place| {
            pass.and_then(|pass| pass.group_pipeline(place))
                .is_some_and(|id| place < count && pipelines.built(id, pipelines_built))
        });
        self.plan_effects(|place| built[place], fold);
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
        self.upload_effects(list, arena)?;
        self.upload_dof(list, arena)?;
        self.bind_view_copies(list)?;
        self.bind_transmission(list)?;
        if !self.final_runs() {
            return Ok(());
        }
        let scene_color = self
            .sampled_id(self.color_output())
            .expect("the final pass samples the scene color");
        let render_size = Size::Full.viewport(self.canvas, self.scale);
        let bloom = if self.bloom_draws() {
            let (sources, base) = self.bloom_textures();
            let (canvas, scale, chain, made) = (
                self.canvas,
                self.scale,
                self.bloom_chain,
                self.textures_made,
            );
            match (self.bloom, self.bloom_pass.as_mut()) {
                (Some(settings), Some(pass)) => {
                    let bloom = (settings, output.exposure);
                    pass.prepare(list, arena, canvas, scale, chain, bloom, &sources, made)?;
                    Some(BloomInputs::new(pass.ids(), base))
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
        let fold = match self.folded {
            Some(first) => Some(FoldInputs {
                buffer: self.effect_ids.buffer,
                depth: if self.folded_depth(first) {
                    self.sampled_id(SCENE_DEPTH)
                        .expect("an effect that reads depth reads the scene depth")
                } else {
                    self.effect_ids.blank_depth
                },
                multisampled: self.gpu_culling && self.samples > 1 && self.folded_depth(first),
            }),
            None => None,
        };
        self.final_pass.prepare(
            list,
            arena,
            output.tone_mapping,
            render_size,
            scene_color,
            bloom,
            grading,
            outline,
            fold,
            self.textures_made,
        )
    }

    /// The texture that each of bloom's declared steps reads, and the base level's, found by name
    /// once for each compile of the graph.
    fn bloom_textures(&mut self) -> ([u32; STEPS], u32) {
        let compiles = self.graph.compiles();
        if let Some((at, sources, base)) = self.bloom_textures
            && at == compiles
        {
            return (sources, base);
        }
        let levels = self.bloom_pass.as_ref().map_or(1, BloomPass::levels);
        let id = |name: &str| {
            self.sampled_id(name)
                .expect("each step of bloom reads a planned texture")
        };
        let sources = std::array::from_fn(|step| {
            if step >= 2 * levels - 1 {
                0
            } else if step == 0 {
                id(self.color_output())
            } else if step < levels {
                id(BLOOM_LEVELS[step - 1])
            } else {
                id(BLOOM_LEVELS[2 * levels - 1 - step])
            }
        });
        let base = id(BLOOM_LEVELS[0]);
        self.bloom_textures = Some((compiles, sources, base));
        (sources, base)
    }

    /// Records the custom effects' objects and blocks while effects run, and binds each effect to
    /// the textures it reads.
    fn upload_effects(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
    ) -> Result<(), RecordError> {
        let count = self.effect_count;
        if count == 0 {
            return Ok(());
        }
        let (colors, depth) = self.effect_textures();
        let units = self.effect_units;
        let unit_count = self.unit_count;
        let frame = (self.canvas, self.scale);
        let (clock, inverse, made) = (
            self.effect_clock,
            self.inverse_projection,
            self.textures_made,
        );
        let pass = self
            .effect_pass
            .as_mut()
            .expect("effects run only on the HDR path");
        pass.prepare(
            list,
            arena,
            &self.effects[..count],
            (&units[..unit_count], &colors[..unit_count], depth),
            frame,
            clock,
            inverse,
            made,
        )
    }

    /// The color that each unit reads, and the scene depth's texture, or 0 while no effect reads
    /// depth, found by name once for each compile of the graph.
    fn effect_textures(&mut self) -> ([u32; MAX_EFFECTS], u32) {
        let compiles = self.graph.compiles();
        if let Some((at, colors, depth)) = self.effect_textures
            && at == compiles
        {
            return (colors, depth);
        }
        let depth = if self.effect_depths != 0 {
            self.sampled_id(SCENE_DEPTH)
                .expect("an effect that reads depth reads the scene depth")
        } else {
            0
        };
        let mut colors = [0; MAX_EFFECTS];
        for (index, color) in colors.iter_mut().enumerate().take(self.unit_count) {
            let input = if index == 0 {
                SCENE_COLOR
            } else {
                EFFECT_TARGETS[index - 1]
            };
            *color = self
                .sampled_id(input)
                .expect("each effect reads a planned texture");
        }
        self.effect_textures = Some((compiles, colors, depth));
        (colors, depth)
    }

    /// Records depth of field's objects and blocks while its steps are declared, and binds each step
    /// to the textures it reads, found by name once for each compile of the graph.
    fn upload_dof(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
    ) -> Result<(), RecordError> {
        let Some(frame) = self.dof.filter(|_| self.dof_declared) else {
            return Ok(());
        };
        let compiles = self.graph.compiles();
        let sources = match self.dof_textures {
            Some((at, sources)) if at == compiles => sources,
            _ => {
                let id = |name: &str| {
                    self.sampled_id(name)
                        .expect("each step of depth of field reads a planned texture")
                };
                let sources = DofSources {
                    color: id(self.effects_output()),
                    depth: id(SCENE_DEPTH),
                    halves: std::array::from_fn(|k| id(DOF_TARGETS[k])),
                };
                self.dof_textures = Some((compiles, sources));
                sources
            }
        };
        let (frame_size, made) = ((self.canvas, self.scale), self.textures_made);
        self.dof_steps()
            .prepare(list, arena, frame_size, frame, sources, made)
    }

    /// Binds the copy of the camera's opaque color to the scene color that it reads while it is
    /// declared, and finds the texture of its target, once for each compile of the graph.
    fn bind_transmission(&mut self, list: &mut DrawList) -> Result<(), RecordError> {
        if !self.transmission_declared {
            return Ok(());
        }
        let compiles = self.graph.compiles();
        let source = match self.transmission_target {
            Some((at, source, _)) if at == compiles => source,
            _ => {
                let id = |name: &str| {
                    self.sampled_id(name)
                        .expect("the transmission copy reads and writes planned textures")
                };
                let (source, target) = (id(SCENE_COLOR), id(TRANSMISSION_COLOR));
                self.transmission_target = Some((compiles, source, target));
                source
            }
        };
        self.transmission.prepare(list, source, self.textures_made)
    }

    /// Records the making of the mip levels of the copy of the camera's opaque color, after the
    /// render pass of `passes` when the copy drew in it.
    fn make_transmission_levels(
        &self,
        list: &mut DrawList,
        passes: &[PassId],
    ) -> Result<(), RecordError> {
        let copied = passes
            .iter()
            .any(|&pass| self.roles[pass.index()] == Role::TransmissionCopy);
        if let (true, Some((_, _, target))) = (copied, self.transmission_target) {
            list.push(Op::GenerateMipmaps, &[target, 0])?;
        }
        Ok(())
    }

    /// Records ambient occlusion's objects and settings while it draws, and binds each step to the
    /// textures it reads.
    fn upload_ao(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
    ) -> Result<(), RecordError> {
        let Some(settings) = self.ao.filter(|_| self.ao_built) else {
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
    ///
    /// A multisampled target is made again when the pass that takes the scene to the canvas
    /// changes, between the resolve pass and the final pass. On the Galaxy S25 (Adreno 830), a
    /// multisampled color texture whose first resolve went into the canvas resolves nothing into
    /// any other texture later.
    fn make_textures(&mut self, list: &mut DrawList) -> Result<bool, RecordError> {
        let start = list.len();
        let into_canvas = !self.final_runs();
        let textures = self
            .graph
            .plan()
            .expect("the graph compiled before its textures are made")
            .textures();
        let mut views = 0;
        for (index, texture) in textures.iter().enumerate() {
            let target = texture.target;
            let made = (
                *texture,
                texture.size.extent(self.canvas),
                into_canvas && target.samples > 1,
            );
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
                create_texture(list, self.first_texture + index as u32, (made.0, made.1))?;
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
        clear: impl Fn(ViewId) -> [f32; 4],
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
                    if passes.iter().all(|&pass| {
                        let role = self.roles[pass.index()];
                        skips(role) || !self.draws(role)
                    }) {
                        continue;
                    }
                    let masks = passes
                        .iter()
                        .any(|&pass| self.roles[pass.index()] == Role::OutlineMask);
                    let clear = if masks {
                        [0.0; 4]
                    } else {
                        clear(self.view_of(passes))
                    };
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
                            Role::Effect(index) => self
                                .effect_pass
                                .as_ref()
                                .expect("effects run only on the HDR path")
                                .record(list, self.effect_units[usize::from(index)])?,
                            Role::Dof(step) => self
                                .dof_pass
                                .as_ref()
                                .expect("depth of field's steps run once they are declared")
                                .record(list, usize::from(step))?,
                            Role::ViewCopy(view) => {
                                if let Some(copies) = self.view_copies.as_ref() {
                                    copies.record(list, view.index())?;
                                }
                            }
                            Role::TransmissionCopy => self.transmission.record(list)?,
                            role => record(list, role)?,
                        }
                    }
                    list.push(Op::EndRenderPass, &[])?;
                    self.make_transmission_levels(list, passes)?;
                }
            }
        }
        list.push(Op::Submit, &[])?;
        Ok(())
    }

    /// False for a step of bloom that the frame drops, as the governor's step drops the last
    /// level. Every other pass draws.
    fn draws(&self, role: Role) -> bool {
        match (role, &self.bloom_pass) {
            (Role::Bloom(step), Some(bloom)) => bloom.draws(usize::from(step)),
            _ => true,
        }
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

    /// Binds the copy of each view whose copy runs to the texture of the view's image.
    fn bind_view_copies(&mut self, list: &mut DrawList) -> Result<(), RecordError> {
        if self.view_copies.is_none() {
            return Ok(());
        }
        let made = self.textures_made;
        for place in 1..self.view_images.len() {
            let Some((image, copy)) = self.view_images[place] else {
                continue;
            };
            let Some(plan) = self.graph.plan() else {
                return Ok(());
            };
            if plan.step_of(copy).is_none() {
                continue;
            }
            let Some(surface) = plan.sampled_texture_of(image) else {
                continue;
            };
            let texture = self.texture_id(surface);
            if let Some(copies) = self.view_copies.as_mut() {
                copies.prepare(list, place, texture, made)?;
            }
        }
        Ok(())
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
        if let Some(effects) = self.effect_pass.as_mut() {
            effects.reset_gpu();
        }
        if let Some(dof) = self.dof_pass.as_mut() {
            dof.reset_gpu();
        }
        if let Some(copies) = self.view_copies.as_mut() {
            copies.reset_gpu();
        }
        self.transmission.reset_gpu();
    }
}

/// The same declaration of a final pass, which reads the outline mask too.
fn with_outline(pass: Pass) -> Pass {
    pass.reads(OUTLINE_MASK)
}

/// The names of a view's passes and resources in the graph. The camera's view takes the scene's
/// names. A view with names of its own names its passes after its pass, and its depth after its
/// target. Any other view takes the engine's names, which end in its place.
struct ViewPassNames {
    culling: Cow<'static, str>,
    visible: Cow<'static, str>,
    prepass: Cow<'static, str>,
    opaque: Cow<'static, str>,
    transparent: Cow<'static, str>,
    color: Cow<'static, str>,
    depth: Cow<'static, str>,
    /// The image that the view draws where a pass copies it into the view's target, and that pass.
    image: Cow<'static, str>,
    copy: Cow<'static, str>,
    /// The targets of other views that the view reads.
    reads: Vec<Cow<'static, str>>,
}

impl ViewPassNames {
    fn of(index: usize, view: &View, names: &ViewNames) -> Self {
        let reads = names.reads.iter().map(|name| name.clone().into()).collect();
        if index == ViewId::CAMERA.index() {
            return Self {
                culling: "Culling".into(),
                visible: "visible".into(),
                prepass: "DepthPrepass".into(),
                opaque: "Opaque".into(),
                transparent: "Transparent".into(),
                color: SCENE_COLOR.into(),
                depth: SCENE_DEPTH.into(),
                image: SCENE_COLOR.into(),
                copy: "Copy".into(),
                reads,
            };
        }
        if view.is_removed() || names.pass.is_empty() {
            return Self {
                culling: numbered("Culling", index),
                visible: numbered("visible", index),
                prepass: numbered("DepthPrepass", index),
                opaque: numbered("Opaque", index),
                transparent: numbered("Transparent", index),
                color: numbered("color", index),
                depth: numbered("depth", index),
                image: numbered("image", index),
                copy: numbered("Copy", index),
                reads,
            };
        }
        let pass = names.pass.as_str();
        let color = if names.target.is_empty() {
            joined(pass, "Color")
        } else {
            names.target.clone().into()
        };
        Self {
            culling: joined(pass, "Culling"),
            visible: joined(pass, "Visible"),
            prepass: joined(pass, "DepthPrepass"),
            opaque: pass.to_owned().into(),
            transparent: joined(pass, "Transparent"),
            depth: joined(&color, "Depth"),
            image: joined(&color, "Image"),
            copy: joined(pass, "Copy"),
            color,
            reads,
        }
    }
}

/// `name` followed by `end`, without the text formatting code.
fn joined(name: &str, end: &str) -> Cow<'static, str> {
    let mut text = String::with_capacity(name.len() + end.len());
    text.push_str(name);
    text.push_str(end);
    Cow::Owned(text)
}

/// The size that a view draws at: its target's size in texels, or the render size halved as many
/// times as its target says.
fn view_size(view: &View) -> Size {
    view.target().graph_size()
}

/// The pass, optional when it belongs to a view other than the camera's, so it runs only while a
/// running pass reads what the view draws.
fn optional_beyond_camera(pass: Pass, index: usize) -> Pass {
    if index == ViewId::CAMERA.index() {
        pass
    } else {
        pass.optional()
    }
}

/// The pass of view `index`, reading the targets of other views that its objects may show: for
/// the camera's view, the target of every view that a texture shows, and for any other view, the
/// targets that it names.
fn reads_targets(mut pass: Pass, views: &[View], named: &[ViewPassNames], index: usize) -> Pass {
    if index == ViewId::CAMERA.index() {
        for (other, view) in views.iter().enumerate().skip(1) {
            if !view.is_removed() && view.target().shown {
                pass = pass.reads(named[other].color.clone());
            }
        }
    } else {
        for name in &named[index].reads {
            pass = pass.reads(name.clone());
        }
    }
    pass
}

/// Records the creation of a plan's texture under `id`, with its shape and the size it takes,
/// `made`. Bind groups see an array target as an array, whatever its layer count. A mipmapped
/// target has the whole chain of levels that its size takes.
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
    let mips = if target.mipmapped {
        format::full_chain(width, height)
    } else {
        1
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
            mips,
            binding,
        ],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::view::ViewTarget;

    /// A view other than the camera's whose target a texture shows, so the camera's passes read
    /// it and it runs.
    fn shown() -> View {
        View::default().with_target(ViewTarget {
            shown: true,
            ..ViewTarget::default()
        })
    }

    impl FrameGraph {
        /// Syncs views that take the engine's names.
        fn sync(&mut self, views: &[View]) {
            let names = vec![ViewNames::default(); views.len()];
            self.sync_views(views, &names);
        }
    }
    use null3d_gpu::drawlist::{layout as bind_layout, permutation};

    #[test]
    fn a_mirror_view_draws_at_its_share_of_the_render_size_and_culls_once() {
        let mut frames = frame_graph(format::RGBA16_FLOAT, Antialias::Msaa, true, false);
        frames.set_occlusion(true);
        let mirror = crate::mirror::Mirror::new([0.0, 1.0, 0.0], [0.0; 3]).unwrap();
        let mut reflection = View::mirror(mirror, None, None).with_target(ViewTarget {
            shown: true,
            ..ViewTarget::default()
        });
        reflection.follow_camera(1, 1);
        frames.sync(&[View::default(), reflection, shown()]);
        let size = |view: usize| frames.graph().pass_size(frames.opaque[view]);
        assert_eq!(size(1), Size::HALF);
        assert_eq!(size(2), Size::Full);
        assert!(frames.occludes(ViewId::CAMERA));
        assert!(
            !frames.occludes(ViewId::from_index(1)),
            "a mirror view culls once"
        );
        assert!(frames.occludes(ViewId::from_index(2)));
        // A new share of the render size declares the passes again.
        reflection.follow_camera(2, 1);
        frames.sync(&[View::default(), reflection, shown()]);
        assert_eq!(frames.graph().pass_size(frames.opaque[1]), Size::QUARTER);
    }

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
        effects: EffectIds {
            buffer: 12,
            sampler: 12,
            first_group: 30,
            blank_depth: 902,
        },
        dof: DofIds {
            buffer: 13,
            sampler: 13,
            first_group: 50,
        },
        view_copy: Some(ViewCopyIds { first_group: 40 }),
        transmission: TransmissionIds {
            group: 60,
            blank: 903,
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
        frames.sync(&[View::default(), shown()]);
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
            "Copy1",
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
                Role::ViewCopy(ViewId::from_index(1)),
                Role::Cull(ViewId::OUTLINE),
                Role::OutlineMask,
                Role::Resolve,
                Role::Final,
                Role::Final,
            ]
        );
        for (place, name) in names.into_iter().enumerate() {
            let on = matches!(
                name,
                "LightClusters" | "Culling" | "Culling1" | "Resolve" | "Copy1"
            ) || name.starts_with("Opaque");
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
        frames.sync(&[View::default()]);
        assert_eq!(frames.graph().pass_count(), 7);
        assert_eq!(frames.roles[0], Role::Opaque(ViewId::CAMERA));
    }

    #[test]
    fn hdr_color_runs_the_final_pass_instead_of_the_resolve_pass() {
        for hdr in [format::RGBA16_FLOAT, format::RG11B10_UFLOAT] {
            let mut frames = frame_graph(hdr, Antialias::Msaa, false, false);
            frames.sync(&[View::default()]);
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
                frames.sync(&[View::default()]);
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
            frames.sync(&[View::default()]);
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
        frames.sync(&[View::default(), shown()]);
        let mut list = DrawList::with_capacity(256);
        frames
            .prepare(&mut list, (64, 64), RenderScale::FULL)
            .unwrap();
        let without = steps(&frames);
        assert_eq!(
            without,
            [
                vec!["LightClusters", "Culling", "Culling1"],
                vec!["Opaque1"],
                vec!["Copy1"],
                vec!["Opaque", "Resolve"],
            ]
        );

        frames.set_debug_lines(true);
        frames
            .prepare(&mut list, (64, 64), RenderScale::FULL)
            .unwrap();
        assert_eq!(
            steps(&frames)[3],
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
        frames.sync(&[View::default(), shown()]);
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
                vec!["DepthPrepass1", "Opaque1"],
                vec!["Copy1"],
                vec!["DepthPrepass", "Opaque", "Resolve"],
            ]
        );
        // The prepass begins each view's render pass, which clears the color and the depth.
        list.clear();
        frames
            .record(&mut list, |_| [0.0; 4], |_| false, |_, _| Ok(()))
            .unwrap();
        let passes = operands(&list, Op::BeginRenderPass);
        let both = pass_flags::CLEAR_COLOR | pass_flags::CLEAR_DEPTH;
        assert!([0, 2].iter().all(|&at| passes[at][8] & both == both));
        // The prepass makes no texture of its own.
        let textures = frames.graph().plan().unwrap().textures().len();
        let mut without = frame_graph(format::CANVAS, Antialias::Msaa, true, false);
        without.sync(&[View::default(), shown()]);
        without
            .prepare(&mut list, (64, 64), RenderScale::FULL)
            .unwrap();
        assert_eq!(without.graph().plan().unwrap().textures().len(), textures);
        // Views keep their prepass when they change.
        frames.sync(&[View::default()]);
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
        frames.sync(&[View::default()]);
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
            .record(&mut list, |_| [0.0; 4], |_| false, |_, _| Ok(()))
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
    fn multisampled_targets_are_made_again_when_the_pass_to_the_canvas_changes() {
        let mut frames = frame_graph(format::CANVAS, Antialias::Msaa, true, false);
        frames.sync(&[View::default()]);
        let mut list = DrawList::with_capacity(512);
        let multisampled = |list: &DrawList| {
            let created = operands(list, Op::CreateTexture);
            created.into_iter().filter(|t| t[6] > 1).count()
        };
        frames
            .prepare(&mut list, (64, 64), RenderScale::FULL)
            .unwrap();
        let first = multisampled(&list);
        assert!(first > 0);

        // The final pass takes over from the resolve pass, so the multisampled targets that
        // resolved into the canvas are made again, and so are they when the resolve pass returns.
        for scales in [true, false] {
            frames.set_scaling(scales);
            list.clear();
            frames
                .prepare(&mut list, (64, 64), RenderScale::FULL)
                .unwrap();
            assert_eq!(
                multisampled(&list),
                first,
                "render scale can drop: {scales}"
            );
            list.clear();
            frames
                .prepare(&mut list, (64, 64), RenderScale::FULL)
                .unwrap();
            assert!(list.is_empty());
        }
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
        frames.sync(&[View::default(), shown()]);
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
                vec!["Opaque1", "Transparent1"],
                vec!["Copy1"],
                vec!["Opaque", "DebugLines", "Transparent", "Resolve"],
            ],
            "blended objects draw over the opaque ones and the lines, before the color resolves"
        );
        // Views declared later take the passes' state.
        frames.sync(&[View::default(), shown(), shown()]);
        frames
            .prepare(&mut list, (64, 64), RenderScale::FULL)
            .unwrap();
        assert!(steps(&frames).contains(&vec!["Opaque2".to_owned(), "Transparent2".to_owned()]));
        frames.set_transparent(false);
        frames
            .prepare(&mut list, (64, 64), RenderScale::FULL)
            .unwrap();
        assert!(steps(&frames).contains(&vec!["Opaque2".to_owned()]));

        // On the HDR path the final pass reads the scene color after the blended objects.
        let mut frames = frame_graph(format::RGBA16_FLOAT, Antialias::Msaa, true, false);
        frames.sync(&[View::default()]);
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
    fn bloom_runs_its_chain_between_the_scene_and_the_final_pass_only_while_it_is_on() {
        let canvas = (1920, 1080);
        let mut frames = frame_graph(format::RGBA16_FLOAT, Antialias::Msaa, true, false);
        frames.sync(&[View::default()]);
        let mut list = DrawList::with_capacity(8192);
        frames
            .prepare(&mut list, canvas, RenderScale::FULL)
            .unwrap();
        let without = frames.graph().plan().unwrap().textures().len();
        assert_eq!(steps(&frames).last().unwrap(), &["Final"]);

        let chain = ChainFrame::default();
        frames.set_bloom(Some(Bloom::default()), chain);
        frames.request_pipelines(&mut PipelineCache::default(), 0);
        frames
            .prepare(&mut list, canvas, RenderScale::FULL)
            .unwrap();
        let names = steps(&frames);
        let mut expected: Vec<Vec<String>> = BLOOM_DOWN
            .iter()
            .chain(BLOOM_UP[..LEVELS - 1].iter().rev())
            .map(|name| vec![name.to_string()])
            .collect();
        expected.push(vec!["FinalBloom".into()]);
        assert_eq!(names[names.len() - expected.len()..], expected[..]);
        // Each level has a target of its own at its size, which its step down creates and its step
        // up blends into.
        let plan = frames.graph().plan().unwrap();
        let textures = plan.textures();
        assert_eq!(textures.len(), without + LEVELS);
        let texture = |name: &str| plan.texture_of(frames.graph().find_resource(name).unwrap());
        for (level, name) in BLOOM_LEVELS.iter().enumerate() {
            let Some(Surface::Texture(index)) = texture(name) else {
                panic!("bloom draws into textures")
            };
            assert_eq!(
                textures[usize::from(index)].size,
                bloom::level_size(512, level)
            );
        }

        // A new render scale and the governor's step make no GPU object: the frame only uploads
        // new settings.
        let mut arena = UploadArena::default();
        let output = Output::default();
        arena.reset(frames.upload_bound());
        frames
            .upload(&mut list, &mut arena, output, Grading::default())
            .unwrap();
        frames.set_scaling(true);
        let only_uploads =
            |frames: &mut FrameGraph, list: &mut DrawList, arena: &mut UploadArena| {
                list.clear();
                frames
                    .prepare(list, canvas, RenderScale::from_thousandths(500))
                    .unwrap();
                arena.reset(frames.upload_bound());
                frames
                    .upload(list, arena, output, Grading::default())
                    .unwrap();
                let ops: Vec<Op> = null3d_gpu::drawlist::decode(list.words())
                    .map(|command| command.unwrap().op)
                    .collect();
                assert!(ops.iter().all(|&op| op == Op::WriteBuffer), "{ops:?}");
            };
        // The scale switches the final pass's output on once, which compiles the graph again.
        list.clear();
        frames
            .prepare(&mut list, canvas, RenderScale::from_thousandths(700))
            .unwrap();
        arena.reset(frames.upload_bound());
        frames
            .upload(&mut list, &mut arena, output, Grading::default())
            .unwrap();
        only_uploads(&mut frames, &mut list, &mut arena);
        let record = |frames: &FrameGraph, list: &mut DrawList| {
            list.clear();
            frames
                .record(list, |_| [0.0; 4], |_| false, |_, _| Ok(()))
                .unwrap();
            (
                operands(list, Op::BeginRenderPass).len(),
                operands(list, Op::SetViewport),
            )
        };
        let (passes, viewports) = record(&frames, &mut list);
        // The scene's corner, then each level's whole target: the base first, the default weights'
        // widest level, and the base again for its step up. The two widest levels have no weight,
        // so they do not draw.
        assert_eq!(viewports[0][2..4], [960, 540]);
        assert_eq!(viewports[1][2..4], [910, 512]);
        assert_eq!(viewports[8][2..4], [8, 4]);
        assert_eq!(viewports.last().unwrap()[2..4], [910, 512]);
        assert_eq!(viewports.len(), 1 + 15);

        // The governor's halving draws each level into a corner of half its target, and drops the
        // last level's two steps.
        frames.set_bloom(
            Some(Bloom::default()),
            ChainFrame {
                halvings: 1,
                ..chain
            },
        );
        only_uploads(&mut frames, &mut list, &mut arena);
        let (halved, viewports) = record(&frames, &mut list);
        assert_eq!(halved, passes - 2);
        assert_eq!(viewports[1][2..4], [455, 256]);
        assert_eq!(viewports[7][2..4], [8, 4]);

        // A smaller base declares the chain again with one level fewer.
        frames.set_bloom(
            Some(Bloom::default()),
            ChainFrame {
                size: 256,
                halvings: 0,
            },
        );
        frames.sync(&[View::default()]);
        frames.request_pipelines(&mut PipelineCache::default(), 0);
        frames
            .prepare(&mut list, canvas, RenderScale::FULL)
            .unwrap();
        let plan = frames.graph().plan().unwrap();
        assert_eq!(plan.textures().len(), without + LEVELS - 1);
        assert!(frames.graph().find_pass(BLOOM_DOWN[LEVELS - 1]).is_none());

        // Off again, the steps and their targets are gone.
        frames.set_bloom(None, chain);
        frames.sync(&[View::default()]);
        frames
            .prepare(&mut list, canvas, RenderScale::FULL)
            .unwrap();
        assert_eq!(frames.graph().plan().unwrap().textures().len(), without);
    }

    #[test]
    fn effects_run_in_order_between_the_scene_and_bloom_and_share_two_targets() {
        let canvas = (1280, 720);
        let mut frames = frame_graph(format::RGBA16_FLOAT, Antialias::Msaa, true, false);
        frames.sync(&[View::default()]);
        let mut list = DrawList::with_capacity(8192);
        frames
            .prepare(&mut list, canvas, RenderScale::FULL)
            .unwrap();
        let without = frames.graph().plan().unwrap().textures().len();

        let effect = |template, depth| Effect {
            template,
            depth,
            values: [0.0; effects::EFFECT_FLOATS],
        };
        let chain = [effect(64, false), effect(65, true), effect(66, false)];
        frames.set_effects(&chain, &EffectJoins::default(), [0.0; 2], None);
        frames.set_bloom(Some(Bloom::default()), ChainFrame::default());
        frames.sync(&[View::default()]);
        let mut pipelines = PipelineCache::default();
        // Bloom draws once a frame drew with its pipelines built.
        frames.request_pipelines(&mut pipelines, 0);
        pipelines.create_new(&mut list, 1).unwrap();
        frames.request_pipelines(&mut pipelines, 1);
        frames
            .prepare(&mut list, canvas, RenderScale::FULL)
            .unwrap();
        let names: Vec<String> = steps(&frames).into_iter().flatten().collect();
        let place = |name: &str| names.iter().position(|n| n == name).unwrap();
        assert!(place("Opaque") < place("Effect0"));
        assert!(place("Effect0") < place("Effect1") && place("Effect1") < place("Effect2"));
        assert!(place("Effect2") < place(BLOOM_DOWN[0]));
        // The effects' targets live one after another, so they share textures: the chain adds two
        // at most, whatever its length.
        let with = frames.graph().plan().unwrap().textures().len();
        assert!(with <= without + LEVELS + 2, "{with} textures");
        // The effect that reads depth reads the multisampled depth through its build and layout.
        let keys = pipelines.keys();
        let templates: Vec<(u32, u32)> = keys
            .iter()
            .filter(|key| key.template >= 64)
            .map(|key| (key.template, key.permutation))
            .collect();
        assert_eq!(
            templates,
            [(64, 0), (65, permutation::DEPTH_MULTISAMPLED), (66, 0)]
        );
        let mut arena = UploadArena::default();
        arena.reset(frames.upload_bound());
        list.clear();
        frames
            .upload(&mut list, &mut arena, Output::default(), Grading::default())
            .unwrap();
        let layouts: Vec<u32> = operands(&list, Op::CreateBindGroup)
            .iter()
            .filter(|group| group[0] >= 30 && group[0] < 30 + MAX_EFFECTS as u32)
            .map(|group| group[1])
            .collect();
        assert_eq!(
            layouts,
            [
                bind_layout::EFFECT,
                bind_layout::EFFECT_DEPTH_MS,
                bind_layout::EFFECT
            ]
        );

        // Fewer effects declare the chain again; none leave the plan as it was.
        frames.set_effects(&[], &EffectJoins::default(), [0.0; 2], None);
        frames.set_bloom(None, ChainFrame::default());
        frames.sync(&[View::default()]);
        frames
            .prepare(&mut list, canvas, RenderScale::FULL)
            .unwrap();
        assert_eq!(frames.graph().plan().unwrap().textures().len(), without);
        assert!(frames.graph().find_pass(EFFECT_PASSES[0]).is_none());
    }

    /// What a frame draws depth of field with: the default lens, its camera's planes, and no
    /// inverse projection, which the graph does not read.
    fn dof_frame() -> DofFrame {
        DofFrame {
            dof: dof::Dof::default(),
            lens: dof::Lens::new(50.0, 2.8, 10.0),
            near: 0.1,
            far: 100.0,
            inverse_projection: [0.0; 16],
            taps: 22,
        }
    }

    #[test]
    fn depth_of_field_runs_between_the_effects_and_bloom_and_costs_nothing_while_off() {
        let canvas = (1280, 720);
        let mut frames = frame_graph(format::RGBA16_FLOAT, Antialias::Msaa, true, false);
        frames.sync(&[View::default()]);
        let mut list = DrawList::with_capacity(8192);
        let mut pipelines = PipelineCache::default();
        frames.request_pipelines(&mut pipelines, 1);
        pipelines.create_new(&mut list, 1).unwrap();
        frames
            .prepare(&mut list, canvas, RenderScale::FULL)
            .unwrap();
        let without = steps(&frames);
        let textures = frames.graph().plan().unwrap().textures().len();
        let keys = pipelines.keys().len();
        let bound = frames.upload_bound();

        // Off, the frame declares, asks for and uploads nothing of depth of field.
        frames.set_dof(None);
        frames.request_pipelines(&mut pipelines, 1);
        frames
            .prepare(&mut list, canvas, RenderScale::FULL)
            .unwrap();
        assert_eq!(steps(&frames), without);
        assert_eq!(pipelines.keys().len(), keys);
        assert_eq!(frames.upload_bound(), bound);

        let effect = Effect {
            template: 64,
            depth: false,
            values: [0.0; effects::EFFECT_FLOATS],
        };
        frames.set_effects(&[effect], &EffectJoins::default(), [0.0; 2], None);
        frames.set_bloom(Some(Bloom::default()), ChainFrame::default());
        frames.set_dof(Some(dof_frame()));
        frames.sync(&[View::default()]);
        frames.request_pipelines(&mut pipelines, 1);
        assert!(
            !frames.dof_draws(),
            "depth of field waits for its pipelines"
        );
        pipelines.create_new(&mut list, 2).unwrap();
        frames.request_pipelines(&mut pipelines, 2);
        assert!(frames.dof_draws());
        frames.sync(&[View::default()]);
        frames
            .prepare(&mut list, canvas, RenderScale::FULL)
            .unwrap();
        let names: Vec<String> = steps(&frames).into_iter().flatten().collect();
        let place = |name: &str| names.iter().position(|n| n == name).unwrap();
        assert!(place("Effect0") < place(DOF_PASSES[0]));
        for step in 1..dof::STEPS {
            assert!(place(DOF_PASSES[step - 1]) < place(DOF_PASSES[step]));
        }
        assert!(place(DOF_PASSES[3]) < place(BLOOM_DOWN[0]));
        // Bloom and the final pass read the composite's target. The three half-size targets live
        // one after another, so the steps add at most three textures.
        assert_eq!(frames.color_output(), DOF_TARGETS[3]);
        assert_eq!(frames.effects_output(), EFFECT_TARGETS[0]);
        let graph = frames.graph();
        let with_bloom = textures + LEVELS + 1;
        let with = graph.plan().unwrap().textures().len();
        assert!(with <= with_bloom + 3, "{with} textures");
        // The setup and the composite read the multisampled depth through their layouts.
        let mut arena = UploadArena::default();
        arena.reset(frames.upload_bound());
        list.clear();
        frames
            .upload(&mut list, &mut arena, Output::default(), Grading::default())
            .unwrap();
        let layouts: Vec<u32> = operands(&list, Op::CreateBindGroup)
            .iter()
            .filter(|group| (50..50 + dof::STEPS as u32).contains(&group[0]))
            .map(|group| group[1])
            .collect();
        assert_eq!(
            layouts,
            [
                bind_layout::EFFECT_DEPTH_MS,
                bind_layout::BLOOM,
                bind_layout::BLOOM,
                bind_layout::DOF_COMPOSITE_MS
            ]
        );
        // A moving focus uploads the blocks again and declares nothing.
        let compiles = frames.graph().compiles();
        let mut moved = dof_frame();
        moved.lens = dof::Lens::new(50.0, 2.8, 3.0);
        frames.set_dof(Some(moved));
        frames
            .prepare(&mut list, canvas, RenderScale::FULL)
            .unwrap();
        assert_eq!(frames.graph().compiles(), compiles);

        // Off again, the plan loses every step and target.
        frames.set_effects(&[], &EffectJoins::default(), [0.0; 2], None);
        frames.set_bloom(None, ChainFrame::default());
        frames.set_dof(None);
        frames.sync(&[View::default()]);
        frames
            .prepare(&mut list, canvas, RenderScale::FULL)
            .unwrap();
        assert_eq!(steps(&frames), without);
        assert_eq!(frames.graph().plan().unwrap().textures().len(), textures);
    }

    #[test]
    fn the_8_bit_path_draws_no_depth_of_field() {
        let mut frames = frame_graph(format::CANVAS, Antialias::Msaa, false, false);
        frames.sync(&[View::default()]);
        frames.set_dof(Some(dof_frame()));
        let mut pipelines = PipelineCache::default();
        frames.request_pipelines(&mut pipelines, 0);
        assert!(!frames.dof_draws());
        assert!(
            pipelines
                .keys()
                .iter()
                .all(|key| key.template != null3d_gpu::drawlist::template::DOF_SETUP)
        );
    }

    #[test]
    fn effects_join_once_their_group_is_built_and_fold_into_the_final_pass() {
        let canvas = (1280, 720);
        let mut frames = frame_graph(format::RGBA16_FLOAT, Antialias::Msaa, true, false);
        frames.sync(&[View::default()]);
        let mut list = DrawList::with_capacity(8192);
        frames
            .prepare(&mut list, canvas, RenderScale::FULL)
            .unwrap();
        let effect = |template, depth| Effect {
            template,
            depth,
            values: [0.0; effects::EFFECT_FLOATS],
        };
        let chain = [effect(64, false), effect(65, false), effect(66, true)];
        let mut joins = EffectJoins::default();
        joins.groups[1] = (2, 90);
        let mut pipelines = PipelineCache::default();
        // Frames after the first: a pipeline draws once a frame drew with it built.
        let frame = |frames: &mut FrameGraph,
                     pipelines: &mut PipelineCache,
                     joins: &EffectJoins,
                     built: u32,
                     list: &mut DrawList| {
            frames.set_effects(&chain, joins, [0.0; 2], None);
            frames.request_pipelines(pipelines, built);
            pipelines.create_new(list, built + 1).unwrap();
            frames.sync(&[View::default()]);
            frames.prepare(list, canvas, RenderScale::FULL).unwrap();
            steps(frames).into_iter().flatten().collect::<Vec<String>>()
        };
        let effect_passes = |names: &[String]| {
            names
                .iter()
                .filter(|name| name.starts_with("Effect"))
                .count()
        };
        // The effects draw alone while they build, and while their group's pipeline builds after
        // them, and then as one.
        let names = frame(&mut frames, &mut pipelines, &joins, 5, &mut list);
        assert_eq!(effect_passes(&names), 3);
        assert!(pipelines.keys().iter().all(|key| key.template != 90));
        let names = frame(&mut frames, &mut pipelines, &joins, 6, &mut list);
        assert_eq!(effect_passes(&names), 3);
        let names = frame(&mut frames, &mut pipelines, &joins, 7, &mut list);
        assert_eq!(effect_passes(&names), 2);
        let group = pipelines
            .keys()
            .iter()
            .find(|key| key.template == 90)
            .expect("the group asked for its pipeline");
        assert_eq!(group.permutation, permutation::DEPTH_MULTISAMPLED);
        let mut arena = UploadArena::default();
        arena.reset(frames.upload_bound());
        list.clear();
        frames
            .upload(&mut list, &mut arena, Output::default(), Grading::default())
            .unwrap();
        let bound: Vec<Vec<u32>> = operands(&list, Op::CreateBindGroup)
            .into_iter()
            .filter(|group| group[0] == 30 + MAX_EFFECTS as u32 + 1)
            .collect();
        assert_eq!(bound.len(), 1, "the group binds once");
        assert_eq!(bound[0][3 + 4], effects::BUFFER_BYTES as u32);

        // Folded, the group's effects leave their passes, and the final pass reads the first
        // effect's target with its fold build, once that build's pipeline is built.
        joins.fold = Some((1, 91));
        let names = frame(&mut frames, &mut pipelines, &joins, 8, &mut list);
        assert_eq!(effect_passes(&names), 2, "the fold waits for its pipeline");
        let names = frame(&mut frames, &mut pipelines, &joins, 9, &mut list);
        assert_eq!(effect_passes(&names), 1);
        let fold = pipelines
            .keys()
            .iter()
            .position(|key| key.template == 91)
            .expect("the final pass asked for its fold build") as u32
            + 1;
        let mut arena = UploadArena::default();
        arena.reset(frames.upload_bound());
        list.clear();
        frames
            .upload(&mut list, &mut arena, Output::default(), Grading::default())
            .unwrap();
        let layouts: Vec<u32> = operands(&list, Op::CreateBindGroup)
            .iter()
            .map(|group| group[1])
            .collect();
        assert!(layouts.contains(&bind_layout::FINAL_EFFECTS_DEPTH_MS));
        list.clear();
        frames
            .record(&mut list, |_| [0.0; 4], |_| false, |_, _| Ok(()))
            .unwrap();
        assert!(
            operands(&list, Op::SetPipeline)
                .iter()
                .any(|set| set[0] == fold)
        );

        // Bloom reads the effects' image, so nothing folds while it is on.
        frames.set_bloom(Some(Bloom::default()), ChainFrame::default());
        let names = frame(&mut frames, &mut pipelines, &joins, 10, &mut list);
        assert_eq!(effect_passes(&names), 2);
    }

    #[test]
    fn the_8_bit_path_runs_no_effects() {
        let mut frames = frame_graph(format::CANVAS, Antialias::Msaa, true, false);
        let effect = Effect {
            template: 64,
            depth: false,
            values: [0.0; effects::EFFECT_FLOATS],
        };
        frames.set_effects(&[effect], &EffectJoins::default(), [0.0; 2], None);
        frames.sync(&[View::default()]);
        assert!(frames.graph().find_pass(EFFECT_PASSES[0]).is_none());
    }

    #[test]
    fn bloom_draws_after_the_first_frame_only_once_its_pipelines_are_built() {
        let mut frames = frame_graph(format::RGBA16_FLOAT, Antialias::Msaa, true, false);
        frames.sync(&[View::default()]);
        let mut pipelines = PipelineCache::default();
        let mut list = DrawList::with_capacity(4096);
        frames.request_pipelines(&mut pipelines, 0);
        pipelines.create_new(&mut list, 1).unwrap();
        // The sketch turns bloom on in frame 5, after the thread that draws drew frame 3.
        frames.set_bloom(Some(Bloom::default()), ChainFrame::default());
        frames.request_pipelines(&mut pipelines, 3);
        pipelines.create_new(&mut list, 5).unwrap();
        assert!(!frames.bloom_draws(), "bloom waits for its pipelines");
        frames
            .prepare(&mut list, (320, 180), RenderScale::FULL)
            .unwrap();
        assert_eq!(steps(&frames).last().unwrap(), &["Final"]);
        frames.request_pipelines(&mut pipelines, 4);
        assert!(!frames.bloom_draws());
        frames.request_pipelines(&mut pipelines, 5);
        assert!(
            frames.bloom_draws(),
            "bloom draws once a frame drew them built"
        );
        frames
            .prepare(&mut list, (320, 180), RenderScale::FULL)
            .unwrap();
        assert_eq!(steps(&frames).last().unwrap(), &["FinalBloom"]);
        frames.set_bloom(None, ChainFrame::default());
        frames.request_pipelines(&mut pipelines, 6);
        assert!(!frames.bloom_draws());
        frames.set_bloom(Some(Bloom::default()), ChainFrame::default());
        frames.request_pipelines(&mut pipelines, 6);
        assert!(frames.bloom_draws(), "built pipelines draw at once");
    }

    #[test]
    fn outlines_run_their_mask_with_the_scene_depth_only_while_something_is_outlined() {
        for (scene_color, gpu_culling) in [(format::RGBA16_FLOAT, true), (format::CANVAS, false)] {
            let mut frames = frame_graph(scene_color, Antialias::Msaa, gpu_culling, true);
            frames.sync(&[View::default()]);
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
            frames.request_pipelines(&mut PipelineCache::default(), 0);
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
                .record(
                    &mut list,
                    |_| [0.25, 0.5, 0.75, 1.0],
                    |_| false,
                    |_, _| Ok(()),
                )
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
            frames.sync(&[View::default(), shown()]);
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
            frames.request_pipelines(&mut PipelineCache::default(), 0);
            frames.sync(&[View::default(), shown()]);
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
            // shares a texture with the side view's depth, whose usage differs. With one sample
            // of HDR color, the prepass's stand-in color takes a texture of its own too: the
            // scene color, which it would share, is sampled, and the side view's color is kept.
            let stand_in =
                usize::from(format == format::RGBA16_FLOAT && antialias == Antialias::Fxaa);
            assert_eq!(plan.textures().len(), without + 4 + stand_in);
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
                .record(&mut list, |_| [0.0; 4], |_| false, |_, _| Ok(()))
                .unwrap();
            let viewports = operands(&list, Op::SetViewport);
            assert!(viewports.iter().any(|v| v[2..4] == [80, 45]));

            // Off again, the steps and their targets are gone, and the prepass with them.
            frames.set_ao(None, 0.5);
            assert!(!frames.depth_prepass());
            frames.sync(&[View::default(), shown()]);
            frames
                .prepare(&mut list, (320, 180), RenderScale::FULL)
                .unwrap();
            assert_eq!(frames.graph().plan().unwrap().textures().len(), without);
            assert!(frames.graph().find_pass("AoDepth").is_none());
            assert_eq!(frames.ao_texture(), None);
        }
    }

    /// Turns transmission on in `frames` and builds the copy's pipeline, as a builder's frames do:
    /// the first frame asks for it, and a later one finds it built.
    fn build_transmission(frames: &mut FrameGraph, pipelines: &mut PipelineCache) {
        let mut list = DrawList::with_capacity(1024);
        frames.set_transmission(true);
        frames.request_pipelines(pipelines, 1);
        assert!(
            !frames.transmission_draws(),
            "the copy waits for its pipeline"
        );
        pipelines.create_new(&mut list, 2).unwrap();
        frames.request_pipelines(pipelines, 2);
        assert!(frames.transmission_draws());
    }

    #[test]
    fn transmission_copies_the_opaque_color_between_the_camera_passes_only_while_it_is_used() {
        // On the 8-bit path the final pass takes the scene color to the canvas while the copy
        // draws, as the resolve pass resolves it into the canvas alone.
        for format in [format::RGBA16_FLOAT, format::CANVAS] {
            let canvas = (320, 180);
            let mut frames = frame_graph(format, Antialias::Msaa, true, false);
            frames.sync(&[View::default(), shown()]);
            frames.set_transparent(true);
            let mut list = DrawList::with_capacity(8192);
            let mut pipelines = PipelineCache::default();
            frames.request_pipelines(&mut pipelines, 1);
            frames
                .prepare(&mut list, canvas, RenderScale::FULL)
                .unwrap();
            let without = steps(&frames);
            let textures = frames.graph().plan().unwrap().textures().len();
            let keys = pipelines.keys().len();

            // Unused, the frame declares, asks for and binds nothing of the copy.
            frames.set_transmission(false);
            frames.request_pipelines(&mut pipelines, 1);
            frames.sync(&[View::default(), shown()]);
            frames
                .prepare(&mut list, canvas, RenderScale::FULL)
                .unwrap();
            assert_eq!(steps(&frames), without);
            assert_eq!(pipelines.keys().len(), keys);
            assert!(!frames.transmission_copied());
            assert_eq!(frames.transmission_texture(), IDS.transmission.blank);

            build_transmission(&mut frames, &mut pipelines);
            frames.sync(&[View::default(), shown()]);
            frames
                .prepare(&mut list, canvas, RenderScale::FULL)
                .unwrap();
            assert!(frames.transmission_copied());
            let with = steps(&frames);
            let copy_step = with
                .iter()
                .position(|step| step == &[TRANSMISSION_PASS])
                .expect("the copy draws in a render pass of its own");
            assert_eq!(
                (&with[copy_step - 1][0], &with[copy_step + 1][0]),
                (&"Opaque".to_owned(), &"Transparent".to_owned()),
                "the copy comes between the camera's opaque and transparent passes"
            );
            assert!(
                with[copy_step + 1..]
                    .iter()
                    .flatten()
                    .any(|name| name == "Final")
            );
            // Other views keep one render pass for their opaque and transparent passes.
            assert!(with.contains(&vec!["Opaque1".to_owned(), "Transparent1".to_owned()]));
            // The copy's target has a whole chain of mip levels, and frame groups bind it.
            let plan = frames.graph().plan().unwrap();
            assert_eq!(plan.textures().len(), textures + 1);
            let copy = frames.transmission_texture();
            assert_ne!(copy, IDS.transmission.blank);
            let mut arena = UploadArena::default();
            arena.reset(frames.upload_bound());
            list.clear();
            frames
                .upload(&mut list, &mut arena, Output::default(), Grading::default())
                .unwrap();
            assert!(
                operands(&list, Op::CreateBindGroup)
                    .iter()
                    .any(|group| group[0] == IDS.transmission.group
                        && group[1] == bind_layout::VIEW_COPY)
            );

            // The opaque pass resolves the multisampled scene color, the copy draws it into the
            // first level, and the frame makes the other levels before the transparent pass.
            list.clear();
            frames
                .record(&mut list, |_| [0.0; 4], |_| false, |_, _| Ok(()))
                .unwrap();
            let commands: Vec<_> = null3d_gpu::drawlist::decode(list.words())
                .map(Result::unwrap)
                .filter(|c| matches!(c.op, Op::BeginRenderPass | Op::GenerateMipmaps))
                .map(|c| (c.op, c.operands.to_vec()))
                .collect();
            let made = commands
                .iter()
                .position(|(op, _)| *op == Op::GenerateMipmaps)
                .expect("the frame makes the copy's levels");
            assert_eq!(commands[made].1, [copy, 0]);
            let (_, into_copy) = &commands[made - 1];
            assert_eq!(
                into_copy[1],
                null3d_gpu::drawlist::NO_TARGET,
                "the copy draws one sample into the first level"
            );
            let (_, opaque) = &commands[made - 2];
            assert_ne!(
                opaque[1],
                null3d_gpu::drawlist::NO_TARGET,
                "the camera's opaque pass resolves the scene color that the copy reads"
            );
            assert_eq!(
                commands[made + 1..]
                    .iter()
                    .filter(|(op, _)| *op == Op::GenerateMipmaps)
                    .count(),
                0
            );

            // Unused again, the copy and its target are gone.
            frames.set_transmission(false);
            frames.sync(&[View::default(), shown()]);
            frames
                .prepare(&mut list, canvas, RenderScale::FULL)
                .unwrap();
            assert_eq!(steps(&frames), without);
            assert_eq!(frames.graph().plan().unwrap().textures().len(), textures);
            assert_eq!(frames.transmission_texture(), IDS.transmission.blank);
        }
    }

    #[test]
    fn the_8_bit_path_draws_no_bloom() {
        let mut frames = frame_graph(format::CANVAS, Antialias::Msaa, false, false);
        frames.sync(&[View::default()]);
        frames.set_bloom(Some(Bloom::default()), ChainFrame::default());
        assert!(!frames.bloom_draws());
        let mut list = DrawList::with_capacity(1024);
        frames
            .prepare(&mut list, (64, 64), RenderScale::FULL)
            .unwrap();
        assert!(frames.graph().find_pass("BloomDown0").is_none());
        assert_eq!(steps(&frames), [vec!["Opaque", "Resolve"]]);
    }
}
