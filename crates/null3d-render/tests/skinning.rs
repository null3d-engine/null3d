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
use null3d_core::scene::{Command, flags};
use null3d_gpu::drawlist::{
    Op, buffer_usage, format, layout, permutation, template, texture_usage, vertex,
};
use null3d_gpu::mock::MockBackend;
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::frame::FrameBuilder;
use null3d_render::gpu_driven::{GpuDrivenRenderer, RendererConfig};
use null3d_render::outline::Outline;
use null3d_render::skinning::{JOINTS_PER_ROW, SkinningMode, TEXELS_PER_JOINT, skinned_format};
use null3d_render::view::ViewId;

/// The common world with a skinned column at `position`, which casts shadows. Returns the world
/// and the column.
fn skinned(position: [f32; 3]) -> (World, Handle) {
    let mut world = World::new();
    // No frame has drawn yet, so the first frame waits for every pipeline and draws the skinned
    // objects at once.
    world.pipelines_built = 0;
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

/// The rows of the joint texture for the joints that the world's animation table can hold.
fn joint_rows<B: FrameBuilder>(world: &World<B>) -> u32 {
    let animations = world.animations.as_ref().expect("an animation table");
    animations.joint_capacity().div_ceil(JOINTS_PER_ROW)
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
    // The joint texture holds a row of joints for each `JOINTS_PER_ROW` the table can hold.
    let joints = operands(&first, Op::CreateTexture)
        .into_iter()
        .find(|t| t[1] == JOINTS_PER_ROW * TEXELS_PER_JOINT)
        .expect("the joint texture");
    assert_eq!(
        joints[2..6],
        [
            joint_rows(&world),
            1,
            format::RGBA32_FLOAT,
            texture_usage::TEXTURE_BINDING | texture_usage::COPY_DST
        ]
    );
    let uploads = operands(&first, Op::WriteTexture);
    assert!(uploads.iter().any(|w| w[0] == joints[0] && w[6] == 1));
    // The skinned vertices: one region of the column's vertices, in its skinned format.
    let skinned_bytes = RINGS * AROUND * vertex::stride(skinned_format(column().format, true));
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
    let plain = skinned_format(column().format, true);
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

/// The column with a float tangent beside its texture coordinates.
fn column_with_tangents() -> null3d_render::geometry::Geometry {
    let plain = column();
    let format = plain.format | vertex::TANGENT;
    let mut g = null3d_render::geometry::Geometry {
        format,
        indices: plain.indices.clone(),
        ..Default::default()
    };
    let stride = vertex::stride(plain.format) as usize;
    // The tangent sits after the texture coordinates, before the joints.
    let uv_end = (vertex::offset(plain.format, 2).unwrap() + 8) as usize;
    for v in plain.vertices.chunks(stride) {
        g.vertices.extend_from_slice(&v[..uv_end]);
        for t in [1.0f32, 0.0, 0.0, 1.0] {
            g.vertices.extend_from_slice(&t.to_le_bytes());
        }
        g.vertices.extend_from_slice(&v[uv_end..]);
    }
    assert_eq!(vertex::offset(format, 4), Some(uv_end as u32));
    g
}

#[test]
fn the_skinning_pass_skins_formats_with_a_tangent_with_a_build_of_their_own() {
    let mut world = World::new();
    world.add_skinned([-1.0, 0.0, 0.0]);
    world.add_skinned_mesh([1.0, 0.0, 0.0], &column_with_tangents());
    let mut mock = MockBackend::default();
    let first = world.step(&mut mock, true);

    // One pipeline for each kind of format: the plain build, and the build with the tangent's code.
    let skins: Vec<Vec<u32>> = operands(&first, Op::CreateComputePipeline)
        .into_iter()
        .filter(|p| p[1] == template::SKIN)
        .collect();
    assert_eq!(skins.len(), 2);
    let plain = skins.iter().find(|p| p[2] == 0).expect("the plain build")[0];
    let tangent = skins
        .iter()
        .find(|p| p[2] == permutation::VERTEX_TANGENT)
        .expect("the tangent build")[0];
    assert_ne!(plain, tangent);
    // Each column's page skins in a dispatch of its own pipeline.
    let groups = (RINGS * AROUND).div_ceil(64);
    assert_eq!(skin_dispatches(&first, plain), [groups]);
    assert_eq!(skin_dispatches(&first, tangent), [groups]);

    // A scene without a tangent never builds the tangent's pipeline.
    let (mut world, _) = skinned([0.0; 3]);
    let first = world.step(&mut MockBackend::default(), true);
    let skins: Vec<Vec<u32>> = operands(&first, Op::CreateComputePipeline)
        .into_iter()
        .filter(|p| p[1] == template::SKIN)
        .collect();
    assert_eq!(skins.iter().map(|p| p[2]).collect::<Vec<_>>(), [0]);
}

#[test]
fn a_character_that_holds_its_pose_costs_no_skinning_work() {
    let (mut world, column) = skinned([0.0, 0.0, 0.0]);
    let mut mock = MockBackend::default();
    let first = world.step(&mut mock, true);
    let skin = operands(&first, Op::CreateComputePipeline)
        .iter()
        .find(|p| p[1] == template::SKIN)
        .unwrap()[0];
    let joints = operands(&first, Op::CreateTexture)
        .into_iter()
        .find(|t| t[1] == JOINTS_PER_ROW * TEXELS_PER_JOINT)
        .unwrap()[0];
    let groups = [(RINGS * AROUND).div_ceil(64)];
    assert_eq!(skin_dispatches(&first, skin), groups);
    assert_eq!(world.renderer.skinned_vertices(), RINGS * AROUND);

    // Its clip stops: the pose holds, so neither the pass nor the joint texture does any work.
    world.animation_step = 0.0;
    for _ in 0..2 {
        let still = world.step(&mut mock, false);
        assert_eq!(skin_dispatches(&still, skin), Vec::<u32>::new());
        assert_eq!(world.renderer.skinned_vertices(), 0);
        assert!(
            operands(&still, Op::WriteTexture)
                .iter()
                .all(|w| w[0] != joints)
        );
    }
    // It moves across the world in its pose: its regions hold vertices in the skeleton's space, so
    // nothing skins.
    world.scene.set_position(column, [1.0, 0.0, 0.0]).unwrap();
    let moved = world.step(&mut mock, false);
    assert_eq!(skin_dispatches(&moved, skin), Vec::<u32>::new());

    // A new layout leaves the regions with no pose to keep, so the still column skins once.
    world.add_twin(column, [-2.0, 0.0, 0.0]);
    let relaid = world.step(&mut mock, true);
    assert_eq!(world.renderer.skinned_vertices(), 2 * RINGS * AROUND);
    assert!(!skin_dispatches(&relaid, skin).is_empty());
    world.step(&mut mock, false);
    assert_eq!(world.renderer.skinned_vertices(), 0);

    // The clip plays again: the column skins every frame, and its twin, which plays no clip,
    // keeps its rest pose at no cost.
    world.animation_step = 1.0 / 60.0;
    let playing = world.step(&mut mock, false);
    assert_eq!(world.renderer.skinned_vertices(), RINGS * AROUND);
    assert!(
        operands(&playing, Op::WriteTexture)
            .iter()
            .any(|w| w[0] == joints)
    );
}

#[test]
fn without_the_pose_skip_a_still_character_skins_every_frame() {
    for skinning in [SkinningMode::FULL, SkinningMode::NARROW_ONLY] {
        let mut world = World::with_config(RendererConfig {
            skinning,
            ..RendererConfig::default()
        });
        world.pipelines_built = 0;
        world.add_skinned([0.0, 0.0, 0.0]);
        let mut mock = MockBackend::default();
        world.step(&mut mock, true);
        world.animation_step = 0.0;
        world.step(&mut mock, false);
        assert_eq!(
            world.renderer.skinned_vertices(),
            RINGS * AROUND,
            "{skinning:?}"
        );
    }
}

#[test]
fn a_still_character_added_during_play_keeps_its_pose_once_its_pipelines_are_built() {
    // Frames have drawn, so a skinned object added now waits for its pipelines, and its regions
    // keep no pose until they are built: a dispatch whose pipeline still builds writes nothing.
    let mut world = World::new();
    world.add_skinned([0.0, 0.0, 0.0]);
    world.animation_step = 0.0;
    let mut mock = MockBackend::default();
    let mut skinned = Vec::new();
    for frame in 0..4 {
        world.step(&mut mock, frame == 0);
        skinned.push(world.renderer.skinned_vertices());
    }
    // The first frame asks for the pipelines, the second draws the column and skins it again
    // with them built, and from then on it holds its pose.
    assert_eq!(skinned, [RINGS * AROUND, RINGS * AROUND, 0, 0]);
}

#[test]
fn the_skinned_layout_takes_eight_bit_directions_unless_the_mode_asks_for_floats() {
    for (skinning, stride) in [(SkinningMode::LEAN, 24), (SkinningMode::FULL, 32)] {
        let mut world = World::with_config(RendererConfig {
            skinning,
            ..RendererConfig::default()
        });
        world.pipelines_built = 0;
        world.add_skinned([0.0, 0.0, 0.0]);
        let mut mock = MockBackend::default();
        let first = world.step(&mut mock, true);
        let format = skinned_format(column().format, skinning.narrow_directions);
        assert_eq!(vertex::stride(format), stride);
        assert_eq!(
            world.renderer.skinned_bytes(),
            u64::from(RINGS * AROUND * stride)
        );
        assert!(
            operands(&first, Op::CreateRenderPipeline)
                .iter()
                .any(|p| p[1] == template::INSTANCED_LIT && p[7] == format)
        );
    }
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
    world.cast_sun_shadows(2);
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
        skinning: SkinningMode::VERTEX,
        ..RendererConfig::default()
    };
    let mut world = World::with_config(config);
    world.pipelines_built = 0;
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
fn with_vertex_skinning_and_index_instances_a_skinned_mesh_reads_the_culling_shaders_copies() {
    let config = RendererConfig {
        skinning: SkinningMode::VERTEX,
        index_instances: true,
        ..RendererConfig::default()
    };
    let mut world = World::with_config(config);
    world.add_skinned([0.0, 0.0, 0.0]);
    let mut mock = MockBackend::default();
    let first = world.step(&mut mock, true);

    let pipelines = operands(&first, Op::CreateRenderPipeline);
    let skinned: Vec<_> = pipelines
        .iter()
        .filter(|p| p[2] & permutation::SKIN != 0)
        .collect();
    assert!(!skinned.is_empty(), "the mesh's SKIN builds");
    assert!(
        skinned
            .iter()
            .all(|p| p[2] & permutation::INSTANCE_INDEX == 0),
        "{skinned:?}"
    );
}

#[test]
fn an_outlined_skinned_object_draws_its_mask_in_its_pose_both_ways_of_skinning() {
    for vertex_skinning in [false, true] {
        let mut world = World::with_config(RendererConfig {
            skinning: if vertex_skinning {
                SkinningMode::VERTEX
            } else {
                SkinningMode::LEAN
            },
            ..RendererConfig::default()
        });
        // No frame has drawn yet, so the first frame waits for every pipeline and draws the skinned
        // objects at once.
        world.pipelines_built = 0;
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
                assert_eq!(mask[7], skinned_format(column().format, true));
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

#[test]
fn an_outlined_skinned_object_added_during_play_asks_for_both_mask_pipelines_while_it_waits() {
    for vertex_skinning in [false, true] {
        let mut world = World::with_config(RendererConfig {
            skinning: if vertex_skinning {
                SkinningMode::VERTEX
            } else {
                SkinningMode::LEAN
            },
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
        // Frames have drawn, so the skinned object waits for its pipelines, the outline mask's
        // two among them, which the layouts ask for in the same frame.
        let first = world.step(&mut mock, true);
        let masks = operands(&first, Op::CreateRenderPipeline)
            .into_iter()
            .filter(|p| p[1] == template::OUTLINE_MASK)
            .count();
        assert_eq!(masks, 2, "both mask pipelines");
    }
}

/// The WebGL2 frame builder, with `WEBGL_multi_draw` or without.
fn webgl2(multi_draw: bool) -> World<CpuCulledRenderer> {
    let mut world = World::build(CpuCulledRenderer::new(CpuCulledConfig {
        multi_draw,
        ..CpuCulledConfig::default()
    }));
    // No frame has drawn yet, so the first frame waits for every pipeline and draws the skinned
    // objects at once.
    world.pipelines_built = 0;
    world
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
        world.cast_sun_shadows(2);
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

        // Every instance group binds the joint texture, the texture of first joints and the morph
        // textures of deltas and weights after the instance textures, then the row values textures.
        let groups = instance_groups(&first);
        assert!(!groups.is_empty());
        assert!(groups.iter().all(|g| g[2] == 10));
        let (joints, firsts) = (bound(&groups[0], 4), bound(&groups[0], 5));
        let textures = operands(&first, Op::CreateTexture);
        let created = |id: u32| textures.iter().find(|t| t[0] == id).unwrap().clone();
        assert_eq!(
            created(joints)[1..5],
            [
                JOINTS_PER_ROW * TEXELS_PER_JOINT,
                joint_rows(&world),
                1,
                format::RGBA32_FLOAT
            ]
        );
        assert_eq!(created(firsts)[4], format::R32_UINT);
        assert_eq!(writes(&first, joints).len(), 1);
        // One write for the first joints, one for the first weights, which nothing morphs here.
        assert_eq!(writes(&first, firsts).len(), 2);

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
    let objects = [left, world.add_twin(left, [2.0, 0.0, 0.0])];
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
    // column's to the second's go up in one write, and their first weights in a second.
    let firsts = bound(&instance_groups(&first)[0], 5);
    let written = writes(&first, firsts);
    assert_eq!(written.len(), 2);
    let width = slots[1] - slots[0] + 1;
    assert_eq!(written[0][2..6], [slots[0], 0, 0, width]);
    assert_eq!(written[0][9], width * 4);
}

#[test]
fn webgl2_draws_unskinned_objects_without_the_skin_textures() {
    // The common world skins nothing: its instance groups bind the instance textures and the row
    // values textures alone.
    let mut world = webgl2(true);
    let mut mock = MockBackend::default();
    let first = world.step(&mut mock, true);
    let groups = instance_groups(&first);
    assert!(!groups.is_empty());
    assert!(groups.iter().all(|g| g[2] == 6));

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
    // The outline view's instance groups, as many as the camera's, bind the joint texture, the
    // first joints and the morph textures too.
    let mut plain = webgl2(true);
    plain.add_skinned([0.0; 3]);
    let camera_groups = instance_groups(&plain.step(&mut MockBackend::default(), true)).len();
    let groups = instance_groups(&first);
    assert_eq!(groups.len(), 2 * camera_groups);
    assert!(groups.iter().all(|g| g[2] == 10));
}

/// Skinned copies of one mesh, as many as the meshes of a crowd of 500 characters of 10 meshes.
const CROWD: usize = 5_000;

/// A crowd of `CROWD` skinned copies of one mesh in rows, with the sun's shadows in two cascades,
/// on the frame builder of `world`. Returns the commands of its first frame.
fn crowd<B: FrameBuilder>(mut world: World<B>) -> Vec<(Op, Vec<u32>)> {
    world.pipelines_built = 0;
    world.make_room_for_crowd(CROWD as u32);
    let first = world.add_skinned([0.0, 0.0, 0.0]);
    for k in 1..CROWD {
        let position = [(k % 100) as f32 - 50.0, 0.0, -((k / 100) as f32)];
        world.add_twin(first, position);
    }
    world.cast_sun_shadows(2);
    world.step(&mut MockBackend::default(), true)
}

#[test]
fn a_crowd_of_skinned_objects_fits_the_draw_list_on_webgpu() {
    // Each skinned object draws from a bucket of its own in the camera's bundle, so the list needs
    // room in proportion to the buckets. The copies cast no shadow, and the cascades draw the first.
    let renderer = GpuDrivenRenderer::new(RendererConfig::default());
    let first = crowd(World::build_sized(renderer, CROWD as u32 + 64));
    assert_eq!(count(&first, Op::BeginBundle), 3);
    assert!(count(&first, Op::DrawIndexedIndirect) >= CROWD);
}

#[test]
fn a_crowd_of_skinned_objects_fits_the_draw_list_on_webgl2() {
    // Skinned copies of one mesh share an instanced draw on WebGL2.
    let renderer = CpuCulledRenderer::new(CpuCulledConfig::default());
    let first = crowd(World::build_sized(renderer, CROWD as u32 + 64));
    assert!(count(&first, Op::MultiDrawIndexed) + count(&first, Op::DrawIndexed) > 0);
}

#[test]
fn a_skinned_object_added_during_play_draws_once_its_pipelines_are_built() {
    // A frame has drawn, so a pipeline counts as built from the frame after the one that created it.
    let mut world = World::new();
    let mut mock = MockBackend::default();
    world.step(&mut mock, true);
    world.add_skinned([0.0, 0.0, 0.0]);
    let asked = world.step(&mut mock, true);
    assert_eq!(
        count(&asked, Op::CreateComputePipeline),
        1,
        "the skinning pass's pipeline"
    );
    let pool = operands(&asked, Op::CreateBuffer)
        .into_iter()
        .find(|b| b[2] == buffer_usage::STORAGE | buffer_usage::VERTEX)
        .expect("the skinned vertex buffer");
    let draws_pool = |commands: &[(Op, Vec<u32>)]| {
        operands(commands, Op::SetVertexBuffer)
            .iter()
            .any(|v| v[0] == 0 && v[1] == pool[0])
    };
    assert!(
        !draws_pool(&asked),
        "no pass draws the skinned vertices before they are written"
    );
    let drawn = world.step(&mut mock, false);
    assert!(
        draws_pool(&drawn),
        "every pass takes the object in once its pipelines are built"
    );
}
