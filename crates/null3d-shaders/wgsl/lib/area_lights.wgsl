#define_import_path null3d::area_lights
#import null3d::lighting::{PbrMaterial, Reflected}
#import null3d::math::{square}
#import null3d::tables::{AreaTerms, light_image}

// Rectangle and tube lights, shaded with linearly transformed cosines (LTC), after Heitz, Dupuy,
// Hill and Neubelt, "Real-Time Polygonal-Light Shading with Linearly Transformed Cosines" (ACM
// SIGGRAPH 2016). The formulas follow three.js's `RE_Direct_RectArea_Physical`, so a rectangle
// light gives the same light as three.js's RectAreaLight.
//
// The light that a surface reflects from a polygon of uniform radiance is the integral of the BRDF
// over the polygon's solid angle. LTC fits the GGX BRDF, for each view angle and roughness, by a
// clamped cosine that a 3x3 matrix transforms. The integral of a clamped cosine over a polygon has
// a closed form: a sum over the polygon's edges. So the shader moves the polygon by the inverse
// matrix, which the engine's tables hold (null3d::tables), and sums its edges. The diffuse part is
// the same integral with no transform.
//
// A rectangle light may show an image, such as a shop window. Its light then varies over its
// area. As Heitz's paper shows, the shader reads the image where the point under the surface lies
// on the light's plane, in the frame that the LTC matrix makes for each lobe, and at a mip level
// that grows with the plane's distance over the light's size: rough lobes and far surfaces see the
// image blurred, and mirror-like ones sharp.
//
// A tube light is a cylinder. From any point it looks like a rectangle as long as the tube and as
// wide as its diameter, in the plane through the tube's axis that faces the point. The shader
// lights the surface with that rectangle, so a tube costs the same as a rectangle. Its round ends
// add no light, which a thin tube does not show.

/// The vector form factor of one edge of a polygon on the unit sphere, from `a` to `b`. A rational
/// polynomial approximates theta / sin(theta) / 2pi, as three.js's `LTC_EdgeVectorFormFactor`.
fn edge_form_factor(a: vec3f, b: vec3f) -> vec3f {
    let x = dot(a, b);
    let y = abs(x);
    let p = 0.8543985 + (0.4965155 + 0.0145206 * y) * y;
    let q = 3.4175940 + (4.1616724 + y) * y;
    let v = p / q;
    let theta_sin = select(0.5 * inverseSqrt(max(1.0 - x * x, 1e-7)) - v, v, x > 0.0);
    return cross(a, b) * theta_sin;
}

/// The integral of a clamped cosine around +Z over a quad, whose corners are relative to the
/// surface and given in counterclockwise order seen from the lit side. The quad's part below the
/// horizon is clipped by the approximation of a sphere, as three.js's `LTC_ClippedSphereFormFactor`.
fn quad_form_factor(corners: array<vec3f, 4>) -> f32 {
    var on_sphere: array<vec3f, 4>;
    for (var i = 0u; i < 4u; i++) {
        on_sphere[i] = normalize(corners[i]);
    }
    var sum = vec3f(0.0);
    for (var i = 0u; i < 4u; i++) {
        sum += edge_form_factor(on_sphere[i], on_sphere[(i + 1u) & 3u]);
    }
    let size = length(sum);
    return max((size * size + sum.z) / (size + 1.0), 0.0);
}

/// A unit vector at right angles to the unit vector `v`.
fn any_perpendicular(v: vec3f) -> vec3f {
    let other = select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), abs(v.x) > 0.9);
    return normalize(cross(v, other));
}

/// The image of a rectangle light in layer `layer`, as seen from the origin of `corners`' frame:
/// the corners of the light, counterclockwise from its +X, -Y corner. The image's texture
/// coordinates run from its +X, -Y corner, so it reads the right way round from the lit side.
fn image_seen(corners: array<vec3f, 4>, layer: i32) -> vec3f {
    let across = corners[1] - corners[0];
    let up = corners[3] - corners[0];
    let normal = cross(across, up);
    let area2 = dot(normal, normal);
    let distance_area = dot(normal, corners[0]);
    // The origin's foot on the light's plane, from the first corner.
    let foot = distance_area * normal / area2 - corners[0];
    let across_up = dot(across, up);
    let inverse_across2 = 1.0 / dot(across, across);
    let upright = up - across * across_up * inverse_across2;
    let v = dot(upright, foot) / dot(upright, upright);
    let u = dot(across, foot) * inverse_across2 - across_up * inverse_across2 * v;
    // The plane's distance over the light's size picks how blurred the image looks.
    let ratio = abs(distance_area) / pow(area2, 0.75);
    return light_image(layer, vec2f(u, v), log2(ratio * f32(IMAGE_SIZE)));
}

