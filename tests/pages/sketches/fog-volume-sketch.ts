// Volumetric fog's scene: a low sun behind a row of tall pillars, so its rays fall between them
// toward the camera through height fog, and with ?night three street lamps, spot lights that cast
// shadows, with a box under the middle one, and a warm point light near the camera, with no sun.
// ?fog=on turns the volumetric fog on in the setup; without it the fog keeps its sun glow.
// ?slices= sets the quality setting fogSlices. ?scale= draws at that render scale, with a range
// that reaches down to 0.5; with ?fixed the range holds that scale alone, and the governor is off,
// for timing. With ?later, the sketch turns the volumetric fog on during play, half a second in.
// With ?moving, the camera sways from side to side, so each frame reads the last frame's grid from
// another place.
//
// On the page's 'fog' message it turns the volumetric fog on, waits until its pipelines are built,
// and posts the frames and milliseconds that took as 'settled'. The 'fog-off' message turns it off.
//
// The module uses no type annotations: an address whose last value holds a dot, such as scale=0.5,
// makes the dev server read the module as JavaScript.
import { defineSketch } from '@null3d/engine';

const params = new URL(import.meta.url).searchParams;
const NIGHT = params.has('night');
const ON = params.get('fog') === 'on';
const LATER = params.has('later');
const MOVING = params.has('moving');
const SLICES = params.get('slices');
const SCALE = params.get('scale');
const FIXED = params.has('fixed');

/** The slice count that ?slices= names, of those that the quality setting fogSlices takes. */
const SLICE_COUNT =
	SLICES === '0' ? 0 : SLICES === '32' ? 32 : SLICES === '96' ? 96 : SLICES === null ? null : 64;

const FOG_COLOR = NIGHT ? '#10141c' : '#56606e';
const VOLUMETRIC = { intensity: NIGHT ? 1 : 1.5, anisotropy: 0.6, distance: 40 };

/** The scene's fog with its sun glow, and the same fog with the volumetric fog on. */
const PLAIN = {
	color: FOG_COLOR,
	density: NIGHT ? 0.05 : 0.035,
	height: 0,
	heightFalloff: 0.08,
	sunGlow: NIGHT ? 0 : 0.8,
};
const LIT = { ...PLAIN, volumetric: VOLUMETRIC };

export default defineSketch(({ scene, materials, geometry, quality, time, page }) => {
	if (SLICE_COUNT !== null) quality.set({ fogSlices: SLICE_COUNT });
	if (SCALE !== null) {
		const scale = Number(SCALE);
		quality.set({
			minRenderScale: FIXED ? scale : Math.min(scale, 0.5),
			maxRenderScale: scale,
			governor: !FIXED,
		});
	}
	scene.setBackground(FOG_COLOR);
	scene.setFog(ON && !LATER ? LIT : PLAIN);
	const camera = scene.createPerspectiveCamera({
		fov: 60,
		near: 0.1,
		far: 200,
		position: [0, 2, 14],
		target: [0, 3, 0],
		dynamic: true,
	});
	scene.setActiveCamera(camera);
	scene.createAmbientLight({
		color: NIGHT ? '#304060' : '#8098b8',
		intensity: NIGHT ? 0.15 : 0.35,
	});
	if (!NIGHT)
		scene.createDirectionalLight({
			direction: [0.25, -0.35, 1],
			color: '#ffd29a',
			intensity: 3,
			castShadows: true,
			shadow: { distance: 60 },
		});
	const stone = materials.standard({ color: '#9a8f80', roughness: 0.9, metalness: 0 });
	const ground = materials.standard({ color: '#4a4f45', roughness: 1, metalness: 0 });
	const shadows = { castShadows: true, receiveShadows: true };
	scene.createMesh({
		mesh: geometry.box({ width: 60, height: 0.2, depth: 60 }),
		material: ground,
		position: [0, -0.1, 0],
		...shadows,
	});
	const pillar = geometry.box({ width: 0.7, height: 9, depth: 0.7 });
	for (let k = -6; k <= 6; k++)
		scene.createMesh({ mesh: pillar, material: stone, position: [k * 1.5, 4.5, -6], ...shadows });
	scene.createMesh({
		mesh: geometry.box({ width: 20, height: 0.8, depth: 1 }),
		material: stone,
		position: [0, 9.4, -6],
		...shadows,
	});
	if (NIGHT) {
		for (const x of [-5, 0, 5])
			scene.createSpotLight({
				position: [x, 5.5, 0],
				target: [x, 0, 1],
				range: 14,
				angle: 0.55,
				penumbra: 0.35,
				color: '#ffd8a8',
				intensity: 60,
				castShadows: true,
			});
		scene.createMesh({
			mesh: geometry.box({ width: 1.2, height: 1.2, depth: 1.2 }),
			material: stone,
			position: [0, 2.2, 0.5],
			...shadows,
		});
		scene.createPointLight({ position: [3, 1.2, 6], range: 6, color: '#ff9a50', intensity: 6 });
	}
	page.onMessage((message) => {
		if (message === 'fog-off') scene.setFog(PLAIN);
		if (message !== 'fog') return;
		const frame = time.frame;
		const start = performance.now();
		scene.setFog(LIT);
		void scene
			.warmUp()
			.then(() =>
				page.post('settled', { frames: time.frame - frame, ms: performance.now() - start }),
			);
	});
	let turnedOn = false;
	return {
		onUpdate() {
			if (MOVING) {
				camera.setPosition(3 * Math.sin(time.now * 0.8), 2, 14);
				camera.lookAt(0, 3, 0);
			}
			if (!ON || !LATER || turnedOn || time.now < 0.5) return;
			turnedOn = true;
			scene.setFog(LIT);
		},
	};
});
