#define_import_path null3d::vertex

// Helpers for vertex shaders: instance transforms, and positions relative to the camera. The engine
// stores each instance's world transform as three rows of a 3 x 4 affine matrix. It draws
// everything relative to the camera, so positions stay precise far from the origin. Each frame, it
// moves each transform by the offset from the camera to the transform's grid cell. The frame's
// view-projection matrix then puts the camera at the origin.

/// A world transform as the engine stores it: the rows of a 3 x 4 affine matrix that give x, y and
/// z. The w component of each row holds the translation.
struct Transform {
    /// The row that gives x.
    x: vec4f,
    /// The row that gives y.
    y: vec4f,
    /// The row that gives z.
    z: vec4f,
}

// What vertex shaders multiply a mesh's positions and texture coordinates by. A mesh may keep them
// as plain 8-bit or 16-bit integers, which glTF reads as whole numbers. WebGL2 reads them so, but
// WebGPU has no such vertex format: it reads them as fractions of the type's largest value, and
// the engine sets that value here in each pipeline that draws such a mesh. Each constant's id is
// 1000 plus its attribute's location.
@id(1000) override position_scale: f32 = 1.0;
@id(1002) override uv_scale: f32 = 1.0;
@id(1003) override second_uv_scale: f32 = 1.0;

/// A mesh's position as its vertex shader reads it, at location 0, in the mesh's own units. Plain
/// integer positions keep their whole values on every GPU path, as glTF reads them.
fn mesh_position(p: vec3f) -> vec3f {
    return p * position_scale;
}

/// A mesh's first texture coordinates as its vertex shader reads them, at location 2. Plain
/// integer coordinates keep their whole values on every GPU path, as glTF reads them.
fn mesh_uv(uv: vec2f) -> vec2f {
    return uv * uv_scale;
}

/// A mesh's second texture coordinates as its vertex shader reads them, at location 3. Plain
/// integer coordinates keep their whole values on every GPU path, as glTF reads them.
fn mesh_second_uv(uv: vec2f) -> vec2f {
    return uv * second_uv_scale;
}

/// A clip-space position outside the clip volume on every axis. A triangle whose three corners
/// all get it draws nothing.
const OUTSIDE_CLIP = vec4f(2.0, 2.0, 2.0, 1.0);

/// A point through the transform: rotated, scaled and moved.
fn transform_point(t: Transform, p: vec3f) -> vec3f {
    let q = vec4f(p, 1.0);
    return vec3f(dot(t.x, q), dot(t.y, q), dot(t.z, q));
}

/// A direction through the transform: rotated and scaled, but not moved.
fn transform_direction(t: Transform, d: vec3f) -> vec3f {
    let q = vec4f(d, 0.0);
    return vec3f(dot(t.x, q), dot(t.y, q), dot(t.z, q));
}

/// A unit normal through the transform. It uses the inverse transpose of the transform's 3 x 3
/// part. Normals then stay at right angles to their surface under uneven scale, and keep facing out
/// under a mirror.
fn transform_normal(t: Transform, n: vec3f) -> vec3f {
    let a = t.x.xyz;
    let b = t.y.xyz;
    let c = t.z.xyz;
    let bc = cross(b, c);
    let ca = cross(c, a);
    let ab = cross(a, b);
    let facing = select(-1.0, 1.0, dot(a, bc) >= 0.0);
    return normalize(vec3f(dot(bc, n), dot(ca, n), dot(ab, n)) * facing);
}

/// The transform moved by `offset`. Moving a transform relative to its grid cell by the offset
/// from the camera to the cell makes it relative to the camera.
fn move_transform(t: Transform, offset: vec3f) -> Transform {
    return Transform(
        t.x + vec4f(0.0, 0.0, 0.0, offset.x),
        t.y + vec4f(0.0, 0.0, 0.0, offset.y),
        t.z + vec4f(0.0, 0.0, 0.0, offset.z),
    );
}

/// A position relative to the camera in clip space, through a view-projection matrix that puts
/// the camera at the origin.
fn to_clip(view_proj: mat4x4f, relative_position: vec3f) -> vec4f {
    return view_proj * vec4f(relative_position, 1.0);
}
