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
//
// The branch turns come from one of two sources. The vertex offset works each turn out itself, from
// the branch records, which a plant's page blends into the picture at every distance. Or it reads
// the turn that a compute pass wrote once for every branch of every near tree, which lets a branch
// spring back after a gust. The wind's strength names which, and the branch data texture holds the
// records in the first case and the pass's poses in the second.

#import null3d::noise::{value3}

var barkColor: texture_2d<f32>;
var barkSurface: texture_2d<f32>;
var leafColor: texture_2d<f32>;
var leafSurface: texture_2d<f32>;
// The plant's branch data: four texels of branch records for each branch, fetched by the branch
// index that the vertex colours carry, or, when a compute pass writes the turns, the pose table
// that the pass fills. A data texture serves it, since a WebGL2 vertex shader reads no uniform array
// at the draw's index.
var branchData: texture_2d_array<f32>;

// The one sampling function for a reader of the wind field. A material that already has its own
// WGSL, such as a plant's leaf material, copies the block between the markers into its own file.
// The shader build resolves only the engine's library, so a shader cannot import another shader of
// the add-on; a test compares each copy with this one and fails when one is edited alone.
//
// A reader declares the field's texture, and the engine declares its sampler beside it:
var wind: texture_2d_array<f32>;

// <wind-steady>
/// The height over which the air slows to the ground, in meters.
const WIND_GROUND_HEIGHT: f32 = 2.0;
/// The distance over which the noise's curl is measured, in noise cells.
const WIND_CURL_STEP: f32 = 0.02;
/// The height that the grid samples at, where the air moves at its full speed. The grid stores the
/// air at this height, and a reader outside the grid's box works it out at the same height, so the
/// two meet at the box's edge.
const WIND_FULL_HEIGHT: f32 = 100.0;

/// The air's steady settings: its rule of place and time, without the pushes and gusts that a page
/// sends. The grid takes them from a pass's first three value vectors, and a reader from its own
/// uniforms.
struct WindAir {
    /// The time in seconds, the wind's speed and its heading in radians, and how much slower the
    /// air is at the ground.
    time: f32,
    speed: f32,
    heading: f32,
    ground: f32,
    /// The gust's strength, its radius in meters, its wave number and how fast it travels.
    gustStrength: f32,
    gustRadius: f32,
    gustWave: f32,
    gustSpeed: f32,
    /// The swirl's strength, its size, how fast its pattern drifts and its seed.
    swirl: f32,
    swirlScale: f32,
    swirlDrift: f32,
    seed: f32,
}

/// The field's settings read from three value vectors: the air, the gust and the swirl.
fn wind_air(v0: vec4f, v1: vec4f, v2: vec4f) -> WindAir {
    var air: WindAir;
    air.time = v0.x;
    air.speed = v0.y;
    air.heading = v0.z;
    air.ground = v0.w;
    air.gustStrength = v1.x;
    air.gustRadius = v1.y;
    air.gustWave = v1.z;
    air.gustSpeed = v1.w;
    air.swirl = v2.x;
    air.swirlScale = v2.y;
    air.swirlDrift = v2.z;
    air.seed = v2.w;
    return air;
}

/// The height's factor of the wind: one at the top, and one less the ground's share at the ground.
fn wind_profile(air: WindAir, y: f32) -> f32 {
    return 1.0 - air.ground * exp(-max(y, 0.0) / WIND_GROUND_HEIGHT);
}

/// The stream function of the swirl, in noise cells, at a place and a time.
fn wind_stream(air: WindAir, p: vec3f) -> f32 {
    let drift = air.swirlDrift * air.time;
    let q = vec3f(
        p.x * air.swirlScale + drift + air.seed,
        p.y * air.swirlScale,
        p.z * air.swirlScale + drift * 0.5,
    );
    return value3(q);
}

/// The wind's steady velocity at a world place, in meters a second: the base wind, the gust that
/// travels through it and the swirl, without the pushes and gusts that a page sends.
fn wind_steady(air: WindAir, p: vec3f) -> vec3f {
    let height = wind_profile(air, p.y);
    let cosHeading = cos(air.heading);
    let sinHeading = sin(air.heading);
    var v = vec3f(cosHeading * air.speed * height, 0.0, sinHeading * air.speed * height);

    // The gust: a wave of turns that travels along the heading. The turns are rings about the
    // gust's center and depend only on the distance to it, so a ring of air turns without piling up.
    let travel = air.gustSpeed * air.time;
    let g = vec2f(p.x - cosHeading * travel, p.z - sinHeading * travel);
    let distance = length(g) / air.gustRadius;
    let reach = distance * distance;
    if (reach < 9.0) {
        let envelope = exp(-reach) * cos(distance * air.gustWave) * air.gustStrength * height;
        v.x += (g.y / air.gustRadius) * envelope;
        v.z -= (g.x / air.gustRadius) * envelope;
    }

    // The swirl: the curl of one stream function in the ground plane. The function varies slowly,
    // so a short step measures the slope.
    let step = WIND_CURL_STEP / air.swirlScale;
    let front = wind_stream(air, p + vec3f(0.0, 0.0, step));
    let back = wind_stream(air, p - vec3f(0.0, 0.0, step));
    let right = wind_stream(air, p + vec3f(step, 0.0, 0.0));
    let left = wind_stream(air, p - vec3f(step, 0.0, 0.0));
    let scale = air.swirl * height / (2.0 * step);
    v.x += (front - back) * scale;
    v.z -= (right - left) * scale;
    return v;
}
// </wind-steady>

