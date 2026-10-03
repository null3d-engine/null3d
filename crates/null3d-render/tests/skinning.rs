//! Skinning on the WebGPU frame builder, checked through the mock backend, which rejects what a
//! real GPU would, and by decoding the lists it records: the skinning pass, which skins each
//! skinned object that some view draws once per frame, the joint texture it reads, and the views'
//! draws of the skinned vertices.

mod common;

use common::{World, count};
use null3d_core::animation::{Animations, NO_PARENT, REST_FLOATS, Skeleton};
use null3d_core::handle::Handle;
use null3d_core::layers::DEFAULT_LAYERS;
use null3d_core::lights::SunShadow;
use null3d_core::scene::{Command, flags};
use null3d_core::world::MATRIX_FLOATS;
use null3d_gpu::drawlist::{Op, buffer_usage, format, layout, template, texture_usage, vertex};
use null3d_gpu::mock::MockBackend;
use null3d_render::frame::FrameBuilder;
use null3d_render::geometry::Geometry;
use null3d_render::materials::Shading;
use null3d_render::skinning::{JOINTS_PER_ROW, TEXELS_PER_JOINT, skinned_format};

/// Rings of the generated column, and vertices around each ring.
const RINGS: u32 = 3;
const AROUND: u32 = 30;

/// A chain of `joints` joints up the y axis, one unit apart, with no turn at rest.
fn chain(joints: u32) -> Skeleton {
    let parents: Vec<u32> = (0..joints)
        .map(|j| if j == 0 { NO_PARENT } else { j - 1 })
        .collect();
    let mut rest = Vec::new();
    let mut binds = Vec::new();
    for j in 0..joints {
        let up = if j == 0 { 0.0 } else { 1.0 };
        rest.extend_from_slice(&[0.0, up, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0]);
        binds.extend_from_slice(&[
            1.0,
            0.0,
            0.0,
            0.0,
            0.0,
            1.0,
            0.0,
            -(j as f32),
            0.0,
            0.0,
            1.0,
            0.0,
        ]);
    }
    assert_eq!(rest.len(), joints as usize * REST_FLOATS);
    assert_eq!(binds.len(), joints as usize * MATRIX_FLOATS);
    Skeleton::new(&parents, &rest, &binds).unwrap()
}

/// A column of rings one unit apart up the y axis, each moved by its own joint, with 16-bit
/// joints, normalized 8-bit weights and texture coordinates, as quantized glTF files hold them.
fn column() -> Geometry {
    let joints = vertex::with(
        vertex::UV0 | vertex::JOINTS | vertex::WEIGHTS,
        6,
        vertex::Type::Uint16,
    )
    .unwrap();
    let format = vertex::with(joints, 7, vertex::Type::Unorm8).unwrap();
    let mut g = Geometry {
        format,
        ..Geometry::default()
    };
    for ring in 0..RINGS {
        for k in 0..AROUND {
            let angle = k as f32 / AROUND as f32 * std::f32::consts::TAU;
            let (x, z) = (0.4 * angle.cos(), 0.4 * angle.sin());
            for v in [x, ring as f32, z, angle.cos(), 0.0, angle.sin(), 0.0, 0.0] {
                g.vertices.extend_from_slice(&v.to_le_bytes());
            }
            g.vertices
                .extend_from_slice(&[ring as u8, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0]);
        }
    }
    assert_eq!(
        g.vertices.len(),
        (RINGS * AROUND * vertex::stride(format)) as usize
    );
    for ring in 0..RINGS - 1 {
        for k in 0..AROUND {
            let a = ring * AROUND + k;
            let b = ring * AROUND + (k + 1) % AROUND;
            g.indices
                .extend_from_slice(&[a, a + AROUND, b, b, a + AROUND, b + AROUND]);
        }
    }
    g
}

/// The common world with a skinned column at `position`, animated by an instance of a three-joint
/// chain, which casts shadows. Returns the world and the column.
fn skinned(position: [f32; 3]) -> (World, Handle) {
    let mut world = World::new();
    let mut animations = Animations::new(&world.jobs, 8, 64).unwrap();
    let skeleton = animations.add_skeleton(chain(RINGS)).unwrap();
    let instance = animations.add_instance(skeleton).unwrap();
    world.animations = Some(animations);
    let settings = world.renderer.settings_mut();
    let mesh = settings.meshes_mut().add(&column()).unwrap() + 1;
    let material = settings
        .materials_mut()
        .create(Shading::Lit, 0, [1.0; 4])
        .unwrap()
        + 1;
    let object = world.scene.reserve().unwrap();
    world.scene.set_position(object, position).unwrap();
    let shown = flags::VISIBLE | flags::CAST_SHADOWS;
    let commands = [
        Command::create(object, Handle::NONE, mesh, shown),
        Command::set_material(object, material),
        Command::set_skin(object, Some(instance)),
    ];
    world.scene.apply_commands(&commands, world.frame).unwrap();
    (world, object)
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
