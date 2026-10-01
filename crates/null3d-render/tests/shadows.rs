//! The main directional light's shadows on the WebGPU frame builder, checked through the mock
//! backend, which rejects what a real GPU would, and by decoding the lists it records: the shadow
//! map and its layers, each cascade's culling and depth pass, the casters' layout, and the
//! pipelines of the objects that receive shadows.

mod common;

use std::collections::{HashMap, HashSet};

use common::{World, count};
use null3d_core::layers::DEFAULT_LAYERS;
use null3d_core::lights::SunShadow;
use null3d_core::scene::{Command, flags};
use null3d_core::world::SphereArrays;
use null3d_gpu::drawlist::{
    NO_TARGET, Op, format, layout, permutation, resource_kind, state_flags, template,
    texture_usage, view,
};
use null3d_gpu::mock::MockBackend;
use null3d_render::frame::FrameBuilder;
use null3d_render::gpu_driven::{GpuDrivenRenderer, RendererConfig};
use null3d_render::materials::{Shading, feature};
use null3d_render::pipelines::{DepthBias, DrawKey};
use null3d_render::view::ViewId;

/// Three cascades of 1,024 texels on each side, out to 60 m, on the default layer.
const SUN: SunShadow = SunShadow {
    cascades: 3,
    map_size: 1024,
    bias: 0.5,
    normal_bias: 1.0,
    distance: 60.0,
    layers: DEFAULT_LAYERS,
};

/// The common world with the sun casting `shadow`. The lit box and the lit ball cast shadows and
/// receive them, and the unlit box receives them. The batch does neither.
fn shadowed(shadow: SunShadow) -> World {
    let mut world = World::new();
    let [lit_box, unlit_box, ball, _] = world.objects[..] else {
        panic!("four objects")
    };
    let both = flags::CAST_SHADOWS | flags::RECEIVE_SHADOWS;
    let receives = flags::RECEIVE_SHADOWS;
    let commands = [
        Command::set_flags(lit_box, both, both),
        Command::set_flags(ball, both, both),
        Command::set_flags(unlit_box, receives, receives),
    ];
    world.scene.apply_commands(&commands, world.frame).unwrap();
    world.renderer.settings_mut().set_sun_shadow(Some(shadow));
    world
}

/// The operands of each command of `op`.
fn operands(commands: &[(Op, Vec<u32>)], op: Op) -> Vec<Vec<u32>> {
    commands
        .iter()
        .filter(|(o, _)| *o == op)
        .map(|(_, operands)| operands.clone())
        .collect()
}

/// The shadow maps a list makes: depth textures bound as arrays.
fn shadow_maps(commands: &[(Op, Vec<u32>)]) -> Vec<Vec<u32>> {
    operands(commands, Op::CreateTexture)
        .into_iter()
        .filter(|o| o[4] == format::DEPTH32_FLOAT && o[8] == view::D2_ARRAY)
        .collect()
}

/// Each bundle's formats and draw count, by bundle id.
fn bundles(commands: &[(Op, Vec<u32>)]) -> HashMap<u32, ([u32; 3], usize)> {
    let mut bundles = HashMap::new();
    let mut recording = None;
    for (op, o) in commands {
        match op {
            Op::BeginBundle => {
                recording = Some(o[0]);
                bundles.insert(o[0], ([o[1], o[2], o[3]], 0));
            }
            Op::EndBundle => recording = None,
            Op::DrawIndexedIndirect => {
                bundles.get_mut(&recording.unwrap()).unwrap().1 += 1;
            }
            _ => {}
        }
    }
    bundles
}

/// The resources that a bind group created with `layout` binds, by binding.
fn bind_groups(commands: &[(Op, Vec<u32>)], layout: u32) -> Vec<HashMap<u32, (u32, u32)>> {
    operands(commands, Op::CreateBindGroup)
        .into_iter()
        .filter(|o| o[1] == layout)
        .map(|o| {
            o[3..]
                .chunks(5)
                .map(|entry| (entry[0], (entry[1], entry[2])))
                .collect()
        })
        .collect()
}

