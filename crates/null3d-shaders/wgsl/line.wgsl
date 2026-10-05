enable draw_index;

// Wide lines: the rows of a line batch drawn as quads with round ends, as three.js's Line2 and
// LineSegments2 draw them with a LineMaterial. Each row's world matrix holds one segment packed, as
// null3d_core::lines lays it out: the middle relative to the camera in the last column, the half
// segment in the first, and the end colors, the distance along the line, the width and the look
// bits as tiny values in the other two.
//
// The mesh is three.js's segment geometry with its corners coded within one unit of the origin, so
// that culling's sphere fits the segment: x is the side of the line, and y says which end and
// whether the corner belongs to that end's cap. Each corner moves away from its end point as three.js
// moves it. A width in CSS pixels offsets the corner on the screen, at right angles to the segment,
// and out along it for a cap; the fragments of a cap outside a half disc draw nothing, so the ends
// and the joins of a line are round. A width in world units moves the corner in the world instead,
// across the segment and toward the camera, and each fragment draws when the view ray through it
// passes the segment within half the width.
//
// Dashes follow the line's length before the segment, scaled by the material's dash scale: a
// fragment draws while the length plus the dash offset, modulo a dash and a gap, lies within the
// dash. Dashed lines have no caps, as in three.js. The material's custom values hold the dash
// size, the gap size, the dash scale and the dash offset. The color is the material's color times
// the segment's color at the nearer end, and a blended material writes premultiplied color.
#import null3d::color::{srgb_to_linear}
#import null3d::mesh::{InstanceIn, custom_value, exposed, find_instance, finish_exposed, fogged}
#import null3d::mesh::{fragment_color}
#import null3d::mesh::{frame as engine_frame, material_of}
#import null3d::vertex::{OUTSIDE_CLIP, mesh_position, to_clip}
#ifdef LIT
#import null3d::globals::{Material}
#import null3d::lighting::{direct_light, dfg_lut, indirect_diffuse, multiscatter_compensation}
#import null3d::lighting::{pbr_material}
#import null3d::lights::{clustered_light}
#endif

/// The factor that undoes the packing of the tiny values: 2^32.
const TINY_INVERSE: f32 = 4294967296.0;
/// The look bit of a width in world units.
const WORLD_UNITS_BIT: u32 = 1u;
/// The look bit of a dashed line.
const DASHED_BIT: u32 = 2u;

/// The vertex attributes that the template reads.
struct VertexIn {
    /// The corner's code: the side in x, and the end and its cap in y.
    @location(0) position: vec3f,
}

struct VertexOut {
    @builtin(position) clip: vec4f,
    /// three.js's coordinates of the segment quad: the side in x, from -1 to 1, and in y, -1 at the
    /// start and 1 at the end, past which the caps reach to -2 and 2.
    @location(0) uv: vec2f,
    /// The material, and the segment's look bits.
    @location(1) @interpolate(flat, either) ids: vec2u,
    /// The segment's linear color.
    @location(2) color: vec3f,
    /// The dash scale times the line's length before the corner's end point.
    @location(3) distance: f32,
    /// The corner's end point relative to the camera, for the fog.
    @location(4) relative: vec3f,
    /// For a width in world units: the corner relative to the camera, the segment's ends, and the
    /// width.
    @location(5) world: vec3f,
    @location(6) world_start: vec3f,
    @location(7) world_end: vec3f,
    @location(8) @interpolate(flat, either) width: f32,
}

/// The color of one end of a segment: three 8-bit sRGB codes in a whole number, decoded.
fn end_color(packed: f32) -> vec3f {
    let bits = u32(round(packed * TINY_INVERSE));
    let codes = vec3u(bits & 255u, (bits >> 8u) & 255u, (bits >> 16u) & 255u);
    return srgb_to_linear(vec3f(codes) / 255.0);
}

