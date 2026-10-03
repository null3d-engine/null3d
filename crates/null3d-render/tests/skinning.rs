//! Skinning on both frame builders, checked through the mock backend, which rejects what a real
//! GPU would, and by decoding the lists they record. On WebGPU: the skinning pass, which skins each
//! skinned object that some view draws once per frame, the joint texture it reads, and the views'
//! draws of the skinned vertices, the outline mask's among them. On WebGL2: the skinning builds of
//! the pipelines that draw skinned objects, shadows and the outline mask included, the joint
//! texture and the texture of first joints that their vertex shaders read, and the instanced draws
//! that skinned objects of one mesh share.

mod common;

use common::skinned::{AROUND, RINGS, column};
use common::{World, count};
use null3d_core::cells::CELL_SHIFT;
use null3d_core::handle::Handle;
use null3d_core::layers::DEFAULT_LAYERS;
use null3d_core::lights::SunShadow;
use null3d_core::scene::{Command, flags};
use null3d_gpu::drawlist::{
    Op, buffer_usage, format, layout, permutation, template, texture_usage, vertex,
};
use null3d_gpu::mock::MockBackend;
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::frame::FrameBuilder;
use null3d_render::gpu_driven::RendererConfig;
use null3d_render::outline::Outline;
use null3d_render::skinning::{JOINTS_PER_ROW, TEXELS_PER_JOINT, skinned_format};
use null3d_render::view::ViewId;

/// The common world with a skinned column at `position`, which casts shadows. Returns the world
/// and the column.
fn skinned(position: [f32; 3]) -> (World, Handle) {
    let mut world = World::new();
    let column = world.add_skinned(position);
    (world, column)
}

/// The operands of each command of `op`.
fn operands(commands: &[(Op, Vec<u32>)], op: Op) -> Vec<Vec<u32>> {
    commands
        .iter()
        .filter(|(o, _)| *o == op)
        .map(|(_, operands)| operands.clone())
        .collect()
}

/// The dispatches of the skinning pass: those that follow its pipeline.
fn skin_dispatches(commands: &[(Op, Vec<u32>)], pipeline: u32) -> Vec<u32> {
    let mut current = 0;
    let mut groups = Vec::new();
    for (op, operands) in commands {
        match op {
            Op::SetComputePipeline => current = operands[0],
            Op::Dispatch if current == pipeline => groups.push(operands[0]),
            _ => {}
        }
    }
    groups
}

#[test]
fn a_skinned_object_skins_once_in_a_compute_pass_and_draws_its_skinned_vertices() {
    let (mut world, _) = skinned([0.0, 0.0, 0.0]);
    let mut mock = MockBackend::default();
    let first = world.step(&mut mock, true);

    let pipelines = operands(&first, Op::CreateComputePipeline);
    let skin = pipelines
        .iter()
        .find(|p| p[1] == template::SKIN)
        .expect("the skinning pipeline")[0];
    // The joint texture holds a row of joints for each 1,024 the table can hold.
    let joints = operands(&first, Op::CreateTexture)
        .into_iter()
        .find(|t| t[1] == JOINTS_PER_ROW * TEXELS_PER_JOINT)
        .expect("the joint texture");
    assert_eq!(
        joints[2..6],
        [
            1,
            1,
            format::RGBA32_FLOAT,
            texture_usage::TEXTURE_BINDING | texture_usage::COPY_DST
        ]
    );
    let uploads = operands(&first, Op::WriteTexture);
    assert!(uploads.iter().any(|w| w[0] == joints[0] && w[6] == 1));
    // The skinned vertices: one region of the column's vertices, in its skinned format.
    let skinned_bytes = RINGS * AROUND * vertex::stride(skinned_format(column().format));
    let buffers = operands(&first, Op::CreateBuffer);
    let pool = buffers
        .iter()
        .find(|b| b[2] == buffer_usage::STORAGE | buffer_usage::VERTEX)
        .expect("the skinned vertex buffer");
    assert!(pool[1] >= skinned_bytes);
    let groups = operands(&first, Op::CreateBindGroup);
    assert_eq!(groups.iter().filter(|g| g[1] == layout::SKIN).count(), 1);
    // One dispatch, one thread per vertex, before the passes that draw.
    assert_eq!(
        skin_dispatches(&first, skin),
        [(RINGS * AROUND).div_ceil(64)]
    );
    // The camera's bundle draws the column's region with the pipeline of its skinned format.
    let draws_pool = operands(&first, Op::SetVertexBuffer)
        .iter()
        .any(|v| v[0] == 0 && v[1] == pool[0]);
    assert!(draws_pool);
    let plain = skinned_format(column().format);
    assert!(
        operands(&first, Op::CreateRenderPipeline)
            .iter()
            .any(|p| p[1] == template::INSTANCED_LIT && p[7] == plain)
    );

    // Later frames skin again with the new pose, and make nothing.
    let second = world.step(&mut mock, false);
    assert_eq!(
        skin_dispatches(&second, skin),
        [(RINGS * AROUND).div_ceil(64)]
    );
    assert_eq!(count(&second, Op::CreateBuffer), 0);
    assert_eq!(count(&second, Op::CreateBindGroup), 0);
    assert!(
        operands(&second, Op::WriteTexture)
            .iter()
            .any(|w| w[0] == joints[0])
    );
}