#[test]
fn each_cascade_culls_the_casters_and_draws_their_depth_into_its_layer() {
    let mut world = shadowed(SUN);
    world.record(true);
    MockBackend::default()
        .replay(world.renderer.list(1).words())
        .unwrap();
    let commands = world.commands();

    // The shadow map has a layer per cascade, bound as an array, and a view of each layer.
    let [map] = &shadow_maps(&commands)[..] else {
        panic!("one shadow map")
    };
    assert_eq!(map[1..4], [1024, 1024, 3]);
    let usage = texture_usage::RENDER_ATTACHMENT | texture_usage::TEXTURE_BINDING;
    assert_eq!(map[5], usage);
    let views = operands(&commands, Op::CreateTextureView);
    assert_eq!(views.len(), 3);
    for (layer, view) in views.iter().enumerate() {
        assert_eq!(view[1..], [map[0], 0, layer as u32]);
    }

    // One culling dispatch for the camera and one per cascade. Each cascade then draws into the
    // view of its layer, with no color, before the camera's pass samples the map.
    assert_eq!(count(&commands, Op::Dispatch), 4);
    let passes = operands(&commands, Op::BeginRenderPass);
    let depth_only: Vec<u32> = passes
        .iter()
        .filter(|p| p[0] == NO_TARGET)
        .map(|p| p[2])
        .collect();
    let view_ids: Vec<u32> = views.iter().map(|v| v[0]).collect();
    assert_eq!(depth_only, view_ids);
    assert_ne!(
        passes.last().unwrap()[0],
        NO_TARGET,
        "the camera's pass is last"
    );

    // The camera's frame group binds the shadow map, its comparison sampler and the cascades. The
    // cascades' groups have the depth-only layout, which leaves the map out.
    let [frame] = &bind_groups(&commands, layout::FRAME)[..] else {
        panic!("one camera view")
    };
    assert_eq!(frame[&4], (resource_kind::TEXTURE, map[0]));
    assert_eq!(frame[&5].0, resource_kind::SAMPLER);
    assert_eq!(frame[&6].0, resource_kind::BUFFER);
    let depth_groups = bind_groups(&commands, layout::DEPTH);
    assert_eq!(depth_groups.len(), 3);
    for group in &depth_groups {
        assert!(
            group
                .values()
                .all(|(kind, _)| *kind == resource_kind::BUFFER)
        );
    }

    // Casters draw their back faces into depth alone. Lit receivers read the shadow maps; the
    // batch, which does not receive, and the unlit box, which reflects no light, do not.
    let pipelines = operands(&commands, Op::CreateRenderPipeline);
    let depth: Vec<_> = pipelines
        .iter()
        .filter(|p| p[1] == template::SHADOW_DEPTH)
        .collect();
    assert_eq!(
        depth.len(),
        1,
        "both casters' meshes have one vertex format"
    );
    let [
        _,
        _,
        bits,
        color,
        depth_format,
        samples,
        state,
        _,
        bias,
        slope,
    ] = depth[0][..]
    else {
        panic!("ten operands")
    };
    // No depth bias: the receivers' biases keep the casters off their own shadows.
    assert_eq!(
        [bits, color, depth_format, samples, state, bias, slope],
        [
            0,
            format::NONE,
            format::DEPTH32_FLOAT,
            1,
            state_flags::CULL_FRONT,
            0,
            0
        ]
    );
    let receiving = |p: &Vec<u32>| p[2] & permutation::RECEIVE_SHADOWS != 0;
    let lit: Vec<_> = pipelines
        .iter()
        .filter(|p| p[1] == template::INSTANCED_LIT)
        .collect();
    assert_eq!(lit.iter().filter(|p| receiving(p)).count(), 1);
    assert_eq!(lit.len(), 2, "the batch draws without shadows");
    assert!(
        !pipelines
            .iter()
            .filter(|p| p[1] == template::INSTANCED_UNLIT)
            .any(receiving)
    );

    // Each cascade's bundle draws the casters by mesh: the box and the ball.
    let bundles = bundles(&commands);
    let cascades: Vec<_> = bundles
        .values()
        .filter(|(formats, _)| formats[0] == format::NONE)
        .collect();
    assert_eq!(cascades.len(), 3);
    for (formats, draws) in cascades {
        assert_eq!(*formats, [format::NONE, format::DEPTH32_FLOAT, 1]);
        assert_eq!(*draws, 2);
    }
}

