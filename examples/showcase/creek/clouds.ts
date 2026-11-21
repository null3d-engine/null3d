// The sea of cloud that the cliff stands in. The cloud is a field of heights: everything below a
// point's height is cloud. A map made in code holds round billows, each a cluster of domes heaped on
// larger domes, as cumulus tops are; two copies of it at two sizes and turns make the sea's tops, so
// no repeat shows. Against the walls the tops heap up, in places and not across the front wall that
// the opening view looks at, and far out they rise into towers past the horizon, so no view meets a
// level line. A wisp of mist drifts across the walls' foot.
//
// One sphere round the camera draws the cloud: each pixel follows its view ray into the field and
// sums the cloud it passes, which gives soft, wispy edges where a ray grazes a billow, and stops at
// the scene's own surfaces, so the walls sink into the cloud with no line. A dome far round the
// camera carries the overcast above the horizon and the far sea past the ray's reach; the water's
// reflection draws the dome alone. Both take the air's color and the main light from the stage each
// frame, greyed and cast lilac, with the light's own warmth on the tops that face it.
import type { QualityPreset, SketchContext, Texture } from '@null3d/engine';
import { EFFECT_LAYER } from '../../lib/layers';
import { random } from '../../lib/procedural';
import type { Stage } from '../../lib/stage';
import { CLOUD_TOP, FALL, LIPS, rimRadius, streamSlope, streamZ, WATER } from './land';

/**
 * The cloud sea, in meters: the height of the sea's highest tops, how deep its billows run under
 * them, how far the tops heap up against the walls and rise into the far towers, how far a view ray
 * follows the cloud, and the dome's radius.
 */
export const CLOUD = {
	top: CLOUD_TOP,
	depth: 12,
	heap: 9,
	tower: 36,
	reach: 1500,
	dome: 1600,
} as const;
/** The steady speed that the air lets a fall's water reach, in meters a second, as the water add-on's. */
const FALL_TERMINAL = 15;
/** The seconds in which the air takes hold of falling water: the steady speed over gravity. */
const FALL_DRAG = FALL_TERMINAL / 9.81;

/**
 * How far out from its lip a fall's water is once it has fallen `drop` meters, after leaving at
 * `speed` meters a second. This follows the water add-on's fall path, where the air slows both the
 * water's way out and its fall, so the cloud meets the column where the add-on draws it.
 */
export function fallOut(speed: number, drop: number): number {
	const a = drop / (FALL_TERMINAL * FALL_DRAG);
	const seconds = FALL_DRAG * (a + Math.log1p(Math.sqrt(1 - Math.exp(-2 * a))));
	return speed * FALL_DRAG * (1 - Math.exp(-seconds / FALL_DRAG));
}

/**
 * Where a fall's column meets the cloud's top, in x and z, from what the scene passes the fall: the
 * way it leaves its lip (out along the creek's own line there), and the speed it leaves at.
 */
export function fallFoot(lip: number): [number, number] {
	const away = Math.sign(lip);
	const [dx, dz] = [away, away * streamSlope(lip)];
	const out = fallOut(FALL.speed, WATER - CLOUD_TOP) / Math.hypot(dx, dz);
	return [lip + dx * out, streamZ(lip) + dz * out];
}
/** The west fall's foot, then the east fall's, in x and z. */
const FALLS = [...fallFoot(LIPS.west), ...fallFoot(LIPS.east)] as const;
/**
 * How much spray each fall's foot raises in the cloud, the west's then the east's. In the concept
 * the west fall drops into a bright mass of mist, and the east one into the even grey cloud: where
 * a foot raises no spray, the cloud round it lies calm instead, with no heap and no puff climbing
 * the wall, so the rock beside the fall stays dark down to the cloud's level.
 */
const SPRAY = [1, 0] as const;
/**
 * How much the cloud's own tone greys round each fall's foot, unevenly, as the concept's cloud lies
 * a little greyer and mottled under the falls; the spray keeps its own brightness.
 */
const FOOT_SHADE = 0.1;
/** The width of the billow map's tile on the cloud, in meters, which the cloud's WGSL repeats. */
const TILE = 160;
/** The billow map's texels along each side at each preset. */
const MAP_SIZE: Record<QualityPreset, number> = { low: 256, medium: 256, high: 512, ultra: 512 };
/** The most steps that a view ray takes through the cloud at each preset. */
const STEPS: Record<QualityPreset, number> = { low: 48, medium: 56, high: 64, ultra: 80 };
/** How fast the billows drift, in meters a second along x and z. */
const DRIFT = [0.45, 0.2] as const;
/** The texels round the cliff's rim in the walls' map, one per bearing. */
export const RIM_TEXELS = 256;
/** The rim radii, in meters, that the walls' map stores in a byte: the lowest and the span. */
export const RIM_RANGE = { low: 18, span: 16 } as const;
/**
 * The bearings, in radians from +x toward +z, where the front wall faces the opening view: no heap
 * rises there, so the dark wall shows from the rim down to the frame's foot, as in the concept.
 */
export const FRONT = { middle: 1.03, half: 0.52, edge: 0.25 } as const;
/**
 * The domes of each layer of a billow: their radius in meters, how many stand on one tile, and how
 * far each sinks below the surface it stands on, as a share of its radius.
 */
const DOMES = [
	{ radius: [11, 22], count: 70, sink: 0.55 },
	{ radius: [4, 8], count: 420, sink: 0.6 },
	{ radius: [1.3, 2.6], count: 2600, sink: 0.65 },
] as const;

/** The faint lilac cast of the concept's cloud, never pure white. */
const TINT = [0.935, 0.93, 1.12] as const;