#[test]
fn a_skinned_object_that_no_view_draws_is_not_skinned() {
    // Behind the camera, which looks down -z from z = 20, and with no shadows.
    let (mut world, object) = skinned([0.0, 0.0, 40.0]);
    let mut mock = MockBackend::default();
    let first = world.step(&mut mock, true);
    let skin = operands(&first, Op::CreateComputePipeline)
        .iter()
        .find(|p| p[1] == template::SKIN)
        .unwrap()[0];
    assert_eq!(skin_dispatches(&first, skin), Vec::<u32>::new());
    // Moved into view, it skins.
    world.scene.set_position(object, [0.0, 0.0, 0.0]).unwrap();
    let second = world.step(&mut mock, false);
    assert_eq!(
        skin_dispatches(&second, skin),
        [(RINGS * AROUND).div_ceil(64)]
    );
}

#[test]
fn a_skinned_caster_that_only_a_cascade_sees_is_skinned_for_its_shadow() {
    // Out of the camera's view to the side, but inside the cascades' boxes, which reach toward the
    // light past the view.
    let (mut world, column) = skinned([0.0, 30.0, 0.0]);
    world
        .renderer
        .settings_mut()
        .set_sun([0.0, -1.0, 0.0], [3.0; 3]);
    world
        .renderer
        .settings_mut()
        .set_sun_shadow(Some(SunShadow {
            cascades: 2,
            map_size: 1024,
            bias: 0.5,
            normal_bias: 1.0,
            distance: 40.0,
            layers: DEFAULT_LAYERS,
        }));
    let mut mock = MockBackend::default();
    let first = world.step(&mut mock, true);
    let skin = operands(&first, Op::CreateComputePipeline)
        .iter()
        .find(|p| p[1] == template::SKIN)
        .unwrap()[0];
    assert_eq!(
        skin_dispatches(&first, skin),
        [(RINGS * AROUND).div_ceil(64)]
    );
    // A column that casts no shadow there is not skinned.
    world
        .scene
        .apply_commands(
            &[Command::set_flags(column, flags::CAST_SHADOWS, 0)],
            world.frame,
        )
        .unwrap();
    let second = world.step(&mut mock, true);
    assert_eq!(skin_dispatches(&second, skin), Vec::<u32>::new());
}

