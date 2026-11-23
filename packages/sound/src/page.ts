// The page's half of the add-on: the browser's audio, which only the page's thread may make. It
// opens a link of its own to the sketch, starts an AudioContext on the user's press, loads each
// sound's file once, and builds the audio nodes of each voice: the file's source, a low-pass filter
// for its tone, a gain and, for a sound that comes from a place, a panner. A mixer on the audio
// thread drives every one of those values from the table that the sketch writes, so this half does
// no work in a frame where the page shares memory with its workers.
//
// The page pays for nothing until the user starts the sound: no file loads and no audio runs. When
// the engine pauses, the mixer fades every voice out and this half suspends the audio, and it
// resumes it when the sketch's frames move again. The engine's stop closes it for good.
import { checkAddonVersion, type Engine } from '@null3d/engine';
import { gaplessBounds, mp3Gapless, soundBounds } from './bounds';
import {
	CONNECT_MESSAGE,
	type ConnectData,
	isShared,
	MAX_VOICES,
	MIXER_OUTPUTS,
	OUTPUT_COUNT,
} from './layout';
import type {
	MixerMessage,
	MixerReply,
	MixerSetup,
	Panning,
	SketchMessage,
	SoundSpec,
	TableLayout,
} from './protocol';
import { VERSION } from './version';

checkAddonVersion('@null3d/sound', VERSION);

/** The mixer's module, which the page loads into the audio thread. */
const MIXER_URL = new URL('./mixer-worklet.ts', import.meta.url);
/** The mixer's WebAssembly module, built from `crates/null3d-sound`, whose bytes the page hands it. */
const MIXER_WASM_URL = new URL('../dist/sound.wasm', import.meta.url);
/** The name that the mixer registers. The mixer's module holds the same name. */
const MIXER_NAME = 'null3d-sound-mixer';
/** How often the page asks the sketch for its link until the sketch answers, in milliseconds. */
const CONNECT_EVERY_MS = 500;
/**
 * How long the page asks at that pace, in milliseconds. After it the page says that the sketch has
 * not answered, and asks less often, for a sketch that makes its sound late.
 */
const CONNECT_FOR_MS = 60_000;
/** How often the page asks once that time has passed, in milliseconds. */
const CONNECT_SLOWLY_MS = 5000;
/**
 * How long after its play message a shot's file starts, in seconds, so the mixer has taken the
 * play's level, place and pitch before the first sample sounds.
 */
const SHOT_DELAY = 0.02;
/** How fast a shot that a newer play replaces fades out, as a time constant in seconds. */
const SHOT_FADE = 0.01;
/**
 * How long a newer play waits for the play that it replaces to fade, in milliseconds, before the
 * mixer takes the newer play's values: the voice is shared, so its level jumps only once silent.
 */
const SHOT_SWAP_MS = 60;
/** The most copies of the table that wait for the mixer at once. */
const MOST_COPIES = 4;
/** The level, in decibels below full scale, above which the page's limiter holds the mix. */
const LIMIT_THRESHOLD = -3;
/** The inputs after which a browser lets a page start its audio. */
const ACTIVATIONS = ['pointerup', 'touchend', 'click', 'keydown'] as const;
/** How often a suspended page looks for the sketch's frames, in milliseconds. */
const WAKE_EVERY_MS = 250;
/** How long a removed voice keeps its nodes, so its fade ends before they go, in milliseconds. */
const RELEASE_MS = 200;
/** The Q of a low-pass filter with no peak at its cutoff, in decibels. */
const FLAT_Q = -3.0103;

/**
 * Where the page's sound stands: not started, starting, playing, paused while the engine is paused
 * or the page is hidden, interrupted while the browser holds the audio, as an iPhone does during a
 * call, or stopped for good. An interrupted sound resumes at the user's next input, or when the page
 * shows again.
 *
 * @category api/sound
 */
export type SoundState = 'off' | 'starting' | 'on' | 'paused' | 'interrupted' | 'stopped';

