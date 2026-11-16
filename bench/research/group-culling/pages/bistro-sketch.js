// The Bistro street scene for the group-culling measurement: Amazon Lumberyard's Bistro exterior
// (CC BY 4.0), converted and optimized with null3D's asset tool, drawn once with every mesh as its
// own object, and scaled from centimeters to meters. The camera holds one of the fixed views of
// `bistro-views.js`. Switches: `view` names the view, `models` the optimized file, `shadows` turns
// the sun's shadows on.
import { defineSketch } from '/cdn/lib/index.js';
import { BISTRO_SCALE, BISTRO_VIEWS, FAR, FOV_DEGREES, NEAR } from './bistro-views.js';
import { SHADOWS, SKY, SUN } from './desert.js';

const params = new URL(import.meta.url).searchParams;
const view = BISTRO_VIEWS[params.get('view') ?? 'street'];
const models = params.get('models') ?? '/models/bistro/null3d/bistro.glb';
const shadows = params.get('shadows') === '1';
const rgb = (c) => [c[0], c[1], c[2]];

export default defineSketch(async ({ scene, assets, post, quality, page, debug }) => {
	debug.frameStats();
	post.set({ toneMapping: 'none' });
	quality.set({ minRenderScale: 1, governor: false });
	scene.setBackground(rgb(SKY.color));
	scene.createDirectionalLight({
		direction: SUN.direction,
		color: rgb(SUN.color),
		intensity: SUN.intensity,
		castShadows: shadows,
		...(shadows && { shadow: { ...SHADOWS } }),
	});
	scene.createAmbientLight({ intensity: SKY.ambient });
	const camera = scene.createPerspectiveCamera({ fov: FOV_DEGREES, near: NEAR, far: FAR });
	scene.setActiveCamera(camera);
	const bistro = await assets.loadGltf(models);
	scene.instantiate(bistro, {
		scale: [BISTRO_SCALE, BISTRO_SCALE, BISTRO_SCALE],
		castShadows: shadows,
		receiveShadows: shadows,
	});
	page.post('scene', { copies: 1 });
	// The camera sways by a millimeter from frame to frame, so the view never counts as still: a
	// still view stops drawing new frames, and its frames would time nothing.
	let frame = 0;
	const place = () => {
		const sway = (frame++ & 1) * 0.001;
		camera.setPosition(view.position[0] + sway, view.position[1], view.position[2]);
		camera.lookAt(view.target[0], view.target[1], view.target[2]);
	};
	place();
	return { onUpdate: place };
});
