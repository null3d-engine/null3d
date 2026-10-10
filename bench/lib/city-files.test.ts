import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { samplePath, samplesDir } from '../../tools/lib/samples';
import { S6_ENGINE_OBJECTS, type S6Layout } from '../scenes/s6';
import {
	boxVertices,
	buildKit,
	buildTowers,
	decompose,
	jpegSize,
	kitPartName,
	packOrm,
	towerName,
} from './city-files';

const root = join(import.meta.dir, '../..');
const layout = JSON.parse(
	readFileSync(samplePath('sources/city/layout/layout.json'), 'utf8'),
) as S6Layout;
const sample = (path: string) => readFileSync(join(samplesDir(root), path));

describe('boxVertices', () => {
	const box = boxVertices([10, 2, -4], [6, 9, 3], 3);
	test('winds every triangle outward', () => {
		const p = (i: number) =>
			new Vector3(
				box.positions[i * 3] as number,
				box.positions[i * 3 + 1] as number,
				box.positions[i * 3 + 2] as number,
			);
		for (let t = 0; t < box.indices.length; t += 3) {
			const [a, b, c] = [box.indices[t], box.indices[t + 1], box.indices[t + 2]] as number[];
			const normal = p(b as number)
				.sub(p(a as number))
				.cross(p(c as number).sub(p(a as number)));
			const given = new Vector3(
				box.normals[(a as number) * 3] as number,
				box.normals[(a as number) * 3 + 1] as number,
				box.normals[(a as number) * 3 + 2] as number,
			);
			expect(normal.dot(given)).toBeGreaterThan(0);
		}
	});

	test('stands on its base centre', () => {
		const ys = Array.from({ length: 24 }, (_, i) => box.positions[i * 3 + 1] as number);
		expect(Math.min(...ys)).toBe(0);
		expect(Math.max(...ys)).toBe(9);
	});

	test('repeats its texture once per metresPerRepeat, on walls, top and bottom alike', () => {
		for (let f = 0; f < 6; f++) {
			const us = [0, 1, 2, 3].map((k) => box.uvs[(f * 4 + k) * 2] as number);
			const vs = [0, 1, 2, 3].map((k) => box.uvs[(f * 4 + k) * 2 + 1] as number);
			const span = (values: number[]) => Math.max(...values) - Math.min(...values);
			const normal = [0, 1, 2].findIndex((a) => box.normals[f * 4 * 3 + a] !== 0);
			const sizes = [6, 9, 3];
			const [ua, va] = normal === 1 ? [0, 2] : [normal === 0 ? 2 : 0, 1];
			expect(span(us)).toBeCloseTo((sizes[ua as number] as number) / 3, 5);
			expect(span(vs)).toBeCloseTo((sizes[va as number] as number) / 3, 5);
		}
	});

	test('lines up the walls of stacked boxes', () => {
		const lower = boxVertices([0, 0, 0], [4, 5, 4], 2);
		const upper = boxVertices([0, 5, 0], [4, 3, 4], 2);
		// The lower box's top edge and the upper box's bottom edge share v.
		const vAt = (b: typeof lower, y: number) => {
			for (let i = 0; i < 4; i++) if (b.positions[i * 3 + 1] === y) return b.uvs[i * 2 + 1];
			return undefined;
		};
		expect(vAt(lower, 5)).toBeCloseTo(vAt(upper, 0) as number, 6);
	});
});

describe('decompose', () => {
	test('gives back a translation, rotation and scale, mirrored ones too', () => {
		for (const scale of [
			[1, 2, 3],
			[-1, 1, 1],
			[0.27, 0.27, 0.27],
		]) {
			const q = new Quaternion().setFromAxisAngle(new Vector3(1, 2, -1).normalize(), 2.1);
			const m = new Matrix4().compose(new Vector3(4, -5, 6), q, new Vector3(...scale));
			const out = decompose(m.toArray());
			const back = new Matrix4().compose(
				new Vector3(...out.translation),
				new Quaternion(...out.rotation),
				new Vector3(...out.scale),
			);
			for (const [k, v] of back.toArray().entries())
				expect(v).toBeCloseTo(m.toArray()[k] as number, 5);
		}
	});
});

describe('the kit file', () => {
	const kit = buildKit(
		layout,
		(path) => sample(path),
		(model, uri) => `${dirname(model)}/${uri}`,
	);
	test('has one node per model part, named for the model and the part', () => {
		expect(kit.parts).toHaveLength(layout.models.length);
		const names = kit.json.nodes?.map((n) => n.name) ?? [];
		expect(names).toHaveLength(kit.parts.reduce((a, b) => a + b, 0));
		expect(new Set(names).size).toBe(names.length);
		kit.parts.forEach((count, model) => {
			for (let part = 0; part < count; part++) expect(names).toContain(kitPartName(model, part));
		});
	});

	test("the whole city's objects fit the room that S6's page asks the engine for", () => {
		// One mesh for each material of the boxes.
		let meshes = layout.materials.length;
		for (const row of layout.objects.rows)
			if ((row[0] as number) >= 0) meshes += kit.parts[row[0] as number] as number;
		// The sun, the ambient light, the camera, the label's marker and the street lights.
		const others = 4 + layout.lights.length;
		expect(meshes + others).toBe(19_089);
		expect(meshes + others).toBeLessThanOrEqual(S6_ENGINE_OBJECTS);
	});

	test('shares one colour map per kit and merges equal materials', () => {
		expect(kit.json.images).toHaveLength(4);
		expect((kit.json.materials ?? []).length).toBeLessThan(10);
		expect(kit.json.extensionsUsed).toBeUndefined();
	});

	test('copies each accessor whole, inside its buffer', () => {
		for (const view of kit.json.bufferViews ?? [])
			expect((view.byteOffset ?? 0) + view.byteLength).toBeLessThanOrEqual(kit.bin.byteLength);
	});
});

