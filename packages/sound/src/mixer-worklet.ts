// The add-on's mixer, which runs on the browser's audio thread as an AudioWorklet. In each render
// quantum it reads the table that the sketch writes, works out each voice's place relative to the
// listener, its gain, its playback rate and its filter's cutoff, and writes them to its outputs. The
// page connects each output channel to the voice's own audio nodes, so the sound follows the scene
// with no work on the page's thread and no message per frame.
//
// A group of many emitters gets a few voices. Every few quanta the mixer ranks the group's emitters
// by how loud each would be where the listener stands, and hands the voices to the loudest. A voice
// keeps its emitter while that emitter stays close to the cut, so voices do not flap between two
// emitters at the same distance. A voice that moves to another emitter fades out first, so its
// sound never jumps from one place to another.
//
// When the sketch's frame count stops, as it does while the engine is paused, every voice fades out
// and the mixer tells the page, which suspends the audio. The browser copies this file into a build
// as it is, so it imports nothing but types: the page gives it the table's layout and the order of
// its outputs.
import type { MixerMessage, MixerReply, MixerSetup, SoundSpec, TableLayout } from './protocol';

/** The name that the page makes the mixer's node with. The page's module holds the same name. */
export const MIXER_NAME = 'null3d-sound-mixer';

/** A voice or a slot that holds no emitter. */
const NONE = -1;
/** How fast a voice's gain follows its target, as a time constant in seconds. */
const GAIN_TIME = 0.05;
/** How fast a voice fades in once its file plays. */
const FADE_IN_TIME = 0.25;
/** How fast a voice fades out before it moves to another emitter, or as its sound stops. */
const SWITCH_TIME = 0.02;
/** How fast a voice's tone and rate follow their targets. */
const TONE_TIME = 0.08;
/** How fast every sound fades when the sketch stops or starts again. */
const PAUSE_TIME = 0.15;
/** How long the frame count may stand still before the mixer counts the sketch as stopped, in s. */
const IDLE_AFTER = 0.3;
/** The quanta between two rankings of a group's emitters. */
const RANK_EVERY = 4;
/**
 * The share of the weakest chosen emitter's loudness that a voice's emitter must keep for the voice
 * to stay on it. Below that share, the voice goes to a louder emitter.
 */
const HOLD_SHARE = 0.7;
/** A gain below this is silence. */
const SILENT = 1e-4;
/** The filter's cutoff at a tone of 0 and at a tone of 1, in hertz. */
const LOW_CUTOFF = 120;
const HIGH_CUTOFF = 20_000;
/** The share of its tone that a muffled sound loses at its far distance. */
const MUFFLE = 0.45;
/** Where a sound with a far distance starts to fade, as a share of that distance. */
const FAR_FADE = 0.6;

/** A smooth step from 0 at `low` to 1 at `high`. */
function smoothstep(low: number, high: number, value: number): number {
	if (value <= low) return 0;
	if (value >= high) return 1;
	const t = (value - low) / (high - low);
	return t * t * (3 - 2 * t);
}

/** The share of a sound's level that is left at `distance`, from its near and far distances. */
export function distanceGain(sound: SoundSpec, distance: number): number {
	let gain = 1;
	if (sound.near > 0 && distance > sound.near) gain = sound.near / distance;
	if (sound.far > 0) gain *= 1 - smoothstep(sound.far * FAR_FADE, sound.far, distance);
	return gain;
}

/** The share of a sound's tone that is left at `distance`, as muffling takes the highs. */
export function distanceTone(sound: SoundSpec, distance: number): number {
	if (!sound.muffle || sound.far <= 0) return 1;
	return 1 - MUFFLE * smoothstep(sound.near, sound.far, distance);
}

/** The filter's cutoff in hertz for a tone from 0 to 1. */
export function cutoffOf(tone: number): number {
	const t = tone < 0 ? 0 : tone > 1 ? 1 : tone;
	return LOW_CUTOFF * (HIGH_CUTOFF / LOW_CUTOFF) ** t;
}

/** The largest level that the mixer takes from the table. */
const LOUDEST = 16;
/** The widest playback rate that the mixer takes from the table, each way from 1. */
const FASTEST = 16;

/** A level from the table: 0 up to the loudest, and 0 for a value that is not a finite number. */
function levelOf(value: number): number {
	if (!(value > 0) || value === Number.POSITIVE_INFINITY) return 0;
	return value < LOUDEST ? value : LOUDEST;
}

