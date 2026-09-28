// Chooses how each mid-size upload travels: through queue.writeBuffer, or through the staging
// ring. Which is faster depends on the browser. In Chrome on a Mac the ring is 3 to 6 times faster.
// In Safari writeBuffer is faster at every size, as unmapping a staging buffer there costs time in
// proportion to the buffer's size. So the render worker measures both routes on the device, never
// deciding from the browser's name. It keeps each route's cost per byte for each size class, sends
// an upload by the cheaper route, and now and then by the other route, so both costs stay current.
//
// Each clock reading creates a number object, so once the costs are known only one submit in a few
// is timed. The choice itself reads only whole numbers, which allocate nothing.

/** Uploads smaller than this take writeBuffer, as the ring's fixed costs outweigh any gain. */
export const STAGING_MIN_BYTES = 64 * 1024;
/** Uploads this large or larger take writeBuffer, the fastest route in every browser measured. */
export const STAGING_MAX_BYTES = 4 * 1024 * 1024;
/** Size classes: one per power of two from the smallest staged size up to the largest. */
const CLASSES = Math.log2(STAGING_MAX_BYTES / STAGING_MIN_BYTES);
/** Leading zero bits of the smallest staged size, a whole power of two. */
const MIN_ZEROS = Math.clz32(STAGING_MIN_BYTES);
/** Bits of a class's known costs. */
const DIRECT_KNOWN = 1;
const RING_KNOWN = 2;
const BOTH_KNOWN = DIRECT_KNOWN | RING_KNOWN;
/** Submits from one timed submit to the next, once every class in use has both costs. */
export const TIME_EVERY = 8;
/** Timed uploads of a class from one try of the costlier route to the next. */
export const TRY_EVERY = 32;
/** The weight of a new sample in a cost estimate. */
const WEIGHT = 0.125;

/** The size class of an upload in the staged range: the power of two it reaches. */
function classOf(size: number): number {
	return Math.min(CLASSES - 1, MIN_ZEROS - Math.clz32(size));
}

/** Measured costs of both routes, in milliseconds per byte, by size class. */
export class UploadRoutes {
	private readonly direct = new Float64Array(CLASSES).fill(Number.NaN);
	private readonly staged = new Float64Array(CLASSES).fill(Number.NaN);
	/** Which costs each class has, as bits. */
	private readonly known = new Uint8Array(CLASSES);
	/** 1 where the ring is the cheaper route of a class. */
	private readonly ringCheaper = new Uint8Array(CLASSES);
	private readonly timedUploads = new Uint32Array(CLASSES);
	/** Bytes of each class that the current submit sends through the ring. */
	private readonly ringBytes = new Float64Array(CLASSES);
	/** Time the current submit spends on the ring: its copies in, the unmapping and the mapping. */
	private readonly ringMs = new Float64Array(1);
	private submits = 0;
	/** True when the current submit met a class that lacks a cost, so the next one is timed. */
	private unmeasured = false;
	/** True while the current submit times its routed uploads and the ring's work. */
	timing = true;

	/**
	 * With `fixed`, every upload in the range takes the ring (true) or writeBuffer (false), for
	 * tests of one route.
	 */
	constructor(private readonly fixed?: boolean) {}

	/** True when the routes choose for an upload of this many bytes; others take writeBuffer. */
	static covers(size: number): boolean {
		return size >= STAGING_MIN_BYTES && size < STAGING_MAX_BYTES;
	}

	/**
	 * True when an upload of `size` bytes in the staged range goes through the staging ring. A class
	 * that lacks a cost tries the missing route in a timed submit, and takes writeBuffer, which works
	 * everywhere, in an untimed one.
	 */
	takesRing(size: number): boolean {
		if (this.fixed !== undefined) return this.fixed;
		const k = classOf(size);
		const known = this.known[k] as number;
		if (known !== BOTH_KNOWN) {
			this.unmeasured = true;
			return this.timing && (known & RING_KNOWN) === 0;
		}
		const ringCheaper = this.ringCheaper[k] === 1;
		if (!this.timing) return ringCheaper;
		const count = ((this.timedUploads[k] as number) + 1) % TRY_EVERY;
		this.timedUploads[k] = count;
		return ringCheaper !== (count === 0);
	}

	/** Records an upload of `size` bytes that took `ms` through writeBuffer, in a timed submit. */
	wroteDirect(size: number, ms: number): void {
		this.add(this.direct, DIRECT_KNOWN, classOf(size), ms / size);
	}

	/** Adds an upload of `size` bytes that took `ms` to copy into the ring, in a timed submit. */
	wroteToRing(size: number, ms: number): void {
		const k = classOf(size);
		this.ringBytes[k] = (this.ringBytes[k] as number) + size;
		this.ringMs[0] = (this.ringMs[0] as number) + ms;
	}

	/** Adds the ring's time for the whole submit: unmapping, recording the copies, mapping again. */
	ringWork(ms: number): void {
		this.ringMs[0] = (this.ringMs[0] as number) + ms;
	}

	/**
	 * Ends a submit. A timed submit shares its ring time among its ring uploads by bytes and records
	 * the cost of each class, unless the ring made a buffer for it, a one-time cost. Then it decides
	 * whether the next submit is timed.
	 */
	submitted(madeBuffer: boolean): void {
		if (this.timing) {
			let bytes = 0;
			for (let k = 0; k < CLASSES; k++) bytes += this.ringBytes[k] as number;
			if (bytes > 0 && !madeBuffer) {
				const perByte = (this.ringMs[0] as number) / bytes;
				for (let k = 0; k < CLASSES; k++)
					if ((this.ringBytes[k] as number) > 0) this.add(this.staged, RING_KNOWN, k, perByte);
			}
			this.ringBytes.fill(0);
			this.ringMs[0] = 0;
		}
		this.submits = (this.submits + 1) % TIME_EVERY;
		this.timing = this.unmeasured || this.submits === 0;
		this.unmeasured = false;
	}

	/** Adds a sample to one route's cost for class `k`, then settles which route is cheaper. */
	private add(costs: Float64Array, bit: number, k: number, sample: number): void {
		const known = (this.known[k] as number) | bit;
		const old = costs[k] as number;
		costs[k] = known === (this.known[k] as number) ? old + (sample - old) * WEIGHT : sample;
		this.known[k] = known;
		this.ringCheaper[k] = (this.staged[k] as number) < (this.direct[k] as number) ? 1 : 0;
	}
}
