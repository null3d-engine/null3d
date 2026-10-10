// Environment light: rows of spheres, from rough to smooth, in plastic and in metal, lit only by an
// environment map, over a polished floor that reflects them. Every 4 seconds the scene takes the
// next of three environments: a sunset from a Radiance .hdr file and a studio from an OpenEXR file,
// both filtered on the GPU as they load, and the light of the generated sky, which the GPU makes
// with no file. The background shows each one: the files' environments blurred, and the sky itself.
// The files' environments turn slowly. setEnvironment and setBackground allocate nothing, so they
// can change every frame. A reflection pass draws the spheres and the background mirrored across
// the floor, and the floor's custom material lights that picture as its reflection.
import { defineSketch } from '@null3d/engine';
import { interact } from '../lib/interact';
import { sampleUrl } from '../lib/samples';

/** Seconds that each environment shows. */
const STEP = 4;
/** Spheres in each row, from roughness 0 to 1, and the height of the floor. */
const COLUMNS = 6;
const FLOOR = -1.1;

// The polished floor: the reflection pass's picture, lit as the surface's reflection.
const mirror = /* wgsl */ `
#import null3d::reflection::{reflection_uv}

var floor: texture_2d<f32>;

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let clip = camera.viewProjection * vec4f(input.relativePosition, 1.0);
    s.reflection = vec4f(textureSampleLevel(floor, floorSampler, reflection_uv(clip, vec2f(0.0)), 0.0).rgb, 1.0);
    return s;
}
`;

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, textures, render, post, time } = ctx;
	const [sunset, studio, sky] = await Promise.all([
		assets.loadEnvironment(sampleUrl('sources/hdri/polyhaven/venice_sunset/venice_sunset_2k.hdr')),
		assets.loadEnvironment(
			sampleUrl('sources/hdri/polyhaven/studio_small_09/studio_small_09_1k.exr'),
		),
		assets.skyEnvironment(),
	]);
	// The generated sky: a sun low over the far side of the floor, and a few clouds.
	const daylight = {
		sky: { sunPosition: [0.5, 0.25, -0.8] as const, turbidity: 3, cloudCoverage: 0.3 },
	};
	post.set({ bloom: { intensity: 0.1, threshold: 1 }, vignette: { intensity: 0.7 } });
	const camera = scene.createPerspectiveCamera({
		fov: 40,
		far: 500,
		position: [0, 0.4, 6.8],
		target: [0, 0, 0],
	});
	scene.setActiveCamera(camera);
	const view = interact(ctx, camera, { target: [0, 0, 0], minDistance: 4, maxDistance: 16 });

	const sphere = geometry.sphere({ radius: 0.42, widthSegments: 48, heightSegments: 24 });
	const rows = [
		{ color: '#d8d8d8', metalness: 0, y: 0.55 },
		{ color: '#e8c06a', metalness: 1, y: -0.55 },
	];
	for (const { color, metalness, y } of rows) {
		for (let k = 0; k < COLUMNS; k++) {
			scene.createMesh({
				mesh: sphere,
				material: materials.standard({ color, metalness, roughness: k / (COLUMNS - 1) }),
				position: [(k - (COLUMNS - 1) / 2) * 1.05, y, 0],
			});
		}
	}
	// The floor: dark and polished, so the environment's colors show in its reflection.
	const reflection = render.addPass({
		kind: 'reflection',
		writes: 'floor',
		plane: { point: [0, FLOOR, 0] },
	});
	scene.createMesh({
		mesh: geometry.circle({ radius: 100, segments: 96 }),
		material: materials.shader({
			wgsl: mirror,
			color: '#202226',
			roughness: 0.1,
			metalness: 0.5,
			doubleSided: true,
			textures: { floor: textures.fromPass(reflection) },
		}),
		position: [0, FLOOR, 0],
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
	});

	// One options object for the files' environments, changed in place each frame. The sky's light
	// follows the sky background, which takes no turn.
	const rotation: [number, number, number] = [0, 0, 0];
	const display = { blur: 0.1, rotation };
	const still = { intensity: 0.3 };
	return {
		onUpdate(dt) {
			rotation[1] = time.now * 0.15;
			const shown = Math.floor(time.now / STEP) % 3;
			if (shown === 2) {
				scene.setEnvironment(sky, still);
				scene.setBackground(daylight, still);
			} else {
				const environment = shown === 0 ? sunset : studio;
				scene.setEnvironment(environment, display);
				scene.setBackground(environment, display);
			}
			view.update(dt);
		},
	};
});
