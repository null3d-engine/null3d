import { describe, expect, test } from 'bun:test';
import { controlViews, createControlBuffer, Slot } from './control';
import {
	type CustomShader,
	ImageTable,
	imagesArrived,
	receiveImages,
	sendThrough,
	sendToTable,
	shadersThrough,
	shadersToTable,
} from './images';
import { setWakeByMessage, WAKE } from './wake';

/** A decoded image as the tests need one: a close that the test can see. */
function image(): ImageBitmap & { closed: boolean } {
	const bitmap = {
		closed: false,
		close() {
			bitmap.closed = true;
		},
	};
	return bitmap as unknown as ImageBitmap & { closed: boolean };
}

describe('the image table', () => {
	test('keeps one image per id, and closes each image it lets go of', () => {
		const table = new ImageTable();
		const [first, second, third] = [image(), image(), image()];
		table.set(1, first);
		table.set(1, second);
		expect(first.closed).toBe(true);
		expect(table.get(1)).toBe(second);
		table.set(2, third);
		table.release(1);
		table.release(1);
		expect(second.closed).toBe(true);
		expect(table.get(1)).toBeUndefined();
		table.clear();
		expect(third.closed).toBe(true);
		expect(table.get(2)).toBeUndefined();
	});
});

describe('images on their way to the thread that draws', () => {
	test('reach a table on this thread at once, each counted as it arrives', async () => {
		const { slots } = controlViews(createControlBuffer(true));
		const table = new ImageTable();
		const send = sendToTable(table, slots);
		const [first, second] = [image(), image()];
		send(1, first);
		send(2, second);
		expect(Atomics.load(slots, Slot.ImagesArrived)).toBe(2);
		expect(table.get(2)).toBe(second);
		await imagesArrived(slots, 2);
	});

	test('cross a port in order, and a wait ends once every image sent arrived', async () => {
		const { slots } = controlViews(createControlBuffer(true));
		const table = new ImageTable();
		const posted: [unknown, Transferable[]][] = [];
		const port = {
			onmessage: null as ((event: MessageEvent) => void) | null,
			postMessage(message: unknown, transfer: Transferable[]) {
				posted.push([message, transfer]);
			},
		} as unknown as MessagePort;
		const send = sendThrough(port);
		const [first, second] = [image(), image()];
		send(1, first);
		send(2, second);
		// Each image moves with its message instead of being copied.
		expect(posted.map(([message, transfer]) => [message, transfer[0]])).toEqual([
			[{ id: 1, image: first }, first],
			[{ id: 2, image: second }, second],
		]);
		receiveImages(port, table, slots);
		const arrived = imagesArrived(slots, 2);
		for (const [message] of posted) port.onmessage?.({ data: message } as MessageEvent);
		await arrived;
		expect(Atomics.load(slots, Slot.ImagesArrived)).toBe(2);
		expect([table.get(1), table.get(2)]).toEqual([first, second]);
	});

	test('each arrival sends a wake back through its port, where the threads wake with messages', () => {
		setWakeByMessage(true);
		try {
			const { slots } = controlViews(createControlBuffer(true));
			const posted: unknown[] = [];
			const port = {
				onmessage: null as ((event: MessageEvent) => void) | null,
				postMessage: (message: unknown) => posted.push(message),
			} as unknown as MessagePort;
			receiveImages(port, new ImageTable(), slots);
			port.onmessage?.({ data: { id: 1, image: image() } } as MessageEvent);
			expect(Atomics.load(slots, Slot.ImagesArrived)).toBe(1);
			expect(posted).toEqual([WAKE]);
		} finally {
			setWakeByMessage(false);
		}
	});
});

describe('texture generators on their way to the thread that draws', () => {
	test('count once their code has loaded, and images after them count after them', async () => {
		const { slots } = controlViews(createControlBuffer(true));
		const table = new ImageTable();
		const send = sendToTable(table, slots);
		const code = { room: () => {} };
		let load: (loaded: unknown) => void = () => {};
		const loading = new Promise((resolve) => {
			load = resolve;
		});
		table.loadGeneratorsWith(() => loading);
		const later = image();
		send(1, 'room');
		send(2, later);
		const arrived = imagesArrived(slots, 2);
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(Atomics.load(slots, Slot.ImagesArrived)).toBe(0);
		load(code);
		await arrived;
		expect(Atomics.load(slots, Slot.ImagesArrived)).toBe(2);
		expect(table.generator(1)).toEqual(['room', code]);
		expect(table.get(2)).toBe(later);
		table.release(1);
		expect(() => table.generator(1)).toThrow('draw list names generator 1, which does not exist');
	});

	test('cross a port by name, and count when their code did not load, which running one reports', async () => {
		const { slots } = controlViews(createControlBuffer(true));
		const table = new ImageTable();
		const posted: unknown[] = [];
		const port = {
			onmessage: null as ((event: MessageEvent) => void) | null,
			postMessage: (message: unknown) => posted.push(message),
		} as unknown as MessagePort;
		sendThrough(port)(1, 'room');
		expect(posted).toEqual([{ id: 1, generator: 'room' }]);
		receiveImages(port, table, slots);
		table.loadGeneratorsWith(() => Promise.reject(new Error('offline')));
		port.onmessage?.({ data: posted[0] } as MessageEvent);
		await imagesArrived(slots, 1);
		expect(() => table.generator(1)).toThrow(
			'the code of the room generator did not download: offline',
		);
	});
});

describe("custom materials' shaders on their way to the thread that draws", () => {
	const shader: CustomShader = { variants: {}, locations: [0, 1, 2], textures: 0 };

	test('cross the port of the images by template, and no image counts them', () => {
		const { slots } = controlViews(createControlBuffer(true));
		const table = new ImageTable();
		const posted: unknown[] = [];
		const port = {
			onmessage: null as ((event: MessageEvent) => void) | null,
			postMessage(message: unknown) {
				posted.push(message);
			},
		} as unknown as MessagePort;
		shadersThrough(port)(64, shader);
		expect(posted).toEqual([{ template: 64, shader }]);
		receiveImages(port, table, slots);
		port.onmessage?.({ data: posted[0] } as MessageEvent);
		expect(table.shaders.get(64)).toBe(shader);
		expect(Atomics.load(slots, Slot.ImagesArrived)).toBe(0);
	});

	test('reach a table on this thread at once, which forgets them when it clears', () => {
		const table = new ImageTable();
		shadersToTable(table)(65, shader);
		expect(table.shaders.get(65)).toBe(shader);
		table.clear();
		expect(table.shaders.size).toBe(0);
	});
});

describe('features whose shader files the sketch asks for early', () => {
	test("reach the renderer's listener once each, and a cleared table lets go of the listener", () => {
		const table = new ImageTable();
		const heard: string[] = [];
		table.onPreload = (feature) => heard.push(feature);
		table.preload(['skinning', 'bloom']);
		table.preload(['skinning']);
		expect(heard).toEqual(['skinning', 'bloom']);
		// A stopped drawing clears its table. The page's end of the image port keeps the table, so
		// a listener that stayed would keep the stopped renderer and the engine's memory.
		table.clear();
		expect(table.onPreload).toBeUndefined();
	});
});
