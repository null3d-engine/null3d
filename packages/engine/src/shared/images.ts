// Images for texture uploads, on their way from the sketch thread to the thread that draws. The
// engine core gives each image an id, which steps as frame numbers do, and the sketch thread sends
// the images in id order. The thread that draws keeps them in a table and notes the id of each one
// it receives in the control block, so the core knows which uploads can run. The table outlives each GPU device, so
// a new device can upload the images that it still holds.
//
// A texture generator, which fills a texture on the GPU, takes an image id and the same way too:
// the sketch thread sends what it makes, the built-in room's name or a panorama's texels. The
// thread that draws loads the generators' code for its GPU path with the first one, and notes the
// generator only then, so a draw list that names it runs it at once. Arrivals are noted in id order,
// so an image that comes while the code loads is noted after the generator.
//
// Custom materials' shaders take the same way, each under its render pipeline template. A backend
// looks a template up in the table when a draw list first names it. A pipeline whose shader has
// not arrived yet builds once it has. On the dev server, a hot update sends a template's shader
// again: the table lists the template as replaced, and the backend builds its pipelines again.
// A custom material's builds load on first use, in sets: one for each value of the permutation
// bits that a device fixes and of skinning. The sketch thread sends its device's set as soon as it
// first uses the material. A pipeline that needs a build of another set, such as one without tone
// mapping once bloom turns on, or one that skins, asks the sketch thread for that set, back through
// the same way, and waits until it arrives, as a pipeline waits for a shader file. Equal text in
// the sets that arrive is kept once.
//
// So do the names of features whose shader files the sketch will need, such as skinning when a
// glTF file with skins loads. The thread that draws starts to download each feature's file then,
// before the objects that need it are drawn. A reserved name asks for the generators' code and
// shaders the same way, while an HDR file still downloads.

import { messageOf } from '../errors/message';
import { PERMUTATION_DRAW_INDEX, PERMUTATION_SKIN, PERMUTATION_TONE_MAP } from '../generated/gpu';
import type { ShaderVariants } from '../generated/shaders';
import type { EffectPieces } from '../gpu/effect-join';
import { variantFor } from '../gpu/variants';
import type { Panorama } from '../scene/panorama-files';
import { frameAfter, Slot } from './control';
import { notifySlot, slotChangeOrRecheck, type WakeTarget, wakeWaiters } from './wake';

/**
 * The permutation bits that pick a set of a custom material's builds: those that a device fixes,
 * and skinning.
 */
const SET_BITS = PERMUTATION_DRAW_INDEX | PERMUTATION_TONE_MAP | PERMUTATION_SKIN;

/**
 * The builds of `builds`, whose texts take the equal string of `texts` where it has one, so the
 * thread keeps each distinct text once. A message gives each build its own copy of the text that
 * WebGL2's builds share.
 */
function keepTextOnce(builds: ShaderVariants, texts: Map<string, string>): ShaderVariants {
	const once = (text: string) => {
		const kept = texts.get(text);
		if (kept !== undefined) return kept;
		texts.set(text, text);
		return text;
	};
	const out: Record<string, ShaderVariants[string]> = {};
	for (const [name, build] of Object.entries(builds)) {
		const { wgsl, glsl } = build;
		out[name] = {
			...build,
			wgsl: wgsl && { ...wgsl, source: once(wgsl.source) },
			glsl:
				glsl &&
				Object.fromEntries(
					Object.entries(glsl).map(([pipeline, program]) => [
						pipeline,
						{
							vertex: { ...program.vertex, source: once(program.vertex.source) },
							fragment: { ...program.fragment, source: once(program.fragment.source) },
						},
					]),
				),
		};
	}
	return out;
}

/** An effect of a group or a fold: the template of its own shader, and the slot of its block. */
export interface JoinedEffect {
	readonly template: number;
	readonly slot: number;
}

/**
 * A shader of the sketch's compiled WGSL, as the thread that draws builds its pipelines: its
 * variants, whose render pipeline is `main`, and for a custom material the mesh locations that its
 * vertex stage reads.
 */
