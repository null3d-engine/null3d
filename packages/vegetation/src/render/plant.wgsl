// The one plant shader, in five roles that a uniform picks: wood, shoot rows, cards, merged
// foliage and extras (cones, fruit, flowers, catkins, thorns). Every role reads the species'
// records texture, whose header holds the species' constants and whose later rows hold every
// variant's wind records.
//
// Light. A leaf is two-sided and keeps its energy: a front-lit face shows its record's reflectance,
// a back-lit leaf shows its transmittance, and the lower face draws its own texture. The texel is
// divided by its face's texture mean and scaled by the face's reflectance, so the picture keeps its
// veins and spots and its average is the record's colour. The share of the diffuse light that
// passes through comes back out of the base colour, so the front still shows the reflectance. The
// sky's light reaches a leaf through the crown's bent normal, and the crown's baked visibility
// joins screen-space occlusion by the smaller of the two, so a crown darkens once.
//
// Normals. Every role builds its tangent frame from the screen derivatives of its position and
// texture coordinates, so bark relief runs along each branch as its texture does, whatever way the
// branch points. The lower face of a leaf reads the same relief inverted, since a vein sunk above
// stands out below.
//
// Edges. A leaf's coverage is sharpened to a one-pixel edge at the cutoff, so the blade draws solid
// to its cut edge and alpha to coverage only smooths that last pixel.
//
// Space. Wood, cards and merged foliage hold 16-bit positions inside the species box, which the
// vertex offset turns into the plant's metres, so the copy's transform places them. Shoot rows hold
// their prototype's metres, and each row is one shoot placed in the world.
//
// Wind. One field of air moves every plant. The stem bends as a cantilever, each branch turns about
// its pivot carrying the branches above it, shoots bend along their length and leaves flutter. The
// offset fades to nothing by the sway distance, so a far plant stands still and keeps its cached
// shadow.

// The wind's swirl reads the engine's value noise, as the grass's copy of the block does.
#import null3d::noise::{value3}

struct Uniforms {
    // The field's box across the ground in metres, and 1 for a material that reads a field, 0 for
    // one that names none.
    windBox: f32,
    windStrength: f32,
    // The layer of the field's texture that holds the newest state, which a page sets each frame.
    windLayer: f32,
    // The distance from the camera out to which the plant sways, in metres: 0 for every distance.
    swayDistance: f32,
    // The role: 0 wood, 1 shoot rows, 2 cards, 3 merged foliage, 4 extras.
    mode: f32,
    // The distance from the camera inside which a near copy's cards give way to its real shoots.
    nearDistance: f32,
    // 1 to move the trunk's and the largest limbs' vertices by the bark's height, 0 to keep them.
    displacement: f32,
    // How far into autumn the leaves stand, from 0 for summer to 1 for turned.
    season: f32,
    // 1 to draw the plant black, with its cut-outs and its sway, for an exact outline.
    matte: f32,
}

// The wind field's state, an array of two layers.
var wind: texture_2d_array<f32>;
// The species' constants and wind records, read with textureLoad only.
var records: texture_2d<f32>;
// Bark colour (one layer a zone), leaf colour (upper, lower) or card colour (front, back).
var colour: texture_2d_array<f32>;
// Bark normal, leaf normal or card surface, in the same layers.
var relief: texture_2d_array<f32>;
// Young bark colour for wood; the near pool's copy table for shoot rows.
var second: texture_2d<f32>;
// Young bark normal for wood; young bark colour for the stems and buds of shoot rows.
var third: texture_2d<f32>;

const MODE_WOOD: i32 = 0;
const MODE_SHOOTS: i32 = 1;
const MODE_CARDS: i32 = 2;
const MODE_FOLIAGE: i32 = 3;
const MODE_EXTRAS: i32 = 4;

// The header's texels, as render/records.ts writes them; a test holds the two equal.
const HEADER_UPPER: i32 = 0;
const HEADER_LOWER: i32 = 1;
const HEADER_UPPER_THROUGH: i32 = 2;
const HEADER_LOWER_THROUGH: i32 = 3;
const HEADER_UPPER_REFLECTANCE: i32 = 4;
const HEADER_LOWER_REFLECTANCE: i32 = 5;
const HEADER_TRANSMITTANCE: i32 = 6;
const HEADER_UPPER_MEAN: i32 = 7;
const HEADER_LOWER_MEAN: i32 = 8;
const HEADER_AUTUMN_REFLECTANCE: i32 = 9;
const HEADER_AUTUMN_TRANSMITTANCE: i32 = 10;
const HEADER_BOX_MIN: i32 = 11;
const HEADER_BOX_MIN_REST: i32 = 12;
const HEADER_BOX_SPAN: i32 = 13;
const HEADER_BOX_SPAN_REST: i32 = 14;
// The steps of a quantised position along each axis of the box.
const POSITION_STEPS: f32 = 65535.0;
const HEADER_YOUNG: i32 = 15;
const HEADER_YOUNG_TILE: i32 = 16;
const HEADER_MOSS: i32 = 17;
const HEADER_MOSS_REACH: i32 = 18;
const HEADER_EXTRAS: i32 = 19;
const MAX_EXTRAS: i32 = 4;
const HEADER_BARK_ZONES: i32 = 24;
const BARK_ZONE_TEXELS: i32 = 4;
const MAX_BARK_ZONES: i32 = 4;
// Rows before the wind records, and wind records in a row.
const HEADER_ROWS: i32 = 2;
const RECORDS_PER_ROW: i32 = 256;

