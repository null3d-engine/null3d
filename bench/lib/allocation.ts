// Reads the heap profiles of the allocation check: the bytes that each place allocated per frame,
// and the figure that the check judges when it samples more than once. Chrome's heap profiler
// charges each object to the outermost optimized function on the stack, so a function that the
// browser inlines charges its objects to its caller. When the browser installs code that it has just
// optimized, it charges a burst of objects to whichever function runs first in the next task, and
// the check sets such bursts aside. Everything here is pure.
import { type CallFrame, placeName } from './devtools';

/** A node of a heap sampling profile from Chrome's debugging protocol. */
export interface ProfileNode {
	callFrame: CallFrame;
	id: number;
	selfSize: number;
	children: ProfileNode[];
}

/** An object that the heap profiler sampled: its bytes, its node, and its turn in sampling order. */
export interface ProfileSample {
	size: number;
	nodeId: number;
	ordinal: number;
}

/** A heap sampling profile from Chrome's debugging protocol. */
export interface HeapProfile {
	head: ProfileNode;
	samples: ProfileSample[];
}

/** One place's allocations in one sample. */
export interface Place {
	bytes: number;
	/** The bytes of the place's burst, which the check sets aside. */
	burst: number;
	/** The callers of the call path that allocated most here. */
	callers: string;
	largest: number;
}

/** Callers shown for each place that allocates. */
const CALLERS_SHOWN = 2;
/**
 * The share of a place's bytes in a sample that a run of objects must hold to be a burst. A place
 * that allocates in every frame spreads its bytes over hundreds of runs, so none of them is one.
 */
const BURST_SHARE = 0.1;
/**
 * The most sampled objects in a burst. An installation of optimized code makes a few large objects,
 * so the profiler samples few of them. A longer run is allocation that goes on.
 */
const BURST_OBJECTS = 16;

/** Bytes by the place that allocated them, a place being a function and its file. */
export function byPlace(
	node: ProfileNode,
	out = new Map<string, Place>(),
	callers: readonly string[] = [],
): Map<string, Place> {
	const name = placeName(node.callFrame);
	if (node.selfSize > 0) {
		const place = out.get(name) ?? { bytes: 0, burst: 0, callers: '', largest: 0 };
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

/** The place of each node of a profile, by node id. */
function placesById(node: ProfileNode, out = new Map<number, string>()): Map<number, string> {
	out.set(node.id, placeName(node.callFrame));
	for (const child of node.children) placesById(child, out);
	return out;
}

/**
 * The bytes of each place's burst in a profile. A run is a series of objects that the profiler
 * sampled one after another at one place. A place's burst is its largest short run, when that run
 * holds a large share of the place's bytes. When the browser installs code that it has just
 * optimized, the code and its tables make such a run in the first function of the next task, which
 * may be any callback, even an empty one. Only one run per place is set aside: code that the
 * browser throws away and compiles again, over and over, makes more, and they count.
 */
export function burstBytes({ head, samples }: HeapProfile): Map<string, number> {
	const places = placesById(head);
	/** Each place's bytes, and the bytes of its largest short run. */
	const totals = new Map<string, { bytes: number; burst: number }>();
	let place: string | undefined;
	let bytes = 0;
	let count = 0;
	const endRun = () => {
		if (place === undefined) return;
		const total = totals.get(place) ?? { bytes: 0, burst: 0 };
		total.bytes += bytes;
		if (count <= BURST_OBJECTS && bytes > total.burst) total.burst = bytes;
		totals.set(place, total);
	};
	for (const sample of samples.toSorted((a, b) => a.ordinal - b.ordinal)) {
		const at = places.get(sample.nodeId) ?? '';
		if (at !== place) {
			endRun();
			place = at;
			bytes = 0;
			count = 0;
		}
		bytes += sample.size;
		count++;
	}
	endRun();
	const out = new Map<string, number>();
	for (const [name, total] of totals)
		if (total.burst > 0 && total.burst >= total.bytes * BURST_SHARE) out.set(name, total.burst);
	return out;
}

/** Each place's allocations in a profile, with the bytes of its burst. */
export function profilePlaces(profile: HeapProfile): Map<string, Place> {
	const places = byPlace(profile.head);
	for (const [name, burst] of burstBytes(profile)) {
		const place = places.get(name);
		if (place) place.burst = Math.min(burst, place.bytes);
	}
	return places;
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
	/** The smaller of the samples' bytes per frame without the burst, which the check judges. */
	perFrame: number;
	/** The larger of the samples' bytes per frame, the burst included. */
	most: number;
	callers: string;
}

/**
 * Each place's bytes per frame without its burst in the sample where it allocated least, and its
 * bytes per frame with it in the one where it allocated most. Allocation in every frame shows in
 * each sample. An event that happens once, such as a function that runs unoptimized for a moment,
 * shows in one sample only, so its place counts the other sample's figure. Places come largest
 * first.
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
			const bytes = place?.bytes ?? 0;
			perFrame = Math.min(perFrame, (bytes - (place?.burst ?? 0)) / frames);
			most = Math.max(most, bytes / frames);
			if (place && place.largest > largest) {
				largest = place.largest;
				callers = place.callers;
			}
		}
		steady.push([name, { perFrame, most, callers }]);
	}
	return steady.sort((a, b) => b[1].perFrame - a[1].perFrame || b[1].most - a[1].most);
}
