// The instance adapter of the feature description: the checks that it refuses a feature it cannot
// place, the buffers and calls that it makes on the GPU path, and the batch that it fills on the
// CPU path. Stand-ins stand in for the core, the geometry, the material and the object makers, so
// the test reads no GPU.
import { describe, expect, it } from 'bun:test';
import { type ComputeInstancesHost, createComputeInstances } from './feature-instances';
import type { FeatureDescription } from './features';

/** The vertex data of one square, which a stand-in geometry accepts. */
const VERTICES = { positions: new Float32Array([0, 0, 0]) };

/** The WGSL of the stand-in, as plain text so that a uniform of any name fits its type. */
const WGSL: string = 'wgsl';

/** A description of an instance draw at the frame that the adapter places. */
function description(extra: Record<string, unknown> = {}): FeatureDescription {
	return {
		name: 'splats',
		kind: 'draw',
		frame: 'opaque',
		views: ['main'],
		...extra,
	} as unknown as FeatureDescription;
}

/** A core of stand-in calls, which records what the adapter asks it to do. */
function core(calls: string[]) {
	const glue: Record<string, unknown> = {
		createFeatureInstances: (slot: number, capacity: number) => {
			calls.push(`createFeatureInstances ${slot} ${capacity}`);
			return 7;
		},
		destroyFeatureInstances: (id: number) => {
			calls.push(`destroyFeatureInstances ${id}`);
			return 0;
		},
		setFeatureInstanceCount: (id: number, count: number) => {
			calls.push(`setFeatureInstanceCount ${id} ${count}`);
			return 0;
		},
		setFeatureInstanceRows: (id: number, start: number, count: number) => {
			calls.push(`setFeatureInstanceRows ${id} ${start} ${count}`);
			return 0;
		},
		featureInstanceBuffer: () => 41,
		featureInstanceCountBuffer: () => 42,
	};
	return {
		glue,
		checkGrowth: (id: number) => id,
		check: (value: number) => value,
	} as never;
}

/** The makers of a host, recording each call, and the objects that they hand out. */
function standIns(webgl2: boolean, calls: string[]) {
	const material = {
		destroy: () => calls.push('material.destroy'),
	};
	const mesh = {
		destroy: () => calls.push('mesh.destroy'),
	};
	const object = {
		slot: 3,
		destroy: () => calls.push('object.destroy'),
		setFrustumCulled: (culled: boolean) => calls.push(`object.setFrustumCulled ${culled}`),
		setVisible: () => {},
		setRenderOrder: () => {},
	};
	const positions = new Float32Array(4 * 3);
	const rotations = new Float32Array(4 * 4);
	const scales = new Float32Array(4 * 3);
	const batch = {
		count: 4,
		positions,
		rotations,
		scales,
		destroy: () => calls.push('batch.destroy'),
		setFrustumCulled: (culled: boolean) => calls.push(`batch.setFrustumCulled ${culled}`),
		setLayers: () => {},
		setActiveCount: (count: number) => calls.push(`batch.setActiveCount ${count}`),
		markDirty: (start: number, count: number) => calls.push(`batch.markDirty ${start} ${count}`),
		setVisible: () => {},
		setRenderOrder: () => {},
	};
	const host: ComputeInstancesHost = {
		webgl2,
		core: core(calls),
		geometry: {
			fromArrays: () => {
				calls.push('fromArrays');
				return mesh;
			},
		} as unknown as ComputeInstancesHost['geometry'],
		materials: {
			shader: () => {
				calls.push('shader');
				return material;
			},
		} as unknown as ComputeInstancesHost['materials'],
		createMesh: () => {
			calls.push('createMesh');
			return object as never;
		},
		createBatch: (drawn, look, count) => {
			expect(drawn).toBe(mesh as never);
			expect(look).toBe(material as never);
			calls.push(`createBatch ${count}`);
			return batch as never;
		},
		fail: (detail) => {
			calls.push('fail');
			return new Error(`E1223: ${detail}`);
		},
	};
	return { host, material, mesh, object, batch, positions, rotations, scales };
}

