// Pipelines that a start builds before the commands that create them arrive. The page keeps the list
// of the pipelines that the first frame of its sketch's last start built (`page/pipeline-store.ts`).
// The next start hands that list to the thread that draws, which starts each build as soon as the
// build's shader is there, while the core downloads and the setup runs. Without it, the first
// build starts only when the setup's first frame reaches the thread that draws. The first frame's
// commands then take the builds that match them. Equal operands make an equal pipeline, so a list
// from another start of the sketch only builds pipelines that no command takes.

import { OP_CREATE_COMPUTE_PIPELINE, OP_CREATE_RENDER_PIPELINE } from '../generated/gpu';

/**
 * The operands that follow a create command's id: a render pipeline's template, permutation,
 * color and depth formats, sample count, state flags, vertex format, and depth bias and slope; a
 * compute pipeline's template and permutation.
 */
export function operandsAfterId(op: number): number {
	return op === OP_CREATE_RENDER_PIPELINE ? 9 : 2;
}

/** The most pipelines that a list holds. A scene's first frame builds well under a hundred. */
export const PIPELINE_LIST_LIMIT = 512;

/**
 * The create commands of the pipelines that a thread builds before its first frame, as a pipeline
 * list: each command's op, then its operands after its id. Commands of equal operands, such as an
 * add-on's compute passes of one shader, are listed once.
 */
export class PipelineListing {
	private words: number[] | undefined = [];
	private readonly keys = new Set<string>();

	/** True until `take` ends the listing. */
	get active(): boolean {
		return this.words !== undefined;
	}

	/** Lists the command `op` whose operands start with its id at `a`. */
	add(op: number, words: Uint32Array, a: number): void {
		const listed = this.words;
		if (!listed || this.keys.size >= PIPELINE_LIST_LIMIT) return;
		const key = keyOf(op, words, a);
		if (this.keys.has(key)) return;
		this.keys.add(key);
		listed.push(op);
		const operands = operandsAfterId(op);
		for (let k = 1; k <= operands; k++) listed.push(words[a + k] as number);
	}

	/** Ends the listing and returns its list, or undefined after the first call or for no pipeline. */
	take(): Uint32Array | undefined {
		const listed = this.words;
		this.words = undefined;
		this.keys.clear();
		return listed && listed.length > 0 ? Uint32Array.from(listed) : undefined;
	}
}

/** A build that started before its command came. */
export interface EarlyBuild<P> {
	/** The pipeline, once it is built. */
	pipeline: P | undefined;
	/** True once the build failed: the command then builds its pipeline itself, and meets the error. */
	failed: boolean;
	readonly done: Promise<P>;
}

/**
 * Starts a listed pipeline's build from the command's operands, with a zero id first: the build,
 * or undefined while its shader has not arrived, or null when it does not build ahead.
 */
export type EarlyStarter<P> = (op: number, operands: Uint32Array) => Promise<P> | undefined | null;

/** How often the builds that wait for their shaders look again, in ms. */
const WAIT_MS = 25;

/** Each list key that a command's operands make: its op and its operands after its id. */
export function keyOf(op: number, words: Uint32Array, a: number): string {
	let key = String(op);
	const operands = operandsAfterId(op);
	for (let k = 1; k <= operands; k++) key += ` ${words[a + k] as number}`;
	return key;
}

/** A listed command whose build waits for its shader, as operands with a zero id first. */
interface Waiting {
	readonly op: number;
	readonly operands: Uint32Array;
	readonly key: string;
}

/**
 * The builds of a pipeline list. Each starts as soon as `start` can build it, and the commands that
 * create the same pipelines take them. `stop` drops the builds that no command took, once the first
 * frame has drawn.
 */
export class EarlyBuilds<P> {
	/** The listed commands whose builds wait for their shaders, as operands with a zero id first. */
	private waiting: Waiting[] = [];
	private readonly started = new Map<string, EarlyBuild<P>>();
	/** The keys of commands that came before their listed build started, which then never starts. */
	private readonly claimed = new Set<string>();
	private timer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		list: Uint32Array,
		private readonly start: EarlyStarter<P>,
	) {
		const keys = new Set<string>();
		for (let i = 0; i < list.length; ) {
			const op = list[i] as number;
			if (op !== OP_CREATE_RENDER_PIPELINE && op !== OP_CREATE_COMPUTE_PIPELINE) break;
			const operands = operandsAfterId(op);
			if (i + 1 + operands > list.length) break;
			const command = new Uint32Array(operands + 1);
			command.set(list.subarray(i + 1, i + 1 + operands), 1);
			const key = keyOf(op, command, 0);
			// A list from a start that listed equal commands apart builds each pipeline once.
			if (!keys.has(key)) this.waiting.push({ op, operands: command, key });
			keys.add(key);
			i += 1 + operands;
		}
		this.look();
	}

	/** How many listed builds started so far. */
	get startedCount(): number {
		return this.started.size;
	}

	/**
	 * Starts each waiting build whose shader has arrived, and looks again a little later while any
	 * still waits. A command that cannot build here leaves the list, and its own build reports why.
	 */
	private look(): void {
		this.timer = undefined;
		const still: Waiting[] = [];
		for (const waiting of this.waiting) {
			const { op, operands, key } = waiting;
			let build: Promise<P> | undefined | null = null;
			if (!this.claimed.has(key))
				try {
					build = this.start(op, operands);
				} catch {
					build = null;
				}
			if (build === undefined) still.push(waiting);
			if (!build) continue;
			const made: EarlyBuild<P> = { pipeline: undefined, failed: false, done: build };
			build.then(
				(pipeline) => {
					made.pipeline = pipeline;
				},
				() => {
					made.failed = true;
				},
			);
			this.started.set(key, made);
		}
		this.waiting = still;
		if (still.length > 0) this.timer = setTimeout(() => this.look(), WAIT_MS);
	}

	/**
	 * The build that matches the command `op` whose operands start with its id at `a`, which leaves
	 * the list, or undefined when none started or the one that started failed. A listed build that
	 * has not started by then never does, as the command builds the pipeline itself.
	 */
	take(op: number, words: Uint32Array, a: number): EarlyBuild<P> | undefined {
		const key = keyOf(op, words, a);
		const made = this.started.get(key);
		if (!made) {
			this.claimed.add(key);
			return undefined;
		}
		this.started.delete(key);
		return made.failed ? undefined : made;
	}

	/** Stops the waiting builds and forgets the started ones that no command took. */
	stop(): void {
		if (this.timer !== undefined) clearTimeout(this.timer);
		this.timer = undefined;
		this.waiting = [];
		this.started.clear();
		this.claimed.clear();
	}
}
