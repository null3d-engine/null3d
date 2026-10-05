//! The main directional light's shadows on the WebGL2 frame builder, checked through the mock
//! backend, which rejects what a real GPU would, by decoding the lists it records, and by the
//! cascades' culling output: the shadow map and its layers, each cascade's index list and depth
//! pass, and the pipelines of the objects that receive shadows.

mod common;

use std::collections::HashMap;

use common::{World, count};
use null3d_core::layers::DEFAULT_LAYERS;
use null3d_core::lights::SunShadow;
use null3d_core::scene::{Command, flags};
use null3d_gpu::drawlist::{
    NO_TARGET, Op, format, layout, permutation, resource_kind, state_flags, template,
    texture_usage, view,
};
use null3d_gpu::mock::MockBackend;
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::frame::FrameBuilder;
use null3d_render::shadows::ShadowQuality;
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

/// The common world on the WebGL2 builder, with the sun casting `shadow`. The lit box and the
/// lit ball cast shadows and receive them, and the unlit box receives them. The batch does
/// neither.
fn shadowed(shadow: SunShadow, multi_draw: bool) -> World<CpuCulledRenderer> {
    let mut world = World::build(CpuCulledRenderer::new(CpuCulledConfig {
        multi_draw,
        ..CpuCulledConfig::default()
    }));
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
        .filter(|o| format::is_depth(o[4]) && o[8] == view::D2_ARRAY)
        .collect()
}

/// The resources that each bind group created with `layout` binds, by binding.
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

/// Each render pass that draws depth alone: its depth target, and the draw calls in it.
fn depth_passes(commands: &[(Op, Vec<u32>)]) -> Vec<(u32, usize)> {
    let mut passes = Vec::new();
    let mut current: Option<(u32, usize)> = None;
    for (op, o) in commands {
        match op {
            Op::BeginRenderPass if o[0] == NO_TARGET => current = Some((o[2], 0)),
            Op::DrawIndexed | Op::MultiDrawIndexed => {
                if let Some(pass) = &mut current {
                    pass.1 += 1;
                }
            }
            Op::EndRenderPass => passes.extend(current.take()),
            _ => {}
        }
    }
    passes
}

/// Each caster bucket's index list entries in a cascade's culling output. Every bucket key has a
/// bucket of rows and a bucket of clusters, and casters are scene objects, listed as rows alone.
fn cascade_entries(world: &World<CpuCulledRenderer>, cascade: usize) -> Vec<u32> {
    let starts = world
        .renderer
        .culled(world.frame, ViewId::cascade(cascade))
        .bucket_starts();
    let entries: Vec<u32> = starts.windows(2).map(|w| w[1] - w[0]).collect();
    entries
        .chunks(2)
        .map(|pair| {
            assert_eq!(pair[1], 0, "no caster is listed by cluster");
            pair[0]
        })
        .collect()
}

