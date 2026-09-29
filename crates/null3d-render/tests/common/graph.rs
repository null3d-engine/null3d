//! The engine's pass list as the frame builders declare it: four shadow cascades, light
//! clustering, the depth prepass, the opaque, transparent and debug line passes, and the final
//! pass that draws the canvas.

use null3d_gpu::drawlist::format;
use null3d_render::graph::{CANVAS, Pass, PassKind, RenderGraph, Size, Target};

/// The cascade passes, one per layer of the shadow map.
pub const CASCADES: [&str; 4] = [
    "ShadowCascade0",
    "ShadowCascade1",
    "ShadowCascade2",
    "ShadowCascade3",
];
/// The size of each cascade's layer of the shadow map.
pub const SHADOW_MAP: Size = Size::Fixed {
    width: 2048,
    height: 2048,
};
/// MSAA samples of the scene's color and depth.
pub const SAMPLES: u32 = 4;
/// The camera's layers, which the scene passes draw.
pub const CAMERA_LAYERS: u32 = 0b11;
/// The sun's layers, which the cascades draw.
pub const SUN_LAYERS: u32 = 0b1;

/// The engine's passes, in the order the frame builders declare them.
pub fn engine_passes() -> RenderGraph {
    let mut graph = RenderGraph::new();
    graph.keep(
        "shadowMap",
        Target::depth(format::DEPTH32_FLOAT).layers(CASCADES.len() as u32),
        SHADOW_MAP,
    );
    graph.import_buffer("lights");
    for (layer, name) in CASCADES.into_iter().enumerate() {
        graph.add_pass(
            Pass::new(name, PassKind::Shadow)
                .size(SHADOW_MAP)
                .layers(SUN_LAYERS)
                .writes_layer("shadowMap", layer as u32),
        );
    }
    graph.add_pass(
        Pass::new("LightClusters", PassKind::Compute)
            .reads("lights")
            .creates_buffer("lightGrid"),
    );
    graph.add_pass(
        Pass::new("DepthPrepass", PassKind::Scene)
            .layers(CAMERA_LAYERS)
            .creates(
                "sceneDepth",
                Target::depth(format::DEPTH32_FLOAT).samples(SAMPLES),
            ),
    );
    graph.add_pass(
        Pass::new("Opaque", PassKind::Scene)
            .layers(CAMERA_LAYERS)
            .creates(
                "sceneColor",
                Target::color(format::RGBA16_FLOAT).samples(SAMPLES),
            )
            .writes("sceneDepth")
            .reads("shadowMap")
            .reads("lightGrid")
            .reads("lights"),
    );
    graph.add_pass(
        Pass::new("Transparent", PassKind::Scene)
            .layers(CAMERA_LAYERS)
            .writes("sceneColor")
            .writes("sceneDepth")
            .reads("shadowMap")
            .reads("lightGrid")
            .reads("lights"),
    );
    graph.add_pass(
        Pass::new("DebugLines", PassKind::Scene)
            .layers(CAMERA_LAYERS)
            .writes("sceneColor")
            .writes("sceneDepth"),
    );
    graph.add_pass(
        Pass::new("Final", PassKind::Fullscreen)
            .size(Size::Canvas)
            .reads("sceneColor")
            .writes(CANVAS),
    );
    graph
}
