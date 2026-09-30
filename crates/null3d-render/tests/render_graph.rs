//! The render graph: the order it gives passes, its four checks, the textures that targets share,
//! texture usage, passes that share a render pass, compiling only after a change, and the
//! engine's pass list with its text dump.

mod common;

use common::graph::{CAMERA_LAYERS, CASCADES, SAMPLES, SHADOW_MAP, engine_passes};
use null3d_gpu::drawlist::{format, texture_usage as usage};
use null3d_render::graph::{
    ALL_LAYERS, Attachment, CANVAS, GraphError, LoadOp, Mismatch, Pass, PassId, PassKind,
    PlannedTexture, RenderGraph, RenderScale, Size, StepKind, StoreOp, Surface, Target,
};

const HDR: Target = Target::color(format::RGBA16_FLOAT);
const DEPTH: Target = Target::depth(format::DEPTH32_FLOAT);

/// The names of passes.
fn names(graph: &RenderGraph, passes: &[PassId]) -> Vec<String> {
    passes
        .iter()
        .map(|&pass| graph.pass_name(pass).to_owned())
        .collect()
}

/// The names of the passes in each step, as the GPU runs them.
fn steps(graph: &RenderGraph) -> Vec<Vec<String>> {
    let plan = graph.plan().expect("the graph compiled");
    plan.steps()
        .iter()
        .map(|step| names(graph, plan.passes(step)))
        .collect()
}

fn compiled(mut graph: RenderGraph) -> RenderGraph {
    if let Err(error) = graph.compile() {
        panic!("{}", graph.explain(error));
    }
    graph
}

/// The attachments of the step that runs a pass.
fn attachments_of(graph: &RenderGraph, pass: &str) -> Vec<Attachment> {
    let plan = graph.plan().expect("the graph compiled");
    let step = plan.step_of(graph.find_pass(pass).unwrap()).unwrap();
    plan.attachments(&plan.steps()[step]).to_vec()
}

/// Where passes draw into a resource, by name.
fn texture_index(graph: &RenderGraph, resource: &str) -> Option<Surface> {
    graph
        .plan()
        .expect("the graph compiled")
        .texture_of(graph.find_resource(resource).unwrap())
}

/// The planned texture at a surface.
fn texture_of_surface(graph: &RenderGraph, surface: Option<Surface>) -> PlannedTexture {
    match surface {
        Some(Surface::Texture(index)) => {
            graph.plan().expect("the graph compiled").textures()[index as usize]
        }
        other => panic!("not a planned texture: {other:?}"),
    }
}

/// The texture that passes draw into for a resource, by name.
fn texture_of(graph: &RenderGraph, resource: &str) -> PlannedTexture {
    texture_of_surface(graph, texture_index(graph, resource))
}

#[test]
fn the_engine_passes_compile_to_their_order_and_memory_plan() {
    let mut graph = engine_passes();
    graph.set_transient_attachments(true);
    let graph = compiled(graph);
    let plan = graph.plan().unwrap();
    // The light clustering runs first, as compute passes do when they are free to. Each cascade
    // draws into its own layer, the scene passes share one render pass, and the final pass
    // samples the scene, so it starts another.
    assert_eq!(
        names(&graph, plan.order()),
        [
            "LightClusters",
            "ShadowCascade0",
            "ShadowCascade1",
            "ShadowCascade2",
            "ShadowCascade3",
            "DepthPrepass",
            "Opaque",
            "Transparent",
            "DebugLines",
            "Final",
        ]
    );
    assert_eq!(
        steps(&graph),
        [
            vec!["LightClusters"],
            vec!["ShadowCascade0"],
            vec!["ShadowCascade1"],
            vec!["ShadowCascade2"],
            vec!["ShadowCascade3"],
            vec!["DepthPrepass", "Opaque", "Transparent", "DebugLines"],
            vec!["Final"],
        ]
    );
    let shadow = StepKind::Render {
        size: SHADOW_MAP,
        samples: 1,
    };
    assert_eq!(
        plan.steps().iter().map(|s| s.kind).collect::<Vec<_>>(),
        [
            StepKind::Compute,
            shadow,
            shadow,
            shadow,
            shadow,
            StepKind::Render {
                size: Size::Full,
                samples: SAMPLES
            },
            StepKind::Render {
                size: Size::Canvas,
                samples: 1
            },
        ]
    );

    // The kept shadow map comes first. The scene's color and depth live within one render pass,
    // so they stay in tile memory, and the color resolves into a texture the final pass samples.
    let rendered = usage::RENDER_ATTACHMENT;
    let transient = rendered | usage::TRANSIENT_ATTACHMENT;
    let sampled = rendered | usage::TEXTURE_BINDING;
    assert_eq!(
        plan.textures(),
        [
            PlannedTexture {
                target: DEPTH.layers(4),
                size: SHADOW_MAP,
                usage: sampled
            },
            PlannedTexture {
                target: DEPTH.samples(SAMPLES),
                size: Size::Full,
                usage: transient
            },
            PlannedTexture {
                target: HDR.samples(SAMPLES),
                size: Size::Full,
                usage: transient
            },
            PlannedTexture {
                target: HDR,
                size: Size::Full,
                usage: sampled
            },
        ]
    );
    let scene_color = graph.find_resource("sceneColor").unwrap();
    assert_eq!(plan.texture_of(scene_color), Some(Surface::Texture(2)));
    assert_eq!(
        plan.sampled_texture_of(scene_color),
        Some(Surface::Texture(3))
    );

    for (layer, cascade) in CASCADES.into_iter().enumerate() {
        assert_eq!(
            attachments_of(&graph, cascade),
            [Attachment {
                resource: graph.find_resource("shadowMap").unwrap(),
                layer: layer as u32,
                depth: true,
                format: format::DEPTH32_FLOAT,
                texture: Surface::Texture(0),
                resolve: None,
                load: LoadOp::Clear,
                store: StoreOp::Store,
            }]
        );
    }
    assert_eq!(
        attachments_of(&graph, "Opaque"),
        [
            Attachment {
                resource: scene_color,
                layer: 0,
                depth: false,
                format: format::RGBA16_FLOAT,
                texture: Surface::Texture(2),
                resolve: Some(Surface::Texture(3)),
                load: LoadOp::Clear,
                store: StoreOp::Discard,
            },
            Attachment {
                resource: graph.find_resource("sceneDepth").unwrap(),
                layer: 0,
                depth: true,
                format: format::DEPTH32_FLOAT,
                texture: Surface::Texture(1),
                resolve: None,
                load: LoadOp::Clear,
                store: StoreOp::Discard,
            },
        ]
    );
    assert_eq!(
        attachments_of(&graph, "Final"),
        [Attachment {
            resource: graph.canvas(),
            layer: 0,
            depth: false,
            format: format::CANVAS,
            texture: Surface::Canvas,
            resolve: None,
            load: LoadOp::Clear,
            store: StoreOp::Store,
        }]
    );
    assert_eq!(
        graph.pass_layers(graph.find_pass("Opaque").unwrap()),
        CAMERA_LAYERS
    );
}