#[test]
fn each_cascade_lists_the_casters_and_draws_their_depth_into_its_layer() {
    for multi_draw in [true, false] {
        let mut world = shadowed(SUN, multi_draw);
        assert!(world.record(true));
        MockBackend::default()
            .replay(world.renderer.list(1).words())
            .unwrap();
        let commands = world.commands();

        // The shadow map has a layer per cascade, bound as an array, and a view of each layer.
        // The first frame also makes the shadow atlas of point and spot lights: one texel of
        // one layer while none casts shadows.
        let [map, atlas] = &shadow_maps(&commands)[..] else {
            panic!("one shadow map and one shadow atlas")
        };
        assert_eq!(atlas[1..4], [1, 1, 1]);
        assert_eq!(map[1..4], [1024, 1024, 3]);
        let usage = texture_usage::RENDER_ATTACHMENT | texture_usage::TEXTURE_BINDING;
        assert_eq!(map[5], usage);
        let views = operands(&commands, Op::CreateTextureView);
        assert_eq!(views.len(), 3);
        for (layer, view) in views.iter().enumerate() {
            assert_eq!(view[1..], [map[0], 0, layer as u32]);
        }

        // Each cascade draws into the view of its layer, with no color, before the camera's pass
        // samples the map.
        let passes = depth_passes(&commands);
        let view_ids: Vec<u32> = views.iter().map(|v| v[0]).collect();
        let targets: Vec<u32> = passes.iter().map(|&(target, _)| target).collect();
        assert_eq!(targets, view_ids);
        let all = operands(&commands, Op::BeginRenderPass);
        assert_ne!(
            all.last().unwrap()[0],
            NO_TARGET,
            "the camera's pass is last"
        );

        // The casters' layout has a bucket per mesh: the box and the ball. Each cascade lists
        // at most the lit box and the ball, never the unlit box, which casts nothing, nor the
        // batch's rows, and together they list both. Both meshes share a vertex page, so a
        // cascade draws them in one multi-draw call, or one call per mesh it lists.
        let mut listed = [0; 2];
        for (cascade, &(_, calls)) in passes.iter().enumerate() {
            let entries = cascade_entries(&world, cascade);
            assert_eq!(entries.len(), 2, "cascade {cascade}");
            assert!(entries.iter().all(|&n| n <= 1), "cascade {cascade}");
            let drawn = entries.iter().filter(|&&n| n > 0).count();
            let expected = if multi_draw { drawn.min(1) } else { drawn };
            assert_eq!(calls, expected, "cascade {cascade}");
            for (sum, n) in listed.iter_mut().zip(&entries) {
                *sum += n;
            }
        }
        assert!(listed.iter().all(|&n| n > 0), "{listed:?}");

        // The camera's frame groups, one for each slot of the light textures' ring, bind the
        // shadow map, its comparison sampler and the cascades. The cascades' groups have the
        // depth-only layout, which leaves the map out.
        let frames = bind_groups(&commands, layout::FRAME);
        assert_eq!(frames.len(), 3, "one camera view");
        for frame in &frames {
            assert_eq!(frame[&4], (resource_kind::TEXTURE, map[0]));
            assert_eq!(frame[&5].0, resource_kind::SAMPLER);
            assert_eq!(frame[&6].0, resource_kind::BUFFER);
        }
        let depth_groups = bind_groups(&commands, layout::DEPTH);
        assert_eq!(depth_groups.len(), 3);
        for group in &depth_groups {
            assert!(!group.contains_key(&4) && !group.contains_key(&5));
            assert!(group.values().all(|&(_, id)| id != map[0]));
        }

        // Casters draw their back faces into depth alone, in the variant that reads the draw
        // index where the device has multi-draw. Lit receivers read the shadow maps; the batch,
        // which does not receive, and the unlit box, which reflects no light, do not.
        let draw_index = if multi_draw {
            permutation::DRAW_INDEX
        } else {
            0
        };
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
        assert_eq!(
            [
                depth[0][2],
                depth[0][3],
                depth[0][4],
                depth[0][5],
                depth[0][6]
            ],
            [
                draw_index | permutation::CASTER_OFFSET,
                format::NONE,
                format::DEPTH16_UNORM,
                1,
                state_flags::CULL_FRONT
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

        // Each cascade's values: the camera's cell, and the light's layers. Each cascade lists a
        // caster where its sphere, relative to the camera, meets the cascade's culling frustum:
        // the box at x = -3 and the ball at x = 1, both 20 m in front of the camera.
        let camera = *world.renderer.view_frame(ViewId::CAMERA).unwrap();
        for cascade in 0..3 {
            let frame = world.renderer.view_frame(ViewId::cascade(cascade)).unwrap();
            assert_eq!(frame.camera, camera.camera);
            assert_eq!(frame.layers, SUN.layers);
            let expected: Vec<u32> = [-3.0, 1.0]
                .map(|x| u32::from(frame.frustum.contains_sphere(x, 0.0, -20.0, 0.9)))
                .to_vec();
            assert_eq!(
                cascade_entries(&world, cascade),
                expected,
                "cascade {cascade}"
            );
        }
        assert!(world.renderer.view_frame(ViewId::cascade(3)).is_none());
    }
}

#[test]
fn turning_shadows_off_rebuilds_the_layouts_and_leaves_a_map_of_one_texel() {
    let mut world = shadowed(SUN, true);
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
    let frames = bind_groups(&commands, layout::FRAME);
    assert_eq!(
        frames.len(),
        3,
        "the camera's frame groups bind the new map"
    );
    for frame in &frames {
        assert_eq!(frame[&4], (resource_kind::TEXTURE, map[0]));
    }
    assert!(depth_passes(&commands).is_empty());
    assert!(
        operands(&commands, Op::CreateRenderPipeline)
            .iter()
            .all(|p| p[2] & permutation::RECEIVE_SHADOWS == 0)
    );
    assert!(world.renderer.view_frame(ViewId::cascade(0)).is_none());

    // Shadows again, with two cascades and a smaller map: the map is made again, with a view of
    // each of its two layers, and both cascades draw into them.
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
    let views: Vec<u32> = operands(&commands, Op::CreateTextureView)
        .iter()
        .map(|v| v[0])
        .collect();
    assert_eq!(views.len(), 2);
    let targets: Vec<u32> = depth_passes(&commands).iter().map(|p| p.0).collect();
    assert_eq!(targets, views);

    // A still frame makes nothing again, uploads no index list, and draws both cascades.
    world.frame = 4;
    assert!(!world.record(false));
    mock.replay(world.renderer.list(4).words()).unwrap();
    let commands = world.commands();
    assert!(shadow_maps(&commands).is_empty());
    assert_eq!(count(&commands, Op::CreateBindGroup), 0);
    assert_eq!(depth_passes(&commands).len(), 2);
}

#[test]
fn a_caster_that_stops_casting_leaves_the_cascades() {
    let mut world = shadowed(SUN, false);
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
    for cascade in 0..3 {
        let entries = cascade_entries(&world, cascade);
        assert_eq!(entries.len(), 1, "the box's bucket alone");
    }
}

#[test]
fn far_cascades_draw_in_turn_and_keep_their_layers_in_between() {
    for multi_draw in [true, false] {
        let mut world = shadowed(SUN, multi_draw);
        let quality = ShadowQuality {
            filter: 5,
            far_interval: 2,
            follow_movers: true,
        };
        world.renderer.settings_mut().set_shadow_quality(quality);
        let mut mock = MockBackend::default();
        let first = world.step(&mut mock, true);
        let layers: Vec<u32> = operands(&first, Op::CreateTextureView)
            .iter()
            .map(|v| v[0])
            .collect();
        let drawn = |commands: &[(Op, Vec<u32>)]| -> Vec<usize> {
            depth_passes(commands)
                .iter()
                .map(|(target, _)| layers.iter().position(|l| l == target).unwrap())
                .collect()
        };
        // The first frame draws every cascade. Then the near one draws in every frame, and the
        // far ones in turn, with an index list only where they draw.
        let mut turns = vec![drawn(&first)];
        for _ in 0..4 {
            let commands = world.step(&mut mock, false);
            turns.push(drawn(&commands));
            let culled: Vec<bool> = (0..3)
                .map(|k| world.renderer.view_frame(ViewId::cascade(k)).is_some())
                .collect();
            let drawn_now = turns.last().unwrap();
            assert_eq!(
                culled,
                (0..3).map(|k| drawn_now.contains(&k)).collect::<Vec<_>>()
            );
        }
        assert_eq!(
            turns,
            [
                vec![0, 1, 2],
                vec![0, 2],
                vec![0, 1],
                vec![0, 2],
                vec![0, 1]
            ]
        );
        // New GPU objects draw every cascade again.
        world.renderer.reset_gpu();
        let mut mock = MockBackend::default();
        let commands = world.step(&mut mock, false);
        assert_eq!(depth_passes(&commands).len(), 3);
    }
}
