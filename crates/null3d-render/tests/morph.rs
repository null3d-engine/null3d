//! Morph targets on both frame builders, checked through the mock backend, which rejects what a
//! real GPU would, and by decoding the lists they record. On WebGPU: the skinning pass, which
//! morphs each morphed object that some view draws once per frame, from the morph texture. On
//! WebGL2: the MORPH builds of the pipelines that draw morphed objects, shadows and the depth
//! prepass included, and the morph texture that their vertex shaders read. Both grow a morphed
//! object's bounds by how far its weights move its vertices.

mod common;

use common::morphed::{LIFT, PUSH};
use common::{World, count};
use null3d_core::layers::DEFAULT_LAYERS;
use null3d_core::lights::SunShadow;
use null3d_gpu::drawlist::{Op, buffer_usage, format, layout, permutation, template, vertex};
use null3d_gpu::mock::MockBackend;
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::frame::FrameBuilder;
use null3d_render::materials::{CustomShading, Shading};
use null3d_render::morph::TEXTURE_WIDTH;
use null3d_render::skinning::skinned_format;

/// The operands of each command of `op`.
fn operands(commands: &[(Op, Vec<u32>)], op: Op) -> Vec<Vec<u32>> {
    commands
        .iter()
        .filter(|(o, _)| *o == op)
        .map(|(_, operands)| operands.clone())
        .collect()
}

/// The resources that a bind group's operands bind, entry by entry.
fn bound(group: &[u32]) -> Vec<u32> {
    (0..group[2] as usize)
        .map(|e| group[3 + e * 5 + 2])
        .collect()
}

/// The morph textures among the resources `among`: the texture of deltas, RGBA16F, and the
/// texture of weights, RGBA32F, each of the morph textures' width. WebGL2's instance textures have
/// that width and RGBA32F too, so a group's entries pick them.
fn morph_textures(commands: &[(Op, Vec<u32>)], among: &[u32]) -> [u32; 2] {
    let made = operands(commands, Op::CreateTexture);
    [format::RGBA16_FLOAT, format::RGBA32_FLOAT].map(|f| {
        made.iter()
            .rev()
            .find(|t| among.contains(&t[0]) && t[1] == TEXTURE_WIDTH && t[4] == f)
            .expect("a morph texture")[0]
    })
}

/// The writes into texture `id`.
fn writes(commands: &[(Op, Vec<u32>)], id: u32) -> usize {
    operands(commands, Op::WriteTexture)
        .iter()
        .filter(|w| w[0] == id)
        .count()
}

/// The render pipelines that a frame made for meshes of vertex format `format`: template and
/// permutation.
fn pipelines_of(commands: &[(Op, Vec<u32>)], format: u32) -> Vec<(u32, u32)> {
    operands(commands, Op::CreateRenderPipeline)
        .iter()
        .filter(|p| p[7] == format)
        .map(|p| (p[1], p[2]))
        .collect()
}

/// Turns on the sun's shadows, straight down, with two cascades.
fn cast_sun_shadows<B: FrameBuilder>(world: &mut World<B>) {
    let settings = world.renderer.settings_mut();
    settings.set_sun([0.0, -1.0, 0.0], [3.0; 3]);
    settings.set_sun_shadow(Some(SunShadow {
        cascades: 2,
        map_size: 1024,
        bias: 0.5,
        normal_bias: 1.0,
        distance: 40.0,
        layers: DEFAULT_LAYERS,
    }));
}

/// The WebGL2 frame builder, with `WEBGL_multi_draw` or without, and the depth prepass or not.
fn webgl2(multi_draw: bool, depth_prepass: bool) -> World<CpuCulledRenderer> {
    let mut world = World::build(CpuCulledRenderer::new(CpuCulledConfig {
        multi_draw,
        depth_prepass,
        ..CpuCulledConfig::default()
    }));
    // No frame has drawn yet, so the first frame waits for every pipeline and draws the morphed
    // objects at once.
    world.pipelines_built = 0;
    world
}