/** A tone from the table: 0 to 1, and 1 for a value that is not a number. */
function toneOf(value: number): number {
	return value >= 0 ? (value < 1 ? value : 1) : value < 0 ? 0 : 1;
}

/** A playback rate from the table, within the widest rate, and 1 for one that is not. */
function rateOf(value: number): number {
	return value > 1 / FASTEST && value < FASTEST ? value : 1;
}

/** No voice moves its rate and tone at once. */
const EASE = 0;
/** The voice takes its emitter's rate and tone at once, as it moves to a new emitter. */
const SNAP_PITCH = 1;
/** The voice takes its gain, rate and tone at once, as a shot starts. */
const SNAP_ALL = 2;

/**
 * The mixer's work, apart from the browser's worklet class, so a test can run it. `send` gives the
 * page a reply, with the buffers that it moves rather than copies.
 */
export class Mixer {
	private layout: TableLayout | null = null;
	private floats: Float32Array | null = null;
	private ints: Int32Array | null = null;
	/** The table's own buffer, when the page sends copies rather than sharing it. */
	private own: Float32Array | null = null;
	/** Each emitter's loudness at the last ranking. */
	private loudness = new Float32Array(0);

	/** The sound that each voice belongs to, or null. */
	private readonly sound: (SoundSpec | null)[];
	/** The sounds whose emitters the mixer ranks. */
	private groups: SoundSpec[] = [];
	/** The emitter that each voice plays. */
	private readonly emitter: Int32Array;
	/** The emitter that each voice moves to once it has faded out, or NONE. */
	private readonly next: Int32Array;
	/** 1 while a voice's file plays. */
	private readonly ready: Uint8Array;
	/** 1 while a voice fades in for the first time. */
	private readonly fresh: Uint8Array;
	/** 1 while a group wants the voice to sound; 0 fades it out. */
	private readonly wanted: Uint8Array;
	/** 1 for a voice whose sound the sketch removed, which clears once it is silent. */
	private readonly dying: Uint8Array;
	/** 1 for a voice that a ranking left without an emitter. */
	private readonly free: Uint8Array;
	/** Which of a voice's values it takes at once in the next quantum, with no easing. */
	private readonly snap: Uint8Array;
	private readonly gain: Float32Array;
	private readonly tone: Float32Array;
	private readonly rate: Float32Array;
	/** The emitters that a ranking chose, loudest first, and their loudness. */
	private readonly chosen: Int32Array;
	private readonly chosenLoudness: Float32Array;

	/** The render quantum's length in frames, which sets each time constant's step. */
	private frames = 0;
	private gainStep = 0;
	private fadeInStep = 0;
	private switchStep = 0;
	private toneStep = 0;
	private pauseStep = 0;
	private idleQuanta = 0;

	private lastFrame = 0;
	private stillQuanta = 0;
	private pause = 0;
	/**
	 * True once the mixer has told the page that the sketch stopped. It starts false, so a sketch
	 * that never moves its frame count, such as one whose engine was paused before the sound
	 * started, is reported too.
	 */
	private idle = false;
	private quantum = 0;

	constructor(
		private readonly sampleRate: number,
		private readonly setup: MixerSetup,
		private readonly send: (reply: MixerReply, transfer?: ArrayBuffer[]) => void,
	) {
		const voices = setup.voices;
		this.sound = new Array<SoundSpec | null>(voices).fill(null);
		this.emitter = new Int32Array(voices).fill(NONE);
		this.next = new Int32Array(voices).fill(NONE);
		this.ready = new Uint8Array(voices);
		this.fresh = new Uint8Array(voices);
		this.wanted = new Uint8Array(voices);
		this.dying = new Uint8Array(voices);
		this.free = new Uint8Array(voices);
		this.snap = new Uint8Array(voices);
		this.gain = new Float32Array(voices);
		this.tone = new Float32Array(voices).fill(1);
		this.rate = new Float32Array(voices).fill(1);
		this.chosen = new Int32Array(voices);
		this.chosenLoudness = new Float32Array(voices);
	}

