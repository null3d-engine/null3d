// A glTF model: the Khronos BoomBox, with its base color, normal, occlusion, roughness, metalness and
// emissive maps, on a turntable in a dark studio. assets.loadGltf reads the file into a prefab, and
// scene.instantiate places a copy of it in one batch of changes. The prefab's bounds scale the 2 cm
// model up to a size the camera frames. A soft key light from above casts its shadow, and the
// built-in room environment gives its reflections, as three.js's glTF viewer examples light their
// models. The turntable's polished top mirrors the model through a reflection pass. The neutral
// tone curve keeps the model's colors true, as product viewers do, and depth of field blurs the
// floor beyond the model. The turntable turns by the sketch's time.
import { defineSketch } from '@null3d/engine';
import { interact } from '../lib/interact';
import { sampleUrl } from '../lib/samples';

/** The model's radius after scaling, in meters, and the height of the turntable's top. */
const RADIUS = 1;
const TOP = 0.12;

// The turntable's top: the reflection pass's picture, lit as the surface's reflection.
const mirror = /* wgsl */ `
#import null3d::reflection::{reflection_uv}

var top: texture_2d<f32>;

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let clip = camera.viewProjection * vec4f(input.relativePosition, 1.0);
    let uv = reflection_uv(clip, vec2f(0.0));
    s.reflection = vec4f(textureSampleLevel(top, topSampler, uv, 0.0).rgb, 1.0);
    return s;
}
`;

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, textures, render, post, time } = ctx;
	scene.setBackground('#15171b');
	scene.setFog({ color: '#15171b', density: 0.12 });
	post.set({
		toneMapping: 'neutral',
		bloom: { intensity: 0.15, threshold: 1 },
		ao: { radius: 0.2 },
		vignette: { intensity: 0.8 },
	});
	const [room, boombox] = await Promise.all([
		assets.builtinEnvironment('room'),
		assets.loadGltf(sampleUrl('sources/khronos/BoomBox/glTF-Binary/BoomBox.glb')),
	]);
	scene.setEnvironment(room);
	scene.createDirectionalLight({
		direction: [0.5, -1, -0.6],
		color: '#fff1e0',
		intensity: 2.5,
		castShadows: true,
		shadow: { distance: 12 },
	});
	scene.createMesh({
		mesh: geometry.circle({ radius: 40, segments: 64 }),
		material: materials.standard({ color: '#202226', roughness: 0.7, doubleSided: true }),
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
		receiveShadows: true,
	});

	// The turntable: a dark metal drum with a polished black top, which carries the model. The
	// model stands on it, scaled about its center. The top shows none of itself in its reflection.
	const table = scene.createGroup({ dynamic: true });
	const solid = { parent: table, castShadows: true, receiveShadows: true };
	scene.createMesh({
		mesh: geometry.cylinder({
			radiusTop: 1.3,
			radiusBottom: 1.35,
			height: TOP,
			radialSegments: 96,
		}),
		material: materials.standard({ color: '#1b1c1f', roughness: 0.35, metalness: 0.6 }),
		position: [0, TOP / 2, 0],
		...solid,
	});
	const reflection = render.addPass({
		kind: 'reflection',
		writes: 'top',
		plane: { point: [0, TOP, 0] },
	});
	const polished = { color: '#0c0d10', roughness: 0.1, metalness: 0.5 };
	scene.createMesh({
		mesh: geometry.circle({ radius: 1.24, segments: 96 }),
		material: materials.shader({
			wgsl: mirror,
			...polished,
			textures: { top: textures.fromPass(reflection) },
		}),
		position: [0, TOP + 0.002, 0],
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
		...solid,
	});
	const { center, radius, min } = boombox.bounds;
	const size = RADIUS / radius;
	const lift = TOP + (center[1] - min[1]) * size;
	// The lens focuses on the model's center, so the floor beyond it blurs.
	post.set({ dof: { aperture: 1.4, focusPoint: [0, lift, 0] } });
	scene.instantiate(boombox, {
		...solid,
		position: [-center[0] * size, TOP - min[1] * size, -center[2] * size],
		scale: [size, size, size],
	});

	const camera = scene.createPerspectiveCamera({
		fov: 40,
		near: 0.05,
		far: 100,
		position: [2.1, lift + 0.9, 3],
		target: [0, lift, 0],
	});
	scene.setActiveCamera(camera);
	const view = interact(ctx, camera, { target: [0, lift, 0], minDistance: 1.2, maxDistance: 8 });
	return {
		onUpdate(dt) {
			table.setRotationEuler(0, time.now * 0.4, 0);
			view.update(dt);
		},
	};
});
