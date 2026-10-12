// Relief maps: a hillside under a low golden sun, from height maps made in code. Displacement maps
// move the terrain's and the boulders' vertices, so outlines and shadows follow the relief, and the
// light follows each map's slope. A brick wall steps down the slope between piers: parallax gives
// its flat faces the depth of their bricks (a button and the P key turn it off and on), and bump
// maps give its cap stones their grain. A geodesic frame drawn as a wireframe stands on the hill and
// casts a shadow of lines. The height maps and their colors are in heights.ts, and the wall is in
// wall.ts.

import { defineSketch, type Vec3 } from '@null3d/engine';
import { icosahedron } from '@null3d/geometry';
import { interact } from '../lib/interact';
import { hillColor, hills, maps, rock, rockColor } from './heights';
import { buildWall } from './wall';

/** A point toward the sun: low over the hills to the right, where it lights the haze and rakes the wall. */
const SUN = [0.88, 0.1, -0.36] as const;
/** Each boulder's place on the ground, size, turn and cut. */
const BOULDERS = [
	[-4.4, 1.8, 0.95, 0.4, 0],
	[-2.9, 3.6, 0.6, 2.1, 1],
	[3.6, 1.6, 0.9, 4, 1],
	[0.6, 5, 0.55, 1.2, 0],
	[5.4, -1.2, 0.7, 5.3, 0],
] as const;
/** The hills' size, and the height from their lowest to their highest point, in meters. */
const [WIDE, TALL] = [60, 8];
/** The height of the hills at x and z: the plane's u runs along x, and its v against z. */
const ground = (x: number, z: number) => (hills(0.5 + x / WIDE, 0.5 - z / WIDE) - 0.5) * TALL;
export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, textures, post, quality, input, page, time } = ctx;
	const sky = {
		sky: {
			sunPosition: SUN,
			turbidity: 10,
			rayleigh: 1.2,
			mieCoefficient: 0.008,
			mieDirectionalG: 0.85,
			cloudCoverage: 0.25,
			time: 0,
		},
	};
	scene.setBackground(sky);
	scene.setEnvironment(await assets.builtinEnvironment('room'), { intensity: 0.3 });
	scene.setFog({ color: '#e0a465', density: 0.008, height: 0, heightFalloff: 0.15, sunGlow: 3 });
	post.set({ bloom: { intensity: 0.3, threshold: 1 }, ao: { radius: 0.6 }, vignette: {} });
	const target: Vec3 = [0, ground(0, -2) + 1.2, -2];
	const eye = ground(0, 12) + 4.5;
	const camera = scene.createPerspectiveCamera({
		fov: 45,
		far: 2000,
		position: [0, eye, 12],
		target,
	});
	scene.setActiveCamera(camera);
	const view = interact(ctx, camera, { target });
	scene.createDirectionalLight({
		direction: [-SUN[0], -SUN[1], -SUN[2]],
		color: '#ffa258',
		intensity: 4,
		castShadows: true,
		shadow: { distance: 50 },
	});
	scene.createAmbientLight({ color: '#93a9e0', intensity: 0.25 });

	const look = { mipmaps: true, wrap: 'repeat', anisotropy: 8 } as const;
	const solid = { castShadows: true, receiveShadows: true };
	const texture = (data: Uint8Array, colorSpace: 'linear' | 'srgb') => {
		const size = Math.sqrt(data.length / 4);
		return textures.fromData({ width: size, height: size, data, colorSpace, ...look });
	};

	// The hills' map is finer than the others, since the hills fill most of the view.
	const [hillHeights, hillColors] = maps(hills, hillColor, 512);
	scene.createMesh({
		mesh: geometry.plane({ width: WIDE, height: WIDE, widthSegments: 256, heightSegments: 256 }),
		material: materials.standard({
			map: texture(hillColors, 'srgb'),
			roughness: 0.95,
			displacementMap: texture(hillHeights, 'linear'),
			displacementScale: TALL,
			displacementBias: -TALL / 2,
		}),
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
		...solid,
	});

	// Boulders: spheres whose cut faces move their vertices and shadows, with lichen on their tops.
	// Their heights run from 0.7 to 1.4 times the sphere's radius.
	const stones = [0, 1].map((cut) => {
		const [heights, colors] = maps(rock(cut), rockColor(cut));
		return materials.standard({
			map: texture(colors, 'srgb'),
			roughness: 0.8,
			displacementMap: texture(heights, 'linear'),
			displacementScale: 0.7,
			displacementBias: -0.3,
		});
	});
	const boulder = geometry.sphere({ radius: 1, widthSegments: 160, heightSegments: 80 });
	for (const [x, z, s, turn, cut] of BOULDERS)
		scene.createMesh({
			mesh: boulder,
			material: stones[cut],
			position: [x, ground(x, z) + s * 0.25, z],
			rotation: [0, Math.sin(turn / 2), 0, Math.cos(turn / 2)],
			scale: [s, s, s],
			...solid,
		});

	buildWall(ctx, texture, ground);

	// A geodesic frame on the hill behind the wall: the edges of a split icosahedron, as a wireframe
	// of brass struts, half below the ground.
	const [fx, fz] = [3.6, -10];
	scene.createMesh({
		mesh: geometry.fromArrays(icosahedron({ radius: 2.8, detail: 3 })),
		material: materials.standard({
			color: '#e0c48a',
			metalness: 0.9,
			roughness: 0.35,
			wireframe: true,
		}),
		position: [fx, ground(fx, fz) - 0.3, fz],
		castShadows: true,
	});
	// The page's button and the P key turn parallax off and on.
	input.actions.define({ parallax: ['KeyP'] });
	page.onMessage((name, value) => {
		if (name === 'parallax') quality.set({ parallax: value === 'On' });
	});

	return {
		onUpdate(dt) {
			// The camera drifts from side to side, so the bricks' depth shows, until the user takes it.
			if (!view.userCamera) {
				const t = time.now * 0.1;
				camera.setPosition(Math.sin(t) * 3.5, eye, 12 - Math.abs(Math.sin(t)));
				camera.lookAt(target[0], target[1], target[2]);
			}
			view.update(dt);
			if (input.wasPressed('parallax')) quality.set({ parallax: !quality.settings.parallax });
			// The clouds drift with the sketch's time.
			sky.sky.time = time.now;
			scene.setBackground(sky);
		},
	};
});
