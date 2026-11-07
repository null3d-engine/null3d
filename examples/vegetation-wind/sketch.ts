// Vegetation in wind: the add-on's plants under the wind add-on's field, close enough to see the
// crowns move. Every species the registry holds is planted in a clump, the wind's direction sweeps
// slowly, and its strength rises and falls, so the leaves lift and settle as they do in a real
// breeze. Press W to hold the wind still for comparison, and R to grow the clump again.
import { defineSketch, timeOfDay } from '@null3d/engine';
import {
	createGrass,
	growPlant,
	loadSpecies,
	placePlants,
	plantMaterials,
	prepareSpecies,
	speciesIds,
} from '@null3d/vegetation';
import { createWind } from '@null3d/wind';
import { interact } from '../lib/interact';

/** Metres a second at the field's top, at the strongest of the sweep. */
const GUST = 7;

export default defineSketch(async (ctx) => {
	const { scene, assets, post, input, time, page } = ctx;
	const day = timeOfDay('afternoon', { heading: 2.1 });
	scene.setBackground({ sky: day.sky }, { intensity: day.skyIntensity });
	scene.setEnvironment(await assets.skyEnvironment(), { intensity: day.skyIntensity * 0.8 });
	scene.setFog({ ...day.fog, density: 0.0005 });
	post.set({ exposure: day.exposure });
	scene.createDirectionalLight({ ...day.light, castShadows: true, shadow: { distance: 90 } });
	scene.createAmbientLight(day.ambient);

	scene.createMesh({
		mesh: ctx.geometry.plane({ width: 400, height: 400 }),
		material: ctx.materials.standard({ color: [0.3, 0.34, 0.16], roughness: 0.95 }),
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
		receiveShadows: true,
	});

	const camera = scene.createPerspectiveCamera({ fov: 50, near: 0.1, far: 400 });
	camera.setPosition(0, 12, 34);
	scene.setActiveCamera(camera);
	// The wind: one field for the whole page, read at each plant's root.
	const wind = createWind(ctx, { camera, box: 160 });
	// The meadow's grass, which bends in the same air as the plants.
	const grass = await createGrass(ctx, {
		height: () => 0,
		area: { x: 0, z: 0, size: 220 },
		count: 30_000,
		seed: 11,
		blades: 12,
		color: '#59732f',
		wind: wind.field,
	});
	// The wind's own state: its strength in metres a second, its bearing in degrees, and whether it
	// is held still. The controls post these, and the H key holds it too.
	let power = GUST;
	let bearing = 35;
	let still = false;
	const postHud = () =>
		page.post('hud', {
			groups: [
				{
					name: 'wind',
					title: 'Wind',
					radio: false,
					buttons: [
						{
							id: 'still',
							label: 'Hold',
							tip: 'Hold the air still, or let it move again.',
							active: still,
						},
					],
					slider: {
						min: 0,
						max: 12,
						step: 0.1,
						value: power,
						live: false,
						marks: [
							{ at: 0, label: 'still' },
							{ at: 6, label: 'breeze' },
							{ at: 12, label: 'gale' },
						],
						tip: "Drag the slider to set the wind's strength, from still air to a gale.",
					},
				},
				{
					name: 'bearing',
					title: 'Direction',
					radio: false,
					buttons: [],
					slider: {
						min: 0,
						max: 360,
						step: 1,
						value: bearing,
						live: false,
						marks: [
							{ at: 0, label: 'N' },
							{ at: 90, label: 'E' },
							{ at: 180, label: 'S' },
							{ at: 270, label: 'W' },
						],
						tip: 'Drag the slider to turn the wind round the meadow.',
					},
				},
			],
			visible: true,
		});
	page.onMessage((name, value) => {
		if (name === 'wind') {
			const strength = Number(value);
			if (Number.isFinite(strength)) power = strength;
			else still = value === 'still' ? !still : still;
			postHud();
		} else if (name === 'bearing') {
			const degrees = Number(value);
			if (Number.isFinite(degrees)) bearing = degrees;
			postHud();
		}
	});
	const view = interact(ctx, camera, { target: [0, 6, 0], groundY: 1.7 });

	let planted: { destroy(): void }[] = [];
	const seed = 11;
	const plant = async () => {
		for (const piece of planted) piece.destroy();
		planted = [];
		const ids = speciesIds();
		const across = Math.max(1, Math.ceil(Math.sqrt(ids.length)));
		let index = 0;
		for (const id of ids) {
			const module = await loadSpecies(id);
			const kit = await prepareSpecies(ctx, module, { detail: 'high', placeholders: 'missing' });
			const materials = plantMaterials(ctx, kit, { wind: wind.field });
			const variant = index % Math.max(1, kit.record.variants);
			const asset = await growPlant(kit, { seed, variant, near: true });
			const x = ((index % across) - (across - 1) / 2) * 20;
			const z = (Math.floor(index / across) - (ids.length / across - 1) / 2) * 20;
			planted.push(
				placePlants(
					ctx,
					kit,
					[asset],
					{
						count: 1,
						position: new Float32Array([x, 0, z]),
						turn: new Float32Array([index * 0.6]),
						scale: new Float32Array([1]),
						variant: new Uint8Array([0]),
					},
					{ materials, view: { height: 1080, fov: 50 }, castShadows: true },
				),
			);
			index++;
		}
	};
	await plant();

	let announced = false;
	return {
		onUpdate(dt) {
			view.update(dt);
			// The set bearing turns slowly and the set strength breathes, so the crowns lift and
			// settle rather than holding one lean. A held wind stands still.
			const sweep = (bearing * Math.PI) / 180 + time.now * 0.13;
			const strength = still ? 0 : power * (0.45 + 0.55 * (0.5 + 0.5 * Math.sin(time.now * 0.7)));
			wind.setBase(strength, sweep);
			wind.update();
			grass.setWindLayer(wind.field);
			if (!announced) {
				announced = true;
				postHud();
			}
		},
	};
});
