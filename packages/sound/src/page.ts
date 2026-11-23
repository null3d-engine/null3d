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
import { soundBounds } from './bounds';
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
/** The name that the mixer registers. The mixer's module holds the same name. */
const MIXER_NAME = 'null3d-sound-mixer';
/** How often the page asks the sketch for its link until the sketch answers, in milliseconds. */
const CONNECT_EVERY_MS = 500;
/** How long the page keeps asking, in milliseconds, before it says the sketch makes no sound. */
const CONNECT_FOR_MS = 60_000;
/** How often a suspended page looks for the sketch's frames, in milliseconds. */
const WAKE_EVERY_MS = 250;
/** How long a removed voice keeps its nodes, so its fade ends before they go, in milliseconds. */
const RELEASE_MS = 200;
/** The Q of a low-pass filter with no peak at its cutoff, in decibels. */
const FLAT_Q = -3.0103;

/**
 * Where the page's sound stands: not started, starting, playing, suspended while the sketch is
 * paused, or stopped for good.
 *
 * @category api/sound
 */
export type SoundState = 'off' | 'starting' | 'on' | 'paused' | 'stopped';

/**
 * Options for `connectSound`.
 *
 * @category api/sound
 */
export interface PageSoundOptions {
	/**
	 * Starts the sound on the user's first press, click, tap or key on the page. Browsers let a page
	 * start its audio only in answer to such an input. The default is false: the page calls `start`
	 * from its own control, such as a sound button.
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

/** The audio nodes of one voice. */
interface VoiceNodes {
	readonly sound: SoundSpec;
	readonly filter: BiquadFilterNode;
	readonly gain: GainNode;
	readonly panner: PannerNode | null;
	source: AudioBufferSourceNode | null;
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
	private connectTimer: ReturnType<typeof setInterval> | undefined;
	private connectStarted = 0;
	private layout: TableLayout | null = null;
	/** The table that the mixer reads: shared, or the sketch's own on the page's thread. */
	private table: ArrayBuffer | SharedArrayBuffer | null = null;
	private tableFloats: Float32Array | null = null;
	private tableInts: Int32Array | null = null;
	private panning: Panning = 'equal-power';
	private readonly sounds = new Map<number, SoundSpec>();

	private context: AudioContext | null = null;
	private mixer: AudioWorkletNode | null = null;
	private splitters: ChannelSplitterNode[] = [];
	private master: GainNode | null = null;
	private readonly voices: (VoiceNodes | undefined)[] = new Array(MAX_VOICES);
	private readonly files = new Map<string, Promise<Loaded | null>>();
	/** The copies of the table that go to the mixer where the page shares no memory. */
	private spares: { buffer: ArrayBuffer; floats: Float32Array }[] = [];
	private copyFrame = 0;
	private wakeTimer: ReturnType<typeof setInterval> | undefined;
	private wakeFrame = 0;
	private readonly stopEngine: () => void;
	private stopInput: (() => void) | undefined;

	constructor(
		private readonly engine: Engine,
		options: PageSoundOptions,
	) {
		this.muted = options.muted ?? false;
		this.stopEngine = engine.onStop(() => this.stop());
		this.connectStarted = Date.now();
		this.askForLink();
		this.connectTimer = setInterval(() => this.askForLink(), CONNECT_EVERY_MS);
		if (options.startOnInput) this.listenForInput();
	}

	/** Asks the sketch for a link, until the sketch answers or the page gives up. */
	private askForLink(): void {
		if (this.state === 'stopped' || this.layout) {
			this.endAsking();
			return;
		}
		if (Date.now() - this.connectStarted > CONNECT_FOR_MS) {
			console.warn(
				'null3D sound: the sketch never answered connectSound. Call createSound in the sketch, and check that the sketch and the page use the same @null3d/sound.',
			);
			this.endAsking();
			return;
		}
		this.link?.close();
		const channel = new MessageChannel();
		this.link = channel.port1;
		this.box = { table: null };
		channel.port1.onmessage = (event: MessageEvent<SketchMessage>) => this.fromSketch(event.data);
		const data: ConnectData = { port: channel.port2, box: this.box };
		this.engine.postToSketch(CONNECT_MESSAGE, data, [channel.port2]);
	}

