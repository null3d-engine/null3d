import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Engine, SketchContext } from '@null3d/engine';
import { createSound } from './sound';

/**
 * Stand-ins for the browser's audio and page objects, with only what the page's half calls. Each
 * node records its connections, so a test can see what is wired to what.
 */
class FakeParam {
	value = 0;
	automationRate = 'a-rate';
	setTargetAtTime(value: number) {
		this.value = value;
	}
}
class FakeNode {
	readonly connections = new Set<unknown>();
	readonly params: Record<string, FakeParam> = {};
	constructor(readonly context: FakeContext) {}
	connect(target: unknown, output = 0) {
		this.connections.add(`${output}:${String(this.idOf(target))}`);
		return target;
	}
	disconnect(target?: unknown, output = 0) {
		if (target === undefined) this.connections.clear();
		else this.connections.delete(`${output}:${String(this.idOf(target))}`);
	}
	private idOf(target: unknown): unknown {
		return (target as { id?: unknown }).id ?? target;
	}
}
let nextId = 1;
function param(): FakeParam & { id: number } {
	return Object.assign(new FakeParam(), { id: nextId++ });
}
class FakeContext {
	state: 'suspended' | 'running' | 'closed' = 'suspended';
	currentTime = 0;
	readonly destination = { id: 'destination' };
	onstatechange: (() => void) | null = null;
	readonly audioWorklet = { addModule: async () => {} };
	static all: FakeContext[] = [];
	/** Whether a resume succeeds now, as it does only in answer to the user's input. */
	static activated = false;
	constructor() {
		FakeContext.all.push(this);
	}
	async resume() {
		if (!FakeContext.activated) return;
		this.state = 'running';
		this.onstatechange?.();
	}
	async suspend() {
		this.state = 'suspended';
		this.onstatechange?.();
	}
	async close() {
		this.state = 'closed';
	}
	async decodeAudioData() {
		return {
			length: 48_000,
			sampleRate: 48_000,
			numberOfChannels: 1,
			getChannelData: () => new Float32Array(48_000).fill(0.5),
		};
	}
}
class FakeSource extends FakeNode {
	readonly playbackRate = param();
	onended: (() => void) | null = null;
	started: number[] = [];
	stopped = false;
	static all: FakeSource[] = [];
	constructor(
		context: FakeContext,
		readonly options: { loop: boolean },
	) {
		super(context);
		FakeSource.all.push(this);
	}
	start(when: number) {
		this.started.push(when);
	}
	stop() {
		this.stopped = true;
	}
}
class FakeGain extends FakeNode {
	readonly gain = param();
}
class FakeFilter extends FakeNode {
	readonly frequency = param();
}
class FakePanner extends FakeNode {
	readonly positionX = param();
	readonly positionY = param();
	readonly positionZ = param();
	panningModel = 'equalpower';
}
class FakeWorklet extends FakeNode {
	readonly port = {
		postMessage: (message: unknown) => FakeWorklet.messages.push(message),
		onmessage: null,
	};
	static messages: unknown[] = [];
}

/** The page's globals that the half reads, kept so a test puts them back. */
const saved: Record<string, unknown> = {};
const GLOBALS = {
	AudioContext: FakeContext,
	AudioWorkletNode: FakeWorklet,
	ChannelSplitterNode: FakeNode,
	GainNode: FakeGain,
	BiquadFilterNode: FakeFilter,
	PannerNode: FakePanner,
	DynamicsCompressorNode: FakeNode,
	AudioBufferSourceNode: FakeSource,
	requestAnimationFrame: () => 1,
	cancelAnimationFrame: () => {},
};
/** The listeners that the half adds to the window, by event name. */
let windowListeners: Map<string, Set<(event: Event) => void>>;

beforeEach(() => {
	windowListeners = new Map();
	FakeContext.all = [];
	FakeContext.activated = false;
	FakeSource.all = [];
	FakeWorklet.messages = [];
	const g = globalThis as Record<string, unknown>;
	for (const [name, value] of Object.entries(GLOBALS)) {
		saved[name] = g[name];
		g[name] = value;
	}
	for (const name of ['window', 'document', 'fetch']) saved[name] = g[name];
	g.window = {
		addEventListener: (name: string, handler: (event: Event) => void) => {
			if (!windowListeners.has(name)) windowListeners.set(name, new Set());
			windowListeners.get(name)?.add(handler);
		},
		removeEventListener: (name: string, handler: (event: Event) => void) =>
			windowListeners.get(name)?.delete(handler),
	};
	g.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
	g.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
});

afterEach(() => {
	const g = globalThis as Record<string, unknown>;
	for (const [name, value] of Object.entries(saved)) g[name] = value;
});

/** Sends an input event to the window's listeners, as the user's press would. */
function input(type: string, key?: string): void {
	for (const handler of windowListeners.get(type) ?? []) handler({ type, key } as unknown as Event);
}

