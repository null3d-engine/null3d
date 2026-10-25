// Depth of field, declared with a feature description and placed by its full-screen adapter: six
// posts at different distances, focused on the third one, run through a gather that blurs by each
// pixel's distance from the focus. The description reads the scene's color and depth, writes the
// color, and takes its tap count from the preset's dofSamples, so High draws 43 taps and Low draws
// none. `?dof=off` draws the scene without the feature, for the spec that compares the two frames.
// The frame is held at 0 seconds, so a run draws the same picture every time.
import { declareAddonNamespace, defineFeature, defineSketch, FeatureHost } from '@null3d/engine';

/** The test add-on's names, claimed once as the sketch's module loads. */
const NAMESPACE = declareAddonNamespace({ name: 'dof_test', package: '@null3d/test-dof' });

/** False with `?dof=off`, which draws the scene without the feature, to show what the pass changes. */
const ENABLED = new URL(import.meta.url).searchParams.get('dof') !== 'off';

// A depth of field's gather: each pixel mixes a spiral of taps over the circle of confusion that its
// distance from the focus gives. A thin lens' circle grows with the distance from the focus and
// shrinks with the distance from the camera.
const DOF = /* wgsl */ `
struct Uniforms {
    focus: f32,
    strength: f32,
    maxBlur: f32,
    samples: f32,
}

const GOLDEN_ANGLE: f32 = 2.39996323;

fn effect(input: EffectInput) -> vec4f {
    let taps = min(uniforms.samples, 71.0);
    let distance = effectDistance(input.uv);
    let away = abs(distance - uniforms.focus) / max(distance, 0.001);
    let radius = min(away * uniforms.strength, uniforms.maxBlur);
    if (taps < 1.0 || radius < 0.35) {
        return input.color;
    }
    let step = radius / input.size.y;
    var color = input.color.rgb;
    var weight = 1.0;
    for (var i = 1u; i < 72u; i = i + 1u) {
        let f = f32(i);
        if (f >= taps) {
            break;
        }
        let angle = f * GOLDEN_ANGLE;
        let reach = sqrt(f / taps) * step;
        let uv = input.uv + vec2f(cos(angle), sin(angle)) * reach;
        color += effectColor(uv).rgb;
        weight += 1.0;
    }
    return vec4f(color / weight, input.color.a);
}
`;

/** The distances of the posts from the camera, and their colors. */
const POSTS: readonly (readonly [number, string])[] = [
	[2.6, '#e8554e'],
	[4.4, '#f2c14e'],
	[6.4, '#5bc27a'],
	[8.6, '#fafafa'],
	[11.4, '#b06ce0'],
	[14.6, '#3dd6d0'],
];

export default defineSketch(async ({ scene, geometry, materials, post, quality, engine, page }) => {
	// The frame-budget governor could draw the held frame below the canvas's size, which moves its
	// pixels, so the test pins the render scale (see the image tests guide).
	await quality.set({ minRenderScale: 1, maxRenderScale: 1, governor: false });
	scene.setBackground('#0b0e14');
	const camera = scene.createPerspectiveCamera({
		fov: 45,
		near: 0.1,
		far: 60,
		position: [0, 1.7, 9],
		target: [0, 0.8, -2],
	});
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({ direction: [-0.5, -1, 0.4], color: '#ffffff', intensity: 2.4 });
	scene.createAmbientLight({ color: '#b8c8e0', intensity: 0.5 });
	// The floor shows the blur of the ground that runs away from the camera.
	scene.createMesh({
		mesh: geometry.box({ width: 24, height: 0.2, depth: 60 }),
		material: materials.standard({ color: '#6b7280', roughness: 0.75 }),
		position: [0, -0.1, -12],
	});
	// A post stands at each distance, with a bright cap so that the blur spreads it.
	const postMesh = geometry.box({ width: 0.5, height: 1.8, depth: 0.5 });
	const capMesh = geometry.box({ width: 0.7, height: 0.25, depth: 0.7 });
	for (const [k, [distance, color]] of POSTS.entries()) {
		const z = 9 - distance;
		const x = (k % 3) * 1.4 - 1.4;
		const body = materials.standard({ color, roughness: 0.5 });
		scene.createMesh({ mesh: postMesh, material: body, position: [x, 0.9, z] });
		scene.createMesh({
			mesh: capMesh,
			material: materials.standard({ color: '#ffffff', emissive: color, emissiveIntensity: 2 }),
			position: [x, 1.9, z],
		});
	}

	// The feature's own state, which its ready callback and its quality callback keep.
	let samples = 0;
	let setSamples: ((value: number) => void) | undefined;
	const description = defineFeature({
		name: 'depth-of-field',
		frame: 'resolve',
		kind: 'fullscreen',
		band: 'normal',
		reads: ['sceneColor', 'sceneDepth'],
		writes: ['sceneColor'],
		views: ['main'],
		// The preset draws no depth of field on Low, where dofSamples is 0, so the pass costs
		// nothing there.
		ready: () => samples > 0,
		quality: (_preset, settings) => {
			samples = settings.dofSamples;
			setSamples?.(samples);
		},
	});
	const host = new FeatureHost({
		quality,
		tier: engine.capabilities.tier,
		page,
		namespace: NAMESPACE,
	});
	if (!ENABLED) return;
	host.add(description);
	// The focus lies on the third post, about 6.6 world units from the camera.
	const dof = await post.addFeatureEffect(description, {
		wgsl: DOF,
		uniforms: { focus: 6.6, strength: 9, maxBlur: 14, samples },
	});
	// A preset that changed while the adapter loaded reaches the pass here.
	dof.setUniform('samples', samples);
	setSamples = (value) => dof.setUniform('samples', value);
});
