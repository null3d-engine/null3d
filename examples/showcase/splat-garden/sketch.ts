// Splat garden: a captured glade of moss, stone and blossom, drawn as Gaussian splats. A hollow of
// moss holds weathered boulders, a fallen log, a stone lantern that glows and a blossoming tree,
// with ferns, petals and drifting spores. Every splat is a soft ellipsoid, so the scene is one cloud
// of nearly half a million of them rather than meshes, and it mixes with the few meshes the glade
// keeps: its lantern, the ground under its splats and the ring of mountains behind it.
//
// The cloud streams: it is cut into chunk files, and the add-on reads a small index first and then
// fetches only the chunks that the view's budget asks for. The budget follows the quality preset and
// the frame-budget governor, so a phone draws a prefix of each chunk at its own count. The controls
// HUD offers the shared switches, a Full detail button that drops the cloud to a quarter of its
// budget, and the quality presets. The camera runs a route made for this scene; `c` hands it to the
// user. For held frames, the sketch's address takes the mood: `?mood=Morning&dslr`.
import { defineSketch, type QualityPreset } from '@null3d/engine';
import { createSplats, type Splats } from '@null3d/splats';
import { type CameraBounds, createCinematic } from '../../lib/cinematic';
import { mountainRing } from '../../lib/mountains';
import { terrain } from '../../lib/procedural';
import { createShowcaseEffects } from '../../lib/showcase-effects';
import { createMoods, isMood } from '../../lib/stage';
import { createCloud, gardenHeight, groundColor, HEADING, HOUR, LAND } from './cloud';
import { createLantern } from './lantern';
import { SHOTS, WIDE_LOOK } from './route';
import { streamCloud } from './stream';

/** The camera's vertical field of view in degrees, and the DSLR lens's focal length in millimetres. */
const FOV = 45;
const DSLR_FOCAL_LENGTH = 55;

/** The ground's detail around the glade, by preset: the ring's bearings and rows. */
const DETAIL: Record<QualityPreset, readonly [number, number]> = {
	low: [160, 26],
	medium: [200, 32],
	high: [240, 38],
	ultra: [280, 44],
};

/** Where the Manual camera may go: around the glade, above the moss and below the mountains. */
export const BOUNDS: Omit<CameraBounds, 'ground'> = {
	center: [0, 0],
	focus: 14,
	focusHeight: [0.5, 5],
	distance: 24,
};

// The camera route, which the shared route check reads with the scene's bounds and its ground.
export { SHOTS };

