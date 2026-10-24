// The towers of Skyway: one instanced batch of boxes, and the facades add-on's material that draws
// every window on them. Each face carries a grid of windows in world units, so one window is the
// same size on every building, and the grid never stretches with a building's scale. A lit window
// looks into a small room, in parallax as the camera passes: a lamp's pool, a floor, a ceiling and
// a block of furniture, with blinds and a curtain in some rooms. Far away, where a window is
// smaller than a pixel, the pattern fades to the wall's average light instead of shimmering, and
// street level is a band of shop fronts.
//
// Every window waits for the city's power-on wave, which runs out from the middle in the first
// second and lights each window on a damped spring, so the skyline comes on as the scene starts.
import type { QualityPreset, SketchContext } from '@null3d/engine';
import { createFacade } from '../../addons/facades/index';
import { cityBuildings } from './layout';

/** The city's towers. */
export interface Facades {
	/** Draws the city's towers. */
	fit(preset: QualityPreset): void;
	/** Sets the share of the city's own lights that burn, from 0 by day to 1 at night. */
	power(share: number): void;
}

/** Builds the towers from the city plan. */
export function createFacades(ctx: SketchContext): Facades {
	const { scene, geometry, materials } = ctx;
	// The plan is made once, and every building keeps its place in the batch, so a preset only
	// changes how many rows draw.
	const buildings = cityBuildings();
	buildings.sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z) || b.height - a.height);
	// A bay holds a window of a fixed size in world units, with the frame around it and the pier
	// between two windows, so one window is the same size on every tower.
	const facades = createFacade(ctx, {
		// The wall finish takes the finish's own colour times this dark, cool tint, so a tower
		// reads as dark stone and metal at night and its lit rooms carry the picture.
		color: '#2a2f3a',
		window: { width: 1.66, height: 1.63, spacing: 1.3, floorHeight: 3.7, frame: 0.12, sill: 1.4 },
		room: { depth: 2.6, light: 2.6, litShare: 0.42, flicker: 0.45 },
		power: { origin: [0, 0], speed: 2600, rise: 12, damping: 6 },
		shops: { height: 7 },
	});
	const batch = scene.createInstances(geometry.box(), buildings.length, {
		material: facades.material,
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

	// The city lights up as the scene starts: the wave runs out from its middle.
	facades.start(0);

	return {
		fit(_preset) {
			// Every tower draws at every preset. A row here is a box of twelve triangles, and the
			// cost is in the windows that a pixel shades: a preset that thinned the skyline would
			// open a hole at the edge of the city that the route flies past.
			batch.setActiveCount(buildings.length);
			mastBatch.setActiveCount(masts.length);
			beaconBatch.setActiveCount(masts.length);
		},
		power(share) {
			facades.setPower(share);
		},
	};
}
