// The towers of Skyway: one instanced batch of boxes, and one material that draws every window on
// them. Each face carries a grid of windows in world units, so one window is the same size on every
// building, and the grid never stretches with a building's scale. A lit window looks into a small
// room, mirrored in parallax as the camera passes: a lamp panel, a floor, a ceiling and a block of
// furniture. Far away, where a window is smaller than a pixel, the pattern fades to the average
// light of the face instead of shimmering. Street level is a band of shop fronts.
//
// Every window waits for the city's power-on wave, which runs out from the middle in the first
// second, so the skyline lights up as the scene starts.
import type { QualityPreset, SketchContext } from '@null3d/engine';
import { cityBuildings } from './layout';

/** The share of windows that are lit. */
const LIT_SHARE = 0.42;
/** How long the power-on wave takes to cross the city, in seconds. */
const WAVE = 0.25;

const wgsl = /* wgsl */ `
#import null3d::noise::{random2}

struct Uniforms { litShare: f32, wave: f32 }

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let n = normalize(input.normal);
    let seed = object.values.x;
    let place = object.position;
    // One horizontal coordinate across the face, which keeps the window size on every face.
    let along = select(input.worldPosition.z, input.worldPosition.x, abs(n.x) > abs(n.z));
    let height = input.worldPosition.y;
    // The window grid and how many pixels one cell covers. A derivative call must stand in the
    // uniform control flow of the entry point, so it comes before the branches below.
    let cell = vec2f(along / 3.2, (height - 1.4) / 3.7);
    let covered = fwidth(cell);
    // The city's power-on wave: a building lights when the wave reaches it.
    let reach = length(place.xz);
    let wave = smoothstep(0.0, 1.0, (frame.time - reach / 2600.0) * (1.0 / max(material.wave, 0.001)));

    // The roof: a dark deck with a grain of its own, and none of the windows below.
    if (abs(n.y) > 0.5) {
        // A roof is a dark deck that keeps the city's own glow, so it never reads as a hole.
        s.baseColor = vec3f(0.03, 0.032, 0.038) * (0.7 + 0.6 * seed);
        s.metalness = 0.15;
        s.roughness = 0.82;
        s.emissive = vec3f(0.008, 0.008, 0.011);
        return s;
    }

    // Street level: shop fronts, bright behind glass, in colours picked per shop.
    if (height < 7.0) {
        let shopCell = vec2f(along / 11.0, seed * 9.0);
        let f = fract(vec2f(along / 11.0, height / 7.0));
        let glass = step(0.05, f.x) * step(f.x, 0.95) * step(0.12, f.y);
        let pick = random2(shopCell);
        let hue = 0.5 + 0.5 * cos(6.28318 * (pick + vec3f(0.0, 0.33, 0.67)));
        let on = step(0.2, pick) * wave;
        s.baseColor = mix(vec3f(0.035, 0.038, 0.045), vec3f(0.008, 0.01, 0.016), glass);
        s.metalness = mix(0.05, 0.85, glass);
        s.roughness = mix(0.7, 0.1, glass);
        s.emissive = hue * glass * on * (1.2 + 1.4 * f.y);
        return s;
    }

    let id = floor(cell);
    let f = fract(cell);
    let far = smoothstep(0.35, 0.8, max(covered.x, covered.y));
    let inside = step(0.24, f.x) * step(f.x, 0.76) * step(0.28, f.y) * step(f.y, 0.72);
    let pick = random2(vec2f(id.x * 1.37 + seed * 71.3, id.y * 2.11 + seed * 23.9));
    let lit = step(pick, material.litShare) * wave;
    // Each room is as bright as its own household: some windows read dim, some bright.
    let level = 0.32 + 0.85 * random2(id * 1.7 + vec2f(seed * 11.0));
    let warm = mix(vec3f(0.62, 0.78, 1.0), vec3f(1.0, 0.72, 0.45), step(0.55, random2(id + vec2f(seed * 3.7))));

    // The room behind a lit window, in the window's own coordinates, shifted by the view.
    let win = clamp((f - vec2f(0.24, 0.28)) / vec2f(0.52, 0.44), vec2f(0.0), vec2f(1.0));
    let d = -input.viewDirection;
    let right = normalize(cross(vec3f(0.0, 1.0, 0.0), n));
    let up = cross(n, right);
    let u = win.x * 2.0 - 1.0 - dot(d, right) * 1.25;
    let v = win.y * 2.0 - 1.0 - dot(d, up) * 1.25;
    var room = vec3f(0.34, 0.26, 0.19);
    room *= 0.55 + 0.45 * smoothstep(-1.0, 0.9, v);
    room = mix(room, vec3f(0.1, 0.085, 0.075), step(v, -0.5));
    room = mix(room, vec3f(0.2, 0.19, 0.18), step(0.68, v));
    let panel = step(abs(u), 0.3) * step(0.24, v) * step(v, 0.6);
    let block = step(abs(u + 0.12), 0.42) * step(v, -0.18) * step(-0.5, v);
    room = mix(room, vec3f(0.055, 0.05, 0.048), block);
    var roomLight = room * (0.9 + 7.0 * panel) * level;
    let blinds = step(0.58, fract(v * 6.0)) * step(0.6, random2(vec2f(seed * 17.0, id.y)));
    roomLight *= mix(1.0, 0.5, blinds);

    // The wall between the windows, and the dark glass of a window that is out.
    s.baseColor = mix(vec3f(0.026, 0.03, 0.04), vec3f(0.006, 0.009, 0.015), inside);
    s.metalness = mix(0.05, 0.9, inside);
    s.roughness = mix(0.8, 0.08, inside);
    s.emissive = roomLight * warm * lit * inside;

    // Far away the grid is smaller than a pixel: show the face's average light instead.
    let average = warm * material.litShare * 0.32;
    s.emissive = mix(s.emissive, average * wave, far);
    s.baseColor = mix(s.baseColor, vec3f(0.03, 0.033, 0.04), far);
    s.metalness = mix(s.metalness, 0.3, far);
    s.roughness = mix(s.roughness, 0.55, far);
    return s;
}
`;

