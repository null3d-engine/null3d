// The look-at demo's scenery: a castle courtyard at dusk. Flagstones of many shades cover the
// yard. Sandstone walls with battlements close it on three sides, with round towers at the back
// corners, a great door between two pillars, and red banners. Torches on the walls flicker and
// light the stone, and barrels and crates stand by the walls. The front lies open over a low
// parapet, so the camera sees the whole yard from above it.
import { color, type PointLight, quat, type SketchContext } from '@null3d/engine';

/** Half the yard's width, in meters, to the inner faces of its walls. */
const HALF = 8;
const WALL = { height: 5, thickness: 0.8 } as const;
/** The torches' places on the walls' inner faces: x, y and z of each. */
const TORCHES = [
	[-2.6, 2.7, -HALF + 0.25],
	[2.6, 2.7, -HALF + 0.25],
	[-HALF + 0.25, 2.7, -2.5],
	[HALF - 0.25, 2.7, -2.5],
	[-HALF + 0.25, 2.7, 3.5],
	[HALF - 0.25, 2.7, 3.5],
] as const;
/** Barrels and crates: x, z and kind (0 a barrel, 1 a crate, 2 two crates stacked) of each. */
const PROPS = [
	[-6.6, -6.5, 0],
	[-5.8, -6.8, 0],
	[-6.9, -5.6, 1],
	[6.5, -6.4, 2],
	[5.6, -6.7, 0],
	[6.8, 1.2, 0],
	[6.7, 2.1, 1],
	[-6.7, 5.6, 0],
] as const;

type Part = Parameters<SketchContext['scene']['createMesh']>[0];

/**
 * Makes the courtyard and returns its torches' lights, whose intensity `flicker` changes each
 * frame.
 */
