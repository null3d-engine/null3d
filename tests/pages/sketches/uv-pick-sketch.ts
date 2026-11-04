// An in-world screen, for the test that clicks a screen texel. A plane fills the camera's view, and
// its first texture coordinates run across a 256 x 144 display, as a canvas image's pixels do, with
// the image's first row at the top. The page asks for the canvas point of a texel, clicks there, and
// the click's handler reports the texel that the engine's hit landed on. So the click reaches the
// display's own space without the sketch working out where the plane lies in the world.
import { defineSketch } from '@null3d/engine';

/** The display's size in meters, larger than the view so every click lands on it. */
const WIDTH = 24;
const HEIGHT = 13.5;
/** The texels of the image drawn on it: a canvas-sized screen. */
const TEXELS_X = 256;
const TEXELS_Y = 144;
/** The camera's field of view, and its distance from the display. */
const FOV = 60;
const DISTANCE = 10;

/** The texels that the test aims at, all well inside the canvas. */
const AIMED: [number, number][] = [
	[128, 72],
	[64, 36],
	[192, 108],
	[96, 24],
	[160, 120],
	[40, 100],
	[200, 60],
	[80, 130],
];

/** What a click on the display reports. */
interface Clicked {
	texel: [number, number];
	uv: [number, number];
	point: [number, number, number];
}

export default defineSketch(({ scene, geometry, materials, page }) => {
	const camera = scene.createPerspectiveCamera({
		fov: FOV,
		position: [0, 0, DISTANCE],
		target: [0, 0, 0],
	});
	scene.setActiveCamera(camera);
	scene.createAmbientLight({ intensity: 2 });
	const display = scene.createMesh({
		name: 'display',
		mesh: geometry.plane({ width: WIDTH, height: HEIGHT }),
		material: materials.standard({ color: '#203040' }),
	});
	const clicks: Clicked[] = [];
	display.on('click', (event) => {
		if (!event.hasUv) return;
		const u = event.uv[0] as number;
		const v = event.uv[1] as number;
		clicks.push({
			texel: [Math.floor(u * TEXELS_X), Math.floor((1 - v) * TEXELS_Y)],
			uv: [u, v],
			point: [event.point[0] as number, event.point[1] as number, event.point[2] as number],
		});
	});
	/** The world point at the centre of texel (`tx`, `ty`), whose row 0 is the image's top row. */
	const centre = (tx: number, ty: number): [number, number, number] => [
		((tx + 0.5) / TEXELS_X - 0.5) * WIDTH,
		(0.5 - (ty + 0.5) / TEXELS_Y) * HEIGHT,
		0,
	];
	const at = [0, 0, 0];
	page.onMessage((type) => {
		if (type === 'aims') {
			page.post(
				'aims',
				AIMED.map(([tx, ty]) => {
					const world = centre(tx, ty);
					camera.worldToScreen(world, at);
					return { texel: [tx, ty], x: at[0], y: at[1], world };
				}),
			);
		} else if (type === 'clicks') {
			page.post('clicks', clicks);
		}
	});
	return {};
});
