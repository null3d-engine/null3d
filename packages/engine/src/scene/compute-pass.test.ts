// The compute pass's checks: the compiled shader it takes, the workgroup grid, the dispatch counts
// and the description that places it. The test holds no GPU and ships nothing.
import { describe, expect, it } from 'bun:test';
import {
	type ComputePassOptions,
	checkComputeOptions,
	checkWorkgroup,
	computeSource,
	dispatchOf,
	workgroupSizeOf,
} from './compute-pass';
import type { FeatureDescription } from './features';
import type { CompiledWgsl } from './resources';

/** A compiled compute shader with `attributes` before its entry point. */
function shader(attributes: string): CompiledWgsl {
	return {
		kind: 'shader',
		webgpu: {
			wgsl: {
				source: `${attributes}\nfn main(@builtin(global_invocation_id) id: vec3u) {}\n`,
			},
		},
		webgl2: null,
	} as unknown as CompiledWgsl;
}

/** A description of a compute feature. */
const DESCRIPTION = {
	name: 'fft',
	frame: 'resolve',
	kind: 'compute',
} as FeatureDescription;

/** Valid options, which a test changes one field at a time. */
function options(overrides: Partial<ComputePassOptions> = {}): ComputePassOptions {
	return {
		kind: 'compute',
		description: DESCRIPTION,
		wgsl: shader('@compute @workgroup_size(8, 8, 1)'),
		writes: 'velocity',
		...overrides,
	} as ComputePassOptions;
}

/** The code of the error that `call` throws. */
function thrown(call: () => void): string {
	try {
		call();
	} catch (error) {
		return (error as { code?: string }).code ?? String(error);
	}
	throw new Error('the call did not throw');
}

describe('a compute pass shader', () => {
	it('takes a compiled shader with a @compute entry point', () => {
		const source = computeSource(shader('@compute @workgroup_size(8, 8, 1)'));
		expect(source).toContain('@compute');
	});

	it('refuses WGSL as text', () => {
		expect(thrown(() => computeSource('@compute fn main() {}'))).toStartWith('E1215');
	});

	it('refuses a compiled shader with no compute entry point', () => {
		const vertexOnly = {
			kind: 'shader',
			webgpu: { wgsl: { source: '@vertex fn vs() {}' } },
		} as unknown as CompiledWgsl;
		expect(thrown(() => computeSource(vertexOnly))).toStartWith('E1215');
	});

	it('refuses a compiled material', () => {
		expect(thrown(() => computeSource({ kind: 'material' } as CompiledWgsl))).toStartWith('E1215');
	});
});

describe('a workgroup size', () => {
	it('reads the shader attributes in any order and fills the missing axes with 1', () => {
		expect(workgroupSizeOf('@compute @workgroup_size(64) fn main() {}')).toEqual([64, 1, 1]);
		expect(workgroupSizeOf('@workgroup_size(8, 4) @compute fn main() {}')).toEqual([8, 4, 1]);
		expect(workgroupSizeOf('@compute @workgroup_size(8, 8, 1) fn main() {}')).toEqual([8, 8, 1]);
		expect(workgroupSizeOf('@compute fn main() {}')).toBeUndefined();
	});

	it('refuses a workgroup that a device the engine supports cannot run', () => {
		expect(thrown(() => checkWorkgroup([8, 8, 4]))).toStartWith('E1220');
		expect(thrown(() => checkWorkgroup([129, 1, 1]))).toStartWith('E1220');
		expect(thrown(() => checkWorkgroup([1, 1, 65]))).toStartWith('E1220');
		expect(thrown(() => checkWorkgroup([0, 1, 1]))).toStartWith('E1220');
		expect(() => checkWorkgroup([16, 8, 1])).not.toThrow();
	});
});

describe('a dispatch', () => {
	it('divides the target size by the workgroup and rounds up', () => {
		expect(dispatchOf([1920, 1080], [8, 8, 1])).toEqual([240, 135, 1]);
		expect(dispatchOf([1921, 1], [8, 8, 1])).toEqual([241, 1, 1]);
	});

	it('takes counts of its own', () => {
		expect(dispatchOf([1920, 1080], [8, 8, 1], [3, 2, 1])).toEqual([3, 2, 1]);
	});

	it('refuses a count of 0 or one past the most workgroups of an axis', () => {
		expect(thrown(() => dispatchOf([1, 1], [8, 8, 1], [0, 1, 1]))).toStartWith('E1220');
		expect(thrown(() => dispatchOf([1, 1], [8, 8, 1], [65_536, 1, 1]))).toStartWith('E1220');
	});
});

describe('the compute pass options', () => {
	it('takes a compute description and a shader whose size matches', () => {
		expect(checkComputeOptions(options())).toEqual({
			workgroup: [8, 8, 1],
			format: 'rgba16float',
		});
		expect(checkComputeOptions(options({ format: 'r32float' })).format).toBe('r32float');
	});

	it('refuses a description of another kind', () => {
		const draw = { name: 'cloud', frame: 'opaque', kind: 'draw' } as FeatureDescription;
		expect(thrown(() => checkComputeOptions(options({ description: draw })))).toStartWith('E1220');
	});

	it('refuses a workgroup size that differs from the shader', () => {
		expect(thrown(() => checkComputeOptions(options({ workgroupSize: [64, 1, 1] })))).toStartWith(
			'E1220',
		);
	});

	it('refuses a size and a scale together', () => {
		expect(
			thrown(() => checkComputeOptions(options({ size: [256, 256], scale: 0.5 }))),
		).toStartWith('E1220');
	});

	it('refuses an unknown format and an every below 1', () => {
		expect(
			thrown(() => checkComputeOptions(options({ format: 'rgba32float' as never }))),
		).toStartWith('E1220');
		expect(thrown(() => checkComputeOptions(options({ every: 0 })))).toStartWith('E1220');
	});
});
