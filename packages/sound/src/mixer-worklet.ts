// The add-on's mixer, which runs on the browser's audio thread as an AudioWorklet. Its work is in
// Rust, in `crates/null3d-sound`, compiled to WebAssembly (hard rule 42): in each render quantum the
// module reads the table that the sketch writes, works out each voice's place relative to the
// listener, its gain, its playback rate and its filter's cutoff, and writes each for every frame of
// the quantum into its memory. This file does the browser's part: it copies the sketch's table into
// the module, calls it once a quantum, and copies each of those runs into the browser's output
// arrays as a block, which allocates nothing. The page connects the outputs to each voice's own
// audio nodes, so the sound follows the scene with no work on the page's thread.
//
// The browser copies this file into a build as it is, so it imports nothing but types. The page
// gives it the module's bytes, the table's layout and the order of its outputs.
import type { MixerMessage, MixerReply, MixerSetup, TableLayout } from './protocol';

/** The name that the page makes the mixer's node with. The page's module holds the same name. */
export const MIXER_NAME = 'null3d-sound-mixer';

/** The module's report that the sketch's frames have stopped, and that they move again. */
const STOPPED = 1;
const MOVING = 2;
/** The values that the module gives each voice besides its gain: its place, rate and cutoff. */
const VALUES = 5;
/** The voices that one call to add a sound may name: the module's voice list. */
const VOICE_LIST = 32;
/** The module's number for each kind of sound. */
const KINDS = { loop: 0, group: 1, shot: 2 } as const;

/**
 * Copies a run of the module's into an output channel from frame `start` on. A copy at the start
 * passes no offset, which in V8 costs a few bytes for each call.
 */
function copyRun(channel: Float32Array | undefined, run: Float32Array | undefined, start: number) {
	if (!channel || !run) return;
	if (start === 0) channel.set(run);
	else channel.set(run, start);
}

/** Views of the module's runs for one length of render: each voice's gains, then its values. */
interface RunViews {
	readonly gains: Float32Array[];
	/** Each voice's values in the module's order, `VALUES` runs for each voice. */
	readonly columns: Float32Array[];
}

/** What the mixer's WebAssembly module exports. */
interface MixerExports {
	readonly memory: WebAssembly.Memory;
	sound_setup(voices: number, sampleRate: number): void;
	sound_table(
		capacity: number,
		frame: number,
		volume: number,
		listenerAt: number,
		listenerTurn: number,
		places: number,
		levels: number,
		rates: number,
		tones: number,
	): number;
	sound_scratch(): number;
	sound_add(
		id: number,
		kind: number,
		first: number,
		count: number,
		positional: number,
		near: number,
		far: number,
		muffle: number,
		voices: number,
	): void;
	sound_remove(id: number): void;
	sound_ready(voice: number): void;
	sound_shot(voice: number): void;
	sound_render(frames: number): number;
	sound_gains(): number;
	sound_columns(): number;
	sound_max_frames(): number;
}

/**
 * The mixer's browser side, apart from the worklet class, so a test can run it. It holds one
 * instance of the module, whose memory never grows, so its views of that memory stay valid. `send`
 * gives the page a reply, with the buffers that it moves rather than copies.
 */
export class Mixer {
	private readonly wasm: MixerExports;
	private readonly memory: ArrayBuffer;
	private readonly voiceList: Int32Array;
	/** The outputs that the module's values go to, in the module's order: x, y, z, rate, cutoff. */
	private readonly valueOutputs: readonly number[];
	private readonly maxFrames: number;
	/** The table in the module's memory, which the source is copied into each quantum. */
	private table: Float32Array | null = null;
	/** The sketch's table: shared, or the copy that the page last sent. */
	private source: Float32Array | null = null;
	/** The table's own buffer, when the page sends copies rather than sharing it. */
	private own: Float32Array | null = null;
	/** True until the first copy of a copied table lands, while the mixer stays silent. */
	private awaitingCopy = false;
	/**
	 * The views of each voice's runs for a render of the module's most frames, and for a shorter
	 * one: a quantum renders in one piece, or in pieces of the most and a shorter rest. Fields hold
	 * them, since a lookup in a map allocated about 48 bytes a call in V8.
	 */
	private fullViews: RunViews | null = null;
	private partViews: RunViews | null = null;
	private partFrames = 0;

