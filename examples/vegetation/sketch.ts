// The vegetation add-on's meadow: every species the add-on registers, grown from its record and
// planted across a field, so one page shows what the catalogue holds. Each species takes a patch of
// its own, sized to the plant, and the camera orbits the whole meadow. As records land in the
// registry the meadow fills with them; the label names how many are in the catalogue today.
//
// The plants are the game's own assets, grown through the package's public functions. Drag to turn
// round the meadow and use the wheel to step in. Press R to grow it all again from another seed.
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
import { interact } from '../lib/interact';
import { plantSign } from './signage';

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
	// turns in autumn and flowers in blossom. Summer is the record's default.
	let season: 'summer' | 'autumn' | 'winter' | 'blossom' = 'summer';
	// The foliage's density, against each record's own crown. The slider's middle is the record's own
	// so its track runs 0 at the sparsest, 0.5 at the record's, 1 at the fullest, and the share the
	// add-on takes runs from 0.4 through 1 to 2.
	let foliage = 0.5;
	const shareOf = (value: number) =>
		value <= 0.5 ? 0.4 + (value / 0.5) * 0.6 : 1 + ((value - 0.5) / 0.5) * 1;
	// The level of detail's coarseness: 0 draws the plant as grown, 1 the coarsest, where the
	// finest twigs are gone and the shoots that remain are larger.
	let detail = 0;
	let planted: { destroy(): void }[] = [];
	const postHud = () =>
		page.post('hud', {
			groups: [
				{
					name: 'season',
					title: 'Season',
					radio: true,
					buttons: (['blossom', 'summer', 'autumn', 'winter'] as const).map((id) => ({
						id,
						label: id[0]?.toUpperCase() + id.slice(1),
						tip: `Grow the meadow in ${id}.`,
						active: season === id,
					})),
				},
				{
					name: 'foliage',
					title: 'Foliage',
					radio: false,
					buttons: [],
					slider: {
						min: 0,
						max: 1,
						step: 0.05,
						value: foliage,
						live: false,
						marks: [
							{ at: 0, label: 'sparse' },
							{ at: 0.5, label: 'default' },
							{ at: 1, label: 'dense' },
						],
						tip: "Drag left to thin each crown toward its bare wood, or right to keep the shoots its own density drops. The middle is every record's own crown.",
					},
				},
				{
					name: 'detail',
					title: 'Detail',
					radio: false,
					buttons: [],
					slider: {
						min: 0,
						max: 1,
						step: 0.05,
						value: detail,
						live: false,
						marks: [
							{ at: 0, label: 'as grown' },
							{ at: 0.5, label: 'coarser' },
							{ at: 1, label: 'coarsest' },
						],
						tip: 'Coarseness answers how much of a plant must draw at a distance. Near the camera every plant draws whole; farther away the add-on may draw fewer of its finest twigs and fewer, larger shoots, which keeps the leaf area but costs the finest detail. 0 is each plant as it grows and 1 the coarsest it may become, and a game sets it from the plant\u2019s size on the screen.',
					},
				},
			],
			visible: true,
		});
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
			season = value;
			postHud();
			void growMeadow(seed);
			return;
		} else if (name === 'foliage') {
			const next = Number(value);
			if (!Number.isFinite(next)) return;
			foliage = next;
		} else if (name === 'detail') {
			const next = Number(value);
			// The explainer button shares the group's name, so only a number turns the slider.
			if (!Number.isFinite(next)) return;
			detail = next;
		} else return;
		postHud();
		settleThenGrow();
	});
	/** The note that shows while the meadow grows, counting the species it has finished. */
	const growing = (() => {
		let box: HTMLElement | undefined;
		let said: HTMLElement | undefined;
		return {
			begin(): void {
				if (box) return;
				box = document.createElement('div');
				box.style.cssText = [
					'position:fixed',
					'left:50%',
					'top:18px',
					'transform:translateX(-50%)',
					'padding:10px 16px',
					'border-radius:10px',
					'background:rgba(16,18,20,0.86)',
					'color:#e8eaec',
					'font:13px/1.4 system-ui,sans-serif',
					'letter-spacing:0.02em',
					'z-index:20',
					'pointer-events:none',
				].join(';');
				said = document.createElement('span');
				box.append(said);
				document.body.append(box);
			},
			set(done: number, total: number): void {
				if (said)
					said.textContent = `Growing the meadow, ${Math.round((done / Math.max(1, total)) * 100)}%`;
			},
			end(): void {
				box?.remove();
				box = undefined;
				said = undefined;
			},
		};
	})();

	let seed = 11;
	// The meadow's species and their placements are settled at the start, so every sign can stand on
	// the bare ground before the plants that it names have grown.
	const ids = speciesIds();
	const modules = await Promise.all(ids.map((id) => loadSpecies(id)));
	const across = Math.max(1, Math.ceil(Math.sqrt(ids.length)));
	const step = 34;
	/** Where a species stands in the meadow's grid, centred on the origin. */
	const placeOf = (index: number): readonly [number, number] => [
		((index % across) - (across - 1) / 2) * step,
		(Math.floor(index / across) - (ids.length / across - 1) / 2) * step,
	];
	for (const [index, module] of modules.entries()) {
		// The sign stands beside the plant's foot, clear of its trunk.
		const [x, z] = placeOf(index);
		plantSign(ctx, module.record.name, module.record.latin, [x + 13, z + 6]);
	}
	const growMeadow = async (at: number) => {
		for (const piece of planted) piece.destroy();
		planted = [];
		growing.begin();
		growing.set(0, ids.length);
		for (const [index, module] of modules.entries()) {
			// The meadow carries every species at once, and at close range every copy near the camera
			// draws its real shoots: the medium tier keeps each plant's shape while halving the nearest
			// level's triangles, which is what made a pan after a zoom crawl.
			const kit = await prepareSpecies(ctx, module, { detail: 'medium', placeholders: 'missing' });
			const materials = plantMaterials(ctx, kit, {});
			const variant = index % Math.max(1, kit.record.variants);
			const asset = await growPlant(kit, {
				seed,
				variant,
				near: true,
				season,
				coarseness: detail,
				foliage: shareOf(foliage),
			});
			const [x, z] = placeOf(index);
			planted.push(
				placePlants(
					ctx,
					kit,
					[asset],
					{
						count: 1,
						position: new Float32Array([x, 0, z]),
						turn: new Float32Array([index * 0.4]),
						scale: new Float32Array([1]),
						variant: new Uint8Array([0]),
					},
					{ materials, view: { height: 1080, fov: 45 }, castShadows: true },
				),
			);
			growing.set(index + 1, ids.length);
		}
		growing.end();
		void at;
	};

	let regrowing = false;
	// The meadow grows after the page's first frame, so the start ends with the grass standing and
	// the plants' own progress note follows it, rather than counting inside the start.
	let started = false;
	return {
		onUpdate(dt) {
			view.update(dt);
			if (!started) {
				started = true;
				postHud();
				void growMeadow(seed);
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
