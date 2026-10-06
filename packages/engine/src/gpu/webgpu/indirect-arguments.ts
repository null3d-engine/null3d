// Gives each indexed indirect draw of a render pass a buffer of draw arguments of its own. Safari
// 26 clamps the arguments of every indirect draw into one scratch slot per buffer, and nothing
// orders a draw's fetch of its clamped arguments before the next draw's clamp writes the slot
// again (WebKit bug 321876, fixed in WebKit in August 2026). Draws from one buffer in a pass then
// race: a draw can run with the next draw's counts, or a mix of the two, and a large draw followed
// by another stalls the GPU until macOS resets it. Before such a pass begins, the backend copies
// each draw's arguments into a small buffer of its own, so every draw gets its own slot.

import * as G from '../../generated/gpu';

/** Bytes of one indexed indirect draw's arguments: five 32-bit words. */
const ARGUMENT_BYTES = 20;
/** The id of a draw whose buffer did not exist when the pass began, which draws from its own buffer. */
const NO_SOURCE = 0xffffffff;

export class IndirectArguments {
	/** The buffers of copied arguments, one for each indirect draw of the largest pass so far. */
	private readonly copies: GPUBuffer[] = [];
	/** The current pass's indirect draws in the order it runs them: each one's buffer id and offset. */
	private sources = new Uint32Array(64);
	/** The draws whose arguments the current pass copied, and the next draw to run. */
	private count = 0;
	private next = 0;

	constructor(private readonly device: GPUDevice) {}

	/**
	 * Finds the indirect draws of the render pass whose commands start at word `from` of `words`,
	 * the bundles it runs included, and, when there are two or more, copies each one's arguments
	 * with `encoder`, which must not be inside a pass.
	 */
	begin(
		words: Uint32Array,
		from: number,
		end: number,
		bundles: readonly (Uint32Array | undefined)[],
		buffers: readonly (GPUBuffer | undefined)[],
		encoder: () => GPUCommandEncoder,
	): void {
		this.count = 0;
		this.next = 0;
		for (let i = from; i < end; ) {
			const header = words[i] as number;
			const op = header & 0xff;
			const length = header >>> 8;
			if (length === 0 || op === G.OP_END_RENDER_PASS) break;
			if (op === G.OP_DRAW_INDEXED_INDIRECT) this.note(words, i + 1);
			else if (op === G.OP_EXECUTE_BUNDLES)
				for (let k = 0; k < (words[i + 1] as number); k++) {
					const bundle = bundles[words[i + 2 + k] as number];
					if (bundle) this.noteBundle(bundle);
				}
			i += length;
			// A bundle's commands are kept to run later, not run here.
			if (op === G.OP_BEGIN_BUNDLE)
				while (
					i < end &&
					((words[i] as number) & 0xff) !== G.OP_END_BUNDLE &&
					(words[i] as number) >>> 8
				)
					i += (words[i] as number) >>> 8;
		}
		// A single draw has no other draw to race with.
		if (this.count < 2) {
			this.count = 0;
			return;
		}
		const sources = this.sources;
		for (let k = 0; k < this.count; k++) {
			const source = buffers[sources[2 * k] as number];
			if (!source) {
				sources[2 * k] = NO_SOURCE;
				continue;
			}
			encoder().copyBufferToBuffer(
				source,
				sources[2 * k + 1] as number,
				this.copy(k),
				0,
				ARGUMENT_BYTES,
			);
		}
	}

	/**
	 * The buffer of copied arguments for the pass's next indirect draw, which draws from `id` at
	 * `offset`, or undefined when the draw reads its own buffer. Every indirect draw of the pass
	 * calls it once, in order, also one that does not draw.
	 */
	take(id: number, offset: number): GPUBuffer | undefined {
		const k = this.next++;
		if (k >= this.count) return undefined;
		const sources = this.sources;
		return sources[2 * k] === id && sources[2 * k + 1] === offset ? this.copies[k] : undefined;
	}

	destroy(): void {
		for (const copy of this.copies) copy.destroy();
		this.copies.length = 0;
	}

	private noteBundle(commands: Uint32Array): void {
		for (let i = 0; i < commands.length; ) {
			const header = commands[i] as number;
			if (header >>> 8 === 0) break;
			if ((header & 0xff) === G.OP_DRAW_INDEXED_INDIRECT) this.note(commands, i + 1);
			i += header >>> 8;
		}
	}

	private note(words: Uint32Array, a: number): void {
		if (2 * this.count + 2 > this.sources.length) {
			const grown = new Uint32Array(this.sources.length * 2);
			grown.set(this.sources);
			this.sources = grown;
		}
		this.sources[2 * this.count] = words[a] as number;
		this.sources[2 * this.count + 1] = words[a + 1] as number;
		this.count++;
	}

	private copy(k: number): GPUBuffer {
		let copy = this.copies[k];
		if (!copy) {
			copy = this.device.createBuffer({
				size: ARGUMENT_BYTES,
				usage: G.BUFFER_USAGE_INDIRECT | G.BUFFER_USAGE_COPY_DST,
			});
			this.copies[k] = copy;
		}
		return copy;
	}
}