#[test]
fn each_cascade_culls_its_casters_against_its_own_box() {
    let mut world = shadowed(SUN);
    world.record(true);
    let camera = *world.renderer.view_frame(ViewId::CAMERA).unwrap();
    // A cascade's culling reads its matrix's box: its four sides and its far face, however far
    // toward the light a caster stands. The reference reads the box from the matrix's rows.
    for cascade in 0..3 {
        let frame = world.renderer.view_frame(ViewId::cascade(cascade)).unwrap();
        assert_eq!(
            frame.camera, camera.camera,
            "cascades cull around the camera"
        );
        assert_eq!(frame.layers, SUN.layers);
        let m = frame.uniform.view_proj;
        let row = |r: usize| [m[r], m[4 + r], m[8 + r], m[12 + r]];
        let reference = |p: [f32; 3], radius: f32| {
            let reach = |r: usize| {
                let [x, y, z, w] = row(r);
                let scale = (x * x + y * y + z * z).sqrt();
                (x * p[0] + y * p[1] + z * p[2] + w, radius * scale)
            };
            let ((x, rx), (y, ry), (depth, rz)) = (reach(0), reach(1), reach(2));
            x.abs() <= 1.0 + rx && y.abs() <= 1.0 + ry && depth >= -rz
        };
        for x in (-40..=40).step_by(8) {
            for y in (-40..=200).step_by(12) {
                for z in (-60..=20).step_by(8) {
                    let p = [x as f32, y as f32, z as f32];
                    for radius in [0.5, 3.0] {
                        assert_eq!(
                            frame.frustum.contains_sphere(p[0], p[1], p[2], radius),
                            reference(p, radius),
                            "cascade {cascade}, sphere at {p:?} of radius {radius}"
                        );
                    }
                }
            }
        }
    }
}

#[test]
fn turning_shadows_off_rebuilds_the_tables_and_leaves_a_map_of_one_texel() {
    let mut world = shadowed(SUN);
    let mut mock = MockBackend::default();
    world.record(true);
    mock.replay(world.renderer.list(1).words()).unwrap();

    world.frame = 2;
    world.renderer.settings_mut().set_sun_shadow(None);
    assert!(world.record(false), "the receivers' pipelines change");
    mock.replay(world.renderer.list(2).words()).unwrap();
    let commands = world.commands();
    let [map] = &shadow_maps(&commands)[..] else {
        panic!("the map is made again")
    };
    assert_eq!(map[1..4], [1, 1, 1]);
    assert_eq!(map[5], texture_usage::TEXTURE_BINDING);
    assert_eq!(
        count(&commands, Op::DestroyTexture),
        3,
        "the views of its layers go"
    );
    assert_eq!(bind_groups(&commands, layout::FRAME).len(), 1);
    assert_eq!(count(&commands, Op::Dispatch), 1);
    let passes = operands(&commands, Op::BeginRenderPass);
    assert!(passes.iter().all(|p| p[0] != NO_TARGET));
    let pipelines = operands(&commands, Op::CreateRenderPipeline);
    assert!(
        pipelines
            .iter()
            .all(|p| p[2] & permutation::RECEIVE_SHADOWS == 0)
    );

    // Shadows again, with two cascades and a smaller map: the map is made again, with a view of
    // each of its two layers.
    world.frame = 3;
    let fewer = SunShadow {
        cascades: 2,
        map_size: 512,
        ..SUN
    };
    world.renderer.settings_mut().set_sun_shadow(Some(fewer));
    assert!(world.record(false));
    mock.replay(world.renderer.list(3).words()).unwrap();
    let commands = world.commands();
    assert_eq!(shadow_maps(&commands)[0][1..4], [512, 512, 2]);
    assert_eq!(operands(&commands, Op::CreateTextureView).len(), 2);
    assert_eq!(count(&commands, Op::Dispatch), 3);

    // A still frame makes nothing again, and draws both cascades.
    world.frame = 4;
    assert!(!world.record(false));
    mock.replay(world.renderer.list(4).words()).unwrap();
    let commands = world.commands();
    assert!(shadow_maps(&commands).is_empty());
    assert_eq!(count(&commands, Op::CreateBindGroup), 0);
    assert_eq!(count(&commands, Op::Dispatch), 3);
    assert_eq!(count(&commands, Op::ExecuteBundles), 3);
}

