// The LCD look's cost, for its cost page: a panel fills the view, so every pixel draws the panel's
// math. On the page's 'lcd' message the panel takes the LCD material, which loads its shader, and
// the sketch posts 'settled' once it is built. 'plain' puts back a plain textured image of the same
// canvas. ?scale= draws at that render scale, and ?fixed holds that scale alone with the governor
// off.
//
// The module uses no type annotations: an address whose last value holds a dot, such as scale=0.5,
// makes the dev server read the module as JavaScript.
import { defineSketch } from '@null3d/engine';
import { createScreen } from '../../../examples/addons/screens';

const params = new URL(import.meta.url).searchParams;
const SCALE = params.get('scale');
const FIXED = params.has('fixed');

export default defineSketch(async (ctx) => {
	const { scene, materials, quality, page } = ctx;
	if (SCALE !== null) {
		const scale = Number(SCALE);
		quality.set({
			minRenderScale: FIXED ? scale : Math.min(scale, 0.5),
			maxRenderScale: scale,
			governor: !FIXED,
		});
	}
	scene.setBackground('#0e1116');
	scene.setActiveCamera(
		scene.createPerspectiveCamera({
			fov: 45,
			near: 0.1,
			far: 100,
			position: [0, 0, 6],
			target: [0, 0, 0],
		}),
	);
	// A picture with the tones and edges of a panel's page, so the texture samples as it would in a
	// scene. Its texels cover several pixels, which runs every part of the LCD look.
	const screen = createScreen(ctx, {
		width: 512,
		height: 288,
		refreshHz: 1,
		size: [14, 9],
		draw: (context) => {
			const gradient = context.createLinearGradient(0, 0, 512, 288);
			gradient.addColorStop(0, '#0b3a4a');
			gradient.addColorStop(1, '#c8ff3a');
			context.fillStyle = gradient;
			context.fillRect(0, 0, 512, 288);
			context.fillStyle = '#eaf6ff';
			context.font = 'bold 46px sans-serif';
			context.textBaseline = 'top';
			for (let y = 20; y < 288; y += 60) context.fillText('SABLE GT  42.0', 20, y);
		},
	});
	screen.mesh.setPosition(0, 0, 0);
	// The plain side draws the same canvas through the unlit material, with no panel math.
	const plain = materials.unlit({ map: screen.texture });
	screen.mesh.setMaterial(plain);
	page.onMessage((message) => {
		if (message === 'plain') {
			screen.mesh.setMaterial(plain);
			return;
		}
		if (message !== 'lcd') return;
		screen.mesh.setMaterial(screen.material);
		void scene.warmUp().then(() => page.post('settled', {}));
	});
});