/// Texels along each side of a rectangle light's image.
const IMAGE_SIZE: u32 = 128u;

/// How an area light fades to nothing at its range, measured from its middle at `gap`, with the
/// window of three.js's `getDistanceAttenuation`. The light inside the range keeps its physical
/// falloff, which the integral already holds.
fn range_window(gap: f32, range: f32) -> f32 {
    let ratio2 = square(gap / range);
    return square(saturate(1.0 - ratio2 * ratio2));
}

/// The light that a PBR surface reflects from a rectangle of uniform radiance `color`, which the
/// light gives out on the side that its corners wind counterclockwise toward. `toward` is the
/// rectangle's middle relative to the surface, and `half_width` and `half_height` its half sides.
/// `terms` come from `area_terms` for the surface's view and roughness. `image` is the layer of
/// the light's image, or a negative number for a light of one color.
fn rectangle_light(
    m: PbrMaterial,
    terms: AreaTerms,
    normal: vec3f,
    to_view: vec3f,
    toward: vec3f,
    half_width: vec3f,
    half_height: vec3f,
    color: vec3f,
    image: i32,
) -> Reflected {
    var corners = array<vec3f, 4>(
        toward + half_width - half_height,
        toward - half_width - half_height,
        toward - half_width + half_height,
        toward + half_width + half_height,
    );
    // A surface behind the rectangle's plane gets none of its light.
    let facing = cross(corners[1] - corners[0], corners[3] - corners[0]);
    if dot(facing, corners[0]) > 0.0 {
        return Reflected(vec3f(0.0), vec3f(0.0));
    }
    // A frame around the normal, with its first axis toward the view, as the tables assume.
    let along = to_view - normal * dot(to_view, normal);
    let length2 = dot(along, along);
    let first = select(any_perpendicular(normal), along * inverseSqrt(length2), length2 > 1e-12);
    let second = -cross(normal, first);
    for (var i = 0u; i < 4u; i++) {
        let c = corners[i];
        corners[i] = vec3f(dot(first, c), dot(second, c), dot(normal, c));
    }
    let diffuse = quad_form_factor(corners);
    var diffuse_color = color;
    if image >= 0 {
        diffuse_color *= image_seen(corners, image);
    }
    let inverse = mat3x3f(
        vec3f(terms.inverse.x, 0.0, terms.inverse.y),
        vec3f(0.0, 1.0, 0.0),
        vec3f(terms.inverse.z, 0.0, terms.inverse.w),
    );
    for (var i = 0u; i < 4u; i++) {
        corners[i] = inverse * corners[i];
    }
    let specular = quad_form_factor(corners);
    var specular_color = color;
    if image >= 0 {
        specular_color *= image_seen(corners, image);
    }
    // Stephen Hill's Fresnel term for LTC, as three.js gives it.
    let fresnel = m.specular_blended * terms.fresnel.x
        + (m.specular_grazing - m.specular_blended) * terms.fresnel.y;
    return Reflected(diffuse_color * m.diffuse * diffuse, specular_color * fresnel * specular);
}

/// The light that a PBR surface reflects from a tube of uniform radiance `color`. `toward` is the
/// tube's middle relative to the surface, `half_axis` half its axis, and `radius` its radius. The
/// tube shades as the rectangle through its axis that faces the surface (see the module notes).
fn tube_light(
    m: PbrMaterial,
    terms: AreaTerms,
    normal: vec3f,
    to_view: vec3f,
    toward: vec3f,
    half_axis: vec3f,
    radius: f32,
    color: vec3f,
) -> Reflected {
    // The side points across the tube, at right angles to the axis and to the way to the surface,
    // with the winding that makes the rectangle face the surface.
    let across = cross(toward, half_axis);
    let length2 = dot(across, across);
    let side = select(any_perpendicular(normalize(half_axis)), across * inverseSqrt(length2), length2 > 1e-12);
    return rectangle_light(m, terms, normal, to_view, toward, half_axis, side * radius, color, -1);
}
