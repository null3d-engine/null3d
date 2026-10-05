import { beforeEach, describe, expect, test } from 'bun:test';
import { setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import * as C from '../generated/core';
import type { CoreGlue } from '../shared/core';
import { AnimationRig } from './animation';
import { CoreMemory } from './memory';
import { boundsOf, Prefab, type TemplateNode } from './prefab';
import { Material, MeshGeometry } from './resources';
import { Group, Mesh, type PointLight, Scene } from './scene';

beforeEach(() => setErrorFixes(ERROR_FIXES));

/** Object slots in the fake core: room for a prefab of 1,000 objects and a copy of it. */
const CAPACITY = 2100;
/** Records in the fake core's command ring: a power of two, as the core's is. */
const RING = 8192;
const SLOT_MASK = (1 << C.HANDLE_SLOT_BITS) - 1;

/** A core with the scene's arrays and command ring, which counts the calls a test watches. */
/**
 * A core with the scene's arrays in a memory of its own. With `largeWorld`, positions hold cells.
 * With `growOnReserve`, the memory grows in each reserve of many objects, as the single-threaded
 * build's can, which detaches every view made before it.
 */
function fakeCore(largeWorld = false, growOnReserve = false) {
	const rows = CAPACITY + 1;
	const sizes = { positions: rows * 12, rotations: rows * 16, scales: rows * 12, radii: rows * 4 };
	type Field =
		| keyof typeof sizes
		| 'centers'
		| 'dirty'
		| 'records'
		| 'write'
		| 'read'
		| 'handles'
		| 'batch'
		| 'cells'
		| 'morphs';
	const at = {} as Record<Field, number>;
	let next = 64;
	for (const [name, bytes] of Object.entries({
		...sizes,
		centers: rows * 12,
		dirty: Math.ceil(rows / 32) * 4,
		records: RING * 16,
		write: 4,
		read: 4,
		handles: rows * 4,
		batch: 4096,
		cells: rows * 12,
		morphs: C.MORPH_MAX_WEIGHTS * 4,
	})) {
		at[name as Field] = next;
		next += Math.ceil(bytes / 64) * 64;
	}
	const memory = new WebAssembly.Memory({ initial: Math.ceil(next / 65536) + 1 });
	let slot = 1;
	let instances = 0;
	/** The failure the next failing call reports: its code, and its two details. */
	const failure = { code: 0, details: [0, 0], lights: false, animations: false };
	/** The layers each batch was given, by id. */
	const batchLayers = new Map<number, number>();
	/** The batches destroyed, by id. */
	const destroyedBatches: number[] = [];
	const calls = { reserveObjects: 0, reserveObject: 0, createLight: 0, copyLight: 0 };
	/** Each block of morph weights by id: its first weight, its count and its link. */
	const morphs: { first: number; count: number; link: number[] }[] = [];
	let morphEnd = 0;
	const lights = new Map<number, { kind: number; values: Map<number, number> }>();
	const batches: { source: number; mesh: number; material: number; part: number[] }[] = [];
	/** The origin that each batch was given, by id. */
	const origins = new Map<number, number[]>();
	const glue = {
		sceneCapacity: () => CAPACITY,
		sceneArrays: (field: number) =>
			({
				[C.SCENE_FIELD_POSITIONS]: at.positions,
				[C.SCENE_FIELD_ROTATIONS]: at.rotations,
				[C.SCENE_FIELD_SCALES]: at.scales,
				[C.SCENE_FIELD_LOCAL_RADII]: at.radii,
				[C.SCENE_FIELD_LOCAL_CENTERS]: at.centers,
				[C.SCENE_FIELD_DIRTY_WORDS]: at.dirty,
				[C.SCENE_FIELD_POSITION_CELLS]: largeWorld ? at.cells : 0,
			})[field],
		commandRing: (field: number) =>
			({
				[C.RING_FIELD_RECORDS]: at.records,
				[C.RING_FIELD_CAPACITY]: RING,
				[C.RING_FIELD_WRITE_INDEX]: at.write,
				[C.RING_FIELD_READ_INDEX]: at.read,
			})[field],
		reserveObject: () => {
			calls.reserveObject++;
			return slot++;
		},
		reserveObjects: (count: number) => {
			calls.reserveObjects++;
			if (growOnReserve) memory.grow(1);
			const handles = new Uint32Array(memory.buffer, at.handles, count);
			for (let k = 0; k < count; k++) handles[k] = slot++;
			return at.handles;
		},
		createLight: (_: number, kind: number) => {
			calls.createLight++;
			if (failure.lights) return 0;
			lights.set(lights.size + 1, { kind, values: new Map() });
			return lights.size;
		},
		copyLight: (light: number) => {
			calls.copyLight++;
			const source = lights.get(light);
			lights.set(lights.size + 1, { kind: source?.kind ?? 0, values: new Map(source?.values) });
			return lights.size;
		},
		setLightColor: () => 0,
		setLightValue: (light: number, which: number, value: number) => {
			lights.get(light)?.values.set(which, value);
			return 0;
		},
		createBatchPart: (
			source: number,
			_capacity: number,
			_dynamic: boolean,
			_colors: boolean,
			mesh: number,
			material: number,
			part: Float32Array,
		) => batches.push({ source, mesh, material, part: [...part] }),
		batchArrays: (_id: number, field: number) => at.batch + field * 1024,
		setBatchOrigin: (id: number, x: number, y: number, z: number) => {
			origins.set(id, [x, y, z]);
			return 0;
		},
		setBatchActiveCount: () => 0,
		setBatchLayers: (id: number, layers: number) => {
			batchLayers.set(id, layers);
			return 0;
		},
		markBatchDirty: () => 0,
		destroyBatch: (id: number) => {
			destroyedBatches.push(id);
			return 0;
		},
		initAnimations: () => 0,
		createAnimatedInstance: () => (failure.animations ? 0 : ++instances),
		removeAnimatedInstance: () => 0,
		createMorphWeights: (count: number) => {
			morphs.push({ first: morphEnd, count, link: [] });
			morphEnd += count;
			return morphs.length;
		},
		destroyMorphWeights: (id: number) => {
			(morphs[id] as (typeof morphs)[number]).count = 0;
			return 0;
		},
		linkMorphWeights: (id: number, instance: number, joint: number) => {
			(morphs[id] as (typeof morphs)[number]).link = [instance, joint];
			return 0;
		},
		morphWeightsAddress: () => at.morphs,
		morphWeightsFirst: (id: number) => morphs[id]?.first ?? 0,
		lastErrorCode: () => failure.code,
		lastErrorDetail: (index: number) => failure.details[index] ?? 0,
	};
	const core = new CoreMemory(glue as unknown as CoreGlue, memory);
	const scene = new Scene(core, { frame: 3 }, false);
	const u32 = (address: number, length: number) => new Uint32Array(memory.buffer, address, length);
	return {
		core,
		scene,
		calls,
		lights,
		batches,
		morphs,
		origins,
		failure,
		batchLayers,
		destroyedBatches,
		/** A batch's first rows of positions. */
		batchPositions(count: number) {
			return [...new Float32Array(memory.buffer, at.batch, count * 3)];
		},
		/** The commands written since the last call, as [operation, handle, a, b]. */
		take(): number[][] {
			const [write, read] = [u32(at.write, 1)[0] as number, u32(at.read, 1)[0] as number];
			const records = u32(at.records, RING * 4);
			const out: number[][] = [];
			for (let k = read; k < write; k++) {
				const i = (k % RING) * 4;
				out.push([...records.subarray(i, i + 4)]);
			}
			u32(at.read, 1)[0] = write;
			return out;
		},
		positionOf(object: { slot: number }) {
			return [...new Float32Array(memory.buffer, at.positions + object.slot * 12, 3)];
		},
		/** An object's full position: its whole cells, in large-world mode, and its 32-bit rest. */
		placeOf(object: { slot: number }) {
			const rest = new Float32Array(memory.buffer, at.positions + object.slot * 12, 3);
			const cells = new Int32Array(memory.buffer, at.cells + object.slot * 12, 3);
			return [0, 1, 2].map((k) => (cells[k] as number) * C.CELL_SIZE + (rest[k] as number));
		},
	};
}

const node = (fields: Partial<TemplateNode> & Pick<TemplateNode, 'parent'>): TemplateNode => ({
	name: '',
	transform: [0, 0, 0, 0, 0, 0, 1, 1, 1, 1],
	flags: C.FLAG_VISIBLE,
	layers: C.LAYERS_DEFAULT,
	renderOrder: 0,
	...fields,
});

/** A prefab of a root and `count` meshes in a chain, each 1 m above its parent. */
function chainPrefab(core: CoreMemory, count: number, extra: TemplateNode[] = []): Prefab {
	const mesh = new MeshGeometry(7, 0.5, core);
	const material = new Material(4, core, 'materials.standard.set');
	const template = [node({ parent: -1, root: true })];
	for (let k = 0; k < count; k++)
		template.push(
			node({
				name: `link ${k}`,
				parent: k,
				transform: [0, 1, 0, 0, 0, 0, 1, 1, 1, 1],
				mesh,
				material,
			}),
		);
	template.push(...extra);
	const part = { mesh, material, matrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1, 0]) };
	return new Prefab(
		core,
		'https://example.com/chain.glb',
		template,
		[part, { ...part, matrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 2, 0, 0, 1, 0]) }],
		[],
		boundsOf([-0.5, 0, -0.5], [0.5, count, 0.5]),
		[material],
		[],
	);
}