// Texture coordinate steps: wood in 1/1024 m of bark, leaves and cards in 1/65535 of the texture.
const WOOD_UV_STEPS: f32 = 1024.0;
const TEXTURE_UV_STEPS: f32 = 65535.0;
// The radius that the wood's second coordinates count from 0 to 1.
const WOOD_RADIUS_SPAN: f32 = 4.0;
// The coverage at which a texel counts as leaf, the materials' alpha cutoff.
const CUTOFF: f32 = 0.5;
// One turn, for the phases that the records and the vertex colours carry.
const TURN: f32 = 6.283185307179586;
// How far the stem's top moves for each metre a second of wind, as a share of its length.
const STEM_BEND: f32 = 0.02;
// How far a branch turns about its pivot, in radians, for each metre a second of wind.
const BRANCH_BEND: f32 = 0.02;
// How far a shoot's tip bends, as a share of its length, for each metre a second of wind.
const SHOOT_BEND: f32 = 0.015;
// The most records a sway walks from a vertex's own branch toward the stem.
const MAX_BRANCH_DEPTH: i32 = 8;
// The surface kind byte of a shoot's stems and buds, and of an extra.
const KIND_STEM: f32 = 85.0;
// Texels across the near table: two for each of its sixteen slots.
const NEAR_TEXELS: f32 = 32.0;
// A leaf's reflectance at normal incidence and at grazing, as the plant materials set them.
const LEAF_F0: f32 = 0.035;
const LEAF_F90: f32 = 0.875;
// How much a furrow's cavity darkens the bark's colour and raises its roughness.
const CAVITY_DARK: f32 = 0.45;
const CAVITY_ROUGH: f32 = 0.2;

/// One texel of the header row.
fn header(texel: i32) -> vec4f {
    return textureLoad(records, vec2i(texel, 0), 0);
}

/// One texel of a wind record: pivot and parent's high byte, axis and stiffness, flutter amplitude,
/// frequency, order and length, then sway phase, whip weight, spare and parent's low byte.
fn wind_record(id: i32, texel: i32) -> vec4f {
    let row = HEADER_ROWS + id / RECORDS_PER_ROW;
    let column = (id % RECORDS_PER_ROW) * 4 + texel;
    return textureLoad(records, vec2i(column, row), 0);
}

/// A record's parent, or -1 for the stem.
fn record_parent(id: i32, first: vec4f) -> i32 {
    if (first.w < 0.0) {
        return -1;
    }
    let low = wind_record(id, 3).w;
    return i32(first.w + 0.5) * 256 + i32(low + 0.5);
}

/// The role this material draws.
fn plant_mode() -> i32 {
    return i32(material.mode + 0.5);
}

/// A 16-bit position inside the species box, in the plant's metres.
fn box_point(p: vec3f) -> vec3f {
    let low = header(HEADER_BOX_MIN).xyz + header(HEADER_BOX_MIN_REST).xyz;
    let span = header(HEADER_BOX_SPAN).xyz + header(HEADER_BOX_SPAN_REST).xyz;
    return low + p * (span / POSITION_STEPS);
}

/// The wind record that a vertex's colour bytes name in their first two bytes.
fn colour_record(c: vec4f) -> i32 {
    return i32(c.r * 255.0 + 0.5) * 256 + i32(c.g * 255.0 + 0.5);
}

/// A unit vector from two octahedral numbers from -1 to 1, about the axis that `z` names.
fn octahedral(e: vec2f) -> vec3f {
    var n = vec3f(e.x, e.y, 1.0 - abs(e.x) - abs(e.y));
    if (n.z < 0.0) {
        let folded = (vec2f(1.0) - abs(n.yx)) * select(vec2f(-1.0), vec2f(1.0), n.xy >= vec2f(0.0));
        n = vec3f(folded.x, folded.y, n.z);
    }
    return normalize(n);
}

/// A shoot row's bent normal in the plant's space: octahedral with y up, x in the high nibble and
/// z in the low, a nibble n reading n / 7.5 - 1.
fn bent_normal(code: f32) -> vec3f {
    let byte = u32(code + 0.5);
    let e = vec2f(f32((byte >> 4u) & 15u), f32(byte & 15u)) / 7.5 - vec2f(1.0);
    let n = octahedral(e);
    return vec3f(n.x, n.z, n.y);
}

/// One texel of the near table, sampled at its centre: WebGL2 cannot both fetch and sample one
/// texture, and the wood role samples the same slot.
fn near_texel(texel: i32) -> vec4f {
    let at = vec2f((f32(texel) + 0.5) / NEAR_TEXELS, 0.5);
    return textureSampleLevel(second, secondSampler, at, 0.0);
}

/// A shoot row's four values, each a whole number below 2,048 or one plus a share in 64 steps, so
/// that a half float keeps it: the parent wind record over 32; its last five bits plus the flutter
/// phase; the sky visibility times 8 plus the bent normal's top three bits; the bent normal's low
/// five bits times 16 plus the near slot.
struct ShootRow {
    record: i32,
    phase: f32,
    sky: f32,
    bent: f32,
    slot: i32,
}

