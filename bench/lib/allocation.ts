// Reads the heap profiles of the allocation check: the bytes that each place allocated per frame,
// and the figure that the check judges when it samples more than once. Chrome's heap profiler
// charges each object to the outermost optimized function on the stack, so a function that the
// browser inlines charges its objects to its caller. Everything here is pure.
import { type CallFrame, placeName } from './devtools';

/** A node of a heap sampling profile from Chrome's debugging protocol. */
export interface ProfileNode {
	callFrame: CallFrame;
	selfSize: number;
	children: ProfileNode[];
}

/** One place's allocations in one sample. */
export interface Place {
	bytes: number;
	/** The callers of the call path that allocated most here. */
	callers: string;
	largest: number;
}

/** Callers shown for each place that allocates. */
const CALLERS_SHOWN = 2;

/** Bytes by the place that allocated them, a place being a function and its file. */
export function byPlace(
	node: ProfileNode,
	out = new Map<string, Place>(),
	callers: readonly string[] = [],
): Map<string, Place> {
	const name = placeName(node.callFrame);
	if (node.selfSize > 0) {
		const place = out.get(name) ?? { bytes: 0, callers: '', largest: 0 };
		place.bytes += node.selfSize;
		if (node.selfSize > place.largest) {
			place.largest = node.selfSize;
			place.callers = callers.slice(0, CALLERS_SHOWN).join(' < ');
		}
		out.set(name, place);
	}
	for (const child of node.children) byPlace(child, out, [name, ...callers]);
	return out;
}

/** All the bytes of a profile. */
export function totalSize(node: ProfileNode): number {
	return node.selfSize + node.children.reduce((sum, child) => sum + totalSize(child), 0);
}

/** One sample of a worker: its places and the frames drawn while it ran. */
export interface Sample {
	places: Map<string, Place>;
	frames: number;
}

/** A place's bytes per frame across the samples. */
export interface Steady {
	/** The smaller of the samples' bytes per frame, which the check judges. */
	perFrame: number;
	/** The larger of the samples' bytes per frame. */
	most: number;
	callers: string;
}

/**
 * Each place's bytes per frame in the sample where it allocated least, and in the one where it
 * allocated most. Allocation in every frame shows in each sample. An event that happens once, such
 * as the browser installing code it has just optimized, or a function that runs unoptimized for a
 * moment, shows in one sample only, so its place counts the other sample's figure. Places come
 * largest first.
 */
export function steadyPlaces(samples: readonly Sample[]): [string, Steady][] {
	const names = new Set(samples.flatMap((sample) => [...sample.places.keys()]));
	const steady: [string, Steady][] = [];
	for (const name of names) {
		let perFrame = Number.POSITIVE_INFINITY;
		let most = 0;
		let callers = '';
		let largest = 0;
		for (const { places, frames } of samples) {
			const place = places.get(name);
			const bytes = (place?.bytes ?? 0) / frames;
			perFrame = Math.min(perFrame, bytes);
			most = Math.max(most, bytes);
			if (place && place.largest > largest) {
				largest = place.largest;
				callers = place.callers;
			}
		}
		steady.push([name, { perFrame, most, callers }]);
	}
	return steady.sort((a, b) => b[1].perFrame - a[1].perFrame || b[1].most - a[1].most);
}
