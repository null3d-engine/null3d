// Particles: each particle of a system is one 32-byte record that the sketch's thread writes once,
// when the particle is born, and the vertex shader works out where the particle is and how it looks
// at its age in every frame, in closed form. No pass simulates the particles, so the same builds
// draw them on WebGPU and WebGL2, and a frame at a given time looks the same whatever frames came
// before it.
//
// A record holds the particle's birth place relative to the system's object, its birth time in the
// system's seconds, its start velocity, its lifetime as a 16-bit float and a 16-bit seed. The
// motion is exact for gravity and linear drag toward the wind: the velocity eases toward the wind
// plus gravity over the drag. Turbulence moves each particle by the change of a vector of simplex
// noise along its way, so it starts at its birth place and wanders as it ages. A ground plane can
// end a particle, stop it or bounce it up to twice: the shader finds each impact time with Newton's
// method on the height. Colour and alpha follow a curve over the particle's life, times one of two
// start colours that the seed mixes; the size follows a curve too. The quad faces the camera, lies
// along the velocity, lies flat on the ground, or tumbles freely. The MAP builds read a frame of a
// flipbook atlas from the material's map, blending neighbouring frames; the others draw a soft
// round dot. Soft particles fade where they near the opaque depth behind them, from a copy of the
// view's depth, and every particle fades near the camera.
#import null3d::globals::Frame
#import null3d::tonemap
#import null3d::fog::{fog_color, fog_factor}
#import null3d::sky_scattering::{aerial_perspective, aerial_through}
#import null3d::noise::{pcg, simplex3, to_unit}
#import null3d::depth::{linear_depth, orthographic_depth_to_view_z}

/// A system's values, which change when the sketch changes the system (see the renderer's
/// `particles` module for the layout).
struct Params {
    /// Gravity in the object's space, in m/s², and the drag in 1/s.
    motion: vec4f,
    /// The wind that drag pulls toward, in m/s, and the turbulence's reach in meters.
    wind: vec4f,
    /// The turbulence's frequency in 1/m and its speed in 1/s, the ground's height in the object's
    /// space, and the ground's mode: 0 none, 1 ends the particle, 2 bounces it, 3 stops it.
    turbulence: vec4f,
    /// The bounce's restitution and friction, the distance over which particles fade near the
    /// camera, and the soft particles' fade distance, 0 for none.
    ground: vec4f,
    /// The smallest and the largest start size, the height over the width, and how much the
    /// velocity stretches a quad that lies along it, in seconds.
    size: vec4f,
    /// The smallest and the largest start rotation in radians, then the smallest and the largest
    /// spin in radians per second.
    spin: vec4f,
    /// The flipbook's columns and rows, its frames, and its frames per second, or 0 to play it
    /// once over each particle's life.
    flipbook: vec4f,
    /// The facing: 0 the camera, 1 along the velocity, 2 flat on the ground, 3 tumbling. Then the
    /// emissive intensity, the opacity and the alpha below which a fragment draws nothing.
    look: vec4f,
    /// The two start colours, linear, which the seed mixes.
    color_a: vec4f,
    color_b: vec4f,
    /// 1 for a random first flipbook frame, 1 to blend neighbouring frames, 1 when the system adds
    /// light, which fog fades rather than tints, and 1 to hold each particle on its first frame.
    flags: vec4f,
    spare: vec4f,
    /// Colour and alpha over life, at 16 even steps from birth to death.
    colors: array<vec4f, 16>,
    /// Size over life, at 16 even steps, four to a vector.
    sizes: array<vec4f, 4>,
}

/// The system in one view: its object's world matrix rows moved by its cell's offset from the
/// view's camera, then the system's time in seconds and its map's layer.
struct View {
    row_x: vec4f,
    row_y: vec4f,
    row_z: vec4f,
    clock: vec4f,
}

@group(0) @binding(0) var<uniform> frame: Frame;
@group(1) @binding(0) var<uniform> params: Params;
@group(1) @binding(1) var<uniform> view: View;
/// A copy of the view's opaque depth, as unfilterable floats, or one texel at the far plane.
@group(2) @binding(0) var scene_depth: texture_2d<f32>;
#ifdef MAP
@group(3) @binding(0) var map_layers: texture_2d_array<f32>;
@group(3) @binding(1) var map_sampler: sampler;
#endif

/// The most bounces a particle makes off the ground.
const BOUNCES: u32 = 2u;
/// Newton steps toward each impact.
const STEPS: u32 = 4u;
/// Drag below which the motion is the plain ballistic one, whose closed form has no division.
const LITTLE_DRAG: f32 = 1e-4;

