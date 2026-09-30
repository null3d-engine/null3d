// Images for texture uploads, on their way from the sketch thread to the thread that draws. The
// engine core gives each image an id, counting from 1, and the sketch thread sends the images in
// id order. The thread that draws keeps them in a table and counts each one it receives in the
// control block, so the core knows which uploads can run. The table outlives each GPU device, so
// a new device can upload the images that it still holds.

import { Slot } from './control';

/** The images that the thread that draws holds, by id. */
export class ImageTable {
	private readonly images = new Map<number, ImageBitmap>();

	/** Keeps an image under its id, and closes one that the id named before. */
	set(id: number, image: ImageBitmap): void {
		this.images.get(id)?.close();
		this.images.set(id, image);
	}

	get(id: number): ImageBitmap | undefined {
		return this.images.get(id);
	}

	/** The image under an id, which a draw list's upload names, or a thrown error without one. */
	need(id: number): ImageBitmap {
		const image = this.images.get(id);
		if (!image) throw new Error(`draw list names image ${id}, which does not exist`);
		return image;
	}

	/** Closes an image and forgets it. */
	release(id: number): void {
		this.images.get(id)?.close();
		this.images.delete(id);
	}

	/** Closes every image. */
	clear(): void {
		for (const image of this.images.values()) image.close();
		this.images.clear();
	}
}

/** Sends an image, under its id, to the thread that draws. */
export type ImageSender = (id: number, image: ImageBitmap) => void;

/** A message that carries an image to the thread that draws. */
interface ImageMessage {
	id: number;
	image: ImageBitmap;
}

/** Counts an image that the thread that draws received, and wakes a thread that waits for it. */
function countArrival(slots: Int32Array): void {
	Atomics.add(slots, Slot.ImagesArrived, 1);
	Atomics.notify(slots, Slot.ImagesArrived);
}

/** Sends images through a port to another thread, which receives them with `receiveImages`. */
export function sendThrough(port: MessagePort): ImageSender {
	return (id, image) => port.postMessage({ id, image } satisfies ImageMessage, [image]);
}

/** Puts images straight into the table of this thread, which draws as well. */
export function sendToTable(table: ImageTable, slots: Int32Array): ImageSender {
	return (id, image) => {
		table.set(id, image);
		countArrival(slots);
	};
}

/** Keeps the images that arrive through a port in the table, and counts each one. */
export function receiveImages(port: MessagePort, table: ImageTable, slots: Int32Array): void {
	port.onmessage = (event: MessageEvent<ImageMessage>) => {
		table.set(event.data.id, event.data.image);
		countArrival(slots);
	};
}

/** Resolves once the thread that draws holds every image up to id `sent`. */
export async function imagesArrived(slots: Int32Array, sent: number): Promise<void> {
	let count = Atomics.load(slots, Slot.ImagesArrived);
	while (count < sent) {
		const wait = Atomics.waitAsync(slots, Slot.ImagesArrived, count);
		if (wait.async) await wait.value;
		count = Atomics.load(slots, Slot.ImagesArrived);
	}
}
