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
//! While some object is a decal, the decal pass comes right after the camera's opaque pass (see
//! [`crate::sorted`]). It reads the scene depth as the opaque pass leaves it, so it draws in a
//! render pass of its own, with the scene color as its only target, before the debug lines, the
//! transmission copy and the transparent pass. Each decal shades the opaque surfaces inside its
//! box and blends over them. While some layers take no decals, the decal redraw pass then draws the
//! camera's opaque objects on those layers again, over their own pixels. Nothing of it runs while
//! no object is a decal.
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
//! While some object's material has a scatter radius and the quality setting gives the subsurface
//! blur taps, on the HDR path, the subsurface passes come after the outline's (see
//! [`crate::subsurface`]). On WebGPU a culling pass culls those objects for the subsurface view.
//! The skin pass draws them into a target and a depth of their own, of one sample, with the
//! camera's lights. The across step blurs that target into one of its own, and the down step adds
//! the blurred light less the sharp light to a copy of the scene color, which the custom effects,
//! depth of field, bloom and the final pass then read in its place. They are declared only while
//! the blur draws, once its steps' pipelines are built.
//!
//! While the sketch turns ambient occlusion on, the camera's view has three ambient occlusion
//! passes between its depth prepass and its opaque pass (see [`crate::ao`]), and the prepass runs
//! for every view even where the builder started without it. The first reads the scene depth as
//! the prepass leaves it, before the opaque pass draws into it again, so the prepass and the
//! opaque pass draw in two render passes. Each step draws into a target of its own at half the
//! render size, and the camera's opaque pass reads the last one. They are declared only while
//! ambient occlusion is on, on either path, since it needs no HDR color.
//!
//! While a pass reads the motion target, which in development builds the motion debug view does,
//! the motion passes come after the transparent passes (see [`crate::motion`]). On WebGPU a culling
//! pass culls the moving objects for the motion view. The motion pass draws them into the motion
//! target, at the scene's samples, with the scene's depth as its depth target, so the scene's
//! render pass stores the depth for it. The motion debug view's step then reads the target, which
//! resolves into one sample, and the scene depth, and draws over the scene color. Where the device
//! cannot draw the motion target, the step reads a blank texture in its place, and shows the
//! camera's motion alone.
//!
//! While the sketch turns automatic exposure on, on the HDR path, the meter's steps run just
//! before the final pass's render pass (see [`crate::exposure`]). They read the color that the
//! final pass reads and write the exposure's texel, which the final pass then multiplies the color
//! by. They are no passes of the graph: the meter owns its small targets, which keep its state
//! from frame to frame, and the frame records its steps itself, as it records the transmission
//! copy's mip levels. Until the meter's pipelines are built, the final pass keeps the camera's
//! exposure.
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
//! no texture. Below the whole canvas the final pass draws in two steps: the first draws the
//! corner's display color into the same corner of its own target, and the second scales that up
//! to the whole canvas.
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
use std::ops::Range;

use null3d_gpu::drawlist::{
    DrawList, NO_TARGET, Op, format, layout as bind_layout, pass_flags, permutation, resource_kind,
    texture_usage, view,
};

use crate::accumulate::{self, AccumulateIds, AccumulatePass};
use crate::ao::{self, Ao, AoIds, AoPass, Contact, StepSources};
use crate::bloom::{self, Bloom, BloomIds, BloomPass, ChainFrame, LEVELS, STEPS};
use crate::camera::Mat4;
use crate::dof::{self, DofFrame, DofIds, DofPass, DofSources};
use crate::effects::{
    self, Effect, EffectIds, EffectJoins, EffectMaps, EffectPass, MAX_EFFECTS, Unit,
};
use crate::exposure::{ExposureFrame, ExposureIds, ExposurePass};
use crate::final_pass::{BloomInputs, FinalIds, FinalInputs, FinalPass, FoldInputs, OutlineInputs};
use crate::fog_volume::{self, FogVolumeFrame, FogVolumeIds, FogVolumePass, FogVolumeSources};
use crate::frame::{CanvasOutput, RecordError, UploadArena};
use crate::frame_data::FrameUniform;
use crate::fullscreen::{FullscreenIds, FullscreenPasses, PassInputs};
use crate::grading::Grading;
use crate::graph::{
    CANVAS, GraphError, LoadOp, Pass, PassId, PassKind, Plan, PlannedTexture, RenderGraph,
    RenderScale, ResourceId, Size, Step, StepKind, StoreOp, Surface, Target,
};
use crate::motion::{self, MotionFrame, MotionIds, MotionView};
use crate::outline::{self, Outline};
use crate::output::{Antialias, Output, SceneColor};
use crate::particles::{DEPTH_COPY_FORMAT, ParticleDepthCopy};
use crate::pick;
use crate::pipelines::{PassTargets, PipelineCache, Prepass};
use crate::shadow_tiles;
use crate::shadows::{CascadeDepth, MAX_CASCADES, ShadowFrame};
use crate::ssr::{self, LastView, SsrIds, SsrPass, TraceFrame};
use crate::subsurface::{self, SubsurfaceFrame, SubsurfaceIds, SubsurfacePass, SubsurfaceSources};
use crate::transmission::{TransmissionCopy, TransmissionIds};
use crate::view::{CanvasRect, Fullscreen, PassSource, View, ViewId, ViewNames};
use crate::view_copy::{ViewCopies, ViewCopyIds};
use crate::weighted::{self, WeightedIds, WeightedLayer};

/// A texture of the plan as the draw lists made it: its plan, the size it was made at, and for a
/// multisampled target, whether it resolved into the canvas.
type MadeTexture = (PlannedTexture, (u32, u32), bool);

/// The format of the scene's depth targets.
pub(crate) const DEPTH_FORMAT: u32 = format::DEPTH32_FLOAT;

/// The GPU object ids that a frame builder gives its graph: its textures take ids from
/// `first_texture` on, and the final pass has its own.
#[derive(Clone, Copy, Debug)]
pub(crate) struct GraphIds {
    pub(crate) first_texture: u32,
    pub(crate) final_pass: FinalIds,
    /// The still-camera accumulation's buffer and bind group.
    pub(crate) accumulate: AccumulateIds,
    /// The GPU objects of the final pass's still build, which draws a still view's accumulated
    /// color. It owns its settings, bind group, blank tables and sampler, as the first step of the
    /// two-step pass does.
    pub(crate) still_pass: FinalIds,
    /// The GPU objects of the first step of the two-step pass, which owns its settings, bind group,
    /// blank tables and sampler, so that it never destroys the final pass's.
    pub(crate) output_pass: FinalIds,
    /// The bind group of the second step of the two-step pass, which the final pass draws: it reads
    /// the first step's target.
    pub(crate) present_group: u32,
    pub(crate) bloom: BloomIds,
    pub(crate) ao: AoIds,
    pub(crate) effects: EffectIds,
    pub(crate) fullscreen: FullscreenIds,
    pub(crate) dof: DofIds,
    pub(crate) exposure: ExposureIds,
    pub(crate) fog: FogVolumeIds,
    /// The copies of views' images into their targets, which only WebGPU makes.
    pub(crate) view_copy: Option<ViewCopyIds>,
    /// The copy of the camera's opaque color that surfaces which let light through sample.
    pub(crate) transmission: TransmissionIds,
    /// The subsurface blur's steps.
    pub(crate) subsurface: SubsurfaceIds,
    /// The motion debug view's step.
    pub(crate) motion: MotionIds,
    pub(crate) ssr: SsrIds,
    /// The composite and the depth copy of the camera's weighted layer.
    pub(crate) weighted: WeightedIds,
    /// The bind group of the copy of the camera's opaque depth that soft particles read.
    pub(crate) particle_depth: u32,
    /// The first of two bind groups for custom materials that read the scene's depth: the blank
    /// texel, then the copy of the camera's opaque depth.
    pub(crate) material_scene: u32,
    /// The texel that a material's scene group binds in place of the copy while the frame makes
    /// none.
    pub(crate) blank_scene_depth: u32,
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
/// The first step of the two-step pass's target: the scene's display color at the render size,
/// which the second step scales up to the canvas.
const OUTPUT_COLOR: &str = "outputColor";
/// The camera's depth target.
const SCENE_DEPTH: &str = "sceneDepth";
/// The still-camera accumulation's history: the mean of a still view's frames, kept from frame to
/// frame, which the final pass's still build draws while the view is still.
const ACCUM_HISTORY: &str = "accumHistory";
/// The most word ranges a frame's list marks for the still comparison: the accumulation's blend,
/// the two-step pass's first step and the final pass's commands, with room to spare.
const WORD_MARKS: usize = 8;

/// True for the passes that a still view's frame records in place of others, or others in place of
/// them: the accumulation's blend and the final pass's still build, against the final pass and the
/// two-step pass's first step.
fn still_swaps(role: Role) -> bool {
    matches!(
        role,
        Role::Accumulate
            | Role::FinalStill
            | Role::Final
            | Role::FinalBloom
            | Role::Output
            | Role::OutputBloom
    )
}

/// The anti-aliasing mode of the final pass's still build for a scene drawn in `antialias`: the
/// mode without FXAA, because the accumulated frames smooth the edges themselves.
fn still_antialias(antialias: Antialias) -> Antialias {
    if antialias == Antialias::Fxaa {
        Antialias::None
    } else {
        antialias
    }
}
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
/// The volumetric fog's light steps, one for each of the two light textures that they write and
/// take turns with, the light textures, the block step and its target, the sum and its target, and
/// the apply step and its target, which the custom effects, depth of field, bloom and the final
/// pass read.
const FOG_LIGHT_PASSES: [&str; 2] = ["FogLight0", "FogLight1"];
const FOG_LIGHT: [&str; 2] = ["fogLight0", "fogLight1"];
const FOG_BLOCK_PASS: &str = "FogBlock";
const FOG_BLOCKS: &str = "fogBlocks";
const FOG_SUM_PASS: &str = "FogSum";
const FOG_SUMMED: &str = "fogSummed";
const FOG_APPLY_PASS: &str = "FogApply";
const FOG_COLOR: &str = "fogColor";
/// An effect slot that holds no effect.
const NO_EFFECT: Effect = Effect {
    template: 0,
    depth: false,
    values: [0.0; effects::EFFECT_FLOATS],
    maps: EffectMaps::NONE,
};
/// The outline view's culling pass on WebGPU, and the buffer of its compacted instances and
/// indirect draws.
const OUTLINE_CULLING: &str = "OutlineCulling";
const OUTLINE_VISIBLE: &str = "outlineVisible";
/// The outline mask, which the mask pass creates and the final pass reads.
const OUTLINE_MASK: &str = "outlineMask";
/// The subsurface view's culling pass on WebGPU, and the buffer of its compacted instances and
/// indirect draws.
const SUBSURFACE_CULLING: &str = "SubsurfaceCulling";
const SUBSURFACE_VISIBLE: &str = "subsurfaceVisible";
/// The skin pass, and the light and the depth that it creates, which the steps read.
const SKIN_PASS: &str = "Skin";
const SKIN_LIGHT: &str = "skinLight";
const SKIN_DEPTH: &str = "skinDepth";
/// The subsurface blur's steps and the targets they create: the across step's, then the copy of
/// the scene color with the blurred light, which the custom effects, depth of field, bloom and the
/// final pass read.
const SUBSURFACE_PASSES: [&str; subsurface::STEPS] = ["SubsurfaceAcross", "SubsurfaceDown"];
const SUBSURFACE_TARGETS: [&str; subsurface::STEPS] = ["subsurfaceAcross", "subsurfaceColor"];
/// The pick's id pass, which draws the camera's opaque objects where the scene's depth leaves
/// them, and the target it creates, which the device resolves into one sample per pixel.
const PICK_PASS: &str = "Pick";
const PICK_IDS: &str = "pickIds";
/// The pass that copies the resolved ids whole, and the target that a copy reads into a buffer.
const PICK_RESOLVE_PASS: &str = "PickResolve";
const PICK_RESOLVED: &str = "pickResolved";
/// Each step of ambient occlusion and the target it creates: the depth copy, the horizon search and
/// the denoise, whose target the camera's opaque pass reads.
const AO_PASSES: [&str; ao::STEPS] = ["AoDepth", "AoHorizon", "AoDenoise"];
const AO_TARGETS: [&str; ao::STEPS] = ["aoDepth", "aoHorizon", "aoResult"];
/// The motion view's culling pass on WebGPU, and the buffer of its compacted instances and
/// indirect draws.
const MOTION_CULLING: &str = "MotionCulling";
const MOTION_VISIBLE: &str = "motionVisible";
/// The motion pass, and the motion target that it draws into.
const MOTION_PASS: &str = "Motion";
const MOTION_TARGET: &str = "motionVectors";
/// The motion debug view's step.
const MOTION_VIEW_PASS: &str = "MotionView";
/// The copy of the camera's opaque color for surfaces that let light through, and the target with
/// a mip chain that it creates, which the camera's transparent pass reads.
const TRANSMISSION_PASS: &str = "Transmission";
const TRANSMISSION_COLOR: &str = "transmissionColor";
/// Each step of screen-space reflections and the target it creates: a level of the depth pyramid
/// for each reduce step, then the trace, whose target the camera's opaque pass reads while ambient
/// occlusion draws none.
const SSR_PASSES: [&str; ssr::STEPS] = [
    "SsrLevel1",
    "SsrLevel2",
    "SsrLevel3",
    "SsrLevel4",
    "SsrLevel5",
    "SsrLevel6",
    "SsrTrace",
];
const SSR_TARGETS: [&str; ssr::STEPS] = [
    "ssrLevel1",
    "ssrLevel2",
    "ssrLevel3",
    "ssrLevel4",
    "ssrLevel5",
    "ssrLevel6",
    "ssrTrace",
];
/// The camera's weighted layer (see [`crate::weighted`]): the pass that draws the weighted
/// surfaces into its two sums, and with a multisampled scene the one-sample depth target that it
/// copies first, and the composite, which blends the sums over the scene color.
const WEIGHTED_DEPTH: &str = "weightedDepth";
const WEIGHTED_PASS: &str = "Weighted";
const WEIGHTED_SUM: &str = "weightedSum";
const WEIGHTED_COVER: &str = "weightedCover";
const WEIGHTED_COMPOSITE_PASS: &str = "WeightedComposite";
/// The pass that draws decals over the camera's opaque objects, from the scene's depth so far.
const DECALS_PASS: &str = "Decals";
/// The pass that draws the objects that decals skip again, after the decal pass.
const DECAL_REDRAW_PASS: &str = "DecalRedraw";
const PARTICLE_DEPTH_PASS: &str = "ParticleDepth";
const PARTICLE_DEPTH: &str = "particleDepth";
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
    /// Draws the decals over the camera's opaque objects, from the scene's depth.
    Decals,
    /// Draws the camera's opaque objects on the layers that decals skip again, over the decals.
    DecalRedraw,
    /// Draws the camera's opaque objects into GPU picking's id target, from the scene's depth.
    Pick,
    /// Copies GPU picking's id target, which the device resolved, into the target that a copy
    /// reads.
    PickResolve,
    /// Resolves the scene color into the canvas on the 8-bit path. It records nothing: the color
    /// attachment of its render pass resolves.
    Resolve,
    /// A step of bloom's chain, by its place in the chain. The graph records it itself.
    Bloom(u8),
    /// Draws the outlined objects into the outline mask, from the outline view.
    OutlineMask,
    /// Draws the objects whose material has a scatter radius into the skin pass's target, from the
    /// subsurface view.
    SkinLight,
    /// A step of the subsurface blur, by its place. The graph records it itself.
    Subsurface(u8),
    /// A step of ambient occlusion, by its place. The graph records it itself.
    Ao(u8),
    /// A step of screen-space reflections, by its place: a level of the depth pyramid, then the
    /// trace. The graph records it itself.
    Ssr(u8),
    /// A pass of the custom effects, a lone effect or a group, by its place among the effects'
    /// passes. The graph records it itself.
    Effect(u8),
    /// A step of depth of field, by its place. The graph records it itself.
    Dof(u8),
    /// The volumetric fog's light step into one of its two light textures, by the texture. The
    /// graph records it, apart from the binding of the camera's frame group, which the builder
    /// records. A frame draws the step of one texture and leaves out the other.
    FogLight(u8),
    /// The volumetric fog's block step, which the graph records itself.
    FogBlock,
    /// The volumetric fog's sum, which the graph records itself.
    FogSum,
    /// The volumetric fog's apply step, which the graph records itself.
    FogApply,
    /// Copies a view's image into its target with its rows turned around, on WebGPU. The graph
    /// records it itself.
    ViewCopy(ViewId),
    /// Draws a full-screen pass of the sketch's WGSL into its view's target, by its view. The
    /// graph records it itself.
    Fullscreen(ViewId),
    /// Copies the camera's opaque color into the first level of the target that surfaces which
    /// let light through sample. The graph records it, and the mip levels after its render pass.
    TransmissionCopy,
    /// Draws the moving objects into the motion target, from the motion view.
    Motion,
    /// Draws each pixel's motion as a color over the scene color, for the motion debug view. The
    /// graph records it itself.
    MotionView,
    /// Draws the camera's weighted surfaces into the weighted layer's two sums. The builder
    /// records it, after the graph's copy of a multisampled scene depth.
    Weighted,
    /// Blends the camera's weighted layer over its scene color. The graph records it itself.
    WeightedComposite,
    /// Copies the camera's opaque depth into the target that soft particles read. The graph
    /// records it itself.
    ParticleDepthCopy,
    /// The still-camera accumulation's blend, which mixes the scene color into a still view's kept
    /// history. The graph records it itself.
    Accumulate,
    /// Tone maps the HDR scene color into the canvas. The graph records it itself.
    Final,
    /// Tone maps a still view's accumulated color into the canvas, in place of the final pass,
    /// without FXAA: the accumulation smooths the edges. The graph records it itself.
    FinalStill,
    /// Tone maps the HDR scene color into the canvas, with bloom's levels added. The graph records
    /// it itself.
    FinalBloom,
    /// Draws the first step of the two-step pass: the scene's display color at the render size,
    /// into [`OUTPUT_COLOR`]. The graph records it itself.
    Output,
    /// Draws the first step of the two-step pass, with bloom's base level added. The graph records
    /// it itself.
    OutputBloom,
}

/// The passes that can take the scene color to the canvas: the resolve pass, and the final pass's
/// declarations by whether they read bloom's levels and then the outline mask. Only the HDR path
/// declares the ones with bloom.
#[derive(Clone, Copy, Debug)]
struct Outputs {
    resolve: PassId,
    finals: [[Option<PassId>; 2]; 2],
    /// The first step of the two-step pass, by whether bloom draws: it draws the scene's display
    /// color at the render size into [`OUTPUT_COLOR`]. The plain final pass is then the second
    /// step, which scales that up to the canvas with the grading and the outline.
    output: [Option<PassId>; 2],
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

/// A value that a frame finds in the compiled plan, once for each compile of the graph: the
/// compile it was found in, and the value. A frame whose graph compiled since finds it again, and
/// so does one after [`CompileCache::clear`]. The count lives here for every such value, so no
/// finder carries a comparison of its own.
#[derive(Clone, Copy, Debug)]
struct CompileCache<T> {
    found: Option<(u32, T)>,
}

impl<T> Default for CompileCache<T> {
    fn default() -> Self {
        Self { found: None }
    }
}

impl<T: Copy> CompileCache<T> {
    /// The value, from `find` when this compile of the graph has not found it yet.
    fn get_or(&mut self, compiles: u32, find: impl FnOnce() -> T) -> T {
        if let Some((at, value)) = self.found
            && at == compiles
        {
            return value;
        }
        let value = find();
        self.found = Some((compiles, value));
        value
    }

    /// Forgets the value, as when the textures that it names are gone.
    fn clear(&mut self) {
        self.found = None;
    }

    /// The value that the last compile found, or `None` before one did.
    fn last(&self) -> Option<T> {
        self.found.map(|(_, value)| value)
    }
}

/// A group of passes that draws once its pipelines are built. The passes that a group allows
/// differ between a frame that has them built and one that has not, so a change in that state
/// declares the frame's passes again.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum BuiltGroup {
    Bloom,
    Dof,
    Fog,
    Screen,
    Subsurface,
    Transmission,
    Weighted,
    ParticleDepth,
}

