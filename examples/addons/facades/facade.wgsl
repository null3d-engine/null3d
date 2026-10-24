// The facades add-on's surface function: walls of a building with a window in each bay of each
// floor, and behind every lit window a room drawn by interior mapping. The room is a box behind
// the glass with a back wall, two side walls, a floor and a ceiling, a lamp's pool of light, a
// block of furniture, blinds that some rooms draw down and a curtain in some. A window code from
// the code page gives each room its own light, blinds and furniture, so no two walls repeat.
//
// Each wall tile of the wall page holds one cell: a bay across and a floor up, with the opening
// cut from its middle. The cell's place on the wall comes from the world position, so windows keep
// their size whatever a building's scale, and a mesh without texture coordinates still draws them.
// Where a cell shrinks below a few pixels the shader fades the rooms to the wall page's own average,
// whose alpha holds the window's share of light, so a skyline never shimmers.
//
// The power-on wave runs out from a point of the ground: each window waits for the wave to reach
// it, then its light rises on a damped spring, which overshoots slightly and settles.

#import null3d::noise::{random2, value2}

struct Uniforms {
    // How much of the city's own light burns: 0 by day, 1 by night.
    power: f32,
    // The share of the windows that are lit.
    litShare: f32,
    // The bay's width in metres: the window, its frames and the pier between two windows.
    cellWidth: f32,
    // The floor's height in metres.
    floorHeight: f32,
    // The height of the first cell's base above the mesh's base, in metres.
    sill: f32,
    // The glass, as fractions of a cell.
    glassX0: f32,
    glassY0: f32,
    glassX1: f32,
    glassY1: f32,
    // The glass's size in metres, which gives the room behind it its shape.
    windowWidth: f32,
    windowHeight: f32,
    // How deep the room reaches behind the glass, in metres.
    roomDepth: f32,
    // How strongly a lit room glows.
    roomLight: f32,
    // How much a room's light flickers, from 0 for steady.
    flicker: f32,
    // The time that the wave left its origin, the speed it crosses the ground at, and its origin.
    waveStart: f32,
    waveSpeed: f32,
    waveOriginX: f32,
    waveOriginZ: f32,
    // The spring that each window's light rises on: its rate and its damping.
    waveRise: f32,
    waveDamping: f32,
    // The cell size in pixels where the far fallback begins and where it is complete.
    farFade: f32,
    farFull: f32,
    // The wall finish, as a tile of the wall page, or a negative value for a seed's own pick.
    wallTile: f32,
    // The street level's height in metres, or 0 for none.
    shopHeight: f32,
    // 0 draws walls with windows; 1 draws one window across the mesh's own coordinates.
    mode: f32,
    // 1 draws the rooms' furniture; 0 leaves it out.
    furniture: f32,
    // 1 draws the rooms' blinds; 0 leaves them out.
    blinds: f32,
}

var wallMap: texture_2d<f32>;
var wallOrm: texture_2d<f32>;
var codeMap: texture_2d<f32>;

// The distance along a ray to the box's wall on one axis, or a number far enough away to lose the
// comparison when the ray runs along the wall.
fn wall_hit(p: f32, d: f32, half: f32) -> f32 {
    if (abs(d) < 0.0001) {
        return 1e6;
    }
    return (select(-half, half, d >= 0.0) - p) / d;
}

// A room's light: warm amber through soft white, or the blue of a room lit by a screen.
fn room_tint(warmth: f32, cool: f32) -> vec3f {
    let amber = vec3f(1.0, 0.54, 0.22);
    let soft = vec3f(1.0, 0.84, 0.62);
    return select(mix(amber, soft, warmth), vec3f(0.45, 0.66, 1.0), cool > 0.5);
}


fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let n = normalize(input.normal);
    let seed = object.values.x;
    let place = object.position;
    let facade = material.mode < 0.5;

    // The cell's coordinates: its bay along the wall and its floor up it. A window batch's own
    // coordinates span one cell. Every derivative call stands here, before the first branch: WebGPU
    // refuses a derivative whose control flow depends on a material's value.
    let along = select(input.worldPosition.x, input.worldPosition.z, abs(n.x) > abs(n.z));
    let world_cell = vec2f(
        along / max(material.cellWidth, 0.01),
        (input.worldPosition.y - material.sill) / max(material.floorHeight, 0.01),
    );
    let cell = select(input.uv, world_cell, facade);
    let f = select(input.uv, fract(world_cell), facade);
    let covered = max(fwidth(cell.x), fwidth(cell.y));
    let far = smoothstep(material.farFade, max(material.farFull, material.farFade + 0.01), covered);

    // The wall finish: a look's own tile, or one that each building's seed picks.
    let picked = floor(random2(vec2f(seed * 71.3, 11.7)) * 3.999);
    let index = select(material.wallTile, picked, material.wallTile < 0.0);
    let tile = vec2f(fract(index * 0.5) * 2.0, floor(index * 0.5));
    let atlas_uv = (tile + f) * 0.5;
    let dx = dpdx(atlas_uv);
    let dy = dpdy(atlas_uv);
    // A box building's top face is a roof deck, not a wall: a dark tarred surface that keeps the
    // city's own faint glow and none of the windows below.
    if (facade && abs(n.y) > 0.5) {
        var roof = s;
        let grain = random2(floor(input.worldPosition.xz * 2.0));
        roof.baseColor = vec3f(0.03, 0.032, 0.038) * (0.7 + 0.6 * seed) * (0.82 + 0.36 * grain);
        roof.metalness = 0.15;
        roof.roughness = 0.82;
        roof.emissive = vec3f(0.008, 0.008, 0.011) * material.power;
        return roof;
    }

    // Far away the cell repeats faster than a pixel, so the wall reads its page's coarser levels:
    // the pattern fades to the page's average instead of drawing a moire over the skyline.
    let blur = 1.0 + far * 10.0;
    let wall = textureSampleGrad(wallMap, wallMapSampler, atlas_uv, dx * blur, dy * blur);
    let orm = textureSampleGrad(wallOrm, wallOrmSampler, atlas_uv, dx * blur, dy * blur);

    // The window's place, and whether the point shows glass.
    let in_x = step(material.glassX0, f.x) * step(f.x, material.glassX1);
    let in_y = step(material.glassY0, f.y) * step(f.y, material.glassY1);
    let glass = in_x * in_y;

    // The room behind the window comes from a code page whose texel a hash of the window picks.
    let id = select(vec2f(0.0), floor(world_cell), facade);
    let pick = random2(vec2f(
        id.x * 1.37 + place.x * 0.031 + seed * 71.3,
        id.y * 2.11 + place.z * 0.043 + seed * 23.9,
    ));
    let code_index = i32(random2(vec2f(place.x * 0.071 + id.y * 3.31, place.z * 0.091 + id.x * 5.17)) * 255.0);
    let code = textureLoad(codeMap, vec2i(code_index % 16, code_index / 16), 0);

    // Whether this window is lit: a share of the windows on a facade, and the batch's own value on
    // a window, which its scene dims by the hour.
    let instance_lit = clamp(object.values.x, 0.0, 1.0);
    let lit = select(step(pick, material.litShare), instance_lit, !facade);

    // The power-on wave: its arrival at this window, and the spring that follows it.
    let reach = length(place.xz - vec2f(material.waveOriginX, material.waveOriginZ));
    let arrival = material.waveStart + reach / max(material.waveSpeed, 0.001);
    let age = max(frame.time - arrival, 0.0);
    let rise = 1.0 - exp(-material.waveDamping * age) * cos(material.waveRise * age);
    let on = select(0.0, rise, frame.time > arrival) * material.power;

    // The eye's ray into the room, and where it meets the room's box: the back wall, a side wall,
    // the floor or the ceiling. Each room is as wide as its glass and reaches back by its depth.
    let hw = max(material.windowWidth, 0.05) * 0.5;
    let hh = max(material.windowHeight, 0.05) * 0.5;
    let depth = max(material.roomDepth, 0.15);
    let wx = clamp((f.x - material.glassX0) / max(material.glassX1 - material.glassX0, 0.001), 0.0, 1.0);
    let wy = clamp((f.y - material.glassY0) / max(material.glassY1 - material.glassY0, 0.001), 0.0, 1.0);
    let right = normalize(cross(vec3f(0.0, 1.0, 0.0), n) + vec3f(0.0001, 0.0, 0.0));
    let up = cross(n, right);
    let eye = -input.viewDirection;
    let ray = vec3f(dot(eye, right), dot(eye, up), dot(eye, n));
    let px = (wx * 2.0 - 1.0) * hw;
    let py = (wy * 2.0 - 1.0) * hh;
    // A glance along the glass still enters the room a little, so the frame never shows a hole.
    let enter = select(0.03, ray.z, ray.z < -0.03);
    let tz = -depth / enter;
    let t = min(tz, min(wall_hit(px, ray.x, hw), wall_hit(py, ray.y, hh)));
    let hit = vec3f(px + ray.x * t, py + ray.y * t, ray.z * t);
    let back = step(tz - 0.0005, t);
    let side = step(hw * 0.999, abs(hit.x));
    let ceiling = step(hh * 0.999, hit.y);
    let floor_hit = step(hit.y, -hh * 0.999);

    // The lamp: a pool of light on the room's back wall, at the height that the code gives it.
    let lamp_y = mix(-hh * 0.35, hh * 0.45, fract(code.a * 3.7));
    let to_lamp = length(hit - vec3f(0.0, lamp_y, -depth));
    let pool = exp(-to_lamp * to_lamp / (depth * depth * 0.09));
    let mask_back = back * (1.0 - side) * (1.0 - ceiling) * (1.0 - floor_hit);
    let shade = max(
        mask_back * (0.12 + 1.5 * pool) +
        side * (0.1 + 0.5 * pool) +
        ceiling * (0.2 + 0.8 * pool) +
        floor_hit * (0.06 + 1.0 * pool),
        0.02,
    );

    // The furniture: a block that stands on the floor against the back wall, darker than the room
    // and catching a little light along its top.
    let furn_x = mix(-hw * 0.5, hw * 0.15, fract(code.a * 7.3));
    let furn_w = hw * mix(0.26, 0.58, fract(code.a * 13.1));
    let furn_h = hh * mix(0.32, 0.6, fract(code.a * 5.7));
    let in_box = step(abs(hit.x - furn_x), furn_w) * step(hit.y, -hh + furn_h) * step(-hh - 0.001, hit.y);
    let furniture = material.furniture * step(0.3, code.a) * in_box * (mask_back + floor_hit);
    let top_edge = 1.0 - smoothstep(0.0, hh * 0.045, abs(hit.y - (-hh + furn_h)));
    var room_shade = shade * (1.0 - clamp(furniture, 0.0, 1.0) * 0.82) + furniture * top_edge * 0.2;

    // The blinds hang from the top of the glass by the code's share, and the slats let the light
    // through in bands. A curtain darkens one side of some rooms.
    let blind_share = code.b * material.blinds;
    let covered_top = step(1.0 - blind_share, wy) * step(0.12, blind_share);
    let slat = mix(0.46, 1.0, step(0.45, fract(wy * 18.0)));
    let curtain_side = fract(code.a * 17.3);
    let edge = select(1.0 - smoothstep(0.26, 0.33, wx), smoothstep(0.67, 0.74, wx), curtain_side >= 0.5);
    let curtain = mix(1.0, 0.42 + 0.58 * edge, step(curtain_side, 0.24));
    room_shade *= mix(1.0, slat, covered_top) * curtain;

    // A room's light flickers: a candle's small waver, or a television's deep slow pulse.
    let phase = select(place.x * 3.1 + place.z * 2.3 + seed * 17.0, object.values.z * 6.2832, !facade);
    let candle = 0.88 + 0.12 * value2(vec2f(phase, frame.time * 0.7));
    let television = 0.62 + 0.38 * sin(frame.time * 9.0 + phase) * sin(frame.time * 3.7 + phase * 2.0);
    let flicker = mix(1.0, select(candle, television, code.a > 0.9), material.flicker);

    let cool = select(0.0, object.values.w, !facade);
    let warmth = select(code.r, mix(code.r, object.values.y, 0.6), !facade);
    let tint = room_tint(warmth, cool);
    let level = mix(0.45, 1.2, code.g) * mix(0.6, 1.15, fract(pick * 7.0));
    let room = tint * material.roomLight * level * room_shade * flicker;
    var emissive = room * lit * on * glass;

    // Far away a cell is smaller than a few pixels: the wall page's own average, whose alpha holds
    // the window's share of light, replaces the rooms and the grid.
    let average = vec3f(0.95, 0.72, 0.46) * material.litShare * wall.a;
    emissive = mix(emissive, average * on * material.roomLight * 0.9, far);

    // The wall itself, and the glass as a dark pane that mirrors the street. The window's light is
    // emitted, so it adds over the pane.
    var base = wall.rgb * s.baseColor;
    var roughness = orm.g;
    var metalness = orm.b;
    base = select(base, vec3f(0.008, 0.01, 0.014), glass > 0.5);
    roughness = select(roughness, 0.08, glass > 0.5);
    metalness = select(metalness, 0.8, glass > 0.5);

    // The street level draws shop fronts instead: bright glass behind a band of wall, each shop in
    // its own colour, and all of them switched by the same power.
    let shops = step(1.0, material.shopHeight) * step(input.worldPosition.y, material.shopHeight);
    if (shops > 0.5 && facade) {
        let shop_f = vec2f(fract(along / 11.0), clamp(input.worldPosition.y / material.shopHeight, 0.0, 1.0));
        let shop_glass = step(0.05, shop_f.x) * step(shop_f.x, 0.95) * step(0.08, shop_f.y);
        let shop_cell = floor(along / 11.0);
        let shop_pick = random2(vec2f(shop_cell * 1.7 + seed * 91.0, seed * 13.0));
        let hue = 0.5 + 0.5 * cos(6.28318 * (shop_pick + vec3f(0.0, 0.33, 0.67)));
        base = mix(vec3f(0.03, 0.033, 0.04), vec3f(0.008, 0.01, 0.016), shop_glass);
        roughness = mix(0.72, 0.1, shop_glass);
        metalness = mix(0.06, 0.85, shop_glass);
        s.baseColor = base;
        s.roughness = roughness;
        s.metalness = metalness;
        s.emissive = hue * shop_glass * on * (0.9 + 1.5 * shop_f.y);
        return s;
    }

    // Far away the wall keeps a flat tone, which no grid of texels can crawl over.
    s.baseColor = mix(base, vec3f(0.02, 0.022, 0.026), far * 0.6);
    s.roughness = mix(roughness, 0.7, far);
    s.metalness = mix(metalness, 0.2, far);
    s.emissive = emissive;
    return s;
}
