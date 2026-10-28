// Weighted transparency: a pavilion of stained glass at golden hour, whose eight panes cross each
// other in two squares, around a brazier whose smoke rises through them. Sorting by object cannot
// order panes that cross, nor puffs of smoke inside each other, so with normal blending they pop as
// the camera turns. With the weighted blending the panes and the 600 puffs blend in any order, as
// three.js's OITPassNode blends them. S swaps the whole scene between the weighted blending and the
// sorted twins, so the camera and the pointer never change the mode. The page's controls HUD names
// the key and the blend on show, its buttons set the blend too, and a label over the brazier names
// it in the scene. The puffs' soft dot is a texture made from data. The sky, the paving, the plinth
// and the brazier live in pavilion.ts.
import { defineSketch, math } from '@null3d/engine';
import { type HudOption, radioGroup } from '../lib/controls';
import { interact } from '../lib/interact';
import { pavilion } from './pavilion';

const PUFFS = 600;
/** How long a puff rises, in seconds, and how high it climbs in that time. */
const LIFE = 7;
const RISE = 5.5;
/** The panes' jewel colors, in the order they stand around the pavilion. */
const GLASS = [
	'#d6303a',
	'#f0a020',
	'#2f9e44',
	'#1c7ed6',
	'#7048e8',
	'#e64980',
	'#12b886',
	'#f59f00',
] as const;
/** Texels along each side of the puffs' soft dot. */
const DOT = 32;
/** The two blends that the controls HUD offers: the weighted blending and the sorted twins. */
const BLENDS: readonly HudOption[] = [
	{
		id: 'Weighted',
		label: 'Weighted',
		tip: 'Blend the crossing panes and the smoke in any order.',
	},
	{
		id: 'Sorted',
		label: 'Sorted',
		tip: 'Sort the panes and the smoke by object, with normal blending.',
		key: 'S',
	},
];

export default defineSketch(async (ctx) => {
	const { scene, geometry, materials, textures, time, input, ui, page } = ctx;
	const { panes, flicker, bowl } = await pavilion(ctx);
	const camera = scene.createPerspectiveCamera({ fov: 45, far: 500, position: [5.5, 2.6, 7.5] });
	camera.lookAt(0, 1.8, 0);
	scene.setActiveCamera(camera);
	const bounds = [-6, 0, -6, 6, 0, 6] as const;
	const view = interact(ctx, camera, { target: [0, 1.8, 0], groundY: 0, bounds });

	// Each pane has a glass of the weighted blending and a twin of the normal blending, which the
	// transparent pass sorts. The glass glows faintly in its own color, as light through it would.
	const pane = geometry.plane({ width: 3.6, height: 2.6 });
	const glass = (color: string, blending: 'weighted' | 'normal') =>
		materials.standard({
			color,
			emissive: color,
			emissiveIntensity: 0.6,
			opacity: 0.5,
			roughness: 0.08,
			alphaMode: 'blend',
			blending,
			doubleSided: true,
		});
	const glasses = panes.map(({ x, z, turn }, i) => {
		const color = GLASS[i % GLASS.length] as string;
		const looks = { weighted: glass(color, 'weighted'), normal: glass(color, 'normal') };
		const mesh = scene.createMesh({ mesh: pane, material: looks.weighted, position: [x, 1.6, z] });
		mesh.setRotationEuler(0, turn, 0);
		return { mesh, looks };
	});

	// The smoke: soft puffs that rise from the brazier, swell, drift with the wind and fade, in a
	// weighted batch and a sorted twin.
	const dot = new Uint8Array(DOT * DOT * 4).fill(255);
	for (let i = 0; i < DOT * DOT; i++) {
		const r = Math.hypot((i % DOT) + 0.5 - DOT / 2, Math.floor(i / DOT) + 0.5 - DOT / 2);
		dot[i * 4 + 3] = 255 * Math.max(0, 1 - (r / (DOT / 2)) ** 2) ** 1.5;
	}
	const map = textures.fromData({ width: DOT, height: DOT, data: dot });
	const smoke = { count: PUFFS, map, dynamic: true, depthWrite: false } as const;
	const weighted = await scene.createSprites({ ...smoke, blending: 'weighted' });
	const sorted = await scene.createSprites({ ...smoke, blending: 'normal' });
	sorted.setActiveCount(0);
	// Each puff's start in its life, its turn and its distance from the column's middle.
	const seeds = new Float32Array(PUFFS * 3).map(() => math.randFloat(0, 1));

	let showsSorted = false;
	let announced = false;
	// A label over the brazier names the blending on show, so the picture never has to be guessed at.
	ui.trackLabel(bowl, 'blending', { offset: [0, 1.8, 0] });
	const postHud = () =>
		page.post('hud', {
			groups: [radioGroup('blend', 'Blending', BLENDS, showsSorted ? 'Sorted' : 'Weighted')],
			visible: true,
		});
	const setBlend = (next: boolean) => {
		showsSorted = next;
		for (const { mesh, looks } of glasses)
			mesh.setMaterial(showsSorted ? looks.normal : looks.weighted);
		weighted.setActiveCount(showsSorted ? 0 : PUFFS);
		sorted.setActiveCount(showsSorted ? PUFFS : 0);
		page.post('label', {
			id: 'blending',
			text: showsSorted ? 'Sorted blending' : 'Weighted blending',
		});
		postHud();
	};
	// A pick on the controls HUD sets the same blend that the key does.
	page.onMessage((name, value) => {
		if (name === 'blend') setBlend(value === 'Sorted');
	});
	setBlend(false);
	return {
		onUpdate(dt) {
			view.update(dt);
			// The page binds its message listener after the sketch's setup, so send the model again on
			// the first frame, as a showcase scene does.
			if (!announced) {
				announced = true;
				postHud();
			}
			// The key swaps the two blends, so the comparison is the same scene from the same view.
			if (input.wasPressed('KeyS')) setBlend(!showsSorted);
			flicker(time.now);
			const puffs = showsSorted ? sorted : weighted;
			const { positions, sizes, colors, rotations } = puffs;
			for (let i = 0; i < PUFFS; i++) {
				const start = seeds[i * 3] as number;
				const turn = (seeds[i * 3 + 1] as number) * 6.28;
				const out = seeds[i * 3 + 2] as number;
				const age = (time.now / LIFE + start) % 1;
				const swirl = turn + age * 4;
				const spread = (0.15 + age * 1.6) * out;
				positions[i * 3] = Math.cos(swirl) * spread + age * age * 2.2;
				positions[i * 3 + 1] = 1.55 + age * RISE;
				positions[i * 3 + 2] = Math.sin(swirl) * spread - age * 0.8;
				sizes[i * 2] = sizes[i * 2 + 1] = 0.5 + age * 2.4;
				rotations[i] = turn + age * (out - 0.5) * 2;
				// Lit warm by the fire near the bowl, cooling to gray as it climbs.
				const warm = Math.max(0, 1 - age * 3);
				colors[i * 4] = 0.34 + 0.4 * warm;
				colors[i * 4 + 1] = 0.32 + 0.15 * warm;
				colors[i * 4 + 2] = 0.32;
				colors[i * 4 + 3] = 0.3 * Math.min(1, age * 8) * (1 - age) ** 1.5;
			}
		},
	};
});
