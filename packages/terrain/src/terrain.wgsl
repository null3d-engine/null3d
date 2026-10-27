// The ground's surface: up to four tiled color maps blended by a splat map, so grass, rock, soil
// and snow meet in bands over the same ground. The splat map's red, green, blue and alpha channels
// are the four weights, and each layer's map repeats over its own number of meters.
//
// Each layer also carries a height, from its map's brightness or its alpha channel. A layer's
// height pushes it through the layers beside it where two weights meet, so rock shows through the
// grass along a boundary rather than fading into it. The layer's own texels set the height, so the
// boundary follows their detail.
//
// The pixel's normal comes from a normal map baked over the ground, which keeps the relief that a
// coarse block's vertices cannot show. The surface reads the ground's own coordinates, so the
// tiling and the normals stay put as the camera moves and the blocks of the level of detail meet
// without a seam.
var splatMap: texture_2d<f32>;
var layerZero: texture_2d<f32>;
var layerOne: texture_2d<f32>;
var layerTwo: texture_2d<f32>;
var layerThree: texture_2d<f32>;
var normalMap: texture_2d<f32>;

struct Uniforms {
    // The meters that one repeat of each layer's map covers.
    tiles: vec4f,
    // Each layer's roughness, from 0 to 1.
    layerRoughness: vec4f,
    // x and y: the ground's width and depth in meters; z: its metalness; w: 1 while the baked
    // normals light the ground, and 0 for the mesh's own normals.
    ground: vec4f,
    // How strongly each layer's own height pushes it through its neighbours, from 0 to 1.
    layerContrast: vec4f,
    // 1 where a layer's height comes from its map's alpha channel, and 0 for its brightness.
    layerAlpha: vec4f,
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let at = input.worldPosition.xz;
    let uv = at / material.ground.xy + vec2f(0.5);
    let weights = textureSample(splatMap, splatMapSampler, uv);
    let c0 = textureSample(layerZero, layerZeroSampler, at / material.tiles.x);
    let c1 = textureSample(layerOne, layerOneSampler, at / material.tiles.y);
    let c2 = textureSample(layerTwo, layerTwoSampler, at / material.tiles.z);
    let c3 = textureSample(layerThree, layerThreeSampler, at / material.tiles.w);
    // A layer's height: the brightness of its texel, which rises where the texel looks higher, or
    // its alpha channel where the map keeps a height there. Mid darkness stands at the meeting.
    // `sqrt` spreads the linear brightness the way the eye reads it, so dark grass and bright rock
    // differ as much here as they look.
    let heights = vec4f(
        mix(sqrt(dot(c0.rgb, vec3f(0.2126, 0.7152, 0.0722))), c0.a, material.layerAlpha.x),
        mix(sqrt(dot(c1.rgb, vec3f(0.2126, 0.7152, 0.0722))), c1.a, material.layerAlpha.y),
        mix(sqrt(dot(c2.rgb, vec3f(0.2126, 0.7152, 0.0722))), c2.a, material.layerAlpha.z),
        mix(sqrt(dot(c3.rgb, vec3f(0.2126, 0.7152, 0.0722))), c3.a, material.layerAlpha.w),
    );
    // A layer's height acts in share of the weight that the splat map gives it, so a bright rock
    // texel never appears across a meadow where the rock layer has no place, and the effect fades
    // in smoothly along the outer edge of a layer's band.
    let present = sqrt(weights);
    var blend = max(
        weights + (heights - vec4f(0.5)) * material.layerContrast * present,
        vec4f(0.0),
    );
    var total = blend.x + blend.y + blend.z + blend.w;
    if (total < 0.0001) {
        // Every layer sank under the others, so the weights alone decide.
        blend = weights;
        total = max(weights.x + weights.y + weights.z + weights.w, 0.00001);
    }
    let color = (c0.rgb * blend.x + c1.rgb * blend.y + c2.rgb * blend.z + c3.rgb * blend.w) / total;
    let rough = (material.layerRoughness.x * blend.x + material.layerRoughness.y * blend.y
        + material.layerRoughness.z * blend.z + material.layerRoughness.w * blend.w) / total;
    s.baseColor *= color;
    s.roughness = rough;
    s.metalness = material.ground.z;
    // The baked normal stores x and z, each from -1 to 1 remapped to 0 to 1, and the unit length
    // rebuilds y. A back face turns it toward the camera, as a double-sided surface asks.
    let encoded = textureSample(normalMap, normalMapSampler, uv).rg * 2.0 - 1.0;
    let rise = sqrt(max(1.0 - dot(encoded, encoded), 0.0));
    let baked = vec3f(encoded.x, rise, encoded.y) * select(-1.0, 1.0, input.frontFacing);
    s.normal = normalize(mix(input.normal, baked, material.ground.w));
    return s;
}
