// The particles demo's scenery: grass strewn with fallen leaves, a ring of stones around leaning
// logs, birches in autumn colors round the glade and dark firs behind them, all made in code.
import { math, type SketchContext } from '@null3d/engine';

/** The fallen leaves' colors on the ground, as sRGB numbers. */
const FALLEN = [0xb25218, 0x966220, 0xcc922c, 0x76361a];
/** Texels along a side of the ground's texture. */
const SIZE = 256;

/** RGBA texels of one sRGB color, each darkened by a random grain down to `low`. */
function grained(width: number, height: number, color: number, low: number): Uint8Array {
	const data = new Uint8Array(width * height * 4).fill(255);
	for (let i = 0; i < width * height; i++) {
		const grain = math.randFloat(low, 1);
		data.set([(color >> 16) * grain, ((color >> 8) & 255) * grain, (color & 255) * grain], i * 4);
	}
	return data;
}

/**
 * Arrays for one lump of a crown: a ball of bumps of two sizes, smooth-shaded, whose vertex colors
 * darken the hollows and vary at random in brightness and hue, as clustered leaves do.
 */
function lump(rows = 18, columns = 28) {
	const [positions, colors, indices] = [[] as number[], [] as number[], [] as number[]];
	const [a, b, c] = [math.randFloat(0, 6), math.randFloat(0, 6), math.randFloat(0, 6)];
	const ring = (j: number, i: number) => 1 + (j - 1) * columns + (i % columns);
	for (let j = 0; j <= rows; j++)
		for (let i = 0; i < (j === 0 || j === rows ? 1 : columns); i++) {
			const [theta, phi] = [(j / rows) * Math.PI, (i / columns) * Math.PI * 2];
			const [x, y, z] = [
				Math.sin(theta) * Math.cos(phi),
				Math.cos(theta),
				Math.sin(theta) * Math.sin(phi),
			];
			const big = Math.sin(2.3 * x + a) + Math.sin(2.9 * y + b) + Math.sin(2.6 * z + c);
			const small = Math.sin(9 * x + b) * Math.sin(8 * y + c) * Math.sin(10 * z + a);
			const r = 1 + 0.07 * big + 0.06 * small;
			positions.push(x * r, y * r, z * r);
			const shade = (0.72 + 0.09 * big + 0.2 * small) * math.randFloat(0.75, 1.1);
			colors.push(shade, shade * math.randFloat(0.8, 1.2), shade * 0.9);
		}
	const bottom = positions.length / 3 - 1;
	for (let i = 0; i < columns; i++) {
		indices.push(0, ring(1, i + 1), ring(1, i), bottom, ring(rows - 1, i), ring(rows - 1, i + 1));
		for (let j = 1; j < rows - 1; j++) {
			const [p, q, s, t] = [ring(j, i), ring(j, i + 1), ring(j + 1, i), ring(j + 1, i + 1)];
			indices.push(p, q, s, q, t, s);
		}
	}
	return { positions, colors, indices, computeNormals: true };
}