#[test]
fn with_vertex_skinning_the_skinned_builds_read_the_joints_and_no_pass_skins() {
    let config = RendererConfig {
        vertex_skinning: true,
        ..RendererConfig::default()
    };
    let mut world = World::with_config(config);
    world.add_skinned([0.0, 0.0, 0.0]);
    let mut mock = MockBackend::default();
    let first = world.step(&mut mock, true);

    assert!(
        operands(&first, Op::CreateComputePipeline)
            .iter()
            .all(|p| p[1] != template::SKIN)
    );
    assert_eq!(count(&first, Op::Dispatch), 1, "the camera's culling alone");
    // The lit pipeline of the mesh's own format, in its SKIN build.
    let format = column().format;
    let skinned = operands(&first, Op::CreateRenderPipeline)
        .into_iter()
        .find(|p| p[1] == template::INSTANCED_LIT && p[2] & permutation::SKIN != 0)
        .expect("a SKIN build of the lit template");
    assert_eq!(skinned[7], format);
    // The joint texture's group, which the camera's bundle binds after the frame's.
    let joints = operands(&first, Op::CreateBindGroup)
        .into_iter()
        .find(|g| g[1] == layout::JOINTS)
        .expect("the joint texture's group");
    assert!(
        operands(&first, Op::SetBindGroup)
            .iter()
            .any(|g| g[0] == 1 && g[1] == joints[0])
    );
    let second = world.step(&mut mock, false);
    assert_eq!(count(&second, Op::Dispatch), 1);
}

#[test]
fn an_outlined_skinned_object_draws_its_mask_in_its_pose_both_ways_of_skinning() {
    for vertex_skinning in [false, true] {
        let mut world = World::with_config(RendererConfig {
            vertex_skinning,
            ..RendererConfig::default()
        });
        let object = world.add_skinned([0.0, 0.0, 0.0]);
        world
            .renderer
            .settings_mut()
            .set_outline(Some(Outline::default()));
        world
            .scene
            .apply_commands(
                &[Command::set_flags(object, flags::OUTLINED, flags::OUTLINED)],
                world.frame,
            )
            .unwrap();
        let mut mock = MockBackend::default();
        let first = world.step(&mut mock, true);

        let masks: Vec<_> = operands(&first, Op::CreateRenderPipeline)
            .into_iter()
            .filter(|p| p[1] == template::OUTLINE_MASK)
            .collect();
        assert_eq!(masks.len(), 2, "both mask pipelines");
        for mask in &masks {
            if vertex_skinning {
                // The SKIN builds of the mesh's own format.
                assert_ne!(mask[2] & permutation::SKIN, 0);
                assert_eq!(mask[7], column().format);
            } else {
                // The skinned vertices' plain format, which the skinning pass writes.
                assert_eq!(mask[2] & permutation::SKIN, 0);
                assert_eq!(mask[7], skinned_format(column().format));
            }
        }
        if vertex_skinning {
            continue;
        }
        // The outline's bundle draws the column's region of skinned vertices too: once for the
        // camera's bundle, once for the outline's.
        let pool = operands(&first, Op::CreateBuffer)
            .into_iter()
            .find(|b| b[2] == buffer_usage::STORAGE | buffer_usage::VERTEX)
            .expect("the skinned vertex buffer");
        let draws_pool = operands(&first, Op::SetVertexBuffer)
            .iter()
            .filter(|v| v[0] == 0 && v[1] == pool[0])
            .count();
        assert!(draws_pool >= 2, "the camera's and the outline's bundles");
    }
}

/// The WebGL2 frame builder, with `WEBGL_multi_draw` or without.
fn webgl2(multi_draw: bool) -> World<CpuCulledRenderer> {
    World::build(CpuCulledRenderer::new(CpuCulledConfig {
        multi_draw,
        ..CpuCulledConfig::default()
    }))
}

