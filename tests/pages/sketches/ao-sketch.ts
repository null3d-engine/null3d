// Ambient occlusion's scene (bench/scenes/ao.ts), which the parity test also draws with three.js's
// GTAOPass: a floor and a wall that meet in a crease, with boxes and spheres on the floor, lit by
// ambient light alone. ?ao=default or ?ao=wide names its settings, and without it ambient occlusion
// stays off. The sketch sets the ambient occlusion scale to half, or to ?aoscale=, as the presets of
// WebGL2 and compatibility mode leave it at 0. ?sun adds a sun and its shadows, so the test shows
// that the occlusion darkens only the ambient light. ?custom gives the large sphere a custom
// material whose vertex offset swells it in bands, so its depth comes from its own vertex shader.
// ?scale= draws at that render scale, with a
// range that reaches down to 0.5; with ?fixed the range holds that scale alone, and the governor is
// off, for timing. On the page's 'ao' message it turns the default occlusion on, waits until its
// pipelines are built, and posts the frames and milliseconds that took as 'settled'. The 'ao-off'
// message turns it off.
//
// The module uses no type annotations: an address whose last value holds a dot, such as scale=0.5,
// makes the dev server read the module as JavaScript.
import { defineSketch } from '@null3d/engine';
import {
	AO_AMBIENT,
	AO_BACKGROUND,
	AO_CAMERA,
	AO_SETTINGS,
	AO_SHAPES,
} from '../../../bench/scenes/ao';

const params = new URL(import.meta.url).searchParams;
const name = params.get('ao');
const AO =
	name === 'default' ? AO_SETTINGS.default : name === 'wide' ? AO_SETTINGS.wide : undefined;
const AO_SCALE = Number(params.get('aoscale') ?? 0.5);
const SUN = params.has('sun');
const CUSTOM = params.has('custom');

/** Swells the surface along its normals in bands, and darkens the swollen bands a little. */
const swell = /* wgsl */ `
fn band(uv: vec2f) -> f32 {
    return step(0.5, fract(uv.y * 6.0));
}

fn vertexOffset(input: VertexInput) -> vec3f {
    return input.normal * band(input.uv) * 0.06;
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    s.baseColor *= 1.0 - 0.2 * band(input.uv);
    return s;
}
`;
const SCALE = params.get('scale');
const FIXED = params.has('fixed');

export default defineSketch(({ scene, materials, geometry, post, quality, time, page }) => {
	// The three.js twin draws with AgXToneMapping, which plain AgX matches.
	post.set({ toneMapping: 'agx' });
	quality.set({ aoScale: AO_SCALE === 0.25 ? 0.25 : 0.5 });
	if (AO) post.set({ ao: AO });
	if (SCALE !== null) {
		const scale = Number(SCALE);
		quality.set({
			minRenderScale: FIXED ? scale : Math.min(scale, 0.5),
			maxRenderScale: scale,
			governor: !FIXED,
		});
	}
	scene.setBackground(AO_BACKGROUND);
	const camera = scene.createPerspectiveCamera({
		fov: AO_CAMERA.fov,
		near: AO_CAMERA.near,
		far: AO_CAMERA.far,
		position: [...AO_CAMERA.position],
		target: [...AO_CAMERA.target],
	});
	scene.setActiveCamera(camera);
	scene.createAmbientLight({ color: AO_AMBIENT.color, intensity: AO_AMBIENT.intensity });
	if (SUN)
		scene.createDirectionalLight({
			direction: [-1, -2, -1.5],
			color: '#ffffff',
			intensity: 2,
			castShadows: true,
		});
	for (const shape of AO_SHAPES) {
		const [x, y, z] = shape.size;
		const mesh =
			shape.kind === 'box'
				? geometry.box({ width: x, height: y, depth: z })
				: geometry.sphere({ radius: x });
		const custom = CUSTOM && shape.kind === 'sphere' && x > 0.5;
		const material = custom
			? materials.shader({ wgsl: swell, color: shape.color, roughness: 1, metalness: 0 })
			: materials.standard({ color: shape.color, roughness: 1, metalness: 0 });
		scene.createMesh({ mesh, material, position: [...shape.position] });
	}
	page.onMessage((message) => {
		if (message === 'ao-off') post.set({ ao: false });
		if (message !== 'ao') return;
		const frame = time.frame;
		const start = performance.now();
		post.set({ ao: AO_SETTINGS.default });
		void scene
			.warmUp()
			.then(() =>
				page.post('settled', { frames: time.frame - frame, ms: performance.now() - start }),
			);
	});
});
