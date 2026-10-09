#define_import_path null3d::backdrop

// What the background shaders share: the background's uniform block, as the renderer's
// `background` module writes it, and the box around the camera that the cube map and the sky draw
// as, which gives each fragment its direction in the world.

/// The background's values. The cube map reads the rotation and the first vector, and the sky
/// reads the rest with the intensity.
struct Backdrop {
    /// The rows of the matrix that turns a direction in the world into the cube map's direction,
    /// each in `xyz`.
    rotation: array<vec4f, 3>,
    /// The factor of the background's light, the blur as a roughness from 0 to 1, the cube map's
    /// last mip level, and a spare.
    params: vec4f,
    /// The sky's sun position in `xyz`, as three.js's `sunPosition`, and 1 where the sky shows the
    /// sun's disc, else 0.
    sun: vec4f,
    /// The sky's turbidity, Rayleigh coefficient, Mie coefficient and Mie directional g.
    scattering: vec4f,
    /// The sky's cloud scale, cloud speed, cloud coverage and cloud density.
    clouds: vec4f,
    /// The sky's cloud elevation, its time in seconds, and two spares.
    cloud_place: vec4f,
}

/// A corner of the box around the camera, and the direction in the world that it stands for.
struct BoxCorner {
    clip: vec4f,
    direction: vec3f,
}

/// Corner `vertex` of 36: the box of two triangles per face around the camera, as three.js draws
/// cube and sky backgrounds. The box's center is the camera's place, which is the origin of
/// positions relative to the camera, or the mirrored camera's place in a reflection, and a
/// corner's offset from it is its direction. Every corner sits at the far plane, depth 0 in
/// reversed depth, which every depth mapping keeps at the edge of the clip volume, and triangles
/// that pass behind the camera are clipped where w reaches 0. An orthographic camera's view rays are parallel, so every pixel looks the
/// same way: its first three corners make one triangle over the whole view, in the view's
/// direction, and the rest make none.
fn box_corner(vertex: u32, view_proj: mat4x4f, camera_position: vec4f) -> BoxCorner {
    var out: BoxCorner;
    if camera_position.w == 0.0 {
        let corner = vec2f(f32((vertex << 1u) & 2u), f32(vertex & 2u));
        let inside = vertex < 3u;
        out.clip = select(vec4f(0.0), vec4f(corner * 2.0 - 1.0, 0.0, 1.0), inside);
        out.direction = -camera_position.xyz;
        return out;
    }
    let face = vertex / 6u;
    // The corners of two triangles on a face, from -1 to 1 across it.
    let k = vertex % 6u;
    let u = select(-1.0, 1.0, k == 1u || k == 2u || k == 4u);
    let v = select(-1.0, 1.0, k == 2u || k == 4u || k == 5u);
    let side = select(1.0, -1.0, (face & 1u) == 1u);
    let axis = face / 2u;
    var p = vec3f(side, u, v);
    if axis == 1u {
        p = vec3f(u, side, v);
    } else if axis == 2u {
        p = vec3f(u, v, side);
    }
    let clip = view_proj * vec4f(camera_position.xyz + p, 1.0);
    out.clip = vec4f(clip.xy, 0.0, clip.w);
    out.direction = p;
    return out;
}
