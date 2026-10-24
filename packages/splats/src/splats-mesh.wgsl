// The draw of the splats of a glTF primitive: one quad per splat, with the splat's own values in
// the mesh's vertex attributes, as KHR_gaussian_splatting stores them. The vertex shader turns the
// quad into a camera-facing card that covers the splat's projected ellipse, and the fragment fades
// it with the same ellipse, so each splat is a soft Gaussian in its own color.
//
// A glTF model draws as one object for each part of the model, which the transparent pass sorts by
// depth. The splats inside a part draw in the file's order: the add-on's own files draw through an
// instance batch, whose rows the engine sorts one by one.

#import null3d::builtins::{camera, fill_builtins, frame}
#import null3d::mesh::{InstanceIn, clip_of, find_instance, finish, relative_position, world_direction}
#import null3d::vertex::{mesh_position}

// The radius, in standard deviations, that a splat's card covers.
const EXTENT: f32 = 3.3;
// The square pixels of blur that every splat gains, so a tiny splat still covers a pixel.
const BLUR: f32 = 0.09;

struct Varyings {
    @builtin(position) clip: vec4f,
    // The pixel offset of this point from the splat's center.
    @location(0) offset: vec2f,
    // The inverse of the splat's 2D covariance: [a, b; b, c].
    @location(1) @interpolate(flat, either) conic: vec3f,
    // The splat's linear color and opacity.
    @location(2) @interpolate(flat, either) color: vec4f,
}

// A direction turned by the unit quaternion `q`.
fn turned(q: vec4f, v: vec3f) -> vec3f {
    let u = q.xyz;
    let s = q.w;
    return 2.0 * (dot(u, v) * u + s * cross(u, v)) + (s * s - dot(u, u)) * v;
}

@vertex
fn vs(
    @location(0) position: vec3f,
    @location(1) normal: vec3f,
    @location(2) uv0: vec2f,
    @location(4) tangent: vec4f,
    @location(5) color: vec4f,
    i: InstanceIn,
) -> Varyings {
    let found = find_instance(i);
    let center = relative_position(found, mesh_position(position));
    fill_builtins(relative_position(found, vec3f(0.0)));
    // The splat's covariance axes in its own space: the quaternion turns each of the three spreads.
    let local_x = turned(tangent, vec3f(normal.x, 0.0, 0.0));
    let local_y = turned(tangent, vec3f(0.0, normal.y, 0.0));
    let local_z = turned(tangent, vec3f(0.0, 0.0, normal.z));
    let world_x = world_direction(found, local_x);
    let world_y = world_direction(found, local_y);
    let world_z = world_direction(found, local_z);
    let view = camera.view;
    let center_view = (view * vec4f(center, 1.0)).xyz;
    let depth = -center_view.z;
    var out: Varyings;
    out.offset = vec2f(0.0);
    out.conic = vec3f(0.0);
    out.color = color;
    out.clip = clip_of(found, center);
    if (depth <= camera.near) {
        return out;
    }
    let res = frame.resolution;
    let fx = camera.projection[0][0] * res.x * 0.5 / depth;
    let fy = camera.projection[1][1] * res.y * 0.5 / depth;
    // The perspective derivative, with y pointing down the screen as the pixels count.
    let jx = vec3f(fx, 0.0, -fx * center_view.x / depth);
    let jy = vec3f(0.0, -fy, fy * center_view.y / depth);
    let va = (view * vec4f(world_x, 0.0)).xyz;
    let vb = (view * vec4f(world_y, 0.0)).xyz;
    let vc = (view * vec4f(world_z, 0.0)).xyz;
    let ca = vec2f(dot(jx, va), dot(jy, va));
    let cb = vec2f(dot(jx, vb), dot(jy, vb));
    let cc = vec2f(dot(jx, vc), dot(jy, vc));
    let sxx = ca.x * ca.x + cb.x * cb.x + cc.x * cc.x + BLUR;
    let sxy = ca.x * ca.y + cb.x * cb.y + cc.x * cc.y;
    let syy = ca.y * ca.y + cb.y * cb.y + cc.y * cc.y + BLUR;
    let det = sxx * syy - sxy * sxy;
    if (det <= 1e-12) {
        return out;
    }
    out.conic = vec3f(syy, -sxy, sxx) / det;
    let corner = uv0 * 2.0 - 1.0;
    out.offset = EXTENT * (corner.x * ca + corner.y * cb);
    // The card lies in the camera's plane, with the offset in world units at the splat's depth.
    let right = vec3f(view[0][0], view[1][0], view[2][0]);
    let up = vec3f(view[0][1], view[1][1], view[2][1]);
    let meters = 2.0 * depth / (camera.projection[1][1] * res.y);
    let place = center + (right * out.offset.x - up * out.offset.y) * meters;
    out.clip = clip_of(found, place);
    return out;
}

@fragment
fn fs(in: Varyings) -> @location(0) vec4f {
    fill_builtins(vec3f(0.0));
    let d = in.offset;
    let power = 0.5 * (in.conic.x * d.x * d.x + 2.0 * in.conic.y * d.x * d.y + in.conic.z * d.y * d.y);
    let alpha = clamp(in.color.a * exp(-power), 0.0, 1.0);
    var out = finish(in.color.rgb, in.clip.xy);
    out.a = alpha;
    return out;
}
