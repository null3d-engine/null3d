// The ocean's surface: the heights that the transform chain wrote, summed over the bands and sampled
// at each band's own scale, give the waves that move the surface's vertices and the slopes that light
// it. A mirror of the sky and the far shore bends with those slopes, foam breaks on the crests, and
// the water fades where the bed behind it rises to meet the surface. Each band is a layer of the
// texture that `bands.wgsl` writes: red holds its height in meters, and green and blue its slopes.
#import null3d::noise::{value2}
#import null3d::reflection::{reflection_uv}

struct Uniforms {
    // The meters that one tile of each band covers, in band order.
    tiles: vec3f,
    // The height at which foam starts to break, in meters.
    foam: f32,
    // The bands that the sea holds: two or three.
    count: f32,
    // The meters of the gap to the bed over which the water fades to nothing at a shore.
    softness: f32,
}

// The three bands of the sea, a layer each, and the mirror of the scene above the water.
var bands: texture_2d_array<f32>;
var mirror: texture_2d<f32>;

/// The meters that a band's tile covers.
fn band_tile(band: u32) -> f32 {
    if (band == 0u) { return material.tiles.x; }
    if (band == 1u) { return material.tiles.y; }
    return material.tiles.z;
}

/// The place of a world point on a band's tile, from 0 at its near corner and wrapping around it.
fn band_uv(p: vec2f, band: u32) -> vec2f {
    return fract(p / band_tile(band));
}

/// A band's height at a world point, in meters.
fn band_height(p: vec2f, band: u32) -> f32 {
    return textureSampleLevel(bands, bandsSampler, band_uv(p, band), band, 0.0).x;
}

/// The sea's height at a world point, in meters, and the slopes along x and z that the bands add.
fn sea(p: vec2f) -> vec3f {
    var height = 0.0;
    var slope = vec2f(0.0);
    for (var band = 0u; band < u32(material.count); band = band + 1u) {
        let texel = textureSampleLevel(bands, bandsSampler, band_uv(p, band), band, 0.0);
        height += texel.x;
        slope += texel.yz;
    }
    return vec3f(height, slope);
}

fn vertexOffset(input: VertexInput) -> vec3f {
    // The mesh holds the camera's own place, so a vertex's world place is the object's origin with
    // the vertex's place in the mesh.
    let p = object.position.xz + input.position.xz;
    var height = 0.0;
    for (var band = 0u; band < u32(material.count); band = band + 1u) {
        height += band_height(p, band);
    }
    return vec3f(0.0, height, 0.0);
}

/// The distance in front of the camera of a depth value, as sceneDistance converts the copy's.
fn distance_of(depth: f32) -> f32 {
    let near = engine_frame.camera_range.x;
    let far = engine_frame.camera_range.y;
    if engine_frame.camera_position.w > 0.5 {
        return near * far / (near + depth * (far - near));
    }
    return far - depth * (far - near);
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let p = input.worldPosition.xz;
    let wave = sea(p);
    s.normal = normalize(vec3f(-wave.y, 1.0, -wave.z));
    let clip = camera.viewProjection * vec4f(input.relativePosition, 1.0);
    let mirrorUv = reflection_uv(clip, vec2f(wave.y, wave.z) * 0.06);
    s.reflection = vec4f(textureSampleLevel(mirror, mirrorSampler, mirrorUv, 0.0).rgb, 1.0);
    // The water's depth: the gap between the sheet and the geometry behind the pixel along the view
    // ray, from the copy of the opaque scene's depth.
    let place = input.fragCoord.xy / frame.resolution;
    let gap = max(sceneDistance(place) - distance_of(input.fragCoord.z), 0.0);
    let depth = gap * abs(input.viewDirection.y);
    s.thickness = max(depth, 0.02);
    // Foam breaks on the crests, in patches that the noise tears apart so the line is not even.
    let crest = smoothstep(material.foam, material.foam * 1.7, wave.x);
    let flecks = 0.55 * value2(p * 0.7 + vec2f(frame.time * 0.15, 0.0))
        + 0.45 * value2(p * 1.9 - vec2f(0.0, frame.time * 0.11));
    let foam = crest * smoothstep(0.35, 0.75, flecks);
    s.baseColor = mix(s.baseColor, vec3f(0.82), foam);
    s.roughness = mix(s.roughness, 0.55, foam);
    s.transmission = 1.0 - 0.8 * foam;
    // The soft shore: the water fades to nothing as its gap to the bed closes, so its edge lies in a
    // band against the bed rather than on the mesh's own edge.
    s.alpha = smoothstep(0.0, material.softness, gap);
    return s;
}