#[test]
fn webgpu_morphs_a_morphed_object_once_in_the_skinning_pass() {
    let mut world = World::new();
    // No frame has drawn yet, so the first frame waits for every pipeline and draws the morphed
    // objects at once.
    world.pipelines_built = 0;
    let (_, block) = world.add_morphed([0.0; 3], [1.0, 0.0]);
    let mut mock = MockBackend::default();
    let first = world.step(&mut mock, true);

    // The skinning pass runs for an object that no joint skins, and reads the morph texture
    // through its bind group.
    let skin = operands(&first, Op::CreateComputePipeline)
        .iter()
        .find(|p| p[1] == template::SKIN)
        .expect("the skinning pipeline")[0];
    let groups = operands(&first, Op::CreateBindGroup);
    let skin_group = groups
        .iter()
        .find(|g| g[1] == layout::SKIN)
        .expect("the skinning pass's group");
    let [deltas, weights] = morph_textures(&first, &bound(skin_group)[4..]);
    // The pass reads the mesh page's vertices as storage, so the page's buffer allows it, as each
    // buffer that the group binds must.
    let buffers = operands(&first, Op::CreateBuffer);
    for id in &bound(skin_group)[..3] {
        let made = buffers
            .iter()
            .find(|b| b[0] == *id)
            .expect("a buffer the group binds");
        assert_ne!(made[2] & buffer_usage::STORAGE, 0, "buffer {id}");
    }
    // The deltas and the weights go up.
    assert_eq!((writes(&first, deltas), writes(&first, weights)), (1, 1));
    let mut dispatches = 0;
    let mut current = 0;
    for (op, o) in &first {
        match op {
            Op::SetComputePipeline => current = o[0],
            Op::Dispatch if current == skin => dispatches += 1,
            _ => {}
        }
    }
    assert_eq!(dispatches, 1);
    // The views draw the morphed vertices, in a format without the morph attribute, with no
    // MORPH build: WebGPU has none.
    let morphed = common::morphed::morph_box().format | vertex::MORPH;
    let drawn = skinned_format(morphed, true);
    assert_eq!(drawn & vertex::MORPH, 0);
    assert!(
        pipelines_of(&first, drawn)
            .iter()
            .any(|&(t, _)| t == template::INSTANCED_LIT)
    );
    assert!(
        operands(&first, Op::CreateRenderPipeline)
            .iter()
            .all(|p| p[2] & permutation::MORPH == 0)
    );

    // Later frames upload only the weights again, and make nothing.
    let second = world.step(&mut mock, false);
    assert_eq!((writes(&second, deltas), writes(&second, weights)), (0, 1));
    assert_eq!(count(&second, Op::CreateTexture), 0);
    assert_eq!(count(&second, Op::CreateBindGroup), 0);
    // The weights held still, so the box keeps its morphed vertices and the pass does nothing.
    assert_eq!(world.renderer.skinned_vertices(), 0);
    world.set_weight(block, 0, 0.5);
    world.step(&mut mock, false);
    assert!(
        world.renderer.skinned_vertices() > 0,
        "a new weight morphs again"
    );
}

#[test]
fn a_morphed_objects_bounds_grow_by_its_weights() {
    let mut world = World::new();
    let (object, block) = world.add_morphed([0.0; 3], [0.0, 0.0]);
    let slot = world.scene.resolve(object).unwrap() as usize;
    world.record(true);
    let rest = world.scene.local_radii()[slot];
    assert!(rest > 0.0);
    let radius = |world: &mut World, weights: [f32; 2]| {
        world.set_weight(block, 0, weights[0]);
        world.set_weight(block, 1, weights[1]);
        world.frame += 1;
        world.record(false);
        world.scene.local_radii()[slot]
    };
    assert_eq!(radius(&mut world, [1.0, 0.0]), rest + LIFT);
    // Each target's reach times the size of its weight, added up.
    assert_eq!(radius(&mut world, [-2.0, 1.0]), rest + 2.0 * LIFT + PUSH);
    assert_eq!(radius(&mut world, [0.0, 0.0]), rest);
}

