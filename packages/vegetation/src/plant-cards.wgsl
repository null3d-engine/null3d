// The surface and the wind offset of a plant drawn from the generated atlases: a trunk's bark or a
// crown's leaves. The colour map multiplies the species' colour, the surface map bends the light
// with its normal, and the leaf's coverage cuts its outline. The engine's mip levels keep a card
// sharp where it covers many texels and keep its leaves' coverage where it covers few.
//
// The wind offset has three layers. The trunk bends as a cantilever, most at its top. Every branch
// turns about its pivot, carrying the branches above it, from the plant's branch records. The leaves
// flutter across the air, each from its stored phase. One field of air moves them all, read at the
// vertex's own place, and the whole offset fades out by the plant's sway distance so a far plant
// stands still and keeps its shadow in the far cascade's cached layer.

var barkColor: texture_2d<f32>;
var barkSurface: texture_2d<f32>;
var leafColor: texture_2d<f32>;
var leafSurface: texture_2d<f32>;
// The plant's branch records: four texels a record, fetched by the branch index that the vertex
// colours carry. A data texture serves them, since a WebGL2 vertex shader reads no uniform array at
// the draw's index.
var pivots: texture_2d<f32>;

// The one sampling function for a reader of the wind field. A material that already has its own
// WGSL, such as a plant's leaf material, copies the block between the markers into its own file.
// The shader build resolves only the engine's library, so a shader cannot import another shader of
// the add-on; a test compares each copy with this one and fails when one is edited alone.
//
// A reader declares the field's texture, and the engine declares its sampler beside it:
var wind: texture_2d_array<f32>;

// <wind-sample>
/// The air at a world place, as the texture holds it: the wind across the ground in red and blue,
/// the wind's rise in green, and its speed in alpha. The box's near corner and width place the
/// world. A place outside the box reads the box's edge.
fn wind_sample(world: vec3f, origin: vec2f, size: f32) -> vec4f {
    let uv = clamp((vec2f(world.x, world.z) - origin) / size, vec2f(0.0), vec2f(1.0));
    return textureSampleLevel(wind, windSampler, uv, 0, 0.0);
}
// </wind-sample>

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
    /// The plant's height in meters, which its trunk's bend follows.
    height: f32,
    /// How much of a leaf's diffuse light passes through it, from its species' record. The name
    /// avoids the standard value `transmission`, which a custom uniform may not take.
    throughLeaf: f32,
    /// The distance from the camera out to which the plant sways, in meters: 0 for every distance.
    swayDistance: f32,
    /// The branch records that the pivot texture holds.
    branches: f32,
    /// The wind field's box, across the ground in meters.
    windBox: f32,
    /// The wind's strength: 0 for a material that names no field, and 1 for one that does.
    windStrength: f32,
    /// The crown's center in the plant's own space, which bends the leaves' normals outward.
    crownCenter: vec3f,
    /// How strongly the crown's normal replaces a leaf's own normal for its diffuse light: 0 keeps
    /// the leaf's normal, and 1 lights the leaf as the crown's surface.
    crownBend: f32,
    /// The radius of the plant's bounding sphere about its origin, in the plant's own units,
    /// which the sketch also gives the object or batch that draws the plant.
    crownRadius: f32,
    /// The level-of-detail threshold, in screen pixels: the engine's error under which a
    /// coarser level draws.
    lodThreshold: f32,
}

/// One turn, for the phases that the records and the vertex colours carry.
const TURN: f32 = 6.283185307179586;
/// How far the trunk's top moves for each meter a second of wind, as a share of its height.
const TRUNK_BEND: f32 = 0.02;
/// How far a branch turns about its pivot for each meter a second of wind.
const BRANCH_BEND: f32 = 0.02;
/// The most branch levels that a plant may hold: a sway walks no further up its trunk.
const MAX_BRANCH_DEPTH: u32 = 8u;

/// One texel of a branch's record. Four texels a record: the pivot and the axis's x, then the axis's
/// y and z and the parent and stiffness, then the flutter's amplitude and frequency and the level and
/// the branch's length, then its sway phase.
fn branch_record(branch: u32, texel: u32) -> vec4f {
    return textureLoad(pivots, vec2i(i32(branch * 4u + texel), 0), 0);
}

