// The vegetation add-on's meadow: every species the add-on registers, grown from its record and
// planted across a field, so one page shows what the catalogue holds. Each species takes a patch of
// its own, sized to the plant, and the camera orbits the whole meadow. As records land in the
// registry the meadow fills with them; the label names how many are in the catalogue today.
//
// The plants are the game's own assets, grown through the package's public functions. Drag to turn
// round the meadow and use the wheel to step in. Press R to grow it all again from another seed.
import { defineSketch, timeOfDay } from '@null3d/engine';
import { createGrass, grassCover, loadSpecies } from '@null3d/vegetation';
import { interact } from '../lib/interact';
import { type Flight, focusAt, stepFlight } from './focus';
import { type MeadowControls, postHud } from './hud';
import { createMeadow, type MeadowPlant } from './meadow';
import { wirePanel } from './sliders';
import { heldSpecies, startView } from './start';

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
	const { cam, look } = startView();
	camera.setPosition(...cam);
	scene.setActiveCamera(camera);
	// The wheel steps a little further than the default, since a close approach makes each notch a
	// small change in metres, and the shadows reach only as far as the meadow the camera can see.
	const view = interact(ctx, camera, { target: look, groundY: 1.7, zoomSpeed: 1.5 });

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
	const held = heldSpecies();
	const growMeadow = createMeadow(ctx, page, {
		controls: () => controls,
		onPlants: (list) => {
			plants = list;
		},
		...(held.length > 0 && { species: held }),
	});
	const showHud = () => postHud(page, controls);
	wirePanel(page, controls, () => void growMeadow(seed), showHud);

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
	/** The flight the camera is making toward a plant, if any. */
	let flight: Flight | undefined;
	let lastPress = Number.NEGATIVE_INFINITY;
	let lastX = 0;
	let lastY = 0;
	let wasDown = false;
	const aim = view.controls.target as unknown as [number, number, number];
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
					flight = focusAt(camera, plants, aim, pointer.x, pointer.y) ?? flight;
					lastPress = Number.NEGATIVE_INFINITY;
				} else lastPress = now;
				lastX = pointer.x;
				lastY = pointer.y;
			}
			wasDown = down;
			if (flight) flight = stepFlight(flight, camera, aim, now);
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