@vertex
fn vs(v: VertexIn, i: InstanceIn) -> VertexOut {
    let found = find_instance(i);
    let middle = vec3f(found.row_x.w, found.row_y.w, found.row_z.w);
    let half = vec3f(found.row_x.x, found.row_y.x, found.row_z.x);
    let width = found.row_x.z * TINY_INVERSE;
    let bits = u32(round(found.row_y.z * TINY_INVERSE));
    let code = mesh_position(v.position);
    let at_end = code.y > 0.0;
    let cap = abs(code.y) > 0.5;
    let side = select(1.0, -1.0, code.x < 0.0);
    let m = engine_frame.view_proj;
    let eye = engine_frame.camera_position;

    var out: VertexOut;
    out.ids = vec2u(found.material, bits);
    out.width = width;
    out.uv = vec2f(side, sign(code.y) * select(1.0, 2.0, cap));
    out.color = end_color(select(found.row_x.y, found.row_y.y, at_end));
    let a = middle - half;
    let b = middle + half;
    out.world_start = a;
    out.world_end = b;

    // A segment with one end behind a perspective camera ends just in front of it instead, where
    // its projection still holds: where its clip w reaches three.js's estimate of the near plane.
    // The ends are fractions of the way from the start to the end.
    let clip_a = to_clip(m, a);
    let clip_b = to_clip(m, b);
    let range = engine_frame.camera_range;
    let near = range.x * range.y / (range.x + range.y);
    let at_near = (near - clip_a.w) / (clip_b.w - clip_a.w);
    let perspective = eye.w > 0.5;
    let t_start = select(0.0, at_near, perspective && clip_b.w > 0.0 && clip_a.w <= 0.0);
    let t_end = select(1.0, at_near, perspective && clip_a.w > 0.0 && clip_b.w <= 0.0);
    let t = select(t_start, t_end, at_end);
    let start = mix(a, b, t_start);
    let end = mix(a, b, t_end);
    let clip_start = mix(clip_a, clip_b, t_start);
    let clip_end = mix(clip_a, clip_b, t_end);
    let point = mix(a, b, t);
    let point_clip = mix(clip_a, clip_b, t);
    out.relative = point;
    let dash_scale = custom_value(found.material, 0u).z;
    out.distance = dash_scale * (found.row_z.y * TINY_INVERSE + 2.0 * length(half) * t);

    // A width in world units: the corner moves across the segment, at right angles to the view
    // toward its middle, and toward the camera. Dashed lines have no caps, so their corners stay
    // beside the ends. The depth is the end point's, so that segments meet without gaps.
    let along = normalize(end - start);
    let forward = normalize(mix(start, end, 0.5) * eye.w - eye.xyz * (1.0 - eye.w));
    let up = normalize(cross(along, forward));
    let toward = cross(along, up);
    let hw = 0.5 * width;
    let reach = select(hw, 0.0, (bits & DASHED_BIT) != 0u);
    let out_along = select(-1.0, 1.0, at_end) * along + select(1.0, -1.0, cap) * toward;
    let world = point - side * hw * up + reach * out_along;
    let world_clip = to_clip(m, world);
    let world_depth = point_clip.z / point_clip.w * world_clip.w;

    // A width in CSS pixels: the corner moves on the screen, at right angles to the segment, and
    // out along it for a cap. The frame converts CSS pixels to normalized device coordinates.
    let per_pixel = engine_frame.camera_range.zw;
    let dir = normalize((clip_end.xy / clip_end.w - clip_start.xy / clip_start.w) / per_pixel);
    let out_dir = select(vec2f(0.0), select(-dir, dir, at_end), cap);
    let offset = (vec2f(dir.y, -dir.x) * side + out_dir) * 0.5 * width * per_pixel;

    let world_units = (bits & WORLD_UNITS_BIT) != 0u;
    let clip = select(
        vec4f(point_clip.xy + offset * point_clip.w, point_clip.zw),
        vec4f(world_clip.xy, world_depth, world_clip.w),
        world_units,
    );
    out.world = select(point, world, world_units);
    out.clip = select(OUTSIDE_CLIP, clip, found.drawn);
    return out;
}