struct VertexIn {
    /// The birth place in the object's space, and the birth time in the system's seconds.
    @location(0) birth: vec4f,
    /// The start velocity in the object's space.
    @location(1) velocity: vec3f,
    /// The lifetime as a 16-bit float in the high half, and the seed in the low half.
    @location(2) packed: u32,
}

struct VertexOut {
    @builtin(position) clip: vec4f,
    /// The corner's place on the quad, from -1 to 1, then the flipbook frame's place.
    @location(0) corner: vec4f,
    @location(1) color: vec4f,
    /// The frames to blend, and how far toward the second.
    @location(2) @interpolate(flat, either) frames: vec2u,
    @location(3) blend: f32,
    /// The point relative to the camera, for fog and for the soft fade.
    @location(4) relative: vec3f,
}

/// A random number from 0 up to 1 for a particle's seed and a channel.
fn chance(seed: u32, channel: u32) -> f32 {
    return to_unit(pcg(seed ^ (channel * 2654435769u)));
}

/// Where a particle is and how fast it moves, `t` seconds after `p` and `v`, under gravity `g`
/// and drag `k` toward the wind `w`.
struct Motion {
    position: vec3f,
    velocity: vec3f,
}

fn flight(p: vec3f, v: vec3f, t: f32) -> Motion {
    let g = params.motion.xyz;
    let k = params.motion.w;
    var out: Motion;
    if k < LITTLE_DRAG {
        out.position = p + v * t + 0.5 * g * t * t;
        out.velocity = v + g * t;
        return out;
    }
    let terminal = params.wind.xyz + g / k;
    let decay = exp(-k * t);
    out.position = p + terminal * t + (v - terminal) * ((1.0 - decay) / k);
    out.velocity = terminal + (v - terminal) * decay;
    return out;
}

/// The first time after 0 at which a flight from `p` with `v` falls onto the ground, or -1 for
/// none within `limit` seconds.
fn impact(p: vec3f, v: vec3f, limit: f32) -> f32 {
    let ground = params.turbulence.z;
    let g = params.motion.y;
    // The ballistic flight's root starts Newton's method near the drag's.
    let rise = p.y - ground;
    var t = limit;
    let d = v.y * v.y - 2.0 * g * rise;
    if g < 0.0 && d >= 0.0 {
        t = (-v.y - sqrt(d)) / g;
    } else if v.y < 0.0 {
        t = rise / -v.y;
    }
    t = clamp(t, 0.0, limit);
    for (var k = 0u; k < STEPS; k++) {
        let m = flight(p, v, t);
        let fall = min(m.velocity.y, -1e-3);
        t = clamp(t - (m.position.y - ground) / fall, 0.0, limit);
    }
    // A flight that ends near the ground counts only while it falls, so one that bounced up off it
    // does not meet it again at once.
    let end = flight(p, v, t);
    return select(-1.0, t, abs(end.position.y - ground) < 0.01 && t > 0.0 && end.velocity.y < 0.0);
}

/// A vector of simplex noise, each channel from about -1 to 1.
fn wander(q: vec3f) -> vec3f {
    return vec3f(simplex3(q), simplex3(q + vec3f(31.4, 17.3, 5.9)), simplex3(q + vec3f(-11.7, 41.2, 23.5)));
}

/// A particle at age `age`: its place, its velocity, and false when the ground ended it.
struct State {
    position: vec3f,
    velocity: vec3f,
    alive: bool,
}

fn state_at(birth: vec3f, start: vec3f, age: f32, seed: u32) -> State {
    var p = birth;
    var v = start;
    var t = age;
    var out: State;
    out.alive = true;
    let mode = u32(params.turbulence.w);
    if mode != 0u {
        for (var b = 0u; b <= BOUNCES; b++) {
            let hit = impact(p, v, t);
            if hit < 0.0 {
                break;
            }
            let m = flight(p, v, hit);
            if mode == 1u {
                out.alive = false;
                break;
            }
            p = vec3f(m.position.x, params.turbulence.z, m.position.z);
            if mode == 3u || b == BOUNCES {
                v = vec3f(0.0);
                t = 0.0;
                break;
            }
            let keep = 1.0 - params.ground.y;
            v = vec3f(m.velocity.x * keep, -m.velocity.y * params.ground.x, m.velocity.z * keep);
            t -= hit;
        }
    }
    var m = flight(p, v, t);
    if mode == 3u && t == 0.0 {
        m.velocity = vec3f(0.0);
    }
    out.position = m.position;
    out.velocity = m.velocity;
    let reach = params.wind.w;
    if reach > 0.0 {
        let q = birth * params.turbulence.x + vec3f(f32(seed) * 0.013);
        let drift = vec3f(params.turbulence.y * age);
        out.position += reach * (wander(q + drift) - wander(q));
        if mode != 0u {
            out.position.y = max(out.position.y, params.turbulence.z);
        }
    }
    return out;
}

