// Bloom's scene (bench/scenes/bloom.ts), which the parity test also draws with three.js's
// UnrealBloomPass: emissive spheres and a thin bar that glow over a dim ground, beside a lit box
// below the threshold. ?bloom=soft or ?bloom=strong names its settings, mapped from three.js's onto
// null3D's chain, and without it bloom stays off. With ?later, the sketch turns bloom on during play, half a second in, rather than in its
// setup. ?scale= draws at that render scale, with a range that reaches down to 0.5; with ?fixed the
// range holds that scale alone, and the governor is off, for timing. ?size= sets the quality
// setting bloomSize, the base of bloom's chain. On the page's 'bloom' message
// it turns the strong bloom on, waits until its pipelines are built, and posts the frames and
// milliseconds that took as 'settled'. The 'bloom-off' message turns bloom off.
//
// The module uses no type annotations: an address whose last value holds a dot, such as scale=0.5,
// makes the dev server read the module as JavaScript.
import { defineSketch } from '@null3d/engine';
import {
	BLOOM_AMBIENT,
	BLOOM_BACKGROUND,
	BLOOM_CAMERA,
	BLOOM_MAPPED,
	BLOOM_SHAPES,
	BLOOM_SUN,
} from '../../../bench/scenes/bloom';

const params = new URL(import.meta.url).searchParams;
const name = params.get('bloom');
const BLOOM =
	name === 'soft' ? BLOOM_MAPPED.soft : name === 'strong' ? BLOOM_MAPPED.strong : undefined;
const LATER = params.has('later');
const SCALE = params.get('scale');
const FIXED = params.has('fixed');
const SIZE = params.get('size');

export default defineSketch(({ scene, materials, geometry, post, quality, time, page }) => {
	// The three.js twin draws with AgXToneMapping, which plain AgX matches.
	post.set({ toneMapping: 'agx' });
	if (BLOOM && !LATER) post.set({ bloom: BLOOM });
	if (SCALE !== null) {
		const scale = Number(SCALE);
		quality.set({
			minRenderScale: FIXED ? scale : Math.min(scale, 0.5),
			maxRenderScale: scale,
			governor: !FIXED,
		});
	}
	if (SIZE !== null) quality.set({ bloomSize: Number(SIZE) as 64 | 128 | 256 | 512 });
	scene.setBackground(BLOOM_BACKGROUND);
	const camera = scene.createPerspectiveCamera({
		fov: BLOOM_CAMERA.fov,
		near: BLOOM_CAMERA.near,
		far: BLOOM_CAMERA.far,
		position: [...BLOOM_CAMERA.position],
		target: [...BLOOM_CAMERA.target],
	});
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({
		direction: [...BLOOM_SUN.direction],
		color: BLOOM_SUN.color,
		intensity: BLOOM_SUN.intensity,
	});
	scene.createAmbientLight({ color: BLOOM_AMBIENT.color, intensity: BLOOM_AMBIENT.intensity });
	for (const shape of BLOOM_SHAPES) {
		const [x, y, z] = shape.size;
		const mesh =
			shape.kind === 'box'
				? geometry.box({ width: x, height: y, depth: z })
				: geometry.sphere({ radius: x });
		const material = materials.standard({
			color: shape.color,
			roughness: shape.roughness,
			metalness: 0,
			emissive: shape.emissive,
			emissiveIntensity: shape.emissiveIntensity,
		});
		scene.createMesh({ mesh, material, position: [...shape.position] });
	}
	page.onMessage((message) => {
		if (message === 'bloom-off') post.set({ bloom: false });
		if (message !== 'bloom') return;
		const frame = time.frame;
		const start = performance.now();
		post.set({ bloom: BLOOM_MAPPED.strong });
		void scene
			.warmUp()
			.then(() =>
				page.post('settled', { frames: time.frame - frame, ms: performance.now() - start }),
			);
	});
	let turnedOn = false;
	return {
		onUpdate() {
			if (!BLOOM || !LATER || turnedOn || time.now < 0.5) return;
			turnedOn = true;
			post.set({ bloom: BLOOM });
		},
	};
});