// <wind-sample>
/// The air's steady settings as a reader holds them: the base wind in the first vector, the gust in
/// the second and the swirl in the third, with the time that the reader's own frame gives.
fn wind_reading(base: vec4f, gust: vec4f, swirl: vec4f, time: f32) -> WindAir {
    var air: WindAir;
    air.time = time;
    air.speed = base.x;
    air.heading = base.y;
    air.ground = base.z;
    air.seed = base.w;
    air.gustStrength = gust.x;
    air.gustRadius = gust.y;
    air.gustWave = gust.z;
    air.gustSpeed = gust.w;
    air.swirl = swirl.x;
    air.swirlScale = swirl.y;
    air.swirlDrift = swirl.z;
    return air;
}

/// The air at a world place: the wind across the ground in red and blue, the wind's rise in green,
/// and its speed in alpha, at the height the field's texture holds it. Inside the box the grid's
/// state gives it, with one read. Outside the box, and on a device that keeps no grid, the steady
/// field gives it, so the air carries on past the box instead of holding the box's edge.
fn wind_sample(world: vec3f, origin: vec2f, size: f32, layer: i32, air: WindAir) -> vec4f {
    if (size > 0.0) {
        let uv = (vec2f(world.x, world.z) - origin) / size;
        if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) {
            // The grid keeps the air across the ground in red and green, the pressure in blue and
            // the step of its cycle in alpha.
            let state = textureSampleLevel(wind, windSampler, uv, layer, 0.0);
            return vec4f(state.r, 0.0, state.g, length(state.rg));
        }
    }
    let v = wind_steady(air, vec3f(world.x, WIND_FULL_HEIGHT, world.z));
    return vec4f(v, length(v));
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
    /// avoids the standard value `transmission`: a custom uniform of that name is refused with
    /// E1216, because `set` would not know which value it names.
    throughLeaf: f32,
    /// The distance from the camera out to which the plant sways, in meters: 0 for every distance.
    swayDistance: f32,
    /// The branch records that the pivot texture holds.
    branches: f32,
    /// The wind field's box, across the ground in meters.
    windBox: f32,
    /// The wind's strength: 0 for a material that names no field, 1 for one that does, and 2 for one
    /// whose branch turns come from a pose pass.
    windStrength: f32,
    /// The layer of the field's texture that holds the newest state, which a page sets in each frame.
    windLayer: f32,
    /// The crown's center in the plant's own space, which bends the leaves' normals outward.
    crownCenter: vec3f,
    /// How strongly the crown's normal replaces a leaf's own normal for its diffuse light: 0 keeps
    /// the leaf's normal, and 1 lights the leaf as the crown's surface.
    crownBend: f32,
}

/// One turn, for the phases that the records and the vertex colours carry.
const TURN: f32 = 6.283185307179586;
/// How much of the crown's ambient light its deepest inside loses. The rest of the light reaches it,
/// so a shaded leaf stays green and its crown shows a fall of tone rather than a flat black.
const CROWN_SHADE: f32 = 0.55;
/// How far the trunk's top moves for each meter a second of wind, as a share of its height.
const TRUNK_BEND: f32 = 0.02;
/// How far a branch turns about its pivot for each meter a second of wind.
const BRANCH_BEND: f32 = 0.02;
/// The most branch levels that a plant may hold: a sway walks no further up its trunk.
const MAX_BRANCH_DEPTH: u32 = 8u;

/// One texel of a branch's record. Four texels a record: the pivot and the axis's x, then the axis's
/// y and z and the parent and stiffness, then the flutter's amplitude and frequency and the level and
/// the branch's length, then its sway phase.
/// The state of the pose table that this call reads, and the slot that the instance takes: the
/// first number is the state's layer, or -1 for a copy that stands past the sway distance. A page
/// may have written only one state, so the other state of a young page is empty. The motion build's
/// second call moves each vertex as the frame before did, so it reads the state of the frame before.
fn pose_place(instance: i32) -> vec2f {
    let first = textureLoad(branchData, vec2i(instance, 0), 0, 0);
    let second = textureLoad(branchData, vec2i(instance, 0), 1, 0);
    var layer = 0;
    var header = first;
    if (first.x < 0.5 && second.x >= 0.5) {
        layer = 1;
        header = second;
    }
    if (header.x < 0.5) {
        return vec2f(-1.0, 0.0);
    }
    if (frame.lastFrame) {
        let other = 1 - layer;
        let otherHeader = select(second, first, other == 0);
        if (otherHeader.x >= 0.5) {
            layer = other;
            header = otherHeader;
        }
    }
    return vec2f(f32(layer), header.x);
}

