// A probe of how a browser gets back the shared memory of a frame that a live page removes. For each
// way of holding the memory that ?holds= names, the page counts its room for memories of ?unit= MiB,
// opens ?frames= frames that each hold one such memory that way, removes each frame, and counts the
// room again until it comes back or the pauses end. It also learns whether each frame's workers
// still run after the removal, from a beat counter that they add to, and whether the browser
// collected the frame's objects, through weak references.
//
// The holds: page (the frame's page holds the memory), page-webgl (the page draws with WebGL2, and
// the context-loss listener reaches the memory), worker (an idle worker holds it), worker-waitasync
// (a worker waits in Atomics.waitAsync on it), worker-webgl (a worker draws with WebGL2 on the
// frame's canvas, and its context-loss listener reaches it), each with a -released form that lets
// go as the frame's page leaves. The engine holds start the engine in a frame with a maximum of
// ?unit= MiB, in the thread mode that the page's other switches ask for: engine (it runs at the
// removal), engine-terminate (the frame ends every worker as its page leaves), engine-lose (it also
// gives up a WebGL2 context on the page), engine-destroyed (stopped before the removal) and
// engine-destroyed-late (stopped two seconds before it).
import type { EngineFrameMessage } from './engine-frame';
import type { ProbeFrameMessage } from './frame-memory-frame';
import { progress, run } from './lib/result';

const params = new URLSearchParams(location.search);
const HOLDS = (params.get('holds') ?? 'page,worker,worker-released').split(',');
const UNIT_MIB = Number(params.get('unit') ?? 256);
const FRAMES = Number(params.get('frames') ?? 2);
const MOST_HELD = 256;
const FRAME_TIMEOUT_MS = 25_000;
/** How long a frame stays after it is ready, so its workers settle into their holds. */
const SETTLE_MS = 300;
/** How long the page watches the beats of a removed frame's workers. */
const BEAT_WATCH_MS = 1_500;
const ROOM_PAUSES_MS = [1_000, 2_000, 4_000, 8_000];
const ENGINE_HOLDS: Record<string, string[]> = {
	engine: [],
	'engine-terminate': ['pagehide=terminate'],
	'engine-lose': ['pagehide=lose'],
	'engine-destroyed': ['stop=destroy'],
	'engine-destroyed-late': ['stop=destroy', 'stopdelay=2000'],
};

const beats = new Int32Array(new SharedArrayBuffer(4 * MOST_HELD));
window.__probeBeats = beats.buffer as SharedArrayBuffer;
let nextBeat = 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const allocate = () =>
	new WebAssembly.Memory({ initial: 18, maximum: UNIT_MIB * 16, shared: true });

/**
 * How many memories of the unit the page can hold at once. One more after the count, which the
 * browser refuses, makes it collect.
 */
async function countRoom(): Promise<number> {
	let room = 0;
	{
		const memories: WebAssembly.Memory[] = [];
		try {
			while (memories.length < MOST_HELD) memories.push(allocate());
		} catch {
			// The refusal ends the count.
		}
		room = memories.length;
	}
	await sleep(0);
	try {
		allocate();
	} catch {
		// The refusal is the point: it makes the browser collect.
	}
	return room;
}

interface FrameRecord {
	error?: string;
	/** How much a worker of the frame added to its beat after the removal: it ran on. */
	beatsAfter?: number;
	/** Whether the browser collected the frame's objects by the end of the counts. */
	sentinelKept?: boolean;
	memoryKept?: boolean;
	workerKept?: boolean;
}

/** Weak references to what a frame held, which never keep it. */
interface HeldRefs {
	sentinel?: WeakRef<object>;
	memory?: WeakRef<WebAssembly.Memory>;
	worker?: WeakRef<Worker>;
}

interface HoldResult {
	roomBefore: number;
	roomCounts: number[];
	waitedMs: number;
	frames: FrameRecord[];
}