	/** Takes one message from the page. */
	receive(message: MixerMessage): void {
		switch (message.type) {
			case 'table': {
				const { layout, buffer } = message;
				this.layout = layout;
				const bytes = buffer ?? new ArrayBuffer(layout.length * 4);
				this.floats = new Float32Array(bytes, 0, layout.length);
				this.ints = new Int32Array(bytes, 0, layout.length);
				this.own = buffer ? null : this.floats;
				this.loudness = new Float32Array(layout.capacity);
				return;
			}
			case 'copy': {
				const own = this.own;
				if (own) own.set(new Float32Array(message.buffer, 0, own.length));
				this.send({ type: 'copy', buffer: message.buffer }, [message.buffer]);
				return;
			}
			case 'add':
				this.add(message.sound);
				return;
			case 'remove':
				this.remove(message.id);
				return;
			case 'ready':
				if (this.isVoice(message.voice)) {
					this.ready[message.voice] = 1;
					this.fresh[message.voice] = 1;
				}
				return;
			case 'shot':
				if (this.isVoice(message.voice)) this.snap[message.voice] = SNAP_ALL;
				return;
			case 'reset':
				for (let v = 0; v < this.setup.voices; v++) this.clear(v);
				this.groups = [];
				this.layout = null;
				this.floats = null;
				this.ints = null;
				this.own = null;
				return;
		}
	}

	private isVoice(v: number): boolean {
		return Number.isInteger(v) && v >= 0 && v < this.setup.voices;
	}

	/** Frees voice `v` at once. */
	private clear(v: number): void {
		this.sound[v] = null;
		this.emitter[v] = NONE;
		this.next[v] = NONE;
		this.ready[v] = 0;
		this.fresh[v] = 0;
		this.wanted[v] = 0;
		this.dying[v] = 0;
		this.snap[v] = EASE;
		this.gain[v] = 0;
	}

	private add(sound: SoundSpec): void {
		const shot = sound.kind === 'shot';
		const group = sound.kind === 'group';
		const voices = sound.voices;
		for (let k = 0; k < voices.length; k++) {
			const v = voices[k] as number;
			if (!this.isVoice(v)) continue;
			this.clear(v);
			this.sound[v] = sound;
			// A loop and a shot keep one emitter for each voice, and a group's voices wait for a ranking.
			this.emitter[v] = group ? NONE : sound.first + k;
			// A shot's voice is ready at once: its file starts on each play, with the attack the file has.
			this.ready[v] = shot ? 1 : 0;
			this.wanted[v] = group ? 0 : 1;
			this.tone[v] = 1;
			this.rate[v] = 1;
		}
		if (group) this.groups = [...this.groups, sound];
	}

	private remove(id: number): void {
		for (let v = 0; v < this.setup.voices; v++) {
			if (this.sound[v]?.id !== id) continue;
			this.wanted[v] = 0;
			this.dying[v] = 1;
		}
		this.groups = this.groups.filter((sound) => sound.id !== id);
	}

	/** Sets each time constant's step for a quantum of `frames` frames. */
	private setFrames(frames: number): void {
		this.frames = frames;
		const seconds = frames / this.sampleRate;
		const step = (time: number) => 1 - Math.exp(-seconds / time);
		this.gainStep = step(GAIN_TIME);
		this.fadeInStep = step(FADE_IN_TIME);
		this.switchStep = step(SWITCH_TIME);
		this.toneStep = step(TONE_TIME);
		this.pauseStep = step(PAUSE_TIME);
		this.idleQuanta = Math.ceil(IDLE_AFTER / seconds);
	}

	/** The listener's place and turn, read once per quantum. */
	private lx = 0;
	private ly = 0;
	private lz = 0;
	private qx = 0;
	private qy = 0;
	private qz = 0;
	private qw = 1;
	/** The emitter's place relative to the listener, and its distance, that `place` works out. */
	private rx = 0;
	private ry = 0;
	private rz = 0;
	private distance = 0;

	/**
	 * Works out emitter `e`'s place in the listener's frame and its distance. Returns false for a
	 * place that is not a number, which leaves the emitter silent.
	 */
	private place(floats: Float32Array, places: number, e: number): boolean {
		const px = (floats[places + 3 * e] as number) - this.lx;
		const py = (floats[places + 3 * e + 1] as number) - this.ly;
		const pz = (floats[places + 3 * e + 2] as number) - this.lz;
		const distance = Math.sqrt(px * px + py * py + pz * pz);
		if (!Number.isFinite(distance)) return false;
		// The inverse of the listener's turn, which carries the world into the listener's frame.
		const ux = -this.qx;
		const uy = -this.qy;
		const uz = -this.qz;
		const w = this.qw;
		const tx = 2 * (uy * pz - uz * py);
		const ty = 2 * (uz * px - ux * pz);
		const tz = 2 * (ux * py - uy * px);
		this.rx = px + w * tx + (uy * tz - uz * ty);
		this.ry = py + w * ty + (uz * tx - ux * tz);
		this.rz = pz + w * tz + (ux * ty - uy * tx);
		this.distance = distance;
		return true;
	}

