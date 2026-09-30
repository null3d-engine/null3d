enable draw_index;

// Meshes drawn by instance with the standard material: glTF's metallic-roughness model, shaded
// with the formulas of three.js's MeshStandardMaterial. null3d::mesh finds each instance on both
// GPU paths, and null3d::lighting holds the formulas.
//
// The fragment shader works in two steps. First a surface function fills a `Surface` from a
// `SurfaceInput`: `defaultSurface` reads the material's own values, and a custom material's
// surface function starts from it. Then `shade` lights the surface with the scene's lights. Code
// that reads the material's options belongs in `defaultSurface`, and code that lights, shadows,
// fogs or blends the surface belongs in `shade`, so custom materials get both.
//
// Custom materials build this template with their WGSL added after its last line, and with the
// shader defs CUSTOM and UV0, which reads the first texture coordinates. CUSTOM_SURFACE makes the fragment
// shader call their `fn surface`, and CUSTOM_VERTEX_OFFSET makes the vertex shader move each vertex
// by their `fn vertexOffset`. Their WGSL reads the built-in values `frame`, `camera` and `object`,
// which each stage fills under CUSTOM; the frame's uniform block is `engine_frame` here. When their
// WGSL declares `struct Uniforms`, the build adds `load_material_uniforms` after it, and
// CUSTOM_UNIFORMS makes each stage fill `material` with the uniforms. Their WGSL shares this file's names, so the template imports library items by name and
// keeps its own names few. It never imports a module whole, which would reserve the module's name
// in their WGSL too.
#import null3d::color::{linear_to_srgb}
#import null3d::lighting::{PbrMaterial, dfg_lut, direct_light, indirect_diffuse}
#import null3d::lighting::{multiscatter_compensation, pbr_material}
#import null3d::globals::{Material}
#import null3d::mesh::{InstanceIn, clip_of, find_instance, frame as engine_frame, material_of}
#import null3d::mesh::{custom_value, relative_position, world_normal}

/// The bit of a material's flags that lights each triangle with its face's normal.
const FLAT_SHADING: u32 = 1u;

/// The row of the material that the pixel shows, which the fragment shader reads once.
var<private> material_row: Material;

#ifdef CUSTOM_UNIFORMS
/// The custom material's uniforms, which each stage reads once.
var<private> material: Uniforms;
#endif

#ifdef CUSTOM
/// The frame's values that a custom material reads as `frame`.
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

/// The camera's values that a custom material reads as `camera`.
struct CameraValues {
    /// The camera's position in the world. Far from the world's origin, it holds fewer digits than
    /// positions relative to the camera.
    position: vec3f,
    /// The matrix from positions relative to the camera to clip space.
    viewProjection: mat4x4f,
}

/// The values of the object, or of the instance, that a custom material reads as `object`.
struct ObjectValues {
    /// The position of the object's origin in the world.
    position: vec3f,
}

var<private> frame: FrameValues;
var<private> camera: CameraValues;
var<private> object: ObjectValues;

/// Fills the built-in values from the frame's uniform block and the object's origin, relative to
/// the camera.
fn fill_builtins(origin: vec3f) {
    let clock = engine_frame.clock;
    let world = engine_frame.camera_world.xyz;
    frame = FrameValues(clock.x, clock.y, bitcast<u32>(clock.z), engine_frame.target_size.xy);
    camera = CameraValues(world, engine_frame.view_proj);
    object = ObjectValues(world + origin);
}
#endif

/// The vertex attributes that the template reads.
struct VertexIn {
    @location(0) position: vec3f,
    @location(1) normal: vec3f,
#ifdef UV0
    @location(2) uv: vec2f,
#endif
#ifdef VERTEX_COLOR
    @location(5) vertex_color: vec4f,
#endif
}

struct VertexOut {
    @builtin(position) clip: vec4f,
    /// The position relative to the camera.
    @location(0) relative: vec3f,
    @location(1) normal: vec3f,
    @location(2) @interpolate(flat, either) material: u32,
#ifdef VERTEX_COLOR
    @location(3) vertex_color: vec4f,
#endif
#ifdef UV0
    @location(4) uv: vec2f,
#endif
#ifdef CUSTOM
    /// The object's origin, relative to the camera.
    @location(8) @interpolate(flat, either) origin: vec3f,
#endif
}

#ifdef CUSTOM
/// What a vertex offset function knows of a vertex of the mesh, in the mesh's own space, before
/// the object's transform and instancing move it.
struct VertexInput {
    /// The vertex's position.
    position: vec3f,
    /// The vertex's unit normal.
    normal: vec3f,
    /// The vertex's first texture coordinates.
    uv: vec2f,
}
#endif

/// What a surface function knows of the point of the surface that a pixel shows. Positions and
/// directions are in world space, relative to the camera.
struct SurfaceInput {
    /// The position relative to the camera, which stays precise far from the world's origin.
    relativePosition: vec3f,
#ifdef CUSTOM
    /// The position in the world. Far from the world's origin, it holds fewer digits than
    /// `relativePosition`.
    worldPosition: vec3f,
#endif
    /// The unit normal of the mesh, turned toward the camera on the back faces of double-sided
    /// materials.
    normal: vec3f,
    /// The unit direction from the surface toward the camera.
    viewDirection: vec3f,
    /// The mesh's vertex color when the material takes vertex colors and the mesh has them, else
    /// white.
    vertexColor: vec4f,
#ifdef UV0
    /// The mesh's first texture coordinates.
    uv: vec2f,
#endif
    /// True on the front face of a triangle.
    frontFacing: bool,
}

