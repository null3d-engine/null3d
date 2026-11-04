import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SketchContext, Texture } from '@null3d/engine';
import { ReferenceTerrainBuilder } from './reference-builder';
import { Terrain, type TerrainOptions } from './terrain';

/** A level's shared grid as the fake geometry keeps it. */
interface FakeMesh {
	positions: Float32Array;
	targets: Float32Array;
	destroyed: boolean;
	destroy(): void;
}

/** A level's instance batch as the fake scene keeps it: its rows, the rows that draw, its life. */
interface FakeBatch {
	mesh: FakeMesh;
	capacity: number;
	positions: Float32Array;
	values: Float32Array;
	active: number;
	marks: number;
	destroyed: boolean;
}

/** A sketch context with just what a terrain calls, which logs every grid and batch it makes. */
function fakeContext() {
	const meshes: FakeMesh[] = [];
	const batches: FakeBatch[] = [];
	const selections: { selection: [number, number] }[] = [];
	/** The uniforms that each material was made with. */
	const uniforms: Record<string, unknown>[] = [];
	const texture = () => ({ destroy: () => {} }) as unknown as Texture;
	const context = {
		textures: { fromData: texture, maxSize: 8192 },
		materials: {
			shader: (options: { uniforms: Record<string, unknown> }) => {
				uniforms.push(options.uniforms);
				return {
					destroy: () => {},
					set: (values: { selection: [number, number] }) => {
						selections.push({ selection: [values.selection[0], values.selection[1]] });
					},
				};
			},
		},
		// The ground picks blocks from the drawing buffer's height and the preset's detail.
		engine: { viewport: { width: 1920, height: 1080, pixelRatio: 1 } },
		quality: { settings: { lodThreshold: 1, maxRenderScale: 1 } },
		geometry: {
			fromArrays: (arrays: { positions: Float32Array; targets: Float32Array }) => {
				const mesh: FakeMesh = {
					positions: arrays.positions.slice(),
					targets: arrays.targets.slice(),
					destroyed: false,
					destroy() {
						this.destroyed = true;
					},
				};
				meshes.push(mesh);
				return mesh;
			},
		},
		scene: {
			createInstances: (mesh: FakeMesh, capacity: number) => {
				const batch: FakeBatch = {
					mesh,
					capacity,
					positions: new Float32Array(capacity * 3),
					values: new Float32Array(capacity * 4),
					active: capacity,
					marks: 0,
					destroyed: false,
				};
				batches.push(batch);
				return {
					get positions() {
						return batch.positions;
					},
					get values() {
						return batch.values;
					},
					setActiveCount: (count: number) => {
						expect(count).toBeLessThanOrEqual(capacity);
						batch.active = count;
					},
					markDirty: (start: number, count: number) => {
						expect(start + count).toBeLessThanOrEqual(capacity);
						batch.marks++;
					},
					destroy: () => {
						batch.destroyed = true;
					},
				};
			},
		},
	} as unknown as SketchContext;
	/** The batches that the ground still holds. */
	const live = () => batches.filter((b) => !b.destroyed);
	/** The size of a level's blocks, from its grid's record. */
	const sizeOf = (batch: FakeBatch) => batch.mesh.targets[1] as number;
	/** The rows that draw now, as each block's level size, low corner and height box. */
	const rows = () =>
		live().flatMap((b) =>
			Array.from({ length: b.active }, (_, i) => ({
				size: sizeOf(b),
				x: b.positions[i * 3] as number,
				z: b.positions[i * 3 + 2] as number,
				low: b.values[i * 4] as number,
				high: b.values[i * 4 + 1] as number,
			})),
		);
	const area = () => rows().reduce((sum, r) => sum + r.size * r.size, 0);
	return { context, meshes, batches, live, selections, uniforms, rows, area };
}

const SIZE = 1024;
const layer = { map: {} as Texture };

function terrain(options: Partial<TerrainOptions> = {}) {
	const fake = fakeContext();
	const ground = new Terrain(
		fake.context,
		{
			size: SIZE,
			height: () => 0,
			resolution: 8,
			splatResolution: 2,
			chunkQuads: 16,
			layers: [layer],
			maxLevel: 5,
			...options,
		},
		(builder) => new ReferenceTerrainBuilder(builder),
	);
	return { ...fake, ground };
}

/** Moves the camera to a place and lets the selection that it asks for finish. */
async function settle(t: ReturnType<typeof terrain>, x: number, z: number, y = 0): Promise<void> {
	t.ground.update([x, y, z]);
	await t.ground.settled();
}