#[test]
fn the_text_dump_of_the_engine_passes_matches_its_snapshot() {
    let mut graph = engine_passes();
    graph.set_transient_attachments(true);
    let dot = graph.dot();
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/snapshots/engine-passes.dot"
    );
    if std::env::var_os("NULL3D_UPDATE_GENERATED").is_some() {
        std::fs::write(path, &dot).unwrap();
    }
    let expected = std::fs::read_to_string(path).unwrap_or_default();
    assert!(
        dot == expected,
        "{path} is out of date: run `NULL3D_UPDATE_GENERATED=1 cargo test -p null3d-render --test render_graph`\n{dot}"
    );
}

#[test]
fn the_text_dump_shows_passes_that_are_off_and_errors() {
    let mut graph = engine_passes();
    let lines = graph.find_pass("DebugLines").unwrap();
    graph.set_enabled(lines, false);
    let dot = graph.dot();
    assert!(dot.contains(
        r#""pass DebugLines" [shape=box, style=dashed, label="DebugLines\nscene pass, full size, layers 0x00000003, off"];"#
    ));
    assert!(
        !dot.contains(r#""pass DebugLines" -> "#),
        "a pass that is off draws no edges"
    );

    let mut graph = RenderGraph::new();
    graph.add_pass(
        Pass::new("Final", PassKind::Fullscreen)
            .size(Size::Canvas)
            .reads("color")
            .writes(CANVAS),
    );
    let dot = graph.dot();
    assert!(dot.contains(
        r#"  label="E1502: the pass \"Final\" uses \"color\", but no pass creates it.";"#
    ));
    assert!(dot.contains(r#""resource color" [shape=note, label="color\nnot created"];"#));
    assert!(dot.contains(r#""resource color" -> "pass Final";"#));
}

#[test]
fn passes_run_after_what_they_read_in_any_order_of_declaration() {
    let mut graph = RenderGraph::new();
    graph.add_pass(
        Pass::new("Final", PassKind::Fullscreen)
            .size(Size::Canvas)
            .reads("blurred")
            .writes(CANVAS),
    );
    graph.add_pass(
        Pass::new("Blur", PassKind::Fullscreen)
            .size(Size::Half)
            .reads("color")
            .creates("blurred", HDR),
    );
    graph.add_pass(Pass::new("Scene", PassKind::Scene).creates("color", HDR));
    let graph = compiled(graph);
    assert_eq!(
        names(&graph, graph.plan().unwrap().order()),
        ["Scene", "Blur", "Final"]
    );
}

#[test]
fn writers_of_one_target_run_in_the_order_of_declaration() {
    let mut graph = RenderGraph::new();
    graph.add_pass(
        Pass::new("Final", PassKind::Fullscreen)
            .size(Size::Canvas)
            .reads("color")
            .writes(CANVAS),
    );
    graph.add_pass(Pass::new("Sky", PassKind::Fullscreen).writes("color"));
    graph.add_pass(Pass::new("Scene", PassKind::Scene).creates("color", HDR));
    graph.add_pass(Pass::new("Overlay", PassKind::Fullscreen).writes("color"));
    let graph = compiled(graph);
    // The writers run in the order they were declared: Sky, then Scene, which creates the target
    // but finds it written, then Overlay. The reader runs after all three.
    assert_eq!(
        names(&graph, graph.plan().unwrap().order()),
        ["Sky", "Scene", "Overlay", "Final"]
    );
    let attachments = attachments_of(&graph, "Sky");
    assert_eq!(attachments[0].load, LoadOp::Clear);
}

#[test]
fn a_pass_that_can_join_the_open_render_pass_runs_next() {
    let mut graph = RenderGraph::new();
    graph.add_pass(Pass::new("Prepass", PassKind::Scene).creates("depth", DEPTH));
    graph.add_pass(
        Pass::new("Opaque", PassKind::Scene)
            .creates("color", HDR)
            .writes("depth")
            .reads("grid"),
    );
    graph.add_pass(Pass::new("Clusters", PassKind::Compute).creates_buffer("grid"));
    graph.add_pass(
        Pass::new("Final", PassKind::Fullscreen)
            .size(Size::Canvas)
            .reads("color")
            .writes(CANVAS),
    );
    let graph = compiled(graph);
    // The clusters run first, though the prepass was declared first: running the prepass first
    // would split it from the opaque pass, which waits for the clusters.
    assert_eq!(
        steps(&graph),
        [vec!["Clusters"], vec!["Prepass", "Opaque"], vec!["Final"]],
        "a free compute pass runs before free render passes"
    );

    let mut graph = RenderGraph::new();
    graph.add_pass(
        Pass::new("Opaque", PassKind::Scene)
            .creates("color", HDR)
            .creates("depth", DEPTH),
    );
    graph.add_pass(
        Pass::new("Bloom", PassKind::Fullscreen)
            .size(Size::Half)
            .creates("glow", HDR),
    );
    graph.add_pass(
        Pass::new("Lines", PassKind::Scene)
            .writes("color")
            .writes("depth"),
    );
    graph.add_pass(
        Pass::new("Final", PassKind::Fullscreen)
            .size(Size::Canvas)
            .reads("color")
            .reads("glow")
            .writes(CANVAS),
    );
    let graph = compiled(graph);
    assert_eq!(
        steps(&graph),
        [vec!["Opaque", "Lines"], vec!["Bloom"], vec!["Final"]],
        "a free pass that joins the open render pass goes before one declared earlier"
    );
}

#[test]
fn reading_what_no_running_pass_writes_fails_with_code_1502() {
    let mut graph = engine_passes();
    for pass in ["Opaque", "Transparent", "DebugLines"] {
        let pass = graph.find_pass(pass).unwrap();
        graph.set_enabled(pass, false);
    }
    let error = graph.compile().unwrap_err();
    assert_eq!(
        error,
        GraphError::MissingInput {
            pass: graph.find_pass("Final").unwrap(),
            resource: graph.find_resource("sceneColor").unwrap(),
        }
    );
    assert_eq!(error.code(), 1502);
    assert_eq!(
        error.details(),
        [
            graph.find_pass("Final").unwrap().index() as u32,
            graph.find_resource("sceneColor").unwrap().index() as u32
        ]
    );
    assert_eq!(
        graph.explain(error),
        r#"E1502: the pass "Final" reads "sceneColor", but no pass that runs this frame writes it."#
    );
    assert!(graph.plan().is_none(), "a failed compile leaves no plan");
    assert_eq!(
        graph.compile(),
        Err(error),
        "it fails again until it changes"
    );
    assert_eq!(graph.compiles(), 1);
    // The transparent pass then writes the color first, so it clears it.
    let transparent = graph.find_pass("Transparent").unwrap();
    graph.set_enabled(transparent, true);
    assert_eq!(graph.compile(), Ok(true));
    assert_eq!(attachments_of(&graph, "Transparent")[0].load, LoadOp::Clear);
}

#[test]
fn using_what_no_pass_creates_fails_with_code_1502() {
    let mut graph = RenderGraph::new();
    graph.add_pass(
        Pass::new("Opaque", PassKind::Scene)
            .creates("color", HDR)
            .reads("lightGrid"),
    );
    let error = graph.compile().unwrap_err();
    assert_eq!(error.code(), GraphError::MISSING_INPUT);
    assert_eq!(
        graph.explain(error),
        r#"E1502: the pass "Opaque" uses "lightGrid", but no pass creates it."#
    );

    let mut graph = RenderGraph::new();
    graph.add_pass(Pass::new("Lines", PassKind::Scene).writes("color"));
    assert_eq!(
        graph.compile().map_err(|e| graph.explain(e)),
        Err(r#"E1502: the pass "Lines" uses "color", but no pass creates it."#.to_owned())
    );
}

#[test]
fn a_kept_target_or_an_imported_buffer_needs_no_writer() {
    let mut graph = RenderGraph::new();
    graph.keep("history", HDR, Size::Full);
    graph.import_buffer("lights");
    graph.add_pass(
        Pass::new("Scene", PassKind::Scene)
            .creates("color", HDR)
            .reads("history")
            .reads("lights"),
    );
    compiled(graph);
}

#[test]
fn two_creators_of_one_target_fail_with_code_1503() {
    let mut graph = RenderGraph::new();
    graph.add_pass(Pass::new("Opaque", PassKind::Scene).creates("color", HDR));
    let sky = graph.add_pass(Pass::new("Sky", PassKind::Scene).creates("color", HDR));
    // A creator that is switched off still declares its target.
    graph.set_enabled(sky, false);
    let error = graph.compile().unwrap_err();
    assert_eq!(
        error,
        GraphError::TwoCreators {
            resource: graph.find_resource("color").unwrap(),
            pass: sky,
        }
    );
    assert_eq!(error.code(), 1503);
    assert_eq!(
        graph.explain(error),
        r#"E1503: both "Opaque" and "Sky" create "color"."#
    );

    let mut graph = RenderGraph::new();
    graph.keep("shadowMap", DEPTH, SHADOW_MAP);
    graph.add_pass(
        Pass::new("Shadows", PassKind::Shadow)
            .size(SHADOW_MAP)
            .creates("shadowMap", DEPTH),
    );
    let error = graph.compile().unwrap_err();
    assert_eq!(
        graph.explain(error),
        r#"E1503: the pass "Shadows" creates "shadowMap", which the graph keeps between frames."#
    );

    let mut graph = RenderGraph::new();
    graph.add_pass(
        Pass::new("Final", PassKind::Fullscreen)
            .size(Size::Canvas)
            .creates(CANVAS, HDR),
    );
    let error = graph.compile().unwrap_err();
    assert_eq!(
        graph.explain(error),
        r#"E1503: the pass "Final" creates "canvas", which comes from outside the graph."#
    );
}

#[test]
fn a_cycle_fails_with_code_1504_and_names_its_passes() {
    let mut graph = RenderGraph::new();
    graph.add_pass(Pass::new("Scene", PassKind::Scene).creates("color", HDR));
    // Glow reads the scene after Tint, the last writer, and Tint reads Glow's output.
    graph.add_pass(
        Pass::new("Glow", PassKind::Fullscreen)
            .reads("color")
            .creates("glow", HDR),
    );
    graph.add_pass(
        Pass::new("Tint", PassKind::Fullscreen)
            .reads("glow")
            .writes("color"),
    );
    let error = graph.compile().unwrap_err();
    let glow = graph.find_pass("Glow").unwrap();
    let tint = graph.find_pass("Tint").unwrap();
    assert_eq!(
        error,
        GraphError::Cycle {
            first: glow,
            second: tint
        }
    );
    assert_eq!(error.code(), 1504);
    assert_eq!(error.details(), [glow.index() as u32, tint.index() as u32]);
    assert_eq!(
        graph.explain(error),
        r#"E1504: the passes form a cycle: "Tint" runs after "Glow", and "Glow" after "Tint"."#
    );

    let mut graph = RenderGraph::new();
    graph.add_pass(
        Pass::new("A", PassKind::Compute)
            .reads("c")
            .creates_buffer("a"),
    );
    graph.add_pass(
        Pass::new("B", PassKind::Compute)
            .reads("a")
            .creates_buffer("b"),
    );
    graph.add_pass(
        Pass::new("C", PassKind::Compute)
            .reads("b")
            .creates_buffer("c"),
    );
    graph.add_pass(Pass::new("D", PassKind::Compute).reads("c"));
    let error = graph.compile().unwrap_err();
    assert_eq!(
        graph.explain(error),
        r#"E1504: the passes form a cycle: "B" runs after "A", "C" after "B", and "A" after "C"."#
    );
}

#[test]
fn targets_that_cannot_share_a_render_pass_fail_with_code_1505() {
    let check = |graph: &mut RenderGraph, reason: Mismatch, message: &str| {
        let error = graph.compile().unwrap_err();
        assert!(
            matches!(error, GraphError::TargetMismatch { reason: r, .. } if r == reason),
            "{error:?}"
        );
        assert_eq!(error.code(), 1505);
        assert_eq!(graph.explain(error), message);
    };

    let mut graph = RenderGraph::new();
    graph.add_pass(Pass::new("Scene", PassKind::Scene).creates("color", HDR));
    graph.add_pass(
        Pass::new("Blur", PassKind::Fullscreen)
            .size(Size::Half)
            .writes("color"),
    );
    check(
        &mut graph,
        Mismatch::Size,
        r#"E1505: the pass "Blur" draws at half size into "color", which is full size."#,
    );

    let mut graph = RenderGraph::new();
    graph.add_pass(
        Pass::new("Scene", PassKind::Scene)
            .creates("color", HDR.samples(4))
            .creates("depth", DEPTH),
    );
    check(
        &mut graph,
        Mismatch::Samples,
        r#"E1505: the pass "Scene" draws into "color" and "depth", whose sample counts differ: 4 and 1."#,
    );

    let mut graph = RenderGraph::new();
    graph.add_pass(
        Pass::new("Scene", PassKind::Scene)
            .creates("depth", DEPTH)
            .creates("more depth", DEPTH),
    );
    check(
        &mut graph,
        Mismatch::Depth,
        r#"E1505: the pass "Scene" draws into "more depth" as a second depth target."#,
    );

    let mut graph = RenderGraph::new();
    graph.keep("shadowMap", DEPTH.layers(4), SHADOW_MAP);
    graph.add_pass(
        Pass::new("Shadows", PassKind::Shadow)
            .size(SHADOW_MAP)
            .writes("shadowMap"),
    );
    check(
        &mut graph,
        Mismatch::AllLayers,
        r#"E1505: the pass "Shadows" draws into "shadowMap", which has 4 layers, without naming one."#,
    );

    let mut graph = RenderGraph::new();
    graph.keep("shadowMap", DEPTH.layers(4), SHADOW_MAP);
    graph.add_pass(
        Pass::new("Shadows", PassKind::Shadow)
            .size(SHADOW_MAP)
            .writes_layer("shadowMap", 4),
    );
    check(
        &mut graph,
        Mismatch::Layer,
        r#"E1505: the pass "Shadows" draws into layer 4 of "shadowMap", which has 4 layers."#,
    );

    let mut graph = RenderGraph::new();
    graph.import_buffer("lights");
    graph.add_pass(Pass::new("Scene", PassKind::Scene).reads("lights"));
    check(
        &mut graph,
        Mismatch::NoTarget,
        r#"E1505: the pass "Scene" draws into no target."#,
    );
    assert_eq!(
        graph.compile().unwrap_err().details(),
        [0, u32::MAX],
        "a pass with no target has no target to name"
    );
}

/// A scene target blurred at half size twice, into three half-size targets: the first and the
/// third live at different times.
fn blur_chain() -> RenderGraph {
    let mut graph = RenderGraph::new();
    graph.add_pass(Pass::new("Scene", PassKind::Scene).creates("color", HDR));
    graph.add_pass(
        Pass::new("Down", PassKind::Fullscreen)
            .size(Size::Half)
            .reads("color")
            .creates("half a", HDR),
    );
    graph.add_pass(
        Pass::new("Across", PassKind::Fullscreen)
            .size(Size::Half)
            .reads("half a")
            .creates("half b", HDR),
    );
    graph.add_pass(
        Pass::new("Back", PassKind::Fullscreen)
            .size(Size::Half)
            .reads("half b")
            .creates("half c", HDR),
    );
    graph.add_pass(
        Pass::new("Final", PassKind::Fullscreen)
            .size(Size::Canvas)
            .reads("half c")
            .writes(CANVAS),
    );
    compiled(graph)
}

#[test]
fn half_size_targets_with_separate_lifetimes_share_one_texture() {
    let graph = blur_chain();
    let half = PlannedTexture {
        target: HDR,
        size: Size::Half,
        usage: usage::RENDER_ATTACHMENT | usage::TEXTURE_BINDING,
    };
    assert_eq!(texture_of(&graph, "half a"), half);
    assert_eq!(texture_of(&graph, "half c"), half);
    assert_eq!(
        texture_index(&graph, "half a"),
        texture_index(&graph, "half c"),
        "the first half-size target is done before the third starts"
    );
    assert_ne!(
        texture_index(&graph, "half a"),
        texture_index(&graph, "half b"),
        "the second is in use while the first and the third are"
    );
    assert_eq!(graph.plan().unwrap().textures().len(), 3);
}

#[test]
fn targets_of_other_shapes_never_share() {
    let mut graph = RenderGraph::new();
    graph.add_pass(Pass::new("Scene", PassKind::Scene).creates("color", HDR));
    graph.add_pass(
        Pass::new("Down", PassKind::Fullscreen)
            .size(Size::Half)
            .reads("color")
            .creates("half", HDR),
    );
    graph.add_pass(
        Pass::new("Quarter", PassKind::Fullscreen)
            .size(Size::Quarter)
            .reads("half")
            .creates("quarter", HDR),
    );
    graph.add_pass(
        Pass::new("Mask", PassKind::Fullscreen)
            .size(Size::Half)
            .reads("quarter")
            .creates("mask", Target::color(format::RGBA8_UNORM)),
    );
    graph.add_pass(
        Pass::new("Final", PassKind::Fullscreen)
            .size(Size::Canvas)
            .reads("mask")
            .writes(CANVAS),
    );
    let graph = compiled(graph);
    // "half" is done before "mask" starts, but their formats differ.
    assert_ne!(texture_index(&graph, "half"), texture_index(&graph, "mask"));
    assert_eq!(graph.plan().unwrap().textures().len(), 4);
}

#[test]
fn usage_flags_follow_how_passes_use_each_target() {
    let mut graph = RenderGraph::new();
    graph.add_pass(
        Pass::new("Scene", PassKind::Scene)
            .creates("color", HDR)
            .creates("depth", DEPTH),
    );
    graph.add_pass(
        Pass::new("Histogram", PassKind::Compute)
            .reads("color")
            .creates("luminance", Target::color(format::R32_UINT)),
    );
    graph.add_pass(
        Pass::new("Final", PassKind::Fullscreen)
            .size(Size::Canvas)
            .reads("color")
            .reads("luminance")
            .writes(CANVAS),
    );
    let graph = compiled(graph);
    assert_eq!(
        texture_of(&graph, "color").usage,
        usage::RENDER_ATTACHMENT | usage::TEXTURE_BINDING,
        "drawn into, then sampled"
    );
    assert_eq!(
        texture_of(&graph, "depth").usage,
        usage::RENDER_ATTACHMENT,
        "only drawn into"
    );
    assert_eq!(
        texture_of(&graph, "luminance").usage,
        usage::STORAGE_BINDING | usage::TEXTURE_BINDING,
        "written by a compute pass, then sampled"
    );
    let depth = attachments_of(&graph, "Scene")[1];
    assert_eq!((depth.load, depth.store), (LoadOp::Clear, StoreOp::Discard));
    let color = attachments_of(&graph, "Scene")[0];
    assert_eq!((color.load, color.store), (LoadOp::Clear, StoreOp::Store));
}

#[test]
fn transient_attachments_only_where_the_device_has_them_and_the_target_allows() {
    let mut graph = engine_passes();
    let scene_depth = |graph: &RenderGraph| texture_of(graph, "sceneDepth").usage;
    graph.compile().unwrap();
    assert_eq!(
        scene_depth(&graph),
        usage::RENDER_ATTACHMENT,
        "no flag, no transient usage"
    );
    graph.set_transient_attachments(true);
    assert_eq!(graph.compile(), Ok(true), "the flag changes the plan");
    assert_eq!(
        scene_depth(&graph),
        usage::RENDER_ATTACHMENT | usage::TRANSIENT_ATTACHMENT
    );

    // A compute pass that reads the depth after the scene needs it stored, so the depth cannot
    // stay in tile memory.
    graph.add_pass(Pass::new("DepthPyramid", PassKind::Compute).reads("sceneDepth"));
    let graph = compiled(graph);
    assert_eq!(
        scene_depth(&graph),
        usage::RENDER_ATTACHMENT | usage::TEXTURE_BINDING
    );

    // Arrays and kept targets never get the transient usage.
    let mut graph = RenderGraph::new();
    graph.set_transient_attachments(true);
    graph.keep("kept", HDR, Size::Full);
    graph.add_pass(
        Pass::new("Layered", PassKind::Scene)
            .creates("array", HDR.layers(2))
            .writes_layer("array", 1),
    );
    graph.add_pass(Pass::new("Kept", PassKind::Scene).writes("kept"));
    let graph = compiled(graph);
    assert_eq!(texture_of(&graph, "array").usage, usage::RENDER_ATTACHMENT);
    assert_eq!(texture_of(&graph, "kept").usage, usage::RENDER_ATTACHMENT);
}

#[test]
fn neighbors_with_the_same_targets_share_one_render_pass() {
    let graph = compiled(engine_passes());
    let plan = graph.plan().unwrap();
    let scene = plan.step_of(graph.find_pass("Opaque").unwrap()).unwrap();
    for pass in ["DepthPrepass", "Transparent", "DebugLines"] {
        assert_eq!(
            plan.step_of(graph.find_pass(pass).unwrap()),
            Some(scene),
            "{pass}"
        );
    }
    // The prepass draws into the depth alone; the render pass has the color too, from the start.
    assert_eq!(
        attachments_of(&graph, "DepthPrepass")
            .iter()
            .map(|a| graph.resource_name(a.resource).to_owned())
            .collect::<Vec<_>>(),
        ["sceneColor", "sceneDepth"]
    );
}

#[test]
fn a_pass_that_samples_a_target_of_the_render_pass_or_draws_at_another_size_starts_another() {
    let mut graph = RenderGraph::new();
    graph.add_pass(
        Pass::new("Opaque", PassKind::Scene)
            .creates("color", HDR)
            .creates("depth", DEPTH),
    );
    // The outline draws into the color, which the open render pass holds, but samples the depth.
    graph.add_pass(
        Pass::new("Outline", PassKind::Fullscreen)
            .reads("depth")
            .writes("color"),
    );
    graph.add_pass(
        Pass::new("Small", PassKind::Scene)
            .size(Size::Half)
            .creates("small", HDR),
    );
    graph.add_pass(
        Pass::new("Final", PassKind::Fullscreen)
            .size(Size::Canvas)
            .reads("color")
            .reads("small")
            .writes(CANVAS),
    );
    let graph = compiled(graph);
    assert_eq!(
        steps(&graph),
        [
            vec!["Opaque"],
            vec!["Outline"],
            vec!["Small"],
            vec!["Final"]
        ]
    );
    let opaque = attachments_of(&graph, "Opaque");
    assert_eq!(
        (opaque[0].load, opaque[0].store),
        (LoadOp::Clear, StoreOp::Store),
        "the outline loads the color"
    );
    assert_eq!(
        (opaque[1].load, opaque[1].store),
        (LoadOp::Clear, StoreOp::Store),
        "the outline samples the depth"
    );
    let outline = attachments_of(&graph, "Outline");
    assert_eq!(outline.len(), 1);
    assert_eq!(
        (outline[0].load, outline[0].store),
        (LoadOp::Load, StoreOp::Store)
    );
    assert_eq!(
        texture_of(&graph, "depth").usage,
        usage::RENDER_ATTACHMENT | usage::TEXTURE_BINDING
    );
}

#[test]
fn each_layer_of_a_multisampled_array_resolves_after_its_last_draw() {
    let probes = HDR.samples(4).layers(2);
    let mut graph = RenderGraph::new();
    graph.add_pass(
        Pass::new("Face0", PassKind::Scene)
            .creates("probes", probes)
            .writes_layer("probes", 0),
    );
    graph.add_pass(Pass::new("Face1", PassKind::Scene).writes_layer("probes", 1));
    graph.add_pass(Pass::new("Face0Decals", PassKind::Scene).writes_layer("probes", 0));
    graph.add_pass(
        Pass::new("Final", PassKind::Fullscreen)
            .size(Size::Canvas)
            .reads("probes")
            .writes(CANVAS),
    );
    let graph = compiled(graph);
    // Each pass draws into another layer than the one before it, so each has its own render pass.
    assert_eq!(
        steps(&graph),
        [
            vec!["Face0"],
            vec!["Face1"],
            vec!["Face0Decals"],
            vec!["Final"]
        ]
    );
    let plan = graph.plan().unwrap();
    let resource = graph.find_resource("probes").unwrap();
    let resolved = plan.sampled_texture_of(resource);
    assert_ne!(resolved, plan.texture_of(resource));
    assert_eq!(
        texture_of_surface(&graph, resolved),
        PlannedTexture {
            target: HDR.layers(2),
            size: Size::Full,
            usage: usage::RENDER_ATTACHMENT | usage::TEXTURE_BINDING,
        }
    );
    let ops = |pass: &str| {
        let attachment = attachments_of(&graph, pass)[0];
        (
            attachment.layer,
            attachment.load,
            attachment.store,
            attachment.resolve,
        )
    };
    assert_eq!(
        ops("Face0"),
        (0, LoadOp::Clear, StoreOp::Store, None),
        "a later pass draws over layer 0, so it keeps the samples and resolves nothing yet"
    );
    assert_eq!(
        ops("Face1"),
        (1, LoadOp::Clear, StoreOp::Discard, resolved),
        "no later pass draws layer 1, so it resolves now"
    );
    assert_eq!(
        ops("Face0Decals"),
        (0, LoadOp::Load, StoreOp::Discard, resolved)
    );
}

#[test]
fn a_pass_that_reads_a_buffer_written_in_the_render_pass_starts_another() {
    let mut graph = RenderGraph::new();
    graph.import_buffer("instances");
    // The opaque pass's fragment shader writes which objects it drew, and the outline pass reads
    // that as a vertex buffer. One render pass cannot both write and read a buffer.
    graph.add_pass(
        Pass::new("Opaque", PassKind::Scene)
            .creates("color", HDR)
            .reads("instances")
            .creates_buffer("drawn"),
    );
    graph.add_pass(
        Pass::new("Outline", PassKind::Scene)
            .writes("color")
            .reads("drawn")
            .reads("instances"),
    );
    graph.add_pass(
        Pass::new("Final", PassKind::Fullscreen)
            .size(Size::Canvas)
            .reads("color")
            .writes(CANVAS),
    );
    let graph = compiled(graph);
    assert_eq!(
        steps(&graph),
        [vec!["Opaque"], vec!["Outline"], vec!["Final"]]
    );
    let color = attachments_of(&graph, "Outline")[0];
    assert_eq!(
        (color.load, color.store),
        (LoadOp::Load, StoreOp::Store),
        "the outline draws over the stored scene"
    );

    // Passes that only read the same buffer share one render pass.
    let mut graph = RenderGraph::new();
    graph.import_buffer("instances");
    graph.add_pass(
        Pass::new("Opaque", PassKind::Scene)
            .creates("color", HDR)
            .reads("instances"),
    );
    graph.add_pass(
        Pass::new("Outline", PassKind::Scene)
            .writes("color")
            .reads("instances"),
    );
    let graph = compiled(graph);
    assert_eq!(steps(&graph), [vec!["Opaque", "Outline"]]);
}

#[test]
fn neighboring_compute_passes_share_one_compute_pass() {
    let mut graph = RenderGraph::new();
    graph.import_buffer("instances");
    graph.add_pass(
        Pass::new("CullCamera", PassKind::Compute)
            .reads("instances")
            .creates_buffer("visible"),
    );
    graph.add_pass(
        Pass::new("CullSun", PassKind::Compute)
            .reads("instances")
            .creates_buffer("casters"),
    );
    graph.add_pass(
        Pass::new("Scene", PassKind::Scene)
            .reads("visible")
            .reads("casters")
            .creates("color", HDR),
    );
    let graph = compiled(graph);
    assert_eq!(
        steps(&graph),
        [vec!["CullCamera", "CullSun"], vec!["Scene"]]
    );
    let plan = graph.plan().unwrap();
    assert_eq!(plan.steps()[0].kind, StepKind::Compute);
    assert!(plan.attachments(&plan.steps()[0]).is_empty());
}

#[test]
fn the_graph_compiles_only_after_a_change() {
    let mut graph = engine_passes();
    assert_eq!(graph.compiles(), 0);
    assert_eq!(graph.compile(), Ok(true));
    assert_eq!(graph.compile(), Ok(false));
    assert_eq!(graph.compiles(), 1);

    let lines = graph.find_pass("DebugLines").unwrap();
    graph.set_enabled(lines, true);
    graph.set_layers(lines, 0b100);
    assert_eq!(graph.compile(), Ok(false), "no state changed");
    assert_eq!(graph.pass_layers(lines), 0b100);

    // A batch of changes compiles once.
    graph.set_enabled(lines, false);
    for cascade in &CASCADES[1..] {
        let pass = graph.find_pass(cascade).unwrap();
        graph.set_enabled(pass, false);
    }
    assert!(
        graph.plan().is_none(),
        "the plan is stale until the graph compiles"
    );
    assert_eq!(graph.compile(), Ok(true));
    assert_eq!(graph.compile(), Ok(false));
    assert_eq!(graph.compiles(), 2);
    assert_eq!(graph.plan().unwrap().order().len(), 6);
}

#[test]
fn switching_cascades_in_turn_keeps_every_texture() {
    let mut graph = engine_passes();
    graph.set_transient_attachments(true);
    graph.compile().unwrap();
    let textures = graph.plan().unwrap().textures().to_vec();
    let generation = graph.plan().unwrap().memory_generation();
    let cascades: Vec<PassId> = CASCADES
        .iter()
        .map(|c| graph.find_pass(c).unwrap())
        .collect();
    for frame in 0..8 {
        // The near cascade draws every frame, and the others one frame in three, in turn.
        for (index, &cascade) in cascades.iter().enumerate().skip(1) {
            graph.set_enabled(cascade, frame % 3 == index - 1);
        }
        graph.compile().unwrap();
        let plan = graph.plan().unwrap();
        assert_eq!(plan.textures(), textures);
        assert_eq!(plan.memory_generation(), generation);
    }
}

#[test]
fn the_first_running_writer_clears_a_target_whose_creator_is_off() {
    let mut graph = engine_passes();
    let prepass = graph.find_pass("DepthPrepass").unwrap();
    graph.set_enabled(prepass, false);
    let graph = compiled(graph);
    let depth = attachments_of(&graph, "Opaque")[1];
    assert_eq!(graph.resource_name(depth.resource), "sceneDepth");
    assert_eq!((depth.load, depth.store), (LoadOp::Clear, StoreOp::Discard));
    assert_eq!(steps(&graph)[5], ["Opaque", "Transparent", "DebugLines"]);
}

#[test]
fn kept_targets_keep_their_contents_from_frame_to_frame() {
    let mut graph = RenderGraph::new();
    let atlas = Size::Fixed {
        width: 4096,
        height: 4096,
    };
    graph.keep("atlas", DEPTH, atlas);
    let tiles: Vec<PassId> = (0..3)
        .map(|tile| {
            graph.add_pass(
                Pass::new(format!("Tile{tile}"), PassKind::Shadow)
                    .size(atlas)
                    .writes_part("atlas"),
            )
        })
        .collect();
    graph.add_pass(
        Pass::new("Scene", PassKind::Scene)
            .reads("atlas")
            .creates("color", HDR),
    );
    let mut graph = compiled(graph);
    assert_eq!(
        steps(&graph),
        [vec!["Tile0", "Tile1", "Tile2"], vec!["Scene"]],
        "tiles of one atlas share a render pass"
    );
    let tile = attachments_of(&graph, "Tile0")[0];
    assert_eq!(
        (tile.load, tile.store),
        (LoadOp::Load, StoreOp::Store),
        "a tile keeps the rest of the atlas"
    );

    // With no tile to draw, the scene samples what earlier frames drew.
    for &tile in &tiles {
        graph.set_enabled(tile, false);
    }
    let graph = compiled(graph);
    assert_eq!(steps(&graph), [vec!["Scene"]]);
    assert_eq!(
        texture_index(&graph, "atlas"),
        Some(Surface::Texture(0)),
        "a kept target keeps its texture"
    );
}

#[test]
fn sizes_follow_the_canvas_and_the_render_scale() {
    let canvas = (1001, 600);
    assert_eq!(Size::Full.extent(canvas), (1001, 600));
    assert_eq!(Size::Canvas.extent(canvas), (1001, 600));
    assert_eq!(Size::Half.extent(canvas), (501, 300));
    assert_eq!(Size::Quarter.extent(canvas), (251, 150));
    assert_eq!(SHADOW_MAP.extent(canvas), (2048, 2048));
    assert_eq!(Size::Full.extent((0, 0)), (1, 1));

    // A lower render scale draws into a corner of the same textures.
    let half = RenderScale::from_thousandths(500);
    assert_eq!(Size::Full.viewport(canvas, half), (501, 300));
    assert_eq!(Size::Half.viewport(canvas, half), (251, 150));
    assert_eq!(Size::Canvas.viewport(canvas, half), (1001, 600));
    assert_eq!(SHADOW_MAP.viewport(canvas, half), (2048, 2048));
    assert_eq!(Size::Full.viewport(canvas, RenderScale::FULL), canvas);
    assert_eq!(
        Size::Full.viewport(canvas, RenderScale::from_thousandths(2000)),
        canvas
    );
    assert_eq!(
        Size::Quarter.viewport(canvas, RenderScale::from_thousandths(0)),
        (1, 1)
    );
    // Whole thousandths give exact sizes, rounded up.
    let scale = RenderScale::from_thousandths(600);
    assert_eq!(Size::Full.viewport((320, 180), scale), (192, 108));
    assert_eq!(RenderScale::from_thousandths(750).of(1001), 751);
    assert_eq!(RenderScale::default(), RenderScale::FULL);
}

#[test]
fn a_pass_that_names_a_resource_twice_keeps_the_larger_use() {
    let mut graph = RenderGraph::new();
    graph.add_pass(
        Pass::new("Scene", PassKind::Scene)
            .reads("color")
            .creates("color", HDR)
            .reads("color"),
    );
    let graph = compiled(graph);
    assert_eq!(steps(&graph), [vec!["Scene"]]);
    assert_eq!(texture_of(&graph, "color").usage, usage::RENDER_ATTACHMENT);
    assert_eq!(
        graph.pass_layers(graph.find_pass("Scene").unwrap()),
        ALL_LAYERS
    );
}

#[test]
fn the_error_table_shows_the_messages_the_graph_prints() {
    let table = include_str!("../../../packages/engine/src/errors/codes.ts");

    let mut missing = RenderGraph::new();
    let opaque = missing.add_pass(Pass::new("Opaque", PassKind::Scene).creates("sceneColor", HDR));
    missing.set_enabled(opaque, false);
    missing.add_pass(
        Pass::new("Final", PassKind::Fullscreen)
            .size(Size::Canvas)
            .reads("sceneColor")
            .writes(CANVAS),
    );

    let mut twice = RenderGraph::new();
    twice.add_pass(Pass::new("Opaque", PassKind::Scene).creates("sceneColor", HDR));
    twice.add_pass(Pass::new("Sky", PassKind::Scene).creates("sceneColor", HDR));

    let mut cycle = RenderGraph::new();
    cycle.add_pass(Pass::new("Scene", PassKind::Scene).creates("color", HDR));
    cycle.add_pass(
        Pass::new("Glow", PassKind::Fullscreen)
            .reads("color")
            .creates("glow", HDR),
    );
    cycle.add_pass(
        Pass::new("Tint", PassKind::Fullscreen)
            .reads("glow")
            .writes("color"),
    );

    let mut mismatch = RenderGraph::new();
    mismatch.add_pass(Pass::new("Opaque", PassKind::Scene).creates("sceneColor", HDR));
    mismatch.add_pass(
        Pass::new("Blur", PassKind::Fullscreen)
            .size(Size::Half)
            .writes("sceneColor"),
    );

    for mut graph in [missing, twice, cycle, mismatch] {
        let error = graph.compile().unwrap_err();
        let message = graph.explain(error);
        assert!(
            table.contains(&format!("'{message}'")),
            "codes.ts has no example {message}"
        );
    }
}

/// The scene's color in the canvas's format and its depth, both multisampled; a resolve pass that
/// takes the color to the canvas, and a final pass that would, switched off.
fn resolved_scene() -> RenderGraph {
    let mut graph = RenderGraph::new();
    graph.add_pass(
        Pass::new("Opaque", PassKind::Scene)
            .creates("sceneColor", Target::color(format::CANVAS).samples(SAMPLES))
            .creates("sceneDepth", DEPTH.samples(SAMPLES)),
    );
    graph.add_pass(
        Pass::new("Resolve", PassKind::Resolve)
            .reads("sceneColor")
            .writes(CANVAS),
    );
    let final_pass = graph.add_pass(
        Pass::new("Final", PassKind::Fullscreen)
            .size(Size::Canvas)
            .reads("sceneColor")
            .writes(CANVAS),
    );
    graph.set_enabled(final_pass, false);
    graph
}

#[test]
fn a_resolve_pass_resolves_its_target_into_the_canvas_in_the_render_pass_that_draws_it() {
    let mut graph = resolved_scene();
    graph.set_transient_attachments(true);
    let graph = compiled(graph);
    // The resolve joins the scene's render pass and costs no pass, copy or texture of its own.
    assert_eq!(steps(&graph), [vec!["Opaque", "Resolve"]]);
    let [color, depth] = attachments_of(&graph, "Opaque")[..] else {
        panic!("the scene's render pass has a color and a depth attachment");
    };
    assert_eq!(color.resolve, Some(Surface::Canvas));
    assert_eq!((color.load, color.store), (LoadOp::Clear, StoreOp::Discard));
    assert_eq!(
        (depth.resolve, depth.load, depth.store),
        (None, LoadOp::Clear, StoreOp::Discard)
    );
    let transient = usage::RENDER_ATTACHMENT | usage::TRANSIENT_ATTACHMENT;
    assert_eq!(
        graph.plan().unwrap().textures(),
        [
            PlannedTexture {
                target: Target::color(format::CANVAS).samples(SAMPLES),
                size: Size::Full,
                usage: transient
            },
            PlannedTexture {
                target: DEPTH.samples(SAMPLES),
                size: Size::Full,
                usage: transient
            },
        ],
        "no texture to resolve into, and both targets stay in tile memory"
    );
    let color = graph.find_resource("sceneColor").unwrap();
    assert_eq!(graph.plan().unwrap().sampled_texture_of(color), None);
}

#[test]
fn switching_from_the_resolve_to_the_final_pass_resolves_into_a_texture_it_samples() {
    let mut graph = resolved_scene();
    let (resolve, final_pass) = (
        graph.find_pass("Resolve").unwrap(),
        graph.find_pass("Final").unwrap(),
    );
    graph.compile().unwrap();
    graph.set_enabled(resolve, false);
    graph.set_enabled(final_pass, true);
    assert_eq!(graph.compile(), Ok(true), "one compile for both switches");
    assert_eq!(steps(&graph), [vec!["Opaque"], vec!["Final"]]);
    let color = attachments_of(&graph, "Opaque")[0];
    let sampled = graph
        .plan()
        .unwrap()
        .sampled_texture_of(graph.find_resource("sceneColor").unwrap());
    assert!(matches!(sampled, Some(Surface::Texture(_))));
    assert_eq!(color.resolve, sampled);
    assert_eq!(
        texture_of_surface(&graph, sampled).usage,
        usage::RENDER_ATTACHMENT | usage::TEXTURE_BINDING
    );

    graph.set_enabled(resolve, true);
    graph.set_enabled(final_pass, false);
    graph.compile().unwrap();
    assert_eq!(steps(&graph), [vec!["Opaque", "Resolve"]]);
    assert_eq!(
        attachments_of(&graph, "Opaque")[0].resolve,
        Some(Surface::Canvas)
    );
}

#[test]
fn a_pass_that_draws_into_the_canvas_after_a_resolve_keeps_what_it_holds() {
    let mut graph = resolved_scene();
    graph.add_pass(
        Pass::new("Overlay", PassKind::Fullscreen)
            .size(Size::Canvas)
            .writes(CANVAS),
    );
    let graph = compiled(graph);
    assert_eq!(steps(&graph), [vec!["Opaque", "Resolve"], vec!["Overlay"]]);
    let canvas = attachments_of(&graph, "Overlay")[0];
    assert_eq!((canvas.load, canvas.store), (LoadOp::Load, StoreOp::Store));
}

#[test]
fn a_resolve_of_a_kept_target_that_no_pass_draws_this_frame_loads_it() {
    let mut graph = RenderGraph::new();
    let kept = Target::color(format::CANVAS).samples(SAMPLES);
    graph.keep("picture", kept, Size::Full);
    let draw = graph.add_pass(Pass::new("Picture", PassKind::Scene).writes("picture"));
    graph.add_pass(
        Pass::new("Resolve", PassKind::Resolve)
            .reads("picture")
            .writes(CANVAS),
    );
    graph.set_enabled(draw, false);
    let graph = compiled(graph);
    assert_eq!(steps(&graph), [vec!["Resolve"]]);
    let [picture] = attachments_of(&graph, "Resolve")[..] else {
        panic!("the resolve's render pass attaches the kept target");
    };
    assert_eq!(picture.resolve, Some(Surface::Canvas));
    assert_eq!(
        (picture.load, picture.store),
        (LoadOp::Load, StoreOp::Store)
    );
    assert_eq!(
        texture_of(&graph, "picture").usage,
        usage::RENDER_ATTACHMENT,
        "attached, never sampled"
    );
}

#[test]
fn a_resolve_pass_that_cannot_resolve_into_the_canvas_fails_with_code_1505() {
    let check = |mut graph: RenderGraph, target: Option<&str>| {
        let error = graph.compile().unwrap_err();
        assert!(
            matches!(
                error,
                GraphError::TargetMismatch {
                    reason: Mismatch::Resolve,
                    ..
                }
            ),
            "{error:?}"
        );
        let resolve = graph.find_pass("Resolve").unwrap();
        let named = target.map_or(u32::MAX, |t| graph.find_resource(t).unwrap().index() as u32);
        assert_eq!(error.details(), [resolve.index() as u32, named]);
        graph.explain(error)
    };
    let scene = |color: Target| {
        let mut graph = RenderGraph::new();
        graph.add_pass(Pass::new("Opaque", PassKind::Scene).creates("color", color));
        graph
    };
    let multisampled = Target::color(format::CANVAS).samples(SAMPLES);
    let resolve = || Pass::new("Resolve", PassKind::Resolve);

    // A target with one sample, and one in another format.
    for color in [Target::color(format::CANVAS), HDR.samples(SAMPLES)] {
        let mut graph = scene(color);
        graph.add_pass(resolve().reads("color").writes(CANVAS));
        assert_eq!(
            check(graph, Some("color")),
            r#"E1505: the pass "Resolve" cannot resolve "color" into the canvas. A resolve pass writes only the canvas. It reads one multisampled color target in the canvas's format and size, which no other running pass reads."#
        );
    }

    // A target that another running pass samples, which would need a second resolve.
    let mut graph = scene(multisampled);
    graph.add_pass(
        Pass::new("Glow", PassKind::Fullscreen)
            .reads("color")
            .creates("glow", HDR),
    );
    graph.add_pass(resolve().reads("color").writes(CANVAS));
    check(graph, Some("color"));

    // A resolve into anything but the canvas, and one that does not write the canvas.
    let mut graph = scene(multisampled);
    graph.add_pass(Pass::new("Other", PassKind::Scene).creates("other", HDR));
    graph.add_pass(resolve().reads("color").writes("other"));
    check(graph, Some("other"));
    let mut graph = scene(multisampled);
    graph.add_pass(resolve().reads("color"));
    check(graph, Some("color"));

    // A resolve that names no target.
    let mut graph = scene(multisampled);
    graph.add_pass(resolve().writes(CANVAS));
    assert_eq!(
        check(graph, None),
        r#"E1505: the pass "Resolve" names no target to resolve into the canvas."#
    );
}

#[test]
fn the_text_dump_shows_a_resolve_into_the_canvas() {
    let dot = resolved_scene().dot();
    for line in [
        r#"label="render pass: full size, 4 samples\nsceneColor: clear, discard, resolve into canvas\nsceneDepth: clear, discard";"#,
        r#""pass Resolve" [shape=box, label="2. Resolve\nresolve pass, full size"];"#,
        r#"texture 0: attachment\nresolves into canvas"];"#,
        r#""resource sceneColor" -> "pass Resolve";"#,
        r#""pass Resolve" -> "resource canvas";"#,
    ] {
        assert!(dot.contains(line), "{line}\n{dot}");
    }
}
