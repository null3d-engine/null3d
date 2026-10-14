// The ground's surface: up to four tiled color maps blended by a splat map, so grass, rock, soil
// and snow meet in soft bands over the same ground. The splat map's red, green, blue and alpha
// channels are the four weights, and each layer's map repeats over its own number of meters. The
// surface reads the ground's own coordinates, so the tiling stays put as the camera moves and the
// blocks of the level of detail meet without a seam.
var splatMap: texture_2d<f32>;
var layerZero: texture_2d<f32>;
var layerOne: texture_2d<f32>;
var layerTwo: texture_2d<f32>;
var layerThree: texture_2d<f32>;

struct Uniforms {
    // The meters that one repeat of each layer's map covers.
    tiles: vec4f,
    // Each layer's roughness, from 0 to 1.
    layerRoughness: vec4f,
    // x and y: the ground's width and depth in meters; z: its metalness; w: unused.
    ground: vec4f,
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let at = input.worldPosition.xz;
    let weights = textureSample(splatMap, splatMapSampler, at / material.ground.xy + vec2f(0.5));
    let sum = max(weights.r + weights.g + weights.b + weights.a, 1e-5);
    let color = (textureSample(layerZero, layerZeroSampler, at / material.tiles.x).rgb * weights.r
        + textureSample(layerOne, layerOneSampler, at / material.tiles.y).rgb * weights.g
        + textureSample(layerTwo, layerTwoSampler, at / material.tiles.z).rgb * weights.b
        + textureSample(layerThree, layerThreeSampler, at / material.tiles.w).rgb * weights.a) / sum;
    let rough = (material.layerRoughness.x * weights.r + material.layerRoughness.y * weights.g
        + material.layerRoughness.z * weights.b + material.layerRoughness.w * weights.a) / sum;
    s.baseColor *= color;
    s.roughness = rough;
    s.metalness = material.ground.z;
    return s;
}
