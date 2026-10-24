// The water's surface: long waves that the current carries, finer ripples in the normal, a mirror of
// the banks and the sky, caustics on the bed, foam where the water breaks, and a shore that fades
// where the bed rises to meet the surface. The scene's own depth behind each pixel gives the water
// its depth, so a shore ends softly against the bed instead of on the mesh's edge. The same surface
// draws from below, where it shows the world above through a window overhead and turns the light
// back past that window's edge.
#import null3d::noise::{value2}
#import null3d::reflection::{reflection_uv}

struct Uniforms {
    // How tall the ripples stand, as a factor of their base height.
    ripple: f32,
    // The meters of the gap to the bed over which the water fades to nothing at a shore.
    softness: f32,
    // The light that the ripples focus on the bed, a linear color whose brightness is its strength.
    caustics: vec3f,
    // The world point and the size in meters that the foam map covers.
    foamOrigin: vec2f,
    foamSize: vec2f,
}

// The mirrored view of the scene above the water, which the reflection pass draws.
var mirror: texture_2d<f32>;
// How near each point lies to something that breaks the surface, in its red channel.
var foamMap: texture_2d<f32>;

/// Caustics: bright, thin ridges where the ripples focus the light, which drift with the current.
fn caustics(p: vec2f, t: f32, current: vec2f) -> f32 {
    let q = p * 4.6 + current * (t * 4.0);
    let a = sin(q.x * 3.1 + t * 1.3 + sin(q.y * 2.3 - t));
    let b = sin(q.y * 3.7 - t * 1.1 + sin(q.x * 1.9 + t * 0.7));
    let c = sin((q.x + q.y) * 2.6 + t * 0.9 + sin(q.x * 1.3 - q.y * 0.7));
    let v = (a + b + c) / 3.0;
    // Patches of brighter and fainter light keep the net from looking even.
    return pow(1.0 - abs(v), 14.0) * (0.35 + 0.65 * value2(p * 0.8 + vec2f(t * 0.1, 0.0)));
}

/// The cosine of the angle from straight up, under the water, inside which the world above shows:
/// past it the surface turns every ray back down, as total internal reflection does.
const WINDOW: f32 = 0.66;

/// The current at a point: its direction in the first texture coordinate's second vector, and its
/// speed in the first coordinate's x. The mesh carries both.
fn current_of(uv: vec2f, uv1: vec2f) -> vec3f {
    return vec3f(uv1 * 2.0 - vec2f(1.0), uv.x);
}

/// The water's height at a point, and its slopes along x and z: long waves that the current carries
/// downstream, and with `fine` set, shorter ripples across them.
fn waves(p: vec2f, t: f32, current: vec3f, fine: bool) -> vec3f {
    // Each wave: its direction, its wave number, and how fast it runs against the current.
    let list = array<vec4f, 6>(
        vec4f(1.0, 0.15, 2.3, 0.9),
        vec4f(0.8, -0.6, 3.7, 0.7),
        vec4f(0.6, 0.8, 5.9, 0.5),
        vec4f(1.0, -0.25, 11.0, 1.2),
        vec4f(-0.3, 1.0, 17.0, 0.6),
        vec4f(0.9, 0.45, 29.0, 1.6),
    );
    var h = 0.0;
    var slope = vec2f(0.0);
    let count = select(3u, 6u, fine);
    for (var k = 0u; k < count; k++) {
        let w = list[k];
        let dir = normalize(w.xy);
        let amplitude = material.ripple * 0.05 / w.z;
        let phase = w.z * (dot(dir, p) - current.z * t * dot(current.xy, dir)) - w.w * t;
        h += amplitude * sin(phase);
        slope += dir * (amplitude * w.z * cos(phase));
    }
    return vec3f(h, slope);
}

fn vertexOffset(input: VertexInput) -> vec3f {
    let current = current_of(input.uv, input.uv1);
    return vec3f(0.0, waves(input.position.xz, frame.time, current, false).x, 0.0);
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
    let current = current_of(input.uv, input.uv1);
    let w = waves(p, frame.time, current, true);
    s.normal = normalize(vec3f(-w.y, 1.0, -w.z));
    let clip = camera.viewProjection * vec4f(input.relativePosition, 1.0);
    let mirrorUv = reflection_uv(clip, w.yz * 0.08);
    s.reflection = vec4f(textureSampleLevel(mirror, mirrorSampler, mirrorUv, 0.0).rgb, 1.0);
    // The water's depth: the gap between the sheet and the geometry behind the pixel along the view
    // ray, from the copy of the opaque scene's depth. The depth below the surface is that gap
    // measured against the view's slope.
    let place = input.fragCoord.xy / frame.resolution;
    let gap = max(sceneDistance(place) - distance_of(input.fragCoord.z), 0.0);
    let depth = gap * abs(input.viewDirection.y);
    s.thickness = max(depth, 0.02);
    // Shallow water at the edges carries a little foam.
    let edgeFoam = (1.0 - smoothstep(0.0, 0.05, depth)) * smoothstep(0.0, 0.03, w.x + 0.012);
    // Foam around the stones: the map holds how near each point lies to a stone, stretched
    // downstream, and moving noise breaks it into flecks that the current carries away.
    let foamUv = (p - material.foamOrigin) / material.foamSize;
    let near = textureSampleLevel(foamMap, foamMapSampler, foamUv, 0.0).r;
    let drift = p * vec2f(5.0, 9.0) - current.xy * (current.z * frame.time * 6.0);
    let flecks = 0.6 * value2(drift) + 0.4 * value2(drift * 2.3 + 7.0);
    let stoneFoam = 0.85 * smoothstep(0.45, 0.95, near * (0.3 + 1.0 * flecks));
    let foam = max(edgeFoam, stoneFoam);
    s.baseColor = mix(s.baseColor, vec3f(0.8), foam);
    s.roughness = mix(s.roughness, 0.6, foam);
    if !input.frontFacing {
        // Seen from under the water: the world above shows through, bent by the ripples, clearest in
        // a window overhead and dimmer past its edge, where the surface turns some of the light back
        // down as a faint mirror of the water. The planar reflection holds the world above the
        // water, so it takes no part here.
        s.normal = -s.normal;
        let overhead = max(input.viewDirection.y * -1.0, 0.0);
        let window = smoothstep(WINDOW - 0.05, WINDOW + 0.05, overhead);
        s.reflection = vec4f(0.0);
        s.thickness = 0.05;
        s.transmission = mix(0.8, 1.0, window) * (1.0 - 0.7 * foam);
        s.baseColor = mix(vec3f(0.08, 0.16, 0.15), s.baseColor, window);
        s.alpha = 1.0;
        return s;
    }
    // The caustics show on the bed, under clear water that is not too deep, and not under foam.
    let bed = p + w.yz * depth * 0.6;
    let reach = smoothstep(0.02, 0.15, depth) * exp(-depth * 1.4) * (1.0 - foam);
    s.emissive += material.caustics * caustics(bed, frame.time, current.xy * current.z) * reach;
    s.transmission = 1.0 - 0.7 * foam;
    // The soft shore: the water fades to nothing as its gap to the bed closes, so its edge lies in a
    // band against the bed rather than on the mesh's own edge.
    s.alpha = smoothstep(0.0, material.softness, gap);
    return s;
}