/**
 * The cloud itself, drawn on the inside of a sphere round the camera with no depth test, so every
 * pixel runs once. A ray starts where it can first meet cloud and ends at the scene's surface.
 */
const cloudWgsl = /* wgsl */ `
#import null3d::noise::{pcg3d}

struct Uniforms {
    air: vec3f,
    top: f32,
    toward: vec3f,
    depth: f32,
    sun: vec3f,
    heap: f32,
    tint: vec3f,
    tower: f32,
    drift: vec2f,
    steps: f32,
    reach: f32,
    texels: f32,
    shade: f32,
    falls: vec4f,
    spray: vec2f,
}

var billows: texture_2d<f32>;
var walls: texture_2d<f32>;

// light {
/// The cloud's own tone of the air: the air's color, greyed toward its brightness and cast a faint
/// lilac, since a cloud is never as blue as the sky at the horizon. A colored main light, as the low
/// sun's is, turns the whole cloud toward its own hue, so golden hour keeps its warmth; the soft
/// white light of the day leaves it lilac.
fn cloud_air() -> vec3f {
    let weights = vec3f(0.2126, 0.7152, 0.0722);
    let grey = dot(material.air, weights);
    let base = mix(vec3f(grey), material.air, 0.15) * material.tint;
    let peak = max(max(material.sun.r, material.sun.g), material.sun.b);
    let hue = material.sun / max(peak, 1e-4);
    // No main light, as in the studio, leaves the tone as it is.
    let colored = (1.0 - min(min(hue.r, hue.g), hue.b)) * smoothstep(0.0, 0.05, peak);
    return base * mix(vec3f(1.0), hue / max(dot(hue, weights), 1e-3), 0.3 * colored);
}

/// The cloud's color, from the lilac grey of a billow's shaded hollow at form 0 to its sky-lit top
/// at form 1, with the main light's own color where it falls on the cloud, so the low sun warms
/// the tops and leaves the hollows lilac.
fn cloud_color(form: f32, lit: f32) -> vec3f {
    let shade = mix(0.7, 6.4, form * form);
    let warm = material.sun * material.tint * 0.5 * lit;
    return cloud_air() * shade + warm;
}

/// The air between the camera and a point: the cloud keeps its light and shade over the first few
/// hundred meters, then fades fast into the air's own color, so the horizon is one soft haze.
fn aerial(color: vec3f, distance: f32) -> vec3f {
    let far = distance / 700.0;
    return mix(color, cloud_air() * 5.4, 1.0 - exp(-far * far));
}
// } light

/// The billow map's tile, in meters: the module's TILE.
const TILE: f32 = 160.0;
/// The radius of the disc round the cliff where the sea's tops stand; the towers rise past it.
const NEAR: f32 = 180.0;
/// The radius inside which mist can drift at the walls' foot: past the widest rim and the mist's reach.
const MISTY: f32 = 46.0;

/// How much a pair of strengths, one for each fall's foot, holds a point, in xz: each foot's own,
/// fading from \`near\` to \`far\` meters from it.
fn near_falls(p: vec2f, strength: vec2f, near: f32, far: f32) -> f32 {
    let west = strength.x * (1.0 - smoothstep(near, far, length(p - material.falls.xy)));
    let east = strength.y * (1.0 - smoothstep(near, far, length(p - material.falls.zw)));
    return max(west, east);
}

/// The rim's radius, the heap's share, the mist's share and the front wall's share at a point's
/// bearing round the cliff.
fn wall_at(p: vec2f) -> vec4f {
    let turn = atan2(p.y, p.x) / 6.283185307 + 0.5;
    let w = textureSampleLevel(walls, wallsSampler, vec2f(turn, 0.5), 0.0);
    return vec4f(18.0 + 16.0 * w.r, w.g, w.b, w.a);
}

/// The cloud at a point: its height there, in meters, from the sea's two layers of billows, the
/// heaps against the walls and the far towers; the mist at the walls' foot; the small billows' own
/// height, low in the clefts between domes; and a fray that eats into the billows' edges. The map's
/// mip level follows the ray's footprint, so no grain shimmers.
fn cloud_at(p: vec3f, lod: f32) -> vec4f {
    let q = p.xz + material.drift * frame.time;
    let a = textureSampleLevel(billows, billowsSampler, q / TILE, lod).r;
    // The larger copy turns and drifts its own way, so the two layers never line up.
    let s = vec2f(q.x * 0.8 - q.y * 0.6, q.x * 0.6 + q.y * 0.8) * 0.92 + vec2f(37.0, 11.0);
    let b = textureSampleLevel(billows, billowsSampler, s / (TILE * 2.6), max(lod - 1.4, 0.0)).g;
    // A much larger copy sets how high the billows stand: great heaps in places, a calmer sea
    // between them, so the sea is never one even pattern.
    let big = textureSampleLevel(billows, billowsSampler, (q * 0.97 + vec2f(13.0, 71.0)) / (TILE * 5.5), max(lod - 2.5, 0.0)).g;
    let relief = material.depth * mix(0.5, 1.6, smoothstep(0.2, 0.8, big));
    var h = material.top - relief + relief * clamp((0.8 * b + 0.3 * a) / 1.02, 0.0, 1.0);
    var mist = 0.0;
    var fray = 0.0;
    let r = length(p.xz);
    if r < NEAR {
        let wall = wall_at(p.xz);
        // Against the walls, domes of their own heap up over the sea where the walls' map lets them.
        let close = 1.0 - smoothstep(0.0, 17.0, r - wall.x);
        let dome = textureSampleLevel(billows, billowsSampler, (q + vec2f(53.0, 29.0)) / (TILE * 0.35), lod + 1.5).r;
        // Round a calmed fall's foot the cloud lies flat: no heap rises and no puff climbs the wall.
        let calm = near_falls(p.xz, 1.0 - material.spray, 4.0, 14.0);
        let heaped = material.top - 2.0 + (material.heap * wall.y + 2.0) * pow(dome, 0.8) * close * (1.0 - calm);
        h = max(h, heaped);
        // Near the cliff the billows carry small domes of their own, a few meters across, which
        // catch light on their tops and shade between them; they fade out toward the disc's edge.
        let small = textureSampleLevel(billows, billowsSampler, (q + vec2f(91.0, 17.0)) / (TILE * 0.3), lod + 1.74).r;
        h += 4.5 * (small - 0.6) * (1.0 - smoothstep(NEAR * 0.55, NEAR, r));
        // The billows' edges fray, so a top never ends on one clean line.
        fray = textureSampleLevel(billows, billowsSampler, (q + vec2f(7.0, 19.0)) / 21.0, lod).b;
        // The mist at the walls' foot rises from the sea's level in dense puffs to an uneven height:
        // tall where the wall's own stretch of mist runs high, short elsewhere, thinning as it
        // climbs. It veils the rock over the billows, so the wall fades into the cloud.
        let foot = 1.0 - smoothstep(1.0, 11.0, r - wall.x);
        let rise = p.y - (material.top - 2.0);
        if foot * wall.z > 0.001 && p.y > h - 0.5 && rise < 9.0 {
            let along = atan2(p.z, p.x) * wall.x;
            let reach = 3.0 + 6.0 * textureSampleLevel(billows, billowsSampler, vec2f(along / 70.0 + 0.37, 0.61), 0.0).b;
            // No wisp climbs past a few meters under the rim, so the walls' upper part stays clear.
            let band = smoothstep(-0.5, 0.8, p.y - h) * (1.0 - smoothstep(reach * 0.25, reach, rise)) * (1.0 - smoothstep(-4.5, -1.5, p.y));
            // Round puffs, from the billow map's domes stood upright against the wall, that climb
            // slowly.
            let puff = textureSampleLevel(billows, billowsSampler, vec2f(along, (p.y - frame.time * 0.3) * 1.4) / 26.0, 0.0).r;
            // A thin veil over the tops' first meters joins the wisps, so the rock fades into them.
            let veil = smoothstep(-0.5, 0.8, p.y - h) * (1.0 - smoothstep(0.0, 5.0, rise));
            // The veil thickens over the last meters before the rock, so the rock fades into it.
            let close = 0.05 + 0.12 * (1.0 - smoothstep(0.0, 4.0, r - wall.x));
            // The puffs are densest at the front wall's foot, as in the concept; along the side walls
            // they are thin, so the rock there stays dark for most of its height.
            let climbing = calm * smoothstep(material.top - 1.0, material.top + 2.0, p.y);
            mist = foot * wall.z * (band * mix(0.35, 2.6, wall.w) * smoothstep(0.25, 0.65, puff) + close * veil) * (1.0 - climbing);
        }
        // Spray where a fall drops into the cloud: a mass of round puffs round its foot, densest low
        // down, that climbs only a little over the tops, below the stream's end. It thins over the
        // last meters before the rock, so it meets the wall softly.
        let spraying = near_falls(p.xz, material.spray, 4.0, 16.0);
        if spraying > 0.001 {
            let climb = p.y - (material.top - 2.0);
            let soft = mix(0.3, 1.0, smoothstep(0.5, 5.0, r - wall.x));
            let spray = spraying * soft * smoothstep(-0.5, 0.8, p.y - h) * (1.0 - smoothstep(1.5, 5.0, climb));
            let along = atan2(p.z, p.x) * wall.x;
            let billow = textureSampleLevel(billows, billowsSampler, vec2f(along + 31.0, (p.y - frame.time * 0.8) * 1.4) / 18.0, 0.0).r;
            mist = max(mist, spray * (0.8 + 1.6 * smoothstep(0.25, 0.7, billow)));
        }
    } else {
        // Far out, the billows of the largest copy rise into towers past the horizon, and sink
        // back into the sea before the rays' reach, so no tower is cut where the rays end.
        let rise = smoothstep(NEAR, 450.0, r) * (1.0 - smoothstep(900.0, 1350.0, r)) * smoothstep(0.3, 1.0, big);
        h += material.tower * rise * rise;
    }
    return vec4f(h, mist, a, fray);
}

/// The distance along the ray at which it leaves a disc round the cliff of radius r, in xz.
fn leave_disc(eye: vec2f, dir: vec2f, r: f32) -> f32 {
    let a = dot(dir, dir);
    if a < 1e-8 {
        return 1e9;
    }
    let b = dot(eye, dir);
    let c = dot(eye, eye) - r * r;
    return (-b + sqrt(max(b * b - a * c, 0.0))) / a;
}

/// How thick the cloud is at a point, as the billows' body and the mist apart: the body thickens
/// over its top meters, softer far off, and frays where its edge is eaten.
fn density_of(p: vec3f, here: vec4f, t: f32) -> vec2f {
    let soft = 2.2 + t * 0.05;
    let inside = here.x - p.y - here.w * 1.8;
    return vec2f(smoothstep(-0.3, soft, inside) * 1.4, here.y * 0.45);
}

fn unlit(input: SurfaceInput) -> vec4f {
    let dir = normalize(input.relativePosition);
    let eye = camera.position;
    // The ray ends at the scene's own surface: the copy of the depth holds the distance along the
    // view, which the ray covers at its angle to the view. Where nothing drew, it reads 0, and the
    // ray runs to its reach.
    let uv = input.fragCoord.xy / frame.resolution;
    let forward = max(-(camera.view * vec4f(dir, 0.0)).z, 1e-3);
    let behind = sceneDistance(uv);
    let end = select(material.reach, min(behind / forward, material.reach), behind > 0.0);
    // The ray ends at the scene's surface by its depth averaged over a small ring of pixels round
    // this one. Where one crag stands in front of another, the cloud before them then thickens
    // smoothly across the crag's edge, so a face veiled by the cloud shows no cut outline. A pixel
    // of the ring that sees past the rock into open cloud, much farther off, stays out of the
    // average, so the rock's own outline against the cloud keeps its edge.
    let texel_uv = 1.0 / frame.resolution;
    var sum = end;
    var count = 1.0;
    for (var k = 0; k < 8; k++) {
        let angle = f32(k) * 0.7853982;
        let b = sceneDistance(uv + vec2f(cos(angle), sin(angle)) * 2.5 * texel_uv);
        let e = select(material.reach, min(b / forward, material.reach), b > 0.0);
        let close = abs(e - end) < 20.0;
        sum += select(0.0, e, close);
        count += select(0.0, 1.0, close);
    }
    let limit = select(end, sum / count, behind > 0.0);
    let limitHit = behind > 0.0;
    // Where the ray can first meet cloud: under the heaps' highest tops inside the disc round the
    // cliff, and under the towers' highest tops past it.
    let low = material.top + material.heap + 1.0;
    let high = material.top + material.tower + 1.0;
    var start = 0.0;
    if eye.y > low {
        let down = select(1e9, (eye.y - low) / max(-dir.y, 1e-6), dir.y < 0.0);
        let leave = leave_disc(eye.xz, dir.xz, NEAR);
        if down <= leave {
            start = down;
        } else if eye.y + dir.y * leave <= high {
            start = leave;
        } else if dir.y < 0.0 {
            start = (eye.y - high) / -dir.y;
        } else {
            start = 1e9;
        }
    }
    if start >= limit {
        return vec4f(0.0);
    }
    // The size of a pixel on the cloud per meter of distance, for the map's mip level.
    let pixel = 2.0 / (camera.projection[1][1] * frame.resolution.y);
    let texel = TILE / material.texels;
    // Each pixel starts its steps a different share of half a step in, so the steps through thin
    // mist leave no rings. The share changes with the sketch time, which a held frame holds, so a
    // held picture draws the same each time.
    let cell = vec3u(vec2u(input.fragCoord.xy), u32(frame.time * 60.0));
    let jitter = f32(pcg3d(cell).x) / 4294967295.0;
    var t = min(start + jitter * 0.25 * (0.6 + start * 0.01), mix(start, limit, 0.5));
    var clear = 1.0;
    var color = vec3f(0.0);
    var form = 0.0;
    var sunlit = 0.0;
    var lit = false;
    // How many billows the ray has taken light from: past the first, a billow met after clear air
    // takes its own light, so a heap's outline in front of another is not cut hard.
    var lights = 0;
    // Where along the ray its light was last read, and the shade of the billows toward the sun.
    var litAt = 0.0;
    var shadow = 1.0;
    let steps = i32(material.steps);
    // The last point in clear air, where the search for the cloud's edge starts.
    var last = t;
    for (var i = 0; i < steps; i++) {
        if t >= limit || clear < 0.02 {
            break;
        }
        var p = eye + dir * t;
        // A ray that climbs past the highest towers meets no more cloud.
        if p.y > high && dir.y >= 0.0 {
            break;
        }
        let lod = log2(max(t * pixel / texel, 1.0));
        // Over its last meters before the scene's surface the cloud thins away, so a wall fades into
        // the cloud with no cut line along its blocks.
        let contact = select(1.0, smoothstep(0.0, 5.0, limit - t), limitHit);
        var here = cloud_at(p, lod);
        // The billows thin over their last meters before the rock; the mist only over its last
        // meter, so it runs on up to the rock and veils it.
        let touch = vec2f(contact, select(1.0, smoothstep(0.0, 1.0, limit - t), limitHit));
        var parts = density_of(p, here, t) * touch;
        if parts.x > 0.002 && !lit && t > last {
            // The step from clear air or mist went past the billow's edge: halve the gap a few
            // times to find it, so the edge neither rings nor grains with the steps.
            var lo = last;
            var hi = t;
            for (var k = 0; k < 4; k++) {
                let mid = 0.5 * (lo + hi);
                let q = eye + dir * mid;
                let d = density_of(q, cloud_at(q, lod), mid).x;
                if d > 0.002 {
                    hi = mid;
                } else {
                    lo = mid;
                }
            }
            t = hi;
            p = eye + dir * t;
            here = cloud_at(p, lod);
            parts = density_of(p, here, t) * touch;
        }
        let density = parts.x + parts.y;
        let h = here.x;
        let above = p.y - h;
        if density > 0.002 {
            // A ray reads its light again every few meters on its way through the cloud, so a billow
            // that it reaches past another's edge takes its own light, and their outlines blend by
            // how much of each the ray crossed rather than switch on one line.
            if lit && lights < 8 && t - litAt > 1.0 + t * 0.02 {
                lit = false;
            }
            if !lit && parts.x > 0.002 {
                // Where the ray first meets the billow, past any mist: its slope, from its heights a step to each
                // side; the sky's light on the sides that face up; the main light on the sides that
                // face it, unless a billow toward it stands higher; the clefts between domes; and how
                // high this top stands in the sea.
                // The slope is read over a few meters, so the light follows the great billows'
                // form rather than every small dome on them.
                let e = 2.5 + t * 0.02;
                let hx = cloud_at(p + vec3f(e, 0.0, 0.0), lod + 1.0).x;
                let hz = cloud_at(p + vec3f(0.0, 0.0, e), lod + 1.0).x;
                let hc = cloud_at(p, lod + 1.0).x;
                let normal = normalize(vec3f(hc - hx, e, hc - hz));
                let sun = material.toward;
                let across = max(length(sun.xz), 0.05);
                // The billows toward the sun shade this one, read at the ray's first billow alone;
                // later readings keep it.
                for (var k = 1; k <= 3 && lights == 0; k++) {
                    let d = (4.0 + t * 0.02) * f32(k * k);
                    let toward = p.xz + sun.xz / across * d;
                    let rise = cloud_at(vec3f(toward.x, p.y, toward.y), lod + 1.0).x - (p.y + sun.y / across * d);
                    shadow = min(shadow, 1.0 - 0.75 * smoothstep(0.0, 3.0, rise));
                }
                let lambert = clamp(dot(normal, sun) * 0.5 + 0.5, 0.0, 1.0) * shadow;
                // How far this top stands over or under the billows round it, from the map's
                // coarse level: a top over its neighbours takes the sky's full light, and a hollow
                // among them lies in their shade, whatever the sun's height.
                let around = cloud_at(p, max(lod + 2.0, log2(16.0 / texel))).x;
                // A heap against a wall stands far over the sea round it, so it takes its light from
                // its own round form: its top bright and its sides grey.
                let wall = wall_at(p.xz);
                let reach = length(p.xz);
                let heapy = select(0.0, (1.0 - smoothstep(0.0, 17.0, reach - wall.x)) * wall.y, reach < NEAR);
                let open = clamp(0.5 + (h - around) / mix(2.0, 8.0, heapy), 0.0, 1.0);
                let cleft = smoothstep(0.12, 0.75, here.z);
                let lift = clamp((h - (material.top - material.depth * 1.6)) / (material.depth * 1.6 + 5.0), 0.0, 1.0);
                let up = max(normal.y, 0.0);
                let sea = 0.1 * up + 0.25 * lambert + 0.45 * open + 0.1 * cleft + 0.2 * lift;
                let round = 0.05 + 0.65 * up * up + 0.15 * lambert + 0.2 * open;
                // Close to the walls the cliff hides part of the sky, so the cloud there is greyer.
                let hidden = select(1.0, 0.78 + 0.22 * smoothstep(0.0, 30.0, reach - wall.x), reach < NEAR);
                // Large soft masses of the sea, some brighter and some greyer, as in the concept.
                let massAt = (p.xz + material.drift * frame.time) * 0.97 + vec2f(71.0, 13.0);
                let mass = textureSampleLevel(billows, billowsSampler, massAt / (TILE * 3.0), 0.0).g;
                form = clamp((mix(sea, round, heapy) + 0.4 * (mass - 0.5)) * hidden, 0.0, 1.0);
                sunlit = max(dot(normal, sun), 0.0) * shadow * (0.5 + 0.5 * cleft) * hidden * hidden * hidden;
                lit = true;
                lights += 1;
                litAt = t;
            }
            // The last step ends at the scene's surface, so the cloud before a wall thins smoothly.
            let stride = min(0.35 + t * 0.008, limit - t);
            // Deeper in the billow the cloud darkens a little.
            let deep = exp(-max(-above, 0.0) / 3.0);
            // Mist is a grey that the sun barely reaches; the billow takes its own light. Mist met
            // before the billow is all mist, and its steps move the billow's edge search on.
            let misty = select(1.0, clamp(parts.y / density, 0.0, 1.0), lit);
            if !lit {
                last = t;
            }
            // Round each fall's foot the cloud and its mist grey a little and unevenly. The spray
            // there catches the light and reads brighter than the cloud, unevenly too, and darker
            // toward the wall, whose rock shades it.
            var shaded = 1.0;
            let under = near_falls(p.xz, vec2f(1.0), 8.0, 30.0);
            if under > 0.001 {
                let mottle = textureSampleLevel(billows, billowsSampler, (p.xz + vec2f(p.y * 0.7, 0.0)) / 7.0 + vec2f(0.31, 0.17), 0.0).b;
                shaded = 1.0 - material.shade * under * (0.4 + 1.2 * mottle);
            }
            let glow = near_falls(p.xz, material.spray, 6.0, 20.0);
            var spraylit = 0.7 * shaded;
            if glow > 0.001 {
                let grain = textureSampleLevel(billows, billowsSampler, (p.xz + vec2f(p.y * 0.7, 0.0)) / 9.0, 0.0).b;
                let wallward = 1.0 - smoothstep(0.0, 8.0, length(p.xz) - wall_at(p.xz).x);
                spraylit = mix(spraylit, 1.05 * mix(0.84, 1.08, grain) * (1.0 - 0.25 * wallward), glow);
            }
            let greyed = form * shaded;
            let tone = cloud_color(mix(greyed, spraylit, misty), sunlit * (1.0 - misty)) * mix(0.72, 1.0, deep);
            let alpha = 1.0 - exp(-density * stride);
            color += clear * alpha * aerial(tone, t);
            clear *= 1.0 - alpha;
            t += stride;
        } else {
            // Clear air: step a share of the height over the tops, never so far that a billow's
            // side slips between two steps, and in short steps through the mist by the walls.
            let longest = select(4.0 + t * 0.09, 0.5 + t * 0.01, length(p.xz) < MISTY && above < 8.5);
            last = t;
            lit = lit && lights >= 3;
            t += clamp(above * 0.5, 0.3 + t * 0.07, longest);
        }
    }
    // A ray that runs out of steps over open sea would show the dome through a hole: it meets the
    // sea's tops where they lie on average, at that distance's tone.
    if clear > 0.02 && t < limit && limit >= material.reach && dir.y < -0.002 {
        let meet = max((eye.y - (material.top - material.depth * 0.4)) / -dir.y, t);
        color += clear * aerial(cloud_color(0.7, 0.0), meet);
        clear = 0.0;
    }
    // The rock just over the cloud fades into it by its height, whatever its depth, so crags that
    // stand at different depths show no bands where the cloud before them is deeper or shallower.
    // The fade stays low and light, so every wall is dark rock for most of its height. At the side
    // walls' foot the rock at and just over the cloud's top is lost in it, so the crags that stand
    // in the mist there show no shape of their own.
    if behind > 0.0 {
        let at = eye + dir * end;
        let side = 1.0 - smoothstep(0.85, 1.0, wall_at(at.xz).w);
        // Round a calm fall's foot the rock stays dark down to the cloud's own level; round a
        // spraying one it fades into the spray over a few meters, so the mist meets the wall softly.
        let calm = near_falls(at.xz, 1.0 - material.spray, 6.0, 26.0);
        let over = mix(material.top + 5.5, material.top + 0.5, calm);
        let sprayed = 0.55 * near_falls(at.xz, material.spray, 10.0, 40.0) * (1.0 - smoothstep(material.top - 3.0, material.top + 6.0, at.y));
        let lost = max(0.82 * side * (1.0 - smoothstep(material.top - 1.0, over, at.y)), sprayed);
        // The two fades together never take more than the light left.
        let veil = min(0.25 * (1.0 - smoothstep(material.top - 0.5, material.top + 4.5, at.y)) + lost, 1.0) * clear;
        color += veil * aerial(cloud_color(0.65, 0.0), end);
        clear -= veil;
    }
    let alpha = 1.0 - clear;
    if alpha < 0.001 {
        return vec4f(0.0);
    }
    return vec4f(color / alpha, alpha);
}
`;

