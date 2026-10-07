// Bloom's scene (bench/scenes/bloom.ts) with custom effects, for the effect cost page. On the
// page's 'effects' message it adds ?count= effects, 4 by default, waits until their pipelines are
// built, and posts the frames and milliseconds that took as 'settled'. The 'effects-off' message
// removes them. Each effect reads its own pixel and scales it a little, so the GPU time it adds is
// the cost of one full-screen pass over HDR color. ?scale= draws at that render scale, with the
// governor off.
//
// The module uses no type annotations: an address whose last value holds a dot, such as scale=0.5,
// makes the dev server read the module as JavaScript.
import { defineSketch } from '@null3d/engine';
import {
	BLOOM_AMBIENT,
	BLOOM_BACKGROUND,
	BLOOM_CAMERA,
	BLOOM_SHAPES,
	BLOOM_SUN,
} from '../../../bench/scenes/bloom';

const params = new URL(import.meta.url).searchParams;
const SCALE = params.get('scale');
const COUNT = Number(params.get('count') ?? '4');

// Scales each pixel's color by a uniform: one read and one write per pixel, as a cheap effect does.
const gain = /* wgsl */ `
struct Uniforms { gain: f32 }

fn effect(input: EffectInput) -> vec4f {
    return vec4f(input.color.rgb * uniforms.gain, input.color.a);
}
`;

export default defineSketch(({ scene, materials, geometry, post, quality, time, page }) => {
	if (SCALE !== null) {
		const scale = Number(SCALE);
		quality.set({ minRenderScale: scale, maxRenderScale: scale, governor: false });
	}
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
	const add = (count = 0) =>
		Array.from({ length: count }, (_, k) =>
			post.addEffect({ wgsl: gain, uniforms: { gain: k % 2 === 0 ? 1.01 : 0.99 } }),
		);
	let effects = add();
	page.onMessage((message) => {
		if (message === 'effects-off') {
			for (const effect of effects) post.removeEffect(effect);
			effects = add();
		}
		if (message !== 'effects' || effects.length > 0) return;
		const frame = time.frame;
		const start = performance.now();
		effects = add(COUNT);
		void scene
			.warmUp()
			.then(() =>
				page.post('settled', { frames: time.frame - frame, ms: performance.now() - start }),
			);
	});
	return {};
});