export function courtyard(ctx: SketchContext): PointLight[] {
	const { scene, geometry, materials } = ctx;
	const solid = { castShadows: true, receiveShadows: true };
	const part = (options: Part) => scene.createMesh({ ...solid, ...options });
	const sandstone = materials.standard({ color: '#a8977c', roughness: 0.9 });
	const darkStone = materials.standard({ color: '#7a6e5c', roughness: 0.92 });
	const slate = materials.standard({ color: '#3b4250', roughness: 0.7 });
	const wood = materials.standard({ color: '#5b3a22', roughness: 0.8 });
	const iron = materials.standard({ color: '#2a2a2e', metalness: 1, roughness: 0.5 });
	const box = geometry.box();

	// The flagstones: one batch of slabs, each a little apart from its neighbours, in many shades.
	const across = HALF * 2;
	const stones = scene.createInstances(box, across * across, {
		material: materials.standard({ color: '#ffffff', roughness: 0.88 }),
		colors: true,
		receiveShadows: true,
	});
	const shade = new Float32Array(3);
	const { positions, scales } = stones;
	const colors = stones.colors as Float32Array;
	for (let k = 0; k < across * across; k++) {
		const [i, j] = [k % across, Math.floor(k / across)];
		positions.set([i - HALF + 0.5, 0, j - HALF + 0.5], k * 3);
		scales.set([0.94 - 0.05 * wave(k, 1.3), 0.1, 0.94 - 0.05 * wave(k, 2.9)], k * 3);
		color.fromHex(shade, k % 7 === 0 ? '#8a7c68' : k % 3 === 0 ? '#a69a86' : '#968a76');
		const tone = 0.85 + 0.15 * wave(k, 4.1);
		colors.set([shade[0] * tone, shade[1] * tone, shade[2] * tone], k * 4);
	}
	stones.markDirty();

	// The walls: back, left and right, each on a plinth, with a ledge and battlements on top.
	const span = across + WALL.thickness * 2;
	const walls = [
		{ at: [0, -HALF - WALL.thickness / 2], size: [span, WALL.thickness] },
		{ at: [-HALF - WALL.thickness / 2, 0], size: [WALL.thickness, span] },
		{ at: [HALF + WALL.thickness / 2, 0], size: [WALL.thickness, span] },
	] as const;
	for (const { at, size } of walls) {
		const [x, z] = at;
		const [w, d] = size;
		part({
			mesh: box,
			material: sandstone,
			position: [x, WALL.height / 2, z],
			scale: [w, WALL.height, d],
		});
		part({ mesh: box, material: darkStone, position: [x, 0.3, z], scale: [w + 0.3, 0.6, d + 0.3] });
		part({
			mesh: box,
			material: darkStone,
			position: [x, 3.6, z],
			scale: [w + 0.16, 0.14, d + 0.16],
		});
		const long = Math.max(w, d);
		for (let m = 0; m * 1.2 < long - 0.6; m++) {
			const along = -long / 2 + 0.45 + m * 1.2;
			const [mx, mz] = w > d ? [x + along, z] : [x, z + along];
			const merlon: [number, number, number] = w > d ? [0.7, 0.7, d] : [w, 0.7, 0.7];
			part({
				mesh: box,
				material: sandstone,
				position: [mx, WALL.height + 0.35, mz],
				scale: merlon,
			});
		}
	}
	// Buttresses along the side walls.
	for (const side of [-1, 1])
		for (const z of [-4, 0.5, 5])
			part({
				mesh: box,
				material: darkStone,
				position: [side * (HALF - 0.2), 1.6, z],
				scale: [0.4, 3.2, 0.7],
			});

	// The round towers at the back corners, with slate roofs.
	const tower = geometry.cylinder({
		radiusTop: 1.5,
		radiusBottom: 1.7,
		height: 7.5,
		radialSegments: 24,
	});
	const roof = geometry.cone({ radius: 1.95, height: 2.8, radialSegments: 24 });
	for (const side of [-1, 1]) {
		const [x, z] = [side * (HALF + 0.4), -HALF - 0.4];
		part({ mesh: tower, material: sandstone, position: [x, 3.75, z] });
		part({ mesh: box, material: darkStone, position: [x, 7.4, z], scale: [3.5, 0.3, 3.5] });
		part({ mesh: roof, material: slate, position: [x, 8.95, z] });
	}

	// The great door in the back wall, between two pillars under a lintel, with iron bands.
	const doorZ = -HALF + 0.05;
	part({ mesh: box, material: wood, position: [0, 1.9, doorZ], scale: [2.4, 3.8, 0.2] });
	for (const y of [0.9, 2.9])
		part({ mesh: box, material: iron, position: [0, y, doorZ + 0.12], scale: [2.3, 0.12, 0.04] });
	for (const side of [-1, 1])
		part({
			mesh: box,
			material: darkStone,
			position: [side * 1.5, 2.1, doorZ + 0.2],
			scale: [0.6, 4.2, 0.6],
		});
	part({ mesh: box, material: darkStone, position: [0, 4.4, doorZ + 0.2], scale: [3.8, 0.5, 0.7] });

	// Banners on the back wall: red cloth with a gold band and a gold cross.
	const red = materials.standard({ color: '#7d1620', roughness: 0.85 });
	const gold = materials.standard({ color: '#c8962e', metalness: 0.6, roughness: 0.45 });
	for (const x of [-5.2, 5.2]) {
		const z = -HALF + 0.03;
		part({
			mesh: box,
			material: red,
			position: [x, 2.6, z],
			scale: [1.1, 2.4, 0.04],
			castShadows: false,
		});
		part({ mesh: box, material: gold, position: [x, 3.75, z + 0.02], scale: [1.2, 0.1, 0.05] });
		part({ mesh: box, material: gold, position: [x, 2.75, z + 0.03], scale: [0.12, 1.2, 0.02] });
		part({ mesh: box, material: gold, position: [x, 2.95, z + 0.03], scale: [0.7, 0.12, 0.02] });
	}

	// A low parapet across the open front, broken in the middle.
	for (const side of [-1, 1])
		part({
			mesh: box,
			material: darkStone,
			position: [side * 4.6, 0.45, HALF + 0.3],
			scale: [6.8, 0.9, 0.6],
		});

	// Barrels with iron hoops, and crates.
	const barrel = geometry.cylinder({
		radiusTop: 0.32,
		radiusBottom: 0.32,
		height: 0.9,
		radialSegments: 16,
	});
	const hoop = geometry.torus({
		radius: 0.33,
		tube: 0.025,
		radialSegments: 6,
		tubularSegments: 24,
	});
	const flat = quat.fromEuler(quat.create(), Math.PI / 2, 0, 0, 'XYZ');
	for (const [x, z, kind] of PROPS) {
		if (kind === 0) {
			part({ mesh: barrel, material: wood, position: [x, 0.5, z] });
			for (const y of [0.25, 0.75])
				part({
					mesh: hoop,
					material: iron,
					position: [x, y + 0.05, z],
					rotation: flat,
					castShadows: false,
				});
			continue;
		}
		for (let level = 0; level < kind; level++) {
			const turn = quat.fromEuler(quat.create(), 0, 0.3 * level + x, 0, 'XYZ');
			part({
				mesh: box,
				material: wood,
				position: [x, 0.45 + level * 0.8, z],
				rotation: turn,
				scale: [0.8, 0.8, 0.8],
			});
		}
	}

	// The torches: an iron bracket, a flame that blooms, and a warm light on the wall around it.
	const flame = materials.standard({
		color: '#000000',
		emissive: '#ff8a2a',
		emissiveIntensity: 25,
	});
	const tongue = geometry.cone({ radius: 0.08, height: 0.26, radialSegments: 8 });
	const lights: PointLight[] = [];
	for (const [x, y, z] of TORCHES) {
		const out: [number, number] =
			Math.abs(z) > Math.abs(x) ? [0, Math.sign(-z)] : [Math.sign(-x), 0];
		const [ox, oz] = [x + out[0] * 0.18, z + out[1] * 0.18];
		part({
			mesh: box,
			material: iron,
			position: [ox, y - 0.2, oz],
			scale: [0.08, 0.45, 0.08],
			castShadows: false,
		});
		part({ mesh: tongue, material: flame, position: [ox, y + 0.12, oz], castShadows: false });
		lights.push(
			scene.createPointLight({
				position: [ox + out[0] * 0.2, y + 0.3, oz + out[1] * 0.2],
				color: '#ff9a40',
				range: 7,
			}),
		);
	}
	return lights;
}

/** Sets each torch's intensity for time `t`, in seconds: a flicker that time alone sets. */
export function flicker(lights: readonly PointLight[], t: number): void {
	for (let k = 0; k < lights.length; k++)
		(lights[k] as PointLight).setIntensity(
			5 + Math.sin(t * 13 + k * 2) * 0.9 + Math.sin(t * 7.3 + k) * 0.6,
		);
}

/** A repeatable number from 0 to 1 for row `k`, which varies the slabs without a seed. */
function wave(k: number, rate: number): number {
	return 0.5 + 0.5 * Math.sin(k * rate + Math.cos(k * 0.7 * rate));
}