	constructor(
		sampleRate: number,
		private readonly setup: MixerSetup,
		private readonly send: (reply: MixerReply, transfer?: ArrayBuffer[]) => void,
		module: WebAssembly.Module,
	) {
		this.wasm = new WebAssembly.Instance(module, {}).exports as unknown as MixerExports;
		this.wasm.sound_setup(setup.voices, sampleRate);
		this.memory = this.wasm.memory.buffer;
		const { x, y, z, rate, cutoff } = setup.outputs;
		this.valueOutputs = [x, y, z, rate, cutoff];
		this.voiceList = new Int32Array(this.memory, this.wasm.sound_scratch(), VOICE_LIST);
		this.maxFrames = this.wasm.sound_max_frames();
	}

	/** Takes one message from the page. */
	receive(message: MixerMessage): void {
		const wasm = this.wasm;
		switch (message.type) {
			case 'table': {
				const { layout, buffer } = message;
				this.useTable(layout);
				if (buffer) {
					this.source = new Float32Array(buffer, 0, layout.length);
					this.own = null;
					this.awaitingCopy = false;
				} else {
					this.own = new Float32Array(layout.length);
					this.source = this.own;
					this.awaitingCopy = true;
				}
				return;
			}
			case 'copy': {
				const own = this.own;
				if (own) {
					own.set(new Float32Array(message.buffer, 0, own.length));
					this.awaitingCopy = false;
				}
				this.send({ type: 'copy', buffer: message.buffer }, [message.buffer]);
				return;
			}
			case 'add': {
				const { sound } = message;
				const count = Math.min(sound.voices.length, VOICE_LIST);
				// A voice that is not one of the mixer's goes to the module as -1, which it skips.
				for (let k = 0; k < count; k++) {
					const v = sound.voices[k] as number;
					this.voiceList[k] = this.isVoice(v) ? v : -1;
				}
				wasm.sound_add(
					sound.id,
					KINDS[sound.kind],
					sound.first,
					sound.count,
					sound.positional ? 1 : 0,
					sound.near,
					sound.far,
					sound.muffle ? 1 : 0,
					count,
				);
				return;
			}
			case 'remove':
				wasm.sound_remove(message.id);
				return;
			case 'ready':
				if (this.isVoice(message.voice)) wasm.sound_ready(message.voice);
				return;
			case 'shot':
				if (this.isVoice(message.voice)) wasm.sound_shot(message.voice);
				return;
		}
	}

	/** True for a whole number that names one of the mixer's voices. */
	private isVoice(v: number): boolean {
		return Number.isInteger(v) && v >= 0 && v < this.setup.voices;
	}

	/** Gives the module the table's layout and makes the view that each quantum copies into. */
	private useTable(layout: TableLayout): void {
		const at = this.wasm.sound_table(
			layout.capacity,
			layout.frame,
			layout.volume,
			layout.listenerAt,
			layout.listenerTurn,
			layout.places,
			layout.levels,
			layout.rates,
			layout.tones,
		);
		this.table = new Float32Array(this.memory, at, layout.length);
	}