/**
 * The dome far round the camera: the overcast above the horizon, thinning to the sky's own cloud
 * overhead, and the far sea below it past the reach of the cloud's rays.
 */
const domeWgsl = /* wgsl */ `
struct Uniforms {
    air: vec3f,
    top: f32,
    toward: vec3f,
    reach: f32,
    sun: vec3f,
    tint: vec3f,
}

// light {
/// The cloud's own tone of the air: the air's color, greyed toward its brightness and cast a faint
/// lilac, since a cloud is never as blue as the sky at the horizon. A colored main light, as the low
/// sun's is, turns the whole cloud toward its own hue, so golden hour keeps its warmth; the soft
/// white light of the day leaves it lilac.
fn cloud_air() -> vec3f {
    let weights = vec3f(0.2126, 0.7152, 0.0722);
    let grey = dot(material.air, weights);
    let base = mix(vec3f(grey), material.air, 0.15) * material.tint;
    let peak = max(max(material.sun.r, material.sun.g), material.sun.b);
    let hue = material.sun / max(peak, 1e-4);
    // No main light, as in the studio, leaves the tone as it is.
    let colored = (1.0 - min(min(hue.r, hue.g), hue.b)) * smoothstep(0.0, 0.05, peak);
    return base * mix(vec3f(1.0), hue / max(dot(hue, weights), 1e-3), 0.3 * colored);
}

/// The cloud's color, from the lilac grey of a billow's shaded hollow at form 0 to its sky-lit top
/// at form 1, with the main light's own color where it falls on the cloud, so the low sun warms
/// the tops and leaves the hollows lilac.
fn cloud_color(form: f32, lit: f32) -> vec3f {
    let shade = mix(0.7, 6.4, form * form);
    let warm = material.sun * material.tint * 0.5 * lit;
    return cloud_air() * shade + warm;
}

/// The air between the camera and a point: the cloud keeps its light and shade over the first few
/// hundred meters, then fades fast into the air's own color, so the horizon is one soft haze.
fn aerial(color: vec3f, distance: f32) -> vec3f {
    let far = distance / 700.0;
    return mix(color, cloud_air() * 5.4, 1.0 - exp(-far * far));
}
// } light

fn unlit(input: SurfaceInput) -> vec4f {
    let dir = normalize(input.relativePosition);
    // Above the horizon the air stays thick, and the overcast thins up to the sky's own cloud.
    let haze = mix(0.96, 0.72, smoothstep(0.02, 0.9, dir.y));
    let cover = 1.0 - smoothstep(-0.01, 0.03, dir.y);
    // The far sea, where the cloud's rays end: its tops at their brightest, faded by the air.
    let color = cloud_color(0.8, 0.25 * max(material.toward.y, 0.0));
    let distance = select(material.reach * 3.0, material.reach, dir.y < 0.0);
    // Above the horizon the overcast is a step darker than the far cloud's lit tops, so the towers
    // stand out against it, and darker again overhead.
    let overhead = select(1.0, mix(0.95, 0.85, smoothstep(0.02, 1.0, dir.y)), dir.y > 0.0);
    return vec4f(aerial(color, distance) * overhead, max(cover, haze));
}
`;