/// The parameters along the segment from `p1` to `p2` and along the ray from `p3` to `p4` of
/// their closest points, each clamped to its own length, as three.js finds them.
fn closest_line_to_line(p1: vec3f, p2: vec3f, p3: vec3f, p4: vec3f) -> vec2f {
    let p13 = p1 - p3;
    let p43 = p4 - p3;
    let p21 = p2 - p1;
    let d1343 = dot(p13, p43);
    let d4321 = dot(p43, p21);
    let d1321 = dot(p13, p21);
    let d4343 = dot(p43, p43);
    let d2121 = dot(p21, p21);
    let denom = d2121 * d4343 - d4321 * d4321;
    let numer = d1343 * d4321 - d1321 * d4343;
    let mua = clamp(numer / denom, 0.0, 1.0);
    let mub = clamp((d1343 + d4321 * mua) / d4343, 0.0, 1.0);
    return vec2f(mua, mub);
}

#ifdef LIT
/// The light that a line reflects toward the camera, as a standard material with the line's color
/// reflects it from a surface that faces the camera: the sun, the point and spot lights of its
/// cluster and the ambient light, plus the light it gives off. `relative` is the point on the line
/// relative to the camera. The frame's lights are exposed, and the light it gives off takes the
/// exposure here.
fn lit_color(m: Material, base: vec3f, relative: vec3f) -> vec3f {
    let eye = engine_frame.camera_position;
    let normal = normalize(eye.xyz - relative * eye.w);
    let pbr = pbr_material(base, m.surface.x, m.surface.y, 0.0);
    let dfg = dfg_lut(1.0, pbr.roughness);
    let compensation = multiscatter_compensation(pbr.specular_blended, dfg);
    let to_light = -engine_frame.sun_direction.xyz;
    let sun = direct_light(pbr, normal, normal, to_light, engine_frame.sun_color.rgb, compensation);
    let clustered = clustered_light(pbr, relative, normal, normal, compensation);
    let ambient = indirect_diffuse(pbr, engine_frame.ambient.rgb, dfg);
    let direct = sun.diffuse + sun.specular + clustered.diffuse + clustered.specular;
    return direct + ambient + exposed(m.emissive.rgb * m.strengths.w);
}
#endif

/// `x` modulo `y`, rounded toward minus infinity as GLSL's `mod` rounds it.
fn modulo(x: f32, y: f32) -> f32 {
    return x - y * floor(x / y);
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4f {
    let id = in.ids.x;
    let bits = in.ids.y;
    let m = material_of(id);
    let dashed = (bits & DASHED_BIT) != 0u;
    if dashed {
        // Dash size, gap size, dash scale and dash offset.
        let dash = custom_value(id, 0u);
        if in.uv.y < -1.0 || in.uv.y > 1.0 {
            discard;
        }
        if modulo(in.distance + dash.w, dash.x + dash.y) > dash.x {
            discard;
        }
    }
    if (bits & WORLD_UNITS_BIT) != 0u {
        // The closest points of the view ray through the fragment and of the segment.
        let eye = engine_frame.camera_position;
        let ray_start = select(in.world + eye.xyz * 1e5, vec3f(0.0), eye.w > 0.5);
        let ray_end = select(in.world - eye.xyz * 1e5, normalize(in.world) * 1e5, eye.w > 0.5);
        let line = in.world_end - in.world_start;
        let t = closest_line_to_line(in.world_start, in.world_end, ray_start, ray_end);
        let gap = in.world_start + line * t.x - mix(ray_start, ray_end, t.y);
        if !dashed && length(gap) / in.width > 0.5 {
            discard;
        }
    } else if abs(in.uv.y) > 1.0 {
        let a = in.uv.x;
        let b = select(in.uv.y + 1.0, in.uv.y - 1.0, in.uv.y > 0.0);
        if a * a + b * b > 1.0 {
            discard;
        }
    }
    var shaded = m.color.rgb * in.color;
#ifdef LIT
    shaded = lit_color(m, shaded, in.relative);
#else
    shaded = exposed(shaded);
#endif
    let finished = finish_exposed(fogged(shaded, in.relative, m), in.clip.xy);
    return fragment_color(m, finished.rgb, m.color.a);
}
