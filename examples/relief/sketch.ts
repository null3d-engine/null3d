// Relief maps: a hillside under a low golden sun, from height maps made in code. Displacement maps
// move the terrain's and the boulders' vertices, so outlines and shadows follow the relief, and the
// light follows each map's slope. A brick wall steps down the slope between piers: parallax gives
// its flat faces the depth of their bricks (a button and the P key turn it off and on), and bump
// maps give its cap stones their grain. A geodesic frame drawn as a wireframe stands on the hill and
// casts a shadow of lines. The height maps are in heights.ts.

import { defineSketch, type Material, type MeshGeometry, math, type Vec3 } from '@null3d/engine';
import { icosahedron } from '@null3d/geometry';
import { interact } from '../lib/interact';
import { bricks, brickTone, grain, hills, layers, maps, onSphere, rock } from './heights';

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
/** A brick's length and a course's height, in meters. The brick map holds 4 bricks by 8 courses. */
const [BRICK, COURSE] = [0.36, 0.15];
/** The wall: where it starts, its heading, its bays and the bays' and the piers' length along it. */
const WALL = { x: -6.4, z: -0.6, turn: 0.45, bays: 4, bay: BRICK * 6, pier: BRICK * 1.5 };
/** The heights of the bays' and the piers' boxes, in whole courses, which reach below the ground. */
const [BAY_TALL, PIER_TALL] = [COURSE * 20, COURSE * 24];

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
	const blend = (from: number[], to: number[], t: number) =>
		from.map((c, i) => math.lerp(c, to[i] ?? c, t));
	// A mottle of finer noise breaks up a color.
	const mottle = (color: number[], u: number, v: number, w: number, scale = 90) =>
		color.map((c) => c * (1 - w + 2 * w * layers(u * scale, v * scale, 3, 2)));

	// Grass in the hollows, blending into dry earth, then bare rock on the tops, on a finer map than
	// the others, since the hills fill most of the view.
	const [hillHeights, hillColors] = maps(
		hills,
		(h, u, v) =>
			mottle(
				blend(
					blend([86, 116, 52], [150, 122, 82], math.smoothstep(h, 0.4, 0.55)),
					[168, 160, 150],
					math.smoothstep(h, 0.7, 0.85),
				),
				u,
				v,
				0.2,
				160,
			),
		512,
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

	// Boulders: spheres whose cut faces move their vertices and shadows, with lichen on their tops.
	// Their heights run from 0.7 to 1.4 times the sphere's radius.
	const stones = [0, 1].map((cut) => {
		const [heights, colors] = maps(rock(cut), (_h, u, v) => {
			const up = onSphere(u, v)[1] + (layers(u * 24, v * 12, cut, 3) - 0.5) * 0.8;
			return blend(
				mottle([128, 122, 114], u, v, 0.25, 40),
				[150, 150, 88],
				math.smoothstep(up, 0.4, 0.6),
			);
		});
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

	// The wall: bays of brick between brick piers, each bay's top on a whole course above the highest
	// ground under it, so the wall steps down the slope. Its faces are flat boxes, and parallax gives
	// them the depth of their bricks.
	const [brickHeights, brickColors] = maps(bricks, (h, u, v) => {
		const tone = brickTone(u, v);
		const fired = blend([118, 44, 32], [182, 96, 64], tone);
		const color = tone < 0.12 ? [72, 34, 30] : fired;
		return h > 0.04 ? mottle(color, u, v, 0.12, 64) : [158, 148, 130];
	});
	const relief = {
		map: texture(brickColors, 'srgb'),
		displacementMap: texture(brickHeights, 'linear'),
	};
	// Each material repeats the bricks so that they keep their size on its boxes.
	const brickwork = (width: number, tall: number) =>
		materials.standard({
			...relief,
			roughness: 0.85,
			displacementScale: 0.04,
			parallax: true,
			uvTransform: { repeat: [width / (BRICK * 4), tall / (COURSE * 8)] },
		});
	// Cap stones of pale sandstone, whose grain is a bump map.
	const [grainHeights, grainColors] = maps(grain, (h, u, v) =>
		mottle(blend([170, 150, 118], [214, 198, 166], h), u, v, 0.08, 30),
	);
	const sandstone = materials.standard({
		map: texture(grainColors, 'srgb'),
		roughness: 0.9,
		bumpMap: texture(grainHeights, 'linear'),
		bumpScale: 3,
	});

	const { x: x0, z: z0, turn, bays, bay, pier } = WALL;
	const facing = [0, Math.sin(turn / 2), 0, Math.cos(turn / 2)] as const;
	// The point on the ground plan at a distance along the wall's line, and where each bay starts.
	const onWall = (at: number) => [x0 + Math.cos(turn) * at, z0 - Math.sin(turn) * at] as const;
	const start = (k: number) => pier + k * (bay + pier);
	// Puts a box of the wall at a distance along the wall's line, with its top at a height.
	const place = (box: MeshGeometry, material: Material, at: number, top: number, tall: number) => {
		const [x, z] = onWall(at);
		scene.createMesh({
			mesh: box,
			material,
			position: [x, top - tall / 2, z],
			rotation: facing,
			...solid,
		});
	};
	// The highest ground under a bay, from points along it.
	const highest = (k: number) => {
		let top = -Infinity;
		for (let i = 0; i <= 8; i++) top = Math.max(top, ground(...onWall(start(k) + (bay * i) / 8)));
		return top;
	};
	const bayBox = geometry.box({ width: bay, height: BAY_TALL, depth: 0.3 });
	const pierBox = geometry.box({ width: pier, height: PIER_TALL, depth: pier });
	const capStone = geometry.box({ width: bay / 4 - 0.012, height: 0.09, depth: 0.42 });
	const pierCap = geometry.box({ width: pier + 0.14, height: 0.12, depth: pier + 0.14 });
	const [bayBricks, pierBricks] = [brickwork(bay, BAY_TALL), brickwork(pier, PIER_TALL)];
	const tops = Array.from(
		{ length: bays },
		(_, k) => Math.ceil((highest(k) + 1.3) / COURSE) * COURSE,
	);
	tops.forEach((top, k) => {
		place(bayBox, bayBricks, start(k) + bay / 2, top, BAY_TALL);
		for (let i = 0; i < 4; i++)
			place(capStone, sandstone, start(k) + (bay / 4) * (i + 0.5), top + 0.09, 0.09);
	});
	for (let k = 0; k <= bays; k++) {
		const top = Math.max(tops[k - 1] ?? -Infinity, tops[k] ?? -Infinity) + COURSE * 2;
		place(pierBox, pierBricks, start(k) - pier / 2, top, PIER_TALL);
		place(pierCap, sandstone, start(k) - pier / 2, top + 0.12, 0.12);
	}

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