describe('terrain updates', () => {
	test('one grid and one batch per level, which draw nothing before the first selection', () => {
		const t = terrain();
		expect(t.meshes.length).toBe(6);
		expect(t.live().length).toBe(6);
		expect(t.rows()).toEqual([]);
	});

	test('the first update draws its whole selection, which tiles the ground once', async () => {
		const t = terrain();
		await settle(t, 10, 10);
		expect(t.ground.building).toBe(false);
		expect(t.rows().length).toBe(t.ground.drawn);
		expect(t.area()).toBeCloseTo(SIZE * SIZE, 6);
	});

	test('a still camera does no work', async () => {
		const t = terrain();
		await settle(t, 10, 10);
		const marks = t.batches.reduce((sum, b) => sum + b.marks, 0);
		await settle(t, 11, 12);
		expect(t.batches.reduce((sum, b) => sum + b.marks, 0)).toBe(marks);
	});

	test('a new cell keeps the old ground drawn whole until its selection arrives', async () => {
		const t = terrain();
		await settle(t, 10, 10);
		const before = t.rows();
		t.ground.update([300, 0, -200]);
		expect(t.ground.building).toBe(true);
		expect(t.rows()).toEqual(before);
		await t.ground.settled();
		expect(t.rows()).not.toEqual(before);
		expect(t.rows().length).toBe(t.ground.drawn);
		expect(t.area()).toBeCloseTo(SIZE * SIZE, 6);
	});

	test('setVisible hides every row, and shows the current selection again', async () => {
		const t = terrain();
		await settle(t, 10, 10);
		await settle(t, 400, 400);
		t.ground.setVisible(false);
		expect(t.rows()).toEqual([]);
		expect(t.ground.drawn).toBe(0);
		t.ground.setVisible(true);
		expect(t.rows().length).toBe(t.ground.drawn);
		expect(t.area()).toBeCloseTo(SIZE * SIZE, 6);
	});

	test('a hidden ground stays hidden while the camera moves', async () => {
		const t = terrain();
		await settle(t, 10, 10);
		t.ground.setVisible(false);
		await settle(t, 400, 400);
		expect(t.rows()).toEqual([]);
		t.ground.setVisible(true);
		expect(t.area()).toBeCloseTo(SIZE * SIZE, 6);
	});

	test("a level's batch grows to hold every block of a selection at that level", async () => {
		// An error of 0 keeps the finest level everywhere: all 1,024 of its blocks draw.
		const t = terrain({ error: 0 });
		await settle(t, 10, 10);
		expect(t.ground.drawn).toBe(1024);
		expect(t.rows().length).toBe(1024);
		expect(t.area()).toBeCloseTo(SIZE * SIZE, 6);
		// The batch that grew replaced the smaller one, so each level keeps a single batch.
		expect(t.live().length).toBe(6);
	});

	test('destroy ends every batch and grid', async () => {
		const t = terrain();
		await settle(t, 10, 10);
		t.ground.destroy();
		expect(t.batches.every((b) => b.destroyed)).toBe(true);
		expect(t.meshes.every((m) => m.destroyed)).toBe(true);
		t.ground.update([0, 0, 0]);
		await t.ground.settled();
		expect(t.batches.every((b) => b.destroyed)).toBe(true);
	});

	test('createTerrain refuses an error or blocksPerUpdate out of range', () => {
		expect(() => terrain({ error: -1 })).toThrow('0 or more');
		expect(() => terrain({ error: Number.POSITIVE_INFINITY })).toThrow('0 or more');
		expect(() => terrain({ blocksPerUpdate: 0 })).toThrow('blocksPerUpdate');
	});

	test('a high camera picks coarser blocks under it', async () => {
		const t = terrain();
		await settle(t, 10, 10, 0);
		const near = t.ground.drawn;
		await settle(t, 10, 10, 500);
		expect(t.ground.drawn).toBeLessThan(near);
		expect(t.area()).toBeCloseTo(SIZE * SIZE, 6);
	});

	test('the ground picks again when the camera rises without moving across', async () => {
		const t = terrain();
		await settle(t, 10, 10, 0);
		const before = t.ground.drawn;
		await settle(t, 10, 10, 400);
		expect(t.ground.drawn).toBeLessThan(before);
	});
});