test('a copy whose reserve grows the memory places its objects', () => {
	const { core, scene, positionOf, take } = fakeCore(false, true);
	const prefab = chainPrefab(core, 2);
	const copy = scene.instantiate(prefab, { position: [5, 0, 0] });
	expect(positionOf(copy)).toEqual([5, 0, 0]);
	expect(take()).toHaveLength(1 + 2 * 2);
});

describe('scene.instantiate', () => {
	test('a prefab of 1,000 objects costs one slot call and one batch of commands', () => {
		const { core, scene, calls, take } = fakeCore();
		const prefab = chainPrefab(core, 1000);
		const before = scene.commandBatches;
		const copy = scene.instantiate(prefab, { position: [5, 0, 0], name: 'chain' });
		expect(scene.commandBatches - before).toBe(1);
		expect(calls).toMatchObject({ reserveObjects: 1, reserveObject: 0 });
		const records = take();
		// A create for the root and each link, and a material for each link.
		expect(records).toHaveLength(1 + 2 * 1000);
		const [root, firstCreate, firstMaterial, secondCreate] = records as number[][];
		expect(root).toEqual([C.COMMAND_CREATE | (C.FLAG_VISIBLE << 8), copy.handle, 0, 0]);
		expect(firstCreate).toEqual([
			C.COMMAND_CREATE | (C.FLAG_VISIBLE << 8),
			firstCreate?.[1] as number,
			copy.handle,
			7,
		]);
		expect(firstMaterial).toEqual([C.COMMAND_SET_MATERIAL, firstCreate?.[1] as number, 4, 0]);
		expect(secondCreate?.[2]).toBe(firstCreate?.[1]);
		expect(copy).toBeInstanceOf(Group);
		expect(copy.name).toBe('chain');
		const link = copy.find('link 999');
		expect(link).toBeInstanceOf(Mesh);
		expect(scene.find('link 999')).toBe(link);
		expect(copy.find('nothing')).toBeUndefined();
	});

	test("a copy's root takes the options, and its meshes the shadow flags", () => {
		const { core, scene, take, positionOf } = fakeCore();
		const parent = scene.createGroup();
		take();
		const copy = scene.instantiate(chainPrefab(core, 1), {
			position: [1, 2, 3],
			parent,
			layers: 4,
			dynamic: true,
			castShadows: true,
		});
		expect(positionOf(copy)).toEqual([1, 2, 3]);
		const [root, layers, link] = take();
		expect(root).toEqual([
			C.COMMAND_CREATE | ((C.FLAG_VISIBLE | C.FLAG_DYNAMIC) << 8),
			copy.handle,
			parent.handle,
			0,
		]);
		expect(layers).toEqual([C.COMMAND_SET_LAYERS, copy.handle, 4, 0]);
		expect((link?.[0] as number) >> 8).toBe(C.FLAG_VISIBLE | C.FLAG_CAST_SHADOWS);
	});

	test('a command ring without room for every record creates nothing', () => {
		const { core, scene, take } = fakeCore();
		expect(() => scene.instantiate(chainPrefab(core, 5000))).toThrow('E1102');
		expect(take()).toEqual([]);
	});

	test("a light node creates its light with the file's values", () => {
		const { core, scene, lights } = fakeCore();
		const light = node({
			name: 'lamp',
			parent: 0,
			light: {
				kind: C.LIGHT_KIND_POINT,
				color: [1, 0.5, 0],
				values: [
					[C.LIGHT_VALUE_INTENSITY, 30],
					[C.LIGHT_VALUE_RANGE, 12],
				],
			},
		});
		const copy = scene.instantiate(chainPrefab(core, 1, [light]));
		const lamp = copy.find('lamp') as PointLight;
		expect(lamp.constructor.name).toBe('PointLight');
		expect([...lamp.linear]).toEqual([1, 0.5, 0]);
		expect(lights.get(lamp.id)).toEqual({
			kind: C.LIGHT_KIND_POINT,
			values: new Map([
				[C.LIGHT_VALUE_INTENSITY, 30],
				[C.LIGHT_VALUE_RANGE, 12],
			]),
		});
	});
});

