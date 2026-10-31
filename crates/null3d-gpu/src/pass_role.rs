//! What a pass is for, as the draw list carries it.
//!
//! The frame graph labels each pass that it records with a [`PassRole`] and the pass's place among
//! the passes of that role, such as a shadow cascade's index or a bloom step. `BeginRenderPass`
//! and `BeginComputePass` carry the label, and the GPU timer records it with the pass's time. A
//! frame's figures then name a part of its GPU time by what the pass draws, rather than by the
//! position that the pass happened to land in.
//!
//! A label packs both numbers into one word: the role in the low 16 bits, and the place in the
//! high 16 bits. Role codes are part of the draw list's format, so they never change number.

/// What a pass draws for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum PassRole {
    /// The pass carries no label: a list that does not name its passes.
    Unknown = 0,
    /// The page's background color, where nothing else draws.
    Background = 1,
    /// The lights of each cluster of the camera's light grid.
    LightClusters = 2,
    /// The skinning of skinned meshes into the buffer that their views draw.
    Skin = 3,
    /// A view culled on the GPU.
    Cull = 4,
    /// A view's opaque depth, before its opaque pass shades it.
    Prepass = 5,
    /// A view's opaque objects.
    Opaque = 6,
    /// The depth of the objects that occlusion culling kept.
    Occluders = 7,
    /// A view's depth pyramid, for occlusion culling.
    Pyramid = 8,
    /// A view culled against its depth pyramid.
    LateCull = 9,
    /// The casters of one shadow cascade.
    ShadowCascade = 10,
    /// The casters of one tile of the point and spot lights' shadow atlas.
    ShadowTile = 11,
    /// The casters of the sun's hero shadow, which takes the atlas's last tile.
    ShadowHero = 12,
    /// The frame's debug lines.
    DebugLines = 13,
    /// A view's blended objects.
    Transparent = 14,
    /// The decals over the camera's opaque objects.
    Decals = 15,
    /// The camera's opaque objects on the layers that decals skip.
    DecalRedraw = 16,
    /// The camera's opaque objects into GPU picking's id target.
    Pick = 17,
    /// The copy of GPU picking's id target into the target that a read takes.
    PickResolve = 18,
    /// The resolve of the scene color into the canvas.
    Resolve = 19,
    /// A step of bloom's chain.
    Bloom = 20,
    /// The outline mask.
    OutlineMask = 21,
    /// The skin pass's light of the objects that a material lets light through.
    SkinLight = 22,
    /// A step of the subsurface blur.
    Subsurface = 23,
    /// A step of ambient occlusion.
    Ao = 24,
    /// A step of screen-space reflections.
    Ssr = 25,
    /// A custom effect's pass, or a group of effects.
    Effect = 26,
    /// A step of depth of field.
    Dof = 27,
    /// The volumetric fog's light step into one of its two light textures.
    FogLight = 28,
    /// The volumetric fog's block step.
    FogBlock = 29,
    /// The volumetric fog's sum.
    FogSum = 30,
    /// The volumetric fog's apply step.
    FogApply = 31,
    /// A step of temporal anti-aliasing.
    Taa = 32,
    /// The copy of a view's image with its rows turned around.
    ViewCopy = 33,
    /// The full-screen form of a pass of the sketch's WGSL.
    Fullscreen = 34,
    /// The compute form of a pass of the sketch's WGSL, or a step that holds several compute
    /// passes whose roles differ.
    Compute = 35,
    /// The copy of the camera's opaque color for surfaces that let light through.
    TransmissionCopy = 36,
    /// The moving objects into the motion target.
    Motion = 37,
    /// The motion debug view.
    MotionView = 38,
    /// The camera's weighted surfaces into the weighted layer's two sums.
    Weighted = 39,
    /// The blend of the weighted layer over the scene color.
    WeightedComposite = 40,
    /// The copy of the camera's opaque depth for soft particles.
    ParticleDepthCopy = 41,
    /// The still-camera accumulation's blend.
    Accumulate = 42,
    /// The tone map of the scene color into the canvas.
    Final = 43,
    /// The tone map of a still view's accumulated color into the canvas.
    FinalStill = 44,
    /// The tone map of the scene color with bloom's levels into the canvas.
    FinalBloom = 45,
    /// The first step of the two-step pass.
    Output = 46,
    /// The first step of the two-step pass with bloom's base level.
    OutputBloom = 47,
    /// The histogram of automatic exposure.
    ExposureHistogram = 48,
    /// The downsample of automatic exposure's cells.
    ExposureDownsample = 49,
    /// The adaptation of automatic exposure's stored texel.
    ExposureAdapt = 50,
    /// The conversion of a feature instance draw's rows.
    FeatureRows = 51,
    /// A step of the physical sky's tables.
    Sky = 52,
    /// The camera view's depth reduction, which the next frame's light clustering fits its slices
    /// to.
    LightDepth = 53,
    /// The camera's blended surfaces into the moment layer's moment store.
    Moment = 54,
    /// The same surfaces again into the moment layer's color sum.
    MomentColour = 55,
    /// The blend of the moment layer over the scene color.
    MomentComposite = 56,
    /// The marks of the moment layer's edges, for SMAA.
    MomentSmaaEdges = 57,
    /// The ends and areas of those edges.
    MomentSmaaBlend = 58,
    /// The mix of each pixel with the neighbour that its weights name.
    MomentSmaaResolve = 59,
}