	private endAsking(): void {
		if (this.connectTimer !== undefined) clearInterval(this.connectTimer);
		this.connectTimer = undefined;
	}

	private listenForInput(): void {
		const events = ['pointerdown', 'keydown', 'touchend'] as const;
		const begin = () => {
			this.stopInput?.();
			void this.start();
		};
		for (const name of events) window.addEventListener(name, begin, { capture: true });
		this.stopInput = () => {
			for (const name of events) window.removeEventListener(name, begin, { capture: true });
			this.stopInput = undefined;
		};
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
		}
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
		const shared = isShared(table);
		this.toMixer({ type: 'table', layout, buffer: shared ? table : null });
		if (!shared) this.startCopies(layout);
	}

	/** Sends the mixer a copy of the table in each display frame, where the page shares no memory. */
	private startCopies(layout: TableLayout): void {
		if (this.copyFrame !== 0) return;
		this.spares = [0, 1].map(() => {
			const buffer = new ArrayBuffer(layout.length * Float32Array.BYTES_PER_ELEMENT);
			return { buffer, floats: new Float32Array(buffer) };
		});
		const copy = () => {
			this.copyFrame = requestAnimationFrame(copy);
			if (this.state !== 'on') return;
			const spare = this.spares.pop();
			const floats = this.tableFloats;
			if (!spare || !floats) return;
			spare.floats.set(floats);
			this.toMixer({ type: 'copy', buffer: spare.buffer }, [spare.buffer]);
		};
		this.copyFrame = requestAnimationFrame(copy);
	}

	private fromMixer(reply: MixerReply): void {
		switch (reply.type) {
			case 'copy':
				this.spares.push({ buffer: reply.buffer, floats: new Float32Array(reply.buffer) });
				return;
			case 'idle':
				this.suspend();
				return;
			case 'active':
				return;
		}
	}

	/** Suspends the audio while the sketch is paused, and wakes it when the frames move again. */
	private suspend(): void {
		const context = this.context;
		const ints = this.tableInts;
		const layout = this.layout;
		if (!context || !ints || !layout || this.state !== 'on') return;
		this.setState('paused');
		void context.suspend();
		this.wakeFrame = ints[layout.frame] as number;
		this.wakeTimer = setInterval(() => {
			if (ints[layout.frame] === this.wakeFrame) return;
			this.endWaking();
			if (this.state !== 'paused') return;
			void context.resume().then(() => {
				if (this.state === 'paused') this.setState('on');
			});
		}, WAKE_EVERY_MS);
	}

	private endWaking(): void {
		if (this.wakeTimer !== undefined) clearInterval(this.wakeTimer);
		this.wakeTimer = undefined;
	}

	start(): Promise<void> {
		if (this.state === 'stopped') return Promise.resolve();
		this.stopInput?.();
		if (this.context) {
			const context = this.context;
			return context.resume().then(() => {
				if (this.state === 'paused' || this.state === 'off') this.setState('on');
			});
		}
		// The context starts here, in the user's input, before anything waits.
		const context = new AudioContext();
		this.context = context;
		const session = (navigator as AudioSessionNavigator).audioSession;
		// On an iPhone, the silent switch mutes a page's audio unless its session plays media.
		if (session) session.type = 'playback';
		const resumed = context.resume();
		this.setState('starting');
		return context.audioWorklet
			.addModule(MIXER_URL)
			.then(async () => {
				if (this.state === 'stopped') return;
				this.makeMixer(context);
				for (const sound of this.sounds.values()) {
					this.toMixer({ type: 'add', sound });
					this.build(sound);
				}
				await resumed;
				if (this.state === 'starting') this.setState('on');
			})
			.catch((error: unknown) => {
				console.warn(`null3D sound: the audio could not start: ${(error as Error).message}`);
				this.stop();
			});
	}