/// A curve of 16 steps at `x` from 0 to 1, read with linear filtering.
fn curve_color(x: f32) -> vec4f {
    let f = clamp(x, 0.0, 1.0) * 15.0;
    let i = min(u32(f), 14u);
    return mix(params.colors[i], params.colors[i + 1u], f - f32(i));
}

fn size_step(i: u32) -> f32 {
    return params.sizes[i / 4u][i % 4u];
}

fn curve_size(x: f32) -> f32 {
    let f = clamp(x, 0.0, 1.0) * 15.0;
    let i = min(u32(f), 14u);
    return mix(size_step(i), size_step(i + 1u), f - f32(i));
}

/// The object's world matrix, relative to the camera, applied to a point or a direction.
fn place(p: vec3f, w: f32) -> vec3f {
    let h = vec4f(p, w);
    return vec3f(dot(view.row_x, h), dot(view.row_y, h), dot(view.row_z, h));
}

@vertex
fn vs(@builtin(vertex_index) vertex: u32, in: VertexIn) -> VertexOut {
    var out: VertexOut;
    out.clip = vec4f(0.0, 0.0, 0.0, 1.0);
    let lifetime = unpack2x16float(in.packed).y;
    let seed = in.packed & 0xffffu;
    let age = view.clock.x - in.birth.w;
    if !(age >= 0.0 && age < lifetime) {
        return out;
    }
    let s = state_at(in.birth.xyz, in.velocity, age, seed);
    if !s.alive {
        return out;
    }
    let life = age / lifetime;
    let center = place(s.position, 1.0);
    let velocity = place(s.velocity, 0.0);

    // The quad's corner: two triangles of the corners (-1, -1) to (1, 1).
    let index = vertex % 6u;
    let k = select(index, 6u - index, index > 2u);
    let corner = vec2f(f32(k & 1u) * 2.0 - 1.0, f32((k >> 1u) & 1u) * 2.0 - 1.0);
    let size = mix(params.size.x, params.size.y, chance(seed, 1u)) * curve_size(life);
    let half_extent = 0.5 * size * vec2f(1.0, params.size.z);
    let angle = mix(params.spin.x, params.spin.y, chance(seed, 2u)) + mix(params.spin.z, params.spin.w, chance(seed, 3u)) * age;
    let c = cos(angle);
    let n = sin(angle);
    let turned = vec2f(c * corner.x - n * corner.y, n * corner.x + c * corner.y) * half_extent;

    // The camera's right and up axes from the view-projection's first two rows.
    let m = frame.view_proj;
    let right = normalize(vec3f(m[0].x, m[1].x, m[2].x));
    let up = normalize(vec3f(m[0].y, m[1].y, m[2].y));
    let toward = normalize(frame.camera_position.xyz - center * frame.camera_position.w);
    var at = center;
    let facing = u32(params.look.x);
    if facing == 1u {
        let speed = length(velocity);
        let along = select(up, velocity / max(speed, 1e-6), speed > 1e-6);
        let across = normalize(cross(along, toward) + vec3f(1e-6, 0.0, 0.0));
        let length_half = half_extent.y + 0.5 * params.size.w * speed;
        at = center + across * corner.x * half_extent.x + along * corner.y * length_half;
    } else if facing == 2u {
        let x = place(vec3f(1.0, 0.0, 0.0), 0.0);
        let z = place(vec3f(0.0, 0.0, 1.0), 0.0);
        at = center + x * turned.x + z * turned.y;
    } else if facing == 3u {
        // A tumbling quad: its axis of turn from the seed, its angle from the spin.
        let axis = normalize(vec3f(chance(seed, 4u), chance(seed, 5u), chance(seed, 6u)) * 2.0 - 1.0 + vec3f(1e-3));
        let bx = place(vec3f(1.0, 0.0, 0.0), 0.0);
        let by = place(vec3f(0.0, 1.0, 0.0), 0.0);
        let local = bx * (corner.x * half_extent.x) + by * (corner.y * half_extent.y);
        let a = place(axis, 0.0);
        let turned_local = local * c + cross(a, local) * n + a * dot(a, local) * (1.0 - c);
        at = center + turned_local;
    } else {
        at = center + right * turned.x + up * turned.y;
    }
    out.clip = m * vec4f(at, 1.0);
    out.relative = at;

    var color = mix(params.color_a, params.color_b, chance(seed, 7u)) * curve_color(life);
    color = vec4f(color.rgb * params.look.y, color.a * params.look.z);
    // Particles fade as they near the camera, so one never fills the view at once.
    let fade_near = params.ground.z;
    if fade_near > 0.0 {
        color.a *= clamp(length(center) / fade_near - 0.25, 0.0, 1.0);
    }
    out.color = color;

    // The flipbook's frames and how far the particle is between them.
    let frames = max(params.flipbook.z, 1.0);
    let start = select(0.0, floor(chance(seed, 8u) * frames), params.flags.x > 0.5);
    var played = select(life * frames, age * params.flipbook.w, params.flipbook.w > 0.0);
    if params.flags.w > 0.5 {
        played = 0.0;
    }
    let position = start + played;
    let first = floor(position);
    out.frames = vec2u(u32(first % frames), u32((first + 1.0) % frames));
    out.blend = select(0.0, position - first, params.flags.y > 0.5);
    out.corner = vec4f(corner, 0.5 * corner.x + 0.5, 0.5 - 0.5 * corner.y);
    return out;
}