/// The render graph of a frame builder's passes, the textures its draw lists made for the compiled
/// plan, and the final pass.
#[derive(Debug)]
pub(crate) struct FrameGraph {
    graph: RenderGraph,
    /// What each declared pass records, by the pass's place in the order of declaration.
    roles: Vec<Role>,
    /// Each view's opaque pass, with the view's place.
    opaque: Vec<(u16, PassId)>,
    /// True when each view has a depth prepass.
    prepass: bool,
    /// True when a skinning pass skins meshes before the passes that draw them.
    skinning: bool,
    /// Each view's depth prepass, with the view's place, with the depth prepass.
    prepasses: Vec<(u16, PassId)>,
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
    /// True when the declarations hold the two-step pass: the render scale can drop below the whole
    /// canvas. A frame draws the two steps only below it, so a crossing declares nothing again.
    two_step_declared: bool,
    /// True once the second step's pipeline is built. Until then a frame below the whole canvas's
    /// scale keeps to the one final pass, which scales the image up by itself.
    two_step_built: bool,
    /// True while the sketch sets a color grading table or the vignette, so the final pass runs to
    /// grade the image even where the scene could resolve into the canvas.
    grades: bool,
    /// The outline's settings while the sketch turns it on.
    outline: Option<Outline>,
    /// True while some object is outlined.
    outlined: bool,
    /// The outline's culling pass on WebGPU and its mask pass, once declared.
    outline_passes: Vec<PassId>,
    /// True while a pick waits for a frame: the next declared graph holds the pick's passes.
    picking_wanted: bool,
    /// True once the graph has declared the pick's passes. They stay declared, so the plan keeps
    /// their targets and never remakes one while a copy may still read it.
    pick_declared: bool,
    /// The pick's id pass, once declared.
    pick_pass: Option<PassId>,
    /// The pass that resolves the pick's ids into the target a copy reads, once declared.
    pick_resolve_pass: Option<PassId>,
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
    /// True once the pipelines of ambient occlusion's steps that run draw: built, after the frame
    /// whose list created them.
    ao_built: bool,
    /// The size of bloom's base and the governor's halvings of it.
    bloom_chain: ChainFrame,
    /// The texture that each of bloom's steps reads, and the base level's, found once for each
    /// compile of the graph.
    bloom_textures: CompileCache<([u32; STEPS], u32)>,
    /// The still-camera accumulation's steps' GPU objects.
    accumulate: AccumulatePass,
    /// The final pass's still build, which draws a still view's accumulated color.
    still_pass: FinalPass,
    /// True while the page lets a still view accumulate its frames: hold mode and the image tests
    /// turn it off.
    still_enabled: bool,
    /// True when the canvas keeps the scene's alpha, which the blend does not average.
    canvas_alpha: bool,
    /// True while the declarations hold the accumulation's steps and the still build: on the HDR
    /// path while the page lets a view accumulate. Each frame's recording then picks them or the
    /// final pass, so a view that becomes still or moves again compiles nothing.
    still_declared: bool,
    /// True once the accumulation's pipeline and the still build's are built.
    still_built: bool,
    /// True while the frame records the accumulation's steps and the still build: the camera's
    /// view is still and [`FrameGraph::still_eligible`] holds.
    accumulate_on: bool,
    /// The weight of the frame being recorded in the still view's average.
    accumulate_weight: f32,
    /// The textures that the blend reads and the still build reads, once for each compile of the
    /// graph.
    accumulate_textures: CompileCache<[u32; 2]>,
    /// The words of the frame's list that differ between a frame that blends a still view and one
    /// that does not, in order, which the still comparison leaves out.
    word_marks: Vec<Range<usize>>,
    /// The upload arena's offset of the blend's weight, in a frame that blends.
    weight_at: Option<usize>,
    /// The custom effects' passes and their GPU objects, on the HDR path.
    effect_pass: Option<EffectPass>,
    /// The GPU objects that the effects take.
    effect_ids: EffectIds,
    /// The full-screen passes' GPU objects.
    fullscreen_ids: FullscreenIds,
    fullscreen: FullscreenPasses,
    /// The effects that run, in order: the first `effect_count` slots.
    effects: [Effect; MAX_EFFECTS],
    effect_count: usize,
    /// A bit for each effect that reads the scene's depth, by its place.
    effect_depths: u32,
    /// The views whose targets each effect's textures show, by its place, which its pass reads.
    effect_views: [u32; MAX_EFFECTS],
    /// How the sketch joins its effects into groups and folds them into the final pass.
    effect_joins: EffectJoins,
    /// The effects' passes, as the graph declares them: each a lone effect, or a group whose
    /// pipeline is built. The first `unit_count` hold units.
    effect_units: [Unit; MAX_EFFECTS],
    unit_count: usize,
    /// The place of the first effect that folds into the final pass, while effects fold.
    folded: Option<usize>,
    /// The color that each unit reads and the scene depth's texture, or 0 while no effect reads
    /// depth, found once for each compile of the graph.
    effect_textures: CompileCache<([u32; MAX_EFFECTS], u32)>,
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
    /// The subsurface blur's steps and their GPU objects, once the blur is first wanted.
    subsurface_pass: Option<SubsurfacePass>,
    /// The GPU objects that the blur's steps take.
    subsurface_ids: SubsurfaceIds,
    /// What the blur draws with in the frame, while the quality setting gives it taps on the HDR
    /// path.
    subsurface: Option<SubsurfaceFrame>,
    /// True while some object's material has a scatter radius.
    subsurface_objects: bool,
    /// True once the blur's steps' pipelines draw: built, after the frame whose list created them.
    subsurface_built: bool,
    /// True when the declared passes hold the skin pass and the blur's steps.
    subsurface_declared: bool,
    /// The textures that the blur's steps read, found once for each compile of the graph.
    subsurface_textures: CompileCache<SubsurfaceSources>,
    /// The textures that depth of field's steps read, found once for each compile of the graph.
    dof_textures: CompileCache<DofSources>,
    /// The automatic exposure's meter and its GPU objects, once the sketch first turns it on.
    exposure_pass: Option<ExposurePass>,
    /// The GPU objects that the meter takes.
    exposure_ids: ExposureIds,
    /// What the meter draws with in the frame, while the sketch turns automatic exposure on.
    exposure: Option<ExposureFrame>,
    /// True once the meter's pipelines draw: built, after the frame whose list created them.
    exposure_built: bool,
    /// The volumetric fog's steps and their GPU objects, once the sketch first turns it on.
    fog_pass: Option<FogVolumePass>,
    /// The GPU objects that the volumetric fog's steps take.
    fog_ids: FogVolumeIds,
    /// What the volumetric fog draws with in the frame, while the sketch turns it on.
    fog: Option<FogVolumeFrame>,
    /// True once the volumetric fog's pipelines draw: built, after the frame whose list created
    /// them.
    fog_built: bool,
    /// The slices of the grid's textures that the declared passes hold, or 0 when they hold no
    /// volumetric fog.
    fog_declared: u32,
    /// The textures that the volumetric fog's steps read, found once for each compile of the graph.
    fog_textures: CompileCache<FogVolumeSources>,
    /// Ambient occlusion's steps and their GPU objects, once ambient occlusion first draws.
    ao_pass: Option<AoPass>,
    /// The GPU objects that ambient occlusion's steps take.
    ao_ids: AoIds,
    /// Ambient occlusion's settings while it draws.
    ao: Option<Ao>,
    /// The main directional light's contact shadows while they draw, which ambient occlusion's
    /// steps march.
    contact: Option<Contact>,
    /// The size of ambient occlusion's targets as a share of the render size.
    ao_scale: f32,
    /// The camera's projection and its inverse, while ambient occlusion's steps run.
    projection: (Mat4, Mat4),
    /// Screen-space reflections' steps and their GPU objects, once they first draw.
    ssr_pass: Option<SsrPass>,
    /// The GPU objects that screen-space reflections' steps take.
    ssr_ids: SsrIds,
    /// What screen-space reflections' trace draws with, while the sketch turns them on.
    ssr: Option<TraceFrame>,
    /// The size of screen-space reflections' grid as a share of the render size.
    ssr_scale: f32,
    /// True once screen-space reflections' pipelines, ambient occlusion's depth step's and the
    /// color copy's are built.
    ssr_built: bool,
    /// The camera's view in the frame whose color copy the next frame's reflections read, with the
    /// copy's texture as that frame made it, or `None` before a frame copied for them.
    last_view: Option<(LastView, MadeTexture)>,
    /// The number of views the declarations cover.
    views: usize,
    /// The debug lines pass, once the passes are declared.
    debug_lines: Option<PassId>,
    /// Each view's transparent pass, with the view's place.
    transparent: Vec<(u16, PassId)>,
    /// The views that are full-screen passes, as a mask of their places.
    fullscreen_views: u32,
    /// True when the full-screen passes that read the outline mask were declared reading it,
    /// while outlines draw.
    fullscreen_outline: bool,
    /// True when a declared full-screen pass reads the scene color.
    fullscreen_reads_color: bool,
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
    /// The textures that the copy reads, the scene color and depth, and the one it draws into,
    /// found once for each compile of the graph.
    transmission_target: CompileCache<(u32, u32, u32)>,
    /// Whether the device draws the motion target with one sample, and with MSAA's samples.
    motion_allowed: (bool, bool),
    /// True while the motion debug view shows.
    motion_view: bool,
    /// The camera's move in the frame being recorded, while the motion debug view shows.
    motion_frame: Option<MotionFrame>,
    /// The motion debug view's step.
    motion_step: MotionView,
    /// True once the step's pipeline is built, after the frame whose list created it.
    motion_view_built: bool,
    /// True when the declared passes hold the motion debug view's step.
    motion_declared: bool,
    /// The composite and the depth copy of the camera's weighted layer.
    weighted: WeightedLayer,
    /// True when the device draws into the weighted layer's targets of 16-bit floats.
    weighted_targets: bool,
    /// True while some sorted bucket has a pipeline of the weighted layer.
    weighted_wanted: bool,
    /// True once the composite's pipeline and the depth copy's, where the scene needs it, are
    /// built.
    weighted_built: bool,
    /// True when the declared passes hold the weighted layer.
    weighted_declared: bool,
    /// The textures that the layer's composite and depth copy read, found once for each compile
    /// of the graph: the two sums, and the scene depth or 0.
    weighted_textures: CompileCache<[u32; 3]>,
    /// True while some object is a decal.
    decals_wanted: bool,
    /// True while objects on the layers that decals skip draw again after them.
    redraws_wanted: bool,
    /// True when the declared passes hold the decal pass.
    decals_declared: bool,
    /// The copy of the camera's opaque depth for soft particles and custom materials.
    particle_depth: ParticleDepthCopy,
    /// True while a particle system on the scene fades near the surfaces behind it, or a custom
    /// material reads the scene's depth.
    particle_depth_wanted: bool,
    /// True once the copy's pipeline is built, after the frame whose list created it.
    particle_depth_built: bool,
    /// True when the declared passes hold the copy.
    particle_depth_declared: bool,
    /// The textures that the copy reads and draws into, found once for each compile of the graph.
    particle_depth_target: CompileCache<Option<(u32, u32)>>,
    /// The first of the two bind groups that custom materials which read the scene's depth bind,
    /// and the texture id of the blank texel that stands in for the copy.
    material_scene: u32,
    blank_scene_depth: u32,
    /// The scene groups of custom materials that read the depth: the copy the camera group binds,
    /// or 0 before the groups exist, and whether the blank texel exists.
    material_scene_bound: u32,
    material_scene_has_blank: bool,
    /// True while a custom material reads the scene's depth.
    material_scene_wanted: bool,
    /// True once the frame made the groups that materials bind for their scene inputs.
    material_scene_ready: bool,
    /// The words of the frame's reflection probe filter, which runs after the capture views'
    /// passes and before the camera's first render pass, or `None` in a frame that captures no
    /// probe (see [`crate::probes`]).
    probe_filter: Option<[u32; 10]>,
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
    /// The first step of the two-step pass below the whole canvas's render scale.
    output_pass: FinalPass,
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
            transparent,
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
            fullscreen_views: 0,
            fullscreen_outline: false,
            fullscreen_reads_color: false,
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
            two_step_declared: false,
            two_step_built: false,
            grades: false,
            outline: None,
            outlined: false,
            outline_passes: Vec::new(),
            picking_wanted: false,
            pick_declared: false,
            pick_pass: None,
            pick_resolve_pass: None,
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
            bloom_textures: CompileCache::default(),
            accumulate: AccumulatePass::new(ids.accumulate),
            still_pass: FinalPass::new(ids.still_pass, scene_color, still_antialias(antialias)),
            still_enabled: true,
            canvas_alpha: transparent,
            still_declared: false,
            still_built: false,
            accumulate_on: false,
            accumulate_weight: 1.0,
            accumulate_textures: CompileCache::default(),
            word_marks: Vec::with_capacity(WORD_MARKS),
            weight_at: None,
            effect_pass: scene_color
                .is_hdr()
                .then(|| EffectPass::new(ids.effects, gpu_culling && antialias.samples() > 1)),
            effect_ids: ids.effects,
            fullscreen_ids: ids.fullscreen,
            fullscreen: FullscreenPasses::new(
                ids.fullscreen,
                view_target_format(scene_color),
                gpu_culling && antialias.samples() > 1,
            ),
            effects: [NO_EFFECT; MAX_EFFECTS],
            effect_count: 0,
            effect_depths: 0,
            effect_views: [0; MAX_EFFECTS],
            effect_joins: EffectJoins::default(),
            effect_units: [Unit::default(); MAX_EFFECTS],
            unit_count: 0,
            folded: None,
            effect_textures: CompileCache::default(),
            effect_clock: [0.0; 2],
            inverse_projection: None,
            dof_pass: None,
            dof_ids: ids.dof,
            dof: None,
            dof_built: false,
            dof_declared: false,
            dof_textures: CompileCache::default(),
            subsurface_pass: None,
            subsurface_ids: ids.subsurface,
            subsurface: None,
            subsurface_objects: false,
            subsurface_built: false,
            subsurface_declared: false,
            subsurface_textures: CompileCache::default(),
            exposure_pass: None,
            exposure_ids: ids.exposure,
            exposure: None,
            exposure_built: false,
            fog_pass: None,
            fog_ids: ids.fog,
            fog: None,
            fog_built: false,
            fog_declared: 0,
            fog_textures: CompileCache::default(),
            ao_pass: None,
            ao_ids: ids.ao,
            ao: None,
            contact: None,
            ao_scale: ao::MAX_SCALE,
            projection: ([0.0; 16], [0.0; 16]),
            ssr_pass: None,
            ssr_ids: ids.ssr,
            ssr: None,
            ssr_scale: ao::MAX_SCALE,
            ssr_built: false,
            last_view: None,
            views: 0,
            debug_lines: None,
            transparent: Vec::new(),
            transparent_on: false,
            transmission: TransmissionCopy::new(ids.transmission),
            transmission_wanted: false,
            transmission_built: false,
            transmission_declared: false,
            transmission_target: CompileCache::default(),
            motion_allowed: (true, true),
            motion_view: false,
            motion_frame: None,
            motion_step: MotionView::new(ids.motion),
            motion_view_built: false,
            motion_declared: false,
            weighted: WeightedLayer::new(ids.weighted),
            weighted_targets: true,
            weighted_wanted: false,
            weighted_built: false,
            weighted_declared: false,
            weighted_textures: CompileCache::default(),
            decals_wanted: false,
            redraws_wanted: false,
            decals_declared: false,
            particle_depth: ParticleDepthCopy::new(ids.particle_depth),
            particle_depth_wanted: false,
            particle_depth_built: false,
            particle_depth_declared: false,
            particle_depth_target: CompileCache::default(),
            material_scene: ids.material_scene,
            blank_scene_depth: ids.blank_scene_depth,
            material_scene_bound: 0,
            material_scene_has_blank: false,
            material_scene_wanted: false,
            material_scene_ready: false,
            probe_filter: None,
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
            final_pass: FinalPass::new(ids.final_pass, scene_color, antialias)
                .presents(ids.present_group),
            output_pass: FinalPass::new(ids.output_pass, scene_color, antialias).resolve(),
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
            transparent,
        } = canvas;
        self.scene_color = scene_color;
        self.canvas_alpha = transparent;
        self.samples = antialias.samples();
        self.resolves = !scene_color.is_hdr() && antialias == Antialias::Msaa;
        self.final_pass.set_mode(scene_color, antialias);
        self.output_pass.set_mode(scene_color, antialias);
        self.still_pass
            .set_mode(scene_color, still_antialias(antialias));
        self.make_bloom_pass();
        // Effects run on HDR color only, and read the depth's samples, which the new mode may
        // change.
        self.effect_pass = scene_color
            .is_hdr()
            .then(|| EffectPass::new(self.effect_ids, self.gpu_culling && self.samples > 1));
        // The full-screen passes draw into targets of the view targets' format, which the new mode
        // may change, and read the depth's samples.
        self.fullscreen = FullscreenPasses::new(
            self.fullscreen_ids,
            view_target_format(scene_color),
            self.gpu_culling && self.samples > 1,
        );
        self.effect_count = 0;
        self.effect_depths = 0;
        self.effect_views = [0; MAX_EFFECTS];
        self.unit_count = 0;
        self.folded = None;
        self.effect_textures.clear();
        // The depth step reads the depth's samples, which the new mode may change, as depth of
        // field's steps do.
        self.ao_pass = None;
        self.dof_pass = None;
        self.dof_built = false;
        // The meter reads HDR color only.
        if !scene_color.is_hdr() {
            self.exposure = None;
        }
        self.fog_pass = None;
        self.fog_built = false;
        // The copy's target takes the scene color's format, which its pipeline draws into, and the
        // depth copy reads the depth's samples.
        self.transmission_built = false;
        self.particle_depth_built = false;
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
    /// occlusion's steps run or screen-space reflections draw, as they read the prepass's depth.
    pub(crate) fn depth_prepass(&self) -> bool {
        self.prepass || self.screen_steps() || self.ssr.is_some()
    }

    /// True while ambient occlusion's steps run: while ambient occlusion or contact shadows draw.
    fn screen_steps(&self) -> bool {
        self.ao.is_some() || self.contact.is_some()
    }

    /// Sets ambient occlusion's settings and the main directional light's contact shadows for the
    /// next frames, each `None` while it draws nothing, with the camera's projection and its
    /// inverse in `lens`, and the size of ambient occlusion's targets as a share of the render
    /// size. Contact shadows run ambient occlusion's steps. The passes are declared again only
    /// when the steps start or stop.
    pub(crate) fn set_ao(
        &mut self,
        ao: Option<Ao>,
        contact: Option<Contact>,
        lens: Option<(Mat4, Mat4)>,
        scale: f32,
    ) {
        let (ao, contact) = match lens {
            Some(projection) => {
                self.projection = projection;
                (ao, contact)
            }
            None => (None, None),
        };
        let was = self.screen_steps();
        self.ao = ao;
        self.contact = contact;
        if self.screen_steps() != was {
            self.declared = false;
        }
        self.ao_scale = scale;
    }

    /// The draw list's id of the screen texture that the camera's opaque pass reads ambient
    /// occlusion, contact shadows and screen-space reflections from: the last target of ambient
    /// occlusion's steps while they draw, else the trace's target while reflections draw, else
    /// `None`. Valid once the frame's
    /// [`FrameGraph::prepare`] made the plan's textures.
    pub(crate) fn ao_texture(&self) -> Option<u32> {
        self.screen_target().and_then(|name| self.sampled_id(name))
    }

    /// The name of the screen texture's last target, which the camera's opaque pass reads, or
    /// `None` while neither ambient occlusion's steps nor screen-space reflections draw.
    fn screen_target(&self) -> Option<&'static str> {
        if self.screen_draws() {
            Some(AO_TARGETS[ao::STEPS - 1])
        } else if self.ssr_draws() {
            Some(SSR_TARGETS[ssr::STEPS - 1])
        } else {
            None
        }
    }

    /// The screen texture's grid as a share of the render size: the largest scale of the features
    /// that draw on it.
    fn screen_scale(&self) -> f32 {
        let ao = if self.screen_draws() {
            self.ao_scale
        } else {
            0.0
        };
        let ssr = if self.ssr_draws() {
            self.ssr_scale
        } else {
            0.0
        };
        ao.max(ssr)
    }

    /// Turns screen-space reflections on with what their trace draws with, and the size of their
    /// grid as a share of the render size, or off with `None`, for the next frames. The passes are
    /// declared again only when they turn on or off.
    pub(crate) fn set_ssr(&mut self, frame: Option<TraceFrame>, scale: f32) {
        if frame.is_some() != self.ssr.is_some() {
            self.declared = false;
        }
        self.ssr = frame;
        self.ssr_scale = scale.clamp(0.0, ao::MAX_SCALE);
        if frame.is_none() {
            self.last_view = None;
        }
    }

    /// True while screen-space reflections draw: the sketch turned them on, and their pipelines
    /// are built. Until then the prepass runs, so its pipelines build too.
    pub(crate) fn ssr_draws(&self) -> bool {
        self.ssr.is_some() && self.ssr_built
    }

    /// True while the frame copies the camera's opaque color: for surfaces that let light through,
    /// or for screen-space reflections, which read it in the next frame.
    fn copy_wanted(&self) -> bool {
        self.transmission_wanted || self.ssr.is_some()
    }

    /// Writes the screen texture's grid and screen-space reflections' values into the camera's
    /// frame values: the reflections read the copy that the frame before made, through its view.
    /// `eye` is this frame's camera position in the world. It then keeps this frame's view, whose
    /// copy the next frame reads. Call it once a frame, after [`FrameGraph::prepare`].
    pub(crate) fn write_screen_values(&mut self, uniform: &mut FrameUniform, eye: [f64; 3]) {
        if self.screen_draws() || self.ssr_draws() {
            let strength = if self.screen_draws() {
                uniform.occlusion[0]
            } else {
                0.0
            };
            let [height, across, down] =
                ao::grid_values(self.canvas, self.scale, self.screen_scale());
            uniform.occlusion = [strength, height, across, down];
        }
        let copy = self.ssr_draws().then(|| self.copy_texture()).flatten();
        let last = match (&self.last_view, copy) {
            (Some((view, made)), Some(now)) if *made == now => Some(view),
            _ => None,
        };
        ssr::write_frame_values(uniform, self.ssr.map(|frame| frame.ssr), last, eye);
        self.last_view = copy.map(|made| {
            let view = LastView {
                view_proj: uniform.view_proj,
                eye,
                drawn: Size::Full.viewport(self.canvas, self.scale),
            };
            (view, made)
        });
    }

    /// The color copy's texture as the draw lists made it, while the plan has the copy.
    fn copy_texture(&self) -> Option<MadeTexture> {
        if !self.transmission_declared {
            return None;
        }
        let id = self.sampled_id(TRANSMISSION_COLOR)?;
        self.made
            .get(id.checked_sub(self.first_texture)? as usize)
            .copied()
    }

    /// True while ambient occlusion's steps draw: the sketch turned ambient occlusion or the
    /// sun's contact shadows on, and the pipelines of the steps that run are built. Until then the
    /// prepass runs, so its pipelines build too, and the opaque pass reads neither.
    pub(crate) fn screen_draws(&self) -> bool {
        self.screen_steps() && self.ao_built
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

    /// What the decal pass's pipelines draw into: the scene color alone, as the scene's pipelines
    /// draw it, and on WebGPU the bit that reads sample 0 of a multisampled depth. WebGL2 reads a
    /// copy of one sample.
    pub(crate) fn decal_targets(&self) -> PassTargets {
        let scene = self.scene_targets();
        let multisampled = if self.decal_depth_multisampled() {
            permutation::DEPTH_MULTISAMPLED
        } else {
            0
        };
        PassTargets {
            depth_format: format::NONE,
            permutation: scene.permutation | multisampled,
            ..scene
        }
    }

    /// True when the decal pass reads a multisampled depth texture: on WebGPU with MSAA.
    pub(crate) fn decal_depth_multisampled(&self) -> bool {
        self.gpu_culling && self.samples > 1
    }

    /// Turns the decal pass on while some object is a decal, and off otherwise, for the next
    /// frames, with its redraw of the objects on the layers that decals skip while `redraws`. The
    /// passes are declared again only when either changes.
    pub(crate) fn set_decals(&mut self, on: bool, redraws: bool) {
        let redraws = on && redraws;
        if on != self.decals_wanted || redraws != self.redraws_wanted {
            self.decals_wanted = on;
            self.redraws_wanted = redraws;
            self.declared = false;
        }
    }

    /// The draw list's id of the scene depth that the decal pass reads, or `None` while it does
    /// not run. Valid once the frame's [`FrameGraph::prepare`] made the plan's textures.
    pub(crate) fn decal_depth(&self) -> Option<u32> {
        self.decals_declared
            .then(|| self.sampled_id(SCENE_DEPTH))
            .flatten()
    }

    /// Bytes that one frame may copy into its arena for the graph's own passes. The final pass can
    /// start to run in any frame, once the render scale can drop.
    pub(crate) fn upload_bound(&self) -> usize {
        let bloom = if self.bloom_pass.is_some() {
            BloomPass::UPLOAD_BYTES
        } else {
            0
        };
        let ao = if self.screen_draws() || self.ssr_draws() {
            AoPass::UPLOAD_BYTES
        } else {
            0
        };
        let ssr = if self.ssr_draws() {
            SsrPass::UPLOAD_BYTES
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
        let subsurface = if self.subsurface.is_some() {
            SubsurfacePass::UPLOAD_BYTES
        } else {
            0
        };
        let motion = if self.motion_view {
            motion::VIEW_UPLOAD_BYTES
        } else {
            0
        };
        let fog = if self.fog.is_some() {
            FogVolumePass::UPLOAD_BYTES
        } else {
            0
        };
        let fullscreen = if self.fullscreen_views != 0 {
            FullscreenPasses::UPLOAD_BYTES
        } else {
            0
        };
        let exposure = if self.exposure.is_some() {
            ExposurePass::UPLOAD_BYTES
        } else {
            0
        };
        let still = if self.still_declared {
            accumulate::UPLOAD_BYTES + FinalPass::UPLOAD_BYTES
        } else {
            0
        };
        FinalPass::UPLOAD_BYTES
            + still
            + if self.two_step_declared {
                FinalPass::UPLOAD_BYTES
            } else {
                0
            }
            + bloom
            + ao
            + ssr
            + effects
            + dof
            + subsurface
            + motion
            + fog
            + fullscreen
            + exposure
    }

    /// True when the final pass takes the scene color to the canvas, and false when the resolve
    /// pass does. The resolve pass resolves the scene color into the canvas alone, so the copy
    /// for surfaces that let light through, which reads it before the transparent pass, needs the
    /// final pass, and so does a full-screen pass that reads the scene color.
    fn final_runs(&self) -> bool {
        !self.resolves
            || self.scales
            || self.grades
            || self.fullscreen_reads_color
            || self.outline_draws()
            || self.transmission_declared
            || self.particle_depth_declared
    }

    /// Says whether the render scale may drop below the whole canvas. Where the scene could
    /// resolve into the canvas, that switches the final pass on in place of the resolve pass, and
    /// the graph compiles again.
    pub(crate) fn set_scaling(&mut self, scales: bool) {
        if scales != self.scales {
            // The declarations hold the two-step pass only while the render scale can drop below
            // the whole canvas, so a change declares them again. This is a sketch setting, so it
            // changes rarely, never in a frame loop.
            self.scales = scales;
            self.redeclare();
        }
        self.enable_outputs();
    }

    /// Declares the passes again from the last views, for a change that only the declarations
    /// follow, such as the render scale's range changing. It allocates, so it stays off the frame
    /// loop: a frames' render scale changing must not declare anything again.
    fn redeclare(&mut self) {
        if self.declared_views.is_empty() {
            self.declared = false;
        } else {
            let views = self.declared_views.clone();
            let names = self.declared_names.clone();
            self.declare(&views, &names);
        }
    }

    /// True when the frame draws the two-step pass: the render scale can drop below the whole
    /// canvas, the frame draws below it, and the second step's pipeline is built. The declarations
    /// hold the pass whenever the render scale can drop, so a crossing changes only this answer and
    /// declares nothing again.
    fn two_step_runs(&self) -> bool {
        self.two_step_declared && self.two_step_built && self.scale != RenderScale::FULL
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
        let two_step = self.two_step_declared;
        if let Some(Outputs {
            resolve,
            finals,
            output,
        }) = self.outputs
        {
            let final_runs = self.final_runs();
            self.graph.set_enabled(resolve, !final_runs);
            for (bloom, passes) in finals.into_iter().enumerate() {
                for (outline, pass) in passes.into_iter().enumerate() {
                    if let Some(pass) = pass {
                        // At the whole canvas's scale the final pass draws as it does without the
                        // two-step pass. Below it the same pass draws the second step.
                        let on = final_runs && blooms == (bloom == 1) && outlines == (outline == 1);
                        self.graph.set_enabled(pass, on);
                    }
                }
            }
            // The first step draws the scene's display color at the render size, with the bloom.
            for (bloom, pass) in output.into_iter().enumerate() {
                if let Some(pass) = pass {
                    self.graph
                        .set_enabled(pass, final_runs && two_step && blooms == (bloom == 1));
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
        // A full-screen pass reads the mask only while it is drawn, so the passes are declared
        // again when that changes.
        if self.fullscreen_views != 0 && self.outline_draws() != self.fullscreen_outline {
            self.declared = false;
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
        let mut views = [0; MAX_EFFECTS];
        for (mask, effect) in views.iter_mut().zip(&effects[..count]) {
            *mask = effect.maps.views;
        }
        if count != self.effect_count || depths != self.effect_depths || *joins != self.effect_joins
        {
            self.effect_count = count;
            self.effect_depths = depths;
            self.effect_joins = *joins;
            self.plan_effects(|_| false, None);
        }
        if views != self.effect_views {
            self.effect_views = views;
            self.declared = false;
        }
        self.effects[..count].copy_from_slice(&effects[..count]);
        self.effect_clock = clock;
        self.inverse_projection = projection.map(|(_, inverse)| inverse);
    }

    /// Takes the values of the custom effects and the full-screen passes of `effects` and `views`
    /// for the frame's uploads, as the frame's texture work left their textures' layers. The passes
    /// themselves stay as they were declared.
    pub(crate) fn set_post_values(&mut self, effects: &[Effect], views: &[View]) {
        let count = self.effect_count;
        for (own, given) in self.effects[..count].iter_mut().zip(effects) {
            own.values = given.values;
        }
        for (own, given) in self.declared_views.iter_mut().zip(views) {
            if let (Some(own), Some(given)) = (own.fullscreen_pass_mut(), given.fullscreen_pass()) {
                own.values = given.values;
            }
        }
    }

    /// Makes the final pass draw with the custom tone curve whose pipelines take the templates from
    /// `template` on, or with its own curves with `None`, from the next frame on.
    pub(crate) fn set_tone_curve(&mut self, template: Option<u32>) {
        self.final_pass.set_tone_curve(template);
        // The two-step pass's first step runs the tone curve below the whole canvas's scale.
        self.output_pass.set_tone_curve(template);
        self.still_pass.set_tone_curve(template);
    }

    /// The resource that holds the scene's lit color: the subsurface blur's copy while its passes
    /// are declared, or else the scene color. The volumetric fog's apply step reads it.
    fn lit_output(&self) -> &'static str {
        if self.subsurface_declared {
            SUBSURFACE_TARGETS[subsurface::STEPS - 1]
        } else {
            SCENE_COLOR
        }
    }

    /// The resource that holds the scene's color before the custom effects: the volumetric fog's
    /// target while its steps are declared, or else the lit color. The custom effects read it.
    fn scene_output(&self) -> &'static str {
        if self.fog_declared > 0 {
            FOG_COLOR
        } else {
            self.lit_output()
        }
    }

    /// The resource that holds the scene's color after the custom effects' passes: the last unit's
    /// target, or the scene's output without one. Depth of field reads it.
    fn effects_output(&self) -> &'static str {
        match self.unit_count {
            0 => self.scene_output(),
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

    /// Turns automatic exposure on with what the frame meters with, or off with `None`, for the
    /// next frames. The plan stays as it is: the meter records its own steps. The 8-bit path draws
    /// no automatic exposure.
    pub(crate) fn set_exposure(&mut self, exposure: Option<ExposureFrame>) {
        self.exposure = exposure.filter(|_| self.scene_color.is_hdr());
    }

    /// True while the meter runs: the sketch turned automatic exposure on, on the HDR path, and the
    /// meter's pipelines are built. Until then the final pass keeps the camera's exposure.
    pub(crate) fn exposure_draws(&self) -> bool {
        self.exposure.is_some() && self.exposure_built
    }

    /// The meter, made when first asked for.
    fn exposure_meter(&mut self) -> &mut ExposurePass {
        let rows_from_bottom = !self.gpu_culling;
        self.exposure_pass
            .get_or_insert_with(|| ExposurePass::new(self.exposure_ids, rows_from_bottom))
    }

    /// Records the creation of the meter's compute pipelines in the list of `frame`, while the
    /// sketch turns automatic exposure on and its meter is the histogram. Call it before
    /// [`FrameGraph::request_pipelines`]. Returns true when it recorded them.
    pub(crate) fn create_exposure_pipelines(
        &mut self,
        list: &mut DrawList,
        frame: u32,
    ) -> Result<bool, RecordError> {
        let Some(exposure) = self.exposure else {
            return Ok(false);
        };
        let meter = self.exposure_meter();
        if meter.path(exposure.meter) != crate::exposure::Meter::Histogram {
            return Ok(false);
        }
        meter.create_compute_pipelines(list, frame)
    }

    /// True while depth of field draws: the sketch turned it on on the HDR path, and its pipelines
    /// are built. Until then the frames draw without it.
    pub(crate) fn dof_draws(&self) -> bool {
        self.dof.is_some() && self.dof_built
    }

    /// Turns the volumetric fog on with what the frame draws it with, or off with `None`, for the
    /// next frames. The passes are declared again only when it starts or stops drawing, or its
    /// grid's textures change size, so a moving camera changes only the steps' block. The 8-bit
    /// path draws no volumetric fog.
    pub(crate) fn set_fog_volume(&mut self, fog: Option<FogVolumeFrame>) {
        let was = self.fog_draws();
        self.fog = fog.filter(|_| self.scene_color.is_hdr());
        let slices = self.fog.map_or(0, |fog| fog.slices);
        if self.fog_draws() != was || (self.fog_declared > 0 && slices != self.fog_declared) {
            self.declared = false;
        }
        if !self.fog_draws()
            && let Some(pass) = self.fog_pass.as_mut()
        {
            pass.forget_history();
        }
    }

    /// True while the volumetric fog draws: the sketch turned it on on the HDR path, and its
    /// pipelines are built. Until then the frames draw the fog with its sun glow.
    pub(crate) fn fog_draws(&self) -> bool {
        self.fog.is_some() && self.fog_built
    }

    /// The volumetric fog's steps, made for the scene depth's samples when first asked for, as
    /// depth of field's are.
    fn fog_steps(&mut self) -> &mut FogVolumePass {
        let samples = if self.gpu_culling { self.samples } else { 1 };
        let rows_from_bottom = !self.gpu_culling;
        self.fog_pass
            .get_or_insert_with(|| FogVolumePass::new(self.fog_ids, samples, rows_from_bottom))
    }

    /// The volumetric fog's steps, which exist while their passes are declared.
    fn fog_steps_ref(&self) -> &FogVolumePass {
        self.fog_pass
            .as_ref()
            .expect("the volumetric fog's steps run once they are declared")
    }

    /// Depth of field's steps, made for the scene depth's samples when first asked for. WebGL2 has
    /// no multisampled textures: its backend gives the steps a copy of one sample.
    fn dof_steps(&mut self) -> &mut DofPass {
        let samples = if self.gpu_culling { self.samples } else { 1 };
        let rows_from_bottom = !self.gpu_culling;
        self.dof_pass
            .get_or_insert_with(|| DofPass::new(self.dof_ids, samples, rows_from_bottom))
    }

    /// Turns the subsurface blur on with what the frame draws it with, or off with `None`, for the
    /// next frames, while `objects` says that some object's material has a scatter radius. The
    /// passes are declared again only when the blur starts or stops drawing, so a moving camera
    /// changes only the steps' blocks. The 8-bit path draws no blur.
    pub(crate) fn set_subsurface(&mut self, frame: Option<SubsurfaceFrame>, objects: bool) {
        let was = self.subsurface_draws();
        self.subsurface = frame.filter(|_| self.scene_color.is_hdr());
        self.subsurface_objects = objects;
        if self.subsurface_draws() != was {
            self.declared = false;
        }
    }

    /// True while the blur is wanted: the quality setting gives it taps on the HDR path, and some
    /// object's material has a scatter radius.
    fn subsurface_wanted(&self) -> bool {
        self.subsurface.is_some() && self.subsurface_objects
    }

    /// True while the subsurface blur draws: it is wanted, and its steps' pipelines are built.
    /// Until then the frames draw without it.
    pub(crate) fn subsurface_draws(&self) -> bool {
        self.subsurface_wanted() && self.subsurface_built
    }

    /// What the skin pass's pipelines draw into: its light's format and its own depth, of one
    /// sample.
    pub(crate) fn skin_targets(&self) -> PassTargets {
        PassTargets {
            color_format: subsurface::SKIN_FORMAT,
            depth_format: DEPTH_FORMAT,
            samples: 1,
            permutation: 0,
        }
    }

    /// The subsurface blur's steps, made for the scene depth's samples when first asked for.
    /// WebGL2 has no multisampled textures: its backend gives the down step a copy of one sample.
    fn subsurface_steps(&mut self) -> &mut SubsurfacePass {
        let samples = if self.gpu_culling { self.samples } else { 1 };
        let rows_from_bottom = !self.gpu_culling;
        let ids = self.subsurface_ids;
        self.subsurface_pass
            .get_or_insert_with(|| SubsurfacePass::new(ids, samples, rows_from_bottom))
    }

    /// Plans the effects' passes: the units of the effects before `fold`, with each group whose
    /// pipeline `built` says is built as one. When the plan changes, the passes are declared again.
    fn plan_effects(&mut self, built: impl Fn(usize) -> bool, fold: Option<usize>) {
        let mut units = [Unit::default(); MAX_EFFECTS];
        // The sketch's joins run at every render scale: a joined group draws one pass, and the two
        // steps read its target as the one final pass reads it. Folding is another matter: an
        // effect may fold only while the frame draws at the whole canvas (`may_fold`), and the
        // declarations hold the two-step pass for the whole time the render scale can drop, so a
        // fold would declare the passes again at each crossing of the whole canvas's scale. A
        // crossing allocates nothing, so a sketch whose scale can drop does not fold.
        let fold = fold.filter(|_| !self.two_step_declared);
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
            self.effect_textures.clear();
            self.declared = false;
        }
    }

    /// True when the effects from `first` on can fold into the final pass now: no bloom or FXAA
    /// reads the image between them, the frame draws at the whole canvas, so the final pass reads
    /// high dynamic range color, and the render scale cannot drop, so the two-step pass is not
    /// declared and the plan does not change when the frame's scale does.
    fn may_fold(&self) -> bool {
        !self.bloom_wanted()
            && self.dof.is_none()
            && !self.final_pass.fxaa()
            && !self.two_step_declared
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
        self.bloom_textures.clear();
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
            (
                view.is_removed(),
                size,
                target.shown,
                target.reads,
                target.rect.is_some(),
            )
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
        for &(index, pass) in self.opaque.iter().chain(&self.prepasses) {
            self.graph
                .set_layers(pass, views[usize::from(index)].layers());
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

    /// Says whether the device draws the motion target with one sample, and with MSAA's samples.
    /// Where it does not draw it at the scene's samples, the motion debug view shows the camera's
    /// motion alone, and no motion pass runs.
    pub(crate) fn allow_motion(&mut self, one_sample: bool, multisampled: bool) {
        if (one_sample, multisampled) != self.motion_allowed {
            self.motion_allowed = (one_sample, multisampled);
            self.declared = false;
        }
    }

    /// Says whether the device draws into one-sample targets of 16-bit floats, which the camera's
    /// weighted layer needs. Without them, weighted surfaces draw back to front in the transparent
    /// pass, as surfaces of normal blending.
    pub(crate) fn set_weighted_targets(&mut self, supported: bool) {
        self.weighted_targets = supported;
    }

    /// The targets of the camera's weighted layer, for the pipelines of a pass whose targets are
    /// `scene`, or `None` where the device cannot draw the layer.
    pub(crate) fn weighted_targets(&self, scene: PassTargets) -> Option<PassTargets> {
        self.weighted_targets.then_some(PassTargets {
            color_format: weighted::SUM_FORMAT,
            depth_format: DEPTH_FORMAT,
            samples: 1,
            ..scene
        })
    }

    /// Turns the camera's weighted layer on while some sorted bucket has its pipeline, and off
    /// otherwise, for the next frames. The passes are declared again only when the layer starts or
    /// stops drawing. Call it before [`FrameGraph::request_pipelines`], which asks for the layer's
    /// own pipelines.
    pub(crate) fn set_weighted(&mut self, on: bool) {
        let was = self.weighted_draws();
        self.weighted_wanted = on && self.weighted_targets;
        if self.weighted_draws() != was {
            self.declared = false;
        }
    }

    /// Turns the copy of the camera's opaque depth on while a particle system fades near the
    /// surfaces behind it or a custom material reads the scene's depth, and off otherwise, as
    /// [`FrameGraph::set_transmission`] turns its copy. `materials` says whether a custom material
    /// reads it, which makes the groups that those materials bind.
    pub(crate) fn set_soft_particles(&mut self, on: bool, materials: bool) {
        let was = self.particle_depth_draws();
        self.particle_depth_wanted = on;
        self.material_scene_wanted = materials;
        if self.particle_depth_draws() != was {
            self.declared = false;
        }
    }

    /// True when the device draws the motion target at the scene's samples.
    fn motion_supported(&self) -> bool {
        if self.samples > 1 {
            self.motion_allowed.1
        } else {
            self.motion_allowed.0
        }
    }

    /// Shows the motion debug view or not, for the next frames, with the camera's move of the
    /// frame being recorded. The passes are declared again only when the view starts or stops
    /// drawing. Call it before [`FrameGraph::request_pipelines`], which asks for the step's
    /// pipeline, so the view draws from the frame in which the pipeline is built.
    pub(crate) fn set_motion(&mut self, view: bool, frame: Option<MotionFrame>) {
        let was = self.motion_view_draws();
        self.motion_view = view;
        self.motion_frame = frame;
        if self.motion_view_draws() != was {
            self.declared = false;
        }
    }

    /// True while the motion debug view draws: it shows, and its step's pipeline is built.
    fn motion_view_draws(&self) -> bool {
        self.motion_view && self.motion_view_built
    }

    /// True while the motion pass runs: a pass reads the motion target, and the device draws it.
    pub(crate) fn motion_draws(&self) -> bool {
        self.motion_declared && self.motion_supported()
    }

    /// What the motion pass's pipelines and bundles draw into: the motion target's format, the
    /// depth format and the scene's sample count.
    pub(crate) fn motion_targets(&self) -> PassTargets {
        PassTargets {
            color_format: motion::FORMAT,
            depth_format: DEPTH_FORMAT,
            samples: self.samples,
            permutation: 0,
        }
    }

    /// True while the camera's weighted layer draws: some sorted bucket has its pipeline, and the
    /// layer's own pipelines are built. Until then weighted surfaces draw back to front in the
    /// transparent pass.
    pub(crate) fn weighted_draws(&self) -> bool {
        self.weighted_wanted && self.weighted_built
    }

    /// True when the declared passes hold the camera's weighted layer, so the camera's
    /// transparent pass leaves weighted buckets to the weighted pass.
    pub(crate) fn weighted_declared(&self) -> bool {
        self.weighted_declared
    }

    /// True when the camera's weighted layer copies one sample of a multisampled scene depth,
    /// which it then tests against.
    fn weighted_copies_depth(&self) -> bool {
        self.samples > 1
    }

    /// True while the copy of the camera's opaque depth draws: a particle system or a material
    /// wants it, and its pipeline is built.
    fn particle_depth_draws(&self) -> bool {
        self.particle_depth_wanted && self.particle_depth_built
    }

    /// The draw list's id of the copy of the camera's opaque depth while it draws, which the
    /// camera's particle systems bind. Valid once the frame's [`FrameGraph::prepare`] made the
    /// plan's textures.
    pub(crate) fn particle_depth_texture(&self) -> Option<u32> {
        if !self.particle_depth_declared {
            return None;
        }
        self.particle_depth_target
            .last()
            .flatten()
            .map(|(_, target)| target)
    }

    /// The bind group that a draw in `view` binds for a custom material that reads the scene's
    /// depth: the copy of the camera's opaque depth in the camera's view, or the blank texel in
    /// another view. 0 while no material reads the depth.
    pub(crate) fn material_scene_group(&self, view: ViewId) -> u32 {
        if !self.material_scene_ready {
            return 0;
        }
        let first = self.material_scene;
        if view == ViewId::CAMERA {
            first + 1
        } else {
            first
        }
    }

    /// The bind group that a draw binds for its material's scene inputs before the copy exists:
    /// one texel at the far plane. 0 while no material reads the depth.
    pub(crate) fn material_scene_blank(&self) -> u32 {
        if self.material_scene_ready {
            self.material_scene
        } else {
            0
        }
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
        for &(index, pass) in &self.transparent {
            let on = self
                .view_on
                .get(usize::from(index))
                .copied()
                .unwrap_or(true);
            self.graph.set_enabled(pass, on && self.transparent_on);
        }
    }

    /// True when a view culls in two phases against its depth pyramid: with occlusion culling,
    /// for a view that draws at the render size. A view with a target size of its own, a mirror
    /// view, or a view that draws into a rectangle of the canvas culls once, since its depth
    /// covers part of a target only.
    fn view_occludes(&self, view: &View, index: usize) -> bool {
        let full = view.target().graph_size() == Size::Full
            && view.mirrored().is_none()
            && view.canvas_rect().is_none();
        self.occlusion() && (index == ViewId::CAMERA.index() || full)
    }

    /// The draw list's id of the texture that materials sample a view's target from, or `None`
    /// for the camera's view, or a target that the plan gives no texture. Valid once the frame's
    /// [`FrameGraph::prepare`] made the plan's textures.
    pub(crate) fn view_target(&self, view: ViewId) -> Option<u32> {
        let fullscreen = self.fullscreen_views & (1 << view.index()) != 0;
        if self.view_copies.is_some() && !self.view_copy_built && !fullscreen {
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
            .find_map(|&pass| role_view(self.roles[pass.index()]))
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
        if self.ssr_draws() && !views.is_empty() {
            // Screen-space reflections read the color copy that the frame before made.
            let target = Target::color(self.copy_format()).mipmapped();
            let size = view_size(&views[ViewId::CAMERA.index()]);
            self.graph.keep(TRANSMISSION_COLOR, target, size);
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
        // A full-screen pass draws its target whole, with one sample, on both paths.
        let one_sample = Target::color(self.view_target_format()).array().shown();
        self.fullscreen_views = 0;
        for (index, view) in views.iter().enumerate().skip(1) {
            let size = view_size(view);
            let fullscreen = view.fullscreen_pass().is_some() && !view.is_removed();
            self.fullscreen_views |= u32::from(fullscreen) << index;
            if view.canvas_rect().is_some() {
                // The view draws into the camera's scene color, so it has no target to sample.
                self.view_colors.push(None);
                continue;
            }
            let shape = if fullscreen { one_sample } else { kept };
            let target = self.graph.keep(named[index].color.clone(), shape, size);
            self.view_colors.push(Some(target));
        }
        self.fullscreen_outline = self.outline_draws();
        self.fullscreen_reads_color = views.iter().enumerate().any(|(index, view)| {
            self.fullscreen_views & (1 << index) != 0
                && view
                    .fullscreen_pass()
                    .is_some_and(|pass| pass.source == PassSource::SceneColor)
        });
        if self.gpu_culling {
            self.graph.import_buffer(LIGHTS);
            let clusters = Pass::new("LightClusters", PassKind::Compute)
                .reads(LIGHTS)
                .creates_buffer(LIGHT_GRID);
            self.add(clusters, Role::LightClusters);
            self.graph.import_buffer(OBJECTS);
            for (index, names) in named.iter().enumerate() {
                if self.fullscreen_views & (1 << index) != 0 {
                    continue;
                }
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
        // The opaque passes of views that draw into rectangles of the canvas, added after the
        // camera's passes so that each image lies over the camera's.
        let mut canvas_views = Vec::new();
        for (index, view) in views.iter().enumerate() {
            let id = ViewId::from_index(index);
            let names = &named[index];
            let size = view_size(view);
            let camera = id == ViewId::CAMERA;
            if let Some(fullscreen) = view
                .fullscreen_pass()
                .filter(|_| self.fullscreen_views & (1 << index) != 0)
            {
                self.pyramid_depths.push(None);
                self.declare_fullscreen(view, fullscreen, names, index);
                continue;
            }
            let canvas = view.canvas_rect().is_some() && !view.is_removed();
            let mut pass = Pass::new(names.opaque.clone(), PassKind::Scene)
                .size(size)
                .layers(view.layers());
            pass = if camera {
                pass.creates(SCENE_COLOR, color)
            } else if canvas {
                pass.writes(SCENE_COLOR)
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
                let screen = if camera { self.screen_target() } else { None };
                if screen.is_some() {
                    // The screen's steps give the prepass a render pass of its own, and none of
                    // them reads this color. WebGL2 therefore starts it from what the texture
                    // holds, which costs less than a clear of the whole canvas.
                    prepass = if self.gpu_culling {
                        prepass.creates(PREPASS_COLOR, color)
                    } else {
                        prepass.creates_overwriting(PREPASS_COLOR, color)
                    };
                }
                prepass = reads_targets(prepass, views, &named, index);
                let prepass = if canvas {
                    prepass
                } else {
                    optional_beyond_camera(prepass, index)
                };
                let prepass = self.add(prepass, Role::Prepass(id));
                self.prepasses.push((index as u16, prepass));
                self.view_passes.push((index as u16, prepass));
                if let Some(target) = screen {
                    self.declare_screen();
                    pass = pass.reads(target);
                }
                if camera && self.ssr_draws() {
                    // The opaque pass reads the color copy as the frame before left it.
                    pass = pass.reads_so_far(TRANSMISSION_COLOR);
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
            if canvas {
                canvas_views.push((index, pass));
                continue;
            }
            let pass = optional_beyond_camera(pass, index);
            let pass = self.add(pass, Role::Opaque(id));
            self.opaque.push((index as u16, pass));
            self.view_passes.push((index as u16, pass));
        }
        self.declare_pick(views);
        self.decals_declared = self.decals_wanted && !views.is_empty();
        if self.decals_declared {
            // Decals read the depth that the camera's opaque pass leaves, and draw over its color
            // before the debug lines and the passes that copy or blend over it.
            let decals = Pass::new(DECALS_PASS, PassKind::Scene)
                .size(view_size(&views[ViewId::CAMERA.index()]))
                .reads_so_far(SCENE_DEPTH)
                .writes(SCENE_COLOR);
            self.add(decals, Role::Decals);
            if self.redraws_wanted {
                // The objects that decals skip draw again over their own pixels, with the depth
                // test, in the render pass of the debug lines and the transparent pass.
                let redraw = Pass::new(DECAL_REDRAW_PASS, PassKind::Scene)
                    .size(view_size(&views[ViewId::CAMERA.index()]))
                    .writes(SCENE_COLOR)
                    .writes(SCENE_DEPTH);
                self.add(redraw, Role::DecalRedraw);
            }
        }
        let lines = Pass::new("DebugLines", PassKind::Scene)
            .writes(SCENE_COLOR)
            .writes(SCENE_DEPTH);
        let lines = self.add(lines, Role::DebugLines);
        self.graph.set_enabled(lines, false);
        self.debug_lines = Some(lines);
        self.transmission_declared =
            (self.transmission_draws() || self.ssr_draws()) && !views.is_empty();
        if self.transmission_declared {
            // The copy reads the scene color and depth as the opaque pass and the debug lines
            // leave them, before the transparent pass draws into them. For screen-space
            // reflections, which the next frame's opaque pass reads from it, it is kept from frame
            // to frame.
            let target = Target::color(self.copy_format()).mipmapped();
            let size = view_size(&views[ViewId::CAMERA.index()]);
            let copy = Pass::new(TRANSMISSION_PASS, PassKind::Fullscreen)
                .size(size)
                .reads_so_far(SCENE_COLOR)
                .reads_so_far(SCENE_DEPTH);
            let copy = if self.ssr_draws() {
                copy.writes(TRANSMISSION_COLOR)
            } else {
                copy.optional().creates(TRANSMISSION_COLOR, target)
            };
            self.add(copy, Role::TransmissionCopy);
        }
        self.particle_depth_declared = self.particle_depth_draws() && !views.is_empty();
        if self.particle_depth_declared {
            // The copy reads the scene depth as the opaque pass and the debug lines leave it.
            let copy = Pass::new(PARTICLE_DEPTH_PASS, PassKind::Fullscreen)
                .optional()
                .size(view_size(&views[ViewId::CAMERA.index()]))
                .reads_so_far(SCENE_DEPTH)
                .creates(PARTICLE_DEPTH, Target::color(DEPTH_COPY_FORMAT));
            self.add(copy, Role::ParticleDepthCopy);
        }
        for (index, view) in views.iter().enumerate() {
            if self.fullscreen_views & (1 << index) != 0 || view.canvas_rect().is_some() {
                continue;
            }
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
            if self.particle_depth_declared && index == ViewId::CAMERA.index() {
                pass = pass.reads(PARTICLE_DEPTH);
            }
            let pass = reads_targets(pass, views, &named, index);
            let pass = optional_beyond_camera(pass, index);
            let pass = self.add(pass, Role::Transparent(ViewId::from_index(index)));
            self.transparent.push((index as u16, pass));
        }
        self.weighted_declared = self.weighted_draws() && !views.is_empty();
        if self.weighted_declared {
            self.declare_weighted(views, &named);
        }
        if copies {
            for (index, view) in views.iter().enumerate().skip(1) {
                if self.fullscreen_views & (1 << index) != 0 || view.canvas_rect().is_some() {
                    self.view_images.push(None);
                    continue;
                }
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
        // Each view that draws into a rectangle of the canvas draws after the camera's passes,
        // into the camera's scene color and a depth of its own. The rectangle's viewport limits
        // its image to the rectangle, which covers the camera's there.
        for (index, opaque) in canvas_views.drain(..) {
            let id = ViewId::from_index(index);
            let names = &named[index];
            let opaque = self.add(opaque, Role::Opaque(id));
            self.opaque.push((index as u16, opaque));
            self.view_passes.push((index as u16, opaque));
            let mut pass = Pass::new(names.transparent.clone(), PassKind::Scene)
                .size(Size::Full)
                .writes(SCENE_COLOR)
                .writes(names.depth.clone());
            pass = reads_targets(pass, views, &named, index);
            let pass = self.add(pass, Role::Transparent(id));
            self.transparent.push((index as u16, pass));
        }
        self.motion_declared = self.motion_view_draws() && !views.is_empty();
        if self.motion_declared {
            self.declare_motion(color.samples);
        }
        self.view_on.clear();
        self.view_on
            .extend(views.iter().map(|view| view.target().draws()));
        self.enable_views();
        self.declare_outline(color.samples);
        self.subsurface_declared = self.subsurface_draws() && !views.is_empty();
        if self.subsurface_declared {
            self.declare_subsurface(views, &named);
        }
        self.fog_declared = if self.fog_draws() {
            self.fog.map_or(0, |fog| fog.slices)
        } else {
            0
        };
        if self.fog_declared > 0 {
            self.declare_fog(self.fog_declared);
        }
        self.declare_effects();
        self.dof_declared = self.dof_draws();
        if self.dof_declared {
            self.declare_dof();
        }
        self.declare_accumulate();
        let resolve = Pass::new("Resolve", PassKind::Resolve)
            .reads(SCENE_COLOR)
            .writes(CANVAS);
        let resolve = self.add(resolve, Role::Resolve);
        // Below the whole canvas's render scale the final pass draws in two steps: the first step
        // draws the scene's display color at the render size into OUTPUT_COLOR, and the plain final
        // pass then scales that up to the canvas.
        self.two_step_declared = self.scales;
        let two_step = self.two_step_declared;
        let output = if two_step {
            [
                Some(self.declare_output(false)),
                self.bloom_pass.is_some().then(|| self.declare_output(true)),
            ]
        } else {
            [None, None]
        };
        // At the whole canvas's scale the final pass reads the scene's color, and below it the
        // first step's target.
        let mut final_pass = Pass::new("Final", PassKind::Fullscreen)
            .size(Size::Canvas)
            .reads(self.color_output())
            .writes(CANVAS);
        if two_step {
            final_pass = final_pass.reads(OUTPUT_COLOR);
        }
        if self.folded.is_some_and(|first| self.folded_depth(first)) {
            final_pass = final_pass.reads(SCENE_DEPTH);
        }
        let final_outline = with_outline(final_pass.clone()).named("FinalOutline");
        let final_pass = self.add(final_pass, Role::Final);
        let final_outline = self.add(final_outline, Role::Final);
        let mut finals = [[Some(final_pass), Some(final_outline)], [None, None]];
        if self.bloom_pass.is_some() {
            let mut final_bloom = self.declare_bloom();
            if two_step {
                final_bloom = final_bloom.reads(OUTPUT_COLOR);
            }
            let final_bloom_outline = with_outline(final_bloom.clone()).named("FinalBloomOutline");
            finals[1] = [
                Some(self.add(final_bloom, Role::FinalBloom)),
                Some(self.add(final_bloom_outline, Role::FinalBloom)),
            ];
        }
        self.outputs = Some(Outputs {
            resolve,
            finals,
            output,
        });
        self.enable_outputs();
        self.views = views.len();
        self.declared = true;
    }

    /// Declares a full-screen pass: one triangle over its whole target, which reads the input
    /// image, the scene's depth and the targets that its textures show. A pass that reads what the
    /// camera's view draws runs after the camera's passes; while a texture shows it and nothing
    /// else reads it, it still runs, so a material shows its image of the frame before. Any other
    /// pass runs only while something reads its target, before the camera's passes that show it.
    fn declare_fullscreen(
        &mut self,
        view: &View,
        fullscreen: &Fullscreen,
        names: &ViewPassNames,
        index: usize,
    ) {
        let mut pass = Pass::new(names.opaque.clone(), PassKind::Fullscreen)
            .size(view_size(view))
            .writes(names.color.clone());
        match fullscreen.source {
            PassSource::SceneColor => pass = pass.reads(SCENE_COLOR),
            PassSource::OutlineMask if self.fullscreen_outline => pass = pass.reads(OUTLINE_MASK),
            _ => {}
        }
        if fullscreen.depth {
            pass = pass.reads(SCENE_DEPTH);
        }
        pass = self.reads_views(pass, fullscreen.maps.views);
        if !(fullscreen.reads_scene() && view.target().shown) {
            pass = pass.optional();
        }
        let pass = self.add(pass, Role::Fullscreen(ViewId::from_index(index)));
        self.view_passes.push((index as u16, pass));
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

    /// Declares the pick's passes while a pick waits: the id pass, which reads the scene's depth
    /// as the camera's opaque pass leaves it and draws the opaque objects into an id target of the
    /// scene's samples, then the resolve pass, which copies the ids that the device resolved into
    /// a target of one sample that the frame copies into a buffer. The id pass runs before the
    /// decal and transparent passes, whose draws write the depth it tests.
    fn declare_pick(&mut self, views: &[View]) {
        self.pick_pass = None;
        self.pick_resolve_pass = None;
        if views.is_empty() || (!self.picking_wanted && !self.pick_declared) {
            return;
        }
        self.pick_declared = true;
        let size = view_size(&views[ViewId::CAMERA.index()]);
        let ids = Target::color(pick::FORMAT).samples(self.samples);
        let pass = Pass::new(PICK_PASS, PassKind::Scene)
            .size(size)
            .reads_so_far(SCENE_DEPTH)
            .writes(SCENE_DEPTH)
            .creates(PICK_IDS, ids);
        self.pick_pass = Some(self.add(pass, Role::Pick));
        let resolve = Pass::new(PICK_RESOLVE_PASS, PassKind::Fullscreen)
            .size(size)
            .reads(PICK_IDS)
            .creates(PICK_RESOLVED, Target::color(pick::FORMAT).copy_source());
        self.pick_resolve_pass = Some(self.add(resolve, Role::PickResolve));
    }

    /// Declares the pick's passes when the first pick waits, and leaves them declared afterwards.
    /// Their targets stay in every plan, so no plan releases one while a copy may still read it. A
    /// frame without a pick skips their step and draws nothing.
    pub(crate) fn set_picking(&mut self, on: bool) {
        self.picking_wanted = on;
        if on && !self.pick_declared {
            self.declared = false;
        }
    }

    /// Switches the pick's passes on once they are declared. A frame without a pick leaves them on:
    /// the plan keeps their targets, and the frame's skip of their step draws nothing.
    pub(crate) fn set_picking_draws(&mut self, on: bool) {
        if !on {
            return;
        }
        for pass in [self.pick_pass, self.pick_resolve_pass]
            .into_iter()
            .flatten()
        {
            self.graph.set_enabled(pass, true);
        }
    }

    /// What the pick's pipelines draw into: the id format, the scene depth's format and samples,
    /// and the draw index where WebGL2 reads it.
    pub(crate) fn pick_targets(&self) -> PassTargets {
        pick::targets(DEPTH_FORMAT, self.samples, 0)
    }

    /// The draw list's id of the target that holds the pick's resolved ids, or `None` while the
    /// pick passes are not declared. Valid once the frame's [`FrameGraph::prepare`] made the
    /// plan's textures.
    pub(crate) fn pick_result_texture(&self) -> Option<u32> {
        let resource = self.graph.find_resource(PICK_RESOLVED)?;
        let surface = self.graph.plan()?.texture_of(resource)?;
        Some(self.texture_id(surface))
    }

    /// The draw list's id of the id target that the pick pass drew, which the resolve pass and the
    /// bind group read, or `None` while the pick passes are not declared.
    pub(crate) fn pick_sample_texture(&self) -> Option<u32> {
        self.sampled_id(PICK_IDS)
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

    /// Declares the subsurface blur's passes: on WebGPU the subsurface view's culling pass, then
    /// the skin pass, which draws with the camera's lights, shadows, ambient occlusion and the
    /// textures that the camera's view reads, into a light and a depth of its own; then the across
    /// step, which reads the skin pass's light, and the down step, which reads it with the across
    /// step's target and the scene's color and depth as every pass leaves them.
    fn declare_subsurface(&mut self, views: &[View], named: &[ViewPassNames]) {
        let mut pass = Pass::new(SKIN_PASS, PassKind::Scene)
            .creates(SKIN_LIGHT, Target::color(subsurface::SKIN_FORMAT))
            .creates(SKIN_DEPTH, Target::depth(DEPTH_FORMAT));
        if self.gpu_culling {
            let culling = Pass::new(SUBSURFACE_CULLING, PassKind::Compute)
                .reads(OBJECTS)
                .creates_buffer(SUBSURFACE_VISIBLE);
            self.add(culling, Role::Cull(ViewId::SUBSURFACE));
            pass = pass.reads(SUBSURFACE_VISIBLE).reads(LIGHT_GRID);
        }
        if self.skins() {
            pass = pass.reads(SKINNED);
        }
        if self.shadow_map {
            pass = pass.reads(SHADOW_MAP).reads(SHADOW_ATLAS);
        }
        if self.depth_prepass() && self.screen_draws() {
            pass = pass.reads(AO_TARGETS[ao::STEPS - 1]);
        }
        if self.transmission_declared {
            pass = pass.reads(TRANSMISSION_COLOR);
        }
        let pass = reads_targets(pass, views, named, ViewId::CAMERA.index());
        self.add(pass, Role::SkinLight);
        let across = Pass::new(SUBSURFACE_PASSES[0], PassKind::Fullscreen)
            .reads(SKIN_LIGHT)
            .creates(
                SUBSURFACE_TARGETS[0],
                Target::color(subsurface::ACROSS_FORMAT),
            );
        self.add(across, Role::Subsurface(0));
        let down = Pass::new(SUBSURFACE_PASSES[1], PassKind::Fullscreen)
            .reads(SKIN_LIGHT)
            .reads(SUBSURFACE_TARGETS[0])
            .reads(SCENE_COLOR)
            .reads(SCENE_DEPTH)
            .creates(SUBSURFACE_TARGETS[1], Target::color(subsurface::FORMAT));
        self.add(down, Role::Subsurface(1));
    }

    /// Declares the motion passes, after the transparent passes: where the device draws the motion
    /// target, on WebGPU the motion view's culling pass, then the motion pass, which draws into a
    /// target of the scene's `samples` with the scene's depth; then the motion debug view's step,
    /// which reads the target and the depth, and draws over the scene color. The motion passes are
    /// optional: they run while a running pass reads the target.
    fn declare_motion(&mut self, samples: u32) {
        if self.motion_supported() {
            let target = Target::color(motion::FORMAT).samples(samples);
            let mut pass = Pass::new(MOTION_PASS, PassKind::Scene)
                .optional()
                .creates(MOTION_TARGET, target)
                .writes(SCENE_DEPTH);
            if self.gpu_culling {
                let culling = Pass::new(MOTION_CULLING, PassKind::Compute)
                    .optional()
                    .reads(OBJECTS)
                    .creates_buffer(MOTION_VISIBLE);
                self.add(culling, Role::Cull(ViewId::MOTION));
                pass = pass.reads(MOTION_VISIBLE);
            }
            if self.skins() {
                pass = pass.reads(SKINNED);
            }
            self.add(pass, Role::Motion);
        }
        let mut step = Pass::new(MOTION_VIEW_PASS, PassKind::Fullscreen)
            .reads(SCENE_DEPTH)
            .writes(SCENE_COLOR);
        if self.motion_supported() {
            step = step.reads(MOTION_TARGET);
        }
        self.add(step, Role::MotionView);
    }

    /// Declares the custom effects' passes, one for each unit: each reads the color that the pass
    /// before it left, and the scene's depth as every pass leaves it when one of its effects reads
    /// depth, and creates a target of its own.
    fn declare_effects(&mut self) {
        let mut input = self.scene_output();
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
            let views = self.effect_views[unit.places()]
                .iter()
                .fold(0, |mask, views| mask | views);
            pass = self.reads_views(pass, views);
            self.add(pass, Role::Effect(index as u8));
            input = EFFECT_TARGETS[index];
        }
    }

    /// Declares the volumetric fog's steps for a grid of `slices` slices: the two light steps, each
    /// into a kept light texture that it reads the other one of, then the block step, which reads
    /// both, the sum, which reads the block step's target, and the apply step, which reads the
    /// lit color and the scene's depth as every pass leaves them and the sum's target. The light
    /// steps bind the camera's frame group, so they read what its opaque pass reads of the lights
    /// and the shadows. The first light step reads the second's texture as the frame starts, before
    /// the second step writes it.
    fn declare_fog(&mut self, slices: u32) {
        let size = fog_volume::grid_size(slices);
        let grid = Target::color(fog_volume::GRID_FORMAT);
        for name in FOG_LIGHT {
            self.graph.keep(name, grid, size);
        }
        for (parity, name) in FOG_LIGHT_PASSES.into_iter().enumerate() {
            let mut pass = Pass::new(name, PassKind::Fullscreen)
                .size(size)
                .writes(FOG_LIGHT[parity]);
            pass = if parity == 0 {
                pass.reads_so_far(FOG_LIGHT[1])
            } else {
                pass.reads(FOG_LIGHT[0])
            };
            if self.gpu_culling {
                pass = pass.reads(LIGHT_GRID);
            }
            if self.shadow_map {
                pass = pass.reads(SHADOW_MAP).reads(SHADOW_ATLAS);
            }
            self.add(pass, Role::FogLight(parity as u8));
        }
        let block = Pass::new(FOG_BLOCK_PASS, PassKind::Fullscreen)
            .size(size)
            .reads(FOG_LIGHT[0])
            .reads(FOG_LIGHT[1])
            .creates(FOG_BLOCKS, grid);
        self.add(block, Role::FogBlock);
        let sum = Pass::new(FOG_SUM_PASS, PassKind::Fullscreen)
            .size(size)
            .reads(FOG_BLOCKS)
            .creates(FOG_SUMMED, grid);
        self.add(sum, Role::FogSum);
        let apply = Pass::new(FOG_APPLY_PASS, PassKind::Fullscreen)
            .reads(self.lit_output())
            .reads(SCENE_DEPTH)
            .reads(FOG_SUMMED)
            .creates(FOG_COLOR, Target::color(fog_volume::FORMAT));
        self.add(apply, Role::FogApply);
    }

    /// The pass, reading the target of each view in the mask `views` that the graph declares.
    fn reads_views(&self, mut pass: Pass, views: u32) -> Pass {
        for (index, target) in self.view_colors.iter().enumerate() {
            if let Some(target) = *target
                && views & (1 << index) != 0
            {
                pass = pass.reads(self.graph.resource_name(target).to_owned());
            }
        }
        pass
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

    /// Declares the steps of the screen texture: ambient occlusion's depth copy, which reads the
    /// scene depth as the prepass leaves it, then while screen-space reflections draw the levels
    /// of their depth pyramid and their trace, each from the copy and the levels before it, then
    /// while ambient occlusion or contact shadows draw the horizon search, which reads the copy,
    /// and the denoise, which reads the copy, the search and the trace.
    fn declare_screen(&mut self) {
        self.ao_steps();
        // Each step writes every texel of its target that a later step or pass reads: the reads
        // clamp inside the drawn corner. So on WebGL2, where Safari can spend about a millisecond
        // of the frame on one clear of a large target, a step's target need not start from a
        // clear. WebGPU's clear is cheap, and a load there would read the whole target, so its
        // passes keep the clear.
        let no_clear = !self.gpu_culling;
        let target = Target::color(ao::FORMATS[0]);
        let pass = Pass::new(AO_PASSES[0], PassKind::Fullscreen).size(ao::SIZE);
        let pass = if no_clear {
            pass.creates_overwriting(AO_TARGETS[0], target)
        } else {
            pass.creates(AO_TARGETS[0], target)
        };
        let depth = pass.reads_so_far(SCENE_DEPTH);
        self.add(depth, Role::Ao(0));
        let reflects = self.ssr_draws();
        if reflects {
            self.ssr_steps();
            let mut finer = AO_TARGETS[0];
            for level in 1..=ssr::LEVELS {
                let pass = Pass::new(SSR_PASSES[level - 1], PassKind::Fullscreen)
                    .size(ssr::level_size(level))
                    .reads(finer)
                    .creates(SSR_TARGETS[level - 1], Target::color(ssr::LEVEL_FORMAT));
                self.add(pass, Role::Ssr(level as u8 - 1));
                finer = SSR_TARGETS[level - 1];
            }
            let mut trace = Pass::new(SSR_PASSES[ssr::LEVELS], PassKind::Fullscreen)
                .size(ssr::TRACE_SIZE)
                .reads(AO_TARGETS[0]);
            for level in &SSR_TARGETS[..ssr::LEVELS] {
                trace = trace.reads(*level);
            }
            let trace = trace.creates(SSR_TARGETS[ssr::LEVELS], Target::color(ssr::TRACE_FORMAT));
            self.add(trace, Role::Ssr(ssr::LEVELS as u8));
        }
        if !self.screen_draws() {
            return;
        }
        for step in 1..ao::STEPS {
            let target = Target::color(ao::FORMATS[step]);
            let pass = Pass::new(AO_PASSES[step], PassKind::Fullscreen).size(ao::SIZE);
            let mut pass = if no_clear {
                pass.creates_overwriting(AO_TARGETS[step], target)
            } else {
                pass.creates(AO_TARGETS[step], target)
            };
            pass = pass.reads(AO_TARGETS[0]);
            if step == 2 {
                pass = pass.reads(AO_TARGETS[1]);
                if reflects {
                    pass = pass.reads(SSR_TARGETS[ssr::LEVELS]);
                }
            }
            self.add(pass, Role::Ao(step as u8));
        }
    }

    /// Declares the camera's weighted layer after its transparent pass (see [`crate::weighted`]).
    /// The weighted pass draws into its two sums with the scene's depth as its depth target. A
    /// scene of one sample lends its own depth. A multisampled scene's pass creates a depth target
    /// of one sample, and its first draw copies the scene depth into it, as the transparent pass
    /// leaves it. The composite then blends the sums over the scene color.
    fn declare_weighted(&mut self, views: &[View], named: &[ViewPassNames]) {
        let camera = &views[ViewId::CAMERA.index()];
        let size = view_size(camera);
        let mut layer = Pass::new(WEIGHTED_PASS, PassKind::Scene)
            .size(size)
            .layers(camera.layers())
            .creates(WEIGHTED_SUM, Target::color(weighted::SUM_FORMAT))
            .creates(WEIGHTED_COVER, Target::color(weighted::COVER_FORMAT));
        layer = if self.weighted_copies_depth() {
            layer
                .reads_so_far(SCENE_DEPTH)
                .creates(WEIGHTED_DEPTH, Target::depth(DEPTH_FORMAT))
        } else {
            layer.writes(SCENE_DEPTH)
        };
        if self.skins() {
            layer = layer.reads(SKINNED);
        }
        let layer = reads_targets(layer, views, named, ViewId::CAMERA.index());
        self.add(layer, Role::Weighted);
        let composite = Pass::new(WEIGHTED_COMPOSITE_PASS, PassKind::Scene)
            .size(size)
            .reads(WEIGHTED_SUM)
            .reads(WEIGHTED_COVER)
            .writes(SCENE_COLOR);
        self.add(composite, Role::WeightedComposite);
    }

    /// Screen-space reflections' steps, made when first asked for.
    fn ssr_steps(&mut self) -> &mut SsrPass {
        let ids = self.ssr_ids;
        self.ssr_pass.get_or_insert_with(|| SsrPass::new(ids))
    }

    /// Ambient occlusion's steps, made for the scene depth's samples when first asked for.
    fn ao_steps(&mut self) -> &mut AoPass {
        // WebGL2 has no multisampled textures: its backend gives the depth step a copy of one
        // sample.
        let samples = if self.gpu_culling { self.samples } else { 1 };
        self.ao_pass
            .get_or_insert_with(|| AoPass::new(self.ao_ids, samples))
    }

    /// Declares the first step of the two-step pass: one triangle over the render size, which draws
    /// the scene's display color into [`OUTPUT_COLOR`], with bloom's base level added when `bloom`.
    /// It draws at [`Size::Full`], so it fills the render size and its `whole` test holds. The
    /// pass without bloom creates the target; the pass with bloom writes it.
    fn declare_output(&mut self, bloom: bool) -> PassId {
        let mut pass = Pass::new(
            if bloom { "OutputBloom" } else { "Output" },
            PassKind::Fullscreen,
        )
        .optional()
        .size(Size::Full)
        .reads(self.color_output());
        if bloom {
            pass = pass.reads(BLOOM_LEVELS[0]).writes(OUTPUT_COLOR);
        } else {
            pass = pass.creates(OUTPUT_COLOR, Target::color(format::CANVAS));
        }
        self.add(
            pass,
            if bloom {
                Role::OutputBloom
            } else {
                Role::Output
            },
        )
    }

    /// Keeps the still-camera accumulation's history and declares its blend and the final pass's
    /// still build: the blend mixes the frame's color into the history, which it draws over, and
    /// the still build tone maps the history into the canvas. A frame records them in place of the
    /// final pass while the view is still. The 8-bit path declares neither: its color holds display
    /// color, which the final pass does not tone map.
    fn declare_accumulate(&mut self) {
        self.still_declared = self.still_enabled && self.scene_color.is_hdr();
        if !self.still_declared {
            return;
        }
        let target = Target::color(accumulate::FORMAT);
        self.graph.keep(ACCUM_HISTORY, target, Size::Full);
        let blend = Pass::new("Accumulate", PassKind::Fullscreen)
            .reads(self.color_output())
            .writes_part(ACCUM_HISTORY);
        self.add(blend, Role::Accumulate);
        let still = Pass::new("FinalStill", PassKind::Fullscreen)
            .size(Size::Canvas)
            .reads(ACCUM_HISTORY)
            .writes(CANVAS);
        self.add(still, Role::FinalStill);
    }

    /// Says whether the page lets a still view accumulate its frames. Hold mode and the image tests
    /// turn it off, so a captured frame is the frame the sketch drew once; the passes are declared
    /// again without the accumulation's steps.
    pub(crate) fn set_still_enabled(&mut self, enabled: bool) {
        if enabled != self.still_enabled {
            self.still_enabled = enabled;
            self.redeclare();
        }
    }

    /// True when a still view of this frame may accumulate: the accumulation's steps are declared
    /// and built, the final pass takes the color to the canvas, and nothing between them changes
    /// from frame to frame on the GPU alone or draws over the color. Bloom, outlines, effects that
    /// fold into the final pass, automatic exposure, the volumetric fog, screen-space reflections
    /// and a canvas that keeps the scene's alpha each rule it out: the blend averages color alone.
    pub(crate) fn still_eligible(&self) -> bool {
        self.still_declared
            && self.still_built
            && !self.canvas_alpha
            && self.final_runs()
            && !self.bloom_draws()
            && !self.outline_draws()
            && self.folded.is_none()
            && self.exposure.is_none()
            && self.fog_declared == 0
            && self.ssr.is_none()
    }

    /// Says how still the camera's view is, for the frame about to be recorded: while it
    /// accumulates and [`FrameGraph::still_eligible`] holds, the frame blends its color into the
    /// history with the state's weight and draws the still build in place of the final pass.
    pub(crate) fn set_still(&mut self, still: crate::still::Still) {
        self.accumulate_weight = still.weight();
        self.accumulate_on = still.accumulating() && self.still_eligible();
    }

    /// The words of the last recorded frame's list that differ between a frame that blends a still
    /// view and one that does not, in order.
    pub(crate) fn word_marks(&self) -> &[Range<usize>] {
        &self.word_marks
    }

    /// The upload arena's offset of the blend's weight, in a frame that blends a still view.
    pub(crate) fn weight_at(&self) -> Option<usize> {
        self.weight_at
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
    /// frame draws at render scale `scale`. A new render scale makes again only the textures whose
    /// size follows it ([`Size::Scaled`]).
    pub(crate) fn prepare(
        &mut self,
        list: &mut DrawList,
        canvas: (u32, u32),
        scale: RenderScale,
    ) -> Result<(), RecordError> {
        let previous = self.scale;
        self.scale = if self.final_runs() {
            scale
        } else {
            RenderScale::FULL
        };
        // The two-step pass runs below the whole canvas's scale; the declarations hold it whenever
        // the render scale can drop, so a crossing changes what the frame draws without declaring
        // anything again.
        let rescaled = self.scale != previous;
        let compiled = self.graph.compile().map_err(RecordError::Graph)?
            | std::mem::take(&mut self.compiled_early);
        let canvas = (canvas.0.max(1), canvas.1.max(1));
        let resized = canvas != self.canvas;
        if resized {
            list.push(Op::ResizeCanvas, &[canvas.0, canvas.1])?;
            self.canvas = canvas;
        }
        self.textures_made = (compiled || resized || rescaled) && self.make_textures(list)?;
        Ok(())
    }

    /// True when `group`'s pipelines are built, as the last frame found them.
    fn built(&self, group: BuiltGroup) -> bool {
        match group {
            BuiltGroup::Bloom => self.bloom_built,
            BuiltGroup::Dof => self.dof_built,
            BuiltGroup::Fog => self.fog_built,
            BuiltGroup::Screen => self.ao_built,
            BuiltGroup::Subsurface => self.subsurface_built,
            BuiltGroup::Transmission => self.transmission_built,
            BuiltGroup::Weighted => self.weighted_built,
            BuiltGroup::ParticleDepth => self.particle_depth_built,
        }
    }

    /// True when `group` draws with the built state as it stands.
    fn built_draws(&self, group: BuiltGroup) -> bool {
        match group {
            BuiltGroup::Bloom => self.bloom_draws(),
            BuiltGroup::Dof => self.dof_draws(),
            BuiltGroup::Fog => self.fog_draws(),
            BuiltGroup::Screen => self.screen_draws(),
            BuiltGroup::Subsurface => self.subsurface_draws(),
            BuiltGroup::Transmission => self.transmission_draws(),
            BuiltGroup::Weighted => self.weighted_draws(),
            BuiltGroup::ParticleDepth => self.particle_depth_draws(),
        }
    }

    /// Marks the passes that the frame declared as gone, so the next frame declares them again.
    fn declare_again(&mut self) {
        self.declared = false;
    }

    /// Records that the pipelines of `group` are `built` now, and calls `again` when the passes
    /// that its built pipelines allow differ from the last frame's, so the frame declares its
    /// passes again.
    fn note_built(&mut self, group: BuiltGroup, built: bool, again: fn(&mut Self)) {
        if self.built(group) == built {
            return;
        }
        let drew = self.built_draws(group);
        match group {
            BuiltGroup::Bloom => self.bloom_built = built,
            BuiltGroup::Dof => self.dof_built = built,
            BuiltGroup::Fog => self.fog_built = built,
            BuiltGroup::Screen => self.ao_built = built,
            BuiltGroup::Subsurface => self.subsurface_built = built,
            BuiltGroup::Transmission => self.transmission_built = built,
            BuiltGroup::Weighted => self.weighted_built = built,
            BuiltGroup::ParticleDepth => self.particle_depth_built = built,
        }
        if self.built_draws(group) != drew {
            again(self);
        }
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
        // While a view may accumulate, its passes ask for their pipelines once the first frame has
        // drawn, so the first frame never waits for them, and a view that becomes still later finds
        // them built and its frame makes no GPU object.
        self.still_built = self.still_declared && pipelines_built != 0 && {
            let blend = self.accumulate.request_pipeline(pipelines);
            self.still_pass.request_pipeline(pipelines, false);
            let still = self.still_pass.plain_pipeline();
            pipelines.built(blend, pipelines_built)
                && still.is_some_and(|id| pipelines.built(id, pipelines_built))
        };
        // While the render scale can drop, the two steps ask for their pipelines before it first
        // drops. The first step draws the final pass's builds, which are built with it, so the
        // second step's plain build alone decides when the two steps can draw.
        self.two_step_built = self.scales && {
            self.output_pass.request_pipeline(pipelines, wanted);
            let present = self.final_pass.request_present(pipelines);
            pipelines.built(present, pipelines_built)
        };
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
        self.note_built(BuiltGroup::Dof, dof_built, FrameGraph::declare_again);
        let subsurface_built = self.subsurface_wanted() && {
            let steps = self.subsurface_steps();
            steps.request_pipelines(pipelines);
            pipelines.all_built(steps.pipeline_ids(), pipelines_built)
        };
        self.note_built(
            BuiltGroup::Subsurface,
            subsurface_built,
            FrameGraph::declare_again,
        );
        self.exposure_built = match self.exposure {
            Some(exposure) => {
                self.exposure_meter()
                    .request_pipelines(pipelines, exposure.meter, pipelines_built)
            }
            None => false,
        };
        let fog_built = self.fog.is_some() && {
            let steps = self.fog_steps();
            steps.request_pipelines(pipelines);
            pipelines.all_built(steps.pipeline_ids(), pipelines_built)
        };
        self.note_built(BuiltGroup::Fog, fog_built, FrameGraph::declare_again);
        let steps_built = (self.screen_steps() || self.ssr.is_some()) && {
            let steps = self.ao_steps();
            steps.request_pipelines(pipelines);
            pipelines.all_built(steps.pipeline_ids(), pipelines_built)
        };
        let ssr_built = self.ssr.is_some()
            && {
                let steps = self.ssr_steps();
                steps.request_pipelines(pipelines);
                pipelines.all_built(steps.pipeline_ids(), pipelines_built)
            }
            && steps_built;
        let ao_built = steps_built && self.screen_steps();
        self.note_built(BuiltGroup::Screen, ao_built, FrameGraph::declare_again);
        self.note_built(BuiltGroup::Bloom, built, FrameGraph::enable_outputs);
        let (format, permutation) = (self.view_target_format(), self.scene_color.permutation());
        let transmission_built = self.copy_wanted() && {
            // WebGL2 has no multisampled textures: its backend gives the copy a copy of one sample.
            let multisampled = self.gpu_culling && self.samples > 1;
            let id = self.transmission.request_pipeline(
                pipelines,
                self.copy_format(),
                permutation,
                multisampled,
            );
            pipelines.built(id, pipelines_built)
        };
        self.note_built(
            BuiltGroup::Transmission,
            transmission_built,
            FrameGraph::declare_again,
        );
        let motion_view_built = self.motion_view && {
            let multisampled = self.gpu_culling && self.samples > 1;
            let id = self.motion_step.request_pipeline(
                pipelines,
                self.scene_color.format(),
                self.samples,
                !self.scene_color.is_hdr(),
                multisampled,
            );
            pipelines.built(id, pipelines_built)
        };
        if motion_view_built != self.motion_view_built {
            let was = self.motion_view_draws();
            self.motion_view_built = motion_view_built;
            if self.motion_view_draws() != was {
                self.declared = false;
            }
        }
        let ssr_built = ssr_built && transmission_built;
        if ssr_built != self.ssr_built {
            let was = self.ssr_draws();
            self.ssr_built = ssr_built;
            if self.ssr_draws() != was {
                self.declared = false;
            }
        }
        let weighted_built = self.weighted_wanted && {
            let composite =
                self.weighted
                    .request_composite(pipelines, self.scene_color.format(), self.samples);
            let depth = self
                .weighted_copies_depth()
                .then(|| self.weighted.request_depth(pipelines, DEPTH_FORMAT));
            pipelines.built(composite, pipelines_built)
                && depth.is_none_or(|id| pipelines.built(id, pipelines_built))
        };
        self.note_built(
            BuiltGroup::Weighted,
            weighted_built,
            FrameGraph::declare_again,
        );
        // WebGL2 has no multisampled textures: its backend gives the copy a copy of one sample.
        let samples = if self.gpu_culling { self.samples } else { 1 };
        let particle_depth_built = self.particle_depth_wanted && {
            let id = self.particle_depth.request_pipeline(pipelines, samples);
            pipelines.built(id, pipelines_built)
        };
        self.note_built(
            BuiltGroup::ParticleDepth,
            particle_depth_built,
            FrameGraph::declare_again,
        );
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
        view_target_format(self.scene_color)
    }

    /// The format of the copy of the camera's opaque color: the format of views' targets, or
    /// 16-bit floats while surfaces that let light through want the copy and the scene color's
    /// packed small floats have no alpha for the opaque depth's code. A copy that only screen-space
    /// reflections read keeps the packed format, as they read its color alone.
    fn copy_format(&self) -> u32 {
        match self.view_target_format() {
            format::RG11B10_UFLOAT if self.transmission_wanted => format::RGBA16_FLOAT,
            other => other,
        }
    }

    /// Asks `pipelines` for the pipeline of each full-screen pass of `views`. A builder asks with
    /// the views of the frame it records, so a new pass's pipeline builds before its first frame.
    pub(crate) fn request_fullscreen_pipelines(
        &mut self,
        pipelines: &mut PipelineCache,
        views: &[View],
    ) {
        for (place, view) in views.iter().enumerate() {
            if let Some(pass) = view.fullscreen_pass().filter(|_| !view.is_removed()) {
                self.fullscreen.request_pipeline(pipelines, place, pass);
            }
        }
    }

    /// Asks for the pipeline of the final pass's fold build while the sketch folds effects and the
    /// fold may draw, once the folded effects draw alone, as a group waits (see
    /// [`EffectPass::request_pipelines`]). A fold that may not draw, beside bloom for one, builds
    /// nothing until it may. It then plans the effects' passes with each group and the fold whose
    /// pipeline is built.
    fn request_effect_joins(&mut self, pipelines: &mut PipelineCache, pipelines_built: u32) {
        let count = self.effect_count;
        let alone = |first: usize, pipelines: &PipelineCache| {
            self.effect_pass
                .as_ref()
                .is_some_and(|pass| pass.alone_built(first..count, pipelines, pipelines_built))
        };
        let fold = match self.effect_joins.fold_of(count) {
            Some((first, template)) if self.may_fold() && alone(first, pipelines) => {
                let multisampled = self.gpu_culling && self.samples > 1 && self.folded_depth(first);
                let id = self
                    .final_pass
                    .request_fold(pipelines, template, multisampled);
                pipelines.built(id, pipelines_built).then_some(first)
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
        self.upload_ssr(list, arena)?;
        self.upload_subsurface(list, arena)?;
        self.upload_effects(list, arena)?;
        self.upload_fullscreen(list, arena)?;
        self.upload_dof(list, arena)?;
        self.upload_accumulate(list, arena)?;
        let exposure = self.upload_exposure(list, arena)?;
        self.upload_fog(list, arena)?;
        self.bind_view_copies(list)?;
        self.bind_transmission(list)?;
        self.prepare_motion_view(list, arena)?;
        self.bind_weighted(list)?;
        self.bind_particle_depth(list)?;
        self.bind_material_scene(list)?;
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
        let inputs = FinalInputs {
            tone_mapping: output.tone_mapping,
            render_size,
            color: scene_color,
            bloom,
            grading,
            outline,
            fold,
            exposure,
        };
        let made = self.textures_made;
        let two_step = self.two_step_runs();
        self.final_pass
            .prepare(list, arena, &inputs, made, !two_step)?;
        // The still build uploads and binds in every frame alike, whether the view is still or
        // not, so a view that becomes still changes only the commands that the comparison leaves
        // out. It draws in one step at any render scale, without bloom or an outline.
        if self.still_declared {
            let still = FinalInputs {
                color: self.accumulate_textures()[1],
                bloom: None,
                outline: None,
                fold: None,
                ..inputs
            };
            self.still_pass.prepare(list, arena, &still, made, true)?;
        }
        if !self.two_step_declared {
            return Ok(());
        }
        // While the render scale can drop, every frame keeps the two steps' bind groups ready, so a
        // crossing of the whole canvas's scale makes no GPU object. The first step draws the display
        // color at the render size, with the bloom, and the second scales it up to the canvas, with
        // the grading and the outline. The vignette darkens high dynamic range color in the first
        // step and display color in the second.
        let hdr = self.scene_color.is_hdr();
        let first = FinalInputs {
            grading: Grading {
                vignette: grading.vignette.filter(|_| hdr),
                lut: None,
            },
            outline: None,
            fold: None,
            ..inputs
        };
        self.output_pass
            .prepare(list, arena, &first, made, two_step)?;
        let second = FinalInputs {
            color: self
                .sampled_id(OUTPUT_COLOR)
                .expect("the two-step pass reads the first step's target"),
            bloom: None,
            grading: Grading {
                vignette: grading.vignette.filter(|_| !hdr),
                lut: grading.lut,
            },
            fold: None,
            exposure: None,
            ..inputs
        };
        self.final_pass
            .prepare_present(list, arena, &second, made, two_step)
    }

    /// The texture that the accumulation's blend reads, the scene color as the effects and depth of
    /// field leave it, and the history, which the still build reads, found once for each compile.
    fn accumulate_textures(&mut self) -> [u32; 2] {
        let mut found = self.accumulate_textures;
        let textures = found.get_or(self.graph.compiles(), || {
            [self.color_output(), ACCUM_HISTORY].map(|name| {
                self.sampled_id(name)
                    .expect("the accumulation reads a planned texture")
            })
        });
        self.accumulate_textures = found;
        textures
    }

    /// Makes the accumulation's blend's objects, binds it to the color it reads and uploads the
    /// blend's weight, in every frame alike while the blend is declared, so a view that
    /// becomes still changes only what the comparison leaves out. The weight is a volatile part of
    /// the arena; a frame that blends notes its offset.
    fn upload_accumulate(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
    ) -> Result<(), RecordError> {
        self.weight_at = None;
        if !self.still_declared {
            return Ok(());
        }
        let [color, _] = self.accumulate_textures();
        let weight_at = self.accumulate.prepare(
            list,
            arena,
            color,
            self.accumulate_weight,
            self.textures_made,
        )?;
        self.weight_at = self.accumulate_on.then_some(weight_at);
        Ok(())
    }

    /// Uploads the meter's block and binds its steps to the color that the final pass reads while
    /// the meter runs, and returns its texel, which the final pass reads. A frame without the
    /// meter makes the next frame that meters take its stops at once.
    fn upload_exposure(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
    ) -> Result<Option<u32>, RecordError> {
        let frame = match self.exposure {
            Some(frame) if self.exposure_draws() && self.final_runs() => frame,
            _ => {
                if let Some(meter) = self.exposure_pass.as_mut() {
                    meter.skip();
                }
                return Ok(None);
            }
        };
        let source = self
            .sampled_id(self.color_output())
            .expect("the meter reads the color that the final pass reads");
        let size = (self.canvas, self.scale);
        let made = self.textures_made;
        let meter = self.exposure_meter();
        meter.prepare(list, arena, size, frame, source, made)?;
        Ok(Some(meter.texel()))
    }

    /// The texture that each of bloom's declared steps reads, and the base level's, found by name
    /// once for each compile of the graph.
    fn bloom_textures(&mut self) -> ([u32; STEPS], u32) {
        let mut found = self.bloom_textures;
        let (sources, base) = found.get_or(self.graph.compiles(), || {
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
            (sources, id(BLOOM_LEVELS[0]))
        });
        self.bloom_textures = found;
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

    /// Records what the motion debug view's step reads while it draws: its objects, its block and
    /// its bind group, with the motion target's texture, or a blank one where the device draws
    /// none, and the scene depth's.
    fn prepare_motion_view(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
    ) -> Result<(), RecordError> {
        if !self.motion_declared {
            return Ok(());
        }
        let motion = if self.motion_supported() {
            self.sampled_id(MOTION_TARGET)
        } else {
            None
        };
        let depth = self
            .sampled_id(SCENE_DEPTH)
            .expect("the motion debug view reads the scene depth");
        let multisampled = self.gpu_culling && self.samples > 1;
        let reproject = self
            .motion_frame
            .map_or(motion::IDENTITY, |frame| frame.reproject);
        let render = self.render_size();
        self.motion_step.prepare(
            list,
            arena,
            motion,
            depth,
            multisampled,
            render,
            self.canvas,
            &reproject,
        )
    }

    /// Records the full-screen passes' objects and the block of each pass that runs in the plan,
    /// and binds each to the textures that it reads.
    fn upload_fullscreen(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
    ) -> Result<(), RecordError> {
        if self.fullscreen_views == 0 {
            return Ok(());
        }
        let frame = (self.canvas, self.scale);
        let (clock, inverse, made) = (
            self.effect_clock,
            self.inverse_projection,
            self.textures_made,
        );
        for place in 1..self.declared_views.len() {
            if self.fullscreen_views & (1 << place) == 0 || !self.fullscreen_runs(place) {
                continue;
            }
            let view = self.declared_views[place];
            let Some(pass) = view.fullscreen_pass() else {
                continue;
            };
            let color = match pass.source {
                PassSource::SceneColor => self.sampled_id(SCENE_COLOR),
                PassSource::OutlineMask if self.fullscreen_outline => self.sampled_id(OUTLINE_MASK),
                _ => None,
            };
            let depth = if pass.depth {
                self.sampled_id(SCENE_DEPTH)
            } else {
                None
            };
            let inputs = PassInputs {
                color: color.unwrap_or(0),
                depth: depth.unwrap_or(0),
            };
            let drawn = view_size(&view).made(self.canvas, self.scale);
            self.fullscreen.prepare(
                list,
                arena,
                (place, pass, inputs),
                drawn,
                frame,
                clock,
                inverse,
                made,
            )?;
        }
        Ok(())
    }

    /// True when the full-screen pass of the view at `place` runs in the compiled plan.
    fn fullscreen_runs(&self, place: usize) -> bool {
        let Some(plan) = self.graph.plan() else {
            return false;
        };
        self.view_passes
            .iter()
            .filter(|&&(index, _)| usize::from(index) == place)
            .any(|&(_, pass)| {
                matches!(self.roles[pass.index()], Role::Fullscreen(_))
                    && plan.step_of(pass).is_some()
            })
    }

    /// The color that each unit reads, and the scene depth's texture, or 0 while no effect reads
    /// depth, found by name once for each compile of the graph.
    fn effect_textures(&mut self) -> ([u32; MAX_EFFECTS], u32) {
        let mut found = self.effect_textures;
        let textures = found.get_or(self.graph.compiles(), || {
            let depth = if self.effect_depths != 0 {
                self.sampled_id(SCENE_DEPTH)
                    .expect("an effect that reads depth reads the scene depth")
            } else {
                0
            };
            let mut colors = [0; MAX_EFFECTS];
            for (index, color) in colors.iter_mut().enumerate().take(self.unit_count) {
                let input = if index == 0 {
                    self.scene_output()
                } else {
                    EFFECT_TARGETS[index - 1]
                };
                *color = self
                    .sampled_id(input)
                    .expect("each effect reads a planned texture");
            }
            (colors, depth)
        });
        self.effect_textures = found;
        textures
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
        let mut found = self.dof_textures;
        let sources = found.get_or(self.graph.compiles(), || {
            let id = |name: &str| {
                self.sampled_id(name)
                    .expect("each step of depth of field reads a planned texture")
            };
            DofSources {
                color: id(self.effects_output()),
                depth: id(SCENE_DEPTH),
                halves: std::array::from_fn(|k| id(DOF_TARGETS[k])),
            }
        });
        self.dof_textures = found;
        let (frame_size, made) = ((self.canvas, self.scale), self.textures_made);
        self.dof_steps()
            .prepare(list, arena, frame_size, frame, sources, made)
    }

    /// Records the subsurface blur's objects and blocks while its passes are declared, and binds
    /// each step to the textures it reads, found by name once for each compile of the graph.
    fn upload_subsurface(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
    ) -> Result<(), RecordError> {
        let Some(frame) = self.subsurface.filter(|_| self.subsurface_declared) else {
            return Ok(());
        };
        let mut found = self.subsurface_textures;
        let sources = found.get_or(self.graph.compiles(), || {
            let id = |name: &str| {
                self.sampled_id(name)
                    .expect("each step of the subsurface blur reads a planned texture")
            };
            SubsurfaceSources {
                skin: id(SKIN_LIGHT),
                across: id(SUBSURFACE_TARGETS[0]),
                color: id(SCENE_COLOR),
                depth: id(SCENE_DEPTH),
            }
        });
        self.subsurface_textures = found;
        let (frame_size, made) = ((self.canvas, self.scale), self.textures_made);
        self.subsurface_steps()
            .prepare(list, arena, frame_size, frame, sources, made)
    }

    /// Records the volumetric fog's objects and block while its steps are declared, and binds the
    /// steps to the textures they read, found by name once for each compile of the graph.
    fn upload_fog(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
    ) -> Result<(), RecordError> {
        let Some(frame) = self.fog.filter(|_| self.fog_declared > 0) else {
            return Ok(());
        };
        let mut found = self.fog_textures;
        let sources = found.get_or(self.graph.compiles(), || {
            let id = |name: &str| {
                self.sampled_id(name)
                    .expect("each step of the volumetric fog reads a planned texture")
            };
            FogVolumeSources {
                lit: FOG_LIGHT.map(id),
                blocks: id(FOG_BLOCKS),
                summed: id(FOG_SUMMED),
                color: id(self.lit_output()),
                depth: id(SCENE_DEPTH),
            }
        });
        self.fog_textures = found;
        let (frame_size, made) = ((self.canvas, self.scale), self.textures_made);
        self.fog_steps()
            .prepare(list, arena, frame_size, &frame, sources, made)
    }

    /// Binds the copy of the camera's opaque color to the scene color and depth that it reads
    /// while it is declared, and finds the texture of its target, once for each compile of the
    /// graph.
    fn bind_transmission(&mut self, list: &mut DrawList) -> Result<(), RecordError> {
        if !self.transmission_declared {
            return Ok(());
        }
        let mut found = self.transmission_target;
        let (color, depth, _) = found.get_or(self.graph.compiles(), || {
            let id = |name: &str| {
                self.sampled_id(name)
                    .expect("the transmission copy reads and writes planned textures")
            };
            (id(SCENE_COLOR), id(SCENE_DEPTH), id(TRANSMISSION_COLOR))
        });
        self.transmission_target = found;
        self.transmission
            .prepare(list, color, depth, self.textures_made)
    }

    /// Binds the composite of the camera's weighted layer to its two sums, and the depth copy to
    /// the scene depth, while the layer is declared. It finds their textures once for each compile
    /// of the graph.
    fn bind_weighted(&mut self, list: &mut DrawList) -> Result<(), RecordError> {
        if !self.weighted_declared {
            return Ok(());
        }
        let mut found = self.weighted_textures;
        let [sum, cover, depth] = found.get_or(self.graph.compiles(), || {
            let id = |name: &str| {
                self.sampled_id(name)
                    .expect("the weighted layer reads planned textures")
            };
            let depth = if self.weighted_copies_depth() {
                id(SCENE_DEPTH)
            } else {
                0
            };
            [id(WEIGHTED_SUM), id(WEIGHTED_COVER), depth]
        });
        self.weighted_textures = found;
        let made = self.textures_made;
        self.weighted.prepare_composite(list, sum, cover, made)?;
        if depth != 0 {
            // WebGL2's backend binds a copy of one sample of a multisampled depth in its place.
            self.weighted
                .prepare_depth(list, depth, self.gpu_culling, made)?;
        }
        Ok(())
    }

    /// Makes the bind groups that custom materials that read the scene's depth bind: one for the
    /// blank texel, which a draw before the copy exists or in another view binds, and one for the
    /// copy of the camera's opaque depth. The groups exist from the frame that first wants the
    /// copy, so a material whose pipeline is ready draws with the blank until the copy draws.
    fn bind_material_scene(&mut self, list: &mut DrawList) -> Result<(), RecordError> {
        self.material_scene_ready = self.material_scene_wanted && self.views > 0;
        if !self.material_scene_ready {
            return Ok(());
        }
        if !self.material_scene_has_blank {
            crate::effects::create_texel(list, self.blank_scene_depth, format::R32_FLOAT)?;
            self.material_scene_has_blank = true;
        }
        let blank = self.blank_scene_depth;
        let camera = self.particle_depth_texture().unwrap_or(blank);
        if self.material_scene_bound == camera && !self.textures_made {
            return Ok(());
        }
        let group = |list: &mut DrawList, id: u32, texture: u32| {
            list.push(
                Op::CreateBindGroup,
                &[
                    id,
                    bind_layout::MATERIAL_SCENE,
                    1,
                    0,
                    resource_kind::TEXTURE,
                    texture,
                    0,
                    0,
                ],
            )
        };
        group(list, self.material_scene, blank)?;
        group(list, self.material_scene + 1, camera)?;
        self.material_scene_bound = camera;
        Ok(())
    }

    /// Binds the copy of the camera's opaque depth to the scene depth while it is declared, and
    /// finds the texture of its target, once for each compile of the graph.
    fn bind_particle_depth(&mut self, list: &mut DrawList) -> Result<(), RecordError> {
        if !self.particle_depth_declared {
            return Ok(());
        }
        let mut found = self.particle_depth_target;
        // The graph culls the copy while no running pass reads it, as in a frame whose only
        // reader shades its opaque objects, so the plan may hold no target for it.
        let targets = found.get_or(self.graph.compiles(), || {
            self.sampled_id(SCENE_DEPTH)
                .zip(self.sampled_id(PARTICLE_DEPTH))
        });
        self.particle_depth_target = found;
        let Some((source, _)) = targets else {
            return Ok(());
        };
        self.particle_depth
            .prepare(list, source, self.textures_made)
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
        if let (true, Some((.., target))) = (copied, self.transmission_target.last()) {
            list.push(Op::GenerateMipmaps, &[target, 0])?;
        }
        Ok(())
    }

    /// Records the objects and settings of ambient occlusion's steps while the screen texture's
    /// steps draw, and binds each step to the textures it reads. While only screen-space
    /// reflections draw, the depth step alone runs, and the other steps' groups bind the depth
    /// copy.
    fn upload_ao(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
    ) -> Result<(), RecordError> {
        let screen = self.screen_draws();
        let projection = match (screen, self.ssr.filter(|_| self.ssr_built)) {
            (true, _) => self.projection,
            (false, Some(frame)) => frame.projection,
            (false, None) => return Ok(()),
        };
        let (ao, contact) = if screen {
            (self.ao, self.contact)
        } else {
            (None, None)
        };
        let id = |name: &str| {
            self.sampled_id(name)
                .expect("each step of ambient occlusion reads a planned texture")
        };
        let depth = id(AO_TARGETS[0]);
        let reflects = self.ssr_draws();
        let sources: StepSources = if screen {
            let horizon = id(AO_TARGETS[1]);
            let trace = if reflects {
                id(SSR_TARGETS[ssr::LEVELS])
            } else {
                depth
            };
            [[id(SCENE_DEPTH); 3], [depth; 3], [depth, horizon, trace]]
        } else {
            [[id(SCENE_DEPTH); 3], [depth; 3], [depth; 3]]
        };
        let (canvas, scale, grid, made) = (
            self.canvas,
            self.scale,
            self.screen_scale(),
            self.textures_made,
        );
        let pass = self
            .ao_pass
            .as_mut()
            .expect("ambient occlusion's steps exist once it is declared");
        pass.prepare(
            list, arena, ao, contact, projection, canvas, scale, grid, &sources, reflects, made,
        )
    }

    /// Records screen-space reflections' objects and settings while they draw, and binds their
    /// steps to the depth copy and the pyramid's levels.
    fn upload_ssr(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
    ) -> Result<(), RecordError> {
        let Some(frame) = self.ssr.filter(|_| self.ssr_draws()) else {
            return Ok(());
        };
        let id = |name: &str| {
            self.sampled_id(name)
                .expect("each step of screen-space reflections reads a planned texture")
        };
        let mut sources = [0; ssr::LEVELS + 1];
        sources[0] = id(AO_TARGETS[0]);
        for level in 1..=ssr::LEVELS {
            sources[level] = id(SSR_TARGETS[level - 1]);
        }
        let grid = ao::corner(self.canvas, self.scale, self.screen_scale());
        let (canvas, scale, made) = (self.canvas, self.scale, self.textures_made);
        self.ssr_steps()
            .prepare(list, arena, &frame, canvas, scale, grid, &sources, made)
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
                texture.size.made(self.canvas, self.scale),
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

    /// Sets the frame's reflection probe filter, which [`Self::record`] records.
    pub(crate) fn set_probe_filter(&mut self, filter: Option<[u32; 10]>) {
        self.probe_filter = filter;
    }

    /// Records the plan's render and compute passes, then `finish`'s commands after them, such as
    /// copies, then submits them all. The graph records the final pass, and `record` the commands
    /// of each other declared pass. Each render pass clears its color targets to `clear`, except
    /// the passes of the outline mask, the skin pass and the motion target, which clear to zero: no
    /// object covers the mask there, no skin drew there, and still surfaces add no motion. A render
    /// pass whose passes all have roles that `skips` names is left out, so its targets keep what
    /// earlier frames drew. The words that differ between a frame that blends a still view and one
    /// that does not are noted for [`FrameGraph::word_marks`]: the accumulation's steps, the
    /// two-step pass's first step and the commands of the final pass or its still build.
    pub(crate) fn record(
        &mut self,
        list: &mut DrawList,
        clear: impl Fn(ViewId) -> [f32; 4],
        skips: impl Fn(Role) -> bool,
        mut record: impl FnMut(&mut DrawList, Role) -> Result<(), RecordError>,
        finish: impl FnOnce(&mut DrawList) -> Result<(), RecordError>,
    ) -> Result<(), RecordError> {
        let mut marks = std::mem::take(&mut self.word_marks);
        marks.clear();
        let recorded = self.record_steps(list, clear, skips, &mut record, finish, &mut marks);
        self.word_marks = marks;
        recorded
    }

    /// Records the plan's passes for [`FrameGraph::record`], and notes the words that a still view
    /// changes in `marks`.
    fn record_steps(
        &self,
        list: &mut DrawList,
        clear: impl Fn(ViewId) -> [f32; 4],
        skips: impl Fn(Role) -> bool,
        record: &mut impl FnMut(&mut DrawList, Role) -> Result<(), RecordError>,
        finish: impl FnOnce(&mut DrawList) -> Result<(), RecordError>,
        marks: &mut Vec<Range<usize>>,
    ) -> Result<(), RecordError> {
        let plan = self
            .graph
            .plan()
            .expect("the graph compiled before the frame records");
        // The camera's passes read the capture views' targets, so the plan orders every capture
        // pass before them, and the probe's filter runs between.
        let mut filter = self.probe_filter;
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
                    let camera = passes.iter().any(|&pass| {
                        matches!(
                            self.roles[pass.index()],
                            Role::Prepass(ViewId::CAMERA) | Role::Opaque(ViewId::CAMERA)
                        )
                    });
                    if camera && let Some(words) = filter.take() {
                        list.push(Op::ProbeFilter, &words)?;
                    }
                    // A step of passes that a still view's frame swaps for others is left out of the
                    // still comparison whole: its render pass's load operations may differ too.
                    let swapped_step = passes
                        .iter()
                        .all(|&pass| still_swaps(self.roles[pass.index()]));
                    let step_start = list.len();
                    let finals = passes.iter().any(|&pass| {
                        let role = self.roles[pass.index()];
                        // The two-step pass reads the meter's texel in its first step, so the meter
                        // records before that step.
                        if self.two_step_runs() {
                            matches!(role, Role::Output | Role::OutputBloom)
                        } else {
                            matches!(role, Role::Final | Role::FinalBloom)
                        }
                    });
                    if finals && let Some(meter) = self.exposure_pass.as_ref() {
                        meter.record(list)?;
                    }
                    // The outline mask, the weighted layer's sums and the skin pass's light start
                    // from nothing; so does the pick's id target, whose 0 names no object.
                    let masks = passes.iter().any(|&pass| {
                        matches!(
                            self.roles[pass.index()],
                            Role::OutlineMask
                                | Role::SkinLight
                                | Role::Motion
                                | Role::Weighted
                                | Role::Pick
                        )
                    });
                    let clear = if masks {
                        [0.0; 4]
                    } else {
                        clear(self.view_of(passes))
                    };
                    self.begin_render_pass(list, plan, step, clear)?;
                    self.set_render_area(list, size, self.step_rect(plan, step))?;
                    for &pass in plan.passes(step) {
                        let role = self.roles[pass.index()];
                        // Where the final pass and its still build share a step with other passes,
                        // the frame records one of them, and the still comparison leaves out which.
                        let swapped = still_swaps(role);
                        if swapped && !self.draws(role) {
                            continue;
                        }
                        let pass_start = list.len();
                        match role {
                            Role::Final | Role::FinalBloom if self.two_step_runs() => {
                                self.final_pass.record_present(list)?
                            }
                            Role::Final => self.final_pass.record(list, false)?,
                            Role::FinalBloom => self.final_pass.record(list, true)?,
                            Role::FinalStill => self.still_pass.record(list, false)?,
                            Role::Accumulate => self.accumulate.record(list)?,
                            Role::Output => self.output_pass.record(list, false)?,
                            Role::OutputBloom => self.output_pass.record(list, true)?,
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
                                    ao::corner(self.canvas, self.scale, self.screen_scale()),
                                )?,
                            Role::Ssr(step) => {
                                let grid = ao::corner(self.canvas, self.scale, self.screen_scale());
                                let step = usize::from(step);
                                let corner = if step < ssr::LEVELS {
                                    ssr::level_corner(grid, step + 1)
                                } else {
                                    grid
                                };
                                self.ssr_pass
                                    .as_ref()
                                    .expect("screen-space reflections' passes run once declared")
                                    .record(list, step, corner)?
                            }
                            Role::Effect(index) => {
                                let unit = self.effect_units[usize::from(index)];
                                self.effect_pass
                                    .as_ref()
                                    .expect("effects run only on the HDR path")
                                    .record_with_maps(
                                        list,
                                        unit,
                                        &self.effects[usize::from(unit.first)].maps,
                                    )?;
                            }
                            Role::Dof(step) => self
                                .dof_pass
                                .as_ref()
                                .expect("depth of field's steps run once they are declared")
                                .record(list, usize::from(step))?,
                            Role::Subsurface(step) => self
                                .subsurface_pass
                                .as_ref()
                                .expect("the subsurface blur's steps run once they are declared")
                                .record(list, usize::from(step))?,
                            Role::FogLight(parity) => {
                                let fog = self.fog_steps_ref();
                                fog.begin_light(list)?;
                                record(list, Role::FogLight(parity))?;
                                fog.draw(list)?;
                            }
                            Role::FogBlock => self.fog_steps_ref().record(list, 1)?,
                            Role::FogSum => self.fog_steps_ref().record(list, 2)?,
                            Role::FogApply => self.fog_steps_ref().record(list, 3)?,
                            Role::ViewCopy(view) => {
                                if let Some(copies) = self.view_copies.as_ref() {
                                    copies.record(list, view.index())?;
                                }
                            }
                            Role::Fullscreen(view) => {
                                let place = view.index();
                                if let Some(pass) = self.declared_views[place].fullscreen_pass() {
                                    self.fullscreen.record(list, place, pass)?;
                                }
                            }
                            Role::TransmissionCopy => self.transmission.record(list)?,
                            Role::MotionView => self.motion_step.record(list)?,
                            Role::Weighted => {
                                if self.weighted_copies_depth() {
                                    self.weighted.record_depth(list)?;
                                }
                                record(list, Role::Weighted)?;
                            }
                            Role::WeightedComposite => self.weighted.record_composite(list)?,
                            Role::ParticleDepthCopy => self.particle_depth.record(list)?,
                            role => record(list, role)?,
                        }
                        if swapped && !swapped_step {
                            marks.push(pass_start..list.len());
                        }
                    }
                    list.push(Op::EndRenderPass, &[])?;
                    self.make_transmission_levels(list, passes)?;
                    if swapped_step {
                        marks.push(step_start..list.len());
                    }
                }
            }
        }
        finish(list)?;
        list.push(Op::Submit, &[])?;
        Ok(())
    }

    /// False for a step of bloom that the frame drops, as the governor's step drops the last
    /// level, and for the passes that a still view's frame draws in place of others, or others in
    /// place of them. Every other pass draws.
    fn draws(&self, role: Role) -> bool {
        match (role, &self.bloom_pass) {
            (Role::Bloom(step), Some(bloom)) => bloom.draws(usize::from(step)),
            // The first step runs only below the whole canvas's scale; at the whole canvas the final
            // pass reads the scene color as it always did.
            (Role::Output | Role::OutputBloom, _) => self.two_step_runs() && !self.accumulate_on,
            // A still view draws its accumulated color in place of the final pass.
            (Role::Final | Role::FinalBloom, _) => !self.accumulate_on,
            (Role::Accumulate | Role::FinalStill, _) => self.accumulate_on,
            (Role::FogLight(parity), _) => self
                .fog_pass
                .as_ref()
                .is_some_and(|fog| fog.parity() == usize::from(parity)),
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
        let mut second = NO_TARGET;
        let mut flags = 0;
        for attachment in plan.attachments(step) {
            let (clears, stores) = if attachment.depth {
                depth = self.attachment_id(attachment.texture, attachment.layer);
                (pass_flags::CLEAR_DEPTH, pass_flags::STORE_DEPTH)
            } else if color != NO_TARGET {
                // Only the weighted layer draws into a second color target: its two sums, which
                // both clear and both store.
                debug_assert!(
                    second == NO_TARGET && attachment.resolve.is_none(),
                    "a render pass draws into at most two color targets, the second of one sample"
                );
                second = self.attachment_id(attachment.texture, attachment.layer);
                (pass_flags::CLEAR_COLOR, pass_flags::STORE_COLOR)
            } else {
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
        let operands = [
            color,
            resolve,
            depth,
            r.to_bits(),
            g.to_bits(),
            b.to_bits(),
            a.to_bits(),
            0f32.to_bits(),
            flags,
            second,
        ];
        let count = if second == NO_TARGET { 9 } else { 10 };
        list.push(Op::BeginRenderPass, &operands[..count])?;
        Ok(())
    }

    /// The rectangle of the canvas that a step draws into, for a step of a view that draws into
    /// one: its passes all belong to that view. `None` for any other step.
    fn step_rect(&self, plan: &Plan, step: &Step) -> Option<CanvasRect> {
        plan.passes(step)
            .iter()
            .find_map(|&pass| role_view(self.roles[pass.index()]))
            .and_then(|view| self.declared_views.get(view.index())?.canvas_rect())
    }

    /// Limits the render pass to the rectangle of the canvas that a view draws into, or to the
    /// corner of its targets that a step of `size` draws into at the frame's render scale. A
    /// render pass starts with its whole targets, so a step that draws into all of them records
    /// nothing.
    fn set_render_area(
        &self,
        list: &mut DrawList,
        size: Size,
        rect: Option<CanvasRect>,
    ) -> Result<(), RecordError> {
        if let Some(rect) = rect {
            let (x, y, width, height) = rect.area(self.canvas, self.scale);
            list.push(
                Op::SetViewport,
                &[x, y, width, height, 0f32.to_bits(), 1f32.to_bits()],
            )?;
            list.push(Op::SetScissor, &[x, y, width, height])?;
            return Ok(());
        }
        let (width, height) = size.viewport(self.canvas, self.scale);
        if (width, height) == size.made(self.canvas, self.scale) {
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
        self.accumulate.reset_gpu();
        self.still_pass.reset_gpu();
        self.output_pass.reset_gpu();
        if let Some(bloom) = self.bloom_pass.as_mut() {
            bloom.reset_gpu();
        }
        if let Some(ao) = self.ao_pass.as_mut() {
            ao.reset_gpu();
        }
        if let Some(ssr) = self.ssr_pass.as_mut() {
            ssr.reset_gpu();
        }
        self.last_view = None;
        self.fullscreen.reset_gpu();
        if let Some(effects) = self.effect_pass.as_mut() {
            effects.reset_gpu();
        }
        if let Some(dof) = self.dof_pass.as_mut() {
            dof.reset_gpu();
        }
        if let Some(subsurface) = self.subsurface_pass.as_mut() {
            subsurface.reset_gpu();
        }
        if let Some(meter) = self.exposure_pass.as_mut() {
            meter.reset_gpu();
        }
        if let Some(fog) = self.fog_pass.as_mut() {
            fog.reset_gpu();
        }
        if let Some(copies) = self.view_copies.as_mut() {
            copies.reset_gpu();
        }
        self.transmission.reset_gpu();
        self.motion_step.reset_gpu();
        self.weighted.reset_gpu();
        self.particle_depth.reset_gpu();
        // The blank texel and the two groups belong to the device that was lost.
        self.material_scene_has_blank = false;
        self.material_scene_bound = 0;
        self.material_scene_ready = false;
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

/// The format of the targets of views other than the camera's, which materials sample: the scene
/// color's on the HDR path, and 8-bit sRGB color on the 8-bit path, whose texels materials read
/// back as linear color.
fn view_target_format(scene_color: SceneColor) -> u32 {
    if scene_color.is_hdr() {
        scene_color.format()
    } else {
        format::RGBA8_UNORM_SRGB
    }
}

/// The size that a view draws at: its target's size in texels, or the render size halved as many
/// times as its target says.
fn view_size(view: &View) -> Size {
    view.target().graph_size()
}

/// The view of a pass that draws a scene's objects, or `None` for a pass of another kind.
fn role_view(role: Role) -> Option<ViewId> {
    match role {
        Role::Opaque(view) | Role::Prepass(view) | Role::Transparent(view) => Some(view),
        _ => None,
    }
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
/// the camera's view, the target of every view that a texture shows, but a full-screen pass that
/// reads what the camera's view draws, whose image of the frame before it shows, and for any other
/// view, the targets that it names.
fn reads_targets(mut pass: Pass, views: &[View], named: &[ViewPassNames], index: usize) -> Pass {
    if index == ViewId::CAMERA.index() {
        for (other, view) in views.iter().enumerate().skip(1) {
            let after = view.fullscreen_pass().is_some_and(Fullscreen::reads_scene);
            if !view.is_removed() && view.target().shown && !after {
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
    use null3d_gpu::drawlist::template::{self, CUSTOM_FIRST as CUSTOM};
    use null3d_gpu::drawlist::{layout as bind_layout, permutation, resource_kind};

    #[test]
    fn a_mirror_view_fills_its_texture_at_a_share_of_the_render_size_and_culls_once() {
        let mut frames = frame_graph(format::RGBA16_FLOAT, Antialias::Msaa, true, false);
        frames.set_occlusion(true);
        let mirror = crate::mirror::Mirror::new([0.0, 1.0, 0.0], [0.0; 3]).unwrap();
        let mut reflection = View::mirror(mirror, None, None).with_target(ViewTarget {
            shown: true,
            ..ViewTarget::default()
        });
        reflection.follow_camera(1, 1);
        frames.sync(&[View::default(), reflection, shown()]);
        let size = |view: usize| frames.graph().pass_size(frames.opaque[view].1);
        assert_eq!(size(1), Size::Scaled(1));
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
        assert_eq!(
            frames.graph().pass_size(frames.opaque[1].1),
            Size::Scaled(2)
        );
    }

    #[test]
    fn a_mirror_views_texture_is_made_again_at_each_new_render_scale() {
        let mut frames = frame_graph(format::RGBA16_FLOAT, Antialias::Fxaa, true, false);
        frames.set_scaling(true);
        let mirror = crate::mirror::Mirror::new([0.0, 1.0, 0.0], [0.0; 3]).unwrap();
        let mut reflection = View::mirror(mirror, None, None).with_target(ViewTarget {
            shown: true,
            ..ViewTarget::default()
        });
        reflection.follow_camera(1, 1);
        frames.sync(&[View::default(), reflection]);
        let mut list = DrawList::with_capacity(256);
        let half = RenderScale::from_thousandths(500);
        let made = |frames: &FrameGraph| frames.made.iter().map(|made| made.1).collect::<Vec<_>>();
        frames.prepare(&mut list, (64, 48), half).unwrap();
        assert!(frames.textures_made());
        assert!(
            made(&frames).contains(&(16, 12)),
            "half of the render size of 32 x 24: {:?}",
            made(&frames)
        );
        frames.prepare(&mut list, (64, 48), half).unwrap();
        assert!(!frames.textures_made(), "the same scale makes nothing");
        frames
            .prepare(&mut list, (64, 48), RenderScale::FULL)
            .unwrap();
        assert!(frames.textures_made());
        assert!(made(&frames).contains(&(32, 24)));
        assert!(!made(&frames).contains(&(16, 12)));
        // The camera's own targets keep the canvas's size at any render scale.
        assert!(made(&frames).contains(&(64, 48)));
    }

    /// A full-screen pass of template 70 that reads `source`, of half the render size.
    fn fullscreen(source: PassSource, shown: bool) -> View {
        let pass = Fullscreen {
            template: 70,
            source,
            depth: false,
            values: [0.0; effects::EFFECT_FLOATS],
            maps: EffectMaps::NONE,
        };
        View::fullscreen(
            pass,
            ViewTarget {
                halvings: 1,
                shown,
                ..ViewTarget::default()
            },
        )
    }

    /// The step of each named pass in the plan, or `None` for a pass that does not run.
    fn step_of(frames: &FrameGraph, name: &str) -> Option<usize> {
        steps(frames)
            .iter()
            .position(|step| step.iter().any(|pass| pass == name))
    }

    #[test]
    fn a_full_screen_pass_fills_a_share_of_the_render_size_before_the_camera_that_shows_it() {
        let mut frames = frame_graph(format::RGBA16_FLOAT, Antialias::Fxaa, true, false);
        frames.sync(&[View::default(), fullscreen(PassSource::None, true)]);
        let mut list = DrawList::with_capacity(256);
        frames
            .prepare(&mut list, (64, 48), RenderScale::from_thousandths(500))
            .unwrap();
        let pass = frames
            .graph()
            .find_pass("Opaque1")
            .expect("the pass is declared");
        assert_eq!(frames.graph().pass_kind(pass), PassKind::Fullscreen);
        assert_eq!(frames.graph().pass_size(pass), Size::Scaled(1));
        assert_eq!(
            Size::Scaled(1).viewport((64, 48), RenderScale::from_thousandths(500)),
            (16, 12)
        );
        // The pass's shader fills the texture that the frame made, not a share of the canvas.
        let mut arena = UploadArena::default();
        arena.reset(4096);
        frames.upload_fullscreen(&mut list, &mut arena).unwrap();
        assert_eq!(frames.fullscreen.drawn(1), Some([16.0, 12.0, 12.0, 1.0]));
        assert!(
            frames.graph().find_pass("Culling1").is_none(),
            "a pass culls nothing"
        );
        assert!(frames.graph().find_pass("Transparent1").is_none());
        let pass_step = step_of(&frames, "Opaque1").expect("a texture shows the pass");
        assert!(pass_step < step_of(&frames, "Opaque").unwrap());
        assert!(frames.view_target(ViewId::from_index(1)).is_some());
        // A pass that nothing shows or reads does not run.
        frames.sync(&[View::default(), fullscreen(PassSource::None, false)]);
        frames
            .prepare(&mut list, (64, 48), RenderScale::FULL)
            .unwrap();
        assert_eq!(step_of(&frames, "Opaque1"), None);
    }

    #[test]
    fn a_full_screen_pass_that_reads_the_scene_runs_after_it_for_the_effect_that_reads_it() {
        let mut frames = frame_graph(format::CANVAS, Antialias::Msaa, true, false);
        let views = [View::default(), fullscreen(PassSource::SceneColor, true)];
        frames.sync(&views);
        let mut list = DrawList::with_capacity(256);
        frames
            .prepare(&mut list, (64, 64), RenderScale::FULL)
            .unwrap();
        // Shown alone, it still runs, after the camera's passes, so a material shows the frame
        // before; the 8-bit path's final pass takes the place of the resolve pass.
        let pass_step = step_of(&frames, "Opaque1").expect("a shown pass runs");
        assert!(pass_step > step_of(&frames, "Opaque").unwrap());
        assert_eq!(step_of(&frames, "Resolve"), None);
        assert!(step_of(&frames, "Final").is_some());

        let mut frames = frame_graph(format::RGBA16_FLOAT, Antialias::Fxaa, true, false);
        let effect = Effect {
            template: 64,
            depth: false,
            values: [0.0; effects::EFFECT_FLOATS],
            maps: EffectMaps {
                views: 1 << 1,
                ..EffectMaps::NONE
            },
        };
        frames.set_effects(&[effect], &EffectJoins::default(), [0.0; 2], None);
        frames.sync(&[View::default(), fullscreen(PassSource::SceneColor, false)]);
        frames
            .prepare(&mut list, (64, 64), RenderScale::FULL)
            .unwrap();
        let pass_step = step_of(&frames, "Opaque1").expect("the effect reads the pass");
        let effect_step = steps(&frames)
            .iter()
            .position(|step| step.iter().any(|pass| pass.starts_with("Effect")))
            .expect("the effect runs");
        assert!(step_of(&frames, "Transparent").is_none_or(|camera| camera < pass_step));
        assert!(pass_step < effect_step);
    }

    #[test]
    fn views_after_the_camera_take_their_number_in_their_names() {
        assert_eq!(view_name(0, "sceneColor", "color"), "sceneColor");
        assert_eq!(view_name(1, "sceneColor", "color"), "color1");
        assert_eq!(view_name(10, "Opaque", "Opaque"), "Opaque10");
        assert_eq!(view_name(31, "Opaque", "Opaque"), "Opaque31");
    }

    #[test]
    fn a_frame_that_reads_the_scene_depth_makes_the_copy_and_its_groups() {
        let mut frames = frame_graph(format::RGBA16_FLOAT, Antialias::Fxaa, true, false);
        frames.sync(&[View::default()]);
        // A custom material reads the depth, with no particle system on the scene.
        frames.set_soft_particles(true, true);
        let mut pipelines = PipelineCache::default();
        let mut list = DrawList::with_capacity(4096);
        // The first frame asks for the copy's pipeline; the next frame, which has it built,
        // declares the copy.
        frames
            .prepare(&mut list, (64, 64), RenderScale::FULL)
            .unwrap();
        frames.request_pipelines(&mut pipelines, 0);
        frames.sync(&[View::default()]);
        frames
            .prepare(&mut list, (64, 64), RenderScale::FULL)
            .unwrap();
        // The frame declares the copy. Nothing blends in this frame, so the graph culls the copy
        // with the transparent pass that reads it.
        assert!(frames.particle_depth_declared);

        let mut arena = UploadArena::default();
        arena.reset(frames.upload_bound());
        list.clear();
        frames
            .upload(&mut list, &mut arena, Output::default(), Grading::default())
            .unwrap();
        // The camera's group differs from the blank one, so a draw before the copy exists binds
        // the texel at the far plane.
        let camera = frames.material_scene_group(ViewId::CAMERA);
        let blank = frames.material_scene_blank();
        assert_ne!(camera, 0);
        assert_ne!(blank, 0);
        assert_ne!(camera, blank);
        assert_ne!(frames.material_scene_group(ViewId::from_index(1)), camera);
        let mut made_blank = false;
        let mut made_groups = 0;
        for command in null3d_gpu::drawlist::decode(list.words()) {
            let command = command.unwrap();
            if command.op == Op::CreateTexture && command.operands[0] == IDS.blank_scene_depth {
                made_blank = true;
            } else if command.op == Op::CreateBindGroup
                && (command.operands[0] == camera || command.operands[0] == blank)
            {
                made_groups += 1;
            }
        }
        assert!(made_blank);
        assert_eq!(made_groups, 2);
    }

    /// The ids that the test graphs give their GPU objects. A builder chains each kind of object
    /// in a run of its own, and this table keeps that order and spacing: the buffers, the samplers
    /// and the compute pipelines take one number each from their own bands, and the bind groups
    /// sit in bands that hold every id of a group that takes several, so no two objects of one
    /// kind can share an id. The textures sit above the ids a graph takes for the plan's own
    /// targets and their layer views.
    const IDS: GraphIds = GraphIds {
        first_texture: 1,
        final_pass: FinalIds {
            settings: 9,
            group: 9,
            blank_lut: 900,
            lut_sampler: 9,
            blank_outline: 901,
        },
        accumulate: AccumulateIds {
            buffer: 930,
            group: 930,
        },
        still_pass: FinalIds {
            settings: 931,
            group: 931,
            blank_lut: 932,
            lut_sampler: 933,
            blank_outline: 934,
        },
        output_pass: FinalIds {
            settings: 19,
            group: 200,
            blank_lut: 902,
            lut_sampler: 17,
            blank_outline: 903,
        },
        present_group: 201,
        bloom: BloomIds {
            buffer: 10,
            sampler: 10,
            first_group: 10,
        },
        ao: AoIds {
            buffer: 11,
            first_group: 30,
        },
        effects: EffectIds {
            buffer: 12,
            sampler: 12,
            first_group: 40,
            blank_depth: 904,
        },
        fullscreen: FullscreenIds {
            buffer: 14,
            sampler: 14,
            first_group: 150,
            blank_color: 905,
            blank_depth: 906,
        },
        dof: DofIds {
            buffer: 13,
            sampler: 13,
            first_group: 100,
        },
        exposure: ExposureIds {
            buffer: 15,
            sampler: 15,
            cells: 907,
            texel: 908,
            stored: 909,
            first_group: 130,
            compute: Some(crate::exposure::ComputeIds {
                histogram: 16,
                state: 17,
                pipelines: [700, 701],
            }),
        },
        fog: FogVolumeIds {
            buffer: 18,
            sampler: 16,
            first_group: 110,
        },
        view_copy: Some(ViewCopyIds { first_group: 60 }),
        transmission: TransmissionIds {
            group: 120,
            blank: 910,
        },
        subsurface: SubsurfaceIds {
            buffer: 20,
            first_group: 210,
        },
        // The reflections' own bands, clear of the view copies' groups, which take 32 ids from 60.
        motion: MotionIds {
            buffer: 22,
            group: 125,
            sampler: 18,
            blank: 911,
        },
        // The reflections' own bands, clear of the view copies' groups, which take 32 ids from 60.
        ssr: SsrIds {
            buffer: 21,
            first_group: 220,
        },
        weighted: WeightedIds { first_group: 140 },
        particle_depth: 121,
        material_scene: 122,
        blank_scene_depth: 902,
    };

    /// One run of ids of a test graph's table: what the first one names, its id, and how many ids
    /// the group it belongs to takes from there.
    type IdRun = (String, u32, u32);

    /// Every id of a test graph's table, by the kind of GPU object each one names. Two objects of
    /// one kind that share an id are one object to a backend, which then loses or destroys the
    /// other, so a table whose ids collide tests a graph that no builder would make. Rust has no
    /// reflection, so the walk lists each field of [`IDS`] by hand, and takes the number of ids a
    /// group takes from the code that takes them.
    fn ids_by_kind() -> Vec<(&'static str, Vec<IdRun>)> {
        let (mut buffers, mut textures) = (Vec::new(), Vec::new());
        let (mut samplers, mut groups, mut pipelines) = (Vec::new(), Vec::new(), Vec::new());
        let mut final_pass = |what: &str, ids: FinalIds| {
            buffers.push((format!("{what} settings"), ids.settings, 1));
            textures.push((format!("{what} blank table"), ids.blank_lut, 1));
            textures.push((format!("{what} blank outline"), ids.blank_outline, 1));
            samplers.push((format!("{what} table sampler"), ids.lut_sampler, 1));
            groups.push((format!("{what} group"), ids.group, 1));
        };
        final_pass("the final pass's", IDS.final_pass);
        final_pass("the output pass's", IDS.output_pass);
        groups.push(("the present group".to_string(), IDS.present_group, 1));
        buffers.push(("bloom's block".to_string(), IDS.bloom.buffer, 1));
        samplers.push(("bloom's sampler".to_string(), IDS.bloom.sampler, 1));
        groups.push((
            "bloom's groups".to_string(),
            IDS.bloom.first_group,
            bloom::STEPS as u32,
        ));
        buffers.push(("ambient occlusion's block".to_string(), IDS.ao.buffer, 1));
        groups.push((
            "ambient occlusion's groups".to_string(),
            IDS.ao.first_group,
            ao::STEPS as u32,
        ));
        buffers.push(("the effects' block".to_string(), IDS.effects.buffer, 1));
        samplers.push(("the effects' sampler".to_string(), IDS.effects.sampler, 1));
        textures.push((
            "the effects' blank depth".to_string(),
            IDS.effects.blank_depth,
            1,
        ));
        groups.push((
            "the effects' groups".to_string(),
            IDS.effects.first_group,
            EffectPass::GROUPS,
        ));
        buffers.push((
            "full-screen passes' block".to_string(),
            IDS.fullscreen.buffer,
            1,
        ));
        samplers.push((
            "full-screen passes' sampler".to_string(),
            IDS.fullscreen.sampler,
            1,
        ));
        textures.push((
            "full-screen passes' blank color".to_string(),
            IDS.fullscreen.blank_color,
            1,
        ));
        textures.push((
            "full-screen passes' blank depth".to_string(),
            IDS.fullscreen.blank_depth,
            1,
        ));
        groups.push((
            "full-screen passes' groups".to_string(),
            IDS.fullscreen.first_group,
            crate::view::MAX_VIEWS as u32,
        ));
        buffers.push(("depth of field's block".to_string(), IDS.dof.buffer, 1));
        samplers.push(("depth of field's sampler".to_string(), IDS.dof.sampler, 1));
        groups.push((
            "depth of field's groups".to_string(),
            IDS.dof.first_group,
            dof::STEPS as u32,
        ));
        buffers.push(("the meter's block".to_string(), IDS.exposure.buffer, 1));
        samplers.push(("the meter's sampler".to_string(), IDS.exposure.sampler, 1));
        textures.push(("the meter's cells".to_string(), IDS.exposure.cells, 1));
        textures.push(("the exposure's texel".to_string(), IDS.exposure.texel, 1));
        textures.push((
            "the exposure's stored texel".to_string(),
            IDS.exposure.stored,
            1,
        ));
        groups.push((
            "the meter's groups".to_string(),
            IDS.exposure.first_group,
            crate::exposure::GROUPS,
        ));
        let compute = IDS
            .exposure
            .compute
            .expect("the test graphs take the histogram's objects");
        buffers.push(("the histogram's bins".to_string(), compute.histogram, 1));
        buffers.push(("the stored exposure".to_string(), compute.state, 1));
        pipelines.extend(
            compute
                .pipelines
                .map(|id| ("a compute pipeline".to_string(), id, 1)),
        );
        buffers.push(("the fog's block".to_string(), IDS.fog.buffer, 1));
        samplers.push(("the fog's sampler".to_string(), IDS.fog.sampler, 1));
        groups.push((
            "the fog's groups".to_string(),
            IDS.fog.first_group,
            fog_volume::GROUPS,
        ));
        groups.push((
            "the copies of views".to_string(),
            IDS.view_copy
                .expect("the test graphs copy views")
                .first_group,
            crate::view::MAX_VIEWS as u32,
        ));
        groups.push((
            "the transmission copy".to_string(),
            IDS.transmission.group,
            1,
        ));
        textures.push((
            "the transmission blank".to_string(),
            IDS.transmission.blank,
            1,
        ));
        groups.push((
            "the weighted layer's groups".to_string(),
            IDS.weighted.first_group,
            WeightedIds::GROUPS,
        ));
        buffers.push((
            "the subsurface blur's block".to_string(),
            IDS.subsurface.buffer,
            1,
        ));
        groups.push((
            "the subsurface blur's groups".to_string(),
            IDS.subsurface.first_group,
            subsurface::STEPS as u32,
        ));
        buffers.push(("the reflections' block".to_string(), IDS.ssr.buffer, 1));
        groups.push((
            "the reflections' groups".to_string(),
            IDS.ssr.first_group,
            ssr::STEPS as u32,
        ));
        groups.push(("the particle depth copy".to_string(), IDS.particle_depth, 1));
        groups.push((
            "the materials' scene groups".to_string(),
            IDS.material_scene,
            2,
        ));
        textures.push((
            "the materials' blank depth".to_string(),
            IDS.blank_scene_depth,
            1,
        ));
        buffers.push(("the motion view's block".to_string(), IDS.motion.buffer, 1));
        samplers.push((
            "the motion view's sampler".to_string(),
            IDS.motion.sampler,
            1,
        ));
        textures.push((
            "the motion view's blank map".to_string(),
            IDS.motion.blank,
            1,
        ));
        groups.push(("the motion view's step".to_string(), IDS.motion.group, 1));
        // The graph takes its own textures from `first_texture` on: one for each texture of its
        // plan and one view for each of their layers, each run at most [`LAYER_VIEWS`] long.
        textures.push((
            "the plan's textures and views".to_string(),
            IDS.first_texture,
            3 * LAYER_VIEWS,
        ));
        vec![
            ("buffer", buffers),
            ("texture", textures),
            ("sampler", samplers),
            ("bind group", groups),
            ("compute pipeline", pipelines),
        ]
    }

    #[test]
    fn the_test_graphs_ids_are_distinct_within_each_kind() {
        for (kind, runs) in ids_by_kind() {
            let mut ids: Vec<(u32, String)> = Vec::new();
            for (what, first, count) in runs {
                for id in first..first + count {
                    ids.push((id, what.clone()));
                }
            }
            ids.sort_unstable();
            for pair in ids.windows(2) {
                let [(id, what), (next, next_what)] = pair else {
                    unreachable!("a window holds two ids");
                };
                assert_ne!(
                    id, next,
                    "two {kind}s share the id {id}: {what} and {next_what}"
                );
            }
        }
    }

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
        let mut graph = FrameGraph::new(gpu_culling, canvas, transient, IDS);
        // These tests check the passes of frames that draw as a moving view's do; the still
        // accumulation's passes have a test of their own.
        graph.still_enabled = false;
        graph
    }

    #[test]
    fn the_hdr_path_declares_the_still_blend_and_build_where_the_page_lets_a_view_accumulate() {
        for (format, declared) in [(format::RGBA16_FLOAT, true), (format::CANVAS, false)] {
            let mut frames = frame_graph(format, Antialias::Msaa, true, false);
            frames.set_still_enabled(true);
            frames.sync(&[View::default()]);
            let graph = frames.graph();
            for name in ["Accumulate", "FinalStill"] {
                assert_eq!(graph.find_pass(name).is_some(), declared, "{name}");
            }
            assert_eq!(frames.still_declared, declared);
            // The blend's weight and the still build's settings each take a block of the frame's
            // upload arena, so the bound grows by both where the graph declares them.
            let moving = frame_graph(format, Antialias::Msaa, true, false).upload_bound();
            let blocks = accumulate::UPLOAD_BYTES + FinalPass::UPLOAD_BYTES;
            assert_eq!(
                frames.upload_bound(),
                moving + if declared { blocks } else { 0 }
            );
            // Without a built pipeline no frame may blend yet.
            assert!(!frames.still_eligible());
            frames.set_still_enabled(false);
            assert!(frames.graph().find_pass("Accumulate").is_none());
        }
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
    fn a_custom_tone_curve_reaches_the_first_step_while_the_scale_can_drop() {
        // The curve reaches both steps of the final pass, so a frame below the whole canvas's scale
        // draws its first step, and the second, with the curve's builds and not the pass's own.
        let mut frames = frame_graph(format::RGBA16_FLOAT, Antialias::Msaa, true, false);
        frames.sync(&[View::default()]);
        frames.set_scaling(true);
        frames.set_bloom(Some(Bloom::default()), ChainFrame::default());
        frames.set_tone_curve(Some(CUSTOM));
        let mut pipelines = PipelineCache::default();
        frames.request_pipelines(&mut pipelines, 0);
        let templates: Vec<u32> = pipelines.keys().iter().map(|key| key.template).collect();
        // The curve's plain and bloom builds come first, and the first step draws with the bloom
        // one. Neither step keeps a build of the pass's own curves.
        assert_eq!(templates[..2], [CUSTOM, CUSTOM + 1]);
        assert!(!templates.contains(&template::FINAL_BLOOM));
        // The second step always scales plainly.
        assert!(templates.contains(&template::FINAL));
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
            // This graph draws as a moving view's does, so the accumulation's blocks are not in
            // the bound.
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
                assert_eq!(
                    frames.upload_bound(),
                    FinalPass::UPLOAD_BYTES + bloom,
                    "a moving view's frames"
                );
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
            .record(
                &mut list,
                |_| [0.0; 4],
                |_| false,
                |_, _| Ok(()),
                |_| Ok(()),
            )
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
            .record(
                &mut list,
                |_| [0.0; 4],
                |_| false,
                |_, _| Ok(()),
                |_| Ok(()),
            )
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
        frames.request_pipelines(&mut PipelineCache::default(), 0);
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
        let record = |frames: &mut FrameGraph, list: &mut DrawList| {
            list.clear();
            frames
                .record(list, |_| [0.0; 4], |_| false, |_, _| Ok(()), |_| Ok(()))
                .unwrap();
            (
                operands(list, Op::BeginRenderPass).len(),
                operands(list, Op::SetViewport),
            )
        };
        let (passes, viewports) = record(&mut frames, &mut list);
        // The scene's corner, then each level's whole target: the base first, the default weights'
        // widest level, and the base again for its step up. The two widest levels have no weight,
        // so they do not draw.
        assert_eq!(viewports[0][2..4], [960, 540]);
        assert_eq!(viewports[1][2..4], [910, 512]);
        assert_eq!(viewports[8][2..4], [8, 4]);
        // The two-step pass draws the first step's whole render size, after bloom's levels.
        assert_eq!(viewports.last().unwrap()[2..4], [960, 540]);
        assert_eq!(viewports.len(), 2 + 15);

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
        let (halved, viewports) = record(&mut frames, &mut list);
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
        // The chain's levels, and the two-step pass's own target, which the declarations hold
        // whenever the render scale can drop.
        assert_eq!(plan.textures().len(), without + LEVELS - 1 + 1);
        assert!(frames.graph().find_pass(BLOOM_DOWN[LEVELS - 1]).is_none());

        // Off again, the steps and their targets are gone.
        frames.set_bloom(None, chain);
        frames.sync(&[View::default()]);
        frames
            .prepare(&mut list, canvas, RenderScale::FULL)
            .unwrap();
        assert_eq!(frames.graph().plan().unwrap().textures().len(), without + 1);
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
            maps: EffectMaps::NONE,
        };
        let chain = [
            effect(CUSTOM, false),
            effect(CUSTOM + 1, true),
            effect(CUSTOM + 2, false),
        ];
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
            .filter(|key| key.template >= CUSTOM)
            .map(|key| (key.template, key.permutation))
            .collect();
        assert_eq!(
            templates,
            [
                (CUSTOM, 0),
                (CUSTOM + 1, permutation::DEPTH_MULTISAMPLED),
                (CUSTOM + 2, 0)
            ]
        );
        let mut arena = UploadArena::default();
        arena.reset(frames.upload_bound());
        list.clear();
        frames
            .upload(&mut list, &mut arena, Output::default(), Grading::default())
            .unwrap();
        let layouts: Vec<u32> = operands(&list, Op::CreateBindGroup)
            .iter()
            .filter(|group| {
                (IDS.effects.first_group..IDS.effects.first_group + EffectPass::GROUPS)
                    .contains(&group[0])
            })
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
            template: CUSTOM,
            depth: false,
            values: [0.0; effects::EFFECT_FLOATS],
            maps: EffectMaps::NONE,
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
            .filter(|group| {
                (IDS.dof.first_group..IDS.dof.first_group + dof::STEPS as u32).contains(&group[0])
            })
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

    /// What a frame meters automatic exposure with: the default settings and `meter`.
    fn exposure_frame(meter: crate::exposure::Meter) -> ExposureFrame {
        ExposureFrame {
            settings: crate::exposure::AutoExposure::default(),
            meter,
            seconds: 1.0 / 60.0,
        }
    }

    #[test]
    fn the_exposure_meter_runs_before_the_final_pass_and_costs_nothing_while_off() {
        use crate::exposure::Meter;
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
        let keys = pipelines.keys().len();
        let bound = frames.upload_bound();
        let record = |frames: &mut FrameGraph, list: &mut DrawList| {
            let mut arena = UploadArena::default();
            arena.reset(frames.upload_bound());
            list.clear();
            frames
                .upload(list, &mut arena, Output::default(), Grading::default())
                .unwrap();
            frames
                .record(list, |_| [0.0; 4], |_| false, |_, _| Ok(()), |_| Ok(()))
                .unwrap();
            null3d_gpu::drawlist::decode(list.words())
                .map(|command| command.unwrap())
                .map(|command| (command.op, command.operands.to_vec()))
                .collect::<Vec<_>>()
        };

        // Off, the frame declares, asks for, uploads and records nothing of the meter, and the
        // final pass binds the blank texel with its flag clear.
        frames.set_exposure(None);
        frames.request_pipelines(&mut pipelines, 1);
        assert_eq!(pipelines.keys().len(), keys);
        assert_eq!(frames.upload_bound(), bound);
        let commands = record(&mut frames, &mut list);
        assert!(
            !commands
                .iter()
                .any(|(op, _)| *op == Op::Dispatch || *op == Op::CopyTextureToTexture)
        );
        assert_eq!(steps(&frames), without);

        // On, the histogram's compute pass runs just before the final pass's render pass, and the
        // final pass binds the meter's texel at binding 12.
        frames.set_exposure(Some(exposure_frame(Meter::Histogram)));
        assert!(frames.create_exposure_pipelines(&mut list, 2).unwrap());
        frames.request_pipelines(&mut pipelines, 1);
        assert!(
            !frames.exposure_draws(),
            "the meter waits for its pipelines"
        );
        frames.request_pipelines(&mut pipelines, 2);
        assert!(frames.exposure_draws());
        frames
            .prepare(&mut list, canvas, RenderScale::FULL)
            .unwrap();
        assert_eq!(steps(&frames), without, "the plan stays as it was");
        let commands = record(&mut frames, &mut list);
        let place = |op: Op| commands.iter().rposition(|(o, _)| *o == op).unwrap();
        let final_pass = commands
            .iter()
            .rposition(|(op, operands)| *op == Op::BeginRenderPass && operands[0] == 0)
            .expect("the final pass draws into the canvas");
        assert!(place(Op::Dispatch) < final_pass);
        assert!(place(Op::EndComputePass) < final_pass);
        let final_group = commands
            .iter()
            .find(|(op, operands)| {
                *op == Op::CreateBindGroup && operands[0] == IDS.final_pass.group
            })
            .expect("the final pass's group");
        let texel = final_group.1[3..]
            .chunks(5)
            .find(|entry| entry[0] == 12)
            .expect("binding 12");
        assert_eq!(texel[2], IDS.exposure.texel);

        // Off again, the final pass binds the blank texel.
        frames.set_exposure(None);
        frames.request_pipelines(&mut pipelines, 2);
        let commands = record(&mut frames, &mut list);
        let final_group = commands
            .iter()
            .find(|(op, operands)| {
                *op == Op::CreateBindGroup && operands[0] == IDS.final_pass.group
            })
            .expect("the final pass's group again");
        let texel = final_group.1[3..]
            .chunks(5)
            .find(|entry| entry[0] == 12)
            .expect("binding 12");
        assert_eq!(texel[2], IDS.final_pass.blank_outline);
        assert!(!commands.iter().any(|(op, _)| *op == Op::Dispatch));
    }

    #[test]
    fn the_8_bit_path_meters_no_exposure() {
        let mut frames = frame_graph(format::CANVAS, Antialias::Msaa, false, false);
        frames.sync(&[View::default()]);
        frames.set_exposure(Some(exposure_frame(crate::exposure::Meter::Downsample)));
        let mut pipelines = PipelineCache::default();
        frames.request_pipelines(&mut pipelines, 0);
        assert!(!frames.exposure_draws());
        assert!(
            pipelines.keys().is_empty()
                || pipelines.keys().iter().all(|key| {
                    key.template != null3d_gpu::drawlist::template::EXPOSURE_LUMINANCE
                })
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
            maps: EffectMaps::NONE,
        };
        let chain = [
            effect(CUSTOM, false),
            effect(CUSTOM + 1, false),
            effect(CUSTOM + 2, true),
        ];
        let mut joins = EffectJoins::default();
        joins.groups[1] = (2, CUSTOM + 10);
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
        assert!(
            pipelines
                .keys()
                .iter()
                .all(|key| key.template != CUSTOM + 10)
        );
        let names = frame(&mut frames, &mut pipelines, &joins, 6, &mut list);
        assert_eq!(effect_passes(&names), 3);
        let names = frame(&mut frames, &mut pipelines, &joins, 7, &mut list);
        assert_eq!(effect_passes(&names), 2);
        let group = pipelines
            .keys()
            .iter()
            .find(|key| key.template == CUSTOM + 10)
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
            .filter(|group| group[0] == IDS.effects.first_group + MAX_EFFECTS as u32 + 1)
            .collect();
        assert_eq!(bound.len(), 1, "the group binds once");
        assert_eq!(bound[0][3 + 4], effects::BUFFER_BYTES as u32);

        // Folded, the group's effects leave their passes, and the final pass reads the first
        // effect's target with its fold build, once that build's pipeline is built.
        joins.fold = Some((1, CUSTOM + 11));
        let names = frame(&mut frames, &mut pipelines, &joins, 8, &mut list);
        assert_eq!(effect_passes(&names), 2, "the fold waits for its pipeline");
        let names = frame(&mut frames, &mut pipelines, &joins, 9, &mut list);
        assert_eq!(effect_passes(&names), 1);
        let fold = pipelines
            .keys()
            .iter()
            .position(|key| key.template == CUSTOM + 11)
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
            .record(
                &mut list,
                |_| [0.0; 4],
                |_| false,
                |_, _| Ok(()),
                |_| Ok(()),
            )
            .unwrap();
        assert!(
            operands(&list, Op::SetPipeline)
                .iter()
                .any(|set| set[0] == fold)
        );

        // Bloom reads the effects' image, so nothing folds while it is on, and a new fold builds
        // nothing until bloom is off.
        frames.set_bloom(Some(Bloom::default()), ChainFrame::default());
        let names = frame(&mut frames, &mut pipelines, &joins, 10, &mut list);
        assert_eq!(effect_passes(&names), 2);
        joins.fold = Some((1, CUSTOM + 12));
        let names = frame(&mut frames, &mut pipelines, &joins, 11, &mut list);
        assert_eq!(effect_passes(&names), 2);
        let asked = |pipelines: &PipelineCache| {
            pipelines
                .keys()
                .iter()
                .any(|key| key.template == CUSTOM + 12)
        };
        assert!(!asked(&pipelines), "a fold beside bloom builds nothing");
        frames.set_bloom(None, ChainFrame::default());
        let names = frame(&mut frames, &mut pipelines, &joins, 12, &mut list);
        assert_eq!(effect_passes(&names), 2, "the fold waits for its pipeline");
        assert!(asked(&pipelines));
        let names = frame(&mut frames, &mut pipelines, &joins, 13, &mut list);
        assert_eq!(effect_passes(&names), 1);
    }

    #[test]
    fn the_8_bit_path_runs_no_effects() {
        let mut frames = frame_graph(format::CANVAS, Antialias::Msaa, true, false);
        let effect = Effect {
            template: CUSTOM,
            depth: false,
            values: [0.0; effects::EFFECT_FLOATS],
            maps: EffectMaps::NONE,
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

    /// The names of the graph's passes for one camera view, in the order of its steps, as the
    /// builders declare and compile them at the start of a frame.
    fn pass_names(frames: &mut FrameGraph, list: &mut DrawList) -> Vec<String> {
        frames.sync(&[View::default()]);
        frames.prepare(list, (320, 180), RenderScale::FULL).unwrap();
        steps(frames).into_iter().flatten().collect()
    }

    #[test]
    fn the_motion_passes_run_only_while_the_motion_view_draws() {
        for (scene_color, gpu_culling) in [(format::RGBA16_FLOAT, true), (format::CANVAS, false)] {
            let mut frames = frame_graph(scene_color, Antialias::Msaa, gpu_culling, true);
            frames.sync(&[View::default()]);
            let mut list = DrawList::with_capacity(4096);
            let without = pass_names(&mut frames, &mut list);
            let textures = frames.graph().plan().unwrap().textures().len();

            // The view adds nothing until its step's pipeline is built.
            frames.set_motion(true, None);
            assert_eq!(pass_names(&mut frames, &mut list), without);
            assert!(!frames.motion_draws());

            frames.request_pipelines(&mut PipelineCache::default(), 0);
            let names = pass_names(&mut frames, &mut list);
            let motion: Vec<&str> = names
                .iter()
                .map(String::as_str)
                .filter(|name| name.starts_with("Motion"))
                .collect();
            let expected: &[&str] = if gpu_culling {
                &["MotionCulling", "Motion", "MotionView"]
            } else {
                &["Motion", "MotionView"]
            };
            assert_eq!(motion, expected);
            let at = |name: &str| names.iter().position(|step| step == name).unwrap();
            assert!(
                at("Opaque") < at("Motion"),
                "the motion pass tests the scene's depth"
            );
            assert!(frames.motion_draws());

            // A device that cannot draw the target with MSAA shows the camera's motion alone.
            frames.allow_motion(true, false);
            let names = pass_names(&mut frames, &mut list);
            assert!(names.iter().any(|name| name == "MotionView"));
            assert!(!names.iter().any(|name| name == "Motion"));
            assert!(!frames.motion_draws());

            // With the view off again, the frame is as it was, with no texture of the motion.
            frames.allow_motion(true, true);
            frames.set_motion(false, None);
            assert_eq!(pass_names(&mut frames, &mut list), without);
            assert_eq!(frames.graph().plan().unwrap().textures().len(), textures);
            assert!(!frames.motion_draws());
        }
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
                    |_| Ok(()),
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
            // Binding 11 is the outline mask; binding 12 is the automatic exposure's texel, which
            // every build binds, so filter for the mask alone.
            let outline_entries: Vec<_> = groups[0][3..]
                .chunks(5)
                .filter(|entry| entry[0] == 11)
                .map(|entry| entry[2])
                .collect();
            assert_eq!(outline_entries.len(), 1);
            assert_ne!(
                outline_entries[0], IDS.final_pass.blank_outline,
                "the mask, not the blank texture"
            );

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

            frames.set_ao(Some(Ao::default()), None, Some(lens), 0.5);
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
            // and drops its stand-in color. WebGL2 need not clear that color, which nothing reads.
            let plan = frames.graph().plan().unwrap();
            let attachments = plan.attachments(&plan.steps()[prepass]);
            for attachment in attachments {
                let store = if attachment.depth {
                    StoreOp::Store
                } else {
                    StoreOp::Discard
                };
                assert_eq!(attachment.store, store);
                let load = if attachment.depth || gpu_culling {
                    LoadOp::Clear
                } else {
                    LoadOp::Load
                };
                assert_eq!(attachment.load, load, "the prepass's attachments start");
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
            // On WebGL2, every read clamps inside the corner that the step draws, so a step's
            // target starts from what the texture holds rather than a clear, which Safari can make
            // expensive on an iPhone. WebGPU keeps its clear, cheaper than a load there.
            let expected_load = if gpu_culling {
                LoadOp::Clear
            } else {
                LoadOp::Load
            };
            for name in AO_PASSES {
                let pass = frames.graph().find_pass(name).unwrap();
                let step = plan.step_of(pass).unwrap();
                for attachment in plan.attachments(&plan.steps()[step]) {
                    assert_eq!(attachment.load, expected_load, "{name}'s target's load");
                }
            }
            assert!(frames.ao_texture().is_some());

            // A lower scale draws a smaller corner of the same targets.
            let mut arena = UploadArena::default();
            arena.reset(frames.upload_bound());
            frames
                .upload(&mut list, &mut arena, Output::default(), Grading::default())
                .unwrap();
            list.clear();
            frames.set_ao(Some(Ao::default()), None, Some(lens), 0.25);
            frames
                .prepare(&mut list, (320, 180), RenderScale::FULL)
                .unwrap();
            assert!(list.is_empty(), "a new scale makes no texture");
            list.clear();
            frames
                .record(
                    &mut list,
                    |_| [0.0; 4],
                    |_| false,
                    |_, _| Ok(()),
                    |_| Ok(()),
                )
                .unwrap();
            let viewports = operands(&list, Op::SetViewport);
            assert!(viewports.iter().any(|v| v[2..4] == [80, 45]));
            // On WebGL2, the steps' render passes ask for no clear, so the backend makes no clear
            // call for any of them.
            if !gpu_culling {
                let plan = frames.graph().plan().unwrap();
                let began = operands(&list, Op::BeginRenderPass);
                let mut render = 0;
                let mut ao_passes = 0;
                for step in plan.steps() {
                    if !matches!(step.kind, StepKind::Render { .. }) {
                        continue;
                    }
                    let some_ao = plan.passes(step).iter().any(|&pass| {
                        AO_PASSES
                            .iter()
                            .any(|name| frames.graph().pass_name(pass) == *name)
                    });
                    if some_ao {
                        assert_eq!(
                            began[render][8] & pass_flags::CLEAR_COLOR,
                            0,
                            "an ambient occlusion step clears its target"
                        );
                        ao_passes += 1;
                    }
                    render += 1;
                }
                assert_eq!(ao_passes, ao::STEPS);
            }

            // Off again, the steps and their targets are gone, and the prepass with them.
            frames.set_ao(None, None, None, 0.5);
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

    /// What screen-space reflections' trace draws with in the tests.
    fn trace_frame() -> TraceFrame {
        TraceFrame {
            ssr: crate::ssr::Ssr::default(),
            projection: ([1.0; 16], [1.0; 16]),
            orthographic: false,
            steps: 32,
        }
    }

    #[test]
    fn screen_space_reflections_trace_before_the_camera_opaque_pass_and_read_the_last_copy() {
        for (format, antialias, gpu_culling) in [
            (format::RGBA16_FLOAT, Antialias::Msaa, true),
            (format::CANVAS, Antialias::Msaa, true),
            (format::CANVAS, Antialias::Msaa, false),
            (format::RGBA16_FLOAT, Antialias::Fxaa, false),
        ] {
            let canvas = (320, 180);
            let mut frames = frame_graph(format, antialias, gpu_culling, true);
            frames.sync(&[View::default(), shown()]);
            let mut list = DrawList::with_capacity(8192);
            let mut pipelines = PipelineCache::default();
            frames
                .prepare(&mut list, canvas, RenderScale::FULL)
                .unwrap();
            let without = steps(&frames);
            let textures = frames.graph().plan().unwrap().textures().len();

            // The reflections wait for their pipelines, the depth step's and the copy's.
            frames.set_ssr(Some(trace_frame()), 0.5);
            assert!(
                frames.depth_prepass(),
                "the trace reads the prepass's depth"
            );
            frames.request_pipelines(&mut pipelines, 1);
            assert!(!frames.ssr_draws());
            pipelines.create_new(&mut list, 2).unwrap();
            frames.request_pipelines(&mut pipelines, 2);
            assert!(frames.ssr_draws());
            frames.sync(&[View::default(), shown()]);
            list.clear();
            frames
                .prepare(&mut list, canvas, RenderScale::FULL)
                .unwrap();
            let names = steps(&frames);
            let at = |name: &str| names.iter().position(|step| step.iter().any(|p| p == name));
            let prepass = at("DepthPrepass").unwrap();
            assert_eq!(at("AoDepth"), Some(prepass + 1));
            for (level, name) in SSR_PASSES[..ssr::LEVELS].iter().enumerate() {
                assert_eq!(at(name), Some(prepass + 2 + level));
            }
            let trace = at("SsrTrace").unwrap();
            assert_eq!(trace, prepass + 2 + ssr::LEVELS);
            assert_eq!(at("Opaque"), Some(trace + 1));
            assert_eq!(
                at(TRANSMISSION_PASS),
                Some(trace + 2),
                "the copy follows the opaque pass"
            );
            assert!(frames.transmission_copied());
            // The opaque pass reads the trace's target as the screen texture.
            assert_eq!(
                frames.ao_texture(),
                frames.sampled_id(SSR_TARGETS[ssr::LEVELS])
            );
            let plan = frames.graph().plan().unwrap();
            let texture = |name: &str| {
                let Surface::Texture(index) = plan
                    .texture_of(frames.graph().find_resource(name).unwrap())
                    .unwrap()
                else {
                    panic!("the steps draw into textures")
                };
                plan.textures()[usize::from(index)]
            };
            for level in 1..=ssr::LEVELS {
                let made = texture(SSR_TARGETS[level - 1]);
                assert_eq!(made.size, ssr::level_size(level));
                assert_eq!(made.target, Target::color(ssr::LEVEL_FORMAT));
            }
            assert_eq!(texture(SSR_TARGETS[ssr::LEVELS]).size, ssr::TRACE_SIZE);
            assert!(plan.textures().len() > textures);

            // The first frame has no copy to read, so it reflects nothing; the next one reads the
            // copy that the first made, through the first frame's view.
            let mut uniform = FrameUniform::default();
            uniform.view_proj[0] = 2.0;
            frames.write_screen_values(&mut uniform, [0.0; 3]);
            assert_eq!(uniform.reflection[0], 0.0);
            assert_eq!(uniform.occlusion[0], 0.0, "no ambient occlusion draws");
            assert_eq!(
                uniform.occlusion[2], 0.5,
                "the grid has half the render size"
            );
            let mut next = FrameUniform::default();
            frames.write_screen_values(&mut next, [1.0, 0.0, 0.0]);
            assert_eq!(next.reflection[0], 1.0);
            assert_eq!(next.reflection_reprojection[0], 2.0);
            assert_eq!(next.reflection_corner[..2], [320.0, 180.0]);

            // The steps record into the corners of their targets.
            let mut arena = UploadArena::default();
            arena.reset(frames.upload_bound());
            list.clear();
            frames
                .upload(&mut list, &mut arena, Output::default(), Grading::default())
                .unwrap();
            let groups = operands(&list, Op::CreateBindGroup);
            assert!(
                groups
                    .iter()
                    .any(|group| group[1] == bind_layout::SSR_TRACE)
            );
            assert_eq!(
                groups
                    .iter()
                    .filter(|group| group[1] == bind_layout::SSR_REDUCE)
                    .count(),
                ssr::LEVELS
            );
            list.clear();
            frames
                .record(
                    &mut list,
                    |_| [0.0; 4],
                    |_| false,
                    |_, _| Ok(()),
                    |_| Ok(()),
                )
                .unwrap();
            let viewports = operands(&list, Op::SetViewport);
            for size in [[160, 90], [80, 45], [40, 23], [3, 2]] {
                assert!(viewports.iter().any(|v| v[2..4] == size), "{size:?}");
            }

            // With contact shadows or ambient occlusion too, the search and denoise follow the
            // trace, and the denoise copies the trace's ray lengths into the screen texture that
            // the opaque pass reads.
            let contact = Contact {
                to_light: [0.0, 1.0, 0.0],
                distance: 0.3,
                steps: 8,
            };
            pipelines.create_new(&mut list, 3).unwrap();
            for (ao, contact) in [(None, Some(contact)), (Some(Ao::default()), None)] {
                frames.set_ao(ao, contact, Some(([1.0; 16], [1.0; 16])), 0.5);
                frames.request_pipelines(&mut pipelines, 3);
                frames.sync(&[View::default(), shown()]);
                frames
                    .prepare(&mut list, canvas, RenderScale::FULL)
                    .unwrap();
                let names = steps(&frames);
                let at = |name: &str| names.iter().position(|step| step.iter().any(|p| p == name));
                let trace = at("SsrTrace").unwrap();
                assert_eq!(at("AoHorizon"), Some(trace + 1));
                assert_eq!(at("AoDenoise"), Some(trace + 2));
                assert_eq!(at("Opaque"), Some(trace + 3));
                assert_eq!(
                    frames.ao_texture(),
                    frames.sampled_id(AO_TARGETS[ao::STEPS - 1])
                );
                arena.reset(frames.upload_bound());
                list.clear();
                frames
                    .upload(&mut list, &mut arena, Output::default(), Grading::default())
                    .unwrap();
                if contact.is_some() {
                    let trace_texture = frames.sampled_id(SSR_TARGETS[ssr::LEVELS]).unwrap();
                    assert!(
                        operands(&list, Op::CreateBindGroup).iter().any(|group| {
                            group[1] == bind_layout::AO && group[3..].contains(&trace_texture)
                        }),
                        "the denoise binds the trace's target"
                    );
                }
            }

            // Off again, the steps, their targets and the copy are gone.
            frames.set_ao(None, None, None, 0.5);
            frames.set_ssr(None, 0.5);
            assert!(!frames.depth_prepass());
            frames.sync(&[View::default(), shown()]);
            frames
                .prepare(&mut list, canvas, RenderScale::FULL)
                .unwrap();
            assert_eq!(steps(&frames), without);
            assert_eq!(frames.graph().plan().unwrap().textures().len(), textures);
            assert!(!frames.transmission_copied());
            let mut uniform = FrameUniform::default();
            frames.write_screen_values(&mut uniform, [0.0; 3]);
            assert_eq!(uniform.reflection, [0.0; 4]);
        }
    }

    #[test]
    fn decals_draw_after_the_camera_opaque_pass_only_while_some_object_is_one() {
        for gpu_culling in [true, false] {
            let canvas = (320, 180);
            let mut frames = frame_graph(format::RGBA16_FLOAT, Antialias::Msaa, gpu_culling, false);
            frames.sync(&[View::default()]);
            frames.set_transparent(true);
            let mut list = DrawList::with_capacity(8192);
            frames
                .prepare(&mut list, canvas, RenderScale::FULL)
                .unwrap();
            let without = steps(&frames);
            assert!(frames.decal_depth().is_none());

            frames.set_decals(true, false);
            frames.sync(&[View::default()]);
            frames
                .prepare(&mut list, canvas, RenderScale::FULL)
                .unwrap();
            let with = steps(&frames);
            let decals = with
                .iter()
                .position(|step| step == &[DECALS_PASS])
                .expect("the decals draw in a render pass of their own");
            assert_eq!(
                with[decals - 1][0],
                "Opaque",
                "after the camera's opaque pass"
            );
            assert!(
                with[decals + 1].contains(&"Transparent".to_owned()),
                "before the transparent pass"
            );
            assert!(
                frames.decal_depth().is_some(),
                "the pass reads the scene depth"
            );
            let targets = frames.decal_targets();
            assert_eq!(targets.depth_format, format::NONE);
            assert_eq!(
                targets.permutation & permutation::DEPTH_MULTISAMPLED != 0,
                gpu_culling,
                "WebGPU reads sample 0 of the multisampled depth, WebGL2 a copy of one sample"
            );

            // The redraw of the objects that decals skip joins the render pass after the decals.
            frames.set_decals(true, true);
            frames.sync(&[View::default()]);
            frames
                .prepare(&mut list, canvas, RenderScale::FULL)
                .unwrap();
            let redrawn = steps(&frames);
            assert!(redrawn[decals + 1].contains(&DECAL_REDRAW_PASS.to_owned()));
            assert_eq!(
                redrawn.len(),
                with.len(),
                "the redraw takes no render pass of its own"
            );

            // Without decals, the frame declares nothing of them again.
            frames.set_decals(false, true);
            frames.sync(&[View::default()]);
            frames
                .prepare(&mut list, canvas, RenderScale::FULL)
                .unwrap();
            assert_eq!(steps(&frames), without);
            assert!(frames.decal_depth().is_none());
        }
    }

    #[test]
    fn contact_shadows_alone_run_the_steps_of_ambient_occlusion() {
        let lens = ([1.0; 16], [1.0; 16]);
        let contact = Contact {
            to_light: [0.0, 1.0, 0.0],
            distance: 0.3,
            steps: 8,
        };
        for (format, antialias, gpu_culling) in [
            (format::RGBA16_FLOAT, Antialias::Msaa, true),
            (format::CANVAS, Antialias::Msaa, false),
        ] {
            let mut frames = frame_graph(format, antialias, gpu_culling, true);
            let mut list = DrawList::with_capacity(4096);
            let mut pipelines = PipelineCache::default();
            let mut frame = |frames: &mut FrameGraph, list: &mut DrawList| {
                frames.request_pipelines(&mut pipelines, 0);
                frames.sync(&[View::default(), shown()]);
                frames.prepare(list, (320, 180), RenderScale::FULL).unwrap();
            };
            frame(&mut frames, &mut list);
            let without = frames.graph().plan().unwrap().textures().len();

            frames.set_ao(None, Some(contact), Some(lens), 0.5);
            assert!(
                frames.depth_prepass(),
                "contact shadows need the prepass's depth"
            );
            frame(&mut frames, &mut list);
            let names = steps(&frames);
            let at = |name: &str| names.iter().position(|step| step.iter().any(|p| p == name));
            let prepass = at("DepthPrepass").unwrap();
            assert_eq!(
                [
                    at("AoDepth"),
                    at("AoHorizon"),
                    at("AoDenoise"),
                    at("Opaque")
                ],
                [
                    Some(prepass + 1),
                    Some(prepass + 2),
                    Some(prepass + 3),
                    Some(prepass + 4)
                ],
                "the horizon step marches them and the denoise blurs them"
            );
            let plan = frames.graph().plan().unwrap();
            assert!(frames.graph().find_resource(AO_TARGETS[1]).is_some());
            assert!(plan.textures().len() > without);
            assert!(frames.ao_texture().is_some());

            // Ambient occlusion as well runs the same steps.
            frames.set_ao(Some(Ao::default()), Some(contact), Some(lens), 0.5);
            frame(&mut frames, &mut list);
            let names = steps(&frames);
            let at = |name: &str| names.iter().position(|step| step.iter().any(|p| p == name));
            assert!(at("AoHorizon").is_some());
            assert!(frames.ao_texture().is_some());

            // A new reach or a new direction only uploads the steps' settings.
            let mut arena = UploadArena::default();
            arena.reset(frames.upload_bound());
            frames
                .upload(&mut list, &mut arena, Output::default(), Grading::default())
                .unwrap();
            let turned = Contact {
                to_light: [1.0, 0.0, 0.0],
                ..contact
            };
            frames.set_ao(Some(Ao::default()), Some(turned), Some(lens), 0.5);
            list.clear();
            frames
                .prepare(&mut list, (320, 180), RenderScale::FULL)
                .unwrap();
            assert!(list.is_empty(), "a new direction makes no texture");

            // Both off, the steps and the prepass are gone.
            frames.set_ao(None, None, Some(lens), 0.5);
            assert!(!frames.depth_prepass());
            frame(&mut frames, &mut list);
            assert!(frames.graph().find_pass("AoDepth").is_none());
            assert_eq!(frames.graph().plan().unwrap().textures().len(), without);
            assert_eq!(frames.ao_texture(), None);
        }
    }

    /// Turns transmission on in `frames` and builds the copy's pipeline, as a builder's frames do:
    /// the first frame asks for it, and a later one finds it built.
    fn subsurface_frame() -> SubsurfaceFrame {
        let lens = crate::camera::Lens::Perspective(crate::camera::Perspective {
            fov_degrees: 50.0,
            near: 0.1,
            far: 100.0,
        });
        let projection = lens.projection(16.0 / 9.0);
        SubsurfaceFrame {
            taps: subsurface::TAP_COUNTS[1],
            projection,
            inverse_projection: crate::camera::invert(&projection).unwrap(),
        }
    }

    #[test]
    fn the_subsurface_blur_draws_after_the_scene_feeds_the_effects_and_costs_nothing_while_off() {
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

        // With taps but no object whose material scatters, the frame declares and asks for
        // nothing of the blur, and so it does without taps.
        for (frame, objects) in [(Some(subsurface_frame()), false), (None, true)] {
            frames.set_subsurface(frame, objects);
            frames.sync(&[View::default()]);
            frames.request_pipelines(&mut pipelines, 1);
            frames
                .prepare(&mut list, canvas, RenderScale::FULL)
                .unwrap();
            assert_eq!(steps(&frames), without);
            assert_eq!(pipelines.keys().len(), keys);
        }

        let effect = Effect {
            template: CUSTOM,
            depth: false,
            values: [0.0; effects::EFFECT_FLOATS],
            maps: EffectMaps::NONE,
        };
        frames.set_effects(&[effect], &EffectJoins::default(), [0.0; 2], None);
        frames.set_subsurface(Some(subsurface_frame()), true);
        frames.sync(&[View::default()]);
        frames.request_pipelines(&mut pipelines, 1);
        assert!(
            !frames.subsurface_draws(),
            "the blur waits for its steps' pipelines"
        );
        pipelines.create_new(&mut list, 2).unwrap();
        frames.request_pipelines(&mut pipelines, 2);
        assert!(frames.subsurface_draws());
        frames.sync(&[View::default()]);
        frames
            .prepare(&mut list, canvas, RenderScale::FULL)
            .unwrap();
        let names: Vec<String> = steps(&frames).into_iter().flatten().collect();
        let place = |name: &str| names.iter().position(|n| n == name).unwrap();
        // The skin view culls before the skin pass, which draws after the camera's passes, and the
        // steps run before the effects, which read the down step's copy.
        assert!(place(SUBSURFACE_CULLING) < place(SKIN_PASS));
        assert!(place("Opaque") < place(SKIN_PASS));
        assert!(place(SKIN_PASS) < place(SUBSURFACE_PASSES[0]));
        assert!(place(SUBSURFACE_PASSES[0]) < place(SUBSURFACE_PASSES[1]));
        assert!(place(SUBSURFACE_PASSES[1]) < place("Effect0"));
        assert_eq!(frames.scene_output(), SUBSURFACE_TARGETS[1]);
        assert_eq!(frames.effects_output(), EFFECT_TARGETS[0]);
        // The skin pass draws in a render pass of its own, which clears its light to zero.
        let mut arena = UploadArena::default();
        arena.reset(frames.upload_bound());
        list.clear();
        frames
            .upload(&mut list, &mut arena, Output::default(), Grading::default())
            .unwrap();
        let layouts: Vec<u32> = operands(&list, Op::CreateBindGroup)
            .iter()
            .filter(|group| {
                let first = IDS.subsurface.first_group;
                (first..first + subsurface::STEPS as u32).contains(&group[0])
            })
            .map(|group| group[1])
            .collect();
        assert_eq!(
            layouts,
            [
                bind_layout::SUBSURFACE_BLUR,
                bind_layout::SUBSURFACE_COMPOSITE_MS
            ]
        );
        list.clear();
        frames
            .record(
                &mut list,
                |_| [0.5; 4],
                |_| false,
                |_, _| Ok(()),
                |_| Ok(()),
            )
            .unwrap();
        let skin_light = frames.sampled_id(SKIN_LIGHT).unwrap();
        let cleared: Vec<_> = operands(&list, Op::BeginRenderPass)
            .into_iter()
            .filter(|pass| pass[0] == skin_light)
            .collect();
        assert_eq!(
            cleared.len(),
            1,
            "the skin pass has a render pass of its own"
        );
        assert_eq!(&cleared[0][3..7], &[0f32.to_bits(); 4], "it clears to zero");
        // A moving camera uploads the blocks again and declares nothing.
        let compiles = frames.graph().compiles();
        let mut moved = subsurface_frame();
        moved.projection[0] *= 1.1;
        frames.set_subsurface(Some(moved), true);
        frames
            .prepare(&mut list, canvas, RenderScale::FULL)
            .unwrap();
        assert_eq!(frames.graph().compiles(), compiles);

        // Off again, the plan loses every pass and target of the blur.
        frames.set_effects(&[], &EffectJoins::default(), [0.0; 2], None);
        frames.set_subsurface(None, true);
        frames.sync(&[View::default()]);
        frames
            .prepare(&mut list, canvas, RenderScale::FULL)
            .unwrap();
        assert_eq!(steps(&frames), without);
        assert_eq!(frames.graph().plan().unwrap().textures().len(), textures);
    }

    #[test]
    fn the_8_bit_path_draws_no_subsurface_blur() {
        let mut frames = frame_graph(format::RGBA8_UNORM, Antialias::Msaa, true, false);
        frames.set_subsurface(Some(subsurface_frame()), true);
        let mut pipelines = PipelineCache::default();
        frames.request_pipelines(&mut pipelines, 1);
        assert!(!frames.subsurface_wanted());
        assert!(!frames.subsurface_draws());
    }

    #[test]
    fn the_weighted_layer_draws_after_the_transparent_pass_only_while_it_is_used() {
        let canvas = (320, 180);
        for (format, antialias) in [
            (format::RGBA16_FLOAT, Antialias::Msaa),
            (format::CANVAS, Antialias::Msaa),
            (format::RGBA16_FLOAT, Antialias::Fxaa),
        ] {
            let multisampled = antialias == Antialias::Msaa;
            let mut frames = frame_graph(format, antialias, true, false);
            frames.sync(&[View::default(), shown()]);
            frames.set_transparent(true);
            let mut list = DrawList::with_capacity(8192);
            let mut pipelines = PipelineCache::default();
            frames.request_pipelines(&mut pipelines, 1);
            frames
                .prepare(&mut list, canvas, RenderScale::FULL)
                .unwrap();
            let without = steps(&frames);
            let keys = pipelines.keys().len();

            // A device without targets of 16-bit floats never draws the layer, and asks for none
            // of its pipelines.
            frames.set_weighted_targets(false);
            assert!(frames.weighted_targets(frames.scene_targets()).is_none());
            frames.set_weighted(true);
            frames.request_pipelines(&mut pipelines, 1);
            assert!(!frames.weighted_draws());
            assert_eq!(pipelines.keys().len(), keys);

            // The layer waits for its own pipelines.
            frames.set_weighted_targets(true);
            frames.set_weighted(true);
            frames.request_pipelines(&mut pipelines, 1);
            assert!(
                !frames.weighted_draws(),
                "the layer waits for its pipelines"
            );
            assert_eq!(
                pipelines.keys().len(),
                keys + if multisampled { 2 } else { 1 },
                "the layer asks for the depth copy only for a multisampled scene"
            );
            pipelines.create_new(&mut list, 2).unwrap();
            frames.request_pipelines(&mut pipelines, 2);
            assert!(frames.weighted_draws());
            frames.sync(&[View::default(), shown()]);
            frames
                .prepare(&mut list, canvas, RenderScale::FULL)
                .unwrap();
            assert!(frames.weighted_declared());
            let with: Vec<String> = steps(&frames).into_iter().flatten().collect();
            let at = |name: &str| with.iter().position(|n| n == name);
            let transparent = at("Transparent").unwrap();
            let layer = at(WEIGHTED_PASS).unwrap();
            let composite = at(WEIGHTED_COMPOSITE_PASS).unwrap();
            assert!(transparent < layer && layer < composite);
            // Other views keep their own passes and draw no layer.
            assert!(at("Transparent1").is_some());

            let mut arena = UploadArena::default();
            arena.reset(frames.upload_bound());
            list.clear();
            frames
                .upload(&mut list, &mut arena, Output::default(), Grading::default())
                .unwrap();
            let groups: Vec<(u32, u32)> = operands(&list, Op::CreateBindGroup)
                .iter()
                .map(|group| (group[0], group[1]))
                .filter(|&(id, _)| id >= IDS.weighted.first_group)
                .collect();
            let mut expected = vec![(IDS.weighted.first_group, bind_layout::WEIGHTED_COMPOSITE)];
            if multisampled {
                expected.push((IDS.weighted.first_group + 1, bind_layout::WEIGHTED_DEPTH_MS));
            }
            assert_eq!(groups, expected);

            // The layer's pass clears both sums to nothing and stores them for the composite.
            list.clear();
            frames
                .record(
                    &mut list,
                    |_| [0.5; 4],
                    |_| false,
                    |_, _| Ok(()),
                    |_| Ok(()),
                )
                .unwrap();
            let pairs: Vec<_> = operands(&list, Op::BeginRenderPass)
                .into_iter()
                .filter(|pass| pass.len() == 10)
                .collect();
            assert_eq!(
                pairs.len(),
                1,
                "one render pass draws into two color targets"
            );
            let pair = &pairs[0];
            assert_ne!(pair[9], null3d_gpu::drawlist::NO_TARGET);
            assert_eq!(
                pair[1],
                null3d_gpu::drawlist::NO_TARGET,
                "the sums have one sample"
            );
            assert_eq!(&pair[3..7], &[0f32.to_bits(); 4]);
            let flags = pair[8];
            assert_eq!(
                flags & (pass_flags::CLEAR_COLOR | pass_flags::STORE_COLOR),
                pass_flags::CLEAR_COLOR | pass_flags::STORE_COLOR
            );
            // A multisampled scene's pass starts its own depth, which it copies first; another
            // tests the scene's depth.
            assert_eq!(flags & pass_flags::CLEAR_DEPTH != 0, multisampled);
            let copies = operands(&list, Op::SetBindGroup)
                .iter()
                .filter(|group| group[1] == IDS.weighted.first_group + 1)
                .count();
            assert_eq!(copies, usize::from(multisampled));

            // Unused again, the layer and its targets are gone.
            frames.set_weighted(false);
            frames.sync(&[View::default(), shown()]);
            frames
                .prepare(&mut list, canvas, RenderScale::FULL)
                .unwrap();
            assert_eq!(steps(&frames), without);
        }
    }

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
            // The copy's target has a whole chain of mip levels, and frame groups bind it. The
            // camera's depth, which the copy samples, no longer shares a texture with the other
            // view's depth, which nothing samples.
            let plan = frames.graph().plan().unwrap();
            assert_eq!(plan.textures().len(), textures + 2);
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
                        && group[1] == bind_layout::TRANSMISSION_COPY_MS)
            );

            // The opaque pass resolves the multisampled scene color, the copy draws it into the
            // first level, and the frame makes the other levels before the transparent pass.
            list.clear();
            frames
                .record(
                    &mut list,
                    |_| [0.0; 4],
                    |_| false,
                    |_, _| Ok(()),
                    |_| Ok(()),
                )
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
    fn the_transmission_copy_reads_the_opaque_depth_into_a_target_with_alpha() {
        // The copy keeps a code of the opaque depth's distance in its alpha. It binds the scene
        // depth beside the scene color: sample 0 of a multisampled depth on WebGPU, and the copy of
        // one sample that WebGL2's backend keeps. Its target has alpha where the scene color's
        // packed floats have none.
        let (ms, one) = (
            bind_layout::TRANSMISSION_COPY_MS,
            bind_layout::WEIGHTED_COMPOSITE,
        );
        let (half, srgb) = (format::RGBA16_FLOAT, format::RGBA8_UNORM_SRGB);
        for (scene, antialias, gpu_culling, target, layout) in [
            (format::RG11B10_UFLOAT, Antialias::Msaa, true, half, ms),
            (format::RGBA16_FLOAT, Antialias::Fxaa, true, half, one),
            (format::CANVAS, Antialias::Msaa, false, srgb, one),
        ] {
            let canvas = (320, 180);
            let mut frames = frame_graph(scene, antialias, gpu_culling, false);
            let mut list = DrawList::with_capacity(8192);
            let mut pipelines = PipelineCache::default();
            frames.sync(&[View::default()]);
            frames.set_transparent(true);
            build_transmission(&mut frames, &mut pipelines);
            frames.sync(&[View::default()]);
            frames
                .prepare(&mut list, canvas, RenderScale::FULL)
                .unwrap();
            let key = pipelines
                .keys()
                .iter()
                .find(|key| key.template == template::TRANSMISSION_COPY)
                .expect("the copy has a pipeline");
            assert_eq!(key.color_format, target);
            assert_eq!(
                key.permutation & permutation::DEPTH_MULTISAMPLED != 0,
                layout == ms
            );
            let plan = frames.graph().plan().unwrap();
            let copy = frames.graph().find_resource(TRANSMISSION_COLOR).unwrap();
            let Some(Surface::Texture(index)) = plan.sampled_texture_of(copy) else {
                panic!("the copy's target is a texture");
            };
            assert_eq!(plan.textures()[usize::from(index)].target.format, target);
            let depth = frames.graph().find_resource(SCENE_DEPTH).unwrap();
            let Some(Surface::Texture(index)) = plan.sampled_texture_of(depth) else {
                panic!("the scene depth is a texture");
            };
            assert_ne!(
                plan.textures()[usize::from(index)].usage & texture_usage::TEXTURE_BINDING,
                0,
                "the copy samples the scene depth"
            );

            let mut arena = UploadArena::default();
            arena.reset(frames.upload_bound());
            list.clear();
            frames
                .upload(&mut list, &mut arena, Output::default(), Grading::default())
                .unwrap();
            let groups = operands(&list, Op::CreateBindGroup);
            let group = groups
                .iter()
                .find(|group| group[0] == IDS.transmission.group)
                .expect("the copy has a bind group");
            let color = frames.sampled_id(SCENE_COLOR).unwrap();
            let depth = frames.sampled_id(SCENE_DEPTH).unwrap();
            assert_eq!(
                group.as_slice(),
                [
                    IDS.transmission.group,
                    layout,
                    2,
                    0,
                    resource_kind::TEXTURE,
                    color,
                    0,
                    0,
                    1,
                    resource_kind::TEXTURE,
                    depth,
                    0,
                    0
                ]
            );
        }
    }

    #[test]
    fn a_copy_for_screen_reflections_alone_keeps_the_packed_scene_format() {
        // Screen-space reflections read the copy's color alone, so the copy widens to 16-bit
        // floats for the opaque depth's code only while a surface that lets light through wants it.
        let canvas = (320, 180);
        let mut frames = frame_graph(format::RG11B10_UFLOAT, Antialias::Msaa, true, false);
        let mut list = DrawList::with_capacity(8192);
        let mut pipelines = PipelineCache::default();
        frames.sync(&[View::default()]);
        frames.set_ssr(Some(trace_frame()), 0.5);
        frames.request_pipelines(&mut pipelines, 1);
        pipelines.create_new(&mut list, 2).unwrap();
        frames.request_pipelines(&mut pipelines, 2);
        assert!(frames.ssr_draws());
        let copy_format = |frames: &FrameGraph| {
            let plan = frames.graph().plan().unwrap();
            let copy = frames.graph().find_resource(TRANSMISSION_COLOR).unwrap();
            let Some(Surface::Texture(index)) = plan.sampled_texture_of(copy) else {
                panic!("the copy's target is a texture");
            };
            plan.textures()[usize::from(index)].target.format
        };
        frames.sync(&[View::default()]);
        frames
            .prepare(&mut list, canvas, RenderScale::FULL)
            .unwrap();
        assert_eq!(copy_format(&frames), format::RG11B10_UFLOAT);

        frames.set_transparent(true);
        build_transmission(&mut frames, &mut pipelines);
        frames.sync(&[View::default()]);
        frames
            .prepare(&mut list, canvas, RenderScale::FULL)
            .unwrap();
        assert_eq!(copy_format(&frames), format::RGBA16_FLOAT);
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