/**
 * An engine whose sketch runs on the page's thread: `postToSketch` hands the sketch the very object
 * that the page sent, as the engine does there. `sketchHandlers` holds the sketch's handlers.
 */
function engineAndSketch() {
	const sketchHandlers = new Set<(type: string, data: unknown) => void>();
	const stops: (() => void)[] = [];
	const engine = {
		postToSketch: (name: string, data: unknown) => {
			for (const handler of sketchHandlers) handler(name, data);
		},
		onStop: (handler: () => void) => {
			stops.push(handler);
			return () => {};
		},
	} as unknown as Engine;
	const ctx = {
		time: { now: 10 },
		page: {
			post() {},
			onMessage: (handler: (type: string, data: unknown) => void) => {
				sketchHandlers.add(handler);
				return () => sketchHandlers.delete(handler);
			},
		},
		quality: { preset: 'high', onChange: () => () => {} },
	} as unknown as SketchContext;
	const listener = { getWorldPosition() {}, getWorldQuaternion() {} };
	return {
		engine,
		ctx,
		listener,
		stop: () => {
			for (const s of stops) s();
		},
	};
}

/** Waits for the page's and the ports' queued work. */
const settle = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

describe('connectSound', () => {
	test("links to the sketch's sounds and reads the live table from the box", async () => {
		const { connectSound } = await import('./page');
		const { engine, ctx, listener } = engineAndSketch();
		const sound = createSound(ctx, { listener });
		sound.loop({ file: '/sea.mp3', positional: false, level: 0.5 });
		const page = connectSound(engine);
		await settle();
		expect(sound.connected).toBe(true);
		expect(page.state).toBe('off');
		page.stop();
		sound.destroy();
	});

	test('keeps asking until a sketch that makes its sound late answers', async () => {
		const { connectSound } = await import('./page');
		const { engine, ctx, listener } = engineAndSketch();
		const page = connectSound(engine);
		await settle(100);
		const sound = createSound(ctx, { listener });
		await settle(700);
		expect(sound.connected).toBe(true);
		page.stop();
		sound.destroy();
	});

	test('asks again once the sketch destroys its system, and links to the next one', async () => {
		const { connectSound } = await import('./page');
		const { engine, ctx, listener } = engineAndSketch();
		const first = createSound(ctx, { listener });
		const page = connectSound(engine);
		await settle();
		first.destroy();
		await settle();
		const second = createSound(ctx, { listener });
		await settle(700);
		expect(second.connected).toBe(true);
		page.stop();
		second.destroy();
	});
});

describe('startOnInput', () => {
	test('waits for an input that lets the audio start, and ignores a press and Escape', async () => {
		const { connectSound } = await import('./page');
		const { engine, ctx, listener } = engineAndSketch();
		const sound = createSound(ctx, { listener });
		const page = connectSound(engine, { startOnInput: true });
		input('pointerdown');
		input('keydown', 'Escape');
		expect(FakeContext.all).toHaveLength(0);
		// The first tap's own lift is the input that the browser counts.
		FakeContext.activated = true;
		input('pointerup');
		await settle();
		expect(page.state).toBe('on');
		page.stop();
		sound.destroy();
	});

	test('keeps listening when the first start finds no input, and resumes on the next', async () => {
		const { connectSound } = await import('./page');
		const { engine, ctx, listener } = engineAndSketch();
		const sound = createSound(ctx, { listener });
		const page = connectSound(engine);
		void page.start();
		await settle();
		expect(page.state).toBe('starting');
		FakeContext.activated = true;
		input('click');
		await settle();
		expect(page.state).toBe('on');
		page.stop();
		sound.destroy();
	});
});

describe('a start before the user acts', () => {
	test('loads the files but starts none until the audio runs, then starts the loops', async () => {
		const { connectSound } = await import('./page');
		const { engine, ctx, listener } = engineAndSketch();
		const sound = createSound(ctx, { listener });
		sound.loop({ file: '/rain.mp3', positional: false });
		const page = connectSound(engine);
		void page.start();
		await settle();
		// A file started on audio that the browser holds makes the browser warn, once a voice.
		expect(page.state).toBe('starting');
		expect(FakeSource.all).toHaveLength(0);
		FakeContext.activated = true;
		input('click');
		await settle();
		expect(page.state).toBe('on');
		expect(FakeSource.all.filter((source) => source.options.loop)).toHaveLength(1);
		page.stop();
		sound.destroy();
	});

	test('drops a shot played while the browser holds the audio, and plays the next', async () => {
		const { connectSound } = await import('./page');
		const { engine, ctx, listener } = engineAndSketch();
		const sound = createSound(ctx, { listener });
		const thunder = sound.shot({ file: '/thunder.mp3', voices: 1 });
		const page = connectSound(engine);
		void page.start();
		await settle();
		// A play held until the audio runs would sound late, long after its flash.
		thunder.play(0, 0, -100);
		await settle();
		expect(FakeSource.all).toHaveLength(0);
		FakeContext.activated = true;
		input('click');
		await settle();
		thunder.play(0, 0, -100);
		await settle();
		expect(FakeSource.all).toHaveLength(1);
		page.stop();
		sound.destroy();
	});
});

