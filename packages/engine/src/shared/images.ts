// Images for texture uploads, on their way from the sketch thread to the thread that draws. The
// engine core gives each image an id, which steps as frame numbers do, and the sketch thread sends
// the images in id order. The thread that draws keeps them in a table and notes the id of each one
// it receives in the control block, so the core knows which uploads can run. The table outlives each GPU device, so
// a new device can upload the images that it still holds.
//
// A texture generator, which fills a texture on the GPU, takes an image id and the same way too:
// the sketch thread sends its name. The thread that draws loads the generators' code for its GPU
// path with the first one, and notes the generator only then, so a draw list that names it runs
// it at once. Arrivals are noted in id order, so an image that comes while the code loads is noted
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
import { frameAfter, Slot } from './control';
import { notifySlot, slotChangeOrRecheck, type WakeTarget, wakeWaiters } from './wake';

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
	 * that a generator's run waits for no build. Each new device says it again. It builds them at
	 * once when the code has loaded already.
	 */
	warmGeneratorsWith(warm: (code: unknown) => Promise<unknown>): void {
		this.warm = warm;
		if (this.generatorCode !== undefined) void this.warmGenerators();
	}

	/** Builds the generators' pipelines ahead, where a backend said how. A failure waits for the run. */
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
		// The listener belongs to a renderer: a table that kept it would keep that renderer, and the
		// engine's memory with it, for as long as the port that fills the table lives.
		this.onPreload = undefined;
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
 * Notes the id of an image that the thread that draws received, and wakes a thread that waits for
 * it, through `to` where another thread runs the sketch.
 */
function noteArrival(slots: Int32Array, id: number, to?: WakeTarget): void {
	Atomics.store(slots, Slot.ImagesArrived, id);
	notifySlot(slots, Slot.ImagesArrived, to);
}

/**
 * The message that the thread that draws sends back through the port of the images once its first
 * renderer exists.
 */
export const RECEIVING = { type: 'receiving' } as const;

/**
 * Sends images, generators' names, shaders and features to preload through a port to the thread
 * that draws, which receives them with `receiveImages`. The senders hold the images, generators'
 * names and shaders until that thread says that it receives, then send them in order. Firefox can
 * fail to read an image that reaches that thread while it makes its first renderer: the thread
 * gets a messageerror event in place of the image. Features to preload are plain names, so they go
 * at once, and their shader files download while that renderer is made. That thread's wake
 * messages come back through the port and end this thread's waits.
 */
export function sendThrough(port: MessagePort): DrawingSenders {
	let held: [DrawingMessage, Transferable[]][] | undefined = [];
	const post = (message: DrawingMessage, transfer: Transferable[] = []) => {
		if (held) held.push([message, transfer]);
		else port.postMessage(message, transfer);
	};
	port.onmessage = (event: MessageEvent<unknown>) => {
		if (held && (event.data as { type?: string } | null)?.type === RECEIVING.type) {
			for (const [message, transfer] of held) port.postMessage(message, transfer);
			held = undefined;
		}
		wakeWaiters();
	};
	return {
		sendImage(id, image) {
			if (typeof image === 'string') post({ id, generator: image });
			else post({ id, image }, [image]);
		},
		sendShader: (template, shader) => post({ template, shader }),
		sendPreload: (features) => port.postMessage({ preload: features } satisfies DrawingMessage),
	};
}

/** Puts shaders straight into the table of this thread, which draws as well. */
export function shadersToTable(table: ImageTable): ShaderSender {
	return (template, shader) => table.shaders.set(template, shader);
}

/**
 * Keeps images and generators in the table and notes the id of each, through `to` where another
 * thread runs the sketch. An image is noted at once and a generator once its code has loaded, but
 * each only after every earlier one, so the noted id says that every id up to it arrived.
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
			noteArrival(slots, id, to);
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
		? sendThrough(port)
		: {
				sendImage: sendToTable(table, slots),
				sendShader: shadersToTable(table),
				sendPreload: (features) => table.preload(features),
			};
}

/**
 * Keeps the images, generators and shaders that arrive through a port in the table, and notes the id
 * of each image and generator. The sketch thread at the port's other end sends nothing until the returned
 * function tells it that this thread receives. That thread hears of each arrival through the same
 * port, where it waits for wake messages. A message that the browser cannot read stops this thread
 * with an error, because the sketch's wait for that image would never end.
 */
export function receiveImages(port: MessagePort, table: ImageTable, slots: Int32Array): () => void {
	const arrive = arrivals(table, slots, port);
	port.onmessageerror = () => {
		throw new Error('a texture image or shader that the sketch sent could not be read');
	};
	port.onmessage = (event: MessageEvent<DrawingMessage>) => {
		const data = event.data;
		if ('shader' in data) table.shaders.set(data.template, data.shader);
		else if ('preload' in data) table.preload(data.preload);
		else arrive(data.id, 'generator' in data ? data.generator : data.image);
	};
	return () => port.postMessage(RECEIVING);
}

/**
 * Resolves once the thread that draws holds every image up to id `sent`. Ids go round as frame
 * numbers do, so they compare by their distance.
 */
export async function imagesArrived(slots: Int32Array, sent: number): Promise<void> {
	let arrived = Atomics.load(slots, Slot.ImagesArrived);
	while (frameAfter(sent, arrived)) {
		const change = slotChangeOrRecheck(slots, Slot.ImagesArrived, arrived);
		if (change) await change;
		arrived = Atomics.load(slots, Slot.ImagesArrived);
	}
}
