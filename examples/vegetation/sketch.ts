// The vegetation add-on's meadow: every species the add-on registers, grown from its record and
// planted across a field, so one page shows what the catalogue holds. Each species takes a patch of
// its own, sized to the plant, and the camera orbits the whole meadow. As records land in the
// registry the meadow fills with them; the label names how many are in the catalogue today.
//
// The plants are the game's own assets, grown through the package's public functions. Drag to turn
// round the meadow and use the wheel to step in. Press R to grow it all again from another seed.
import { defineSketch, timeOfDay } from '@null3d/engine';
import { createGrass } from '@null3d/vegetation';
import { interact } from '../lib/interact';
import { type MeadowControls, postHud } from './hud';
import { createMeadow } from './meadow';

export default defineSketch(async (ctx) => {
	const { scene, assets, post, input, page } = ctx;
	const day = timeOfDay('afternoon', { heading: 0.6 });
	scene.setBackground({ sky: day.sky }, { intensity: day.skyIntensity });
	scene.setEnvironment(await assets.skyEnvironment(), { intensity: day.skyIntensity * 0.8 });
	scene.setFog({ ...day.fog, density: 0.0004 });
	post.set({ exposure: day.exposure });
	scene.createDirectionalLight({ ...day.light, castShadows: true, shadow: { distance: 60 } });
	scene.createAmbientLight(day.ambient);

	// The meadow's grass, grown by the add-on over the same field, so the ground reads as pasture.
	createGrass(ctx, {
		height: () => 0,
		area: { x: 0, z: 0, size: 200 },
		count: 60_000,
		seed: 11,
		blades: 12,
		color: '#59732f',
	});

	// The ground: a wide field, so a row of several species reads as a meadow rather than a plinth.
	scene.createMesh({
		mesh: ctx.geometry.plane({ width: 600, height: 600 }),
		material: ctx.materials.standard({ color: [0.3, 0.34, 0.16], roughness: 0.95 }),
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
		receiveShadows: true,
	});

	const camera = scene.createPerspectiveCamera({ fov: 45, near: 0.1, far: 600 });
	camera.setPosition(0, 20, 66);
	scene.setActiveCamera(camera);
	// The wheel steps a little further than the default, since a close approach makes each notch a
	// small change in metres, and the shadows reach only as far as the meadow the camera can see.
	const view = interact(ctx, camera, { target: [0, 11, 0], groundY: 1.7, zoomSpeed: 1.5 });

	// The season: every record declares what its own does, so the same meadow grows bare in winter,
	// turns in autumn and flowers in blossom. Summer is the record's default. Two shares, each against
	// the record's own, with the slider's middle the record's own: the track runs 0 at the sparsest,
	// 0.5 at the record's, 1 at the fullest, and the share the add-on takes runs from 0.4 through 1
	// to 2. Leaves size what hangs on the wood; limbs decide how much wood there is, which every
	// growth model answers with its own count of branches, fronds or tillers.
	const controls: MeadowControls = { season: 'summer', leaves: 0.5, limbs: 0.5, coarseness: 0 };
	const shareOf = (value: number) =>
		value <= 0.5 ? 0.4 + (value / 0.5) * 0.6 : 1 + ((value - 0.5) / 0.5) * 1;

	let seed = 11;
	const growMeadow = createMeadow(ctx, page, { controls: () => controls, shareOf });
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
			void growMeadow(seed);
			return;
		}
		const next = Number(value);
		if (!Number.isFinite(next)) return;
		if (name === 'leaves') controls.leaves = next;
		else if (name === 'limbs') controls.limbs = next;
		// The explainer button shares the group's name, so only a number turns the slider.
		else if (name === 'coarseness') controls.coarseness = next;
		else return;
		showHud();
		settleThenGrow();
	});

	await growMeadow(seed);

	let regrowing = false;
	let announced = false;
	return {
		onUpdate(dt) {
			view.update(dt);
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
