// Depth of field's steps: one triangle each over its target's drawn corner. The near field (what
// lies in front of the focus) and the far field (what lies behind it) blur apart, so a blurred
// object in front spreads over a sharp one behind it, and a sharp object never spreads its color
// into the blurred background. It is the gather of Keijiro Takahashi's KinoBokeh, which Unity's
// post-processing stack ships.
//
// - `setup` reads four pixels of the scene's color and depth for each texel of a target at half
//   the render size. It finds each pixel's blur size, the circle of confusion, from its depth, and
//   writes their color with the smallest size: the near field's, or else the sharpest pixel's.
//   In-focus color counts less in the average, and dims by how sharp the texel is, so sharp detail
//   does not bleed into the blur.
// - `gather` gathers a spiral of taps over a disk or polygon around each texel. A tap adds to the
//   far field only
//   where both its own blur and the texel's reach it, and to the near field where its own blur
//   reaches the texel. The near field's share is how much of the texel it covers.
// - `tent` smooths the gather with a tent as wide as the spacing of its taps, so small highlights
//   fill their disks.
// - `composite` mixes the blur into each pixel of the scene's color: by the pixel's own blur size,
//   read from the depth at full size, so edges in focus stay sharp, and by the near field's share.
//
// The blur size is signed: below 0 in front of the focus, above it behind. It is in texels of the
// half-size targets. The MULTISAMPLED builds read a multisampled depth, on WebGPU: the composite
// takes each pixel's nearest sample, and the setup the first. The depth binds as unfilterable floats, as compatibility mode reads no depth texture type
// with textureLoad. WebGPU draws a corner into a target's first rows, and WebGL2, which counts rows from
// the bottom, into its last, so the frame builder writes where each corner starts. A fragment's
// position and a texture's rows count the same way on each path.
#import null3d::color::{limit_hdr}

/// The most taps of the gather, two in each vector of the kernel.
const MAX_TAPS: u32 = 72u;
/// The width of the soft edge where a tap's blur ends, in texels of the half-size targets.
const MARGIN: f32 = 2.0;
const PI: f32 = 3.141592653589793;

/// A step's settings, which the frame builder writes for each step.
struct Step {
    /// xy: the source's texture coordinates per pixel of the target. zw: the source's texture
    /// coordinates at the target's first pixel.
    map: vec4f,
    /// xy: the lowest texture coordinates of the source's drawn corner, the centers of its first
    /// texels. zw: the highest, the centers of its last.
    bounds: vec4f,
    /// xy: the source's size in texels. zw: one texel in texture coordinates.
    source: vec4f,
    /// The composite's map into the blurred image, as `map` is into the source.
    blurred_map: vec4f,
    /// The composite's bounds of the blurred image's drawn corner, as `bounds` are.
    blurred_bounds: vec4f,
    /// x: the blur size far behind the focus. y: the focus distance. z: the largest blur size.
    /// w: the gather's radius, the largest blur that the frame can have.
    lens: vec4f,
    /// The inverse projection's terms that turn a depth value into a distance: the view-space z is
    /// (x * depth + y) / (z * depth + w).
    depth: vec4f,
    /// x: the gather's taps. y: how far the tent reaches each way, in texels. z: the gather's largest
    /// turn of its taps, in radians. w: unused.
    taps: vec4f,
    /// The taps' places within the gather's radius, two in each vector.
    kernel: array<vec4f, 36>,
}

@group(0) @binding(0) var<uniform> settings: Step;
@group(0) @binding(1) var source: texture_2d<f32>;
@group(0) @binding(2) var source_sampler: sampler;
#ifdef MULTISAMPLED
@group(0) @binding(3) var depth_texture: texture_multisampled_2d<f32>;
#else
@group(0) @binding(3) var depth_texture: texture_2d<f32>;
#endif
@group(0) @binding(4) var blurred: texture_2d<f32>;

@vertex
fn vs(@builtin(vertex_index) vertex: u32) -> @builtin(position) vec4f {
    // A triangle past the corners of clip space, at a depth that every WebGL2 depth mode keeps.
    let x = f32((vertex << 1u) & 2u) * 2.0 - 1.0;
    let y = f32(vertex & 2u) * 2.0 - 1.0;
    return vec4f(x, y, 0.5, 1.0);
}

/// The signed blur size of a depth value, in texels of the half-size targets: the thin lens's
/// circle of confusion, which grows from 0 at the focus toward its far value behind it, and
/// without bound in front of it, up to the largest blur size.
fn blur_size(depth: f32) -> f32 {
    let d = settings.depth;
    let away = max(-(d.x * depth + d.y) / (d.z * depth + d.w), 1e-6);
    let size = settings.lens.x * (1.0 - settings.lens.y / away);
    return clamp(size, -settings.lens.z, settings.lens.z);
}

/// The depth value of a texel of the scene for the composite. Of a multisampled depth, which MSAA's
/// four samples fill, it takes the nearest sample: an edge pixel's color is mostly the object in
/// front, so it keeps its own color where that object is sharp, and its edge keeps its smoothing.
fn depth_of(texel: vec2i) -> f32 {
#ifdef MULTISAMPLED
    var depth = 0.0;
    for (var sample_index = 0; sample_index < 4; sample_index++) {
        depth = max(depth, textureLoad(depth_texture, texel, sample_index).x);
    }
    return depth;
#else
    return textureLoad(depth_texture, texel, 0).x;
#endif
}