fn shoot_row(values: vec4f) -> ShootRow {
    var row: ShootRow;
    let low = floor(values.y);
    row.record = i32(values.x + 0.5) * 32 + i32(low + 0.5);
    row.phase = values.y - low;
    let sky = floor(values.z / 8.0);
    let high_bent = values.z - sky * 8.0;
    let low_bent = floor(values.w / 16.0);
    row.sky = sky;
    row.bent = high_bent * 32.0 + low_bent;
    row.slot = i32(values.w - low_bent * 16.0 + 0.5);
    return row;
}

/// The object's turn and scale: its world matrix without its place.
fn object_frame() -> mat3x3f {
    return mat3x3f(object.worldMatrix[0].xyz, object.worldMatrix[1].xyz, object.worldMatrix[2].xyz);
}

/// `point` turned about the line through `pivot` along the unit `axis` by `angle` radians.
fn turn_about(point: vec3f, pivot: vec3f, axis: vec3f, angle: f32) -> vec3f {
    let arm = point - pivot;
    let c = cos(angle);
    let s = sin(angle);
    return pivot + arm * c + cross(axis, arm) * s + axis * dot(axis, arm) * (1.0 - c);
}

/// A direction from the world into a copy turned by `turn` radians about +Y.
fn into_turn(v: vec3f, turn: f32) -> vec3f {
    let c = cos(turn);
    let s = sin(turn);
    return vec3f(c * v.x - s * v.z, v.y, s * v.x + c * v.z);
}

