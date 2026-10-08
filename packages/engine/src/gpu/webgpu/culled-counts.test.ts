import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { SAMPLED_EVERY } from '../../shared/metrics';
import { CulledCounts } from './culled-counts';

const scope = globalThis as Record<string, unknown>;
const GLOBALS = {
	GPUBufferUsage: { MAP_READ: 1, COPY_DST: 8 },
	GPUMapMode: { READ: 1 },
};
beforeAll(() => Object.assign(scope, GLOBALS));
afterAll(() => {
	for (const name of Object.keys(GLOBALS)) delete scope[name];
});

/** A buffer of indirect draws: its arguments by byte offset, five words each. */
interface DrawBuffer {
	name: string;
	draws: Map<number, [indices: number, instances: number]>;
}

/**
 * A device whose copies move the arguments of the draw buffers into the readback buffer, which
 * maps at once.
 */
function fakeDevice() {
	const log: string[] = [];
	const readbacks: { size: number; words: Uint32Array; destroyed: boolean }[] = [];
	const device = {
		createBuffer({ size }: GPUBufferDescriptor) {
			const words = new Uint32Array(size / 4);
			const readback = {
				size,
				words,
				destroyed: false,
				mapAsync: () => Promise.resolve(),
				getMappedRange: () => words.slice().buffer,
				unmap() {},
				destroy() {
					readback.destroyed = true;
				},
			};
			readbacks.push(readback);
			return readback;
		},
	} as unknown as GPUDevice;
	const encoder = {
		copyBufferToBuffer(
			source: DrawBuffer,
			from: number,
			target: (typeof readbacks)[number],
			to: number,
			bytes: number,
		) {
			log.push(`copy ${source.name} ${from} to ${to}, ${bytes} bytes`);
			for (const [offset, [indices, instances]] of source.draws) {
				if (offset < from || offset >= from + bytes) continue;
				const word = (to + offset - from) / 4;
				target.words[word] = indices;
				target.words[word + 1] = instances;
			}
		},
	} as unknown as GPUCommandEncoder;
	return { device, encoder, log, readbacks };
}

const asBuffer = (buffer: DrawBuffer) => buffer as unknown as GPUBuffer;

/** Lets the readback's mapping resolve. */
const mapped = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('CulledCounts', () => {
	it('reads back the counts of the culled draws on a sampled frame, and adds them up', async () => {
		const { device, encoder, log } = fakeDevice();
		const counts = new CulledCounts(device);
		const views: DrawBuffer = {
			name: 'views',
			draws: new Map([
				[0, [36, 5]],
				[40, [6, 2]],
			]),
		};
		const lines: DrawBuffer = { name: 'lines', draws: new Map([[20, [10, 3]]]) };
		counts.beginFrame(true);
		counts.note(asBuffer(views), 40, false);
		counts.note(asBuffer(views), 0, false);
		counts.note(asBuffer(lines), 20, true);
		counts.copy(encoder);
		counts.afterSubmit();
		// Each buffer of draws copies once, from its first noted draw to the end of its last.
		expect(log).toEqual(['copy views 0 to 0, 60 bytes', 'copy lines 20 to 60, 20 bytes']);
		expect(counts.triangles).toBe(0);
		await mapped();
		// 12 triangles 5 times and 2 triangles twice; the lines add instances and no triangles.
		expect(counts.triangles).toBe(64);
		expect(counts.instances).toBe(10);
	});

	it('samples one frame in every SAMPLED_EVERY, and only while the page samples', async () => {
		const { device, encoder, log } = fakeDevice();
		const counts = new CulledCounts(device);
		const views: DrawBuffer = { name: 'views', draws: new Map([[0, [3, 7]]]) };
		let sampling = false;
		const frame = () => {
			counts.beginFrame(sampling);
			counts.note(asBuffer(views), 0, false);
			counts.copy(encoder);
			counts.afterSubmit();
		};
		frame();
		expect(log).toEqual([]);
		sampling = true;
		for (let k = 0; k <= SAMPLED_EVERY; k++) frame();
		expect(log.length).toBe(2);
		await mapped();
		expect(counts.instances).toBe(7);
		// Once nobody samples, the counts go back to 0 at the next frame.
		sampling = false;
		frame();
		expect(counts.triangles).toBe(0);
		expect(counts.instances).toBe(0);
	});

	it('copies at the submit that follows the draws, and counts 0 for a sampled frame without any', async () => {
		const { device, encoder, log } = fakeDevice();
		const counts = new CulledCounts(device);
		const views: DrawBuffer = { name: 'views', draws: new Map([[0, [6, 4]]]) };
		counts.beginFrame(true);
		// A submit before the frame's passes, as for texture copies, copies nothing.
		counts.copy(encoder);
		counts.afterSubmit();
		counts.note(asBuffer(views), 0, false);
		counts.copy(encoder);
		counts.afterSubmit();
		expect(log).toEqual(['copy views 0 to 0, 20 bytes']);
		await mapped();
		expect(counts.triangles).toBe(8);
		for (let k = 1; k < SAMPLED_EVERY; k++) counts.beginFrame(true);
		// The next sampled frame draws nothing that the GPU culled.
		counts.beginFrame(true);
		counts.copy(encoder);
		counts.afterSubmit();
		counts.beginFrame(true);
		expect(counts.triangles).toBe(0);
		expect(counts.instances).toBe(0);
	});

	it('grows its readback buffer for a frame with more draws, and destroys it at the end', async () => {
		const { device, encoder, readbacks } = fakeDevice();
		const counts = new CulledCounts(device);
		const draws = new Map<number, [number, number]>();
		for (let k = 0; k < 300; k++) draws.set(20 * k, [3, 1]);
		const many: DrawBuffer = { name: 'many', draws };
		counts.beginFrame(true);
		for (const offset of draws.keys()) counts.note(asBuffer(many), offset, false);
		counts.copy(encoder);
		counts.afterSubmit();
		await mapped();
		expect(counts.triangles).toBe(300);
		expect(readbacks[0]?.size).toBe(8192);
		counts.destroy();
		expect(readbacks[0]?.destroyed).toBe(true);
	});
});