/** The cloud sea round the cliff, and what each frame and preset change on it. */
export interface Clouds {
	/** Gives the clouds the air's linear color at the horizon and the main light, from the stage. */
	update(air: readonly [number, number, number], light: Stage['light']): void;
	/** Takes a preset's march: fewer steps on weaker devices. */
	fit(preset: QualityPreset): void;
	/** Kept for the scene's late update: the cloud moves on the GPU alone, so a frame steps nothing. */
	step(): void;
}

/** A smooth step from 0 at `a` to 1 at `b`. */
const smooth = (x: number, a: number, b: number) => {
	const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
	return t * t * (3 - 2 * t);
};

/**
 * One field of billows on a square tile that repeats: domes heaped in layers, each dome of a layer
 * sinking part way into the surface that the layers below made, as the rounded tops of cumulus do.
 * The heights are scaled to 0 at the lowest point and 1 at the highest.
 */
export function billowField(size: number, seed: number): Float32Array {
	const next = random(seed);
	const texel = TILE / size;
	const field = new Float32Array(size * size);
	const at = (x: number, z: number) => {
		const i = ((Math.round(x / texel) % size) + size) % size;
		const j = ((Math.round(z / texel) % size) + size) % size;
		return field[j * size + i] as number;
	};
	for (const layer of DOMES) {
		const count = layer.count;
		for (let k = 0; k < count; k++) {
			const cx = next() * TILE;
			const cz = next() * TILE;
			const r = layer.radius[0] + (layer.radius[1] - layer.radius[0]) * next();
			const cy = at(cx, cz) - r * layer.sink;
			const span = Math.ceil(r / texel);
			const ci = Math.round(cx / texel);
			const cj = Math.round(cz / texel);
			for (let dj = -span; dj <= span; dj++)
				for (let di = -span; di <= span; di++) {
					const dx = (ci + di) * texel - cx;
					const dz = (cj + dj) * texel - cz;
					const d2 = r * r - dx * dx - dz * dz;
					if (d2 <= 0) continue;
					const i = (((ci + di) % size) + size) % size;
					const j = (((cj + dj) % size) + size) % size;
					const h = cy + Math.sqrt(d2);
					if (h > (field[j * size + i] as number)) field[j * size + i] = h;
				}
		}
	}
	let low = Infinity;
	let high = -Infinity;
	for (const h of field) {
		low = Math.min(low, h);
		high = Math.max(high, h);
	}
	for (let i = 0; i < field.length; i++) field[i] = ((field[i] as number) - low) / (high - low);
	return field;
}