/// `point` turned about the line through `pivot` along the unit `axis` by `angle` radians.
fn turn_about(point: vec3f, pivot: vec3f, axis: vec3f, angle: f32) -> vec3f {
    let arm = point - pivot;
    let c = cos(angle);
    let s = sin(angle);
    return pivot + arm * c + cross(axis, arm) * s + axis * dot(axis, arm) * (1.0 - c);
}

/// The wind's offset of a plant's vertex, in the mesh's own space. It fades to nothing at the
/// plant's sway distance, so a plant past it stands still.
fn wind_offset(input: VertexInput, leafPart: bool) -> vec3f {
    if (material.windStrength <= 0.0 || material.branches < 1.0) {
        return vec3f(0.0);
    }
    // The plant's whole crown fades together, from its origin's distance to the camera.
    var fade = 1.0;
    if (material.swayDistance > 0.0) {
        let away = length(object.position - camera.position);
        fade = 1.0 - smoothstep(material.swayDistance * 0.8, material.swayDistance, away);
        if (fade <= 0.0) {
            return vec3f(0.0);
        }
    }
    // The air at the vertex's place. The field's box follows the camera, so its near corner is half
    // a box behind the camera across the ground.
    let place = (object.worldMatrix * vec4f(input.position, 1.0)).xyz + camera.position;
    let air = wind_sample(place, camera.position.xz - vec2f(material.windBox * 0.5), material.windBox);
    let across_air = vec2f(air.x, air.z);
    let speed = air.a;
    if (speed <= 0.0) {
        return vec3f(0.0);
    }
    // The wind's direction in the plant's own space, so a turned copy bends downwind.
    let air_local = object.normalMatrix * vec3f(across_air.x, 0.0, across_air.y);
    let reach = length(air_local);
    if (reach <= 0.00001) {
        return vec3f(0.0);
    }
    let downwind = air_local / reach;
    var offset = vec3f(0.0);
    // The trunk bends as a cantilever, most at its top.
    let rise = clamp(input.position.y / max(material.height, 0.001), 0.0, 1.0);
    offset += downwind * (rise * rise * speed * TRUNK_BEND);
    // Each branch turns about its pivot, from the vertex's branch to the trunk, and the turns carry
    // the branches above them.
    let own = u32(clamp(input.colors.r * 255.0 + 0.5, 0.0, material.branches - 1.0));
    var point = input.position;
    var branch = i32(own);
    for (var level = 0u; level < MAX_BRANCH_DEPTH; level += 1u) {
        if (branch < 0 || f32(branch) >= material.branches) {
            break;
        }
        let b = u32(branch);
        let first = branch_record(b, 0u);
        let second = branch_record(b, 1u);
        let third = branch_record(b, 2u);
        let fourth = branch_record(b, 3u);
        let pivot = first.xyz;
        let axis = normalize(vec3f(first.w, second.x, second.y) + vec3f(0.0, 1.0, 0.0) * 0.000001);
        let across = cross(axis, downwind);
        let cross_reach = length(across);
        if (cross_reach > 0.001) {
            // A branch turns across the air, so one that lies along the wind hardly moves.
            let swing = sin(frame.time * third.y + fourth.x);
            let angle = second.w * speed * BRANCH_BEND * swing;
            point = turn_about(point, pivot, across / cross_reach, angle);
        }
        branch = i32(second.z + 0.5);
    }
    offset += point - input.position;
    if (leafPart) {
        // Leaves flutter across the air, each with the phase that its vertex colour carries.
        let theirs = branch_record(own, 2u);
        let flap = sin(frame.time * theirs.y + input.colors.g * TURN);
        let sideways = cross(downwind, vec3f(0.0, 1.0, 0.0));
        let along = length(sideways);
        if (along > 0.001) {
            // The record's flutter is the distance a leaf moves in a brisk wind.
            let brisk = clamp(speed / 10.0, 0.0, 1.5);
            offset += (sideways / along) * (theirs.x * brisk * flap);
        }
    }
    return offset * fade;
}

