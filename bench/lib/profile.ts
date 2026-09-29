// Sums over the CPU profile of one thread, as Chrome's profiler returns it through the debugging
// protocol: how long the thread spent in each function, and how the time under one entry function
// divides between the engine's own code and the browser's built-in functions that it calls.
import { type CallFrame, placeName } from './devtools';

export interface CpuProfileNode {
	id: number;
	callFrame: CallFrame;
	children?: number[];
}

/** A profile of one thread. Times are in microseconds. */
export interface CpuProfile {
	nodes: CpuProfileNode[];
	startTime: number;
	endTime: number;
	/** The node each sample landed in. */
	samples?: number[];
	/** Time since the previous sample, or since the start for the first one. */
	timeDeltas?: number[];
}

/** The profile entry for time the thread spent waiting. */
const IDLE = '(idle)';
/** Profile entries that are not functions. */
const NOT_FUNCTIONS = new Set(['(root)', '(program)', IDLE, '(garbage collector)']);

/**
 * Microseconds each node spent itself, by node id. A sample's time runs until the next sample, and
 * the last one's until the profile ends, as Chrome's own profiler view counts it.
 */
export function selfTimes(profile: CpuProfile): Map<number, number> {
	const times = new Map<number, number>();
	const samples = profile.samples ?? [];
	const deltas = profile.timeDeltas ?? [];
	let at = profile.startTime;
	for (let i = 0; i < samples.length; i++) {
		at += deltas[i] ?? 0;
		const next = i + 1 < samples.length ? at + (deltas[i + 1] ?? 0) : profile.endTime;
		const id = samples[i] ?? 0;
		times.set(id, (times.get(id) ?? 0) + Math.max(0, next - at));
	}
	return times;
}

/** Whose time a function's own time is. */
export type Owner = 'engine' | 'browser' | 'other';

/**
 * The engine's own code comes from scripts whose address holds `engineUrl`. A named function with
 * no script is one of the browser's built-in functions, such as a WebGL call. The rest, such as
 * garbage collection, is neither.
 */
export function ownerOf({ functionName, url }: CallFrame, engineUrl: string): Owner {
	if (url.includes(engineUrl)) return 'engine';
	if (!url && functionName !== '' && !NOT_FUNCTIONS.has(functionName)) return 'browser';
	return 'other';
}

/** Where the time under an entry function went. Times are in milliseconds. */
export interface EntrySplit {
	/** The time the whole profile covers. */
	profileMs: number;
	/** The time the thread was not waiting. */
	busyMs: number;
	/** The time under the entry function, its own time included. */
	entryMs: number;
	engineMs: number;
	browserMs: number;
	otherMs: number;
	/** The browser functions under the entry function, most time first. */
	browserCalls: { name: string; ms: number }[];
}

/**
 * Splits the time under every call of an entry function, such as the render worker's replay, into
 * the engine's own code, the browser functions it calls, and the rest. A call of the entry function
 * inside another one counts once, as part of the outer call.
 */
export function splitEntry(
	profile: CpuProfile,
	isEntry: (frame: CallFrame) => boolean,
	engineUrl: string,
): EntrySplit {
	const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
	const own = selfTimes(profile);
	const children = new Set(profile.nodes.flatMap((node) => node.children ?? []));
	const roots = profile.nodes.filter((node) => !children.has(node.id));
	const split = { entry: 0, engine: 0, browser: 0, other: 0, idle: 0 };
	const browserCalls = new Map<string, number>();

	const visit = (node: CpuProfileNode, inEntry: boolean) => {
		const time = own.get(node.id) ?? 0;
		if (node.callFrame.functionName === IDLE) split.idle += time;
		const inside = inEntry || isEntry(node.callFrame);
		if (inside) {
			split.entry += time;
			const owner = ownerOf(node.callFrame, engineUrl);
			split[owner] += time;
			if (owner === 'browser') {
				const name = placeName(node.callFrame);
				browserCalls.set(name, (browserCalls.get(name) ?? 0) + time);
			}
		}
		for (const id of node.children ?? []) {
			const child = nodes.get(id);
			if (child) visit(child, inside);
		}
	};
	for (const root of roots) visit(root, false);

	const ms = (microseconds: number) => microseconds / 1000;
	const profileMs = ms(profile.endTime - profile.startTime);
	return {
		profileMs,
		busyMs: profileMs - ms(split.idle),
		entryMs: ms(split.entry),
		engineMs: ms(split.engine),
		browserMs: ms(split.browser),
		otherMs: ms(split.other),
		browserCalls: [...browserCalls]
			.map(([name, time]) => ({ name, ms: ms(time) }))
			.sort((a, b) => b.ms - a.ms),
	};
}