/// Adds a second skinned object of `first`'s mesh and material at `position`, with an animated
/// instance of its own.
fn add_twin<B: FrameBuilder>(world: &mut World<B>, first: Handle, position: [f32; 3]) -> Handle {
    let slot = world.scene.resolve(first).unwrap() as usize;
    let (mesh, material) = (world.scene.meshes()[slot], world.scene.materials()[slot]);
    let animations = world.animations.as_mut().unwrap();
    let instance = animations.add_instance(0).unwrap();
    let object = world.scene.reserve().unwrap();
    world.scene.set_position(object, position).unwrap();
    let commands = [
        Command::create(object, Handle::NONE, mesh, flags::VISIBLE),
        Command::set_material(object, material),
        Command::set_skin(object, Some(instance)),
    ];
    world.scene.apply_commands(&commands, world.frame).unwrap();
    object
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

/// The views' instance groups that a frame made.
fn instance_groups(commands: &[(Op, Vec<u32>)]) -> Vec<Vec<u32>> {
    operands(commands, Op::CreateBindGroup)
        .into_iter()
        .filter(|g| g[1] == layout::INSTANCES)
        .collect()
}

/// The resource of entry `entry` of a bind group's operands.
fn bound(group: &[u32], entry: usize) -> u32 {
    group[3 + entry * 5 + 2]
}

/// The texture writes into texture `id`.
fn writes(commands: &[(Op, Vec<u32>)], id: u32) -> Vec<Vec<u32>> {
    operands(commands, Op::WriteTexture)
        .into_iter()
        .filter(|w| w[0] == id)
        .collect()
}

#[test]
fn webgl2_skins_in_the_vertex_shader_of_every_pass_that_draws_a_skinned_object() {
    for multi_draw in [false, true] {
        let mut world = webgl2(multi_draw);
        world.add_skinned([0.0; 3]);
        cast_sun_shadows(&mut world);
        let mut mock = MockBackend::default();
        let first = world.step(&mut mock, true);

        // The column's lit pass and its shadow pass draw with the skinning builds, which read
        // its own vertices with their joints and weights. The other objects draw without them,
        // and nothing skins in a compute pass.
        let format = column().format;
        let pipelines = operands(&first, Op::CreateRenderPipeline);
        let skins = |template: u32| -> Vec<bool> {
            pipelines
                .iter()
                .filter(|p| p[1] == template && p[7] == format)
                .map(|p| p[2] & permutation::SKIN != 0)
                .collect()
        };
        assert_eq!(skins(template::INSTANCED_LIT), [true]);
        assert_eq!(skins(template::SHADOW_DEPTH), [true]);
        assert!(
            pipelines
                .iter()
                .filter(|p| p[7] != format)
                .all(|p| p[2] & permutation::SKIN == 0)
        );
        assert_eq!(count(&first, Op::CreateComputePipeline), 0);

        // Every instance group binds the joint texture and the texture of first joints after
        // the instance textures.
        let groups = instance_groups(&first);
        assert!(!groups.is_empty());
        assert!(groups.iter().all(|g| g[2] == 6));
        let (joints, firsts) = (bound(&groups[0], 4), bound(&groups[0], 5));
        let textures = operands(&first, Op::CreateTexture);
        let created = |id: u32| textures.iter().find(|t| t[0] == id).unwrap().clone();
        assert_eq!(
            created(joints)[1..5],
            [
                JOINTS_PER_ROW * TEXELS_PER_JOINT,
                1,
                1,
                format::RGBA32_FLOAT
            ]
        );
        assert_eq!(created(firsts)[4], format::R32_UINT);
        assert_eq!(writes(&first, joints).len(), 1);
        assert_eq!(writes(&first, firsts).len(), 1);

        // Later frames write the new pose's matrices, and make nothing.
        let second = world.step(&mut mock, false);
        assert_eq!(writes(&second, joints).len(), 1);
        assert!(writes(&second, firsts).is_empty());
        assert_eq!(count(&second, Op::CreateTexture), 0);
        assert_eq!(count(&second, Op::CreateBindGroup), 0);
    }
}

#[test]
fn skinned_objects_of_one_mesh_share_an_instanced_draw_on_webgl2() {
    let mut world = webgl2(true);
    let left = world.add_skinned([-2.0, 0.0, 0.0]);
    let objects = [left, add_twin(&mut world, left, [2.0, 0.0, 0.0])];
    let mut mock = MockBackend::default();
    let first = world.step(&mut mock, true);

    // Both columns are listed in one bucket, which one draw draws.
    let culled = world.renderer.culled(world.frame - 1, ViewId::CAMERA);
    let slots: Vec<u32> = objects
        .iter()
        .map(|&o| world.scene.resolve(o).unwrap())
        .collect();
    let bucket_of = |slot: u32| {
        let rows = (1 << CELL_SHIFT) - 1;
        let at = culled.indices().iter().position(|&e| e & rows == slot);
        let at = at.expect("the column is in view") as u32;
        let starts = culled.bucket_starts();
        starts.windows(2).position(|w| w[0] <= at && at < w[1])
    };
    assert!(bucket_of(slots[0]).is_some());
    assert_eq!(bucket_of(slots[0]), bucket_of(slots[1]));

    // Each column finds its own instance's joints: the first joints of the slots from the first
    // column's to the second's go up in one write.
    let firsts = bound(&instance_groups(&first)[0], 5);
    let written = writes(&first, firsts);
    assert_eq!(written.len(), 1);
    let width = slots[1] - slots[0] + 1;
    assert_eq!(written[0][2..6], [slots[0], 0, 0, width]);
    assert_eq!(written[0][9], width * 4);
}

#[test]
fn webgl2_draws_unskinned_objects_without_the_skin_textures() {
    // The common world skins nothing: its instance groups bind the instance textures alone.
    let mut world = webgl2(true);
    let mut mock = MockBackend::default();
    let first = world.step(&mut mock, true);
    let groups = instance_groups(&first);
    assert!(!groups.is_empty());
    assert!(groups.iter().all(|g| g[2] == 4));

    // A column that stops being skinned draws its mesh as it is, with the plain build.
    let mut world = webgl2(true);
    let skinned_column = world.add_skinned([0.0; 3]);
    world.step(&mut mock, true);
    world
        .scene
        .apply_commands(&[Command::set_skin(skinned_column, None)], world.frame)
        .unwrap();
    let second = world.step(&mut mock, true);
    let format = column().format;
    let plain = operands(&second, Op::CreateRenderPipeline)
        .into_iter()
        .filter(|p| p[1] == template::INSTANCED_LIT && p[7] == format)
        .all(|p| p[2] & permutation::SKIN == 0);
    assert!(plain);
    assert_eq!(count(&second, Op::CreateRenderPipeline), 1);
}

#[test]
fn an_outlined_skinned_object_draws_its_mask_with_the_skinning_builds_on_webgl2() {
    let mut world = webgl2(true);
    let object = world.add_skinned([0.0; 3]);
    world
        .renderer
        .settings_mut()
        .set_outline(Some(Outline::default()));
    world
        .scene
        .apply_commands(
            &[Command::set_flags(object, flags::OUTLINED, flags::OUTLINED)],
            world.frame,
        )
        .unwrap();
    let mut mock = MockBackend::default();
    let first = world.step(&mut mock, true);

    // Both mask pipelines skin the column's own vertices in the vertex shader.
    let masks: Vec<_> = operands(&first, Op::CreateRenderPipeline)
        .into_iter()
        .filter(|p| p[1] == template::OUTLINE_MASK)
        .collect();
    assert_eq!(masks.len(), 2, "both mask pipelines");
    for mask in &masks {
        assert_ne!(mask[2] & permutation::SKIN, 0);
        assert_eq!(mask[7], column().format);
    }
    // The outline view's instance groups, as many as the camera's, bind the joint texture and the
    // first joints too.
    let mut plain = webgl2(true);
    plain.add_skinned([0.0; 3]);
    let camera_groups = instance_groups(&plain.step(&mut MockBackend::default(), true)).len();
    let groups = instance_groups(&first);
    assert_eq!(groups.len(), 2 * camera_groups);
    assert!(groups.iter().all(|g| g[2] == 6));
}
