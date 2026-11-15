// The vegetation add-on's meadow: every species the add-on registers, grown from its record and
// planted across a field, so one page shows what the catalogue holds. Each species takes a patch of
// its own, sized to the plant, and the camera orbits the whole meadow. As records land in the
// registry the meadow fills with them; the label names how many are in the catalogue today.
//
// The plants are the game's own assets, grown through the package's public functions. Drag to turn
// round the meadow and use the wheel to step in. Press R to grow it all again from another seed.
import { defineSketch, timeOfDay } from '@null3d/engine';
import { createGrass, grassCover, isSpeciesId, loadSpecies } from '@null3d/vegetation';
import { interact } from '../lib/interact';
import { isPolygonStep, type MeadowControls, polygonMaximum, postHud } from './hud';
import { createMeadow, type MeadowPlant } from './meadow';

/**
 * The species a held picture draws, named in its switch by folder id; the live page names none and
 * draws every registered species.
 */
const HELD_SPECIES = (new URL(import.meta.url).searchParams.get('species') ?? '')
	.split(',')
	.filter(isSpeciesId);

export default defineSketch(async (ctx) => {
	const { scene, assets, post, input, page } = ctx;
	const day = timeOfDay('afternoon', { heading: 0.6 });
	scene.setBackground({ sky: day.sky }, { intensity: day.skyIntensity });
	scene.setEnvironment(await assets.skyEnvironment(), { intensity: day.skyIntensity * 0.8 });
	post.set({ exposure: day.exposure });
	scene.createDirectionalLight({ ...day.light, castShadows: true, shadow: { distance: 60 } });
	scene.createAmbientLight(day.ambient);

	// The ground: a field that reaches past the meadow's grass, so the pasture runs to the horizon
	// rather than ending at the grass's edge.
	scene.createMesh({
		mesh: ctx.geometry.plane({ width: 460, height: 460 }),
		material: ctx.materials.standard({ color: [0.3, 0.34, 0.16], roughness: 0.95 }),
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
		receiveShadows: true,
	});

	const camera = scene.createPerspectiveCamera({ fov: 45, near: 0.1, far: 600 });
	// The start view, overridable from the address so a framing can be dialled in beside the page:
	// ?cam=x,y,z sets the camera and ?look=x,y,z the point it aims at. The sketch runs in a worker,
	// where the page's own address is what `location` holds, so the page's query is read first.
	const query = ((): ((name: string) => string | null) => {
		const page = typeof location === 'undefined' ? undefined : new URLSearchParams(location.search);
		const own = new URL(import.meta.url).searchParams;
		return (name) => page?.get(name) ?? own.get(name);
	})();
	const numbers = (name: string): [number, number, number] | undefined => {
		const said = query(name);
		if (!said) return undefined;
		const parts = said.split(',').map(Number);
		return parts.length === 3 && parts.every(Number.isFinite)
			? [parts[0] as number, parts[1] as number, parts[2] as number]
			: undefined;
	};
	const start = numbers('cam') ?? [0, 50, 140];
	const aim = numbers('look') ?? [0, 0, 0];
	camera.setPosition(...start);
	scene.setActiveCamera(camera);
	// The wheel steps a little further than the default, since a close approach makes each notch a
	// small change in metres, and the shadows reach only as far as the meadow the camera can see.
	const view = interact(ctx, camera, { target: aim, groundY: 1.7, zoomSpeed: 1.5 });

	// The meadow's grass, grown by the add-on over the field that the camera frames, so the ground
	// reads as pasture rather than as one flat colour. The cover takes the meadow grass's own blade,
	// its keel and its colour, so a plant of that species stands in it without a seam.
	const meadow = await loadSpecies('meadow-grass');
	createGrass(ctx, {
		height: () => 0,
		area: { x: 0, z: 0, size: 220 },
		count: 140_000,
		seed: 11,
		blades: 14,
		...grassCover(meadow.record),
	});

	// The season: every record declares what its own does, so the same meadow grows bare in winter,
	// turns in autumn and flowers in blossom. Summer is the record's default. Two sliders shape the
	// build: the sparseness moves a species' limbs, leaves and coarseness together toward the least
	// it still reads as itself, and the polygon maximum caps the triangles one plant draws. Both
	// open at the left, so the meadow draws each species' own form until a hand drags right.
	const controls: MeadowControls = { season: 'summer', sparse: 0, maxTriangles: undefined };

	let seed = 11;
	/** The plants the meadow stands, so a double-click can find the one under the pointer. */
	let plants: readonly MeadowPlant[] = [];
	const growMeadow = createMeadow(ctx, page, {
		controls: () => controls,
		onPlants: (list) => {
			plants = list;
		},
		...(HELD_SPECIES.length > 0 && { species: HELD_SPECIES }),
	});
	const showHud = () => postHud(page, controls);

	/**
	 * A slider posts on every step of a drag, so the meadow waits for the hand to settle before it
	 * grows again: the last change starts a short timer, and only its expiry regrows.
	 */
	let settling = 0;
	const settleThenGrow = (): void => {
		clearTimeout(settling);
		settling = setTimeout(() => void growMeadow(seed), 350) as unknown as number;
	};
	page.onMessage((name, value) => {
		if (name === 'season') {
			if (value !== 'summer' && value !== 'autumn' && value !== 'winter' && value !== 'blossom')
				return;
			controls.season = value;
			showHud();
			// The season grows the meadow at once, so a slider change that waits to settle would only
			// grow the same meadow a second time.
			clearTimeout(settling);
			void growMeadow(seed);
			return;
		}
		const next = Number(value);
		if (!Number.isFinite(next)) return;
		// A value that the slider already holds changes nothing, so the meadow stays as it is.
		if (name === 'sparse') {
			if (next < 0 || next > 1 || next === controls.sparse) return;
			controls.sparse = next;
		} else if (name === 'polygons') {
			if (!isPolygonStep(next)) return;
			const maxTriangles = polygonMaximum(next);
			if (maxTriangles === controls.maxTriangles) return;
			controls.maxTriangles = maxTriangles;
		} else return;
		showHud();
		settleThenGrow();
	});

	// The meadow grows while the field draws, so a live start shows its first frame without waiting
	// for every species and the plants appear when the last one finishes. A held picture waits for
	// the whole meadow, so its frame shows the finished scene.
	if (ctx.engine.held) await growMeadow(seed);
	else
		growMeadow(seed).catch((error: unknown) => {
			console.error(error);
		});

	let regrowing = false;
	let announced = false;
	/** A flight of the camera to a plant: where it starts, where it ends and when it began. */
	let flight:
		| {
				from: [number, number, number];
				fromAim: [number, number, number];
				to: [number, number, number];
				toAim: [number, number, number];
				began: number;
				length: number;
		  }
		| undefined;
	let lastPress = Number.NEGATIVE_INFINITY;
	let lastX = 0;
	let lastY = 0;
	let wasDown = false;
	/** Ease in and out: slow at both ends, quickest halfway. */
	const ease = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
	const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
	/** Brings the camera to the plant that stands nearest the picture point under the pointer. */
	const focusAt = (x: number, y: number): void => {
		let best: MeadowPlant | undefined;
		let nearest = 60 * 60;
		const at: [number, number, number] = [0, 0, 0];
		for (const plant of plants) {
			camera.worldToScreen([plant.x, plant.height * 0.5, plant.z], at);
			const d = (at[0] - x) ** 2 + (at[1] - y) ** 2;
			if (d < nearest) {
				nearest = d;
				best = plant;
			}
		}
		if (!best) return;
		const spotted = best;
		const height = Math.max(0.6, spotted.height);
		// Close enough to read the leaves, and back far enough to hold the whole plant in the frame.
		const away = height * 1.7 + 3;
		const target: [number, number, number] = [spotted.x, height * 0.55, spotted.z];
		const to: [number, number, number] = [
			spotted.x + away * 0.4,
			height * 0.55 + away * 0.5,
			spotted.z + away * 0.75,
		];
		const from: [number, number, number] = [0, 0, 0];
		camera.getPosition(from);
		const fromAim = view.controls.target as unknown as [number, number, number];
		flight = {
			from,
			fromAim: [fromAim[0], fromAim[1], fromAim[2]],
			to,
			toAim: target,
			began: performance.now(),
			length: Math.min(3000, 900 + away * 12),
		};
	};
	return {
		onUpdate(dt) {
			view.update(dt);
			// Two presses within a third of a second, near enough to be the same spot, focus a plant.
			const pointer = input.pointer;
			const down = pointer.buttons !== 0;
			const now = performance.now();
			if (down && !wasDown) {
				const near = Math.hypot(pointer.x - lastX, pointer.y - lastY) < 8;
				if (now - lastPress < 350 && near) {
					void focusAt(pointer.x, pointer.y);
					lastPress = Number.NEGATIVE_INFINITY;
				} else lastPress = now;
				lastX = pointer.x;
				lastY = pointer.y;
			}
			wasDown = down;
			if (flight) {
				const t = Math.min(1, (now - flight.began) / flight.length);
				const k = ease(t);
				camera.setPosition(
					mix(flight.from[0], flight.to[0], k),
					mix(flight.from[1], flight.to[1], k),
					mix(flight.from[2], flight.to[2], k),
				);
				const aim = view.controls.target as unknown as [number, number, number];
				aim[0] = mix(flight.fromAim[0], flight.toAim[0], k);
				aim[1] = mix(flight.fromAim[1], flight.toAim[1], k);
				aim[2] = mix(flight.fromAim[2], flight.toAim[2], k);
				if (t >= 1) flight = undefined;
			}
			if (!announced) {
				announced = true;
				showHud();
			}
			if (input.wasPressed('KeyR') && !regrowing) {
				regrowing = true;
				seed++;
				void growMeadow(seed).finally(() => {
					regrowing = false;
				});
			}
		},
	};
});
