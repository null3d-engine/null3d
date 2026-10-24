// Reads the heap profiles of a page and its workers: the bytes that each place allocated, and the
// figure that a check judges when it samples more than once. Chrome's heap profiler charges each
// object to the outermost optimized function on the stack, so a function that the browser inlines
// charges its objects to its caller. When the browser installs code that it has just optimized, it
// charges a burst of objects to whichever function runs first in the next task, and a check sets
// such bursts aside. Everything here is pure: it reads a profile and names nothing itself.

/**
 * A function in a profile: its name, the script it comes from, empty for a built-in one, and where
 * in the script its parameters start, counted from 0.
 *
 * @typedef {object} CallFrame
 * @property {string} functionName
 * @property {string} url
 * @property {number} [lineNumber]
 * @property {number} [columnNumber]
 */

/**
 * A node of a heap sampling profile from Chrome's debugging protocol.
 *
 * @typedef {object} ProfileNode
 * @property {CallFrame} callFrame
 * @property {number} id
 * @property {number} selfSize
 * @property {ProfileNode[]} children
 */

/**
 * An object that the heap profiler sampled: its bytes, its node, and its turn in sampling order.
 *
 * @typedef {object} ProfileSample
 * @property {number} size
 * @property {number} nodeId
 * @property {number} ordinal
 */

/**
 * A heap sampling profile from Chrome's debugging protocol.
 *
 * @typedef {object} HeapProfile
 * @property {ProfileNode} head
 * @property {ProfileSample[]} samples
 */

/**
 * One place's allocations in one sample: the bytes of the place, the bytes of its burst that a
 * check sets aside, the callers of the call path that allocated most there, and the largest object.
 *
 * @typedef {object} Place
 * @property {number} bytes
 * @property {number} burst
 * @property {string} callers
 * @property {number} largest
 */

/**
 * One sample of a worker: its places and the frames drawn while it ran.
 *
 * @typedef {object} Sample
 * @property {Map<string, Place>} places
 * @property {number} frames
 * @property {number} [calls] The browser's calls into the worker during the sample, when counted.
 */

/**
 * A place's bytes per frame across the samples.
 *
 * @typedef {object} Steady
 * @property {number} perFrame The smaller of the samples' bytes per frame without the burst.
 * @property {number} most The larger of the samples' bytes per frame, the burst included.
 * @property {string} callers
 */

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

/**
 * A place in the code, by function and file. A named function with no file is one of the browser's
 * built-in functions, such as a promise's then or a WebGL call.
 *
 * @param {CallFrame} frame
 * @returns {string}
 */
export function placeName({ functionName, url }) {
	const name = functionName || '(anonymous)';
	if (!url) return name.startsWith('(') ? name : `${name} (built-in)`;
	return `${name} ${url.split('/').slice(-2).join('/').replace(/\?.*$/, '')}`;
}

/**
 * Bytes by the place that allocated them, a place being a function and its file.
 *
 * @param {ProfileNode} node
 * @param {Map<string, Place>} [out]
 * @param {readonly string[]} [callers]
 * @returns {Map<string, Place>}
 */
export function byPlace(node, out = new Map(), callers = []) {
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

/**
 * The place of each node of a profile, by node id.
 *
 * @param {ProfileNode} node
 * @param {Map<number, string>} [out]
 * @returns {Map<number, string>}
 */
function placesById(node, out = new Map()) {
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
 *
 * @param {HeapProfile} profile
 * @returns {Map<string, number>}
 */
export function burstBytes({ head, samples }) {
	const places = placesById(head);
	/** Each place's bytes, and the bytes of its largest short run. */
	/** @type {Map<string, { bytes: number, burst: number }>} */
	const totals = new Map();
	/** @type {string | undefined} */
	let place;
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
	/** @type {Map<string, number>} */
	const out = new Map();
	for (const [name, total] of totals)
		if (total.burst > 0 && total.burst >= total.bytes * BURST_SHARE) out.set(name, total.burst);
	return out;
}

/**
 * Each place's allocations in a profile, with the bytes of its burst.
 *
 * @param {HeapProfile} profile
 * @returns {Map<string, Place>}
 */
export function profilePlaces(profile) {
	const places = byPlace(profile.head);
	for (const [name, burst] of burstBytes(profile)) {
		const place = places.get(name);
		if (place) place.burst = Math.min(burst, place.bytes);
	}
	return places;
}

/**
 * All the bytes of a profile.
 *
 * @param {ProfileNode} node
 * @returns {number}
 */
export function totalSize(node) {
	return node.selfSize + node.children.reduce((sum, child) => sum + totalSize(child), 0);
}

/**
 * The samples with the bytes of each place that `into` names counted in the place it gives
 * instead. The browser counts an object in the function that makes it, or in its caller where it
 * inlines that function, so a callee's bytes move between the two places from run to run while
 * their sum holds; counted as one place, they read the same whichever way the inlining fell.
 *
 * @param {readonly Sample[]} samples
 * @param {ReadonlyMap<string, string>} into
 * @returns {Sample[]}
 */
export function countIn(samples, into) {
	return samples.map((sample) => {
		const places = new Map(sample.places);
		for (const [from, to] of into) {
			const moved = places.get(from);
			if (!moved) continue;
			places.delete(from);
			const kept = places.get(to);
			places.set(
				to,
				kept
					? {
							bytes: kept.bytes + moved.bytes,
							burst: kept.burst + moved.burst,
							callers: kept.largest >= moved.largest ? kept.callers : moved.callers,
							largest: Math.max(kept.largest, moved.largest),
						}
					: moved,
			);
		}
		return { ...sample, places };
	});
}

/**
 * Each place's bytes per frame without its burst in the sample where it allocated least, and its
 * bytes per frame with it in the one where it allocated most. Allocation in every frame shows in
 * each sample. An event that happens once, such as a function that runs unoptimized for a moment,
 * shows in one sample only, so its place counts the other sample's figure. Places come largest
 * first.
 *
 * @param {readonly Sample[]} samples
 * @returns {[string, Steady][]}
 */
export function steadyPlaces(samples) {
	const names = new Set(samples.flatMap((sample) => [...sample.places.keys()]));
	/** @type {[string, Steady][]} */
	const steady = [];
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

/**
 * A place's bytes per call in the sample where that figure was least, with that sample's calls.
 * @param {readonly Sample[]} samples
 * @param {string} name
 * @returns {{ perCall: number, calls: number } | null}
 */
export function perCall(samples, name) {
	/** @type {{ perCall: number, calls: number } | null} */
	let best = null;
	for (const { places, calls } of samples) {
		if (!calls || calls < 1) continue;
		const place = places.get(name);
		const bytes = Math.max(0, (place?.bytes ?? 0) - (place?.burst ?? 0));
		const figure = bytes / calls;
		if (best === null || figure < best.perCall) best = { perCall: figure, calls };
	}
	return best;
}
