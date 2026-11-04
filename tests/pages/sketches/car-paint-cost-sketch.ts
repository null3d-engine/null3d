// The car paint's cost, for its cost page: a wall of painted panels covers the view, so every
// pixel draws the paint. On the page's 'paint' message the panels take the paint, which loads the
// clear coat's and the stretched lobe's shaders, and the sketch posts 'settled' once they are
// built. 'paint-off' puts back a plain clear-coated metal with the same values. ?scale= draws at
// that render scale, and ?fixed holds that scale alone with the governor off. ?paint= picks the
// painted side's parts: full (the default) draws the flakes, the seams and the weave, flakes draws
// the flakes alone, body draws the seams and the weave alone, and loop and loop-0 draw flakes whose
// footprint and light make the count take many steps, or one.
//
// The module uses no type annotations: an address whose last value holds a dot, such as scale=0.5,
// makes the dev server read the module as JavaScript.
import { defineSketch } from '@null3d/engine';
import { createCarPaint } from '../../../examples/addons/car-paint';

const params = new URL(import.meta.url).searchParams;
const SCALE = params.get('scale');
const FIXED = params.has('fixed');
const PAINT = params.get('paint') ?? 'full';

// The look's parts. The panel fills the view, so these densities draw flakes, seams and tows at the
// size a car's panels show. The loop variants make the count take many steps: a footprint that lands
// in the exact branch at every buffer this page draws, under a light that every flake catches,
// against the same footprint under a light that no flake catches.
const FLAKES_ONLY = PAINT === 'flakes' || PAINT === 'loop' || PAINT === 'loop-0';

export default defineSketch(async (ctx) => {
	const { scene, materials, geometry, assets, quality, page } = ctx;
	if (SCALE !== null) {
		const scale = Number(SCALE);
		quality.set({
			minRenderScale: FIXED ? scale : Math.min(scale, 0.5),
			maxRenderScale: scale,
			governor: !FIXED,
		});
	}
	// The page times the paint. The presets' own screen-space passes cost more than the paint and
	// move between rounds, so they draw nothing here, and a preset changes the pixel count alone.
	quality.set({ aoScale: 0, bounceRays: 0 });
	scene.setBackground('#0e1116');
	scene.setEnvironment(await assets.builtinEnvironment('room'), { intensity: 0.8 });
	scene.setActiveCamera(
		scene.createPerspectiveCamera({
			fov: 45,
			near: 0.1,
			far: 100,
			position: [0, 0, 6],
			target: [0, 0, 0],
		}),
	);
	scene.createDirectionalLight({
		direction: [-1, -1.4, -2],
		color: '#fff3e0',
		intensity: 2.6,
	});
	scene.createPointLight({
		position: [2.5, 2, 2.5],
		color: '#9fc4ff',
		intensity: 20,
		range: 20,
	});
	// The plain side: the same clear-coated metal, without the flakes, the seams and the weave.
	const plain = materials.standard({
		color: '#9e0b16',
		metalness: 0.72,
		roughness: 0.34,
		clearcoat: 1,
		clearcoatRoughness: 0.02,
	});
	// The painted side takes the parts that ?paint= names, with the plain side's base values. Each
	// branch is written in place, so each keeps the flakes' and the seams' own shapes.
	const paint = createCarPaint(ctx, {
		color: '#9e0b16',
		metalness: 0.72,
		roughness: 0.34,
		flakes:
			PAINT === 'body'
				? false
				: PAINT === 'loop'
					? { cells: [3800, 5700], tilt: 0.28, angle: 1.4 }
					: PAINT === 'loop-0'
						? { cells: [3800, 5700], tilt: 0.28, angle: 0.0001 }
						: { cells: [1600, 2400], tilt: 0.28 },
		seams: FLAKES_ONLY ? false : { spacing: [0.1, 0], width: 0.0024, shade: 0.85 },
		weave: PAINT === 'full' || PAINT === 'body' ? { cells: [400, 600], shine: 0.9 } : false,
		clearcoat: 1,
		clearcoatRoughness: 0.02,
	});
	// One plane fills the view, so every pixel draws the paint at the whole render size.
	const panel = scene.createMesh({
		mesh: geometry.plane({ width: 14, height: 9 }),
		material: plain,
	});
	page.onMessage((message) => {
		if (message === 'paint-off') {
			panel.setMaterial(plain);
			return;
		}
		if (message !== 'paint') return;
		panel.setMaterial(paint);
		void scene.warmUp().then(() => page.post('settled', {}));
	});
});