#ifdef MAP
/// The map at a frame of the flipbook, with frame 0 the top left one of the image standing
/// upright, and rows of frames counting down.
fn frame_texel(frame_index: u32, uv: vec2f) -> vec4f {
    let columns = u32(max(params.flipbook.x, 1.0));
    let rows = max(params.flipbook.y, 1.0);
    let cell = vec2f(f32(frame_index % columns), rows - 1.0 - f32(frame_index / columns));
    let at = (cell + vec2f(uv.x, 1.0 - uv.y)) / vec2f(f32(columns), rows);
    return textureSample(map_layers, map_sampler, at, u32(view.clock.y));
}
#endif

/// The fade of a soft particle in front of the opaque surface behind it.
fn soft_fade(pixel: vec2f, fragment_depth: f32) -> f32 {
    let distance = params.ground.w;
    if distance <= 0.0 {
        return 1.0;
    }
    // The copy has the scene depth's size, one texel per pixel; the blank copy is one texel.
    let texel = min(vec2u(pixel), textureDimensions(scene_depth) - 1u);
    let behind = textureLoad(scene_depth, texel, 0).x;
    let near = frame.camera_range.x;
    let far = frame.camera_range.y;
    var gap: f32;
    if frame.camera_position.w > 0.5 {
        gap = linear_depth(behind, near, far) - linear_depth(fragment_depth, near, far);
    } else {
        gap = orthographic_depth_to_view_z(fragment_depth, near, far) - orthographic_depth_to_view_z(behind, near, far);
    }
    return clamp(gap / distance, 0.0, 1.0);
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4f {
#ifdef MAP
    let a = frame_texel(in.frames.x, in.corner.zw);
    let b = frame_texel(in.frames.y, in.corner.zw);
    let texel = mix(a, b, in.blend);
#else
    let r = dot(in.corner.xy, in.corner.xy);
    let dot_alpha = clamp(1.0 - r, 0.0, 1.0);
    let texel = vec4f(1.0, 1.0, 1.0, dot_alpha * dot_alpha);
#endif
    var alpha = in.color.a * texel.a * soft_fade(in.clip.xy, in.clip.z);
    if alpha <= params.look.w {
        discard;
    }
    // The fog's and the air's colors are exposed, so they act on exposed light, as on the scene's
    // surfaces. Added light only dims through them: they add no light of their own to it, which
    // each of a cloud's particles would add again.
    var light = in.color.rgb * texel.rgb * frame.output.exposure;
    let factor = fog_factor(frame.fog, in.relative);
    if params.flags.z > 0.5 {
        light *= aerial_through(frame.aerial, in.relative) * (1.0 - factor);
    } else {
        light = aerial_perspective(frame.aerial, light, in.relative);
        if factor > 0.0 {
            light = mix(light, fog_color(frame.fog, in.relative, frame.sun_direction.xyz, frame.sun_color.xyz), factor);
        }
    }
    let out = null3d::tonemap::finish(
        light,
        in.clip.xy,
        frame.output,
        frame.target_size.xy,
        frame.vignette,
    );
    return vec4f(out.rgb * alpha, alpha);
}