/**
 * Streaks of a value noise on a tile that repeats, from 0 to 1, for the mist's wisps: a few octaves
 * on lattices that divide the tile, so its edges meet.
 */
export function streakField(size: number, seed: number): Float32Array {
	const next = random(seed);
	const field = new Float32Array(size * size);
	let weight = 0;
	for (const [cells, share] of [
		[8, 0.5],
		[16, 0.3],
		[32, 0.2],
	] as const) {
		const lattice = Float32Array.from({ length: cells * cells }, () => next());
		const value = (i: number, j: number) =>
			lattice[(((j % cells) + cells) % cells) * cells + (((i % cells) + cells) % cells)] as number;
		for (let j = 0; j < size; j++)
			for (let i = 0; i < size; i++) {
				const x = (i / size) * cells;
				const z = (j / size) * cells;
				const i0 = Math.floor(x);
				const j0 = Math.floor(z);
				const fx = smooth(x - i0, 0, 1);
				const fz = smooth(z - j0, 0, 1);
				const top = value(i0, j0) + (value(i0 + 1, j0) - value(i0, j0)) * fx;
				const bottom = value(i0, j0 + 1) + (value(i0 + 1, j0 + 1) - value(i0, j0 + 1)) * fx;
				field[j * size + i] = (field[j * size + i] as number) + (top + (bottom - top) * fz) * share;
			}
		weight += share;
	}
	for (let i = 0; i < field.length; i++) field[i] = (field[i] as number) / weight;
	return field;
}

