// The surface of a plant drawn from the generated atlases: a trunk's bark or a crown's leaves. The
// colour map multiplies the species' colour, the surface map bends the light with its normal, and
// the leaf's coverage cuts its outline. The engine's mip levels keep a card sharp where it covers
// many texels and keep its leaves' coverage where it covers few.

var barkColor: texture_2d<f32>;
var barkSurface: texture_2d<f32>;
var leafColor: texture_2d<f32>;
var leafSurface: texture_2d<f32>;

struct Uniforms {
    /// The leaf atlas's cells across and down.
    cells: vec2f,
    /// The leaf cell that this material draws: its column and row.
    cell: vec2f,
    /// 0 draws a trunk's bark and 1 a crown's leaves.
    part: f32,
    /// How many times the bark tiles across the mesh's texture coordinates.
    tiles: f32,
    /// The linear colour that multiplies the atlas's own, such as a species' colour.
    tint: vec3f,
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let leafPart = material.part > 0.5;

    // A texture sample belongs to uniform control flow, so every map is read and the part picks one
    // afterwards. A leaf's card reads its own cell of the atlas, and the bark tiles.
    let leafPlace = (material.cell + clamp(input.uv, vec2f(0.0), vec2f(1.0))) / material.cells;
    let barkPlace = input.uv * material.tiles;
    let leafColorSample = textureSample(leafColor, leafColorSampler, leafPlace);
    let leafSurfaceSample = textureSample(leafSurface, leafSurfaceSampler, leafPlace);
    let barkColorSample = textureSample(barkColor, barkColorSampler, barkPlace);
    let barkSurfaceSample = textureSample(barkSurface, barkSurfaceSampler, barkPlace);
    let color = select(barkColorSample, leafColorSample, leafPart);
    let surfaceMap = select(barkSurfaceSample, leafSurfaceSample, leafPart);

    // The normal's x and y come from the surface map, and its z from the unit length it must keep.
    let flat = surfaceMap.xy * 2.0 - vec2f(1.0);
    let nz = sqrt(max(0.0, 1.0 - dot(flat, flat)));
    // A frame from the mesh's own normal: its up is the world's up, or the world's z for a surface
    // that faces the sky. A card carries no tangent, and a leaf's markings need none to read.
    let normal = normalize(input.normal);
    let up = select(vec3f(0.0, 0.0, 1.0), vec3f(0.0, 1.0, 0.0), abs(normal.y) < 0.95);
    let across = normalize(cross(up, normal));
    let along = cross(normal, across);
    s.normal = normalize(across * flat.x + along * flat.y + normal * nz);
    s.baseColor = color.rgb * material.tint;
    s.metalness = 0.0;
    if (leafPart) {
        // The surface map's blue holds the leaf's coverage, and its alpha the leaf's thickness.
        s.alpha = surfaceMap.b;
        s.roughness = 0.62;
        // How much of the light behind the leaf passes through it, for the material that lights it.
        s.thickness = surfaceMap.a * 0.35;
    } else {
        s.roughness = surfaceMap.b;
    }
    return s;
}