describe('the audio that the browser takes', () => {
	test('is interrupted, and resumes at the next input', async () => {
		const { connectSound } = await import('./page');
		const { engine, ctx, listener } = engineAndSketch();
		const sound = createSound(ctx, { listener });
		const page = connectSound(engine);
		FakeContext.activated = true;
		await page.start();
		await settle();
		expect(page.state).toBe('on');
		// The system takes the audio, as a call does on an iPhone.
		FakeContext.activated = false;
		const context = FakeContext.all[0] as FakeContext;
		context.state = 'suspended';
		context.onstatechange?.();
		expect(page.state).toBe('interrupted');
		FakeContext.activated = true;
		input('keydown', 'a');
		await settle();
		expect(page.state).toBe('on');
		page.stop();
		sound.destroy();
	});
});

describe('a sound system that ends', () => {
	test("keeps its voices' nodes until their fade has ended", async () => {
		const { connectSound } = await import('./page');
		const { engine, ctx, listener } = engineAndSketch();
		const sound = createSound(ctx, { listener });
		sound.loop({ file: '/sea.mp3', positional: false });
		const page = connectSound(engine);
		FakeContext.activated = true;
		await page.start();
		await settle();
		const loop = FakeSource.all.find((source) => source.options.loop) as FakeSource;
		expect(loop.stopped).toBe(false);
		sound.destroy();
		await settle();
		expect(loop.stopped).toBe(false);
		await settle(300);
		expect(loop.stopped).toBe(true);
		page.stop();
	});
});

describe('a shot', () => {
	test('tells the mixer before its file starts, and unplugs each play that ends', async () => {
		const { connectSound } = await import('./page');
		const { engine, ctx, listener } = engineAndSketch();
		const sound = createSound(ctx, { listener });
		const thunder = sound.shot({ file: '/thunder.mp3', voices: 1 });
		const page = connectSound(engine);
		FakeContext.activated = true;
		await page.start();
		await settle();
		const types = () => FakeWorklet.messages.map((m) => (m as { type: string }).type);
		const plays = () => FakeSource.all.filter((source) => !source.options.loop);
		thunder.play(0, 0, -100);
		await settle();
		// The sketch runs on this thread and shares no memory, so a copy of the table goes first.
		expect(types().slice(-2)).toEqual(['copy', 'shot']);
		thunder.play(0, 0, -200);
		await settle();
		// The older play fades out first; the newer one waits for its fade before it takes the voice.
		expect(plays()).toHaveLength(1);
		expect(plays()[0]?.stopped).toBe(true);
		await settle(100);
		expect(plays()).toHaveLength(2);
		expect(types().filter((type) => type === 'shot')).toHaveLength(2);
		// The newer play starts a little after its message, and the older one unplugs as it ends.
		expect(plays()[1]?.started[0]).toBeGreaterThan(0);
		plays()[0]?.onended?.();
		expect(plays()[0]?.connections.size).toBe(0);
		page.stop();
		sound.destroy();
	});
});

describe('shots in quick succession', () => {
	test('send a fresh copy of the table before each play, even with no spare copy back', async () => {
		const { connectSound } = await import('./page');
		const { engine, ctx, listener } = engineAndSketch();
		const sound = createSound(ctx, { listener });
		const steps = sound.shot({ file: '/step.mp3', voices: 3 });
		const page = connectSound(engine);
		FakeContext.activated = true;
		await page.start();
		await settle();
		// The stand-in mixer never hands a copy back, so the third play finds no spare.
		steps.play(0, 0, -1);
		steps.play(0, 0, -2);
		steps.play(0, 0, -3);
		await settle();
		const types = FakeWorklet.messages
			.map((m) => (m as { type: string }).type)
			.filter((type) => type === 'copy' || type === 'shot');
		expect(types).toEqual(['copy', 'shot', 'copy', 'shot', 'copy', 'shot']);
		page.stop();
		sound.destroy();
	});

	test('on one voice, play only the newest of the plays that wait for a fade', async () => {
		const { connectSound } = await import('./page');
		const { engine, ctx, listener } = engineAndSketch();
		const sound = createSound(ctx, { listener });
		const knock = sound.shot({ file: '/knock.mp3', voices: 1 });
		const page = connectSound(engine);
		FakeContext.activated = true;
		await page.start();
		await settle();
		knock.play(0, 0, -1);
		await settle();
		knock.play(0, 0, -2);
		await settle(5);
		knock.play(0, 0, -3);
		await settle(150);
		const plays = FakeSource.all.filter((source) => !source.options.loop);
		// The first play, then one more: the third replaced the second while it waited.
		expect(plays).toHaveLength(2);
		expect(
			FakeWorklet.messages.filter((m) => (m as { type: string }).type === 'shot'),
		).toHaveLength(2);
		page.stop();
		sound.destroy();
	});
});