impl PassRole {
    /// The role's code in a pass label.
    pub const fn code(self) -> u32 {
        self as u32
    }

    /// The name that a frame figure prints for this role.
    pub const fn name(self) -> &'static str {
        match self {
            Self::Unknown => "",
            Self::Background => "background",
            Self::LightClusters => "light clusters",
            Self::Skin => "skin",
            Self::Cull => "cull",
            Self::Prepass => "prepass",
            Self::Opaque => "opaque",
            Self::Occluders => "occluders",
            Self::Pyramid => "depth pyramid",
            Self::LateCull => "late cull",
            Self::ShadowCascade => "shadow cascade",
            Self::ShadowTile => "shadow tile",
            Self::ShadowHero => "shadow hero",
            Self::DebugLines => "debug lines",
            Self::Transparent => "transparent",
            Self::Decals => "decals",
            Self::DecalRedraw => "decal redraw",
            Self::Pick => "pick",
            Self::PickResolve => "pick resolve",
            Self::Resolve => "resolve",
            Self::Bloom => "bloom",
            Self::OutlineMask => "outline mask",
            Self::SkinLight => "skin light",
            Self::Subsurface => "subsurface blur",
            Self::Ao => "ambient occlusion",
            Self::Ssr => "screen reflections",
            Self::Effect => "effect",
            Self::Dof => "depth of field",
            Self::FogLight => "fog light",
            Self::FogBlock => "fog block",
            Self::FogSum => "fog sum",
            Self::FogApply => "fog apply",
            Self::Taa => "temporal anti-aliasing",
            Self::ViewCopy => "view copy",
            Self::Fullscreen => "full-screen",
            Self::Compute => "compute",
            Self::TransmissionCopy => "transmission copy",
            Self::Motion => "motion",
            Self::MotionView => "motion view",
            Self::Weighted => "weighted layer",
            Self::WeightedComposite => "weighted composite",
            Self::ParticleDepthCopy => "particle depth copy",
            Self::Accumulate => "accumulate",
            Self::Final => "final",
            Self::FinalStill => "final still",
            Self::FinalBloom => "final with bloom",
            Self::Output => "output",
            Self::OutputBloom => "output with bloom",
            Self::ExposureHistogram => "exposure histogram",
            Self::ExposureDownsample => "exposure downsample",
            Self::ExposureAdapt => "exposure adapt",
            Self::FeatureRows => "feature rows",
            Self::Sky => "sky",
            Self::LightDepth => "light depth",
            Self::Moment => "moment layer",
            Self::MomentColour => "moment colour",
            Self::MomentComposite => "moment composite",
            Self::MomentSmaaEdges => "moment edges",
            Self::MomentSmaaBlend => "moment weights",
            Self::MomentSmaaResolve => "moment resolve",
        }
    }

    /// Whether a figure prints the place after the name: always, only when the place is not 0, or
    /// never.
    pub const fn place(self) -> Place {
        match self {
            Self::Cull
            | Self::Prepass
            | Self::Opaque
            | Self::Occluders
            | Self::Pyramid
            | Self::LateCull
            | Self::Transparent
            | Self::ViewCopy
            | Self::Fullscreen
            | Self::Compute => Place::WhenSet,
            Self::ShadowCascade
            | Self::ShadowTile
            | Self::Bloom
            | Self::Subsurface
            | Self::Ao
            | Self::Ssr
            | Self::Effect
            | Self::Dof
            | Self::FogLight
            | Self::Taa
            | Self::Sky => Place::Always,
            _ => Place::Never,
        }
    }

    /// Every role, in code order. The generated TypeScript takes its names from this order.
    pub const ALL: &'static [PassRole] = &[
        Self::Unknown,
        Self::Background,
        Self::LightClusters,
        Self::Skin,
        Self::Cull,
        Self::Prepass,
        Self::Opaque,
        Self::Occluders,
        Self::Pyramid,
        Self::LateCull,
        Self::ShadowCascade,
        Self::ShadowTile,
        Self::ShadowHero,
        Self::DebugLines,
        Self::Transparent,
        Self::Decals,
        Self::DecalRedraw,
        Self::Pick,
        Self::PickResolve,
        Self::Resolve,
        Self::Bloom,
        Self::OutlineMask,
        Self::SkinLight,
        Self::Subsurface,
        Self::Ao,
        Self::Ssr,
        Self::Effect,
        Self::Dof,
        Self::FogLight,
        Self::FogBlock,
        Self::FogSum,
        Self::FogApply,
        Self::Taa,
        Self::ViewCopy,
        Self::Fullscreen,
        Self::Compute,
        Self::TransmissionCopy,
        Self::Motion,
        Self::MotionView,
        Self::Weighted,
        Self::WeightedComposite,
        Self::ParticleDepthCopy,
        Self::Accumulate,
        Self::Final,
        Self::FinalStill,
        Self::FinalBloom,
        Self::Output,
        Self::OutputBloom,
        Self::ExposureHistogram,
        Self::ExposureDownsample,
        Self::ExposureAdapt,
        Self::FeatureRows,
        Self::Sky,
        Self::LightDepth,
        Self::Moment,
        Self::MomentColour,
        Self::MomentComposite,
        Self::MomentSmaaEdges,
        Self::MomentSmaaBlend,
        Self::MomentSmaaResolve,
    ];
}