const params = new URL(import.meta.url).searchParams;

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, post, page, time, ui, quality } = ctx;
	page.post('loading', 'Growing the splat garden');
	const cloud = createCloud();
	const stream = await streamCloud(cloud, (written, total, share) =>
		page.post('loading', {
			text: `Writing chunk ${written} of ${total}`,
			value: share,
		}),
	);
	page.post('loading', 'Lifting the sky');
	const [sky, room] = await Promise.all([
		assets.skyEnvironment(),
		assets.builtinEnvironment('room'),
	]);
	const sun = scene.createDirectionalLight({ castShadows: false });
	post.set({ ao: { radius: 0.8 } });
	const opening = SHOTS[0] as (typeof SHOTS)[number];
	const camera = scene.createPerspectiveCamera({
		fov: FOV,
		near: 0.05,
		far: 1200,
		position: [opening.position[0], opening.position[1], opening.position[2]],
		target: [opening.target[0], opening.target[1], opening.target[2]],
	});
	scene.setActiveCamera(camera);
	const target: [number, number, number] = [WIDE_LOOK[0], WIDE_LOOK[1], WIDE_LOOK[2]];

	// The ring of mountains around the glade, forested and hazy, so no view reaches the background.
	const [segments, rows] = DETAIL[quality.preset];
	const ring = mountainRing({
		half: LAND,
		land: gardenHeight,
		crest: [260, 340],
		heights: [44, 72],
		segments,
		rows,
		seed: 41,
		palette: {
			forest: [0.06, 0.12, 0.045],
			rock: [0.19, 0.18, 0.15],
			snow: [0.7, 0.74, 0.8],
			treeLine: 26,
			snowLine: 64,
			frost: 0.02,
		},
	});
	scene.createMesh({
		mesh: geometry.fromArrays(ring.arrays),
		material: materials.standard({ vertexColors: true, roughness: 1 }),
		castShadows: false,
		receiveShadows: false,
	});
	// The moss the cloud lies on: a mesh under the ground splats, so a coarser preset, which draws
	// only prefixes of the cloud's chunks, shows moss in the gaps rather than the horizon.
	const ground = terrain({
		size: LAND * 2,
		quads: 96,
		tile: 9,
		middle: 0.45,
		height: (x, z) => gardenHeight(x, z) - 0.06,
		color: (x, z, _y, _slope, out) => groundColor(x, z, out),
	});
	scene.createMesh({
		mesh: geometry.fromArrays(ground),
		material: materials.standard({ vertexColors: true, roughness: 1 }),
		castShadows: false,
		receiveShadows: false,
	});

	// The lantern is a mesh, so it keeps its edges at every preset, and its finial carries the label.
	// The splats fade where they meet it, which shows the add-on's mix with a solid surface.
	const finial = createLantern(ctx);
	ui.trackLabel(finial, 'scan', { offset: [0, 0.32, 0] });
	page.post('label', { id: 'scan', text: 'Moss garden scan' });

	// The stage holds the golden hour that the capture's own colors were taken in. Auto moves the
	// sun and the moon across the sky, and the HUD's effects switch the rest.
	const stage = createMoods(ctx, sun, sky, room, {
		heading: HEADING,
		fogDensity: 0.0026,
		cloudCoverage: 0.24,
		volumetric: { intensity: 0.9, anisotropy: 0.5, distance: 80 },
		exposureScale: 1.35,
		environmentScale: 1.1,
		backdrop: [0.03, 0.035, 0.05],
	});
	const mood = params.get('mood');
	if (isMood(mood)) stage.set(mood);
	else stage.setHour(HOUR);

	// The cloud, streamed as chunk files. The batch holds the preset's budget of rows, which the
	// governor then lowers while a frame runs long.
	const splats: Splats = await createSplats(ctx, { url: stream.url, softness: 0.3 });
	const eye: [number, number, number] = [0, 0, 0];
	camera.getPosition(eye);
	splats.update(eye);
	await splats.ready;
	await splats.settle();
	// The chunks that the opening view wants arrive behind the frames; wait until no more arrive,
	// so the first frame and a held picture show the whole view.
	let quiet = 0;
	let arrived = -1;
	for (let k = 0; k < 16 && quiet < 3; k++) {
		quiet = splats.loaded === arrived ? quiet + 1 : 0;
		arrived = splats.loaded;
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	await splats.settle();
	/** True while the cloud draws the preset's whole budget. */
	let fullDetail = true;
	/** The budget that the add-on reported at the last change, so a preset change resets the cap. */
	let lastBudget = splats.feature.settings.drawn as number;
	/** Caps the draw at the preset's budget, or at a quarter of it. */
	const applyBudget = (): void => {
		const budget = Math.floor(splats.feature.settings.drawn as number);
		lastBudget = budget;
		splats.setBudget(fullDetail ? budget : Math.max(1, Math.floor(budget / 4)));
	};
	page.onMessage((name) => {
		if (name !== 'splats') return;
		fullDetail = !fullDetail;
		applyBudget();
		film.refresh();
	});

	const controls = createShowcaseEffects(ctx, {
		camera,
		sun,
		stage,
		start: {
			sky: true,
			fog: true,
			environment: true,
			bloom: false,
			dof: false,
			exposure: false,
			vignette: false,
		},
		supported: {
			atmosphere: ['sky', 'fog'],
			lighting: ['environment'],
			post: ['bloom', 'dof', 'exposure', 'vignette'],
		},
		extra: () => [
			{
				name: 'splats',
				title: 'Splats',
				radio: false,
				buttons: [
					{
						id: 'detail',
						label: 'Full detail',
						tip: 'Draw every splat that the preset allows. Off draws a quarter, so the levels of detail show.',
						active: fullDetail,
					},
				],
			},
		],
		apply(id, on) {
			if (id === 'bloom')
				post.set({ bloom: on ? { blend: 'add', intensity: 0.7, threshold: 1.2 } : false });
		},
		mood: (picked) => stage.set(picked),
		hour: (hours) => stage.setHour(hours),
		film: () => film,
		fov: FOV,
		focalLength: DSLR_FOCAL_LENGTH,
		focus: target,
		dslr: params.has('dslr'),
	});

	const film = createCinematic(ctx, camera, {
		shots: SHOTS,
		target,
		groups: controls.groups,
		bounds: { ...BOUNDS, ground: gardenHeight },
	});

	// The cloud's figures, which the signpost's label names.
	const total = cloud.count;
	let posted = 0;
	let lastDrawn = -1;
	const label = () => {
		const drawn = splats.drawn;
		if (drawn === lastDrawn) return;
		lastDrawn = drawn;
		page.post('label', {
			id: 'scan',
			text: `${total.toLocaleString('en-US')} splats · ${drawn.toLocaleString('en-US')} drawn`,
		});
	};
	label();

	return {
		onUpdate(dt) {
			const now = time.now;
			stage.update(dt);
			controls.update(now);
			film.update(dt);
			const lens = controls.lens();
			if (lens) post.set(lens);
			// A preset change moves the budget, which the cap follows.
			if ((splats.feature.settings.drawn as number) !== lastBudget) applyBudget();
			camera.getPosition(eye);
			splats.update(eye);
			if (now - posted > 0.3) {
				posted = now;
				label();
			}
		},
		onDestroy() {
			splats.destroy();
			stream.destroy();
		},
	};
});