describe('far from the origin', () => {
	/** A point at the Earth's radius, 0.3 m past a whole meter on the far axis. */
	const FAR: [number, number, number] = [1_234.5678, 6_378_137.3, -98_765.4321];
	const error = (a: ArrayLike<number>, b: ArrayLike<number>) =>
		Math.max(...[0, 1, 2].map((k) => Math.abs((a[k] as number) - (b[k] as number))));

	test('in large-world mode, copies and clones keep their full positions', () => {
		const { core, scene, placeOf } = fakeCore(true);
		const copy = scene.instantiate(chainPrefab(core, 1), { position: FAR });
		expect(error(placeOf(copy), FAR)).toBeLessThan(3e-5);
		const cart = scene.createGroup({ position: FAR });
		expect(error(placeOf(scene.clone(cart)), FAR)).toBeLessThan(3e-5);
	});

	test("a model's own instancing takes its node's place as its batch origin", () => {
		const { core, scene, origins, batchPositions } = fakeCore(true);
		const chain = chainPrefab(core, 1);
		const [part] = chain.parts;
		const instancing = [
			{
				node: 1,
				count: 2,
				positions: new Float32Array([0.001, 0, 0, -2, 0, 0.5]),
				rotations: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1]),
				scales: new Float32Array([1, 1, 1, 1, 1, 1]),
				parts: [part as (typeof chain.parts)[number]],
			},
		];
		const prefab = new Prefab(
			core,
			chain.url,
			chain.template,
			chain.parts,
			instancing,
			chain.bounds,
			[],
			[],
		);
		const copy = scene.instantiate(prefab, { position: FAR });
		const [batch] = copy.batches;
		// The node is the chain's first link, 1 m above the copy's root.
		const origin = origins.get(batch?.id ?? -1) ?? [];
		expect(error(origin, [FAR[0], FAR[1] + 1, FAR[2]])).toBeLessThan(3e-5);
		// The rows keep their small offsets from the node, a millimeter included.
		const rows = batchPositions(2);
		expect(error(rows, [0.001, 0, 0])).toBeLessThan(1e-6);
		expect(error(rows.slice(3), [-2, 0, 0.5])).toBeLessThan(1e-6);
	});
});

