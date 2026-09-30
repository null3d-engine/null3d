//! Orthographic cameras on both frame builders. The camera's view and any other view take an
//! orthographic lens, and each culls against the box of its own view: near the origin, and far
//! from it, where the frustum moves into each grid cell by the offset from the camera.

mod common;

use common::{BATCH_ROWS, World, far_out};
use null3d_gpu::mock::MockBackend;
use null3d_render::camera::Orthographic;
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::frame::FrameBuilder;
use null3d_render::gpu_driven::GpuDrivenRenderer;
use null3d_render::view::{ViewFrame, ViewId};

/// A view 2 tall, whose width follows the world's 640 × 360 canvas: 3.56 wide. Around the
/// camera's axis, it holds the objects at x = -1 and 1 and the batch at the origin, each with a
/// radius of 0.9, but not the object at x = -3. The world's perspective lens sees all three.
fn ortho(center_x: f32) -> Orthographic {
    Orthographic {
        height: 2.0,
        width: None,
        center: [center_x, 0.0],
        near: 0.1,
        far: 2000.0,
    }
}

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

fn gpu_driven() -> World<GpuDrivenRenderer> {
    World::new()
}

fn cpu_culled() -> World<CpuCulledRenderer> {
    World::build(CpuCulledRenderer::new(CpuCulledConfig::default()))
}

/// Records the current frame and replays its list on the mock backend, which rejects what a real
/// GPU would.
fn record<B: FrameBuilder>(world: &mut World<B>, structure_changed: bool) {
    world.record(structure_changed);
    MockBackend::default()
        .replay(world.renderer.list(world.frame).words())
        .unwrap();
}

/// Which of the world's shown objects a view's frustum holds, as the culling of both builders
/// tests them: each sphere moved by the offset from the view's camera to the sphere's cell.
fn seen<B: FrameBuilder + Views>(world: &World<B>, view: ViewId) -> [bool; 3] {
    let frame = world.renderer.frame_of(view);
    let spheres = world.scene.world(world.frame as usize % 2).spheres();
    std::array::from_fn(|object| {
        let slot = world.scene.resolve(world.objects[object]).unwrap() as usize;
        let cell = world.scene.cell_table().coords(world.scene.cells()[slot]);
        let [x, y, z] = frame.camera.offset_to(cell);
        frame.frustum.contains_sphere(
            spheres.xs[slot] + x,
            spheres.ys[slot] + y,
            spheres.zs[slot] + z,
            spheres.radii[slot],
        )
    })
}

/// True when a view's frustum holds a sphere of the batch, whose rows sit at the origin.
fn sees_the_batch(frame: &ViewFrame) -> bool {
    let [x, y, z] = frame.camera.offset_to([0, 0, 0]);
    frame.frustum.contains_sphere(x, y, z, 0.9)
}

/// Each bucket's index list entries in a view's culling output on WebGL2: visible rows, then
/// visible clusters. The buckets are lit boxes (the object at x = -3), the batch, lit balls (the
/// object at x = 1) and unlit boxes (the object at x = -1).
fn listed(world: &World<CpuCulledRenderer>, view: ViewId) -> Vec<(u32, u32)> {
    let starts = world.renderer.culled(world.frame, view).bucket_starts();
    let entries: Vec<u32> = starts.windows(2).map(|w| w[1] - w[0]).collect();
    entries.chunks(2).map(|pair| (pair[0], pair[1])).collect()
}

/// The camera's view and a second view, both orthographic, from cameras at the same place. The
/// second view's center lies 3 to the left, so it holds the objects at x = -3 and -1 alone.
fn two_orthographic_views<B: FrameBuilder + Views>(world: &mut World<B>) -> ViewId {
    let camera = world.camera;
    world.renderer.settings_mut().set_camera(camera, ortho(0.0));
    let side = world.add_view_through([0.0, 0.0, 20.0], ortho(-3.0));
    record(world, true);

    assert_eq!(seen(world, ViewId::CAMERA), [false, true, true]);
    assert_eq!(seen(world, side), [true, true, false]);
    assert!(sees_the_batch(&world.renderer.frame_of(ViewId::CAMERA)));
    assert!(!sees_the_batch(&world.renderer.frame_of(side)));
    // The shaders see the orthographic camera at infinity behind its view, along +z.
    for view in [ViewId::CAMERA, side] {
        let camera = world.renderer.frame_of(view).uniform.camera_position;
        assert_eq!(camera, [0.0, 0.0, 1.0, 0.0]);
    }
    side
}

#[test]
fn orthographic_views_cull_to_their_boxes_on_webgpu() {
    let mut world = gpu_driven();
    two_orthographic_views(&mut world);
}

#[test]
fn orthographic_views_list_what_their_boxes_hold_on_webgl2() {
    let mut world = cpu_culled();
    let side = two_orthographic_views(&mut world);
    assert_eq!(
        listed(&world, ViewId::CAMERA),
        vec![(0, 0), (BATCH_ROWS, 0), (1, 0), (1, 0)]
    );
    assert_eq!(listed(&world, side), vec![(1, 0), (0, 0), (0, 0), (1, 0)]);
}

/// Moves the scene and the camera 1,000 km out, and then the object at x = -1 1.5 km farther
/// along the view, into the next cell along z. The camera's view must hold the same objects as at
/// the origin.
fn far_from_the_origin<B: FrameBuilder + Views>(world: &mut World<B>) {
    let camera = world.camera;
    world.renderer.settings_mut().set_camera(camera, ortho(0.0));
    world.move_far_out();
    let behind = world.objects[1];
    world
        .scene
        .set_position(behind, far_out(-1.0, 0.0, -1500.0))
        .unwrap();
    record(world, true);

    let slot = |object| world.scene.resolve(object).unwrap() as usize;
    let cells = world.scene.cells();
    assert_ne!(
        cells[slot(behind)],
        cells[slot(world.objects[2])],
        "the object 1.5 km along the view lies in another cell"
    );
    assert_eq!(seen(world, ViewId::CAMERA), [false, true, true]);
    // The batch stayed at the origin, 1,000 km to the side of the view.
    assert!(!sees_the_batch(&world.renderer.frame_of(ViewId::CAMERA)));

    // The frustum is relative to the camera: the view's box starts at the camera, not at the
    // origin 1,000 km away, and keeps its width 1 km along the view.
    let frustum = world.renderer.frame_of(ViewId::CAMERA).frustum;
    assert!(frustum.contains_sphere(1.7, 0.0, -1000.0, 0.0));
    assert!(!frustum.contains_sphere(1.9, 0.0, -1000.0, 0.0));
}

#[test]
fn far_from_the_origin_an_orthographic_view_culls_in_each_cell_on_webgpu() {
    let mut world = gpu_driven();
    far_from_the_origin(&mut world);
}

#[test]
fn far_from_the_origin_an_orthographic_view_lists_each_cell_on_webgl2() {
    let mut world = cpu_culled();
    far_from_the_origin(&mut world);
    assert_eq!(
        listed(&world, ViewId::CAMERA),
        vec![(0, 0), (0, 0), (1, 0), (1, 0)]
    );
}