/**
 * Options for `connectSound`.
 *
 * @category api/sound
 */
export interface PageSoundOptions {
	/**
	 * Starts the sound on the user's first click, tap or key on the page, other than Escape. Browsers
	 * let a page start its audio only in answer to such an input. The default is false: the page calls
	 * `start` from its own control, such as a sound button.
	 */
	startOnInput?: boolean;
	/** Starts muted. The default is false. */
	muted?: boolean;
}

/**
 * The page's half of the sound, as `connectSound` makes it.
 *
 * @category api/sound
 */
export interface PageSound {
	/** Where the sound stands now. */
	readonly state: SoundState;
	/** True while the page's sound is muted. */
	readonly muted: boolean;
	/**
	 * Starts the audio. Call it in the handler of a click, a tap or a key, since browsers start a
	 * page's audio only in answer to the user. Resolves once the audio runs, with the sounds' files
	 * still loading; each sound fades in as its file arrives.
	 */
	start(): Promise<void>;
	/** Mutes or unmutes every sound. */
	setMuted(muted: boolean): void;
	/** Calls `handler` each time the state changes. Returns a function that removes the handler. */
	onState(handler: (state: SoundState) => void): () => void;
	/** Stops the audio for good and closes the link to the sketch. The engine's stop does the same. */
	stop(): void;
}

/** A decoded file and the part of it that holds sound, past the codec's padding. */
interface Loaded {
	readonly buffer: AudioBuffer;
	/** The first and the last sample past the padding, in seconds. */
	readonly start: number;
	readonly end: number;
}

/** A file's source, and for a shot the gain that fades it when a newer play replaces it. */
interface Play {
	readonly source: AudioBufferSourceNode;
	readonly fade: GainNode | null;
}

/** The audio nodes of one voice. */
interface VoiceNodes {
	readonly sound: SoundSpec;
	readonly filter: BiquadFilterNode;
	readonly gain: GainNode;
	readonly panner: PannerNode | null;
	/** The file that plays on the voice now: a loop's one source, or a shot's newest play. */
	play: Play | null;
	/** A shot's play that waits for the play it replaces to fade, which a newer play replaces. */
	waiting: ReturnType<typeof setTimeout> | undefined;
}

/** A copy of the table for the mixer, with the message and the transfer list that carry it. */
interface Copy {
	floats: Float32Array;
	readonly message: { type: 'copy'; buffer: ArrayBuffer };
	readonly transfer: ArrayBuffer[];
}

/** A value of the browser's audio session, which Safari has. */
interface AudioSessionNavigator {
	audioSession?: { type: string };
}

/** Sets an audio parameter to follow its input once per render quantum, where the browser allows it. */
function quantumRate(param: AudioParam): void {
	try {
		param.automationRate = 'k-rate';
	} catch {
		// A browser that keeps this parameter at audio rate follows the input each sample instead.
	}
}

class SoundPage implements PageSound {
	state: SoundState = 'off';
	muted: boolean;
	private readonly handlers = new Set<(state: SoundState) => void>();
	private link: MessagePort | null = null;
	private box: ConnectData['box'] = { table: null };
	private connectTimer: ReturnType<typeof setTimeout> | undefined;
	private connectStarted = 0;
	private warnedLate = false;
	private layout: TableLayout | null = null;
	/** The table that the mixer reads: shared, or the sketch's own on the page's thread. */
	private table: ArrayBuffer | SharedArrayBuffer | null = null;
	private tableFloats: Float32Array | null = null;
	private tableInts: Int32Array | null = null;
	private shared = false;
	private panning: Panning = 'equal-power';
	private readonly sounds = new Map<number, SoundSpec>();

