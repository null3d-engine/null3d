// The street that the decals demo marks: an asphalt road between two pavements and two rows of
// houses with doors, dark shop windows under glowing signs, framed windows and ledges, with warm
// street lamps. Every texture is made in code. The road and the pavements are one group, which the
// demo's clicks land on.
import { type Group, type Material, math, type SketchContext, type Vec3 } from '@null3d/engine';

/** The road's half width, the street's length, and the pavements' width and height. */
export const ROAD = 4;
export const LENGTH = 60;
export const PAVEMENT = 3;
export const KERB = 0.15;
/** Where the lamps stand, along the street and on alternate sides. */
export const LAMPS: readonly Vec3[] = [-18, -6, 6, 18].map(
	(z, k): Vec3 => [(k % 2 ? 1 : -1) * (ROAD + 0.6), 3.2, z],
);

/** The frame of a shop window: its head, sill, sides, two mullions and a transom, as rows of the
 * height, the offset along the street, the bar's height and its width. */
const SHOP_FRAME: readonly [number, number, number, number][] = [
	[2.12, 0, 0.08, 3.18],
	[0.6, 0, 0.1, 3.18],
	[1.35, -1.55, 1.6, 0.08],
	[1.35, 1.55, 1.6, 0.08],
	[1.35, -0.52, 1.6, 0.05],
	[1.35, 0.52, 1.6, 0.05],
	[1.82, 0, 0.05, 3.1],
];

/** A house front that the demo marks. */
export interface House {
	/** -1 for the houses on the street's left side, 1 for the right. */
	side: number;
	/** The x of the front's wall. */
	face: number;
	/** The middle of the front along the street. */
	z: number;
	height: number;
	/** The heights of the middles of the upper windows, one for each floor. */
	floors: number[];
}

/** Texels of grey grit for `size` on a side: asphalt or paving, as shades from `low` to `high`. */
function grit(size: number, low: number, high: number, joints = 0): Uint8Array {
	const data = new Uint8Array(size * size * 4).fill(255);
	for (let y = 0; y < size; y++)
		for (let x = 0; x < size; x++) {
			const joint = joints > 0 && (x % joints === 0 || y % joints === 0);
			const shade = joint ? low * 0.6 : math.randFloat(low, high);
			data.fill(shade * 255, (y * size + x) * 4, (y * size + x) * 4 + 3);
		}
	return data;
}

/**
 * Builds the street: its group of road and pavements, the houses and the lamps. Returns the group
 * that clicks land on, and the house fronts.
 */