/** The billow map's texels at a size: two fields of billows and the mist's streaks. */
export function billowData(size: number): Uint8Array<ArrayBuffer> {
	const sea = billowField(size, 211);
	const swell = billowField(size, 307);
	const streaks = streakField(size, 401);
	const data = new Uint8Array(size * size * 4);
	for (let i = 0; i < size * size; i++) {
		data[i * 4] = Math.round((sea[i] as number) * 255);
		data[i * 4 + 1] = Math.round((swell[i] as number) * 255);
		data[i * 4 + 2] = Math.round((streaks[i] as number) * 255);
		data[i * 4 + 3] = 255;
	}
	return data;
}

/** The shortest turn between two bearings, in radians. */
const turnBetween = (a: number, b: number) =>
	Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

/**
 * The walls' map round the cliff, one texel per bearing: the rim's radius, how high the tops heap
 * against the wall there, how thick the mist at its foot drifts, and how much of the front wall
 * the bearing is.
 */
export function wallData(): Uint8Array {
	const next = random(509);
	// The concept's heaps: high against the west wall behind the west fall, along the back walls
	// behind the island, and up the east wall beside the east fall; a few smaller ones elsewhere.
	const bumps = [
		{ at: Math.PI, width: 0.7, height: 1 },
		{ at: -1.6, width: 0.8, height: 0.9 },
		{ at: 0.2, width: 0.45, height: 0.7 },
		...Array.from({ length: 5 }, () => ({
			at: next() * Math.PI * 2,
			width: 0.25 + 0.35 * next(),
			height: 0.3 + 0.4 * next(),
		})),
	];
	const data = new Uint8Array(RIM_TEXELS * 4);
	for (let k = 0; k < RIM_TEXELS; k++) {
		const bearing = (k / RIM_TEXELS - 0.5) * Math.PI * 2;
		let heap = 0.15;
		for (const bump of bumps)
			heap = Math.max(
				heap,
				bump.height * Math.exp(-((turnBetween(bearing, bump.at) / bump.width) ** 2)),
			);
		const front =
			1 - smooth(turnBetween(bearing, FRONT.middle), FRONT.half, FRONT.half + FRONT.edge);
		const mist = 0.55 + 0.45 * Math.sin(bearing * 3 + 1.1) ** 2;
		// A radius past the stored range keeps to its end rather than wrapping round the byte.
		const rim = (rimRadius(bearing) - RIM_RANGE.low) / RIM_RANGE.span;
		data[k * 4] = Math.round(Math.min(Math.max(rim, 0), 1) * 255);
		data[k * 4 + 1] = Math.round(heap * (1 - front) * 255);
		data[k * 4 + 2] = Math.round(mist * (1 - 0.35 * front) * 255);
		data[k * 4 + 3] = Math.round(front * 255);
	}
	return data;
}

