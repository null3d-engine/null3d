// The ground's surface: up to four tiled color maps blended by a splat map, so grass, rock, soil
// and snow meet in bands over the same ground. The splat map's red, green, blue and alpha channels
// are the four weights, and each layer's map repeats over its own number of meters.
//
// Each layer also carries a height, from its map's brightness or its alpha channel. A layer's
// height pushes it through the layers beside it where two weights meet, so rock shows through the
// grass along a boundary rather than fading into it. The layer's own texels set the height, so the
// boundary follows their detail.
//
// Every block of one level draws one shared grid, as a row of that level's instance batch. The
// vertex shader takes each vertex's height, its normal and its parent block's height from the
// height field, which the ground keeps in a texture, one 32-bit float in the four bytes of each
// texel. The pixel's normal comes from those vertex normals, or from a normal map baked over the
// ground, which keeps the relief that a coarse block's vertices cannot show. The surface reads the ground's own coordinates, so the
// tiling and the normals stay put as the camera moves and the blocks of the level of detail meet
// without a seam.
var splatMap: texture_2d<f32>;
var layerZero: texture_2d<f32>;
var layerOne: texture_2d<f32>;
var layerTwo: texture_2d<f32>;
var layerThree: texture_2d<f32>;
// The ground's maps, one texel for each height sample: the height field in layer 0, each texel's
// four bytes holding one sample's 32-bit float, and the baked normals in layer 1 where the ground
// bakes them. One texture array holds both, since a custom material samples six textures at most.
var groundMaps: texture_2d_array<f32>;

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
    // 1 when steep faces map the rock layer from the sides, and 0 for a map laid from above alone.
    steepFaces: f32,
    // x: the selection's scale, in screen pixels per world meter of a block's cell, or 0 to leave
    // every block where it is; y: the faces along each side of a block's grid.
    selection: vec2f,
}

// The shared grid's vertex record holds, for every vertex, how far it hangs below the block's edge
// as part of the skirt (0 inside the grid), the block's size in meters and the size of its parent
// block, which is the block's own size for the root. A row's values hold the lowest and highest
// height of its block's ground. The grid's positions span the level's height box, so the batch
// culls each block by that box, and the vertex shader moves every vertex onto the ground.

// The height field's sample at a column and row: the 32-bit float that the texel's four bytes hold.
fn fieldSample(col: i32, row: i32) -> f32 {
    // The read samples the texel's own centre at the top level, through the sampler that the
    // surface reads the normals with: a WebGL2 program samples a texture through one sampler only.
    // At a texel's centre the filter takes that texel alone, and the rounding below keeps each
    // byte whole. The bytes join by hand: GLSL ES 3.00, which WebGL2 runs, has no `pack4x8unorm`.
    let size = vec2f(textureDimensions(groundMaps));
    let at = (vec2f(f32(col), f32(row)) + vec2f(0.5)) / size;
    let b = vec4u(round(textureSampleLevel(groundMaps, groundMapsSampler, at, 1, 0.0) * 255.0));
    return bitcast<f32>(b.x | (b.y << 8u) | (b.z << 16u) | (b.w << 24u));
}

// The height field at a point given in samples from the ground's low corner, with bilinear
// interpolation between the four samples around it, as the ground's `heightAt` reads it.
fn fieldHeightAt(fx: f32, fz: f32) -> f32 {
    let last = i32(textureDimensions(groundMaps).x) - 2;
    let cx = clamp(i32(floor(fx)), 0, last);
    let cz = clamp(i32(floor(fz)), 0, last);
    let tx = clamp(fx - f32(cx), 0.0, 1.0);
    let tz = clamp(fz - f32(cz), 0.0, 1.0);
    let a = fieldSample(cx, cz);
    let b = fieldSample(cx + 1, cz);
    let c = fieldSample(cx, cz + 1);
    let d = fieldSample(cx + 1, cz + 1);
    let top = a + (b - a) * tx;
    let bottom = c + (d - c) * tx;
    return top + (bottom - top) * tz;
}

// The meters between two samples of the height field.
fn fieldStep() -> f32 {
    return material.ground.x / f32(textureDimensions(groundMaps).x - 1u);
}

// The block's column and row in its level's grid, and the vertex's column and row in the block's
// grid, all whole numbers, so the places below stay exact.
struct BlockVertex {
    block: vec2f,
    cell: vec2f,
}

fn blockVertex(input: VertexInput) -> BlockVertex {
    let size = input.vertexRecord.y;
    var out: BlockVertex;
    out.block = round((object.position.xz + vec2f(material.ground.x * 0.5)) / size);
    out.cell = round(input.uv * material.selection.y);
    return out;
}

// The vertex's height, and the height of its parent block's surface under it, from the height
// field, as the ground's builder writes them.
fn vertexHeights(input: VertexInput, v: BlockVertex) -> vec2f {
    let size = input.vertexRecord.y;
    let parentSize = input.vertexRecord.z;
    let quads = material.selection.y;
    let step = fieldStep();
    // The vertex in meters from the ground's low corner.
    let at = v.block * size + v.cell * (size / quads);
    let own = fieldHeightAt(at.x / step, at.y / step);
    // The parent's low corner, and the vertex in the parent's grid.
    let parentCorner = floor(v.block * size / parentSize + vec2f(0.25)) * parentSize;
    let parentCell = parentSize / quads;
    let g = (at - parentCorner) / parentCell;
    let c = clamp(floor(g), vec2f(0.0), vec2f(quads - 1.0));
    let t = clamp(g - c, vec2f(0.0), vec2f(1.0));
    let p0 = (parentCorner + c * parentCell) / step;
    let p1 = (parentCorner + (c + vec2f(1.0)) * parentCell) / step;
    let h00 = fieldHeightAt(p0.x, p0.y);
    let h10 = fieldHeightAt(p1.x, p0.y);
    let h01 = fieldHeightAt(p0.x, p1.y);
    let h11 = fieldHeightAt(p1.x, p1.y);
    // The parent's faces split each cell from its low corner to its high one, as the block's own
    // grid does, so a point on either side of that diagonal takes that triangle's plane.
    var parent: f32;
    if (t.x + t.y <= 1.0) {
        parent = h00 + (h10 - h00) * t.x + (h01 - h00) * t.y;
    } else {
        parent = h11 + (h01 - h11) * (1.0 - t.x) + (h10 - h11) * (1.0 - t.y);
    }
    return vec2f(own, parent);
}

