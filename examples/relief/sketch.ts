// Relief maps: a hillside at sundown from height maps made in code. Displacement maps move the
// terrain's and the boulders' vertices, so outlines and shadows follow the relief, and the light
// follows each map's slope. Parallax gives the bricks of a wall of four flat quads their depth (P
// turns it off and on). A wireframe beacon floats over the hills and casts a shadow of lines.
// The height maps are in heights.ts.
import { defineSketch, math, type Vec3, vec3 } from '@null3d/engine';
import { interact } from '../lib/interact';
import { bricks, hills, layers, maps, rock, SIZE } from './heights';

/** A point toward the sun: low, and to the right, so its light rakes across the wall. */
const SUN = [0.9, 0.22, -0.15] as const;
/** Each boulder's place on the ground and size. */
const BOULDERS = [
	[-4.5, 1, 1.2],
	[-2.8, 2.6, 0.7],
	[4.2, 0.5, 1],
	[1.6, 3.2, 0.65],
] as const;
/** The hills' size, and the height from their lowest to their highest point, in meters. */
const [WIDE, TALL] = [60, 8];
/** The height of the hills at x and z: the plane's u runs along x, and its v against z. */
const ground = (x: number, z: number) => (hills(0.5 + x / WIDE, 0.5 - z / WIDE) - 0.5) * TALL;

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, textures, post, quality, input, time } = ctx;
	scene.setBackground({ sky: { sunPosition: SUN, turbidity: 6, rayleigh: 2.5, time: 0 } });
	scene.setEnvironment(await assets.builtinEnvironment('room'), { intensity: 0.35 });
	scene.setFog({ color: '#c9a99a', density: 0.007, height: 0, heightFalloff: 0.15, sunGlow: 2 });
	post.set({ bloom: { intensity: 0.25, threshold: 1 }, ao: { radius: 0.6 }, vignette: {} });
	const floor = ground(0, -2) + 1.5;
	const target: Vec3 = [0, floor, -2];
	const camera = scene.createPerspectiveCamera({
		fov: 45,
		far: 2000,
		position: [0, ground(0, 12) + 5, 12],
		target,
	});
	scene.setActiveCamera(camera);
	const view = interact(ctx, camera, { target, groundY: floor });
	scene.createDirectionalLight({
		direction: [-SUN[0], -SUN[1], -SUN[2]],
		color: '#ffb47a',
		intensity: 3.5,
		castShadows: true,
		shadow: { distance: 50 },
	});
	scene.createAmbientLight({ color: '#9db4ff', intensity: 0.25 });

	const look = { mipmaps: true, wrap: 'repeat', anisotropy: 8 } as const;
	const solid = { castShadows: true, receiveShadows: true };
	const texture = (data: Uint8Array, colorSpace: 'linear' | 'srgb') =>
		textures.fromData({ width: SIZE, height: SIZE, data, colorSpace, ...look });
	// Grass in the hollows, blending into dry earth, then bare rock on the tops.
	const blend = (from: number[], to: number[], t: number) =>
		from.map((c, i) => math.lerp(c, to[i] ?? c, t));
	// A mottle of finer noise breaks up each color.
	const [hillHeights, hillColors] = maps(hills, (h, u, v) =>
		blend(
			blend([86, 116, 52], [150, 122, 82], math.smoothstep(h, 0.4, 0.55)),
			[168, 160, 150],
			math.smoothstep(h, 0.7, 0.85),
		).map((c) => c * (0.8 + 0.4 * layers(u * 90, v * 90, 3, 2))),
	);
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

	// Boulders: spheres whose rock moves their vertices and shadows: dark in the cracks, lichen on top.
	const [rockHeights, rockColors] = maps(rock, (h) =>
		blend(
			blend([58, 54, 50], [150, 142, 130], math.smoothstep(h, 0.2, 0.6)),
			[150, 146, 92],
			math.smoothstep(h, 0.8, 0.95),
		),
	);
	const stone = materials.standard({
		map: texture(rockColors, 'srgb'),
		roughness: 0.85,
		displacementMap: texture(rockHeights, 'linear'),
		displacementScale: 0.6,
		displacementBias: -0.3,
	});
	const boulder = geometry.sphere({ radius: 0.9, widthSegments: 128, heightSegments: 64 });
	for (const [x, z, s] of BOULDERS)
		scene.createMesh({
			mesh: boulder,
			material: stone,
			position: [x, ground(x, z) + s * 0.3, z],
			scale: [s, s * 0.8, s],
			...solid,
		});

	// The old wall: four quads of two triangles each, at an angle to the camera, whose bricks stand
	// out by parallax.
	const [brickHeights, brickColors] = maps(bricks, (h) =>
		h > 0.04 ? blend([92, 36, 28], [178, 96, 66], math.smoothstep(h, 0.6, 1)) : [150, 142, 128],
	);
	const wall = materials.standard({
		map: texture(brickColors, 'srgb'),
		roughness: 0.8,
		displacementMap: texture(brickHeights, 'linear'),
		displacementScale: 0.12,
		parallax: true,
		uvTransform: { repeat: [2, 1.8] },
	});
	// Each quad reaches below the ground under its middle, and each is lower than the one before.
	const turn = 0.45;
	for (let k = 0; k < 4; k++) {
		const [x, z] = [-3.6 + k * 2.4 * Math.cos(turn), -1 - k * 2.4 * Math.sin(turn)];
		scene.createMesh({
			mesh: geometry.plane({ width: 2.4, height: 4.4 - k * 0.3 }),
			material: wall,
			position: [x, ground(x, z) + 0.9 - k * 0.15, z],
			rotation: [0, Math.sin(turn / 2), 0, Math.cos(turn / 2)],
			...solid,
		});
	}

	// The beacon: a glowing wireframe that floats over the hills, toward the pointer.
	const beacon = scene.createMesh({
		mesh: geometry.sphere({ radius: 0.6, widthSegments: 12, heightSegments: 8 }),
		material: materials.unlit({ color: '#7ff0ff', wireframe: true }),
		dynamic: true,
		castShadows: true,
	});
	input.actions.define({ parallax: ['KeyP'] });
	const place: Vec3 = [0, 0, 0];

	return {
		onUpdate(dt) {
			view.update(dt);
			if (input.wasPressed('parallax')) quality.set({ parallax: !quality.settings.parallax });
			const t = time.now;
			view.steer(vec3.set(place, Math.sin(t * 0.3) * 3, floor, 1.5 + Math.cos(t * 0.4)));
			beacon.setPosition(place[0], floor + 1.5 + Math.sin(t * 1.3) * 0.3, place[2]);
			beacon.setRotationEuler(t * 0.4, t * 0.7, 0);
		},
	};
});
