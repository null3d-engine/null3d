#define_import_path null3d::builtins
#import null3d::mesh

// The built-in values of custom materials: the frame, the camera and the object that a draw shows.
// The engine fills them before it calls a surface function or a vertex offset. A full shader fills
// them once in each stage with `fill_builtins`, then reads `frame`, `camera` and `object` anywhere.
// Import the items by name, as in `#import null3d::builtins::{frame}`.

/// The frame's values, the same for every draw in it.
struct FrameValues {
    /// The sketch time in seconds, as `time.now` gives it to the sketch.
    time: f32,
    /// The seconds since the frame before, as `time.dt` gives them.
    deltaTime: f32,
    /// The frame's number, counting from 1, as `time.frame` gives it.
    index: u32,
    /// The size of the render target in pixels.
    resolution: vec2f,
}

/// The values of the camera that the view draws from.
struct CameraValues {
    /// The camera's position in the world. Far from the world's origin, it holds fewer digits than
    /// positions relative to the camera.
    position: vec3f,
    /// The matrix from positions relative to the camera to clip space.
    viewProjection: mat4x4f,
}

/// The values of the object, or of the instance, that a draw shows.
struct ObjectValues {
    /// The position of the object's origin in the world.
    position: vec3f,
}

/// The frame's values, once `fill_builtins` has filled them.
var<private> frame: FrameValues;
/// The camera's values, once `fill_builtins` has filled them.
var<private> camera: CameraValues;
/// The object's values, once `fill_builtins` has filled them.
var<private> object: ObjectValues;

/// Fills `frame`, `camera` and `object` from the frame's uniform block and the object's origin,
/// relative to the camera. In a vertex shader, the origin is
/// `relative_position(find_instance(i), vec3f(0.0))` from `null3d::mesh`; a fragment shader gets it
/// from the vertex shader as a flat value.
fn fill_builtins(origin: vec3f) {
    let clock = null3d::mesh::frame.clock;
    let world = null3d::mesh::frame.camera_world.xyz;
    let size = null3d::mesh::frame.target_size.xy;
    frame = FrameValues(clock.x, clock.y, bitcast<u32>(clock.z), size);
    camera = CameraValues(world, null3d::mesh::frame.view_proj);
    object = ObjectValues(world + origin);
}