	private context: AudioContext | null = null;
	private mixer: AudioWorkletNode | null = null;
	private splitters: ChannelSplitterNode[] = [];
	private master: GainNode | null = null;
	private readonly voices: (VoiceNodes | undefined)[] = new Array(MAX_VOICES);
	private readonly files = new Map<string, Promise<Loaded | null>>();
	/** The copies of the table that go to the mixer where the page shares no memory. */
	private spares: Copy[] = [];
	private copyFrame = 0;
	/** True once the user asked for the sound with `start`, or the first input started it. */
	private wanted = false;
	private readonly startOnInput: boolean;
	/** True while the mixer reports that the sketch's frames have stopped. */
	private sketchIdle = false;
	/** True while this half suspended the audio because the sketch's frames stopped. */
	private idleSuspend = false;
	private wakeTimer: ReturnType<typeof setInterval> | undefined;
	private wakeFrame = 0;
	private listening = false;
	private readonly stopEngine: () => void;
	private readonly onActivation = (event: Event): void => {
		// Escape is not an input that lets a page start its audio.
		if (event.type === 'keydown' && (event as KeyboardEvent).key === 'Escape') return;
		if (!this.context) {
			if (this.startOnInput) void this.start();
			return;
		}
		this.resumeIfWanted();
	};
	private readonly onVisibility = (): void => {
		if (document.visibilityState === 'visible') this.resumeIfWanted();
	};

	constructor(
		private readonly engine: Engine,
		options: PageSoundOptions,
	) {
		this.muted = options.muted ?? false;
		this.startOnInput = options.startOnInput ?? false;
		this.stopEngine = engine.onStop(() => this.stop());
		this.beginAsking();
		if (this.startOnInput) this.listen(true);
		document.addEventListener('visibilitychange', this.onVisibility);
	}

	/** Asks the sketch for a link now, and again until the sketch answers. */
	private beginAsking(): void {
		this.endAsking();
		this.connectStarted = Date.now();
		this.ask();
	}

	/** Asks the sketch for a link, and plans the next ask until the sketch answers. */
	private ask(): void {
		if (this.state === 'stopped' || this.layout) return;
		const waited = Date.now() - this.connectStarted;
		if (waited > CONNECT_FOR_MS && !this.warnedLate) {
			this.warnedLate = true;
			console.warn(
				'null3D sound: the sketch has not answered connectSound. Call createSound in the sketch, and check that the sketch and the page use the same @null3d/sound. The page keeps asking.',
			);
		}
		this.link?.close();
		const channel = new MessageChannel();
		this.link = channel.port1;
		this.box = { table: null };
		channel.port1.onmessage = (event: MessageEvent<SketchMessage>) => this.fromSketch(event.data);
		const data: ConnectData = { port: channel.port2, box: this.box };
		this.engine.postToSketch(CONNECT_MESSAGE, data, [channel.port2]);
		this.connectTimer = setTimeout(
			() => this.ask(),
			waited > CONNECT_FOR_MS ? CONNECT_SLOWLY_MS : CONNECT_EVERY_MS,
		);
	}

	private endAsking(): void {
		if (this.connectTimer !== undefined) clearTimeout(this.connectTimer);
		this.connectTimer = undefined;
	}

	/** Listens for the inputs that let a page start its audio, or stops listening. */
	private listen(on: boolean): void {
		if (on === this.listening) return;
		this.listening = on;
		for (const name of ACTIVATIONS) {
			if (on) window.addEventListener(name, this.onActivation, { capture: true });
			else window.removeEventListener(name, this.onActivation, { capture: true });
		}
	}

	private setState(state: SoundState): void {
		if (this.state === state) return;
		this.state = state;
		for (const handler of this.handlers) handler(state);
	}

