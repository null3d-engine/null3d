//! The scene's fog in each view's frame values, on both frame builders: its curve, color and
//! distances, and its density at the height of each view's camera.

mod common;

use common::World;
use null3d_render::camera::Orthographic;
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::fog::{Fog, FogUniform, curve};
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

/// No fog at first, then linear fog, then exponential fog that thins with height, seen by a second
/// view whose camera stands higher, each in the frame after it was set. The world's camera stands
/// at a height of 0.
fn fog_reaches_every_view<B: FrameBuilder + Views>(mut world: World<B>) {
    world.record(true);
    assert_eq!(fog_of(&world, ViewId::CAMERA), FogUniform::default());

    let set = |world: &mut World<B>, code, values| {
        let fog = Fog::from_code(code, GREY, values);
        world.renderer.settings_mut().set_fog(fog);
    };
    set(
        &mut world,
        curve::LINEAR,
        [0.0, 10.0, 80.0, 0.0, 0.0, 0.0, 8.0],
    );
    world.record(false);
    let linear = fog_of(&world, ViewId::CAMERA);
    assert_eq!(
        (linear.curve, linear.color, linear.shape),
        (curve::LINEAR, GREY, [10.0, 80.0, 0.0, 1.0])
    );

    let side = world.add_view_through(
        [5.0, 2.0, 0.0],
        Orthographic {
            height: 2.0,
            width: None,
            center: [0.0, 0.0],
            near: 0.1,
            far: 100.0,
        },
    );
    set(
        &mut world,
        curve::EXPONENTIAL,
        [0.02, 0.0, 0.0, 1.0, 0.5, 0.25, 16.0],
    );
    world.record(true);
    for (view, height) in [(ViewId::CAMERA, 0.0f32), (side, 2.0)] {
        let fog = fog_of(&world, view);
        assert_eq!(
            (fog.curve, fog.density, fog.sun_glow, fog.sun_exponent),
            (curve::EXPONENTIAL, 0.02, 0.25, 16.0)
        );
        let share = (-0.5 * (height - 1.0)).exp();
        assert!(
            (fog.shape[3] - share).abs() < 1e-6,
            "a camera at height {height} sees the density share {share}, not {}",
            fog.shape[3]
        );
    }

    world.renderer.settings_mut().set_fog(None);
    world.record(false);
    assert_eq!(fog_of(&world, side).curve, curve::NONE);
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
