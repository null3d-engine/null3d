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
		thunder.play(0, 0, -100);
		await settle();
		thunder.play(0, 0, -200);
		await settle();
		const plays = FakeSource.all.filter((source) => !source.options.loop);
		expect(plays).toHaveLength(2);
		expect(
			FakeWorklet.messages.filter((m) => (m as { type: string }).type === 'shot'),
		).toHaveLength(2);
		// The newer play starts a little after its message, and the older one stops and unplugs.
		expect(plays[1]?.started[0]).toBeGreaterThan(0);
		expect(plays[0]?.stopped).toBe(true);
		plays[0]?.onended?.();
		expect(plays[0]?.connections.size).toBe(0);
		page.stop();
		sound.destroy();
	});
});