	/** Ranks a group's emitters and hands its voices to the loudest. */
	private rank(sound: SoundSpec, floats: Float32Array, layout: TableLayout): void {
		const { chosen, chosenLoudness, loudness } = this;
		const voices = sound.voices;
		const wanted = voices.length;
		let count = 0;
		for (let e = sound.first; e < sound.first + sound.count; e++) {
			const level = levelOf(floats[layout.levels + e] as number);
			let value = 0;
			if (level > 0 && this.place(floats, layout.places, e))
				value = level * distanceGain(sound, this.distance);
			loudness[e] = value;
			if (!(value > SILENT)) continue;
			if (count === wanted && value <= (chosenLoudness[count - 1] as number)) continue;
			// Insert the emitter in loudness order, dropping the quietest when the list is full.
			let at = count < wanted ? count++ : count - 1;
			while (at > 0 && (chosenLoudness[at - 1] as number) < value) {
				chosen[at] = chosen[at - 1] as number;
				chosenLoudness[at] = chosenLoudness[at - 1] as number;
				at--;
			}
			chosen[at] = e;
			chosenLoudness[at] = value;
		}
		const cut = count === wanted ? HOLD_SHARE * (chosenLoudness[count - 1] as number) : 0;
		// A voice keeps its emitter while that emitter is chosen, or stays near the cut.
		for (let j = 0; j < wanted; j++) {
			const v = voices[j] as number;
			const held = this.next[v] !== NONE ? (this.next[v] as number) : (this.emitter[v] as number);
			const keep =
				held !== NONE &&
				(loudness[held] as number) > SILENT &&
				(this.isChosen(held, count) || (loudness[held] as number) >= cut);
			this.free[v] = keep ? 0 : 1;
			this.wanted[v] = keep ? 1 : 0;
		}
		// Each chosen emitter that no voice holds takes a free voice.
		for (let k = 0; k < count; k++) {
			const e = chosen[k] as number;
			let heldBy = NONE;
			let freeVoice = NONE;
			for (let j = 0; j < wanted; j++) {
				const v = voices[j] as number;
				const held = this.next[v] !== NONE ? this.next[v] : this.emitter[v];
				if (held === e && this.free[v] === 0) heldBy = v;
				else if (freeVoice === NONE && this.free[v] === 1) freeVoice = v;
			}
			if (heldBy !== NONE || freeVoice === NONE) continue;
			this.free[freeVoice] = 0;
			this.wanted[freeVoice] = 1;
			// A silent voice takes its emitter at once; one that sounds fades out and then moves.
			if (this.emitter[freeVoice] === NONE || (this.gain[freeVoice] as number) < SILENT) {
				this.emitter[freeVoice] = e;
				this.next[freeVoice] = NONE;
				this.snap[freeVoice] = SNAP_PITCH;
			} else this.next[freeVoice] = e;
		}
	}

