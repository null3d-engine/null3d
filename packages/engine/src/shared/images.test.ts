import { describe, expect, test } from 'bun:test';
import { controlViews, createControlBuffer, Slot } from './control';
import { ImageTable, imagesArrived, receiveImages, sendThrough, sendToTable } from './images';

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
});