describe('scene.clone', () => {
	test('copies an object and everything below it, under the same parent, in one batch', () => {
		const { core, scene, calls, take, positionOf } = fakeCore();
		const mesh = new MeshGeometry(3, 1, core);
		const paint = new Material(2, core, 'materials.standard.set');
		const parent = scene.createGroup({ name: 'world' });
		const cart = scene.createGroup({ name: 'cart', parent, position: [4, 0, 0] });
		const wheel = scene.createMesh({ name: 'wheel', mesh, material: paint, parent: cart });
		wheel.setRenderOrder(2);
		wheel.setLayers(8);
		const lamp = scene.createPointLight({ name: 'lamp', range: 5, parent: wheel });
		scene.createGroup({ name: 'elsewhere', parent });
		take();
		const before = scene.commandBatches;
		const copy = scene.clone(cart);
		expect(scene.commandBatches - before).toBe(1);
		expect(calls.copyLight).toBe(1);
		const records = take();
		const creates = records.filter((r) => ((r[0] as number) & 0xff) === C.COMMAND_CREATE);
		expect(creates).toHaveLength(3);
		expect(creates[0]?.[2]).toBe(parent.handle);
		expect(positionOf(copy)).toEqual([4, 0, 0]);
		expect(copy).toBeInstanceOf(Group);
		expect(copy.name).toBe('cart');
		const wheelCopy = creates[1]?.[1] as number;
		expect(creates[1]?.[3]).toBe(3);
		expect(records).toContainEqual([C.COMMAND_SET_MATERIAL, wheelCopy, 2, 0]);
		expect(records).toContainEqual([C.COMMAND_SET_LAYERS, wheelCopy, 8, 0]);
		expect(records.some((r) => r[0] === C.COMMAND_SET_RENDER_ORDER && r[1] === wheelCopy)).toBe(
			true,
		);
		expect(creates[2]?.[2]).toBe(wheelCopy);
		expect(lamp.constructor.name).toBe('PointLight');
		expect(wheelCopy & SLOT_MASK).not.toBe(wheel.slot);
	});

	test('an object whose parent was destroyed is a root, so a clone of the parent leaves it out', () => {
		const { scene, take } = fakeCore();
		const top = scene.createGroup();
		const middle = scene.createGroup({ parent: top });
		scene.createGroup({ parent: middle });
		middle.destroy();
		take();
		scene.clone(top);
		expect(take()).toHaveLength(1);
	});
});