#[test]
fn a_caster_that_stops_casting_leaves_the_cascades() {
    let mut world = shadowed(SUN);
    world.record(true);
    world.frame = 2;
    let ball = world.objects[2];
    world
        .scene
        .apply_commands(
            &[Command::set_flags(ball, flags::CAST_SHADOWS, 0)],
            world.frame,
        )
        .unwrap();
    assert!(world.scene.take_structure_changed());
    assert!(world.record(true));
    let bundles = bundles(&world.commands());
    let cascades: Vec<_> = bundles
        .values()
        .filter(|(formats, _)| formats[0] == format::NONE)
        .collect();
    assert_eq!(cascades.len(), 3);
    assert!(
        cascades.iter().all(|(_, draws)| *draws == 1),
        "the box alone"
    );
}

/// Every object casts, and every fourth one has a blended lit material: the transparent pass draws
/// it, and the cascades cull it as any caster.
#[test]
fn each_cascade_culls_the_casters_of_the_cells_it_can_see() {
    const OBJECTS: u32 = 400;
    let renderer = GpuDrivenRenderer::new(RendererConfig::default());
    let mut world = World::build_sized(renderer, OBJECTS + 16);
    world.spread(OBJECTS, 2000, 7);
    let glass = world
        .renderer
        .settings_mut()
        .materials_mut()
        .create(Shading::Lit, feature::BLEND, [1.0, 1.0, 1.0, 0.5])
        .unwrap()
        + 1;
    let casts = flags::CAST_SHADOWS;
    let mut commands: Vec<_> = world
        .objects
        .iter()
        .map(|&object| Command::set_flags(object, casts, casts))
        .collect();
    commands.extend(
        world
            .objects
            .iter()
            .step_by(4)
            .map(|&o| Command::set_material(o, glass)),
    );
    world.scene.apply_commands(&commands, world.frame).unwrap();
    let shadow = SunShadow {
        distance: 400.0,
        ..SUN
    };
    world.renderer.settings_mut().set_sun_shadow(Some(shadow));
    world.record(true);
    let sources = world.scene.capacity() + 1 + common::BATCH_ROWS + 2000;
    for k in 0..6 {
        let k = k as f32;
        world.frame += 1;
        world.scene.begin_frame(world.frame);
        let at = [
            (k * 731.0) % 4000.0 - 2000.0,
            10.0,
            (k * 1173.0) % 4000.0 - 2000.0,
        ];
        world.aim(at, k * 0.9, -0.2);
        world.record(false);
        let parity = world.scene.parity();
        let spheres = world.scene.world(parity).spheres();
        let table = world.scene.cell_table();
        for cascade in 0..SUN.cascades as usize {
            let view = ViewId::cascade(cascade);
            let tested: HashSet<u32> = world.renderer.culled_sources(view).into_iter().collect();
            assert!(
                (tested.len() as u32) < sources,
                "pose {k}, cascade {cascade}: every source tested"
            );
            // Every caster whose sphere is in the cascade's box, moved into its cell, is tested.
            let frame = *world.renderer.view_frame(view).unwrap();
            let in_box = |spheres: SphereArrays<'_>, slot: usize, cell: u32| {
                let offset = frame.camera.offset_to(table.coords(cell));
                let [x, y, z, r] =
                    [spheres.xs, spheres.ys, spheres.zs, spheres.radii].map(|v| v[slot]);
                frame.frustum.moved_by(offset).contains_sphere(x, y, z, r)
            };
            for &object in &world.objects {
                let slot = world.scene.resolve(object).unwrap() as usize;
                if in_box(spheres, slot, world.scene.cells()[slot]) {
                    assert!(
                        tested.contains(&(slot as u32)),
                        "pose {k}, cascade {cascade}: caster {slot}"
                    );
                }
            }
        }
    }
}