fn branch_record(branch: u32, texel: u32) -> vec4f {
    return textureLoad(branchData, vec2i(i32(branch * 4u + texel), 0), 0, 0);
}

/// `point` turned by the unit quaternion `q`.
fn quat_turn(q: vec4f, point: vec3f) -> vec3f {
    let along = cross(q.xyz, point);
    return point + 2.0 * (q.w * along + cross(q.xyz, along));
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
    // The steady settings sit in the branch data texture's second row, since a custom material's
    // uniforms hold 32 numbers and its textures 6, and the field's twelve fit in neither.
    let base = textureLoad(branchData, vec2i(0, 1), 0, 0);
    let gust = textureLoad(branchData, vec2i(1, 1), 0, 0);
    let swirl = textureLoad(branchData, vec2i(2, 1), 0, 0);
    let reading = wind_reading(base, gust, swirl, frame.time);
    let at = wind_sample(
        place,
        camera.position.xz - vec2f(material.windBox * 0.5),
        material.windBox,
        i32(material.windLayer),
        reading,
    );
    let across_air = vec2f(at.x, at.z);
    let speed = at.a;
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
    let own = u32(clamp(input.colors.r * 255.0 + 0.5, 0.0, material.branches - 1.0));
    // The flutter's width and frequency, which the record and the pose hold alike.
    var flutter = vec2f(0.0);
    // <pose-offset>
    if (material.windStrength > 1.5) {
        // The pass wrote this tree's slot in the header, and every branch's turn in its row. A tree
        // with no slot stands past the sway distance, and stands still.
        let place = pose_place(i32(input.instance));
        if (place.x < 0.0) {
            return vec3f(0.0);
        }
        let layer = i32(place.x);
        let row = 2 + i32(place.y - 0.5);
        let turn = textureLoad(branchData, vec2i(i32(own * 3u), row), layer, 0);
        let shifted = textureLoad(branchData, vec2i(i32(own * 3u + 1u), row), layer, 0);
        let soft = textureLoad(branchData, vec2i(i32(own * 3u + 2u), row), layer, 0);
        offset += quat_turn(turn, input.position) + shifted.xyz - input.position;
        flutter = vec2f(soft.y, soft.z);
    } else {
        // Each branch turns about its pivot, from the vertex's branch to the trunk, and the turns
        // carry the branches above them.
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
        let theirs = branch_record(own, 2u);
        flutter = vec2f(theirs.x, theirs.y);
    }
    // </pose-offset>
    if (leafPart) {
        // Leaves flutter across the air, each with the phase that its vertex colour carries.
        let flap = sin(frame.time * flutter.y + input.colors.g * TURN);
        let sideways = cross(downwind, vec3f(0.0, 1.0, 0.0));
        let along = length(sideways);
        if (along > 0.001) {
            // The record's flutter is the distance a leaf moves in a brisk wind.
            let brisk = clamp(speed / 10.0, 0.0, 1.5);
            offset += (sideways / along) * (flutter.x * brisk * flap);
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

/// Moves each vertex by the wind. A trunk's bark and a crown's leaves both sway, and only the leaves
/// flutter.
fn vertexOffset(input: VertexInput) -> vec3f {
    return wind_offset(input, material.part > 0.5);
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
        // A leaf's gloss is a dielectric's, four per cent at normal incidence, the engine's default
        // for an index of refraction of 1.5 and the top of a leaf's measured range, and rougher than
        // a leaf's texture suggests.
        s.roughness = mix(0.35, 0.6, surfaceMap.a);
        // Light through the leaf, about a third of its diffuse light, tinted by the leaf's own hue
        // and lifted toward yellow as the leaf turns. A leaf is about a millimeter thick.
        s.thickness = surfaceMap.a * 0.001;
        s.diffuseTransmission = material.throughLeaf;
        s.diffuseTransmissionColor = mix(s.baseColor * 1.6, vec3f(1.0, 0.7, 0.2), autumn * 0.6);
        // The inside of the crown receives less of the sky and less of the sun, and the fall from the
        // crown's surface to its axis gives it its tone. The fall stops short of none, so a leaf deep
        // in the crown keeps its green rather than turning black, as a leaf in a real crown does. A
        // mesh without the vertex data, such as a preview card, reads white and keeps its light.
        let enclosed = clamp(input.vertexColor.a, 0.0, 1.0);
        s.occlusion = 1.0 - CROWN_SHADE * enclosed * enclosed;
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