	private fromSketch(message: SketchMessage): void {
		if (this.state === 'stopped') return;
		switch (message.type) {
			case 'table': {
				this.endAsking();
				this.layout = message.layout;
				// Where the sketch runs on this thread, it put its own table in the box.
				this.table = this.box.table ?? message.buffer;
				this.shared = isShared(this.table);
				this.tableFloats = new Float32Array(this.table, 0, message.layout.length);
				this.tableInts = new Int32Array(this.table, 0, message.layout.length);
				this.panning = message.panning;
				this.giveMixerTable();
				return;
			}
			case 'add':
				this.sounds.set(message.sound.id, message.sound);
				this.toMixer({ type: 'add', sound: message.sound });
				this.build(message.sound);
				return;
			case 'remove': {
				const sound = this.sounds.get(message.id);
				this.sounds.delete(message.id);
				this.toMixer({ type: 'remove', id: message.id });
				if (sound) this.release(sound);
				return;
			}
			case 'play':
				this.play(message.id, message.slot);
				return;
			case 'panning':
				this.panning = message.panning;
				for (const voice of this.voices)
					if (voice?.panner) voice.panner.panningModel = this.pannerModel();
				return;
			case 'closed':
				if (message.reason === 'replaced') {
					console.warn(
						"null3D sound: another connectSound took the sketch's sound, so this one stops. Call connectSound once on a page.",
					);
					this.stop();
				} else this.reset();
				return;
		}
	}

	/**
	 * Drops the ended sound system's table and sounds, and asks for the sketch's next one. The
	 * sketch removed each sound before it closed the link, so each voice is fading in the mixer
	 * already, and its nodes go once the fade has ended.
	 */
	private reset(): void {
		this.sounds.clear();
		this.stopCopies();
		this.endWaking();
		this.layout = null;
		this.table = null;
		this.tableFloats = null;
		this.tableInts = null;
		this.sketchIdle = false;
		this.idleSuspend = false;
		this.beginAsking();
	}

	private pannerModel(): PanningModelType {
		return this.panning === 'hrtf' ? 'HRTF' : 'equalpower';
	}

	private toMixer(message: MixerMessage, transfer: Transferable[] = []): void {
		this.mixer?.port.postMessage(message, transfer);
	}

	/** Gives the mixer the table: shared, or as a copy once per display frame. */
	private giveMixerTable(): void {
		const { layout, table } = this;
		if (!this.mixer || !layout || !table) return;
		this.toMixer({
			type: 'table',
			layout,
			buffer: this.shared ? (table as SharedArrayBuffer) : null,
		});
		if (!this.shared) this.startCopies(layout);
	}

	/** Sends the mixer a copy of the table in each display frame, where the page shares no memory. */
	private startCopies(layout: TableLayout): void {
		if (this.copyFrame !== 0) return;
		this.spares = [0, 1].map(() => {
			const buffer = new ArrayBuffer(layout.length * Float32Array.BYTES_PER_ELEMENT);
			return {
				floats: new Float32Array(buffer),
				message: { type: 'copy', buffer },
				transfer: [buffer],
			};
		});
		const copy = () => {
			this.copyFrame = requestAnimationFrame(copy);
			if (this.state === 'on') this.copyNow();
		};
		this.copyFrame = requestAnimationFrame(copy);
	}

	/**
	 * Sends the mixer one copy of the table, if a spare buffer is back from it. `always` makes a new
	 * buffer when none is back, for a shot, whose values the mixer must read before it starts.
	 */
	private copyNow(always = false): void {
		const floats = this.tableFloats;
		if (!floats) return;
		let spare = this.spares.pop();
		if (!spare && always && this.inFlight.length < MOST_COPIES) {
			const buffer = new ArrayBuffer(floats.byteLength);
			spare = {
				floats: new Float32Array(buffer),
				message: { type: 'copy', buffer },
				transfer: [buffer],
			};
		}
		if (!spare) return;
		spare.floats.set(floats);
		this.toMixer(spare.message, spare.transfer);
		// The buffer now belongs to the mixer, which sends it back with its copy reply.
		this.inFlight.push(spare);
	}

	/** The copies on their way to the mixer, oldest first, which its replies hand back in order. */
	private inFlight: Copy[] = [];

	private stopCopies(): void {
		if (this.copyFrame !== 0) cancelAnimationFrame(this.copyFrame);
		this.copyFrame = 0;
		this.spares = [];
		this.inFlight = [];
	}

