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
    /// True while the engine calls a vertex offset for the frame before, as the motion pass does
    /// for the second call: then `time`, `deltaTime` and `index` hold that frame's values.
    lastFrame: bool,
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
    /// The matrix from positions relative to the camera to the camera's view space, which looks
    /// down -z: the camera's rotation, as the camera sits at the origin.
    view: mat4x4f,
    /// The matrix from view space to clip space, with the engine's reversed depth: 1 at the near
    /// plane and 0 at the far plane. `projection * view` is `viewProjection`.
    projection: mat4x4f,
    /// The distance of the camera's near plane.
    near: f32,
    /// The distance of the camera's far plane.
    far: f32,
}

/// The values of the object, or of the instance, that a draw shows.
struct ObjectValues {
    /// The position of the object's origin in the world.
    position: vec3f,
    /// The values of the instance's row, for a row of an instance batch with values; zero
    /// elsewhere.
    values: vec4f,
    /// The object's world matrix, with its translation relative to the camera, as positions
    /// relative to the camera take it. Custom materials whose WGSL reads it get it; zero elsewhere.
    worldMatrix: mat4x4f,
    /// The inverse transpose of the world matrix's 3 x 3 part, which turns a normal from the mesh's
    /// space into the world's. Custom materials whose WGSL reads it get it; zero elsewhere.
    normalMatrix: mat3x3f,
    /// The object's id: its slot for an object of the scene, and the same id for every row of an
    /// instance batch. Custom materials whose WGSL reads it get it; zero elsewhere.
    id: u32,
}

/// The frame's values, once `fill_builtins` has filled them.
var<private> frame: FrameValues;
/// The camera's values, once `fill_builtins` has filled them.
var<private> camera: CameraValues;
/// The object's values, once `fill_builtins` has filled them.
var<private> object: ObjectValues;

/// Fills `frame`, `camera` and `object` from the frame's uniform block and the object's origin,
/// relative to the camera, with no row values, matrices or id. In a vertex shader, the origin is
/// `relative_position(find_instance(i), vec3f(0.0))` from `null3d::mesh`; a fragment shader gets it
/// from the vertex shader as a flat value.
fn fill_builtins(origin: vec3f) {
    let clock = null3d::mesh::frame.clock;
    let world = null3d::mesh::frame.camera_world.xyz;
    // The camera that a material's surface reads: this view's own camera, and the scene camera in
    // the views of lights, whose own fields belong to the light.
    frame = FrameValues(
        clock.x,
        clock.y,
        bitcast<u32>(clock.z),
        false,
        null3d::mesh::frame.camera_target.xy,
    );
    let range = null3d::mesh::frame.camera_range;
    camera = CameraValues(
        world,
        null3d::mesh::frame.camera_view_proj,
        null3d::mesh::frame.view,
        null3d::mesh::frame.projection,
        range.x,
        range.y,
    );
    object = ObjectValues(world + origin, vec4f(0.0), mat4x4f(), mat3x3f(), 0u);
}
