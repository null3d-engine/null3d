//! Skinning on the WebGPU frame builder, checked through the mock backend, which rejects what a
//! real GPU would, and by decoding the lists it records: the skinning pass, which skins each
//! skinned object that some view draws once per frame, the joint texture it reads, and the views'
//! draws of the skinned vertices.

mod common;

use common::skinned::{AROUND, RINGS, column};
use common::{World, count};
use null3d_core::handle::Handle;
use null3d_core::layers::DEFAULT_LAYERS;
use null3d_core::lights::SunShadow;
use null3d_core::scene::{Command, flags};
use null3d_gpu::drawlist::{
    Op, buffer_usage, format, layout, permutation, template, texture_usage, vertex,
};
use null3d_gpu::mock::MockBackend;
use null3d_render::frame::FrameBuilder;
use null3d_render::gpu_driven::RendererConfig;
use null3d_render::skinning::{JOINTS_PER_ROW, TEXELS_PER_JOINT, skinned_format};

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
