// Car paint: a metallic base under the engine's clear coat, with metal flakes, panel seams and an
// optional carbon weave. The flakes are the metal's own microfacets: the lobe counts how many of
// them reflect the main light into the eye at each pixel, as Deliot and Belcour's glint model, so
// the paint sparkles where the light is and smooths as a cell shrinks below a pixel. A seam is a
// groove whose share of a pixel keeps it as wide as a pixel, and the weave shapes each tow's
// normal so that its highlight runs along the tow.
#import null3d::noise::{random2}
#import null3d::math::{PI}

struct Uniforms {
    // The distance between the panel seams along each texture coordinate, in that coordinate.
    seamSpacing: vec2f,
    // How many flake cells cross each texture coordinate.
    flakeCells: vec2f,
    // How many weave cells cross each texture coordinate.
    weaveCells: vec2f,
    // How wide the flakes' normals spread from the surface normal, from 0 for none.
    flakeTilt: f32,
    // The angular radius of the main light in radians, which sets how many flakes reflect it.
    flakeAngle: f32,
    // The most that one pixel's glint may exceed the smooth lobe, which bounds a firefly.
    flakeMax: f32,
    // The seam groove: its half width in the texture coordinates, and how dark it draws.
    seamWidth: f32,
    seamShade: f32,
    // How far each tow of the weave shapes its highlight, from 0 for a flat one.
    weaveShine: f32,
}

/// The surface's tangent frame: its unit tangent along the first texture coordinate, and the
/// bitangent that crosses it.
struct PaintFrame {
    tangent: vec3f,
    bitangent: vec3f,
}

/// The surface's tangent frame, from the derivatives of its position and its texture coordinates.
/// A surface whose coordinates collapse takes a frame from the screen's derivatives instead.
fn paint_frame(input: SurfaceInput, normal: vec3f) -> PaintFrame {
    let across = dpdx(input.worldPosition);
    let along = dpdy(input.worldPosition);
    let across_uv = dpdx(input.uv);
    let along_uv = dpdy(input.uv);
    var tangent = vec3f(0.0);
    let det = across_uv.x * along_uv.y - along_uv.x * across_uv.y;
    if abs(det) > 1e-9 {
        let pulled = (across * along_uv.y - along * across_uv.y) / det;
        tangent = pulled - normal * dot(pulled, normal);
    }
    if length(tangent) < 1e-5 {
        tangent = cross(normal, vec3f(0.0, 1.0, 0.0));
        if length(tangent) < 1e-5 {
            tangent = cross(normal, vec3f(1.0, 0.0, 0.0));
        }
    }
    let unit = normalize(tangent);
    return PaintFrame(unit, normalize(cross(normal, unit)));
}

/// The weave at a point: the tow's cross-section as a slope along each texture coordinate, and how
/// far the point lies on a tow rather than in the gap between them.
struct Weave {
    bend: vec2f,
    cover: f32,
}

