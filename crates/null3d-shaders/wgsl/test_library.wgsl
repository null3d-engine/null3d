// A test shader for the shader library. The library test page draws one triangle over a target of
// rgba32uint texels, four texels wide and one row per case. Each case runs one library function,
// which the case's first input texel names, on the inputs in the rest of its row of the input
// texture. The fragment writes the bits of up to sixteen results, four per texel, and the page
// compares them with its own references. Inputs and results travel as bits, so no conversion on
// the way changes a value.
//
// Each case below calls its function by its full path, and the page's table of references names
// the same functions in the same order; a unit test checks that the two agree.
//
// Each variant holds the cases of one library module, which the def of the module's name in
// capitals selects, and the page draws each variant over the rows of its module's cases. The
// whole library in one shader is about four times the largest engine shader, and the PowerVR
// driver of the Pixel 11 could not build a pipeline from it.
#ifdef COLOR
#import null3d::color
#endif
#ifdef DEPTH
#import null3d::depth
#endif
#ifdef FOG
#import null3d::fog
#endif
#ifdef LIGHTING
#import null3d::lighting
#endif
#ifdef MATH
#import null3d::math
#endif
#ifdef NOISE
#import null3d::noise
#endif
#ifdef REFLECTION
#import null3d::reflection
#endif
#ifdef SDF
#import null3d::sdf
#endif
#ifdef VERTEX
#import null3d::vertex
#endif

/// Each case's function number, then its inputs, one row per case.
@group(0) @binding(0) var cases: texture_2d<u32>;

/// Input texels per case after the function number.
const INPUTS: i32 = 8;

/// The bits of up to sixteen results, four per output texel.
struct Results {
    a: vec4u,
    b: vec4u,
    c: vec4u,
    d: vec4u,
}

fn floats(a: vec4f, b: vec4f, c: vec4f, d: vec4f) -> Results {
    return Results(bitcast<vec4u>(a), bitcast<vec4u>(b), bitcast<vec4u>(c), bitcast<vec4u>(d));
}

fn scalar(x: f32) -> Results {
    return floats(vec4f(x, 0.0, 0.0, 0.0), vec4f(0.0), vec4f(0.0), vec4f(0.0));
}

fn pair(v: vec2f) -> Results {
    return floats(vec4f(v, 0.0, 0.0), vec4f(0.0), vec4f(0.0), vec4f(0.0));
}

fn triple(v: vec3f) -> Results {
    return floats(vec4f(v, 0.0), vec4f(0.0), vec4f(0.0), vec4f(0.0));
}

fn quad(v: vec4f) -> Results {
    return floats(v, vec4f(0.0), vec4f(0.0), vec4f(0.0));
}

fn triples(a: vec3f, b: vec3f) -> Results {
    return floats(vec4f(a, 0.0), vec4f(b, 0.0), vec4f(0.0), vec4f(0.0));
}

fn whole(v: vec4u) -> Results {
    return Results(v, vec4u(0u), vec4u(0u), vec4u(0u));
}

#ifdef VERTEX
fn transform(r: array<vec4f, 8>) -> null3d::vertex::Transform {
    return null3d::vertex::Transform(r[0], r[1], r[2]);
}
#endif

#ifdef FOG
/// A scene fog from the inputs: the color and density in the first texel, the curve in the second,
/// the shape in the third, and the sun glow and its exponent in the fourth.
fn test_fog(u: array<vec4u, 8>, r: array<vec4f, 8>) -> null3d::fog::Fog {
    return null3d::fog::Fog(r[0], r[2], r[3].x, r[3].y, 0.0, u[1].x);
}
#endif

#ifdef LIGHTING
fn material(r: array<vec4f, 8>) -> null3d::lighting::PbrMaterial {
    return null3d::lighting::pbr_material(r[0].xyz, r[0].w, r[1].x, r[1].y);
}
#endif

