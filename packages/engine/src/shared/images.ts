// Images for texture uploads, on their way from the sketch thread to the thread that draws. The
// engine core gives each image an id, counting from 1, and the sketch thread sends the images in
// id order. The thread that draws keeps them in a table and counts each one it receives in the
// control block, so the core knows which uploads can run. The table outlives each GPU device, so
// a new device can upload the images that it still holds.
//
// A texture generator, which fills a texture on the GPU, takes an image id and the same way too:
// the sketch thread sends its name. The thread that draws loads the generators' code for its GPU
// path with the first one, and counts the generator only then, so a draw list that names it runs
// it at once. Arrivals count in id order, so an image that comes while the code loads counts
// after the generator.
//
// Custom materials' shaders take the same way, each under its render pipeline template. A backend
// looks a template up in the table when a draw list first names it. A pipeline whose shader has
// not arrived yet builds once it has.
//
// So do the names of features whose shader files the sketch will need, such as skinning when a
// glTF file with skins loads. The thread that draws starts to download each feature's file then,
// before the objects that need it are drawn.

import { messageOf } from '../errors/message';
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

/** The names of the generators that fill textures on the GPU: `room`, the built-in room. */
export type GeneratorName = 'room';

/** The images, texture generators and custom materials' shaders that the thread that draws holds. */
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

	/** Each texture generator's name, by its id among the images' ids. */
	private readonly generators = new Map<number, GeneratorName>();
	/** The generators' code for the GPU path of the thread that draws, once it has loaded. */
	private generatorCode: unknown;
	/** Why the generators' code did not load. */
	private generatorFailure = '';
	/** How the thread that draws loads the generators' code, once it has said. */
	private readonly loader: Promise<() => Promise<unknown>>;
	private setLoader: (load: () => Promise<unknown>) => void = () => {};
	/** The load of the generators' code, from the first generator on. */
	private loading: Promise<void> | undefined;
	/** How the backend of the thread's GPU device builds the generators' pipelines ahead. */
	private warm: ((code: unknown) => Promise<unknown>) | undefined;

	constructor() {
		this.loader = new Promise((resolve) => {
			this.setLoader = resolve;
		});
	}

	/**
	 * Says how this thread loads the generators' code for its GPU path. The thread that draws says
	 * it before it draws; a generator that arrives sooner waits for it.
	 */
	loadGeneratorsWith(load: () => Promise<unknown>): void {
		this.setLoader(load);
	}

	/**
	 * Says how the backend of the thread's GPU device builds the generators' pipelines ahead, so
	 * that a generator's first slice waits for no build. Each new device says it again. It builds
	 * them at once when the code has loaded already.
	 */
	warmGeneratorsWith(warm: (code: unknown) => Promise<unknown>): void {
		this.warm = warm;
		if (this.generatorCode !== undefined) void this.warmGenerators();
	}

	/** Builds the generators' pipelines ahead, where a backend said how. A failure waits for the slice. */
	private warmGenerators(): Promise<unknown> {
		const { warm, generatorCode } = this;
		if (!warm || generatorCode === undefined) return Promise.resolve();
		return warm(generatorCode).catch(() => undefined);
	}

	/**
	 * Keeps a generator under its id once the generators' code has loaded and the backend has built
	 * their pipelines, or once either failed, which the command that runs the generator then
	 * reports.
	 */
	async addGenerator(id: number, name: GeneratorName): Promise<void> {
		this.loading ??= this.loader
			.then((load) => load())
			.then(
				(code) => {
					this.generatorCode = code;
				},
				(error: unknown) => {
					this.generatorFailure = messageOf(error);
				},
			);
		await this.loading;
		await this.warmGenerators();
		this.generators.set(id, name);
	}

	/**
	 * The name of the generator under an id, which a draw list's command names, and the
	 * generators' code that runs it, as the backend of the thread's GPU path loaded it. Throws when
	 * the table holds no such generator, or when the code did not load.
	 */
	generator<Code>(id: number): [GeneratorName, Code] {
		const name = this.generators.get(id);
		if (!name) throw new Error(`draw list names generator ${id}, which does not exist`);
		if (this.generatorCode === undefined)
			throw new Error(
				`the code of the ${name} generator did not download: ${this.generatorFailure}`,
			);
		return [name, this.generatorCode as Code];
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

	/** Closes an image and forgets it, or forgets a generator. */
	release(id: number): void {
		this.images.get(id)?.close();
		this.images.delete(id);
		this.generators.delete(id);
	}

	/** Closes every image, and forgets every generator and shader. */
	clear(): void {
		for (const image of this.images.values()) image.close();
		this.images.clear();
		this.generators.clear();
		this.shaders.clear();
	}
}

/** Sends an image, or a texture generator's name, under its id, to the thread that draws. */
export type ImageSender = (id: number, image: ImageBitmap | GeneratorName) => void;

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
	| { id: number; generator: GeneratorName }
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
	return (id, image) => {
		if (typeof image === 'string')
			port.postMessage({ id, generator: image } satisfies DrawingMessage);
		else port.postMessage({ id, image } satisfies DrawingMessage, [image]);
	};
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

/**
 * Keeps images and generators in the table and counts each, through `to` where another thread
 * runs the sketch. An image counts at once and a generator once its code has loaded, but each
 * only after every earlier one, so the count says that every id up to it arrived.
 */
function arrivals(table: ImageTable, slots: Int32Array, to?: WakeTarget): ImageSender {
	let waiting: Promise<void> | undefined;
	const after = (before: Promise<void>, next: () => Promise<void> | void) => {
		const chain = before.then(next);
		waiting = chain;
		void chain.then(() => {
			if (waiting === chain) waiting = undefined;
		});
	};
	return (id, image) => {
		const arrive = () => {
			if (typeof image !== 'string') table.set(id, image);
			countArrival(slots, to);
		};
		if (typeof image === 'string')
			after(waiting ?? Promise.resolve(), () => table.addGenerator(id, image).then(arrive));
		else if (waiting) after(waiting, arrive);
		else arrive();
	};
}

/** Puts images and generators straight into the table of this thread, which draws as well. */
export function sendToTable(table: ImageTable, slots: Int32Array): ImageSender {
	return arrivals(table, slots);
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
 * Keeps the images, generators and shaders that arrive through a port in the table, and counts each
 * image and generator. The sketch thread at the port's other end hears of each through the same
 * port, where it waits for wake messages.
 */
export function receiveImages(port: MessagePort, table: ImageTable, slots: Int32Array): void {
	const arrive = arrivals(table, slots, port);
	port.onmessage = (event: MessageEvent<DrawingMessage>) => {
		const data = event.data;
		if ('shader' in data) table.shaders.set(data.template, data.shader);
		else if ('preload' in data) table.preload(data.preload);
		else arrive(data.id, 'generator' in data ? data.generator : data.image);
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