	private isChosen(e: number, count: number): boolean {
		for (let k = 0; k < count; k++) if (this.chosen[k] === e) return true;
		return false;
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
		if (frames !== this.frames) this.setFrames(frames);
		const floats = this.floats;
		const ints = this.ints;
		const layout = this.layout;
		if (!floats || !ints || !layout) {
			for (let v = 0; v < gains.length; v++) gains[v]?.fill(0);
			return;
		}
		const xs = outputs[out.x];
		const ys = outputs[out.y];
		const zs = outputs[out.z];
		const rates = outputs[out.rate];
		const cutoffs = outputs[out.cutoff];

		// The sketch counts its frames; a count that stands still means the sketch has stopped.
		const frame = ints[layout.frame] as number;
		if (frame !== this.lastFrame) {
			this.lastFrame = frame;
			this.stillQuanta = 0;
			if (this.idle) {
				this.idle = false;
				this.send({ type: 'active' });
			}
		} else if (this.stillQuanta < this.idleQuanta) this.stillQuanta++;
		const running = this.stillQuanta < this.idleQuanta;
		this.pause += ((running ? 1 : 0) - this.pause) * this.pauseStep;
		if (!running && !this.idle && this.pause < SILENT) {
			this.idle = true;
			this.send({ type: 'idle' });
		}

		this.lx = floats[layout.listenerAt] as number;
		this.ly = floats[layout.listenerAt + 1] as number;
		this.lz = floats[layout.listenerAt + 2] as number;
		this.qx = floats[layout.listenerTurn] as number;
		this.qy = floats[layout.listenerTurn + 1] as number;
		this.qz = floats[layout.listenerTurn + 2] as number;
		this.qw = floats[layout.listenerTurn + 3] as number;
		// A listener that is not a number hears nothing until the sketch writes one that is.
		const heard =
			Number.isFinite(this.lx + this.ly + this.lz) &&
			Number.isFinite(this.qx + this.qy + this.qz + this.qw);
		const volumeValue = floats[layout.volume] as number;
		const volume = heard ? (volumeValue > 0 ? (volumeValue < 1 ? volumeValue : 1) : 0) : 0;

		if (++this.quantum >= RANK_EVERY) {
			this.quantum = 0;
			const groups = this.groups;
			for (let g = 0; g < groups.length; g++) this.rank(groups[g] as SoundSpec, floats, layout);
		}

		for (let v = 0; v < this.setup.voices; v++) {
			const gainChannel = gains[v];
			if (!gainChannel) continue;
			const sound = this.sound[v];
			if (!sound) {
				gainChannel.fill(0);
				continue;
			}
			let e = this.emitter[v] as number;
			const before = this.gain[v] as number;
			// A voice that has faded out moves to the emitter it waits for, or stops for good.
			if (before < SILENT && this.next[v] !== NONE) {
				e = this.next[v] as number;
				this.emitter[v] = e;
				this.next[v] = NONE;
				this.snap[v] = SNAP_PITCH;
			}
			if (before < SILENT && this.dying[v] === 1) {
				this.clear(v);
				gainChannel.fill(0);
				continue;
			}
			let target = 0;
			let toneTarget = 1;
			let rateTarget = this.rate[v] as number;
			if (e !== NONE) {
				const level = levelOf(floats[layout.levels + e] as number);
				toneTarget = toneOf(floats[layout.tones + e] as number);
				rateTarget = rateOf(floats[layout.rates + e] as number);
				let share = 1;
				if (sound.positional) {
					if (this.place(floats, layout.places, e)) {
						share = distanceGain(sound, this.distance);
						toneTarget *= distanceTone(sound, this.distance);
						xs?.[v]?.fill(this.rx);
						ys?.[v]?.fill(this.ry);
						zs?.[v]?.fill(this.rz);
					} else share = 0;
				}
				const on =
					this.ready[v] === 1 &&
					this.wanted[v] === 1 &&
					this.dying[v] === 0 &&
					this.next[v] === NONE;
				target = on && level > 0 ? level * share * volume * this.pause : 0;
			}
			let after: number;
			if (this.snap[v] === SNAP_ALL) {
				// A shot starts at its own level, place and pitch, not at its slot's last play.
				after = target;
				this.tone[v] = toneTarget;
				this.rate[v] = rateTarget;
			} else {
				if (this.snap[v] === SNAP_PITCH) {
					// A voice that moves to a new emitter takes the new emitter's pitch and tone while silent.
					this.tone[v] = toneTarget;
					this.rate[v] = rateTarget;
				}
				let step = this.gainStep;
				if (target < before && (this.next[v] !== NONE || this.dying[v] === 1))
					step = this.switchStep;
				else if (this.fresh[v] === 1 && target > 0) {
					step = this.fadeInStep;
					if (before >= target * 0.9) this.fresh[v] = 0;
				}
				after = before + (target - before) * step;
			}
			this.snap[v] = EASE;
			if (!(after >= 0)) after = 0;
			this.gain[v] = after;
			// The gain eases across the quantum, so a change makes no step that clicks.
			const delta = (after - before) / frames;
			for (let i = 0; i < frames; i++) gainChannel[i] = before + delta * (i + 1);
			const tone =
				(this.tone[v] as number) + (toneTarget - (this.tone[v] as number)) * this.toneStep;
			this.tone[v] = tone;
			cutoffs?.[v]?.fill(Math.min(cutoffOf(tone), this.sampleRate * 0.45));
			const rate =
				(this.rate[v] as number) + (rateTarget - (this.rate[v] as number)) * this.toneStep;
			this.rate[v] = rate;
			rates?.[v]?.fill(rate);
		}
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
			this.mixer = new Mixer(sampleRate, options.processorOptions, (reply, transfer) =>
				this.port.postMessage(reply, transfer ?? []),
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