export interface CustomShader {
	/**
	 * What the shader draws: a custom effect's pass, or the final pass with a custom tone curve,
	 * which binds as the final pass does, or as its bloom build does. A group of joined effects
	 * binds as an effect does, and the final pass with effects folded into it binds the effects'
	 * buffer and the scene's depth too. A shader without a kind draws a custom material's meshes.
	 */
	readonly kind?: 'effect' | 'final' | 'finalBloom' | 'effectGroup' | 'effectFold';
	/**
	 * True for an effect whose WGSL reads a level of bloom's chain, so it draws in a pass of its
	 * own and binds that level.
	 */
	readonly bloom?: boolean;
	/**
	 * The shader's builds. A group's or a fold's are empty until the thread that draws joins them
	 * from its effects' pieces, at its first pipeline.
	 */
	readonly variants: ShaderVariants;
	readonly locations: readonly number[];
	/**
	 * True for a draw shader, whose vertex stage makes every vertex and every copy from its
	 * indices: its pipelines declare no vertex buffer, and a draw gives only its two counts.
	 */
	readonly meshless?: boolean;
	/** The textures that the material's WGSL declares, which its pipelines bind with the maps' layout. */
	readonly textures: number;
	/**
	 * True for a custom material whose surface function reads the copy of the scene's depth, so its
	 * pipelines bind the depth after the maps' group.
	 */
	readonly sceneDepth?: boolean;
	/**
	 * True for a custom material whose builds load on first use, in sets that the sketch thread
	 * sends: its variants hold the sets that arrived.
	 */
	readonly builds?: boolean;
	/** An effect's or a tone curve's pieces, which groups and folds join. */
	readonly pieces?: EffectPieces;
	/** A group's or a fold's effects, in the order they run. */
	readonly members?: readonly JoinedEffect[];
	/** The template of the custom tone curve that a fold holds, if any. */
	readonly curve?: number;
}

/**
 * What a generator makes on the GPU: `room`, the built-in room, `sky`, a map of the scene's sky
 * that the engine core fills in stages, the environment map of a panorama from an HDR file, or
 * `probes`, the filters of reflection probes' maps, which the engine core runs on each capture.
 */
export type GeneratorSource = 'room' | 'sky' | 'probes' | Panorama;

/** True for a generator's source, false for an image. */
function isGenerator(image: ImageBitmap | GeneratorSource): image is GeneratorSource {
	return typeof image === 'string' || 'texels' in image;
}

/**
 * The name that asks the thread that draws for the generators' code and shaders ahead of the first
 * generator, among the features to preload.
 */
export const GENERATORS_PRELOAD = 'environment-generator';

/** The images, texture generators and custom materials' shaders that the thread that draws holds. */
export class ImageTable {
	private readonly images = new Map<number, ImageBitmap>();
	/** Custom materials' shaders, by render pipeline template. */
	readonly shaders = new Map<number, CustomShader>();
	/** The templates whose shader a hot update replaced, which the backend has not built again yet. */
	readonly replaced: number[] = [];

	/** Keeps a custom material's shader under its template, and lists a template it replaces. */
	setShader(template: number, shader: CustomShader): void {
		if (this.shaders.has(template)) this.replaced.push(template);
		this.shaders.set(template, shader);
		// A hot update's shader brings its builds, so sets of the old shader that still come are dropped.
		this.sets.delete(template);
	}

	/** Asks the sketch thread for a set of the builds of a template that load on first use. */
	askBuilds: (template: number, set: number) => void = () => {};
	/**
	 * The sets of each template's builds that the table asked for or that arrived, by their bits:
	 * true once a set arrived, false while it is on its way, or why it failed to load.
	 */
	private readonly sets = new Map<number, Map<number, boolean | string>>();
	/** Each distinct text of the builds that arrived, so that equal text is kept once. */
	private readonly texts = new Map<string, string>();