/// Whether a role's name prints its place.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum Place {
    /// The name alone.
    Never = 0,
    /// The name, then the place.
    Always = 1,
    /// The place, but not when it is 0.
    WhenSet = 2,
}

/// The bits of a label that hold the place.
pub const PLACE_SHIFT: u32 = 16;

/// A pass label from its role and its place among the passes of that role.
pub const fn label(role: PassRole, place: u32) -> u32 {
    role.code() | (place << PLACE_SHIFT)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_role_is_in_the_name_table_in_code_order() {
        for (index, role) in PassRole::ALL.iter().enumerate() {
            assert_eq!(role.code() as usize, index, "{}", role.name());
        }
    }

    #[test]
    fn each_named_role_has_its_own_name() {
        let mut names: Vec<&str> = PassRole::ALL
            .iter()
            .filter(|role| **role != PassRole::Unknown)
            .map(|role| role.name())
            .collect();
        assert!(names.iter().all(|name| !name.is_empty()));
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), PassRole::ALL.len() - 1);
    }

    #[test]
    fn a_label_holds_its_role_and_place() {
        let label = label(PassRole::ShadowHero, 3);
        assert_eq!(label & 0xffff, PassRole::ShadowHero.code());
        assert_eq!(label >> PLACE_SHIFT, 3);
    }
}