/** The city's towers. */
export interface Facades {
	/** Draws the city's towers. */
	fit(preset: QualityPreset): void;
}

/** Builds the towers from the city plan. */
export function createFacades(ctx: SketchContext): Facades {
	const { scene, geometry, materials } = ctx;
	// The plan is made once, and every building keeps its place in the batch, so a preset only
	// changes how many rows draw.
	const buildings = cityBuildings();
	buildings.sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z) || b.height - a.height);
	const material = materials.shader({
		wgsl,
		uniforms: { litShare: LIT_SHARE, wave: WAVE },
		color: '#2a2f3a',
		roughness: 0.8,
		metalness: 0.05,
		contactShadows: false,
	});
	const batch = scene.createInstances(geometry.box(), buildings.length, {
		material,
		values: true,
	});
	for (let k = 0; k < buildings.length; k++) {
		const building = buildings[k] as (typeof buildings)[number];
		batch.positions.set([building.x, building.height / 2, building.z], k * 3);
		batch.scales.set([building.width, building.height, building.depth], k * 3);
		(batch.values as Float32Array)[k * 4] = building.seed;
	}
	batch.markDirty(0, buildings.length);

	// The masts on the tallest roofs, and the red lights that blink at their tips. Both are rows of
	// one batch each, so a skyline of masts costs two draw calls.
	const masts = buildings.filter((building) => building.height > 96).slice(0, 220);
	const mastBatch = scene.createInstances(geometry.box(), masts.length, {
		material: materials.shader({
			wgsl: /* wgsl */ `
fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    s.baseColor = vec3f(0.02, 0.022, 0.026);
    s.roughness = 0.7;
    s.metalness = 0.4;
    return s;
}`,
			contactShadows: false,
		}),
	});
	const beaconBatch = scene.createInstances(
		geometry.sphere({ radius: 0.5, widthSegments: 8, heightSegments: 6 }),
		masts.length,
		{
			material: materials.shader({
				wgsl: /* wgsl */ `
fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    // Each light blinks at its own pace, out of step with its neighbours.
    let phase = object.values.x * 6.28318;
    let blink = smoothstep(0.55, 1.0, sin(frame.time * 1.6 + phase) * 0.5 + 0.5);
    s.baseColor = vec3f(0.0);
    s.emissive = vec3f(1.0, 0.06, 0.03) * (0.4 + 5.0 * blink);
    return s;
}`,
				fog: false,
				contactShadows: false,
			}),
			values: true,
		},
	);
	for (let k = 0; k < masts.length; k++) {
		const building = masts[k] as (typeof masts)[number];
		const mast = 6 + ((building.seed * 17) % 14);
		const top = building.height + mast;
		mastBatch.positions.set([building.x, building.height + mast / 2, building.z], k * 3);
		mastBatch.scales.set([0.5, mast, 0.5], k * 3);
		beaconBatch.positions.set([building.x, top, building.z], k * 3);
		(beaconBatch.values as Float32Array)[k * 4] = building.seed;
	}
	mastBatch.markDirty(0, masts.length);
	beaconBatch.markDirty(0, masts.length);

	return {
		fit(_preset) {
			// Every tower draws at every preset. A row here is a box of twelve triangles, and the
			// cost is in the windows that a pixel shades: a preset that thinned the skyline would
			// open a hole at the edge of the city that the route flies past.
			batch.setActiveCount(buildings.length);
			mastBatch.setActiveCount(masts.length);
			beaconBatch.setActiveCount(masts.length);
		},
	};
}