/// Runs the function numbered `function` on the inputs, given both as bits and as floats.
fn run(function: u32, u: array<vec4u, 8>, f: array<vec4f, 8>) -> Results {
    switch function {
#ifdef MATH
        case 0u: { return scalar(null3d::math::square(f[0].x)); }
        case 1u: { return scalar(null3d::math::max_component(f[0].xyz)); }
        case 2u: { return scalar(null3d::math::min_component(f[0].xyz)); }
        case 3u: { return scalar(null3d::math::inverse_lerp(f[0].x, f[0].y, f[0].z)); }
        case 4u: { return scalar(null3d::math::remap(f[0].x, f[0].y, f[0].z, f[0].w, f[1].x)); }
        case 5u: { return scalar(null3d::math::modulo(f[0].x, f[0].y)); }
        case 6u: { return pair(null3d::math::rotate_2d(f[0].xy, f[0].z)); }
        case 7u: { return triple(null3d::math::rotate_axis(f[0].xyz, f[1].xyz, f[1].w)); }
        case 8u: { return triple(null3d::math::quat_rotate(f[0], f[1].xyz)); }
        case 9u: {
            let m = null3d::math::basis_from_normal(f[0].xyz);
            return floats(vec4f(m[0], 0.0), vec4f(m[1], 0.0), vec4f(m[2], 0.0), vec4f(0.0));
        }
        case 10u: {
            let turns = vec4f(null3d::math::PI, null3d::math::TAU, null3d::math::HALF_PI, null3d::math::INV_PI);
            return floats(turns, vec4f(null3d::math::EPSILON, 0.0, 0.0, 0.0), vec4f(0.0), vec4f(0.0));
        }
#endif
#ifdef NOISE
        case 11u: { return whole(vec4u(null3d::noise::pcg(u[0].x), 0u, 0u, 0u)); }
        case 12u: { return whole(vec4u(null3d::noise::pcg3d(u[0].xyz), 0u)); }
        case 13u: { return scalar(null3d::noise::to_unit(u[0].x)); }
        case 14u: { return scalar(null3d::noise::random(u[0].x)); }
        case 15u: { return scalar(null3d::noise::random2(f[0].xy)); }
        case 16u: { return scalar(null3d::noise::random3(f[0].xyz)); }
        case 17u: { return whole(vec4u(null3d::noise::lattice(bitcast<vec3i>(u[0].xyz)), 0u)); }
        case 18u: { return triple(null3d::noise::fade(f[0].xyz)); }
        case 19u: { return scalar(null3d::noise::value3(f[0].xyz)); }
        case 20u: { return scalar(null3d::noise::value2(f[0].xy)); }
        case 21u: { return scalar(null3d::noise::gradient(u[0].x, f[1].xyz)); }
        case 22u: { return scalar(null3d::noise::perlin3(f[0].xyz)); }
        case 23u: { return scalar(null3d::noise::perlin2(f[0].xy)); }
        case 24u: {
            return scalar(null3d::noise::simplex_corner(bitcast<vec3i>(u[0].xyz), f[1].xyz, f[1].w));
        }
        case 25u: { return scalar(null3d::noise::simplex3(f[0].xyz)); }
        case 26u: { return scalar(null3d::noise::simplex2(f[0].xy)); }
        case 27u: { return scalar(null3d::noise::worley3(f[0].xyz)); }
        case 28u: { return scalar(null3d::noise::worley2(f[0].xy)); }
        case 29u: { return scalar(null3d::noise::fbm3(f[0].xyz, u[1].x)); }
        case 30u: { return scalar(null3d::noise::fbm2(f[0].xy, u[1].x)); }
#endif
#ifdef COLOR
        case 31u: { return triple(null3d::color::linear_to_srgb(f[0].xyz)); }
        case 32u: { return triple(null3d::color::srgb_to_linear(f[0].xyz)); }
        case 33u: { return scalar(null3d::color::luminance(f[0].xyz)); }
        case 34u: { return triple(null3d::color::rgb_to_hsv(f[0].xyz)); }
        case 35u: { return triple(null3d::color::hsv_to_rgb(f[0].xyz)); }
        case 36u: { return triple(null3d::color::rrt_and_odt_fit(f[0].xyz)); }
        case 37u: { return triple(null3d::color::tone_map_aces(f[0].xyz)); }
        case 38u: { return triple(null3d::color::agx_contrast(f[0].xyz)); }
        case 39u: { return triple(null3d::color::tone_map_agx(f[0].xyz)); }
        case 40u: { return triple(null3d::color::tone_map_neutral(f[0].xyz)); }
#endif
#ifdef LIGHTING
        case 41u: {
            return triple(null3d::lighting::lambert(f[0].xyz, f[1].xyz, f[2].xyz, f[3].xyz, f[4].xyz));
        }
        case 42u: { return triple(null3d::lighting::brdf_lambert(f[0].xyz)); }
        case 43u: { return triple(null3d::lighting::f_schlick(f[0].xyz, f[0].w, f[1].x)); }
        case 44u: { return scalar(null3d::lighting::d_ggx(f[0].x, f[0].y)); }
        case 45u: { return scalar(null3d::lighting::v_ggx_smith_correlated(f[0].x, f[0].y, f[0].z)); }
        case 46u: {
            return triple(null3d::lighting::brdf_ggx(f[0].xyz, f[1].xyz, f[2].xyz, f[3].xyz, f[3].w, f[4].x));
        }
        case 47u: { return pair(null3d::lighting::dfg_lut(f[0].x, f[0].y)); }
        case 48u: { return triple(null3d::lighting::environment_brdf(f[0].xyz, f[0].w, f[1].xy)); }
        case 49u: {
            let s = null3d::lighting::multiscattering(f[0].xyz, f[0].w, f[1].xy);
            return triples(s.single, s.multi);
        }
        case 50u: { return triple(null3d::lighting::multiscatter_compensation(f[0].xyz, f[1].xy)); }
        case 51u: { return scalar(null3d::lighting::specular_occlusion(f[0].x, f[0].y, f[0].z)); }
        case 52u: { return scalar(null3d::lighting::distance_attenuation(f[0].x, f[0].y, f[0].z)); }
        case 53u: { return scalar(null3d::lighting::spot_attenuation(f[0].x, f[0].y, f[0].z)); }
        case 54u: {
            return triple(null3d::lighting::hemisphere_irradiance(f[0].xyz, f[1].xyz, f[2].xyz, f[3].xyz));
        }
        case 55u: {
            let sh = array<vec3f, 9>(
                f[1].xyz,
                vec3f(f[1].w, f[2].xy),
                vec3f(f[2].zw, f[3].x),
                f[3].yzw,
                f[4].xyz,
                vec3f(f[4].w, f[5].xy),
                vec3f(f[5].zw, f[6].x),
                f[6].yzw,
                f[7].xyz,
            );
            return triple(null3d::lighting::sh_irradiance(f[0].xyz, sh));
        }
        case 56u: {
            let m = null3d::lighting::pbr_material(f[0].xyz, f[0].w, f[1].x, f[1].y);
            return floats(
                vec4f(m.base_color, m.specular_grazing),
                vec4f(m.diffuse, m.roughness),
                vec4f(m.specular, m.metalness),
                vec4f(m.specular_blended, 0.0),
            );
        }
        case 57u: {
            let r = null3d::lighting::direct_light(material(f), f[2].xyz, f[3].xyz, f[4].xyz, f[5].xyz, f[6].xyz);
            return triples(r.diffuse, r.specular);
        }
        case 58u: { return triple(null3d::lighting::indirect_diffuse(material(f), f[2].xyz, f[3].xy)); }
        case 59u: {
            let r = null3d::lighting::indirect_specular(material(f), f[2].xyz, f[3].xyz, f[4].xy);
            return triples(r.diffuse, r.specular);
        }
#endif
#ifdef FOG
        case 60u: { return scalar(null3d::fog::fog_exponential(f[0].x, f[0].y)); }
        case 61u: { return scalar(null3d::fog::fog_linear(f[0].x, f[0].y, f[0].z)); }
        case 62u: { return scalar(null3d::fog::fog_exp2(f[0].x, f[0].y)); }
        case 63u: { return triple(null3d::fog::apply_fog(f[0].xyz, f[1].xyz, f[2].x)); }
#endif
#ifdef VERTEX
        case 64u: { return triple(null3d::vertex::transform_point(transform(f), f[3].xyz)); }
        case 65u: { return triple(null3d::vertex::transform_direction(transform(f), f[3].xyz)); }
        case 66u: { return triple(null3d::vertex::transform_normal(transform(f), f[3].xyz)); }
        case 67u: {
            let t = null3d::vertex::move_transform(transform(f), f[3].xyz);
            return floats(t.x, t.y, t.z, vec4f(0.0));
        }
        case 68u: { return quad(null3d::vertex::to_clip(mat4x4f(f[0], f[1], f[2], f[3]), f[4].xyz)); }
        case 69u: { return quad(null3d::vertex::OUTSIDE_CLIP); }
#endif
#ifdef DEPTH
        case 70u: { return scalar(null3d::depth::perspective_depth_to_view_z(f[0].x, f[0].y, f[0].z)); }
        case 71u: { return scalar(null3d::depth::view_z_to_perspective_depth(f[0].x, f[0].y, f[0].z)); }
        case 72u: { return scalar(null3d::depth::orthographic_depth_to_view_z(f[0].x, f[0].y, f[0].z)); }
        case 73u: { return scalar(null3d::depth::view_z_to_orthographic_depth(f[0].x, f[0].y, f[0].z)); }
        case 74u: { return scalar(null3d::depth::linear_depth(f[0].x, f[0].y, f[0].z)); }
        case 75u: {
            return triple(null3d::depth::view_position(f[0].xy, f[0].z, mat4x4f(f[1], f[2], f[3], f[4])));
        }
#endif
#ifdef SDF
        case 76u: { return scalar(null3d::sdf::sphere(f[0].xyz, f[0].w)); }
        case 77u: { return scalar(null3d::sdf::box(f[0].xyz, f[1].xyz)); }
        case 78u: { return scalar(null3d::sdf::round_box(f[0].xyz, f[1].xyz, f[1].w)); }
        case 79u: { return scalar(null3d::sdf::torus(f[0].xyz, f[1].x, f[1].y)); }
        case 80u: { return scalar(null3d::sdf::capsule(f[0].xyz, f[1].xyz, f[2].xyz, f[2].w)); }
        case 81u: { return scalar(null3d::sdf::cylinder(f[0].xyz, f[1].x, f[1].y)); }
        case 82u: { return scalar(null3d::sdf::plane(f[0].xyz, f[1].xyz, f[1].w)); }
        case 83u: { return scalar(null3d::sdf::circle(f[0].xy, f[0].z)); }
        case 84u: { return scalar(null3d::sdf::rect(f[0].xy, f[0].zw)); }
        case 85u: { return scalar(null3d::sdf::segment(f[0].xy, f[0].zw, f[1].xy)); }
        case 86u: { return scalar(null3d::sdf::merge(f[0].x, f[0].y)); }
        case 87u: { return scalar(null3d::sdf::subtract(f[0].x, f[0].y)); }
        case 88u: { return scalar(null3d::sdf::intersect(f[0].x, f[0].y)); }
        case 89u: { return scalar(null3d::sdf::smooth_merge(f[0].x, f[0].y, f[0].z)); }
        case 90u: { return scalar(null3d::sdf::smooth_subtract(f[0].x, f[0].y, f[0].z)); }
        case 91u: { return scalar(null3d::sdf::smooth_intersect(f[0].x, f[0].y, f[0].z)); }
        case 92u: { return scalar(null3d::sdf::rounded(f[0].x, f[0].y)); }
        case 93u: { return scalar(null3d::sdf::onion(f[0].x, f[0].y)); }
#endif
#ifdef FOG
        case 94u: {
            return scalar(null3d::fog::fog_factor(test_fog(u, f), f[4].xyz));
        }
#endif
#ifdef VERTEX
        case 95u: { return triple(null3d::vertex::mesh_position(f[0].xyz)); }
        case 96u: { return pair(null3d::vertex::mesh_uv(f[0].xy)); }
        case 97u: { return pair(null3d::vertex::mesh_second_uv(f[0].xy)); }
#endif
#ifdef COLOR
        case 98u: { return triple(null3d::color::limit_hdr(f[0].xyz)); }
#endif
#ifdef LIGHTING
        case 99u: {
            let m = null3d::lighting::with_specular(material(f), f[2].x, f[2].yzw, f[3].x);
            return floats(
                vec4f(m.base_color, m.specular_grazing),
                vec4f(m.diffuse, m.roughness),
                vec4f(m.specular, m.metalness),
                vec4f(m.specular_blended, 0.0),
            );
        }
#endif
#ifdef FOG
        case 100u: { return scalar(null3d::fog::fog_height_ratio(f[0].x)); }
        case 101u: {
            return triple(null3d::fog::fog_color(test_fog(u, f), f[4].xyz, f[5].xyz, f[6].xyz));
        }
#endif
#ifdef REFLECTION
        case 102u: { return pair(null3d::reflection::reflection_uv(f[0], f[1].xy)); }
#endif
        // Any other number gives back its first input texel. The page's probe draws such a row,
        // so whole numbers take the same way to the target as the library's results.
        default: { return whole(u[0]); }
    }
}

@vertex
fn vs(@builtin(vertex_index) corner: u32) -> @builtin(position) vec4f {
    // A triangle past the corners of clip space: (-1, -1), (3, -1) and (-1, 3).
    let x = f32((corner << 1u) & 2u) * 2.0 - 1.0;
    let y = f32(corner & 2u) * 2.0 - 1.0;
    return vec4f(x, y, 0.5, 1.0);
}

@fragment
fn fs(@builtin(position) position: vec4f) -> @location(0) vec4u {
    let row = i32(position.y);
    var u: array<vec4u, 8>;
    var f: array<vec4f, 8>;
    for (var i = 0; i < INPUTS; i++) {
        u[i] = textureLoad(cases, vec2i(i + 1, row), 0);
        f[i] = bitcast<vec4f>(u[i]);
    }
    let results = run(textureLoad(cases, vec2i(0, row), 0).x, u, f);
    switch u32(position.x) {
        case 0u: { return results.a; }
        case 1u: { return results.b; }
        case 2u: { return results.c; }
        default: { return results.d; }
    }
}