export function buildStreet({ scene, geometry, materials, textures }: SketchContext): {
	ground: Group;
	houses: House[];
} {
	math.seed(7);
	const tiled = { colorSpace: 'srgb', wrap: 'repeat', mipmaps: true, anisotropy: 16 } as const;
	const asphalt = textures.fromData({
		width: 128,
		height: 128,
		data: grit(128, 0.2, 0.38),
		...tiled,
	});
	const paving = textures.fromData({
		width: 64,
		height: 64,
		data: grit(64, 0.45, 0.6, 16),
		...tiled,
	});
	const ground = scene.createGroup();
	const flat: [number, number, number, number] = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2];
	scene.createMesh({
		mesh: geometry.plane({ width: ROAD * 2, height: LENGTH }),
		material: materials.standard({
			map: asphalt,
			color: '#9a9aa2',
			roughness: 0.85,
			uvTransform: { repeat: [ROAD / 2, LENGTH / 4] },
		}),
		rotation: flat,
		parent: ground,
		receiveShadows: true,
	});
	// The houses' fronts: boxes in batches, one per material, each row placed and sized.
	const fronts = new Map<Material, number[]>();
	const add = (material: Material, position: Vec3, size: Vec3) => {
		const rows = fronts.get(material) ?? [];
		fronts.set(material, rows);
		rows.push(...position, ...size);
	};
	const stone = materials.standard({ color: '#d6c8b2', roughness: 0.8 });
	const door = materials.standard({ color: '#4a2e1c', roughness: 0.55 });
	// Dark glass that mirrors the sky, some panes with a dim room behind them.
	const glass = { color: '#0b0e13', roughness: 0.05, envIntensity: 0.5 } as const;
	const dark = materials.standard(glass);
	const lit = materials.standard({ ...glass, emissive: '#ffb066', emissiveIntensity: 0.25 });
	const shop = materials.standard({
		...glass,
		envIntensity: 0.35,
		emissive: '#ffb070',
		emissiveIntensity: 0.03,
	});
	const frame = materials.standard({ color: '#2b2722', roughness: 0.5 });
	const trim = materials.standard({ color: '#ece6da', roughness: 0.6 });
	const houses: House[] = [];
	const signs = ['#ff5a3c', '#3cc8ff', '#ffd23c', '#7dff8a'].map((glow) =>
		materials.standard({ color: '#101010', emissive: glow, emissiveIntensity: 1.3 }),
	);
	for (const side of [-1, 1]) {
		scene.createMesh({
			mesh: geometry.box({ width: PAVEMENT, height: KERB, depth: LENGTH }),
			material: materials.standard({
				map: paving,
				color: '#c8beb0',
				roughness: 0.8,
				uvTransform: { repeat: [PAVEMENT / 1.5, LENGTH / 1.5] },
			}),
			position: [side * (ROAD + PAVEMENT / 2), KERB / 2, 0],
			parent: ground,
			receiveShadows: true,
			castShadows: true,
		});
		// A row of houses behind each pavement, each its own height and color, with a door, a lit
		// shop window under a glowing sign, framed windows above, and ledges between the floors.
		const face = side * (ROAD + PAVEMENT);
		/** The x of a part `depth` thick that stands out from the house front toward the road. */
		const out = (depth: number) => face - (side * depth) / 2;
		for (let z = -LENGTH / 2 + 4, k = 0; z < LENGTH / 2; z += 8, k++) {
			const height = math.randFloat(6, 12);
			const tint = math.randFloat(0.55, 0.9);
			scene.createMesh({
				mesh: geometry.box({ width: 4, height, depth: 7.6 }),
				material: materials.standard({
					color: [0.8 * tint, 0.62 * tint, 0.5 * tint],
					roughness: 0.9,
				}),
				position: [side * (ROAD + PAVEMENT + 2), height / 2, z],
				castShadows: true,
				receiveShadows: true,
			});
			add(stone, [out(0.1), 1.15, z - 2.6], [0.1, 2.3, 1.3]);
			add(door, [out(0.14), 1.05, z - 2.6], [0.14, 2.1, 1]);
			add(stone, [out(0.1), 1.35, z + 0.9], [0.1, 1.9, 3.4]);
			add(shop, [out(0.12), 1.35, z + 0.9], [0.12, 1.6, 3.1]);
			for (const [y, dz, tall, wide] of SHOP_FRAME)
				add(frame, [out(0.18), y, z + 0.9 + dz], [0.18, tall, wide]);
			add(
				signs[(k + (side > 0 ? 1 : 3)) % signs.length] as Material,
				[out(0.3), 2.8, z + 0.9],
				[0.3, 0.5, 3.2],
			);
			add(stone, [out(0.3), 3.4, z], [0.3, 0.18, 7.6]);
			const floors: number[] = [];
			houses.push({ side, face, z, height, floors });
			for (let y = 4.7; y < height - 0.9; y += 2.6) {
				floors.push(y);
				for (const dz of [-2.4, 0, 2.4]) {
					add(stone, [out(0.1), y, z + dz], [0.1, 1.55, 1.2]);
					add(math.randFloat(0, 1) < 0.3 ? lit : dark, [out(0.12), y, z + dz], [0.12, 1.3, 0.95]);
					add(trim, [out(0.16), y, z + dz], [0.16, 1.3, 0.05]);
					add(trim, [out(0.16), y + 0.25, z + dz], [0.16, 0.05, 0.95]);
					add(stone, [out(0.26), y - 0.82, z + dz], [0.26, 0.1, 1.4]);
				}
				if (y + 1.4 < height - 0.4) add(stone, [out(0.2), y + 1.4, z], [0.2, 0.12, 7.6]);
			}
			add(stone, [out(0.4), height - 0.15, z], [0.4, 0.3, 7.8]);
		}
	}
	const unit = geometry.box();
	for (const [material, rows] of fronts) {
		const count = rows.length / 6;
		const batch = scene.createInstances(unit, count, {
			material,
			castShadows: true,
			receiveShadows: true,
		});
		for (let i = 0; i < count; i++) {
			batch.positions.set(rows.slice(i * 6, i * 6 + 3), i * 3);
			batch.scales.set(rows.slice(i * 6 + 3, i * 6 + 6), i * 3);
		}
	}
	// Lamp posts with warm lights, which glint in the puddles.
	const post = materials.standard({ color: '#2a2c30', metalness: 0.8, roughness: 0.4 });
	const bulb = materials.standard({ color: '#000000', emissive: '#ffcf8a', emissiveIntensity: 6 });
	for (const [x, y, z] of LAMPS) {
		scene.createMesh({
			mesh: geometry.cylinder({ radiusTop: 0.06, radiusBottom: 0.09, height: y }),
			material: post,
			position: [x, y / 2, z],
			castShadows: true,
		});
		scene.createMesh({
			mesh: geometry.sphere({ radius: 0.22 }),
			material: bulb,
			position: [x, y, z],
		});
		scene.createPointLight({
			position: [x, y - 0.3, z],
			color: '#ffc27a',
			intensity: 14,
			range: 12,
		});
	}
	return { ground, houses };
}