/** The 16 floats of one instance: a 2× scale on y, a quarter turn about z, moved to (5, 6, 7). */
const INSTANCE = new Float32Array([0, 2, 0, 5, -1, 0, 0, 6, 0, 0, 1, 7, 0, 0, 0, 0]);

describe('createComputeInstances', () => {
	it('refuses a description that an instance draw cannot place', () => {
		for (const wrong of [
			description({ kind: 'compute' }),
			description({ frame: 'transparent' }),
			description({ views: ['main', 'reflection'] }),
		]) {
			const calls: string[] = [];
			const { host } = standIns(false, calls);
			expect(() =>
				createComputeInstances(wrong, { shader: WGSL, vertices: VERTICES, capacity: 4 }, host),
			).toThrow('E1223');
			expect(calls).toEqual(['fail']);
		}
	});

	it('refuses a capacity or a count that the draw cannot take', () => {
		for (const options of [
			{ capacity: 0 },
			{ capacity: 1.5 },
			{ capacity: 2 ** 21 },
			{ capacity: 4, count: 5 },
			{ capacity: 4, count: -1 },
		]) {
			const calls: string[] = [];
			const { host } = standIns(false, calls);
			expect(() =>
				createComputeInstances(
					description(),
					{ shader: WGSL, vertices: VERTICES, ...options } as never,
					host,
				),
			).toThrow('E1223');
			expect(calls).toEqual(['fail']);
		}
	});

	it('makes the object and the two buffers on the GPU path', () => {
		const calls: string[] = [];
		const { host } = standIns(false, calls);
		const draw = createComputeInstances(
			description(),
			{ shader: WGSL, vertices: VERTICES, capacity: 4, count: 2 },
			host,
		);
		expect(calls).toEqual([
			'shader',
			'fromArrays',
			'createMesh',
			'object.setFrustumCulled false',
			'createFeatureInstances 3 4',
			'setFeatureInstanceCount 7 2',
		]);
		expect(draw.counts.buffer).toBe(42);
		expect(draw.instances.buffer).toBe(41);
		expect(draw.count).toBe(2);
		// The count and the rows reach the core, whose frame copies the count into the draw.
		draw.setCount(3);
		draw.setInstances(INSTANCE, 1);
		expect(calls.slice(-3)).toEqual([
			'setFeatureInstanceCount 7 3',
			'setFeatureInstanceRows 7 0 1',
			'setFeatureInstanceCount 7 1',
		]);
		expect(draw.count).toBe(1);
		expect(() => draw.setCount(5)).toThrow('E1108');
		expect(() => draw.setInstances(new Float32Array(8), 1)).toThrow('E1108');
		draw.destroy();
		expect(calls.slice(-4)).toEqual([
			'destroyFeatureInstances 7',
			'object.destroy',
			'material.destroy',
			'mesh.destroy',
		]);
	});

	it('fills an unculled instance batch on the CPU path', () => {
		const calls: string[] = [];
		const { host, positions, rotations, scales } = standIns(true, calls);
		const draw = createComputeInstances(
			description(),
			{ shader: WGSL, vertices: VERTICES, capacity: 4, count: 2 },
			host,
		);
		expect(calls).toEqual([
			'shader',
			'fromArrays',
			'createBatch 4',
			'batch.setFrustumCulled false',
			'batch.setActiveCount 2',
		]);
		draw.setInstances(INSTANCE, 1);
		expect(calls.slice(-2)).toEqual(['batch.markDirty 0 1', 'batch.setActiveCount 1']);
		// The quarter turn's scale and place come out of the matrix rows.
		expect(Array.from(scales.slice(0, 3))).toEqual([1, 2, 1]);
		expect(Array.from(positions.slice(0, 3))).toEqual([5, 6, 7]);
		const [qx = 0, qy = 0, qz = 0, qw = 0] = rotations;
		expect(qx).toBeCloseTo(0, 6);
		expect(qy).toBeCloseTo(0, 6);
		expect(Math.abs(qz)).toBeCloseTo(Math.SQRT1_2, 6);
		expect(Math.abs(qw)).toBeCloseTo(Math.SQRT1_2, 6);
		draw.destroy();
		expect(calls.slice(-3)).toEqual(['batch.destroy', 'material.destroy', 'mesh.destroy']);
	});
});