function frameUrl(hold: string, beat: number): string {
	const switches = new URLSearchParams(location.search);
	for (const name of ['holds', 'unit', 'frames']) switches.delete(name);
	const engine = ENGINE_HOLDS[hold];
	if (engine) {
		switches.set('memory', String(UNIT_MIB));
		for (const pair of engine) {
			const [name, value] = pair.split('=') as [string, string];
			switches.set(name, value);
		}
		return `./engine-frame.html?${switches}`;
	}
	switches.set('hold', hold);
	switches.set('unit', String(UNIT_MIB));
	switches.set('beat', String(beat));
	return `./frame-memory-frame.html?${switches}`;
}

/** Opens a frame that holds a memory the way `hold` says, removes it, and notes what stays. */
async function holdInFrame(
	hold: string,
): Promise<{ record: FrameRecord; refs: HeldRefs; beat: number; at: number }> {
	const beat = nextBeat++;
	const frame = document.createElement('iframe');
	frame.src = frameUrl(hold, beat);
	const record: FrameRecord = {};
	const refs: HeldRefs = {};
	try {
		const message = await new Promise<ProbeFrameMessage | EngineFrameMessage>((resolve, reject) => {
			const timer = setTimeout(() => {
				removeEventListener('message', listen);
				reject(new Error(`the frame sent nothing within ${FRAME_TIMEOUT_MS / 1000} s`));
			}, FRAME_TIMEOUT_MS);
			const listen = ({ source, data }: MessageEvent) => {
				if (source !== frame.contentWindow) return;
				const reply = data as ProbeFrameMessage & EngineFrameMessage;
				if (!reply?.probeFrame && !reply?.engineFrame) return;
				clearTimeout(timer);
				removeEventListener('message', listen);
				resolve(reply);
			};
			addEventListener('message', listen);
			document.body.append(frame);
		});
		if ('error' in message && message.error) record.error = message.error;
		await sleep(SETTLE_MS);
		const held = frame.contentWindow?.__probeHeld;
		if (held?.sentinel) refs.sentinel = new WeakRef(held.sentinel);
		if (held?.memory) refs.memory = new WeakRef(held.memory);
		if (held?.worker) refs.worker = new WeakRef(held.worker);
	} catch (e) {
		record.error = (e as Error).message;
	} finally {
		frame.remove();
	}
	return { record, refs, beat, at: Atomics.load(beats, beat) };
}

async function probe(hold: string): Promise<HoldResult> {
	const roomBefore = await countRoom();
	progress(`${hold}: room ${roomBefore}`);
	const opened = [];
	for (let i = 0; i < FRAMES; i++) opened.push(await holdInFrame(hold));
	await sleep(BEAT_WATCH_MS);
	for (const frame of opened) frame.record.beatsAfter = Atomics.load(beats, frame.beat) - frame.at;
	const started = performance.now();
	const roomCounts: number[] = [];
	for (const pause of ROOM_PAUSES_MS) {
		await sleep(pause);
		const room = await countRoom();
		roomCounts.push(room);
		if (room >= roomBefore) break;
	}
	await sleep(500);
	for (const { record, refs } of opened) {
		if (refs.sentinel) record.sentinelKept = refs.sentinel.deref() !== undefined;
		if (refs.memory) record.memoryKept = refs.memory.deref() !== undefined;
		if (refs.worker) record.workerKept = refs.worker.deref() !== undefined;
	}
	progress(`${hold}: room after ${roomCounts.join(', ')}`);
	return {
		roomBefore,
		roomCounts,
		waitedMs: Math.round(performance.now() - started),
		frames: opened.map(({ record }) => record),
	};
}

run('frame-memory', async () => {
	const holds: Record<string, HoldResult | { skipped: string }> = {};
	for (const hold of HOLDS) {
		const room = await countRoom();
		if (room < FRAMES + 1) {
			holds[hold] = { skipped: `room for ${room} memories only` };
			continue;
		}
		holds[hold] = await probe(hold);
	}
	return { unitMiB: UNIT_MIB, frames: FRAMES, holds };
});