// Each block morphs toward its parent block's surface as the camera pulls away, so a block that
// hands over to a coarser one does not pop. The block's size gives its cell, which the selection's
// scale turns into the distance at which the block splits; the parent's split lies twice as far.
// The distance is the one that the selection measured: to the nearest point of the block's
// footprint and its height box, so a block's own split leaves it at its own surface and a parent's
// split leaves it at the parent's. The skirt hangs its depth below the surface that the ring moves
// to.
fn vertexOffset(input: VertexInput) -> vec3f {
    let v = blockVertex(input);
    let pair = vertexHeights(input, v);
    let block = input.vertexRecord.y;
    var t = 0.0;
    let scale = material.selection.x;
    if (scale > 0.0) {
        let half = block * 0.5;
        let center = v.block * block + vec2f(half - material.ground.x * 0.5);
        let dx = max(abs(camera.position.x - center.x) - half, 0.0);
        let dz = max(abs(camera.position.z - center.y) - half, 0.0);
        let low = object.values.x;
        let high = object.values.y;
        let dy = max(max(low - camera.position.y, camera.position.y - high), 0.0);
        let away = sqrt(dx * dx + dy * dy + dz * dz);
        let own = (block / material.selection.y) * scale;
        let parent = own * 2.0;
        t = clamp((away - own) / max(parent - own, 0.0001), 0.0, 1.0);
    }
    let y = pair.x + (pair.y - pair.x) * t - input.vertexRecord.x;
    return vec3f(0.0, y - input.position.y, 0.0);
}

// The ground's slope at the vertex, a sample each way across and along, made one unit long, as the
// ground's builder writes it. The skirt takes the normal of the ring vertex that it hangs from.
fn vertexNormal(input: VertexInput) -> vec3f {
    let v = blockVertex(input);
    let size = input.vertexRecord.y;
    let step = fieldStep();
    let at = (v.block * size + v.cell * (size / material.selection.y)) / step;
    let dx = (fieldHeightAt(at.x + 1.0, at.y) - fieldHeightAt(at.x - 1.0, at.y)) / (2.0 * step);
    let dz = (fieldHeightAt(at.x, at.y + 1.0) - fieldHeightAt(at.x, at.y - 1.0)) / (2.0 * step);
    return vec3f(-dx, 1.0, -dz) / sqrt(dx * dx + 1.0 + dz * dz);
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let at = input.worldPosition.xz;
    let uv = at / material.ground.xy + vec2f(0.5);
    let weights = textureSample(splatMap, splatMapSampler, uv);
    let c0 = textureSample(layerZero, layerZeroSampler, at / material.tiles.x);
    let c1 = textureSample(layerOne, layerOneSampler, at / material.tiles.y);
    // A steep face would stretch a map laid from above, so the third layer, the rock, also reads two
    // maps laid from the sides, blended by which way the ground faces.
    var c2 = textureSample(layerTwo, layerTwoSampler, at / material.tiles.z);
    // A material's value is not uniform to the shader's analysis, so the branch takes its derivatives
    // from outside it.
    let sideGrads = array(dpdx(input.worldPosition), dpdy(input.worldPosition));
    if material.steepFaces > 0.5 {
        let t = material.tiles.z;
        let sideX = textureSampleGrad(layerTwo, layerTwoSampler, input.worldPosition.zy / t, sideGrads[0].zy / t, sideGrads[1].zy / t);
        let sideZ = textureSampleGrad(layerTwo, layerTwoSampler, input.worldPosition.xy / t, sideGrads[0].xy / t, sideGrads[1].xy / t);
        let facing = abs(input.normal);
        let steep = smoothstep(0.75, 0.45, facing.y);
        let sideways = mix(sideX, sideZ, smoothstep(0.35, 0.65, facing.z / max(facing.x + facing.z, 0.0001)));
        c2 = mix(c2, sideways, steep);
    }
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
    // A layer's height scales the weight that the splat map gives it, so a higher texel wins the
    // meeting with a lower one and a layer keeps its place entirely where the splat map gives it
    // no weight. A contrast of 0 leaves the weights as the splat map gives them.
    let scale = vec4f(1.0 - material.layerContrast) + heights * (material.layerContrast * 2.0);
    var blend = max(weights * scale, vec4f(0.0));
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
    let encoded = textureSample(groundMaps, groundMapsSampler, uv, 0).rg * 2.0 - 1.0;
    let rise = sqrt(max(1.0 - dot(encoded, encoded), 0.0));
    let baked = vec3f(encoded.x, rise, encoded.y) * select(-1.0, 1.0, input.frontFacing);
    s.normal = normalize(mix(input.normal, baked, material.ground.w));
    return s;
}
