//! The scene's fog in each view's frame values, on both frame builders: its kind, color and
//! distances, and the direction its camera looks along, which fog depth follows for both lenses.

mod common;

use common::World;
use null3d_render::camera::Orthographic;
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::fog::{Fog, FogUniform, kind};
use null3d_render::frame::FrameBuilder;
use null3d_render::gpu_driven::GpuDrivenRenderer;
use null3d_render::view::{ViewFrame, ViewId};

const GREY: [f32; 3] = [0.5, 0.55, 0.6];

/// Each builder's values for a view in the frame that recorded last.
trait Views {
    fn frame_of(&self, view: ViewId) -> ViewFrame;
}

impl Views for GpuDrivenRenderer {
    fn frame_of(&self, view: ViewId) -> ViewFrame {
        *self.view_frame(view).expect("the view has a camera")
    }
}

impl Views for CpuCulledRenderer {
    fn frame_of(&self, view: ViewId) -> ViewFrame {
        *self.view_frame(view).expect("the view has a camera")
    }
}

fn fog_of<B: FrameBuilder + Views>(world: &World<B>, view: ViewId) -> FogUniform {
    world.renderer.frame_of(view).uniform.fog
}

fn assert_close(actual: [f32; 3], expected: [f32; 3]) {
    for (a, e) in actual.iter().zip(expected) {
        assert!((a - e).abs() < 1e-6, "{actual:?} is not {expected:?}");
    }
}

/// No fog at first, then linear fog, then exponential squared fog seen by a second view, each in
/// the frame after it was set. The world's camera looks down -z; the second one turns a quarter
/// turn about +y, to look down -x, through an orthographic lens.
fn fog_reaches_every_view<B: FrameBuilder + Views>(mut world: World<B>) {
    world.record(true);
    let none = fog_of(&world, ViewId::CAMERA);
    assert_eq!(none.kind, kind::NONE);
    assert_close(none.forward, [0.0, 0.0, -1.0]);

    world.renderer.settings_mut().set_fog(Fog::Linear {
        color: GREY,
        near: 10.0,
        far: 80.0,
    });
    world.record(false);
    let linear = fog_of(&world, ViewId::CAMERA);
    assert_eq!(
        (linear.kind, linear.color, linear.near, linear.far),
        (kind::LINEAR, GREY, 10.0, 80.0)
    );

    let side = world.add_view_through(
        [5.0, 0.0, 0.0],
        Orthographic {
            height: 2.0,
            width: None,
            center: [0.0, 0.0],
            near: 0.1,
            far: 100.0,
        },
    );
    let side_camera = world.renderer.settings().views()[side.index()]
        .camera()
        .unwrap()
        .0;
    let half = std::f32::consts::FRAC_1_SQRT_2;
    world
        .scene
        .set_rotation(side_camera, [0.0, half, 0.0, half])
        .unwrap();
    world.renderer.settings_mut().set_fog(Fog::Exp2 {
        color: GREY,
        density: 0.02,
    });
    world.record(true);
    for view in [ViewId::CAMERA, side] {
        let exp2 = fog_of(&world, view);
        assert_eq!((exp2.kind, exp2.density), (kind::EXP2, 0.02));
    }
    let forward = fog_of(&world, side).forward;
    assert_close(forward, [-1.0, 0.0, 0.0]);
    // An orthographic camera's point at infinity lies against the direction it looks along.
    let eye = world.renderer.frame_of(side).uniform.camera_position;
    assert_close(forward, [-eye[0], -eye[1], -eye[2]]);
}

#[test]
fn fog_reaches_every_view_on_webgpu() {
    fog_reaches_every_view(World::new());
}

#[test]
fn fog_reaches_every_view_on_webgl2() {
    fog_reaches_every_view(World::build(CpuCulledRenderer::new(
        CpuCulledConfig::default(),
    )));
}
