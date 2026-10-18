// The subsurface blur of skin: two upright panels of one skin tone in a low sun, plain on the left
// and with a scatter radius on the right. A thin bar in front of them casts a shadow across both,
// so the right panel's light spreads into the shadow, redder than it is bright. A gray box in front
// of the right panel's lower part takes no blur. The quality setting gives the blur 17 taps on every
// tier. The subsurface spec measures each effect.
// ?off draws the same scene with no taps, so neither panel blurs.
// ?maps gives both panels a base color map of fine stripes, which the right panel softens.
// ?scale=0.5 draws at half the render size, into the corner of the targets. ?taps= gives the blur
// that many taps in place of 17. ?no-contact turns the sun's contact shadows off, whose passes load
// ambient occlusion's shader file on their first use: a page that tests another feature's own file
// alone asks for that.
//
// On the page's 'subsurface' message it gives the blur its taps, waits until its pipelines are
// built, and posts the frames and milliseconds that took as 'settled'. The 'subsurface-off'
// message takes the taps away, so the blur and the skin pass stop.
//
// The module uses no type annotations: an address whose last value holds a dot, such as scale=0.5,
// makes the dev server read the module as JavaScript.
import { defineSketch } from '@null3d/engine';
import {
	BAR,
	BLOCKER,
	BLOCKER_SIZE,
	CAMERA,
	PANEL_SIZE,
	PANEL_X,
	RADIUS,
	SCATTER_COLOR,
	SUN,
} from './subsurface-scene';

const params = new URL(import.meta.url).searchParams;
const SCALE = params.get('scale');
/** The blur's taps of each step: the address's count where it names one the setting takes. */
const TAPS = ([11, 17, 25] as const).find((taps) => taps === Number(params.get('taps'))) ?? 17;

export default defineSketch(({ scene, materials, geometry, textures, quality, time, page }) => {
	quality.set({ subsurfaceSamples: params.has('off') ? 0 : TAPS, governor: false });
	if (SCALE !== null) {
		const scale = Number(SCALE);
		quality.set({ minRenderScale: scale, maxRenderScale: scale });
	}
	scene.setBackground('#20242c');
	scene.setActiveCamera(scene.createPerspectiveCamera(CAMERA));
	scene.createDirectionalLight({
		direction: SUN,
		color: '#fff4e6',
		intensity: 3,
		castShadows: true,
		shadow: { distance: 12, ...(params.has('no-contact') ? { contactDistance: 0 } : {}) },
	});
	scene.createAmbientLight({ color: '#9fb4d8', intensity: 0.2 });

	// Fine stripes across, whose edges the blur softens on the right panel.
	const size = 64;
	const data = new Uint8Array(size * size * 4);
	for (let y = 0; y < size; y++)
		for (let x = 0; x < size; x++) {
			const shade = Math.floor(x / 4) % 2 === 0 ? 255 : 150;
			data.set([shade, shade, shade, 255], (y * size + x) * 4);
		}
	const stripes = params.has('maps')
		? { map: textures.fromData({ width: size, height: size, data, colorSpace: 'srgb' }) }
		: {};
	const skin = { color: '#e0b49c', roughness: 0.45, ...stripes };
	const panel = geometry.plane({ width: PANEL_SIZE[0], height: PANEL_SIZE[1] });
	const panels = [
		materials.standard(skin),
		materials.standard({ ...skin, subsurfaceRadius: RADIUS, subsurfaceColor: SCATTER_COLOR }),
	];
	panels.forEach((material, k) => {
		scene.createMesh({
			mesh: panel,
			material,
			position: [PANEL_X[k] as number, 0.3, 0],
			receiveShadows: true,
		});
	});
	scene.createMesh({
		mesh: geometry.box({ width: 3.6, height: BAR.thickness, depth: BAR.thickness }),
		material: materials.standard({ color: '#3a3a3a' }),
		position: [0.3, BAR.y, BAR.z],
		castShadows: true,
	});
	scene.createMesh({
		mesh: geometry.box({ width: BLOCKER_SIZE, height: BLOCKER_SIZE, depth: BLOCKER_SIZE }),
		material: materials.standard({ color: '#7a8088', roughness: 0.7 }),
		position: BLOCKER,
		receiveShadows: true,
	});
	page.onMessage((message) => {
		if (message === 'subsurface-off') quality.set({ subsurfaceSamples: 0 });
		if (message !== 'subsurface') return;
		const frame = time.frame;
		const start = performance.now();
		quality.set({ subsurfaceSamples: TAPS });
		void scene
			.warmUp()
			.then(() =>
				page.post('settled', { frames: time.frame - frame, ms: performance.now() - start }),
			);
	});
});