describe('scene.createInstances with a prefab', () => {
	test('makes one batch per mesh, the first owning the rows the others read', () => {
		const { core, scene, batches } = fakeCore();
		const batch = scene.createInstances(chainPrefab(core, 1), 50, { dynamic: true });
		expect(batches).toEqual([
			{ source: 0, mesh: 7, material: 4, part: [1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1, 0] },
			{ source: 1, mesh: 7, material: 4, part: [1, 0, 0, 0, 0, 1, 0, 2, 0, 0, 1, 0] },
		]);
		expect(batch.count).toBe(50);
		expect(batch.parts).toEqual([2]);
	});

	test('a model without meshes, or with instancing of its own, gives E1417', () => {
		const { core, scene } = fakeCore();
		const empty = new Prefab(core, 'empty.glb', [], [], [], boundsOf([0, 0, 0], [0, 0, 0]), [], []);
		expect(() => scene.createInstances(empty, 4)).toThrow('E1417');
		const prefab = chainPrefab(core, 1);
		const instanced = new Prefab(
			core,
			'trees.glb',
			prefab.template,
			prefab.parts,
			[
				{
					node: 1,
					count: 1,
					positions: new Float32Array(3),
					rotations: new Float32Array([0, 0, 0, 1]),
					scales: new Float32Array([1, 1, 1]),
					parts: prefab.parts,
				},
			],
			prefab.bounds,
			[],
			[],
		);
		expect(() => scene.createInstances(instanced, 4)).toThrow('instancing of its own');
	});
});

