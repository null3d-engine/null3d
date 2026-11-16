// A custom effect that folds into the final pass, beside bloom and the vignette, for the effect fold
// test. The effect draws light shafts toward the sun: it reads only its own pixel and the scene's
// depth, in a loop, as a sketch's god rays do. A WebGL2 fold whose shader defines the final pass's
// main twice for a loop fails, and the effect draws a pass of its own. Bloom reads the effects'
// image, so the fold builds and draws only once the page's 'bloom-off' message turns bloom off.
// The render scale stays whole, as the fold draws only at the canvas's size, and the governor would
// lower it on a slow GPU.
import { defineSketch } from '@null3d/engine';

const rays = /* wgsl */ `
struct Uniforms { sun: vec2f, strength: f32, tint: vec3f }

fn effect(input: EffectInput) -> vec4f {
    let toward = uniforms.sun - input.uv;
    let step = toward / 28.0;
    var uv = input.uv;
    var lit = 0.0;
    var weight = 1.0;
    for (var i = 0; i < 28; i++) {
        lit += select(0.0, weight, effectDepth(uv) == 0.0);
        weight *= 0.95;
        uv += step;
    }
    let rays = lit / 28.0 * uniforms.strength;
    return vec4f(input.color.rgb + uniforms.tint * rays * input.color.a, input.color.a);
}
`;

export default defineSketch(({ scene, materials, geometry, post, page, quality }) => {
	quality.set({ governor: false, minRenderScale: 1, maxRenderScale: 1 });
	post.set({
		bloom: { intensity: 0.4, threshold: 1 },
		vignette: { intensity: 0.5, size: 1.2, roundness: 1 },
	});
	post.addEffect({
		wgsl: rays,
		uniforms: { sun: [0.6, 0.2], strength: 0.6, tint: [1, 0.85, 0.6] },
	});
	scene.setBackground('#8fb4d8');
	const camera = scene.createPerspectiveCamera({
		fov: 50,
		near: 0.1,
		far: 60,
		position: [0, 2, 7],
		target: [0, 0.8, 0],
	});
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({ direction: [-0.4, -1, -0.5], color: '#ffffff', intensity: 3 });
	scene.createAmbientLight({ color: '#ffffff', intensity: 0.35 });
	const box = geometry.box({ width: 1, height: 2, depth: 1 });
	const stone = materials.standard({ color: '#6a7078', roughness: 0.7 });
	for (let k = 0; k < 5; k++)
		scene.createMesh({ mesh: box, material: stone, position: [-3 + k * 1.5, 1, -k] });
	const glow = materials.standard({ color: '#ffffff', emissive: '#ffd080', emissiveIntensity: 4 });
	scene.createMesh({
		mesh: geometry.sphere({ radius: 0.4, widthSegments: 24, heightSegments: 12 }),
		material: glow,
		position: [1.5, 2.5, 0],
	});
	page.onMessage((message) => {
		if (message === 'bloom-off') post.set({ bloom: false });
	});
});