/// The crown's outward normal at a world place: the direction from the crown's centre, so a crown
/// lights as the volume it stands for rather than as the cards that draw it.
fn crown_normal(world: vec3f) -> vec3f {
    let centre = (object.worldMatrix * vec4f(material.crownCenter, 1.0)).xyz + camera.position;
    return normalize(world - centre + vec3f(0.0, 0.0001, 0.0));
}

/// Moves each vertex by the wind, and morphs a leaf card toward its next level's place before the
/// engine switches, so a card that the level drops shrinks and a kept one grows.
fn vertexOffset(input: VertexInput) -> vec3f {
    let moved = wind_offset(input, true);
    // The card's record holds its place at the next level, then that level's error. The switch
    // distance is the error times the copy's world scale and the engine's factor: the render height
    // times the projection's [1][1], over twice the threshold. The distance is to the nearest point
    // of the plant's bounding sphere, and the mix runs over the last eighth of it, the band that a
    // level fade covers.
    let error = input.vertexRecord.w;
    if (error <= 0.0) {
        return moved;
    }
    let factor = frame.resolution.y * abs(camera.projection[1][1]) / (2.0 * material.lodThreshold);
    let scale = max(
        length(object.worldMatrix[0].xyz),
        max(length(object.worldMatrix[1].xyz), length(object.worldMatrix[2].xyz)),
    );
    let handover = error * scale * factor;
    let radius = material.crownRadius * scale;
    let away = max(length(camera.position - object.position) - radius, 0.001);
    let band = handover * 0.08;
    let t = clamp((away - (handover - band)) / max(band, 0.0001), 0.0, 1.0);
    return moved + (input.vertexRecord.xyz - input.position) * t;
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
    let leafNormal = normalize(across * flat.x + along * flat.y + normal * nz);

    // The row values carry the copy's tint and its autumn. A mesh without them, such as a plain card,
    // keeps the species' own colour and stays green.
    let treeTint = select(vec3f(1.0), object.values.rgb, any(object.values.rgb != vec3f(0.0)));
    let autumn = select(0.0, object.values.w, any(object.values.rgb != vec3f(0.0)));

    s.baseColor = color.rgb * material.tint * treeTint;
    s.metalness = 0.0;
    if (leafPart) {
        // The surface map's blue holds the leaf's coverage, and its alpha the leaf's thickness.
        s.alpha = surfaceMap.b;
        // A leaf's gloss is a dielectric's, about three per cent at normal incidence, and rougher
        // than a leaf's texture suggests.
        s.roughness = mix(0.35, 0.6, surfaceMap.a);
        // Light through the leaf, about a third of its diffuse light, tinted by the leaf's own hue
        // and lifted toward yellow as the leaf turns. A leaf is about a millimeter thick.
        s.thickness = surfaceMap.a * 0.001;
        s.diffuseTransmission = material.throughLeaf;
        s.diffuseTransmissionColor = mix(s.baseColor * 1.6, vec3f(1.0, 0.7, 0.2), autumn * 0.6);
        // The inside of the crown receives less of the sky and less of the sun. A mesh without the
        // vertex data, such as a preview card, reads white and keeps the light.
        let windy = step(input.vertexColor.r, 0.999);
        s.occlusion = mix(0.0, 1.0 - input.vertexColor.a, windy);
        // The diffuse light follows the crown's volume, so a crown reads as a shape rather than as a
        // scatter of cards. The leaf keeps its own normal for its gloss and the light through it.
        s.normal = leafNormal;
        s.diffuseNormal = normalize(mix(leafNormal, crown_normal(input.worldPosition), material.crownBend));
        // Autumn shifts a leaf's colour toward yellow, brightens it and dries its surface.
        let turned = mix(s.baseColor, s.baseColor * vec3f(1.5, 1.1, 0.35), autumn * 0.8);
        s.baseColor = turned;
        s.roughness = mix(s.roughness, 0.7, autumn);
    } else {
        // A trunk lights by its own normal, as a leaf's gloss does.
        s.normal = leafNormal;
        s.diffuseNormal = leafNormal;
        s.roughness = surfaceMap.b;
    }
    return s;
}
