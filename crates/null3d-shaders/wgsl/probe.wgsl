// Reflection probes' maps, made on the GPU from the scene that a probe sees (decision record
// D-149). A probe's six capture views draw the scene from its capture point into square images,
// one per face of a cube. Then:
//
// - `gather` copies one image into its layer of the chain, a texture array of six layers that
//   holds the faces in the cube map table that every GPU path shares (null3d::cubemap).
// - `half` makes each smaller level of each layer of the chain from the level before it. WebGL2
//   makes them with its own mip level filter instead.
// - `prefilter` fills one level of the probe's layer of the probes' texture array: an octahedral
//   map of the light that a surface of the level's roughness reflects, filtered with the GGX
//   distribution as the environment's maps are (environment.wgsl), so one table of levels serves
//   both. Level 0 holds the light as it is.
//
// The targets hold half floats, which every GPU path draws into where probes run, so each draw
// writes its light straight into its level, with no copy.

#import null3d::cubemap::{face_point, frame_bitangent, frame_tangent}
#import null3d::cubemap::{octahedral_direction, octahedral_texel_point, radical_inverse}

struct Step {
    /// The chain's layer that `half` reads.
    layer: u32,
    /// The prefilter's directions per texel.
    samples: u32,
    /// The texels across a side of the chain's largest level.
    chain_size: u32,
    /// The texels across a side of the level that the draw fills.
    size: u32,
    /// The prefilter's perceptual roughness, 0 for level 0, which holds the light unfiltered.
    roughness: f32,
    spare_a: f32,
    spare_b: f32,
    spare_c: f32,
}

@group(0) @binding(0) var<uniform> params: Step;
/// The capture view's image for `gather`, a texture array of one layer, or the chain for
/// `prefilter`.
@group(0) @binding(1) var source: texture_2d_array<f32>;
/// Linear within and between levels, clamped at the edges.
@group(0) @binding(2) var source_sampler: sampler;

const PI: f32 = 3.14159265358979;

@vertex
fn vs_main(@builtin(vertex_index) vertex: u32) -> @builtin(position) vec4f {
    // Corners at (-1, -1), (3, -1) and (-1, 3) in clip space, at a depth that every WebGL2 depth
    // mapping keeps inside the clip volume.
    let corner = vec2f(f32((vertex << 1u) & 2u), f32(vertex & 2u));
    return vec4f(corner * 2.0 - 1.0, 0.5, 1.0);
}

/// The light that the chain holds in unit direction `d`, at mip level `level`. Each face filters
/// on its own, so the edges of its texels clamp at the face's edges.
fn chain_light(d: vec3f, level: f32) -> vec3f {
    let at = face_point(d);
    let uv = at.xy * 0.5 + 0.5;
    return textureSampleLevel(source, source_sampler, uv, i32(at.z), level).rgb;
}

/// The light of the capture view's image at the chain's texel under the fragment. Each capture
/// view looks along its face's middle direction, with its up direction toward the face's first
/// row, so its right direction runs against the face's columns: the cube map table is mirrored
/// against a camera's view. Rows count from the first row of each texture on both paths, and a
/// view's image keeps its bottom edge's row first, so the view's image reads the texel's column
/// and row both turned around.
@fragment
fn fs_gather(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let texel = floor(position.xy);
    let at = (texel + 0.5) / f32(params.chain_size);
    let uv = 1.0 - at;
    return vec4f(textureSampleLevel(source, source_sampler, uv, 0, 0.0).rgb, 1.0);
}

/// The average of the four texels of the level before that this texel covers: a linear filter
/// reads them at their shared corner, where the texel's center lies. The source is the chain's
/// level before, alone.
@fragment
fn fs_half(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let uv = (floor(position.xy) + 0.5) / f32(params.size);
    let light = textureSampleLevel(source, source_sampler, uv, i32(params.layer), 0.0).rgb;
    return vec4f(light, 1.0);
}

/// The chain's light filtered by the GGX distribution of the level's perceptual roughness, with
/// the view along the texel's direction (the split-sum view of Karis, 2013), as the environment's
/// prefilter does. Each direction reads a smaller level of the chain as its sample covers more of
/// the sphere (Křivánek and Colbert, 2008), and weighs by the cosine of the light's angle.
@fragment
fn fs_prefilter(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let n = octahedral_direction(octahedral_texel_point(floor(position.xy), f32(params.size)));
    if params.roughness <= 0.0 {
        return vec4f(chain_light(n, 0.0), 1.0);
    }
    let t = frame_tangent(n);
    let b = frame_bitangent(n);
    let alpha = params.roughness * params.roughness;
    let alpha2 = alpha * alpha;
    let chain_size = f32(params.chain_size);
    let texel_solid_angle = 4.0 * PI / (6.0 * chain_size * chain_size);
    let last = log2(chain_size);
    let count = params.samples;
    var sum = vec3f(0.0);
    var total = 0.0;
    for (var i = 0u; i < count; i++) {
        let u = f32(i) / f32(count);
        let phi = 2.0 * PI * radical_inverse(i);
        let cos2 = (1.0 - u) / (1.0 + (alpha2 - 1.0) * u);
        let cos_theta = sqrt(cos2);
        let sin_theta = sqrt(max(1.0 - cos2, 0.0));
        let light = vec3f(
            2.0 * cos_theta * sin_theta * cos(phi),
            2.0 * cos_theta * sin_theta * sin(phi),
            2.0 * cos2 - 1.0,
        );
        if light.z <= 0.0 {
            continue;
        }
        // With the view along the normal, the light's density is D / 4.
        let density = alpha2 / (PI * (cos2 * (alpha2 - 1.0) + 1.0) * (cos2 * (alpha2 - 1.0) + 1.0));
        let solid_angle = 4.0 / (f32(count) * density);
        let lod = clamp(0.5 * log2(solid_angle / texel_solid_angle) + 1.0, 0.0, last);
        let d = t * light.x + b * light.y + n * light.z;
        sum += chain_light(d, lod) * light.z;
        total += light.z;
    }
    return vec4f(sum / max(total, 1e-6), 1.0);
}
