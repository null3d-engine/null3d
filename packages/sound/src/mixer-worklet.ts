// The add-on's mixer, which runs on the browser's audio thread as an AudioWorklet. Its work is in
// Rust, in `crates/null3d-sound`, compiled to WebAssembly (hard rule 42): in each render quantum the
// module reads the table that the sketch writes, works out each voice's place relative to the
// listener, its gain, its playback rate and its filter's cutoff, and writes them into its memory.
// This file does the browser's part: it copies the sketch's table into the module, calls it once a
// quantum, and copies each voice's values into the browser's output arrays, which the page connects
// to each voice's own audio nodes. The sound follows the scene with no work on the page's thread.
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
	sound_values(): number;
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
	private readonly values: Float32Array;
	private readonly voiceList: Int32Array;
	private readonly maxFrames: number;
	/** The table in the module's memory, which the source is copied into each quantum. */
	private table: Float32Array | null = null;
	/** The sketch's table: shared, or the copy that the page last sent. */
	private source: Float32Array | null = null;
	/** The table's own buffer, when the page sends copies rather than sharing it. */
	private own: Float32Array | null = null;
	/** True until the first copy of a copied table lands, while the mixer stays silent. */
	private awaitingCopy = false;
	/** A view of each voice's gains for a quantum of `gainFrames` frames. */
	private gainViews: Float32Array[] = [];
	private gainFrames = 0;

	constructor(
		sampleRate: number,
		private readonly setup: MixerSetup,
		private readonly send: (reply: MixerReply, transfer?: ArrayBuffer[]) => void,
		module: WebAssembly.Module,
	) {
		this.wasm = new WebAssembly.Instance(module, {}).exports as unknown as MixerExports;
		this.wasm.sound_setup(setup.voices, sampleRate);
		this.memory = this.wasm.memory.buffer;
		this.values = new Float32Array(this.memory, this.wasm.sound_values(), setup.voices * VALUES);
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
				for (let k = 0; k < count; k++) this.voiceList[k] = sound.voices[k] as number;
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
				wasm.sound_ready(message.voice);
				return;
			case 'shot':
				wasm.sound_shot(message.voice);
				return;
		}
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
		if (!gains || frames === 0 || frames > this.maxFrames) return;
		const table = this.table;
		const source = this.source;
		if (!table || !source || this.awaitingCopy) {
			for (let v = 0; v < gains.length; v++) gains[v]?.fill(0);
			return;
		}
		table.set(source);
		const report = this.wasm.sound_render(frames);
		if (report & STOPPED) this.send({ type: 'idle' });
		if (report & MOVING) this.send({ type: 'active' });
		if (frames !== this.gainFrames) this.makeGainViews(frames);
		const xs = outputs[out.x];
		const ys = outputs[out.y];
		const zs = outputs[out.z];
		const rates = outputs[out.rate];
		const cutoffs = outputs[out.cutoff];
		const values = this.values;
		// The module did the work; each voice's values go to the browser's arrays in its own calls.
		for (let v = 0; v < this.setup.voices; v++) {
			gains[v]?.set(this.gainViews[v] as Float32Array);
			const at = v * VALUES;
			xs?.[v]?.fill(values[at] as number);
			ys?.[v]?.fill(values[at + 1] as number);
			zs?.[v]?.fill(values[at + 2] as number);
			rates?.[v]?.fill(values[at + 3] as number);
			cutoffs?.[v]?.fill(values[at + 4] as number);
		}
	}

	/** Makes a view of each voice's gains for a quantum of `frames` frames. */
	private makeGainViews(frames: number): void {
		const start = this.wasm.sound_gains();
		this.gainViews = [];
		for (let v = 0; v < this.setup.voices; v++)
			this.gainViews.push(new Float32Array(this.memory, start + v * this.maxFrames * 4, frames));
		this.gainFrames = frames;
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