fn weave_at(uv: vec2f, cells: vec2f) -> Weave {
    let q = uv * cells;
    let cell = floor(q);
    let f = fract(q);
    // A 2 x 2 twill: two cells run one way, then two the other.
    let along_first = (cell.x + 2.0 * cell.y) % 4.0 < 2.0;
    // Across the tow, the tow is a rounded ridge, so its slope follows the cosine of the position.
    let across = select(f.x, f.y, along_first);
    let slope = -cos(across * PI);
    let cover = smoothstep(0.0, 0.18, min(across, 1.0 - across));
    let bend = select(vec2f(slope, 0.0), vec2f(0.0, slope), along_first);
    return Weave(bend, cover);
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    // The coat's values come from the material's own options. Naming them here builds the shaders
    // that light the layers for every paint, whatever parts the look turns on.
    s.clearcoat = s.clearcoat;
    s.clearcoatRoughness = s.clearcoatRoughness;
    let normal = normalize(input.normal);
    let frame = paint_frame(input, normal);

    // The derivatives of a pattern come before any branch: a derivative belongs to uniform control
    // flow, so a branch that a uniform value takes still may not hold one. The flakes' footprint in
    // cells and the block of cells that the pixel covers give the lobe its count and its random
    // value.
    let flake_q = input.uv * material.flakeCells;
    let flake_step = vec2f(length(dpdx(flake_q)), length(dpdy(flake_q)));
    let flake_block = floor(flake_q / max(flake_step, vec2f(1.0)));
    let flake_seed = random2(flake_block);
    // A seam family whose spacing is 0 draws no seam, and its distance stays far away. Both
    // families' distances run, so the pixel width below has no branch either.
    let spacing_x = max(material.seamSpacing.x, 1e-6);
    let spacing_y = max(material.seamSpacing.y, 1e-6);
    let fu = fract(input.uv.x / spacing_x);
    let fv = fract(input.uv.y / spacing_y);
    let du = select(1e9, min(fu, 1.0 - fu) * spacing_x, material.seamSpacing.x > 0.0);
    let dv = select(1e9, min(fv, 1.0 - fv) * spacing_y, material.seamSpacing.y > 0.0);
    let side_u = select(-1.0, 1.0, fu < 0.5);
    let side_v = select(-1.0, 1.0, fv < 0.5);
    let seam = min(du, dv);
    let seam_pixel = fwidth(seam);

    // The flakes' four values for the lobe: the footprint, the tilt and the block's random value.
    // The lobe does the counting where it knows the light; the surface only says where they are.
    if material.flakeTilt > 0.0 {
        s.lobe = vec4f(flake_step, material.flakeTilt, flake_seed);
    }

    // The panel seams: narrow grooves at each multiple of the spacing. The groove's share of a
    // pixel stops it from drawing thinner than a pixel, so it never crawls as the car moves. The
    // coat follows the groove, which catches an edge of light.
    if material.seamWidth > 0.0 {
        let width = material.seamWidth;
        let share = clamp(width / max(seam_pixel, 1e-6), 0.0, 1.0);
        let line = 1.0 - smoothstep(width * 0.5, width, seam);
        let depth = material.seamShade * share * line;
        s.baseColor *= 1.0 - depth;
        s.clearcoatRoughness = mix(s.clearcoatRoughness, 0.55, depth);
        let across = select(frame.bitangent * side_v, frame.tangent * side_u, du < dv);
        s.clearcoatNormal = normalize(normal + across * depth * 1.5);
    }

    // The carbon weave: rounded tows in a twill. A tow's normal slopes across it and stays level
    // along it, so its highlight runs along the tow and the two directions of the twill shine
    // their own way.
    if material.weaveCells.x > 0.0 {
        let weave = weave_at(input.uv, material.weaveCells);
        let bend = frame.tangent * weave.bend.x + frame.bitangent * weave.bend.y;
        s.normal = normalize(s.normal + bend * (0.35 * material.weaveShine));
        s.baseColor *= mix(0.45, 1.0, weave.cover);
        let gloss = max(s.roughness - 0.12 * material.weaveShine, 0.04);
        s.roughness = mix(min(s.roughness + 0.3, 1.0), gloss, weave.cover);
    }
    return s;
}

/// The flakes' glint: how many of the metal's facets reflect the main light into the eye at this
/// pixel, from the binomial distribution of Deliot and Belcour's model. The base lobe's specular is
/// replaced by the flakes' own light, so the paint sparkles where the light is and nowhere else.
fn lobe(input: LobeInput) -> vec3f {
    let tilt = input.values.z;
    if tilt <= 0.0 {
        return vec3f(0.0);
    }
    // A flake's normal lies within a cap around the surface normal, whose width the tilt sets.
    let cap = atan(tilt * 1.4142136);
    let cap_cos = cos(cap);
    if dot(input.normal, input.half) < cap_cos {
        // No flake faces the light here, so the smooth lobe is not the paint's alone.
        return -input.specular;
    }
    let facets = max(input.values.x * input.values.y, 1.0);
    let light_cos = max(dot(input.half, input.light), 1e-4);
    let solid = 2.0 * PI * (1.0 - cos(max(material.flakeAngle, 1e-4)));
    let density = 1.0 / (2.0 * PI * max(1.0 - cap_cos, 1e-6));
    let chance = min(density * solid / (4.0 * light_cos), 1.0);
    let expected = facets * chance;
    let u1 = random2(vec2f(input.values.w * 65535.0, 0.0));
    let u2 = random2(vec2f(input.values.w * 65535.0, 1.0));
    let deviation = sqrt(-2.0 * log(max(u1, 1e-6))) * cos(2.0 * PI * u2);
    let count = clamp(expected + sqrt(expected * (1.0 - chance)) * deviation, 0.0, facets);
    let factor = min(count / max(expected, 1e-8), material.flakeMax);
    return input.specular * (factor - 1.0);
}