	private fromMixer(reply: MixerReply): void {
		switch (reply.type) {
			case 'copy': {
				const copy = this.inFlight.shift();
				if (!copy) return;
				// The buffer comes back as a new object, which the copy's message and view now name.
				copy.message.buffer = reply.buffer;
				copy.transfer[0] = reply.buffer;
				copy.floats = new Float32Array(reply.buffer);
				// The extra copy that a shot made goes once two spares wait again.
				if (this.spares.length < 2) this.spares.push(copy);
				return;
			}
			case 'idle':
				this.sketchIdle = true;
				this.suspendForIdle();
				return;
			case 'active':
				this.sketchIdle = false;
				return;
		}
	}

	/** Suspends the audio while the sketch's frames stand still, and wakes it when they move. */
	private suspendForIdle(): void {
		const context = this.context;
		const ints = this.tableInts;
		const layout = this.layout;
		if (!context || !ints || !layout || context.state !== 'running') return;
		this.idleSuspend = true;
		void context.suspend();
		this.endWaking();
		this.wakeFrame = ints[layout.frame] as number;
		this.wakeTimer = setInterval(() => {
			if (ints[layout.frame] === this.wakeFrame) return;
			this.endWaking();
			this.sketchIdle = false;
			this.idleSuspend = false;
			this.resumeIfWanted();
		}, WAKE_EVERY_MS);
	}

	private endWaking(): void {
		if (this.wakeTimer !== undefined) clearInterval(this.wakeTimer);
		this.wakeTimer = undefined;
	}

	/** Resumes the audio when the user wants it and the sketch's frames move. */
	private resumeIfWanted(): void {
		const context = this.context;
		if (!context || !this.wanted || this.idleSuspend || this.state === 'stopped') return;
		if (context.state !== 'running') void context.resume().catch(() => {});
	}

	/** Follows the browser's state of the audio, which the page, the browser and the system change. */
	private followContext(): void {
		const context = this.context;
		if (!context || this.state === 'stopped') return;
		if (context.state === 'running') {
			this.listen(false);
			this.setState('on');
			// Loops whose files arrived while the browser held the audio start now.
			for (const sound of this.sounds.values())
				if (sound.kind !== 'shot') this.playWhenLoaded(sound);
			// The sketch stopped while the audio was not running: suspend it now.
			if (this.sketchIdle) this.suspendForIdle();
			return;
		}
		if (context.state === 'closed') return;
		if (this.state === 'starting' && !this.idleSuspend) {
			// A context made outside the user's input waits for it: the next input resumes it.
			this.listen(true);
			return;
		}
		if (this.idleSuspend) {
			this.setState('paused');
			return;
		}
		// The browser or the system took the audio, as an iPhone does during a call: the next input,
		// or the page showing again, gives it back.
		this.setState('interrupted');
		this.listen(true);
	}

	start(): Promise<void> {
		if (this.state === 'stopped') return Promise.resolve();
		this.wanted = true;
		if (this.context) {
			this.resumeIfWanted();
			return Promise.resolve();
		}
		// The context starts here, in the user's input, before anything waits.
		const context = new AudioContext();
		this.context = context;
		const session = (navigator as AudioSessionNavigator).audioSession;
		// On an iPhone, the silent switch mutes a page's audio unless its session plays media.
		if (session) session.type = 'playback';
		context.onstatechange = () => this.followContext();
		void context.resume().catch(() => {});
		this.setState('starting');
		const wasm = fetch(MIXER_WASM_URL).then((response) => {
			if (!response.ok) throw new Error(`the mixer's module answered ${response.status}`);
			return response.arrayBuffer();
		});
		return Promise.all([context.audioWorklet.addModule(MIXER_URL), wasm])
			.then(([, bytes]) => {
				if (this.state === 'stopped') return;
				this.makeMixer(context, bytes);
				for (const sound of this.sounds.values()) {
					this.toMixer({ type: 'add', sound });
					this.build(sound);
				}
				this.followContext();
			})
			.catch((error: unknown) => {
				console.warn(`null3D sound: the audio could not start: ${(error as Error).message}`);
				this.stop();
			});
	}

