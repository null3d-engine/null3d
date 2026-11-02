// Splat garden: a captured glade of moss, stone and blossom, drawn as Gaussian splats. A hollow of
// moss holds weathered boulders, a fallen log, a stone lantern that glows and a blossoming tree,
// with ferns, petals and drifting spores. Every splat is a soft ellipsoid, so the scene is one cloud
// of nearly half a million of them rather than meshes, and it mixes with the few meshes the glade
// keeps: its lantern, the ground under its splats and the ring of mountains behind it.
//
// The cloud streams: it is cut into chunk files, and the add-on reads a small index first and then
// fetches only the chunks that the view's budget asks for. The budget follows the quality preset and
// the frame-budget governor, so a phone draws a prefix of each chunk at its own count. The scene
// shows no controls panel: the route plays by itself, and `c` hands the camera to the user. For held
// frames, the sketch's address takes the mood: `?mood=Morning&dslr`.
import { defineSketch } from '@null3d/engine';
import { createSplats, type Splats } from '@null3d/splats';
import { createMoods, isMood } from '../lib/stage';
import { createCloud, HEADING, HOUR } from './cloud';
import { createHud } from './hud';
import { createLandscape } from './landscape';
import { createLantern } from './lantern';
import { SHOTS } from './route';
import { streamCloud, waitForChunks } from './stream';

/** The camera's vertical field of view in degrees, and the DSLR lens's focal length in millimetres. */
const FOV = 45;
const DSLR_FOCAL_LENGTH = 55;

export { BOUNDS } from './hud';
// The camera route, which the shared route check reads with the scene's bounds and its ground.
export { SHOTS };

const params = new URL(import.meta.url).searchParams;

export default defineSketch(async (ctx) => {
	const { scene, assets, post, page, time, ui, quality } = ctx;
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
	// Every splat and mesh draws at its fullest level, so the glade's detail shows.
	void quality.set({ lodThreshold: 0 });
	const opening = SHOTS[0] as (typeof SHOTS)[number];
	const camera = scene.createPerspectiveCamera({
		fov: FOV,
		near: 0.05,
		far: 1200,
		position: [opening.position[0], opening.position[1], opening.position[2]],
		target: [opening.target[0], opening.target[1], opening.target[2]],
	});
	scene.setActiveCamera(camera);

	createLandscape(ctx, quality.preset);

	// The lantern is a mesh, so it keeps its edges at every preset, and its finial carries the label.
	// The splats fade where they meet it, which shows the add-on's mix with a solid surface.
	const finial = createLantern(ctx);
	ui.trackLabel(finial, 'scan', { offset: [0, 0.32, 0] });
	page.post('label', { id: 'scan', text: 'Moss garden scan' });

	// The stage holds the golden hour that the capture's own colors were taken in.
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
	await waitForChunks(splats);

	const hud = createHud(ctx, {
		camera,
		splats,
		total: cloud.count,
		focalLength: DSLR_FOCAL_LENGTH,
		dslr: params.has('dslr'),
	});

	return {
		onUpdate(dt) {
			const now = time.now;
			stage.update(dt);
			hud.update(dt);
			camera.getPosition(eye);
			splats.update(eye);
			hud.label(now);
		},
		onDestroy() {
			splats.destroy();
			stream.destroy();
		},
	};
});