describe('prefab.find and bounds', () => {
	test('find gives a node of the template, and bounds hold the box and its sphere', () => {
		const { core } = fakeCore();
		const prefab = chainPrefab(core, 2);
		const link = prefab.find('link 1');
		expect(link?.position).toEqual([0, 1, 0]);
		expect(link?.mesh?.radius).toBe(0.5);
		expect(prefab.find('nothing')).toBeUndefined();
		expect(prefab.bounds.center).toEqual([0, 1, 0]);
		expect(prefab.bounds.radius).toBeCloseTo(Math.hypot(0.5, 1, 0.5));
	});
});

describe('animated prefabs', () => {
	/** A prefab whose root animates with a rig of two joints, and a skinned mesh of it. */
	function animatedPrefab(core: CoreMemory): Prefab {
		const mesh = new MeshGeometry(7, 0.5, core);
		const material = new Material(4, core, 'materials.standard.set');
		const joint = (name: string, parent: number) => ({
			name,
			parent,
			translation: [0, 1, 0] as [number, number, number],
			rotation: [0, 0, 0, 1] as [number, number, number, number],
			scale: [1, 1, 1] as [number, number, number],
			inverseBind: [1, 0, 0, 0, 0, 1, 0, -1, 0, 0, 1, 0],
			bone: true,
		});
		const rig = new AnimationRig(1, new Map([['Wave', 1]]), [joint('Hip', -1), joint('Knee', 0)]);
		const template = [
			node({ parent: -1, root: true }),
			node({ name: 'Leg', parent: 0, mesh, material, skinned: true }),
			node({ name: 'Hat', parent: 0, mesh, material }),
		];
		const bounds = boundsOf([0, 0, 0], [1, 1, 1]);
		return new Prefab(core, 'https://example.com/leg.glb', template, [], [], bounds, [], [], rig);
	}

	test("a copy's group gets the animator, which skins the copy's skinned meshes", () => {
		const { core, scene } = fakeCore();
		const prefab = animatedPrefab(core);
		expect(prefab.clips).toEqual(['Wave']);
		const copy = scene.instantiate(prefab);
		const animator = copy.animator();
		expect(animator.clips).toEqual(['Wave']);
		expect(animator.skinned).toEqual([copy.find('Leg') as Mesh]);
		expect(animator.rig.bindPlaces).toEqual(new Float64Array([0, 1, 0, 0, 1, 0]));
		expect(scene.instantiate(prefab).animator()).not.toBe(animator);
	});

	/** A prefab whose root animates with a rig, and a face of two morph targets that its clips animate. */
	function facePrefab(core: CoreMemory): Prefab {
		const face = new MeshGeometry(9, 0.5, core, 2, ['Smile', 'Blink']);
		const material = new Material(4, core, 'materials.standard.set');
		const weights = (name: string) => ({
			name,
			parent: -1,
			translation: [0, 0, 0] as [number, number, number],
			rotation: [0, 0, 0, 1] as [number, number, number, number],
			scale: [0, 0, 0] as [number, number, number],
			inverseBind: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
		});
		const rig = new AnimationRig(1, new Map([['Talk', 1]]), [weights('Face')]);
		const morph = { weights: [0.25, 0.5], joint: 0 };
		const template = [
			node({ parent: -1, root: true }),
			node({ name: 'Face', parent: 0, mesh: face, material, morph }),
		];
		const bounds = boundsOf([0, 0, 0], [1, 1, 1]);
		return new Prefab(core, 'https://example.com/face.glb', template, [], [], bounds, [], [], rig);
	}

	test("a copy's morphed mesh gets weights of its own, which the copy's clips animate", () => {
		const { core, scene, take, morphs } = fakeCore();
		const copy = scene.instantiate(facePrefab(core));
		const face = copy.find('Face') as Mesh;
		// The file's default weights, by number or by name.
		expect([face.getMorphWeight(0), face.getMorphWeight('Blink')]).toEqual([0.25, 0.5]);
		const block = face.morphBlock;
		expect(block).toBeGreaterThan(0);
		expect(take().some(([op, , a]) => op === C.COMMAND_SET_MORPH && a === block)).toBe(true);
		// The weights link to the copy's animated instance and the rig's first weights joint.
		expect(copy.animator().morphed).toEqual([face]);
		expect(morphs[block - 1]?.link).toEqual([copy.animator().instance, 0]);

		face.setMorphWeight('Smile', 0.75);
		face.setMorphWeight(1, -1);
		expect([face.getMorphWeight(0), face.getMorphWeight(1)]).toEqual([0.75, -1]);
		// A clone copies the weights into a block of its own, linked to its own animator.
		const twin = scene.clone(copy);
		const twinFace = twin.find('Face') as Mesh;
		expect(twinFace.morphBlock).not.toBe(block);
		expect([twinFace.getMorphWeight(0), twinFace.getMorphWeight(1)]).toEqual([0.75, -1]);
		expect(morphs[twinFace.morphBlock - 1]?.link).toEqual([twin.animator().instance, 0]);
		// Destroying the face frees its weights.
		face.destroy();
		expect(morphs[block - 1]?.count).toBe(0);
	});

	test('setMorphWeight names the target it cannot find, and refuses a weight that is not finite', () => {
		const { core, scene } = fakeCore();
		const face = scene.instantiate(facePrefab(core)).find('Face') as Mesh;
		expect(() => face.setMorphWeight('Frown', 1)).toThrow(
			'E1218: setMorphWeight() got "Frown", which names no morph target of "Face" (slot 2), which has 2 morph targets: Smile, Blink.',
		);
		expect(() => face.getMorphWeight(2)).toThrow('E1218: getMorphWeight() got 2');
		expect(() => face.setMorphWeight(-1, 1)).toThrow('E1218');
		expect(() => face.setMorphWeight(0, Number.NaN)).toThrow('E1203');
		const plain = scene.createMesh({
			mesh: new MeshGeometry(7, 0.5, core),
			material: new Material(4, core, 'materials.standard.set'),
		});
		expect(() => plain.setMorphWeight(0, 1)).toThrow('which has no morph targets');
	});

	test("a clone of an animated copy animates on its own, and skins the clone's meshes", () => {
		const { core, scene } = fakeCore();
		const copy = scene.instantiate(animatedPrefab(core));
		const twin = scene.clone(copy);
		const animator = twin.animator();
		expect(animator).not.toBe(copy.animator());
		expect(animator.instance).toBe(2);
		expect(animator.skinned).toEqual([twin.find('Leg') as Mesh]);
		expect((twin.find('Leg') as Mesh).animation).toBeUndefined();
	});
});