	private makeMixer(context: AudioContext, wasm: ArrayBuffer): void {
		const setup: MixerSetup = { outputs: MIXER_OUTPUTS, voices: MAX_VOICES, wasm };
		const mixer = new AudioWorkletNode(context, MIXER_NAME, {
			numberOfInputs: 0,
			numberOfOutputs: OUTPUT_COUNT,
			outputChannelCount: new Array(OUTPUT_COUNT).fill(MAX_VOICES),
			processorOptions: setup,
		});
		mixer.port.onmessage = (event: MessageEvent<MixerReply>) => this.fromMixer(event.data);
		this.mixer = mixer;
		this.splitters = [];
		for (let output = 0; output < OUTPUT_COUNT; output++) {
			const splitter = new ChannelSplitterNode(context, { numberOfOutputs: MAX_VOICES });
			mixer.connect(splitter, output);
			this.splitters.push(splitter);
		}
		const master = new GainNode(context, { gain: this.muted ? 0 : 1 });
		// A limiter holds the mix under full scale: loud sounds that sum, or a stereo burst that a
		// panner moves to one side, would otherwise clip.
		const limiter = new DynamicsCompressorNode(context, {
			threshold: LIMIT_THRESHOLD,
			knee: 0,
			ratio: 20,
			attack: 0.003,
			release: 0.25,
		});
		master.connect(limiter);
		limiter.connect(context.destination);
		this.master = master;
		this.giveMixerTable();
	}

	private split(output: number): ChannelSplitterNode {
		return this.splitters[output] as ChannelSplitterNode;
	}

	/** Builds the nodes of each of a sound's voices, and starts loading its file. */
	private build(sound: SoundSpec): void {
		const context = this.context;
		const master = this.master;
		if (!context || !master || !this.mixer) return;
		for (const v of sound.voices) {
			this.disconnect(v);
			const filter = new BiquadFilterNode(context, { type: 'lowpass', frequency: 0, Q: FLAT_Q });
			quantumRate(filter.frequency);
			this.split(MIXER_OUTPUTS.cutoff).connect(filter.frequency, v);
			const gain = new GainNode(context, { gain: 0 });
			this.split(MIXER_OUTPUTS.gain).connect(gain.gain, v);
			filter.connect(gain);
			let panner: PannerNode | null = null;
			if (sound.positional) {
				// The mixer gives each place in the listener's frame, so the listener stays at the origin,
				// and it works out the fall with distance itself, so the panner's model is flat.
				panner = new PannerNode(context, {
					panningModel: this.pannerModel(),
					distanceModel: 'linear',
					rolloffFactor: 0,
					positionX: 0,
					positionY: 0,
					positionZ: 0,
				});
				quantumRate(panner.positionX);
				quantumRate(panner.positionY);
				quantumRate(panner.positionZ);
				this.split(MIXER_OUTPUTS.x).connect(panner.positionX, v);
				this.split(MIXER_OUTPUTS.y).connect(panner.positionY, v);
				this.split(MIXER_OUTPUTS.z).connect(panner.positionZ, v);
				gain.connect(panner);
				panner.connect(master);
			} else gain.connect(master);
			this.voices[v] = { sound, filter, gain, panner, play: null, waiting: undefined };
		}
		if (sound.kind !== 'shot') this.playWhenLoaded(sound);
		else void this.load(sound.file);
	}

	/** Loads a loop's or a group's file, and starts its voices' files once it and the audio are ready. */
	private playWhenLoaded(sound: SoundSpec): void {
		void this.load(sound.file).then((loaded) => {
			if (loaded) this.playLoops(sound, loaded);
		});
	}