/** The walls' map as a texture, read by bearing round the cliff. */
function wallMap(ctx: SketchContext): Texture {
	return ctx.textures.fromData({
		width: RIM_TEXELS,
		height: 1,
		data: wallData(),
		colorSpace: 'linear',
		wrap: ['repeat', 'clamp'],
	});
}

/** Makes the cloud sea and its far dome. */
export async function createClouds(ctx: SketchContext, preset: QualityPreset): Promise<Clouds> {
	const { scene, geometry, materials } = ctx;
	const air: [number, number, number] = [0.6, 0.62, 0.66];
	const toward: [number, number, number] = [0, 1, 0];
	const sun: [number, number, number] = [0, 0, 0];
	const tint: [number, number, number] = [...TINT];
	// The billow map follows the preset: its texels at each size are built once and kept, so a
	// preset that changes back and forth builds nothing again.
	const built = new Map<number, Uint8Array<ArrayBuffer>>();
	const billowsAt = (size: number) => {
		let data = built.get(size);
		if (!data) {
			data = billowData(size);
			built.set(size, data);
		}
		return data;
	};
	let size = MAP_SIZE[preset];
	const billows = ctx.textures.fromData({
		width: size,
		height: size,
		data: billowsAt(size),
		colorSpace: 'linear',
		wrap: 'repeat',
		mipmaps: true,
	});
	const cloud = materials.shader({
		wgsl: cloudWgsl,
		fog: false,
		alphaMode: 'blend',
		depthWrite: false,
		depthTest: false,
		doubleSided: true,
		forceSinglePass: true,
		sceneInputs: ['sceneDepth'],
		textures: { billows, walls: wallMap(ctx) },
		uniforms: {
			air,
			toward,
			sun,
			tint,
			top: CLOUD.top,
			depth: CLOUD.depth,
			heap: CLOUD.heap,
			tower: CLOUD.tower,
			drift: [...DRIFT] as [number, number],
			steps: STEPS[preset],
			reach: CLOUD.reach,
			texels: size,
			falls: [...FALLS] as [number, number, number, number],
			spray: [...SPRAY] as [number, number],
			shade: FOOT_SHADE,
		},
	});
	// The cloud draws on the effect layer: the water's reflection leaves it out, and the camera's
	// clearance never takes the sphere round it for a wall.
	scene
		.createMesh({
			mesh: geometry.sphere({ radius: CLOUD.reach, widthSegments: 32, heightSegments: 16 }),
			material: cloud,
			layers: EFFECT_LAYER,
			castShadows: false,
			receiveShadows: false,
		})
		.setRenderOrder(-19);
	const dome = materials.shader({
		wgsl: domeWgsl,
		fog: false,
		alphaMode: 'blend',
		depthWrite: false,
		doubleSided: true,
		uniforms: { air, toward, sun, tint, top: CLOUD.top, reach: CLOUD.reach },
	});
	scene
		.createMesh({
			mesh: geometry.sphere({ radius: CLOUD.dome, widthSegments: 48, heightSegments: 24 }),
			material: dome,
			castShadows: false,
			receiveShadows: false,
		})
		.setRenderOrder(-20);
	const shaded = [cloud, dome];
	return {
		update(nextAir, light) {
			for (let c = 0; c < 3; c++) {
				air[c] = nextAir[c] as number;
				toward[c] = light.toward[c] as number;
				sun[c] = light.color[c] as number;
			}
			for (let m = 0; m < shaded.length; m++) {
				const material = shaded[m] as typeof cloud;
				material.setUniform('air', air);
				material.setUniform('toward', toward);
				material.setUniform('sun', sun);
			}
		},
		fit(next) {
			cloud.setUniform('steps', STEPS[next]);
			const wanted = MAP_SIZE[next];
			if (wanted === size) return;
			size = wanted;
			// A texture of another size takes its texels from an image, which comes a little later;
			// the cloud reads the map by its new size once the image is there.
			const data = billowsAt(wanted);
			const image = new ImageData(new Uint8ClampedArray(data.buffer), wanted, wanted);
			void createImageBitmap(image, {
				premultiplyAlpha: 'none',
				colorSpaceConversion: 'none',
			}).then((bitmap) => {
				if (size !== wanted) {
					bitmap.close();
					return;
				}
				billows.update(bitmap);
				cloud.setUniform('texels', wanted);
			});
		},
		step() {},
	};
}
