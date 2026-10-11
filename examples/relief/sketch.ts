// Relief maps: a hillside at sundown from height maps made in code. Displacement maps move the
// terrain's and the boulders' vertices, so outlines and shadows follow the relief, and the light
// follows each map's slope. Parallax gives the bricks of a wall of four flat quads their depth (P
// turns it off and on). A wireframe beacon floats over the hills and casts a shadow of lines.
import { defineSketch, math, type Vec3, vec3 } from '@null3d/engine';
import { interact } from '../lib/interact';

/** A point toward the sun: low, and to the camera's left. */
const SUN = [-0.75, 0.22, -0.62] as const;
/** Texels along each side of the height maps. */
const SIZE = 256;
/** Each boulder's place and size. */
const BOULDERS = [
	[-4.5, 1.4, 1, 1.2],
	[-2.8, 1.1, 2.6, 0.7],
	[4.2, 1.5, 0.5, 1],
] as const;

/** A height map from `height` at u and v, as linear gray texels, with the colors that `paint` gives. */
function maps(height: (u: number, v: number) => number, paint = (_: number): number[] => []) {
	const gray = new Uint8Array(SIZE * SIZE * 4).fill(255);
	const color = new Uint8Array(SIZE * SIZE * 4).fill(255);
	for (let y = 0; y < SIZE; y++)
		for (let x = 0; x < SIZE; x++) {
			const h = height((x + 0.5) / SIZE, (y + 0.5) / SIZE);
			const at = (y * SIZE + x) * 4;
			gray.fill(h * 255, at, at + 3);
			color.set(paint(h), at);
		}
	return [gray, color] as const;
}

/** Waves along `n` directions, each finer and fainter than the one before: rolling relief from 0 to 1. */
const waves = (u: number, v: number, n: number, seed: number) => {
	let sum = 0.5;
	for (let k = 0; k < n; k++) {
		const a = seed + k * 2.4;
		sum += (Math.sin((u * Math.cos(a) + v * Math.sin(a)) * 2 ** k * 6.28 + k) * 0.3) / 1.8 ** k;
	}
	return math.clamp(sum, 0, 1);
};

/** Bricks of 4 by 8 to the map, in running bond: bevelled tops at 1 and sunken mortar at 0. */
const bricks = (u: number, v: number) => {
	const row = Math.floor(v * 8);
	const [x, y] = [(u * 4 + (row % 2) * 0.5) % 1, v * 8 - row];
	const edge = Math.min(x * 4, (1 - x) * 4, y * 2, (1 - y) * 2) * 3 - 0.2;
	return math.clamp(edge, 0, 1) * (0.92 + 0.08 * Math.sin(u * 90 + row * 7));
};

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, textures, post, quality, input, time } = ctx;
	scene.setBackground({ sky: { sunPosition: SUN, turbidity: 6, rayleigh: 2.5, time: 0 } });
	scene.setEnvironment(await assets.builtinEnvironment('room'), { intensity: 0.35 });
	scene.setFog({ color: '#c9a99a', density: 0.012, height: 0, heightFalloff: 0.15, sunGlow: 2 });
	post.set({ bloom: { intensity: 0.25, threshold: 1 }, ao: { radius: 0.6 }, vignette: {} });
	const camera = scene.createPerspectiveCamera({ fov: 45, far: 2000, position: [0, 4.5, 12] });
	scene.setActiveCamera(camera);
	const view = interact(ctx, camera, { target: [0, 1.5, 0], groundY: 1.5 });
	scene.createDirectionalLight({
		direction: [-SUN[0], -SUN[1], -SUN[2]],
		color: '#ffc08a',
		intensity: 3.2,
		castShadows: true,
		shadow: { distance: 50 },
	});
	scene.createAmbientLight({ color: '#9db4ff', intensity: 0.25 });

	const look = { mipmaps: true, wrap: 'repeat', anisotropy: 8 } as const;
	const solid = { castShadows: true, receiveShadows: true };
	const texture = (data: Uint8Array, colorSpace: 'linear' | 'srgb') =>
		textures.fromData({ width: SIZE, height: SIZE, data, colorSpace, ...look });
	// Grass in the hollows, then dry earth, then bare rock on the tops.
	const [hillHeights, hillColors] = maps(
		(u, v) => waves(u, v, 6, 0.7),
		(h) => (h < 0.45 ? [92, 118, 58] : h < 0.62 ? [150, 122, 82] : [168, 160, 150]),
	);
	scene.createMesh({
		mesh: geometry.plane({ width: 60, height: 60, widthSegments: 256, heightSegments: 256 }),
		material: materials.standard({
			map: texture(hillColors, 'srgb'),
			displacementMap: texture(hillHeights, 'linear'),
			displacementScale: 7,
			displacementBias: -3.5,
		}),
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
		...solid,
	});

	// Boulders: spheres whose lumps move their vertices and shadows.
	const [lumps] = maps((u, v) => waves(2 * u, v, 5, 2));
	const stone = materials.standard({
		color: '#a49a8e',
		roughness: 0.85,
		displacementMap: texture(lumps, 'linear'),
		displacementScale: 0.5,
		displacementBias: -0.25,
	});
	const boulder = geometry.sphere({ radius: 0.9, widthSegments: 128, heightSegments: 64 });
	for (const [x, y, z, s] of BOULDERS)
		scene.createMesh({
			mesh: boulder,
			material: stone,
			position: [x, y, z],
			scale: [s, s * 0.8, s],
			...solid,
		});

	// The old wall: four quads of two triangles each, whose bricks stand out by parallax.
	const [brickHeights, brickColors] = maps(bricks, (h) =>
		h > 0.05 ? [150 + h * 30, 66, 46] : [128, 120, 110],
	);
	const wall = materials.standard({
		map: texture(brickColors, 'srgb'),
		roughness: 0.8,
		displacementMap: texture(brickHeights, 'linear'),
		displacementScale: 0.12,
		parallax: true,
		uvTransform: { repeat: [2, 1] },
	});
	for (let k = 0; k < 4; k++)
		scene.createMesh({
			mesh: geometry.plane({ width: 2.4, height: 2.2 - k * 0.35 }),
			material: wall,
			position: [-1.8 + k * 2.4, 2.4 - k * 0.18, -2.5],
			...solid,
		});

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
			view.steer(vec3.set(place, Math.sin(t * 0.3) * 3, 1.5, 1.5 + Math.cos(t * 0.4)));
			beacon.setPosition(place[0], 3 + Math.sin(t * 1.3) * 0.3, place[2]);
			beacon.setRotationEuler(t * 0.4, t * 0.7, 0);
		},
	};
});