	/**
	 * Starts the file of each voice of a loop or a group that has none yet. Audio that the browser
	 * still holds starts none, since a file started there makes the browser warn: its voices start
	 * once the audio runs.
	 */
	private playLoops(sound: SoundSpec, loaded: Loaded): void {
		if (this.context?.state !== 'running') return;
		const span = loaded.end - loaded.start;
		for (let k = 0; k < sound.voices.length; k++) {
			const v = sound.voices[k] as number;
			const voice = this.voices[v];
			if (voice?.sound !== sound || voice.play) continue;
			// Each voice starts at its own point of the loop, so two voices of one file never sound
			// in step.
			const offset = loaded.start + span * ((k * 0.618034 + v * 0.1) % 1);
			voice.play = this.source(loaded, v, true, offset, 0, false);
			this.toMixer({ type: 'ready', voice: v });
		}
	}

	/**
	 * Starts one play of a shot's file on the voice of its slot. A play while the browser holds the
	 * audio is dropped: it would start late, once the audio runs, and make the browser warn.
	 */
	private play(id: number, slot: number): void {
		const sound = this.sounds.get(id);
		const v = sound?.voices[slot];
		if (!sound || v === undefined || this.context?.state !== 'running' || !this.mixer) return;
		void this.load(sound.file).then((loaded) => {
			const context = this.context;
			const voice = this.voices[v];
			if (!loaded || !context || voice?.sound !== sound) return;
			const old = voice.play;
			// A newer play replaces the slot's last one with a quick fade, so the old play never clicks.
			// The voice is shared, so the newer play takes it only once the old one is silent. A play
			// that arrives while another waits replaces the waiting one: the newest play wins.
			if (old?.fade) {
				old.fade.gain.setTargetAtTime(0, context.currentTime, SHOT_FADE);
				old.source.stop(context.currentTime + SHOT_FADE * 6);
				voice.play = null;
			}
			if (old?.fade || voice.waiting !== undefined) {
				if (voice.waiting !== undefined) clearTimeout(voice.waiting);
				voice.waiting = setTimeout(() => {
					voice.waiting = undefined;
					this.startShot(sound, v, loaded);
				}, SHOT_SWAP_MS);
			} else this.startShot(sound, v, loaded);
		});
	}

	/** Tells the mixer that a shot starts on voice `v`, then starts its file a moment later. */
	private startShot(sound: SoundSpec, v: number, loaded: Loaded): void {
		const context = this.context;
		const voice = this.voices[v];
		if (!context || voice?.sound !== sound) return;
		// The mixer must read the play's values before it takes them: a copied table goes first.
		if (!this.shared) this.copyNow(true);
		this.toMixer({ type: 'shot', voice: v });
		voice.play = this.source(
			loaded,
			v,
			false,
			loaded.start,
			context.currentTime + SHOT_DELAY,
			true,
		);
	}

	/**
	 * A source of a loaded file, wired to voice `v`'s filter, through a fade of its own for a shot,
	 * and to the mixer's rate. The source disconnects itself when it ends.
	 */
	private source(
		loaded: Loaded,
		v: number,
		loop: boolean,
		offset: number,
		when: number,
		fades: boolean,
	): Play | null {
		const context = this.context;
		const voice = this.voices[v];
		if (!context || !voice) return null;
		const source = new AudioBufferSourceNode(context, {
			buffer: loaded.buffer,
			loop,
			loopStart: loaded.start,
			loopEnd: loaded.end,
			playbackRate: 0,
		});
		const rate = this.split(MIXER_OUTPUTS.rate);
		rate.connect(source.playbackRate, v);
		const fade = fades ? new GainNode(context, { gain: 1 }) : null;
		if (fade) {
			source.connect(fade);
			fade.connect(voice.filter);
		} else source.connect(voice.filter);
		const play: Play = { source, fade };
		source.onended = () => {
			if (voice.play === play) voice.play = null;
			this.unplug(play, v);
		};
		if (loop) source.start(when, offset);
		else source.start(when, offset, loaded.end - offset);
		return play;
	}

	/** Disconnects a play's nodes and its rate input from the mixer. */
	private unplug(play: Play, v: number): void {
		play.source.disconnect();
		play.fade?.disconnect();
		try {
			this.split(MIXER_OUTPUTS.rate).disconnect(play.source.playbackRate, v);
		} catch {
			// The connection is gone already.
		}
	}