	/**
	 * True when the shader of `template` can build the pipeline of `permutation` with output for
	 * `target`, as far as its builds that load on first use go: it holds the build, or the set that
	 * would hold it has arrived, so the backend builds the pipeline or reports its error. The first
	 * call that needs a set asks for it, and the calls return false until it arrives. Throws E1424
	 * when the set failed to load.
	 */
	buildsReady(template: number, permutation: number, target: 'wgsl' | 'glsl'): boolean {
		const shader = this.shaders.get(template);
		if (!shader?.builds || variantFor(shader.variants, permutation, target)) return true;
		const set = permutation & SET_BITS;
		let sets = this.sets.get(template);
		if (!sets) {
			sets = new Map();
			this.sets.set(template, sets);
		}
		const state = sets.get(set);
		if (typeof state === 'string')
			throw new Error(`E1424: the builds of a custom material did not load: ${state}.`);
		if (state === undefined) {
			sets.set(set, false);
			this.askBuilds(template, set);
		}
		return state === true;
	}

	/**
	 * Adds a set of builds that loaded on first use to the shader of `template`, whose pipelines then
	 * build from them, or keeps why the set failed to load.
	 */
	addBuilds(template: number, set: number, builds: ShaderVariants | string): void {
		const shader = this.shaders.get(template);
		if (!shader?.builds) return;
		let sets = this.sets.get(template);
		if (!sets) {
			sets = new Map();
			this.sets.set(template, sets);
		}
		if (typeof builds === 'string') {
			sets.set(set, builds);
			return;
		}
		sets.set(set, true);
		// The backends' templates hold the shader's object of variants, so they see the new builds.
		Object.assign(shader.variants, keepTextOnce(builds, this.texts));
	}

	/** The features whose shader files the sketch asked for, which every renderer loads. */
	readonly preloads = new Set<string>();
	/** Hears each feature that the sketch asks for, while a renderer runs. */
	onPreload: ((feature: string) => void) | undefined;

	/**
	 * Keeps the features that the sketch asked for, and tells the renderer of each new one. The
	 * generators' name starts to load their code and build their pipelines instead.
	 */
	preload(features: readonly string[]): void {
		for (const feature of features) {
			if (feature === GENERATORS_PRELOAD) {
				void this.generatorsReady();
				continue;
			}
			if (this.preloads.has(feature)) continue;
			this.preloads.add(feature);
			this.onPreload?.(feature);
		}
	}

	/**
	 * Each texture generator's source, by its id among the images' ids. The table keeps a
	 * panorama's texels until the texture goes, so a new GPU device makes its map again.
	 */
	private readonly generators = new Map<number, GeneratorSource>();
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
	 * Loads the generators' code once, then has the backend build their pipelines, and resolves when
	 * both are done or either failed. A failure waits for the command that runs a generator.
	 */
	private async generatorsReady(): Promise<void> {
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
	}

	/**
	 * Keeps a generator under its id once the generators' code has loaded and the backend has built
	 * their pipelines, or once either failed, which the command that runs the generator then
	 * reports.
	 */
	async addGenerator(id: number, source: GeneratorSource): Promise<void> {
		await this.generatorsReady();
		this.generators.set(id, source);
	}

	/**
	 * The source of the generator under an id, which a draw list's command names, and the
	 * generators' code that runs it, as the backend of the thread's GPU path loaded it. Throws when
	 * the table holds no such generator, or when the code did not load.
	 */
	generator<Code>(id: number): [GeneratorSource, Code] {
		const code = this.generatorCodeFor<Code>(id);
		return [this.generators.get(id) as GeneratorSource, code];
	}

	/**
	 * The generators' code, once the table holds the generator under an id that a draw list's
	 * command names. Unlike `generator`, it makes no array, for commands that run in every frame.
	 * Throws as `generator` does.
	 */
	generatorCodeFor<Code>(id: number): Code {
		if (!this.generators.has(id))
			throw new Error(`draw list names generator ${id}, which does not exist`);
		if (this.generatorCode === undefined)
			throw new Error(
				`the code of the environment generator did not download: ${this.generatorFailure}`,
			);
		return this.generatorCode as Code;
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
		this.replaced.length = 0;
		this.sets.clear();
		this.texts.clear();
		// The listener belongs to a renderer: a table that kept it would keep that renderer, and the
		// engine's memory with it, for as long as the port that fills the table lives. The ask for
		// builds can reach the sketch's objects, so it goes too.
		this.onPreload = undefined;
		this.askBuilds = () => {};
	}
}