/// A point of a surface, ready to light. Colors are linear.
struct Surface {
    /// The base color, which the surface reflects.
    baseColor: vec3f,
    /// The opacity, from 0 to 1.
    alpha: f32,
    /// How much the surface acts like a metal, from 0 to 1.
    metalness: f32,
    /// The perceptual roughness, from 0 (a mirror) to 1 (fully matte).
    roughness: f32,
    /// The unit normal that lights the surface, in world space.
    normal: vec3f,
    /// The light that the surface gives off, added after lighting.
    emissive: vec3f,
    /// How much light from all directions reaches the surface, from 0 (none) to 1 (all).
    occlusion: f32,
}

/// The surface as the material's own values make it: its base color times the vertex color, its
/// metalness, roughness and emissive light, and the normal of the mesh, or of each face with flat
/// shading.
fn defaultSurface(input: SurfaceInput) -> Surface {
    let m = material_row;
    // A face's normal comes from how the position changes between pixels. The two GPU paths count
    // pixel rows in opposite directions, so the normal is turned to face the camera, as three.js's
    // flat normals face it.
    let face = normalize(cross(dpdx(input.relativePosition), dpdy(input.relativePosition)));
    let face_normal = select(-face, face, dot(face, input.viewDirection) >= 0.0);
    let use_face = (u32(m.strengths.z) & FLAT_SHADING) != 0u;
    var s: Surface;
    s.baseColor = m.color.rgb * input.vertexColor.rgb;
    s.alpha = m.color.a * input.vertexColor.a;
    s.metalness = m.surface.x;
    s.roughness = m.surface.y;
    s.normal = select(input.normal, face_normal, use_face);
    s.emissive = m.emissive.rgb * m.strengths.w;
    s.occlusion = 1.0;
    return s;
}

@vertex
fn vs(v: VertexIn, i: InstanceIn) -> VertexOut {
    let found = find_instance(i);
#ifdef CUSTOM
    let origin = relative_position(found, vec3f(0.0));
    fill_builtins(origin);
#endif
#ifdef CUSTOM_UNIFORMS
    material = load_material_uniforms(found.material);
#endif
    var out: VertexOut;
#ifdef CUSTOM_VERTEX_OFFSET
    let offset = vertexOffset(VertexInput(v.position, v.normal, v.uv));
    out.relative = relative_position(found, v.position + offset);
#else
    out.relative = relative_position(found, v.position);
#endif
    out.clip = clip_of(found, out.relative);
    out.normal = world_normal(found, v.normal);
    out.material = found.material;
#ifdef VERTEX_COLOR
    out.vertex_color = v.vertex_color;
#endif
#ifdef UV0
    out.uv = v.uv;
#endif
#ifdef CUSTOM
    out.origin = origin;
#endif
    return out;
}

/// The light that a surface reflects toward the camera from the scene's lights: the sun and the
/// ambient light. `to_view` points from the surface toward the camera, and `dfg` holds the
/// split-sum terms at the surface's roughness and view angle.
fn light_surface(m: PbrMaterial, normal: vec3f, to_view: vec3f, dfg: vec2f) -> vec3f {
    let compensation = multiscatter_compensation(m.specular_blended, dfg);
    let sun = direct_light(
        m,
        normal,
        to_view,
        -engine_frame.sun_direction.xyz,
        engine_frame.sun_color.rgb,
        compensation,
    );
    let ambient = indirect_diffuse(m, engine_frame.ambient.rgb, dfg);
    return sun.diffuse + sun.specular + ambient;
}

/// The color of a pixel that shows the surface: the light it reflects and the light it gives off.
fn shade(s: Surface, input: SurfaceInput) -> vec4f {
    let normal = normalize(s.normal);
    // Where the normal changes fast between pixels, highlights soften, as three.js softens them.
    let change = max(abs(dpdx(normal)), abs(dpdy(normal)));
    let geometry_roughness = max(max(change.x, change.y), change.z);
    let pbr = pbr_material(s.baseColor, s.metalness, s.roughness, geometry_roughness);
    let n_dot_v = saturate(dot(normal, input.viewDirection));
    let dfg = dfg_lut(n_dot_v, pbr.roughness);
    let outgoing = light_surface(pbr, normal, input.viewDirection, dfg) + s.emissive;
    return vec4f(linear_to_srgb(outgoing), 1.0);
}

@fragment
fn fs(in: VertexOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
    material_row = material_of(in.material);
#ifdef CUSTOM
    fill_builtins(in.origin);
#endif
#ifdef CUSTOM_UNIFORMS
    material = load_material_uniforms(in.material);
#endif
    var input: SurfaceInput;
    input.relativePosition = in.relative;
    // Back faces draw only for double-sided materials, and light as front faces do.
    input.normal = normalize(in.normal) * select(-1.0, 1.0, front);
    // Toward the camera: from the point for a perspective camera, and one direction for an
    // orthographic camera, whose view rays are parallel.
    let eye = engine_frame.camera_position;
    input.viewDirection = normalize(eye.xyz - in.relative * eye.w);
    input.vertexColor = vec4f(1.0);
#ifdef VERTEX_COLOR
    input.vertexColor = in.vertex_color;
#endif
#ifdef CUSTOM
    input.worldPosition = in.relative + engine_frame.camera_world.xyz;
#endif
#ifdef UV0
    input.uv = in.uv;
#endif
    input.frontFacing = front;
#ifdef CUSTOM_SURFACE
    let s = surface(input);
#else
    let s = defaultSurface(input);
#endif
    return shade(s, input);
}