/** Makes the glade. `crown` is the top of the birch by the fire, as x, height and z. */
export function glade(ctx: SketchContext, crown: readonly [number, number, number]): void {
	const { scene, geometry, materials, textures } = ctx;
	const lumps = [lump(), lump(), lump()].map((arrays) => geometry.fromArrays(arrays));
	// Grass with grain, strewn with fallen leaves that have darker midribs.
	math.seed(7);
	const data = grained(SIZE, SIZE, 0x3e4a26, 0.7);
	for (let k = 0; k < 170; k++) {
		const [x, y, color] = [math.randInt(0, SIZE), math.randInt(0, SIZE), FALLEN[k % 4] as number];
		const [length, cos, sin] = [4 + (k % 5), Math.cos(k), Math.sin(k)];
		for (let dy = -length; dy <= length; dy++)
			for (let dx = -length; dx <= length; dx++) {
				// Along the leaf and across it: a leaf is a little under half as wide as it is long.
				const u = (dx * cos + dy * sin) / length;
				const v = (dy * cos - dx * sin) / (length * 0.45);
				if (u * u + v * v > 1) continue;
				const shade = Math.abs(v) < 0.15 ? 0.7 : 1 - 0.25 * u * u;
				const at = (((y + dy + SIZE) % SIZE) * SIZE + ((x + dx + SIZE) % SIZE)) * 4;
				data.set([(color >> 16) * shade, ((color >> 8) & 255) * shade, (color & 255) * shade], at);
			}
	}
	const sampling = { colorSpace: 'srgb', wrap: 'repeat', mipmaps: true, anisotropy: 8 } as const;
	const map = textures.fromData({ width: SIZE, height: SIZE, data, ...sampling });
	scene.createMesh({
		mesh: geometry.circle({ radius: 120, segments: 64 }),
		material: materials.standard({
			map,
			roughness: 0.95,
			doubleSided: true,
			uvTransform: { repeat: [60, 60] },
		}),
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
		receiveShadows: true,
	});
	const look = (color: string, roughness = 0.9, flatShading = false) =>
		materials.standard({ color, roughness, flatShading });
	const solid = { castShadows: true, receiveShadows: true };
	// A ring of stones around leaning logs.
	const pebble = geometry.sphere({ radius: 0.2, widthSegments: 10, heightSegments: 8 });
	const stone = { mesh: pebble, material: look('#6b6660', 0.8), ...solid };
	for (let k = 0; k < 11; k++) {
		const [a, s] = [(k / 11) * Math.PI * 2, 0.8 + ((k * 7) % 11) * 0.04];
		const position = [Math.cos(a) * 0.85, 0.06, Math.sin(a) * 0.85] as const;
		scene.createMesh({ ...stone, position, scale: [s, 0.6 * s, s] });
	}
	const log = geometry.cylinder({ radiusTop: 0.09, radiusBottom: 0.09, height: 1.1 });
	const wood = { mesh: log, material: look('#4a3424'), position: [0, 0.22, 0] as const, ...solid };
	for (const t of [0.4, -0.5, 1.6]) {
		scene.createMesh({ ...wood, rotation: [0.58 * Math.cos(t), 0, 0.58 * Math.sin(t), 0.81] });
	}
	// Birch bark: pale, with short dark streaks across the trunk.
	const bark = grained(32, 128, 0xdcd6c8, 0.85);
	for (let k = 0; k < 60; k++) {
		const [x, y, length] = [math.randInt(0, 32), math.randInt(0, 127), math.randInt(3, 10)];
		for (let dx = 0; dx < length; dx++) bark.set([42, 38, 34], (y * 32 + ((x + dx) % 32)) * 4);
	}
	const streaks = textures.fromData({ width: 32, height: 128, data: bark, ...sampling });
	// Birches all round the glade's edge but on the camera's side, and layered firs further out.
	const stem = geometry.cylinder({ radiusTop: 0.1, radiusBottom: 0.18, height: 1 });
	const birch = materials.standard({
		map: streaks,
		roughness: 0.7,
		uvTransform: { repeat: [1, 2] },
	});
	const trunk = { mesh: stem, material: birch, ...solid };
	const crowns = ['#c0641c', '#c99a26', '#9c3d16', '#b8501a'].map((color) =>
		materials.standard({ color, roughness: 0.85, vertexColors: true }),
	);
	const cone = geometry.cone({ radius: 1, height: 1, radialSegments: 12 });
	const fir = { mesh: cone, material: look('#1e3a22', 0.9, true), ...solid };
	const bole = { mesh: stem, material: wood.material, ...solid };
	for (let i = 0; i < 34; i++) {
		const [a, r, height] = [
			math.randFloat(1.75, 6.35),
			math.randFloat(6.5, 14),
			math.randFloat(3.4, 6),
		];
		const [x, h, z] = i === 0 ? crown : [Math.cos(a) * r, height, Math.sin(a) * r];
		scene.createMesh({ ...trunk, position: [x, h / 2, z], scale: [1, h, 1] });
		for (let k = 0; k < 5; k++) {
			const [c, s, size] = [Math.cos(k * 1.9 + i), Math.sin(k * 1.9 + i), 1.1 - k * 0.12];
			const position = [x + c * 0.8, h + Math.sin(k * 2.7) * 0.5, z + s * 0.8] as const;
			const [mesh, material] = [lumps[(i + k) % 3], crowns[(i * 3 + k) % 4]] as const;
			const rotation = [0, Math.sin(i + k), 0, Math.cos(i + k)] as const;
			const shape = { mesh, material, position, rotation, ...solid } as const;
			scene.createMesh({ ...shape, scale: [size, size * 0.8, size] });
		}
		const [b, far, tall] = [
			math.randFloat(1.9, 6.1),
			math.randFloat(15, 28),
			math.randFloat(5, 10),
		];
		const [fx, fz] = [Math.cos(b) * far, Math.sin(b) * far];
		scene.createMesh({ ...bole, position: [fx, tall * 0.1, fz], scale: [1.4, tall * 0.2, 1.4] });
		// Three tiers that narrow toward the top.
		for (let k = 0; k < 3; k++) {
			const width = tall * (0.34 - k * 0.08);
			const position = [fx, tall * (0.36 + k * 0.2), fz] as const;
			scene.createMesh({ ...fir, position, scale: [width, tall * 0.42, width] });
		}
	}
}