/// The depth value of the scene's texel under texture coordinates `uv` of the source, from its
/// first sample alone: the setup's smallest blur keeps sharp edges from spreading, so one load per
/// pixel is enough there, where every sample would read the whole multisampled depth.
fn depth_at(uv: vec2f) -> f32 {
    let texel = min(vec2i(uv * settings.source.xy), vec2i(settings.source.xy) - 1);
    return textureLoad(depth_texture, texel, 0).x;
}

/// The source's filtered color at `uv`, clamped inside its drawn corner.
fn tap(uv: vec2f) -> vec4f {
    return textureSampleLevel(source, source_sampler, clamp(uv, settings.bounds.xy, settings.bounds.zw), 0.0);
}

fn brightest(c: vec3f) -> f32 {
    return max(c.r, max(c.g, c.b));
}

@fragment
fn setup(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let uv = position.xy * settings.map.xy + settings.map.zw;
    let d = 0.5 * settings.source.zw;
    var sum = vec3f(0.0);
    var weights = 0.0;
    var smallest = 1e9;
    for (var k = 0u; k < 4u; k++) {
        let corner = vec2f(f32(k & 1u), f32(k >> 1u)) * 2.0 - 1.0;
        let place = clamp(uv + corner * d, settings.bounds.xy, settings.bounds.zw);
        let color = limit_hdr(tap(place).rgb);
        let size = blur_size(depth_at(place));
        // Sharp and very bright pixels count less, so neither bleeds nor flickers in the blur.
        let weight = abs(size) / (brightest(color) + 1.0);
        sum += color * weight;
        weights += weight;
        smallest = min(smallest, size);
    }
    // The smallest blur wins: the near field's, which then spreads over the texel's sharp pixels,
    // or else the sharpest pixel's, so a texel on a sharp object's edge stays sharp and never
    // spreads the object's color into the blurred background behind it.
    let size = smallest;
    let color = sum / max(weights, 1e-4) * smoothstep(0.0, 2.0, abs(size));
    return vec4f(color, size);
}

@fragment
fn gather(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let uv = position.xy * settings.map.xy + settings.map.zw;
    let center = tap(uv);
    // A sharp texel shows only where the composite blends the blur into a blurred pixel beside it,
    // so it gathers the blurred background around it, by each tap's own blur, and leaves out the
    // sharp taps: that pixel then blends background with background, with no dark fringe.
    let sharp = abs(center.a) < 1.0;
    let radius = settings.lens.w;
    let taps = min(u32(settings.taps.x), MAX_TAPS);
    // A round aperture turns its spiral of taps by a different angle at each texel, from Jimenez's
    // interleaved gradient noise. A highlight smaller than the taps' spacing then fills its disk
    // with fine grain that the tent smooths, where taps in fixed places would stamp their pattern.
    // A polygon keeps its corners where they are.
    let noise = fract(52.9829189 * fract(dot(position.xy, vec2f(0.06711056, 0.00583715))));
    let angle = settings.taps.z * noise;
    let turn = mat2x2f(cos(angle), sin(angle), -sin(angle), cos(angle));
    var far_sum = vec4f(0.0);
    var near_sum = vec4f(0.0);
    for (var i = 0u; i < taps; i++) {
        let pair = settings.kernel[i / 2u];
        let offset = turn * select(pair.xy, pair.zw, (i & 1u) == 1u) * radius;
        let reach = length(offset);
        let taken = tap(uv + offset * settings.source.zw);
        // The far field takes a tap only where the texel's blur reaches it too, so a sharp
        // object in front never spreads into the blurred background behind it.
        let far_size = max(select(min(center.a, taken.a), taken.a, sharp), 0.0);
        let far_weight = saturate((far_size - reach + MARGIN) / MARGIN)
            * select(1.0, smoothstep(0.0, 2.0, taken.a), sharp);
        // The near field takes a tap wherever the tap's own blur reaches the texel, so a blurred
        // object in front spreads over whatever lies behind it.
        let near_weight = saturate((-taken.a - reach + MARGIN) / MARGIN) * step(1.0, -taken.a);
        far_sum += vec4f(taken.rgb, 1.0) * far_weight;
        near_sum += vec4f(taken.rgb, 1.0) * near_weight;
    }
    let far_color = far_sum.rgb / max(far_sum.a, 1e-4);
    let near_color = near_sum.rgb / max(near_sum.a, 1e-4);
    let coverage = saturate(near_sum.a * PI / f32(max(taps, 1u)));
    return vec4f(mix(far_color, near_color, coverage), coverage);
}

@fragment
fn tent(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let uv = position.xy * settings.map.xy + settings.map.zw;
    let d = settings.taps.y * settings.source.zw;
    let sum = tap(uv - d) + tap(uv + vec2f(d.x, -d.y)) + tap(uv + vec2f(-d.x, d.y)) + tap(uv + d);
    return sum * 0.25;
}

@fragment
fn composite(@builtin(position) position: vec4f) -> @location(0) vec4f {
    // The scene's color and depth have the target's size and drawn corner, so a pixel reads its
    // own texel of each.
    let texel = vec2i(position.xy);
    let color = textureLoad(source, texel, 0);
    let size = blur_size(depth_of(texel));
    let at = clamp(
        position.xy * settings.blurred_map.xy + settings.blurred_map.zw,
        settings.blurred_bounds.xy,
        settings.blurred_bounds.zw,
    );
    let image = textureSampleLevel(blurred, source_sampler, at, 0.0);
    // The far field shows from a blur of one texel of the half-size image, in full from two.
    let behind = smoothstep(1.0, 2.0, size);
    let share = behind + image.a - behind * image.a;
    return vec4f(mix(color.rgb, image.rgb, share), color.a);
}