/** Sends an image, or what a texture generator makes, under its id, to the thread that draws. */
export type ImageSender = (id: number, image: ImageBitmap | GeneratorSource) => void;

/** Sends a custom material's shader variants, under its template, to the thread that draws. */
export type ShaderSender = (template: number, shader: CustomShader) => void;

/** Asks the thread that draws to load the shader files of features that the sketch will use. */
export type PreloadSender = (features: readonly string[]) => void;

/**
 * Sends a set of a shader's builds that loaded on first use, under its template and the set's
 * permutation bits, to the thread that draws, or why the set did not load.
 */
export type BuildsSender = (template: number, set: number, builds: ShaderVariants | string) => void;

/** Answers an ask of the thread that draws for a set of a template's builds. */
export type BuildsAsker = (template: number, set: number) => void;

/**
 * A message that carries an image, a custom material's shader or features to preload to the
 * thread that draws.
 */
type DrawingMessage =
	| { id: number; image: ImageBitmap }
	| { id: number; generator: GeneratorSource }
	| { template: number; shader: CustomShader }
	| { template: number; set: number; builds: ShaderVariants | string }
	| { preload: readonly string[] };

/** The message in which the thread that draws asks for a set of a template's builds. */
interface AskBuilds {
	askBuilds: number;
	set: number;
}

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
 * names and shaders until that thread says that it receives, then send them in order, so no image
 * waits unread while that thread makes its first renderer. Firefox drops the unread images of a
 * port once the page collects the object of a port that it moved, so the page keeps the ports of
 * the engine's channels until the engine stops. Features to preload are plain names, so they go at
 * once, and their shader files download while that renderer is made. That thread's wake messages
 * come back through the port and end this thread's waits.
 */
export function sendThrough(port: MessagePort): DrawingSenders {
	let held: [DrawingMessage, Transferable[]][] | undefined = [];
	const post = (message: DrawingMessage, transfer: Transferable[] = []) => {
		if (held) held.push([message, transfer]);
		else port.postMessage(message, transfer);
	};
	let answer: BuildsAsker = () => {};
	port.onmessage = (event: MessageEvent<unknown>) => {
		const data = event.data as ({ type?: string } & Partial<AskBuilds>) | null;
		if (held && data?.type === RECEIVING.type) {
			for (const [message, transfer] of held) port.postMessage(message, transfer);
			held = undefined;
		}
		if (data?.askBuilds !== undefined) answer(data.askBuilds, data.set ?? 0);
		wakeWaiters();
	};
	return {
		sendImage(id, image) {
			if (!isGenerator(image)) post({ id, image }, [image]);
			else if (typeof image === 'string') post({ id, generator: image });
			else post({ id, generator: image }, [image.texels.buffer]);
		},
		sendShader: (template, shader) => post({ template, shader }),
		sendBuilds: (template, set, builds) => post({ template, set, builds }),
		sendPreload: (features) => port.postMessage({ preload: features } satisfies DrawingMessage),
		onAskBuilds(handler) {
			answer = handler;
		},
	};
}

/** Puts shaders straight into the table of this thread, which draws as well. */
export function shadersToTable(table: ImageTable): ShaderSender {
	return (template, shader) => table.setShader(template, shader);
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
		const generator = isGenerator(image);
		const arrive = () => {
			if (!generator) table.set(id, image);
			noteArrival(slots, id, to);
		};
		if (generator)
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
	sendBuilds: BuildsSender;
	sendPreload: PreloadSender;
	/** Answers each ask of the thread that draws for a set of a template's builds. */
	onAskBuilds(handler: BuildsAsker): void;
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
				sendBuilds: (template, set, builds) => table.addBuilds(template, set, builds),
				sendPreload: (features) => table.preload(features),
				onAskBuilds(handler) {
					table.askBuilds = handler;
				},
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
	table.askBuilds = (template, set) =>
		port.postMessage({ askBuilds: template, set } satisfies AskBuilds);
	port.onmessage = (event: MessageEvent<DrawingMessage>) => {
		const data = event.data;
		if ('shader' in data) table.setShader(data.template, data.shader);
		else if ('builds' in data) table.addBuilds(data.template, data.set, data.builds);
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
