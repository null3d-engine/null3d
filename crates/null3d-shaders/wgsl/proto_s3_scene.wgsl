// Prototype S3 (not for merging): the scene of the AO prototype page, drawn by instance. Each
// instance is a unit mesh (a sphere or a box) moved to its place and stretched by its size.
//
// - `prepass` draws depth only, at the render size, as the engine's depth prepass does.
// - `structure` draws the distance to the camera into a small `r16float` target: the separate
//   depth pass that Filament calls the structure pass.
// - `lit` shades with ambient and sun light. Shader defs pick how it reads ambient occlusion:
//   none, one filtered read (UPSAMPLE_BILINEAR), or four texels weighted by depth
//   (UPSAMPLE_DEPTH). CONTACT adds contact shadows for the sun: a short march toward the sun
//   through the AO-size depth.
//
// Rows: WebGPU counts texture rows and fragment rows from the top, and WebGL2 from the bottom.
// Every pass reads textures at its own fragment rows, so only the step between texture rows and
// view space needs the direction, which the row sign gives.

struct Scene {
    view_projection: mat4x4f,
    view: mat4x4f,
    projection: mat4x4f,
    /// xyz: the direction toward the sun in view space. w: the sun's strength.
    sun: vec4f,
    /// x: near plane, y: far plane, zw: the render size in pixels.
    camera: vec4f,
    /// x: the row sign, 1 where rows count from the top and -1 from the bottom. y: 1 to show the
    /// ambient occlusion alone. zw: the AO targets' size in texels.
    view_info: vec4f,
    /// x: the march's length in meters, y: the thickness behind a depth that hides the ray,
    /// z: the bias in meters, w: unused.
    contact: vec4f,
}

@group(0) @binding(0) var<uniform> scene: Scene;
/// The ambient occlusion: occlusion in red and the distance it was found at in green.
@group(0) @binding(1) var ao_map: texture_2d<f32>;
@group(0) @binding(2) var ao_sampler: sampler;
/// The distance to the camera at the AO size: the depth input of the AO passes.
@group(0) @binding(3) var ao_depth: texture_2d<f32>;

struct VertexIn {
    @location(0) position: vec3f,
    @location(1) normal: vec3f,
}

struct InstanceIn {
    @location(2) place: vec4f,
    @location(3) size: vec4f,
    @location(4) color: vec4f,
}

struct VertexOut {
    @invariant @builtin(position) clip: vec4f,
    @location(0) view_position: vec3f,
    @location(1) view_normal: vec3f,
    @location(2) color: vec3f,
}

@vertex
fn vs(v: VertexIn, i: InstanceIn) -> VertexOut {
    let world = vec4f(i.place.xyz + v.position * i.size.xyz, 1.0);
    let normal = normalize(v.normal / i.size.xyz);
    var out: VertexOut;
    out.clip = scene.view_projection * world;
    out.view_position = (scene.view * world).xyz;
    out.view_normal = (scene.view * vec4f(normal, 0.0)).xyz;
    out.color = i.color.rgb;
    return out;
}

@fragment
fn fs_empty() {
}

@fragment
fn fs_structure(in: VertexOut) -> @location(0) vec4f {
    return vec4f(-in.view_position.z, 0.0, 0.0, 1.0);
}

/// Interleaved gradient noise, fixed per pixel.
fn ign(pixel: vec2f) -> f32 {
    return fract(52.9829189 * fract(dot(floor(pixel), vec2f(0.06711056, 0.00583715))));
}

/// The ambient occlusion at a pixel from the four AO texels around it, each weighted by how close
/// its distance lies to the pixel's, within 3%. Where none lies near, the nearest in distance
/// speaks for the pixel. This is the engine's upsample (null3d::gtao).
fn depth_aware(pixel: vec2f, distance: f32) -> f32 {
    let size = vec2i(scene.view_info.zw);
    let at = pixel * scene.view_info.zw / scene.camera.zw - 0.5;
    let base = vec2i(floor(at));
    let blend = at - floor(at);
    var sum = 0.0;
    var total = 0.0;
    var nearest = 1.0;
    var nearest_gap = 1e30;
    for (var k = 0; k < 4; k++) {
        let offset = vec2i(k & 1, k >> 1u);
        let texel = clamp(base + offset, vec2i(0), size - 1);
        let held = textureLoad(ao_map, texel, 0).xy;
        let along = mix(1.0 - blend, blend, vec2f(offset));
        let gap = abs(held.y - distance);
        let weight = along.x * along.y * max(0.0, 1.0 - gap / (0.03 * distance));
        sum += held.x * weight;
        total += weight;
        if gap < nearest_gap {
            nearest_gap = gap;
            nearest = held.x;
        }
    }
    return select(nearest, sum / total, total > 1e-4);
}

/// Contact shadows: 8 steps from the surface toward the sun, each read from the AO-size depth.
/// The sun is hidden where a step lies behind the depth there by less than the thickness.
fn contact_shadow(position: vec3f, normal: vec3f, pixel: vec2f) -> f32 {
    let steps = 8;
    let start = position + normal * scene.contact.z;
    let jitter = ign(pixel);
    let size = scene.view_info.zw;
    for (var s = 0; s < steps; s++) {
        let t = (f32(s) + jitter) / f32(steps);
        let ray = start + scene.sun.xyz * (scene.contact.x * t);
        let clip = scene.projection * vec4f(ray, 1.0);
        let ndc = clip.xy / clip.w;
        let uv = vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5 * scene.view_info.x);
        if any(uv < vec2f(0.0)) || any(uv >= vec2f(1.0)) {
            break;
        }
        let held = textureLoad(ao_depth, vec2i(uv * size), 0).x;
        let behind = -ray.z - held;
        if held > 0.0 && behind > scene.contact.z && behind < scene.contact.y {
            // Fade toward the screen's edges, as Filament does.
            let edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
            return 1.0 - clamp(edge * 20.0, 0.0, 1.0);
        }
    }
    return 1.0;
}

@fragment
fn fs_lit(in: VertexOut) -> @location(0) vec4f {
    var normal = normalize(in.view_normal);
    let distance = -in.view_position.z;
    var occlusion = 1.0;
#ifdef UPSAMPLE_BILINEAR
    occlusion = textureSampleLevel(ao_map, ao_sampler, in.clip.xy / scene.camera.zw, 0.0).x;
#endif
#ifdef UPSAMPLE_DEPTH
    occlusion = depth_aware(in.clip.xy, distance);
#endif
    var sun = max(dot(normal, scene.sun.xyz), 0.0) * scene.sun.w;
#ifdef CONTACT
    if sun > 0.0 {
        sun *= contact_shadow(in.view_position, normal, in.clip.xy);
    }
#endif
    // Sky light from above, ground light from below.
    let up = (scene.view * vec4f(0.0, 1.0, 0.0, 0.0)).xyz;
    let sky = mix(vec3f(0.25, 0.22, 0.2), vec3f(0.55, 0.65, 0.8), dot(normal, up) * 0.5 + 0.5);
    let shaded = in.color * (sky * occlusion + vec3f(1.0, 0.95, 0.85) * sun);
    // A simple tone curve, then sRGB. The occlusion alone shows as it is.
    let mapped = shaded / (1.0 + shaded);
    let encoded = pow(mapped * 1.6, vec3f(1.0 / 2.2));
    return vec4f(mix(encoded, vec3f(occlusion), scene.view_info.y), 1.0);
}
