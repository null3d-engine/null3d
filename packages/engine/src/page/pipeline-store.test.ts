import { describe, expect, it } from 'bun:test';
import { OP_CREATE_COMPUTE_PIPELINE, OP_CREATE_RENDER_PIPELINE } from '../generated/gpu';
import { isPipelineList, PipelineStore, pipelineConditions } from './pipeline-store';

const SKETCH = 'https://example.com/sketch.js';
const LIST = Uint32Array.of(
	OP_CREATE_RENDER_PIPELINE,
	3,
	5,
	1,
	2,
	1,
	0,
	3,
	0,
	0,
	OP_CREATE_COMPUTE_PIPELINE,
	4,
	6,
);

/** A localStorage stand-in that keeps its items in a map, or refuses every call when `blocked`. */
function memoryStorage(blocked = false) {
	const items = new Map<string, string>();
	const refuse = () => {
		throw new Error('SecurityError');
	};
	const storage = {
		getItem: (key: string) => (blocked ? refuse() : (items.get(key) ?? null)),
		setItem: (key: string, value: string) => (blocked ? refuse() : void items.set(key, value)),
	};
	return { items, storage: storage as unknown as Storage };
}

const CONDITIONS = pipelineConditions('webgpu', 0, 'medium', 'bgra8unorm');

describe('the stored pipeline list', () => {
	it('gives back the list that a start with the same conditions stored', () => {
		const { storage } = memoryStorage();
		new PipelineStore(SKETCH, CONDITIONS, storage).save(LIST);
		expect(Array.from(new PipelineStore(SKETCH, CONDITIONS, storage).read() ?? [])).toEqual(
			Array.from(LIST),
		);
	});

	it('applies to the same sketch only', () => {
		const { storage } = memoryStorage();
		new PipelineStore(SKETCH, CONDITIONS, storage).save(LIST);
		expect(new PipelineStore(`${SKETCH}?other`, CONDITIONS, storage).read()).toBeUndefined();
	});

	it('applies to a start on the same path, shader bits, preset and canvas format only', () => {
		const { storage } = memoryStorage();
		new PipelineStore(SKETCH, CONDITIONS, storage).save(LIST);
		for (const conditions of [
			pipelineConditions('webgpu-compat', 0, 'medium', 'bgra8unorm'),
			pipelineConditions('webgpu', 1, 'medium', 'bgra8unorm'),
			pipelineConditions('webgpu', 0, 'low', 'bgra8unorm'),
			pipelineConditions('webgpu', 0, 'medium', 'rgba8unorm'),
		])
			expect(new PipelineStore(SKETCH, conditions, storage).read()).toBeUndefined();
	});

	it('reads storage that refuses or holds other text as empty, and stores nothing there', () => {
		const blocked = memoryStorage(true);
		const refused = new PipelineStore(SKETCH, CONDITIONS, blocked.storage);
		refused.save(LIST);
		expect(refused.read()).toBeUndefined();
		const { items, storage } = memoryStorage();
		const store = new PipelineStore(SKETCH, CONDITIONS, storage);
		for (const text of [
			'not json',
			'null',
			'{"conditions":1}',
			JSON.stringify({ conditions: CONDITIONS, list: [1, 2] }),
		]) {
			items.set(`null3d.pipelines:${SKETCH}`, text);
			expect(store.read()).toBeUndefined();
		}
	});

	it('takes whole create commands of whole numbers only', () => {
		expect(isPipelineList(Array.from(LIST))).toBe(true);
		expect(isPipelineList([])).toBe(false);
		expect(isPipelineList([OP_CREATE_COMPUTE_PIPELINE, 4])).toBe(false);
		expect(isPipelineList([OP_CREATE_COMPUTE_PIPELINE, 4, 1.5])).toBe(false);
		expect(isPipelineList([OP_CREATE_COMPUTE_PIPELINE, 4, -1])).toBe(false);
		expect(isPipelineList([0, 4, 6])).toBe(false);
	});
});