describe('terrain level grids', () => {
	/** The skirt the test sets, which every grid's bounds must hold below the ground. */
	const SKIRT = 5;
	const hills = (x: number, z: number) => Math.sin(x / 40) * 20 + Math.cos(z / 60) * 12;

	test("a level's grid spans the level's height box, so the batch culls its blocks by it", () => {
		const t = terrain({ skirt: SKIRT, height: hills });
		const { min, max } = t.ground.heightfield;
		for (const mesh of t.meshes) {
			const size = mesh.targets[1] as number;
			for (let at = 0; at < mesh.positions.length; at += 3) {
				const x = mesh.positions[at] as number;
				const y = mesh.positions[at + 1] as number;
				const z = mesh.positions[at + 2] as number;
				expect(x).toBeGreaterThanOrEqual(0);
				expect(x).toBeLessThanOrEqual(size + 1e-6);
				expect(z).toBeGreaterThanOrEqual(0);
				expect(z).toBeLessThanOrEqual(size + 1e-6);
				const skirt = mesh.targets[(at / 3) * 4] as number;
				expect(y).toBeCloseTo(skirt > 0 ? min - SKIRT : max, 5);
			}
		}
	});

	test("each grid's record holds the skirt's depth, the block's size and its parent's size", () => {
		const t = terrain({ skirt: SKIRT });
		const sizes = t.meshes.map((m) => m.targets[1] as number);
		expect(sizes).toEqual([1024, 512, 256, 128, 64, 32]);
		t.meshes.forEach((mesh, level) => {
			const vertices = mesh.positions.length / 3;
			const grid = 17 * 17;
			for (let v = 0; v < vertices; v++) {
				expect(mesh.targets[v * 4]).toBe(v < grid ? 0 : SKIRT);
				expect(mesh.targets[v * 4 + 1]).toBe(sizes[level] as number);
				expect(mesh.targets[v * 4 + 2]).toBe(sizes[Math.max(level - 1, 0)] as number);
			}
		});
	});

	test("each row stands at its block's low corner with its block's height box", async () => {
		const t = terrain({ height: hills });
		await settle(t, 10, 10);
		const { min, max } = t.ground.heightfield;
		expect(t.rows().length).toBeGreaterThan(1);
		for (const row of t.rows()) {
			expect(((row.x + SIZE / 2) / row.size) % 1).toBe(0);
			expect(((row.z + SIZE / 2) / row.size) % 1).toBe(0);
			expect(row.low).toBeLessThanOrEqual(row.high);
			expect(row.low).toBeGreaterThanOrEqual(min - 1e-6);
			expect(row.high).toBeLessThanOrEqual(max + 1e-6);
		}
	});

	test('moves the selection scale with setMorph', async () => {
		const t = terrain();
		await settle(t, 10, 10);
		const before = (t.selections.at(-1) as { selection: [number, number] }).selection[0];
		expect(before).toBeGreaterThan(0);
		t.ground.setMorph(false);
		expect((t.selections.at(-1) as { selection: [number, number] }).selection[0]).toBe(0);
		t.ground.setMorph(true);
		expect((t.selections.at(-1) as { selection: [number, number] }).selection[0]).toBeCloseTo(
			before,
			9,
		);
	});
});

describe('the rock on steep faces', () => {
	const shader = readFileSync(join(import.meta.dirname, 'terrain.wgsl'), 'utf8');

	/** The body of the WGSL function `name`, from its signature to its closing brace. */
	function wgslFunction(name: string): string {
		const start = shader.indexOf(`fn ${name}(`);
		expect(start).toBeGreaterThanOrEqual(0);
		const end = shader.indexOf('\n}', start);
		expect(end).toBeGreaterThan(start);
		return shader.slice(start, end);
	}

	/** The branch that maps the third layer, the rock, from the sides. */
	function steepBranch(): string {
		const surface = wgslFunction('surface');
		const start = surface.indexOf('if material.steepFaces > 0.5 {');
		expect(start).toBeGreaterThanOrEqual(0);
		const end = surface.indexOf('\n    }', start);
		expect(end).toBeGreaterThan(start);
		return surface.slice(start, end);
	}

	test('the ground takes the option that the page asks for', () => {
		expect(terrain().uniforms.at(-1)?.steepFaces).toBe(0);
		expect(terrain({ steepFaces: true }).uniforms.at(-1)?.steepFaces).toBe(1);
	});

	test('the rock turns with the ground’s facing', () => {
		const branch = steepBranch();
		expect(branch).toContain('input.worldPosition.zy');
		expect(branch).toContain('input.worldPosition.xy');
		expect(branch).toContain('smoothstep(0.75, 0.45, facing.y)');
		expect(branch).toContain('c2 = mix(c2, sideways, steep)');
	});

	test('the side maps are read only where the page asks for them', () => {
		const surface = wgslFunction('surface');
		const outside = surface.replace(steepBranch(), '');
		expect(outside).not.toContain('input.worldPosition.zy');
		expect(outside).not.toContain('input.worldPosition.xy');
	});

	test('the side samples take their gradients from outside the branch', () => {
		const surface = wgslFunction('surface');
		const branch = steepBranch();
		const before = surface.slice(0, surface.indexOf(branch));
		expect(before).toContain('dpdx(input.worldPosition)');
		expect(before).toContain('dpdy(input.worldPosition)');
		expect(branch).toContain('textureSampleGrad(');
		expect(branch).not.toContain('textureSample(');
	});
});
