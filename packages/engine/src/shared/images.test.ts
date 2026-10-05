import { describe, expect, test } from 'bun:test';
import { controlViews, createControlBuffer, Slot } from './control';
import {
	type CustomShader,
	ImageTable,
	imagesArrived,
	RECEIVING,
	receiveImages,
	sendThrough,
	sendToTable,
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

/**
 * One end of a channel as the tests need it: the messages posted through it, and the handler that
 * the code under test sets.
 */
function fakePort(): MessagePort & { posted: [unknown, Transferable[]][] } {
	const port = {
		posted: [] as [unknown, Transferable[]][],
		onmessage: null as ((event: MessageEvent) => void) | null,
		postMessage(message: unknown, transfer: Transferable[] = []) {
			port.posted.push([message, transfer]);
		},
	};
	return port as unknown as MessagePort & { posted: [unknown, Transferable[]][] };
}

/** Delivers a message to the handler of a fake port. */
function deliver(port: MessagePort, data: unknown): void {
	port.onmessage?.({ data } as MessageEvent);
}

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

	test('wait until the thread that draws receives, then cross the port in order', async () => {
		const { slots } = controlViews(createControlBuffer(true));
		const table = new ImageTable();
		const [sketchEnd, drawingEnd] = [fakePort(), fakePort()];
		const { sendImage } = sendThrough(sketchEnd);
		const [first, second, third] = [image(), image(), image()];
		sendImage(1, first);
		sendImage(2, second);
		// Nothing crosses before the thread that draws has made its renderer: Firefox can fail to
		// read an image that reaches that thread before then.
		const receiving = receiveImages(drawingEnd, table, slots);
		expect(drawingEnd.posted).toEqual([]);
		receiving();
		expect(sketchEnd.posted).toEqual([]);
		expect(drawingEnd.posted).toEqual([[RECEIVING, []]]);
		deliver(sketchEnd, RECEIVING);
		// Each image moves with its message instead of being copied.
		expect(sketchEnd.posted.map(([message, transfer]) => [message, transfer[0]])).toEqual([
			[{ id: 1, image: first }, first],
			[{ id: 2, image: second }, second],
		]);
		const arrived = imagesArrived(slots, 2);
		for (const [message] of sketchEnd.posted) deliver(drawingEnd, message);
		await arrived;
		expect(Atomics.load(slots, Slot.ImagesArrived)).toBe(2);
		expect([table.get(1), table.get(2)]).toEqual([first, second]);
		// Once the other end receives, an image crosses at once.
		sendImage(3, third);
		expect(sketchEnd.posted.at(-1)?.[0]).toEqual({ id: 3, image: third });
	});

	test('a message that the browser cannot read stops the thread that draws with an error', () => {
		const { slots } = controlViews(createControlBuffer(true));
		const drawingEnd = fakePort();
		receiveImages(drawingEnd, new ImageTable(), slots);
		expect(() => drawingEnd.onmessageerror?.({} as MessageEvent)).toThrow(
			'a texture image or shader that the sketch sent could not be read',
		);
	});

	test('each arrival sends a wake back through its port, where the threads wake with messages', () => {
		setWakeByMessage(true);
		try {
			const { slots } = controlViews(createControlBuffer(true));
			const port = fakePort();
			receiveImages(port, new ImageTable(), slots);
			deliver(port, { id: 1, image: image() });
			expect(Atomics.load(slots, Slot.ImagesArrived)).toBe(1);
			expect(port.posted.map(([message]) => message)).toEqual([WAKE]);
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
		const [sketchEnd, drawingEnd] = [fakePort(), fakePort()];
		sendThrough(sketchEnd).sendImage(1, 'room');
		deliver(sketchEnd, RECEIVING);
		expect(sketchEnd.posted).toEqual([[{ id: 1, generator: 'room' }, []]]);
		receiveImages(drawingEnd, table, slots);
		table.loadGeneratorsWith(() => Promise.reject(new Error('offline')));
		deliver(drawingEnd, sketchEnd.posted[0]?.[0]);
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
		const [sketchEnd, drawingEnd] = [fakePort(), fakePort()];
		sendThrough(sketchEnd).sendShader(64, shader);
		deliver(sketchEnd, RECEIVING);
		expect(sketchEnd.posted).toEqual([[{ template: 64, shader }, []]]);
		receiveImages(drawingEnd, table, slots);
		deliver(drawingEnd, sketchEnd.posted[0]?.[0]);
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