	/**
	 * Writes one quantum of every output: each voice's place in the listener's frame, its gain
	 * (eased across the quantum), its playback rate and its filter's cutoff. `outputs` holds the
	 * mixer's outputs in the order that the page gave, each with one channel per voice.
	 */
	render(outputs: readonly (readonly Float32Array[])[]): void {
		const out = this.setup.outputs;
		const gains = outputs[out.gain];
		const frames = gains?.[0]?.length ?? 0;
		if (!gains || frames === 0) return;
		const table = this.table;
		const source = this.source;
		if (!table || !source || this.awaitingCopy) {
			for (let v = 0; v < gains.length; v++) gains[v]?.fill(0);
			return;
		}
		table.set(source);
		const voices = this.setup.voices;
		const xs = outputs[out.x];
		const ys = outputs[out.y];
		const zs = outputs[out.z];
		const rates = outputs[out.rate];
		const cutoffs = outputs[out.cutoff];
		let report = 0;
		if (xs && ys && zs && rates && cutoffs && frames <= this.maxFrames) {
			// A quantum that the module renders in one piece, as every browser's is today: each run
			// goes whole to its channel, in the module's order of x, y, z, rate and cutoff.
			report = this.wasm.sound_render(frames);
			const { gains: gainRuns, columns } = this.viewsFor(frames);
			for (let v = 0, r = 0; v < voices; v++, r += VALUES) {
				gains[v]?.set(gainRuns[v] as Float32Array);
				xs[v]?.set(columns[r] as Float32Array);
				ys[v]?.set(columns[r + 1] as Float32Array);
				zs[v]?.set(columns[r + 2] as Float32Array);
				rates[v]?.set(columns[r + 3] as Float32Array);
				cutoffs[v]?.set(columns[r + 4] as Float32Array);
			}
		} else {
			// A longer quantum, which a browser may choose, renders in pieces of the module's most
			// frames, and each piece's runs go to their place in the quantum.
			const valueOutputs = this.valueOutputs;
			for (let start = 0; start < frames; start += this.maxFrames) {
				const left = frames - start;
				const length = left < this.maxFrames ? left : this.maxFrames;
				report |= this.wasm.sound_render(length);
				const { gains: gainRuns, columns } = this.viewsFor(length);
				for (let v = 0; v < voices; v++) {
					copyRun(gains[v], gainRuns[v], start);
					for (let i = 0; i < VALUES; i++)
						copyRun(outputs[valueOutputs[i] as number]?.[v], columns[v * VALUES + i], start);
				}
			}
		}
		if (report & STOPPED) this.send({ type: 'idle' });
		if (report & MOVING) this.send({ type: 'active' });
	}

	/** The views of each voice's runs for a render of `frames` frames, made at its first use. */
	private viewsFor(frames: number): RunViews {
		if (frames === this.maxFrames) {
			this.fullViews ??= this.makeViews(frames);
			return this.fullViews;
		}
		if (frames !== this.partFrames || !this.partViews) {
			this.partViews = this.makeViews(frames);
			this.partFrames = frames;
		}
		return this.partViews;
	}

	/** Makes the views of each voice's runs for a render of `frames` frames. */
	private makeViews(frames: number): RunViews {
		const run = (at: number) => new Float32Array(this.memory, at, frames);
		const runBytes = this.maxFrames * 4;
		const gains = this.wasm.sound_gains();
		const columns = this.wasm.sound_columns();
		const views: RunViews = { gains: [], columns: [] };
		for (let v = 0; v < this.setup.voices; v++) {
			views.gains.push(run(gains + v * runBytes));
			for (let i = 0; i < VALUES; i++)
				views.columns.push(run(columns + (v * VALUES + i) * runBytes));
		}
		return views;
	}
}

/** The browser's worklet globals, which exist only on the audio thread. */
declare const sampleRate: number;
declare function registerProcessor(
	name: string,
	processor: new (options: { processorOptions: MixerSetup }) => unknown,
): void;
declare class AudioWorkletProcessor {
	constructor(options?: unknown);
	readonly port: MessagePort;
}

// Registers the mixer where the module runs as a worklet. A test imports the module elsewhere, where
// the browser's worklet globals do not exist.
if (typeof registerProcessor === 'function') {
	class SoundMixer extends AudioWorkletProcessor {
		private readonly mixer: Mixer;
		constructor(options: { processorOptions: MixerSetup }) {
			super(options);
			const setup = options.processorOptions;
			this.mixer = new Mixer(
				sampleRate,
				setup,
				(reply, transfer) => this.port.postMessage(reply, transfer ?? []),
				new WebAssembly.Module(setup.wasm),
			);
			this.port.onmessage = (event) => this.mixer.receive(event.data as MixerMessage);
		}
		process(_inputs: unknown, outputs: Float32Array[][]): boolean {
			this.mixer.render(outputs);
			return true;
		}
	}
	registerProcessor(MIXER_NAME, SoundMixer);
}