#[test]
fn webgl2_morphs_in_the_vertex_shader_of_every_pass_that_draws_a_morphed_object() {
    for multi_draw in [false, true] {
        let mut world = webgl2(multi_draw, false);
        cast_sun_shadows(&mut world);
        world.add_morphed([0.0; 3], [0.5, 0.5]);
        let mut mock = MockBackend::default();
        let first = world.step(&mut mock, true);

        // The lit pass and the shadow pass draw the box with the MORPH builds, which read its
        // morph attribute, and nothing morphs in a compute pass.
        let morphed = common::morphed::morph_box().format | vertex::MORPH;
        let builds = pipelines_of(&first, morphed);
        for t in [template::INSTANCED_LIT, template::SHADOW_DEPTH] {
            let of: Vec<u32> = builds.iter().filter(|b| b.0 == t).map(|b| b.1).collect();
            assert!(!of.is_empty(), "template {t}");
            assert!(
                of.iter()
                    .all(|p| p & permutation::MORPH != 0 && p & permutation::SKIN == 0)
            );
        }
        assert!(
            operands(&first, Op::CreateRenderPipeline)
                .iter()
                .filter(|p| p[7] != morphed)
                .all(|p| p[2] & permutation::MORPH == 0)
        );
        assert_eq!(count(&first, Op::CreateComputePipeline), 0);

        // Every instance group binds the morph textures of deltas and of weights last, after the
        // joint texture and the texture of first joints and weights.
        let groups: Vec<Vec<u32>> = operands(&first, Op::CreateBindGroup)
            .into_iter()
            .filter(|g| g[1] == layout::INSTANCES)
            .collect();
        assert!(!groups.is_empty());
        let [deltas, weights] = morph_textures(&first, &bound(&groups[0])[6..]);
        assert!(
            groups
                .iter()
                .all(|g| bound(g).len() == 8 && bound(g)[6..] == [deltas, weights])
        );

        // Later frames upload the weights and make nothing.
        let second = world.step(&mut mock, false);
        assert_eq!((writes(&second, deltas), writes(&second, weights)), (0, 1));
        assert_eq!(count(&second, Op::CreateTexture), 0);
        assert_eq!(count(&second, Op::CreateBindGroup), 0);
    }
}

#[test]
fn webgl2_draws_the_depth_prepass_of_a_morphed_object_with_its_morph_build() {
    let mut world = webgl2(true, true);
    world.add_morphed([0.0; 3], [1.0, 0.0]);
    let mut mock = MockBackend::default();
    let first = world.step(&mut mock, true);
    let morphed = common::morphed::morph_box().format | vertex::MORPH;
    let prepass: Vec<u32> = pipelines_of(&first, morphed)
        .iter()
        .filter(|(t, p)| *t == template::INSTANCED_LIT && p & permutation::PREPASS != 0)
        .map(|b| b.1)
        .collect();
    assert_eq!(prepass.len(), 1);
    assert_ne!(prepass[0] & permutation::MORPH, 0);
}

#[test]
fn webgl2_draws_a_custom_material_on_a_morphed_mesh_at_rest() {
    let mut world = webgl2(true, false);
    let custom = Shading::Custom(CustomShading {
        template: template::CUSTOM_FIRST,
        attributes: 0,
        base_color: true,
        textures: 0,
        transmission: false,
    });
    world.add_morphed_with([0.0; 3], [1.0, 0.0], custom);
    let mut mock = MockBackend::default();
    let first = world.step(&mut mock, true);
    let morphed = common::morphed::morph_box().format | vertex::MORPH;
    let builds = pipelines_of(&first, morphed);
    assert!(
        builds
            .iter()
            .any(|&(t, p)| t == template::CUSTOM_FIRST && p & permutation::MORPH == 0)
    );
}

#[test]
fn the_webgl2_cap_follows_the_renderer_setting() {
    let mut world = webgl2(true, false);
    assert_eq!(world.renderer.settings().morph_cap(), u32::MAX);
    world.renderer.settings_mut().set_morph_cap(8);
    assert_eq!(world.renderer.settings().morph_cap(), 8);
    world.add_morphed([0.0; 3], [1.0, 0.5]);
    let mut mock = MockBackend::default();
    world.step(&mut mock, true);
    world.step(&mut mock, false);
}