	/** Loads and decodes a file once, however many sounds play it. */
	private load(file: string): Promise<Loaded | null> {
		const context = this.context;
		if (!context) return Promise.resolve(null);
		let loading = this.files.get(file);
		if (!loading) {
			loading = fetch(file)
				.then((response) => {
					if (!response.ok) throw new Error(`the server answered ${response.status}`);
					return response.arrayBuffer();
				})
				.then(async (bytes) => {
					// The header goes first: decoding takes the bytes away.
					const header = mp3Gapless(bytes);
					const buffer = await context.decodeAudioData(bytes);
					const gapless = header && gaplessBounds(header, buffer.length, buffer.sampleRate);
					if (gapless) return { buffer, ...gapless };
					const channels: Float32Array[] = [];
					for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
					return { buffer, ...soundBounds(channels, buffer.sampleRate) };
				})
				.catch((error: unknown) => {
					console.warn(`null3D sound: ${file} did not load: ${(error as Error).message}`);
					return null;
				});
			this.files.set(file, loading);
		}
		return loading;
	}

	/** Takes a removed sound's nodes away once its fade has ended. */
	private release(sound: SoundSpec): void {
		setTimeout(() => {
			for (const v of sound.voices) if (this.voices[v]?.sound === sound) this.disconnect(v);
		}, RELEASE_MS);
	}

	/** Stops and disconnects voice `v`'s nodes. */
	private disconnect(v: number): void {
		const voice = this.voices[v];
		if (!voice) return;
		this.voices[v] = undefined;
		if (voice.waiting !== undefined) clearTimeout(voice.waiting);
		const play = voice.play;
		voice.play = null;
		if (play) {
			play.source.onended = null;
			try {
				play.source.stop();
			} catch {
				// A source that never started has nothing to stop.
			}
			this.unplug(play, v);
		}
		voice.filter.disconnect();
		voice.gain.disconnect();
		voice.panner?.disconnect();
		const params: [number, AudioParam][] = [
			[MIXER_OUTPUTS.cutoff, voice.filter.frequency],
			[MIXER_OUTPUTS.gain, voice.gain.gain],
		];
		if (voice.panner)
			params.push(
				[MIXER_OUTPUTS.x, voice.panner.positionX],
				[MIXER_OUTPUTS.y, voice.panner.positionY],
				[MIXER_OUTPUTS.z, voice.panner.positionZ],
			);
		for (const [output, param] of params) {
			try {
				this.splitters[output]?.disconnect(param, v);
			} catch {
				// The connection is gone already.
			}
		}
	}

	setMuted(muted: boolean): void {
		this.muted = muted;
		const master = this.master;
		const context = this.context;
		if (master && context) master.gain.setTargetAtTime(muted ? 0 : 1, context.currentTime, 0.05);
	}

	onState(handler: (state: SoundState) => void): () => void {
		this.handlers.add(handler);
		return () => this.handlers.delete(handler);
	}

	stop(): void {
		if (this.state === 'stopped') return;
		this.setState('stopped');
		this.endAsking();
		this.endWaking();
		this.listen(false);
		document.removeEventListener('visibilitychange', this.onVisibility);
		this.stopEngine();
		this.stopCopies();
		for (let v = 0; v < MAX_VOICES; v++) this.disconnect(v);
		this.mixer?.disconnect();
		this.mixer = null;
		if (this.context) this.context.onstatechange = null;
		void this.context?.close();
		this.context = null;
		this.link?.close();
		this.link = null;
	}
}

/**
 * Connects the page to the sketch's sounds, which `createSound` makes in the sketch. Call it once,
 * after `createEngine` resolves. Nothing plays until `start` runs in answer to a click, a tap or a
 * key, or the user's first input with `startOnInput`.
 *
 * @category api/sound
 */
export function connectSound(engine: Engine, options: PageSoundOptions = {}): PageSound {
	return new SoundPage(engine, options);
}