	private makeMixer(context: AudioContext): void {
		const setup: MixerSetup = { outputs: MIXER_OUTPUTS, voices: MAX_VOICES };
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
		master.connect(context.destination);
		this.master = master;
		this.giveMixerTable();
	}

	/** Builds the nodes of each of a sound's voices, and starts loading its file. */
	private build(sound: SoundSpec): void {
		const context = this.context;
		const master = this.master;
		if (!context || !master || !this.mixer) return;
		const split = (output: number) => this.splitters[output] as ChannelSplitterNode;
		for (let v = sound.voice; v < sound.voice + sound.voices; v++) {
			this.disconnect(v);
			const filter = new BiquadFilterNode(context, { type: 'lowpass', frequency: 0, Q: FLAT_Q });
			quantumRate(filter.frequency);
			split(MIXER_OUTPUTS.cutoff).connect(filter.frequency, v);
			const gain = new GainNode(context, { gain: 0 });
			split(MIXER_OUTPUTS.gain).connect(gain.gain, v);
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
				split(MIXER_OUTPUTS.x).connect(panner.positionX, v);
				split(MIXER_OUTPUTS.y).connect(panner.positionY, v);
				split(MIXER_OUTPUTS.z).connect(panner.positionZ, v);
				gain.connect(panner);
				panner.connect(master);
			} else gain.connect(master);
			this.voices[v] = { sound, filter, gain, panner, source: null };
		}
		void this.load(sound.file).then((loaded) => {
			if (!loaded || sound.kind === 'shot') return;
			for (let v = sound.voice; v < sound.voice + sound.voices; v++) {
				const voice = this.voices[v];
				if (voice?.sound !== sound || voice.source) continue;
				// Each voice starts at its own point of the loop, so two voices of one file never sound
				// in step.
				const span = loaded.end - loaded.start;
				const offset = loaded.start + span * ((v * 0.618034) % 1);
				voice.source = this.source(loaded, v, true, offset);
				this.toMixer({ type: 'ready', voice: v });
			}
		});
	}

	/** Starts one play of a shot's file on the voice of its slot. */
	private play(id: number, slot: number): void {
		const sound = this.sounds.get(id);
		if (!sound || !this.context) return;
		const v = sound.voice + slot;
		void this.load(sound.file).then((loaded) => {
			const voice = this.voices[v];
			if (!loaded || voice?.sound !== sound) return;
			voice.source?.stop();
			voice.source = this.source(loaded, v, false, loaded.start);
		});
	}

	/** A source of a loaded file, wired to voice `v`'s filter and to the mixer's rate. */
	private source(
		loaded: Loaded,
		v: number,
		loop: boolean,
		offset: number,
	): AudioBufferSourceNode | null {
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
		(this.splitters[MIXER_OUTPUTS.rate] as ChannelSplitterNode).connect(source.playbackRate, v);
		source.connect(voice.filter);
		source.start(0, offset);
		return source;
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
				.then((bytes) => context.decodeAudioData(bytes))
				.then((buffer) => {
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
			for (let v = sound.voice; v < sound.voice + sound.voices; v++)
				if (this.voices[v]?.sound === sound) this.disconnect(v);
		}, RELEASE_MS);
	}

	/** Stops and disconnects voice `v`'s nodes. */
	private disconnect(v: number): void {
		const voice = this.voices[v];
		if (!voice) return;
		this.voices[v] = undefined;
		try {
			voice.source?.stop();
		} catch {
			// A source that never started has nothing to stop.
		}
		voice.source?.disconnect();
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
		if (voice.source) params.push([MIXER_OUTPUTS.rate, voice.source.playbackRate]);
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
		this.stopInput?.();
		this.stopEngine();
		if (this.copyFrame !== 0) cancelAnimationFrame(this.copyFrame);
		this.copyFrame = 0;
		for (let v = 0; v < MAX_VOICES; v++) this.disconnect(v);
		this.mixer?.disconnect();
		this.mixer = null;
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