#[test]
fn a_double_sided_caster_draws_both_faces_and_no_material_draws_its_depth_bias() {
    let mut world = shadowed(SUN);
    let table = world.renderer.settings_mut().materials_mut();
    let material = table
        .create(Shading::Lit, feature::DOUBLE_SIDED, [1.0; 4])
        .unwrap();
    table
        .set_depth_bias(material, DepthBias::from_polygon_offset(1.0, 1.0))
        .unwrap();
    let ball = world.objects[2];
    world
        .scene
        .apply_commands(&[Command::set_material(ball, material + 1)], world.frame)
        .unwrap();
    world.record(true);
    // Operand 6 is the state and operands 8 and 9 the depth bias.
    let mut casters: Vec<[u32; 3]> = operands(&world.commands(), Op::CreateRenderPipeline)
        .iter()
        .filter(|p| p[1] == template::SHADOW_DEPTH)
        .map(|p| [p[6], p[8], p[9]])
        .collect();
    casters.sort_unstable();
    assert_eq!(
        casters,
        [
            [state_flags::CULL_NONE, 0, 0],
            [state_flags::CULL_FRONT, 0, 0]
        ]
    );
}

#[test]
fn standard_and_custom_materials_receive_shadows_and_unlit_ones_do_not() {
    let world = shadowed(SUN);
    let key = |template: u32| DrawKey {
        template,
        permutation: permutation::VERTEX_COLOR,
        vertex_format: 0,
        state: 0,
        bias: DepthBias::NONE,
    };
    let settings = world.renderer.settings();
    for lit in [
        template::INSTANCED_LIT,
        template::INSTANCED_STANDARD_MAPS,
        template::CUSTOM_FIRST,
    ] {
        let receiving = settings.receiving(key(lit));
        assert_eq!(
            receiving.permutation,
            permutation::VERTEX_COLOR | permutation::RECEIVE_SHADOWS
        );
    }
    for unlit in [template::INSTANCED_UNLIT, template::INSTANCED_UNLIT_MAP] {
        assert_eq!(settings.receiving(key(unlit)), key(unlit));
    }
}

#[test]
fn a_blended_object_casts_shadows_and_receives_them_in_the_transparent_pass() {
    let mut world = shadowed(SUN);
    let glass = world
        .renderer
        .settings_mut()
        .materials_mut()
        .create(Shading::Lit, feature::BLEND, [1.0, 1.0, 1.0, 0.5])
        .unwrap()
        + 1;
    let lit_box = world.objects[0];
    let commands = [Command::set_material(lit_box, glass)];
    world.scene.apply_commands(&commands, world.frame).unwrap();
    world.record(true);
    MockBackend::default()
        .replay(world.renderer.list(1).words())
        .unwrap();
    let commands = world.commands();

    // The box draws in the transparent pass with a lit pipeline that blends and reads the map.
    let pipelines = operands(&commands, Op::CreateRenderPipeline);
    assert!(pipelines.iter().any(|p| {
        p[1] == template::INSTANCED_LIT
            && p[2] & permutation::RECEIVE_SHADOWS != 0
            && p[6] & state_flags::BLEND != 0
    }));
    // It still casts: each cascade's bundle draws the box's mesh and the ball's.
    let bundles = bundles(&commands);
    let cascades: Vec<_> = bundles
        .values()
        .filter(|(formats, _)| formats[0] == format::NONE)
        .collect();
    assert_eq!(cascades.len(), 3);
    assert!(cascades.iter().all(|(_, draws)| *draws == 2));
}