describe('the tower file', () => {
	const towers = buildTowers(layout, (m) => ({
		color: `${m.set}/color.jpg`,
		normal: `${m.set}/normal.jpg`,
		orm: `orm/${m.set}.png`,
		occlusion: m.maps.occlusion !== undefined,
		metalness: m.maps.metalness !== undefined,
		...(m.maps.emission && { emission: `${m.set}/emission.jpg` }),
	}));
	const boxes = layout.objects.rows.filter((r) => r[0] === -1).length;

	test('has a node and a mesh per material, named for it, that hold every box', () => {
		expect(towers.boxes).toBe(boxes);
		expect(towers.json.nodes).toHaveLength(layout.materials.length);
		expect(towers.json.nodes?.map((n) => n.name)).toEqual(
			layout.materials.map((_, m) => towerName(m)),
		);
		let vertices = 0;
		towers.json.meshes?.forEach((mesh, m) => {
			const [primitive] = mesh.primitives;
			expect(primitive?.material).toBe(m);
			expect(mesh.extras).toEqual({ occluder: true, quantizePositions: false });
			const count = towers.json.accessors?.[primitive?.attributes.POSITION as number]?.count ?? 0;
			const indices = towers.json.accessors?.[primitive?.indices as number]?.count ?? 0;
			expect(indices).toBe((count / 24) * 36);
			vertices += count;
		});
		expect(vertices).toBe(boxes * 24);
	});

	test("puts each box where its row stands, around its node at the boxes' base", () => {
		const first = layout.objects.rows.findIndex((r) => r[0] === -1);
		const row = layout.objects.rows[first] as number[];
		const m = row[layout.objects.fields.indexOf('material')] as number;
		const node = towers.json.nodes?.[m];
		const position =
			towers.json.accessors?.[
				towers.json.meshes?.[m]?.primitives[0]?.attributes.POSITION as number
			];
		// The material's first box comes first in its mesh.
		const at = (position?.bufferView !== undefined &&
			towers.json.bufferViews?.[position.bufferView]) as { byteOffset: number };
		const xyz = new Float32Array(towers.bin.buffer, towers.bin.byteOffset + at.byteOffset, 72);
		const world = (k: number, i: number) =>
			(xyz[i * 3 + k] as number) + (node?.translation?.[k] as number);
		const [x, y, z, sx, sy, sz] = ['x', 'y', 'z', 'sx', 'sy', 'sz'].map(
			(name) => row[layout.objects.fields.indexOf(name)] as number,
		);
		const xs = Array.from({ length: 24 }, (_, i) => world(0, i));
		const ys = Array.from({ length: 24 }, (_, i) => world(1, i));
		const zs = Array.from({ length: 24 }, (_, i) => world(2, i));
		expect(Math.min(...xs)).toBeCloseTo((x as number) - (sx as number) / 2, 3);
		expect(Math.max(...xs)).toBeCloseTo((x as number) + (sx as number) / 2, 3);
		expect(Math.min(...ys)).toBeCloseTo(y as number, 3);
		expect(Math.max(...ys)).toBeCloseTo((y as number) + (sy as number), 3);
		expect(Math.min(...zs)).toBeCloseTo((z as number) - (sz as number) / 2, 3);
		expect(Math.max(...zs)).toBeCloseTo((z as number) + (sz as number) / 2, 3);
		expect(position?.min?.[1]).toBe(0);
	});

	test("has the layout's materials, with each texture set's images once", () => {
		expect(towers.json.materials).toHaveLength(layout.materials.length);
		const sets = new Set(layout.materials.map((m) => m.set));
		expect((towers.json.images ?? []).length).toBeLessThan(sets.size * 5);
		const plain = towers.json.materials?.find((m) => m.name?.startsWith('Asphalt'));
		expect(plain?.pbrMetallicRoughness?.metallicFactor).toBe(0);
	});
});

describe('texture sets', () => {
	const set = layout.materials.find((m) => m.maps.metalness && m.maps.occlusion);
	test('pack occlusion, roughness and metalness into one image', () => {
		if (!set) throw new Error('the layout has no set with metalness and occlusion maps');
		const rough = sample(set.maps.roughness as string);
		const [width, height] = jpegSize(rough);
		expect([width, height]).toEqual([1024, 1024]);
		const png = packOrm(
			rough,
			sample(set.maps.occlusion as string),
			sample(set.maps.metalness as string),
			width,
			height,
		);
		expect(png.byteLength).toBeGreaterThan(1000);
	});
});
