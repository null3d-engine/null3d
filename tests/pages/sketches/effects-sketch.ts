// Custom effects and a custom tone curve, for their image tests. Lit boxes and a sphere stand on a
// long ground under a sun. Without a query the sketch draws the scene with the built-in tone
// curve. ?effects adds two effects: a color split that reads the pixels beside each pixel, and a
// fog that reads the scene's depth. ?reversed adds them in the other order, with orders that run
// them as ?effects does. ?later adds them during play, half a second in, and changes a uniform after
// adding it. ?fogfirst runs the fog before the split. ?curve maps the scene with a custom tone
// curve, Reinhard's, and ?bloom turns bloom on with the effects. ?scale= draws at that render scale.
//
// The module uses no type annotations: an address whose last value holds a dot, such as scale=0.5,
// makes the dev server read the module as JavaScript.
import { defineSketch } from '@null3d/engine';

const params = new URL(import.meta.url).searchParams;
const EFFECTS = params.has('effects');
const REVERSED = params.has('reversed');
const LATER = params.has('later');
const FOG_FIRST = params.has('fogfirst');
const CURVE = params.has('curve');
const BLOOM = params.has('bloom');
const SCALE = params.get('scale');

// Shifts red one way and blue the other by `shift` pixels, and tints the result.
const split = /* wgsl */ `
struct Uniforms { tint: vec3f, shift: f32 }

fn effect(input: EffectInput) -> vec4f {
    let step = vec2f(uniforms.shift / input.size.x, 0.0);
    let red = effectColor(input.uv + step).r;
    let blue = effectColor(input.uv - step).b;
    return vec4f(vec3f(red, input.color.g, blue) * uniforms.tint, input.color.a);
}
`;

// Fades each pixel toward the fog's color by its distance from the camera.
const fog = /* wgsl */ `
struct Uniforms { color: vec3f, density: f32 }

fn effect(input: EffectInput) -> vec4f {
    let distance = effectDistance(input.uv);
    let fade = 1.0 - exp(-distance * uniforms.density);
    return vec4f(mix(input.color.rgb, uniforms.color * input.color.a, fade), input.color.a);
}
`;

// Reinhard's curve, as three.js's ReinhardToneMapping writes it.
const reinhard = /* wgsl */ `
fn toneCurve(color: vec3f) -> vec3f {
    return color / (vec3f(1.0) + color);
}
`;

export default defineSketch(({ scene, materials, geometry, post, quality, time }) => {
	if (SCALE !== null) {
		const scale = Number(SCALE);
		quality.set({ minRenderScale: scale, maxRenderScale: scale, governor: false });
	}
	if (CURVE) post.set({ toneMapping: reinhard });
	if (BLOOM) post.set({ bloom: { intensity: 0.3, threshold: 1 } });
	scene.setBackground('#2a3a50');
	const camera = scene.createPerspectiveCamera({
		fov: 40,
		near: 0.1,
		far: 60,
		position: [0, 2.2, 7],
		target: [0, 0.6, -2],
	});
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({ direction: [-0.4, -1, -0.5], color: '#ffffff', intensity: 3 });
	scene.createAmbientLight({ color: '#ffffff', intensity: 0.35 });
	const ground = geometry.box({ width: 12, height: 0.2, depth: 40 });
	const box = geometry.box({ width: 1, height: 1, depth: 1 });
	const sphere = geometry.sphere({ radius: 0.6, widthSegments: 32, heightSegments: 16 });
	const stone = materials.standard({ color: '#8a8f96', roughness: 0.6 });
	scene.createMesh({ mesh: ground, material: stone, position: [0, -0.1, -12] });
	['#e04040', '#40c060', '#4070e0', '#e0c040'].forEach((color, k) => {
		const material = materials.standard({ color, roughness: 0.6 });
		scene.createMesh({ mesh: box, material, position: [-2.4 + k * 1.6, 0.5, -1 - k * 4] });
	});
	const glow = materials.standard({ color: '#ffffff', emissive: '#ffd080', emissiveIntensity: 4 });
	scene.createMesh({ mesh: sphere, material: glow, position: [1.2, 1.4, 0.5] });

	const addEffects = () => {
		if (REVERSED) {
			post.addEffect({ wgsl: fog, order: 1, uniforms: { color: '#b0c4d8', density: 0.04 } });
			post.addEffect({ wgsl: split, order: -1, uniforms: { tint: [1, 0.95, 0.9], shift: 3 } });
			return;
		}
		const order = FOG_FIRST ? 1 : 0;
		const first = post.addEffect({
			wgsl: split,
			order,
			uniforms: { tint: [1, 0.95, 0.9], shift: 1 },
		});
		post.addEffect({ wgsl: fog, uniforms: { color: '#b0c4d8', density: 0.04 } });
		post.setEffectUniform(first, 'shift', 3);
	};
	if (EFFECTS && !LATER) addEffects();
	let added = false;
	return {
		onUpdate() {
			if (!EFFECTS || !LATER || added || time.now < 0.5) return;
			added = true;
			addEffects();
		},
	};
});