/// A direction from a copy turned by `turn` radians about +Y into the world.
fn out_of_turn(v: vec3f, turn: f32) -> vec3f {
    let c = cos(turn);
    let s = sin(turn);
    return vec3f(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
}

// <wind-steady>
/// The height over which the air slows to the ground, in meters.
const WIND_GROUND_HEIGHT: f32 = 2.0;
/// The distance over which the noise's curl is measured, in noise cells.
const WIND_CURL_STEP: f32 = 0.02;
/// How long a gust that a page sends keeps its strength, in seconds, before the air is steady again.
const WIND_SENT_LIFE: f32 = 8.0;
/// The height that the grid samples at, where the air moves at its full speed. The grid stores the
/// air at this height, and a reader outside the grid's box works it out at the same height, so the
/// two meet at the box's edge.
const WIND_FULL_HEIGHT: f32 = 100.0;

/// The air's settings: its rule of place and time, the preset's gust and the swirl, and the gust
/// that a page sends. The grid's pass takes the first three vectors from its values and solves a
/// sent gust itself; a reader takes all four from its own settings.
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
    /// The gust a page sent: its ground place in x and z, its strength in meters a second, and the
    /// time it was sent. Its strength is zero until a page sends one, and after it fades.
    sentX: f32,
    sentZ: f32,
    sentStrength: f32,
    sentBorn: f32,
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
    // The grid solves a gust that a page sends itself, from the ring of pushes and gusts, so its
    // readers hold no sent gust here.
    air.sentX = 0.0;
    air.sentZ = 0.0;
    air.sentStrength = 0.0;
    air.sentBorn = 0.0;
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

/// The turn that one gust gives the air at a place, in meters a second: a wave of turns that travels
/// along the heading. The turns are rings about the gust's center and depend only on the distance to
/// it, so a ring of air turns without piling up.
fn wind_gust_wave(air: WindAir, center: vec2f, strength: f32, p: vec3f, height: f32) -> vec3f {
    let g = vec2f(p.x - center.x, p.z - center.y);
    let distance = length(g) / air.gustRadius;
    let reach = distance * distance;
    if (reach >= 9.0) {
        return vec3f(0.0);
    }
    let envelope = exp(-reach) * cos(distance * air.gustWave) * strength * height;
    return vec3f((g.y / air.gustRadius) * envelope, 0.0, -(g.x / air.gustRadius) * envelope);
}

/// The wind's steady velocity at a world place, in meters a second: the base wind, the gust that
/// travels through it, the swirl, and the gust that a page sent, which travels from its own place.
/// A page's pushes reach readers only through the grid.
fn wind_steady(air: WindAir, p: vec3f) -> vec3f {
    let height = wind_profile(air, p.y);
    let cosHeading = cos(air.heading);
    let sinHeading = sin(air.heading);
    var v = vec3f(cosHeading * air.speed * height, 0.0, sinHeading * air.speed * height);

    let travel = air.gustSpeed * air.time;
    v += wind_gust_wave(air, vec2f(cosHeading * travel, sinHeading * travel), air.gustStrength, p, height);

    // The gust that a page sent: the same wave, from the place it was sent, carried along the
    // heading and fading over its life so the air comes back to its steady state.
    if (air.sentStrength != 0.0) {
        let age = air.time - air.sentBorn;
        if (age >= 0.0 && age < WIND_SENT_LIFE) {
            let sentTravel = air.gustSpeed * age;
            let wane = 1.0 - age / WIND_SENT_LIFE;
            v += wind_gust_wave(
                air,
                vec2f(air.sentX + cosHeading * sentTravel, air.sentZ + sinHeading * sentTravel),
                air.sentStrength * wane,
                p,
                height,
            );
        }
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
/// the second, the swirl in the third and the gust that a page sent in the fourth, with the time
/// that the reader's own frame gives.
fn wind_reading(base: vec4f, gust: vec4f, swirl: vec4f, sent: vec4f, time: f32) -> WindAir {
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
    air.sentX = sent.x;
    air.sentZ = sent.y;
    air.sentStrength = sent.z;
    air.sentBorn = sent.w;
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

/// The air at a world place, from the field's grid where it covers the place and its steady
/// field beyond, whose settings sit in the records texture's second row.
fn air_at(place: vec3f) -> vec4f {
    let base = textureLoad(records, vec2i(0, 1), 0);
    let gust = textureLoad(records, vec2i(1, 1), 0);
    let swirl = textureLoad(records, vec2i(2, 1), 0);
    let sent = textureLoad(records, vec2i(3, 1), 0);
    let reading = wind_reading(base, gust, swirl, sent, frame.time);
    return wind_sample(
        place,
        camera.position.xz - vec2f(material.windBox * 0.5),
        material.windBox,
        i32(material.windLayer),
        reading,
    );
}

/// How much of the wind's offset a plant keeps: all of it inside the sway distance's last fifth,
/// none past it.
fn sway_fade() -> f32 {
    if (material.swayDistance <= 0.0) {
        return 1.0;
    }
    let away = length(object.position - camera.position);
    return 1.0 - smoothstep(material.swayDistance * 0.8, material.swayDistance, away);
}

/// A point of the plant moved by the wind, in the plant's own space: each record from the point's
/// own toward the stem turns it about its pivot across the air, and the stem bends as a cantilever.
/// A free branch swings more than a stiff one, and a whip's swing lags along its length.
fn sway_point(p: vec3f, own: i32, downwind: vec3f, speed: f32) -> vec3f {
    var point = p;
    var id = own;
    for (var level = 0; level < MAX_BRANCH_DEPTH; level += 1) {
        if (id < 0) {
            break;
        }
        let first = wind_record(id, 0);
        let second_texel = wind_record(id, 1);
        let third_texel = wind_record(id, 2);
        let fourth_texel = wind_record(id, 3);
        let pivot = first.xyz;
        let axis = normalize(second_texel.xyz + vec3f(0.0, 0.000001, 0.0));
        let length_m = max(third_texel.w, 0.001);
        let parent = record_parent(id, first);
        let along = clamp(dot(point - pivot, axis) / length_m, 0.0, 1.0);
        if (parent < 0) {
            point += downwind * (along * along * speed * STEM_BEND * length_m);
        } else {
            let across = cross(axis, downwind);
            let reach = length(across);
            if (reach > 0.001) {
                // A long branch swings slower than a short one.
                let frequency = 0.35 + 0.6 / (1.0 + length_m);
                let lag = fourth_texel.y * along * 3.0;
                let swing = 0.5 + 0.5 * sin(TURN * (frame.time * frequency + fourth_texel.x) - lag);
                let angle = (1.0 - second_texel.w) * speed * BRANCH_BEND * swing;
                point = turn_about(point, pivot, across / reach, angle);
            }
        }
        id = parent;
    }
    return point;
}

/// How far the trunk's bark lifts a wood vertex along its normal, in metres: the bark's height
/// from a coarse mip of its colour, through the zone's mapping, on thick wood away from collars.
fn bark_lift(input: VertexInput) -> f32 {
    let radius = input.uv1.x * WOOD_RADIUS_SPAN;
    let weight = smoothstep(0.08, 0.2, radius) * (1.0 - input.uv1.y);
    let zone = HEADER_BARK_ZONES;
    let layer = i32(header(zone).w + 0.5);
    let tiling = header(zone + 2);
    let uv = input.uv / WOOD_UV_STEPS / max(tiling.xy, vec2f(0.001));
    let texel = textureSampleLevel(colour, colourSampler, uv, layer, 5.0).rgb;
    let luminance = dot(texel, vec3f(0.2126, 0.7152, 0.0722));
    return (luminance - tiling.z) * tiling.w * weight;
}

/// Wood, cards and merged foliage: the 16-bit position into the plant's metres, lifted by the
/// bark's height on the nearest wood, and moved by the wind in the plant's own space.
fn plant_offset(input: VertexInput, mode: i32) -> vec3f {
    var plant = box_point(input.position);
    if (mode == MODE_WOOD && material.displacement > 0.0) {
        plant += normalize(input.normal) * bark_lift(input);
    }
    var moved = plant;
    let fade = sway_fade();
    if (material.windStrength > 0.0 && fade > 0.0) {
        let place = (object.worldMatrix * vec4f(plant, 1.0)).xyz + camera.position;
        let air = air_at(place);
        let m = object_frame();
        let local = transpose(m) * vec3f(air.x, 0.0, air.z);
        if (air.a > 0.0 && length(local) > 0.00001) {
            let downwind = normalize(local);
            let own = colour_record(input.colors);
            var swayed = sway_point(plant, own, downwind, air.a);
            if (mode == MODE_CARDS || mode == MODE_FOLIAGE) {
                // Leaves and cards flutter across the air by their phase byte, more toward their
                // tips: the second coordinates' x is the share along the leaf or up the card.
                let flutter = wind_record(own, 2);
                let sideways = cross(downwind, vec3f(0.0, 1.0, 0.0));
                let side = length(sideways);
                if (side > 0.001) {
                    let brisk = clamp(air.a / 10.0, 0.0, 1.5);
                    let flap = sin(TURN * (frame.time * flutter.y + input.colors.b));
                    swayed += (sideways / side) * (flutter.x * brisk * flap * input.uv1.x);
                }
            }
            moved = plant + (swayed - plant) * fade;
        }
    }
    return moved - input.position;
}

/// A shoot row: the parent branch's sway at the shoot's base, found in the copy's plant space from
/// the near table and brought back into the prototype's space, then the shoot's own bend along its
/// length and its leaves' flutter about their stalks.
fn shoot_offset(input: VertexInput) -> vec3f {
    let fade = sway_fade();
    if (material.windStrength <= 0.0 || fade <= 0.0) {
        return vec3f(0.0);
    }
    let row = shoot_row(object.values);
    let high = near_texel(row.slot * 2);
    let low = near_texel(row.slot * 2 + 1);
    let copy = high.xyz + low.xyz;
    let turn = high.w;
    let scale = max(low.w, 0.0001);
    let air = air_at(object.position);
    let world_wind = vec3f(air.x, 0.0, air.z);
    if (air.a <= 0.0 || length(world_wind) <= 0.00001) {
        return vec3f(0.0);
    }
    let downwind = normalize(world_wind);
    let base = into_turn(object.position - copy, turn) / scale;
    let own = row.record;
    let swayed = sway_point(base, own, into_turn(downwind, turn), air.a);
    let moved = out_of_turn(swayed - base, turn) * scale;
    // The row's matrix is its turn times its scale: its transpose over the squared scale undoes it.
    let m = object_frame();
    let squared = max(dot(m[0], m[0]), 0.00000001);
    var local = transpose(m) * moved / squared;
    let local_wind = normalize(transpose(m) * downwind);
    let bend = input.colors.r;
    local += local_wind * (bend * bend * length(input.position) * air.a * SHOOT_BEND);
    let kind = input.colors.b * 255.0;
    if (kind < KIND_STEM * 0.5) {
        let flutter = wind_record(own, 2);
        let leaf_length = max(header(HEADER_LOWER_REFLECTANCE).w, 0.01);
        let along = clamp(input.uv1.x / leaf_length, 0.0, 1.0);
        let brisk = clamp(air.a / 10.0, 0.0, 1.5);
        let flap = sin(TURN * (frame.time * flutter.y + row.phase + input.colors.g));
        local += normalize(input.normal) * (flutter.x * brisk * flap * along / sqrt(squared));
    }
    return local * fade;
}

fn vertexOffset(input: VertexInput) -> vec3f {
    let mode = plant_mode();
    if (mode == MODE_SHOOTS) {
        return shoot_offset(input);
    }
    return plant_offset(input, mode);
}

/// A tangent frame from the screen derivatives of the position and the texture coordinates, as
/// three.js's getTangentFrame builds it: the unit directions in which u and v grow on the surface,
/// and the normal. `facing` is -1 on a back face, whose normal the engine has turned.
fn tangent_frame(n: vec3f, dpx: vec3f, dpy: vec3f, uvx: vec2f, uvy: vec2f, facing: f32) -> mat3x3f {
    let q1perp = cross(dpy, n);
    let q0perp = cross(n, dpx);
    let t = q1perp * uvx.x + q0perp * uvy.x;
    let b = q1perp * uvx.y + q0perp * uvy.y;
    let det = max(dot(t, t), dot(b, b));
    let scale = select(inverseSqrt(det), 0.0, det == 0.0) * facing;
    return mat3x3f(t * scale, b * scale, n);
}

/// A normal map's texel as a unit normal in the tangent frame, its z rebuilt from x and y.
fn tangent_normal(texel: vec3f) -> vec3f {
    let xy = texel.xy * 2.0 - vec2f(1.0);
    return vec3f(xy, sqrt(max(0.0, 1.0 - dot(xy, xy))));
}

/// Linear luminance.
fn luminance_of(c: vec3f) -> f32 {
    return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}

/// A zone's weight at a coordinate: one inside its range, falling to none over its blend at each
/// end.
fn zone_weight(range: vec4f, at: f32) -> f32 {
    let half_blend = max(range.z * 0.5, 0.0001);
    let rise = smoothstep(range.x - half_blend, range.x + half_blend, at);
    let fall = 1.0 - smoothstep(range.y - half_blend, range.y + half_blend, at);
    return rise * fall;
}

/// A leaf's light: its colour, its share of light through and the colour of that light, its
/// roughness, from one face's texel. The texel divided by the face's mean keeps its pattern and
/// takes the record's reflectance as its average; the share comes back out of the base colour, so
/// a front-lit face shows that reflectance. The light through carries the same pattern about the
/// record's transmittance, so its average is that transmittance: pale veins, which hold less
/// chlorophyll, show pale against the light as well. Autumn, or a leaf's own browning, mixes both
/// colours toward the record's autumn ones.
struct LeafLight {
    base: vec3f,
    share: f32,
    through: vec3f,
    roughness: f32,
}

fn leaf_light(texel: vec3f, upper: bool, browning: f32) -> LeafLight {
    let face = header(select(HEADER_LOWER, HEADER_UPPER, upper));
    let through = header(select(HEADER_LOWER_THROUGH, HEADER_UPPER_THROUGH, upper));
    let reflectance = header(select(HEADER_LOWER_REFLECTANCE, HEADER_UPPER_REFLECTANCE, upper)).rgb;
    let mean = header(select(HEADER_LOWER_MEAN, HEADER_UPPER_MEAN, upper)).rgb;
    let autumn_r = header(HEADER_AUTUMN_REFLECTANCE);
    let autumn_t = header(HEADER_AUTUMN_TRANSMITTANCE).rgb;
    let transmittance = header(HEADER_TRANSMITTANCE).rgb;
    let turned = select(0.0, saturate(max(material.season, browning)), autumn_r.w > 0.5);
    let reflect_shift = mix(vec3f(1.0), autumn_r.rgb / max(reflectance, vec3f(0.0001)), turned);
    let through_shift = mix(vec3f(1.0), autumn_t / max(transmittance, vec3f(0.0001)), turned);
    var light: LeafLight;
    light.base = min(texel * face.rgb * reflect_shift, vec3f(1.0));
    light.share = through.w;
    light.through = through.rgb * through_shift * texel / max(mean, vec3f(0.0001));
    light.roughness = face.w;
    return light;
}

/// The share of light that a leaf's gloss reflects from all directions at a view, by Karis's fit of
/// the split-sum table. The engine keeps that share from the light that passes through the leaf;
/// a leaf's measured transmittance already holds it, so the light through is raised to match.
fn gloss_albedo(roughness: f32, n_dot_v: f32) -> f32 {
    let c0 = vec4f(-1.0, -0.0275, -0.572, 0.022);
    let c1 = vec4f(1.0, 0.0425, 1.04, -0.04);
    let r = roughness * c0 + c1;
    let a004 = min(r.x * r.x, exp2(-9.28 * n_dot_v)) * r.x + r.y;
    let ab = vec2f(-1.04, 1.04) * a004 + r.zw;
    return LEAF_F0 * ab.x + LEAF_F90 * ab.y;
}

/// The coverage of a leaf or card texel, sharpened to a one-pixel edge at the cutoff: whole inside
/// the blade, none outside, so the blade draws solid to its cut edge.
fn sharpen(alpha: f32, width: f32) -> f32 {
    return saturate((alpha - CUTOFF) / max(width, 0.0001) + 0.5);
}

/// The scale from a role's stored texture coordinates to the texture's own.
fn uv_scale(mode: i32) -> f32 {
    if (mode == MODE_WOOD) {
        return 1.0 / WOOD_UV_STEPS;
    }
    if (mode == MODE_SHOOTS) {
        return 1.0;
    }
    return 1.0 / TEXTURE_UV_STEPS;
}

/// The coverage a point casts: a leaf's or a card's texel, and wood and stems whole.
fn coverage(input: SurfaceInput) -> f32 {
    let mode = plant_mode();
    let scale = uv_scale(mode);
    let uv = input.uv * scale;
    let gx = dpdx(input.uv) * scale;
    let gy = dpdy(input.uv) * scale;
    var alpha = 1.0;
    if (mode == MODE_CARDS) {
        let layer = select(1, 0, input.frontFacing);
        alpha = textureSampleGrad(colour, colourSampler, uv, layer, gx, gy).a;
    } else if (mode == MODE_FOLIAGE
        || (mode == MODE_SHOOTS && input.vertexColor.b * 255.0 < KIND_STEM * 0.5)) {
        let layer = select(1, 0, input.frontFacing);
        alpha = textureSampleGrad(colour, colourSampler, uv, layer, gx, gy).a;
    }
    return alpha;
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let mode = plant_mode();
    let upper = input.frontFacing;
    let facing = select(-1.0, 1.0, upper);
    // Derivatives first, in uniform control flow; the roles sample with explicit gradients.
    let dpx = dpdx(input.relativePosition);
    let dpy = dpdy(input.relativePosition);
    let uvx = dpdx(input.uv);
    let uvy = dpdy(input.uv);
    let n = normalize(input.normal);
    let tbn = tangent_frame(n, dpx, dpy, uvx, uvy, facing);
    let scale = uv_scale(mode);
    let uv = input.uv * scale;
    let gx = uvx * scale;
    let gy = uvy * scale;

    var base = vec3f(0.5);
    var alpha = 1.0;
    var mapped = vec3f(0.0, 0.0, 1.0);
    var roughness = 0.8;
    var share = 0.0;
    var through = vec3f(0.0);
    var occlusion = 1.0;
    var sky_normal = vec3f(0.0);
    var sheen = 0.0;

    if (mode == MODE_WOOD) {
        let radius = input.uv1.x * WOOD_RADIUS_SPAN;
        let junction = input.uv1.y;
        // The point in the plant's own space, for zones by height.
        let m = object_frame();
        let origin = object.worldMatrix[3].xyz;
        let squared = max(dot(m[0], m[0]), 0.00000001);
        let plant = transpose(m) * (input.relativePosition - origin) / squared;
        let zones = i32(header(HEADER_YOUNG_TILE).z + 0.5);
        // The two zones that weigh most at this point.
        var first_zone = 0;
        var first_weight = -1.0;
        var second_zone = 0;
        var second_weight = 0.0;
        for (var z = 0; z < MAX_BARK_ZONES; z += 1) {
            let range = header(HEADER_BARK_ZONES + z * BARK_ZONE_TEXELS + 1);
            let along_zone = select(plant.y, radius, range.w > 0.5);
            let weight = select(-1.0, zone_weight(range, along_zone), z < zones);
            if (weight > first_weight) {
                second_zone = first_zone;
                second_weight = max(first_weight, 0.0);
                first_zone = z;
                first_weight = weight;
            } else if (weight > second_weight) {
                second_zone = z;
                second_weight = weight;
            }
        }
        let total = max(first_weight + second_weight, 0.0001);
        let a_at = HEADER_BARK_ZONES + first_zone * BARK_ZONE_TEXELS;
        let a_tint = header(a_at);
        let a_tile = max(header(a_at + 2).xy, vec2f(0.001));
        let a_uv = uv / a_tile;
        let a_layer = i32(a_tint.w + 0.5);
        let a_gx = gx / a_tile;
        let a_gy = gy / a_tile;
        let a_colour = textureSampleGrad(colour, colourSampler, a_uv, a_layer, a_gx, a_gy).rgb;
        let a_relief = textureSampleGrad(relief, reliefSampler, a_uv, a_layer, a_gx, a_gy).rgb;
        // A furrow is darker than the bark about it: the colour at the drawn mip against the colour
        // three mips coarser gives its cavity.
        let a_coarse =
            textureSampleGrad(colour, colourSampler, a_uv, a_layer, a_gx * 8.0, a_gy * 8.0).rgb;
        var bark = a_colour * a_tint.rgb;
        var bark_normal = tangent_normal(a_relief);
        var cavity = saturate((luminance_of(a_coarse) - luminance_of(a_colour)) * 4.0);
        if (second_weight > 0.001) {
            let b_at = HEADER_BARK_ZONES + second_zone * BARK_ZONE_TEXELS;
            let b_tint = header(b_at);
            let b_tile = max(header(b_at + 2).xy, vec2f(0.001));
            let b_uv = uv / b_tile;
            let b_layer = i32(b_tint.w + 0.5);
            let b_gx = gx / b_tile;
            let b_gy = gy / b_tile;
            let b_colour = textureSampleGrad(colour, colourSampler, b_uv, b_layer, b_gx, b_gy).rgb;
            let b_relief = textureSampleGrad(relief, reliefSampler, b_uv, b_layer, b_gx, b_gy).rgb;
            let k = second_weight / total;
            bark = mix(bark, b_colour * b_tint.rgb, k);
            bark_normal = normalize(mix(bark_normal, tangent_normal(b_relief), k));
        }
        // Thin wood draws the young bark.
        let young = header(HEADER_YOUNG);
        let young_tile = max(header(HEADER_YOUNG_TILE).xy, vec2f(0.001));
        let y_uv = uv / young_tile;
        let y_gx = gx / young_tile;
        let y_gy = gy / young_tile;
        let y_colour = textureSampleGrad(second, secondSampler, y_uv, y_gx, y_gy).rgb;
        let y_relief = textureSampleGrad(third, thirdSampler, y_uv, y_gx, y_gy).rgb;
        let youth = 1.0 - smoothstep(young.w * 0.8, young.w * 1.2, radius);
        bark = mix(bark, y_colour, youth);
        bark_normal = normalize(mix(bark_normal, tangent_normal(y_relief), youth));
        cavity *= 1.0 - youth;
        // Moss grows on the upper, north-facing (toward -Z) side of the low trunk, and in furrows.
        let moss = header(HEADER_MOSS);
        let moss_reach = header(HEADER_MOSS_REACH);
        let low_enough = 1.0 - smoothstep(moss_reach.x * 0.7, max(moss_reach.x, 0.001), plant.y);
        let north = saturate(-n.z) * moss_reach.y;
        let mossy = saturate(moss.w * low_enough * (saturate(n.y) + north) * (0.5 + cavity));
        bark = mix(bark, moss.rgb, mossy);
        // The collar's dark ridge where a branch joins its parent.
        bark *= 1.0 - 0.5 * moss_reach.z * junction;
        base = bark * (1.0 - CAVITY_DARK * cavity);
        roughness = saturate(0.82 + CAVITY_ROUGH * cavity);
        mapped = bark_normal;
        occlusion = input.vertexColor.a;
    } else if (mode == MODE_CARDS) {
        let layer = select(1, 0, upper);
        let texel = textureSampleGrad(colour, colourSampler, uv, layer, gx, gy);
        let surface_texel = textureSampleGrad(relief, reliefSampler, uv, layer, gx, gy);
        let kind = surface_texel.a * 255.0;
        let leaf = kind >= 127.5;
        let self_shade = (kind - select(0.0, 128.0, leaf)) * 2.0 / 255.0;
        if (leaf) {
            let light = leaf_light(texel.rgb, upper, 0.0);
            base = light.base;
            share = light.share;
            through = light.through;
            roughness = light.roughness;
        } else {
            base = texel.rgb;
        }
        alpha = texel.a;
        // In the shell where a near copy draws its real shoots, its cards give way.
        let near_copy = object.values.x > 0.5;
        if (near_copy && length(input.relativePosition) < material.nearDistance * 0.96) {
            alpha = 0.0;
        }
        let e = (surface_texel.xy * 255.0 - vec2f(128.0)) / 127.0;
        let card_normal = octahedral(clamp(e, vec2f(-1.0), vec2f(1.0)));
        // The card's normal is toward the viewer of the face it shows; the frame's normal is too.
        mapped = card_normal;
        occlusion = input.vertexColor.a * saturate(self_shade);
    } else if (mode == MODE_EXTRAS) {
        // An extra takes its kind's colour from the header, by the index in its third byte.
        let kind = clamp(i32(input.vertexColor.b * 255.0 + 0.5), 0, MAX_EXTRAS - 1);
        base = header(HEADER_EXTRAS + kind).rgb;
        roughness = 0.6;
        occlusion = input.vertexColor.a;
    } else {
        // Shoot rows and merged foliage: leaves, and the shoots' stems and buds.
        let stem = mode == MODE_SHOOTS && input.vertexColor.b * 255.0 >= KIND_STEM * 0.5;
        if (stem) {
            let young_tile = max(header(HEADER_YOUNG_TILE).xy, vec2f(0.001));
            let y_uv = uv / young_tile;
            let y_gx = gx / young_tile;
            base = textureSampleGrad(third, thirdSampler, y_uv, y_gx, gy / young_tile).rgb;
            roughness = 0.8;
        } else {
            let layer = select(1, 0, upper);
            let texel = textureSampleGrad(colour, colourSampler, uv, layer, gx, gy);
            let relief_texel = textureSampleGrad(relief, reliefSampler, uv, 0, gx, gy).rgb;
            // A merged leaf browns on its own by its second coordinates' y, as a dying frond does.
            let browning = select(0.0, input.uv1.y, mode == MODE_FOLIAGE);
            let light = leaf_light(texel.rgb, upper, browning);
            base = light.base;
            share = light.share;
            through = light.through;
            roughness = light.roughness;
            alpha = texel.a;
            var leaf_normal = tangent_normal(relief_texel);
            // The lower face reads the blade's relief inverted.
            leaf_normal = vec3f(leaf_normal.xy * facing, leaf_normal.z);
            mapped = leaf_normal;
            // The record's colours were seen on leaves with their relief, so the relief must not
            // dim the leaf's light on average. A tilted normal takes its cosine times less light
            // from along the blade's normal and gains or loses the rest by its tilt, which averages
            // out; dividing by the cosine keeps the average and the shading of the tilt.
            let flatten = 1.0 / max(leaf_normal.z, 0.5);
            base = min(base * flatten, vec3f(1.0));
            through *= flatten;
            sheen = select(header(HEADER_UPPER_REFLECTANCE).w, 0.0, upper);
        }
        if (mode == MODE_SHOOTS) {
            let row = shoot_row(object.values);
            let turn = near_texel(row.slot * 2).w;
            occlusion = saturate(row.sky / 250.0) * input.vertexColor.a;
            sky_normal = out_of_turn(bent_normal(row.bent), turn);
        } else {
            occlusion = input.vertexColor.a;
        }
    }

    let normal = normalize(tbn[0] * mapped.x + tbn[1] * mapped.y + tbn[2] * mapped.z);
    // Thin leaves and fine bark alias where the mapped normal turns fast between pixels, so the
    // roughness widens with that turn.
    let dnx = dpdx(normal);
    let dny = dpdy(normal);
    let variance = 0.5 * (dot(dnx, dnx) + dot(dny, dny));
    let a = roughness * roughness;
    let widened = sqrt(sqrt(a * a + min(2.0 * variance, 0.18)));
    let width = fwidth(alpha);
    let n_dot_v = saturate(dot(normal, input.viewDirection));
    through /= max(1.0 - gloss_albedo(widened, n_dot_v), 0.5);

    // A felted lower face lifts its colour toward the grazing view, as velvet does.
    let grazing = 1.0 - saturate(dot(normal, input.viewDirection));
    base = min(base * (1.0 + sheen * grazing * grazing * grazing * grazing), vec3f(1.0));

    // A matte keeps the outline, the cut-outs and the sway, and draws no light.
    let matte = material.matte > 0.5;
    s.baseColor = select(base, vec3f(0.0), matte);
    s.metalness = 0.0;
    s.roughness = widened;
    s.normal = normal;
    s.ambientNormal = select(normal, normalize(sky_normal), dot(sky_normal, sky_normal) > 0.0);
    s.occlusion = saturate(occlusion);
    s.occlusionByMinimum = true;
    s.alpha = sharpen(alpha, width);
    s.diffuseTransmission = select(share, 0.0, matte);
    s.diffuseTransmissionColor = select(through, vec3f(0.0), matte);
    return s;
}