describe('whole copies', () => {
	/** The chain prefab with instancing of its own on its first link. */
	function instancedPrefab(core: CoreMemory): Prefab {
		const chain = chainPrefab(core, 2);
		const spec = {
			node: 1,
			count: 2,
			positions: new Float32Array(6),
			rotations: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1]),
			scales: new Float32Array([1, 1, 1, 1, 1, 1]),
			parts: chain.parts.slice(0, 1),
		};
		return new Prefab(core, chain.url, chain.template, chain.parts, [spec], chain.bounds, [], []);
	}

	test('layers reach every object of the copy and its batches, not the group alone', () => {
		const { core, scene, take, batchLayers } = fakeCore();
		const copy = scene.instantiate(instancedPrefab(core), { layers: 1 << 2 });
		const records = take();
		const creates = records.filter((r) => ((r[0] as number) & 0xff) === C.COMMAND_CREATE);
		const layered = records.filter((r) => r[0] === C.COMMAND_SET_LAYERS);
		expect(creates).toHaveLength(3);
		expect(layered.map((r) => [r[1], r[2]])).toEqual(creates.map((r) => [r[1], 1 << 2]));
		expect(copy.objects.map((o) => o.layerMask)).toEqual([4, 4, 4]);
		expect([...batchLayers.values()]).toEqual([4]);
	});

	test("destroying a copy's group removes every object of the copy and its batches", () => {
		const { core, scene, take, destroyedBatches } = fakeCore();
		const copy = scene.instantiate(instancedPrefab(core));
		const [batch] = copy.batches;
		const kept = scene.createGroup({ name: 'kept', parent: copy.find('link 1') });
		take();
		copy.destroy();
		const destroyed = take().filter((r) => r[0] === C.COMMAND_DESTROY);
		expect(destroyed.map((r) => r[1])).toEqual(copy.objects.map((o) => o.handle));
		expect(copy.objects.every((o) => o.destroyedFrame >= 0)).toBe(true);
		expect(destroyedBatches).toEqual([batch?.id as number]);
		// An object that the sketch put under the copy later becomes a root.
		expect(kept.destroyedFrame).toBe(-1);
		expect(kept.liveParent).toBeNull();
	});

	test('a copy that the animation table cannot hold leaves no object behind', () => {
		const { core, scene, take, failure } = fakeCore();
		const rig = new AnimationRig(1, new Map([['Wave', 1]]), [
			{
				name: 'Hip',
				parent: -1,
				translation: [0, 0, 0],
				rotation: [0, 0, 0, 1],
				scale: [1, 1, 1],
				inverseBind: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
			},
		]);
		const chain = chainPrefab(core, 2);
		const prefab = new Prefab(core, chain.url, chain.template, [], [], chain.bounds, [], [], rig);
		Object.assign(failure, { animations: true, code: 1102, details: [6, 1024] });
		expect(() => scene.instantiate(prefab, { name: 'hero' })).toThrow('E1102');
		const records = take();
		const created = records.filter((r) => ((r[0] as number) & 0xff) === C.COMMAND_CREATE);
		const destroyed = records.filter((r) => r[0] === C.COMMAND_DESTROY);
		expect(created).toHaveLength(3);
		expect(destroyed.map((r) => r[1]).sort()).toEqual(created.map((r) => r[1]).sort());
		expect(scene.find('hero')).toBeUndefined();
		expect(scene.find('link 0')).toBeUndefined();
	});

	test('a full command ring fails createMesh before it reserves a slot', () => {
		const { core, scene, calls, take } = fakeCore();
		const group = scene.createGroup();
		take();
		const reserved = calls.reserveObject;
		// Leave room for one record, where a mesh takes two: its create and its material.
		for (let k = 0; k < RING - 1; k++) group.setVisible(k % 2 === 0);
		const mesh = new MeshGeometry(3, 1, core);
		const material = new Material(2, core, 'materials.standard.set');
		expect(() => scene.createMesh({ name: 'late', mesh, material })).toThrow('E1102');
		expect(calls.reserveObject).toBe(reserved);
		expect(take()).toHaveLength(RING - 1);
		expect(scene.find('late')).toBeUndefined();
	});

	test('a light that the light table cannot hold leaves no object behind', () => {
		const { scene, take, failure } = fakeCore();
		Object.assign(failure, { lights: true, code: 1102, details: [8, 4096] });
		expect(() => scene.createPointLight({ name: 'lamp', range: 5 })).toThrow();
		const records = take();
		expect(records.map((r) => (r[0] as number) & 0xff)).toEqual([
			C.COMMAND_CREATE,
			C.COMMAND_DESTROY,
		]);
		expect(scene.find('lamp')).toBeUndefined();
	});
});

describe('clone walks the tree it copies', () => {
	test('objects moved into and out of a tree with setParent are copied where they are now', () => {
		const { scene, take } = fakeCore();
		const cart = scene.createGroup({ name: 'cart' });
		const wheel = scene.createGroup({ name: 'wheel', parent: cart });
		const crate = scene.createGroup({ name: 'crate' });
		crate.setParent(wheel);
		wheel.setParent(null);
		take();
		scene.clone(cart);
		expect(take()).toHaveLength(1);
		scene.clone(wheel);
		expect(take()).toHaveLength(2);
	});

	test('destroyed children leave the tree that a clone copies', () => {
		const { scene, take } = fakeCore();
		const leaf = scene.createGroup({ name: 'leaf' });
		for (let k = 0; k < 2000; k++) scene.createGroup({ parent: k % 2 ? leaf : null }).destroy();
		expect(leaf.childObjects?.size ?? 0).toBe(0);
		take();
		scene.clone(leaf);
		expect(take()).toHaveLength(1);
	});
});
