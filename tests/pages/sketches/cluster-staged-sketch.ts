// A heightfield drawn from a tree of cluster patches whose first band comes with the model file
// and whose other bands download after it (packages/cli/src/assets/cluster-fixture.ts). The camera
// stands close to the ground, where the view draws patches of every band, so the picture sharpens
// as the bands arrive. `?max=` passes the loader's level limit, which counts a band as it counts a
// level, so a limit of 1 draws the band that the file holds and downloads none. `?far` stands the
// camera beyond every switch distance, where only the file's own band draws, so the loader gives up
// the bands that would never draw. `?near` starts there and comes close once the loader gave them
// up: the bands that the camera then needs must arrive. The page keeps the quality settings still,
// so the picture changes only when a band arrives.
import { defineSketch } from '@null3d/engine';
import { AMBIENT, SUN } from '../../../bench/scenes/spec';

const params = new URL(import.meta.url).searchParams;
/** The most levels that the load takes, or 0 for every level. */
const MAX = Number(params.get('max') ?? 0);
/** True when the camera starts far away, where only the file's own band draws. */
const FAR = params.has('far') || params.has('near');
/** True when the camera starts far and comes close once the loader gave the bands up. */
const NEAR = params.has('near');

/** The camera close to the ground: the near edge of the cluster pictures. */
const CLOSE = { near: 0.5, far: 300, position: [0, 7, 26], target: [0, 1, -20.8] } as const;
/**
 * The camera beyond every switch distance of the tree, where its root patch draws alone. The root's
 * error switches it at about 85 km, so the camera stands past that. The ground is smaller than a
 * pixel there, which the far test expects: it compares two empty pictures, and one band file.
 */
const AWAY = {
	near: 1,
	far: 2_000_000,
	position: [0, 100_000, 173_205],
	target: [0, 0, 0],
} as const;

/**
 * The frames that the near page draws before it moves the camera close: twice the loader's warm-up,
 * so the loader has given the bands up even if some of these frames did not draw the model.
 */
const NEAR_AFTER_FRAMES = 240;

export default defineSketch(async ({ scene, assets, page, post, quality }) => {
	post.set({ toneMapping: 'aces' });
	// The page compares two of its own frames, so the picture must not move between them.
	await quality.set({ governor: false });
	scene.setBackground('#8fa4b8');
	scene.createDirectionalLight(SUN);
	scene.createAmbientLight(AMBIENT);
	await assets
		.loadGltf('assets/models/cluster-staged-terrain.glb', MAX > 0 ? { maxLevels: MAX } : {})
		.then((prefab) => scene.instantiate(prefab));
	const place = FAR ? AWAY : CLOSE;
	const camera = scene.createPerspectiveCamera({
		fov: 50,
		near: place.near,
		far: place.far,
		position: [...place.position],
		target: [...place.target],
	});
	scene.setActiveCamera(camera);
	let since = 0;
	let moved = false;
	page.post('loaded', { levels: 0 });
	return {
		onUpdate() {
			if (!NEAR || moved) return;
			// The first band arrives at once and the loader then holds the ones after it. Past the
			// warm-up it gives them up; the camera comes close well after that, and its pick must
			// bring the bands back.
			since += 1;
			if (since < NEAR_AFTER_FRAMES) return;
			moved = true;
			camera.setNearFar(CLOSE.near, CLOSE.far);
			camera.setPosition(...CLOSE.position);
			camera.lookAt(...CLOSE.target);
			page.post('near', { levels: 0 });
		},
	};
});
