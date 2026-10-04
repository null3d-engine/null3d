// Images for texture uploads, on their way from the sketch thread to the thread that draws. The
// engine core gives each image an id, counting from 1, and the sketch thread sends the images in
// id order. The thread that draws keeps them in a table and counts each one it receives in the
// control block, so the core knows which uploads can run. The table outlives each GPU device, so
// a new device can upload the images that it still holds.
//
// Custom materials' shaders take the same way, each under its render pipeline template. A backend
// looks a template up in the table when a draw list first names it. A pipeline whose shader has
// not arrived yet builds once it has.
//
// So do the names of features whose shader files the sketch will need, such as skinning when a
// glTF file with skins loads. The thread that draws starts to download each feature's file then,
// before the objects that need it are drawn.

import type { ShaderVariants } from '../generated/shaders';
import { Slot } from './control';
import { notifySlot, slotChangeOrRecheck, type WakeTarget, wakeFrom } from './wake';

/**
 * A custom material's shader, as the thread that draws builds its pipelines: its variants, whose
 * render pipeline is `main`, and the mesh locations that its vertex stage reads.
 */
export interface CustomShader {
	readonly variants: ShaderVariants;
	readonly locations: readonly number[];
	/** The textures that the material's WGSL declares, which its pipelines bind with the maps' layout. */
	readonly textures: number;
}

/** The images and custom materials' shaders that the thread that draws holds. */
export class ImageTable {
	private readonly images = new Map<number, ImageBitmap>();
	/** Custom materials' shaders, by render pipeline template. */
	readonly shaders = new Map<number, CustomShader>();
	/** The features whose shader files the sketch asked for, which every renderer loads. */
	readonly preloads = new Set<string>();
	/** Hears each feature that the sketch asks for, while a renderer runs. */
	onPreload: ((feature: string) => void) | undefined;

	/** Keeps the features that the sketch asked for, and tells the renderer of each new one. */
	preload(features: readonly string[]): void {
		for (const feature of features) {
			if (this.preloads.has(feature)) continue;
			this.preloads.add(feature);
			this.onPreload?.(feature);
		}
	}

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

	/** Closes every image, and forgets every shader. */
	clear(): void {
		for (const image of this.images.values()) image.close();
		this.images.clear();
		this.shaders.clear();
	}
}

/** Sends an image, under its id, to the thread that draws. */
export type ImageSender = (id: number, image: ImageBitmap) => void;

/** Sends a custom material's shader variants, under its template, to the thread that draws. */
export type ShaderSender = (template: number, shader: CustomShader) => void;

/** Asks the thread that draws to load the shader files of features that the sketch will use. */
export type PreloadSender = (features: readonly string[]) => void;

/**
 * A message that carries an image, a custom material's shader or features to preload to the
 * thread that draws.
 */
type DrawingMessage =
	| { id: number; image: ImageBitmap }
	| { template: number; shader: CustomShader }
	| { preload: readonly string[] };

/**
 * Counts an image that the thread that draws received, and wakes a thread that waits for it, through
 * `to` where another thread runs the sketch.
 */
function countArrival(slots: Int32Array, to?: WakeTarget): void {
	Atomics.add(slots, Slot.ImagesArrived, 1);
	notifySlot(slots, Slot.ImagesArrived, to);
}

/**
 * Sends images through a port to the thread that draws, which receives them with `receiveImages`.
 * That thread's wake messages come back through the port and end this thread's waits.
 */
export function sendThrough(port: MessagePort): ImageSender {
	wakeFrom(port);
	return (id, image) => port.postMessage({ id, image } satisfies DrawingMessage, [image]);
}

/** Sends shaders through a port to another thread, which receives them with `receiveImages`. */
export function shadersThrough(port: MessagePort): ShaderSender {
	return (template, shader) => port.postMessage({ template, shader } satisfies DrawingMessage);
}

/** Sends features to preload through a port to another thread, which receives them with `receiveImages`. */
export function preloadsThrough(port: MessagePort): PreloadSender {
	return (features) => port.postMessage({ preload: features } satisfies DrawingMessage);
}

/** Puts shaders straight into the table of this thread, which draws as well. */
export function shadersToTable(table: ImageTable): ShaderSender {
	return (template, shader) => table.shaders.set(template, shader);
}

/** Puts images straight into the table of this thread, which draws as well. */
export function sendToTable(table: ImageTable, slots: Int32Array): ImageSender {
	return (id, image) => {
		table.set(id, image);
		countArrival(slots);
	};
}

/**
 * What a sketch sends to the thread that draws: texture images, custom materials' shaders and the
 * features whose shader files to load early.
 */
export interface DrawingSenders {
	sendImage: ImageSender;
	sendShader: ShaderSender;
	sendPreload: PreloadSender;
}

/**
 * The senders to the thread that draws: another thread through `port`, which receives with
 * `receiveImages`, or this thread's own `table` when there is no port.
 */
export function drawingSenders(
	table: ImageTable,
	slots: Int32Array,
	port: MessagePort | undefined,
): DrawingSenders {
	return port
		? {
				sendImage: sendThrough(port),
				sendShader: shadersThrough(port),
				sendPreload: preloadsThrough(port),
			}
		: {
				sendImage: sendToTable(table, slots),
				sendShader: shadersToTable(table),
				sendPreload: (features) => table.preload(features),
			};
}

/**
 * Keeps the images and shaders that arrive through a port in the table, and counts each image. The
 * sketch thread at the port's other end hears of each image through the same port, where it waits
 * for wake messages.
 */
export function receiveImages(port: MessagePort, table: ImageTable, slots: Int32Array): void {
	port.onmessage = (event: MessageEvent<DrawingMessage>) => {
		const data = event.data;
		if ('shader' in data) {
			table.shaders.set(data.template, data.shader);
			return;
		}
		if ('preload' in data) {
			table.preload(data.preload);
			return;
		}
		table.set(data.id, data.image);
		countArrival(slots, port);
	};
}

/** Resolves once the thread that draws holds every image up to id `sent`. */
export async function imagesArrived(slots: Int32Array, sent: number): Promise<void> {
	let count = Atomics.load(slots, Slot.ImagesArrived);
	while (count < sent) {
		const change = slotChangeOrRecheck(slots, Slot.ImagesArrived, count);
		if (change) await change;
		count = Atomics.load(slots, Slot.ImagesArrived);
	}
}
