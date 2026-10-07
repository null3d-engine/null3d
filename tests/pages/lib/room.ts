// The room for shared memories: how many memories with the engine's default maximum a page can hold
// at once. The shared memory page counts it and waits for it to come back, and that page and the
// judge of its results agree on what it may lose.

/**
 * Room for shared memories that the page may lose over its restarts: the single-threaded build's
 * page keeps one core for the next engine.
 */
export const ROOM_KEPT = 1;

/**
 * The most room that a round may lose and keep, as lost address space rather than memory that
 * engines hold: small buffers that land in freed ranges split them for good. Safari on a Mac lost 2
 * at most that way.
 */
export const ROOM_LOST_ONCE = 2;

/**
 * The step that a test page's trail notes at the first shared memory that the browser refuses. The
 * engine tries again for about 45 seconds before E1109, longer than many pages may take, so a page
 * that times out while it waits for memory shows this in its trail.
 */
export const MEMORY_REFUSED = 'the browser refused a shared memory';

/** The engine's default maximum of its shared memory, in 64 KiB pages: 1 GiB. */
export const DEFAULT_MAXIMUM_PAGES = 16_384;
const INITIAL_PAGES = 18;
/**
 * The most memories a count holds at once. A count takes room until the browser frees what it
 * dropped, and Safari does that late: on CI's Mac a count that filled the room left a later page
 * with room for no engine for minutes. So the restart checks count only up to this cap. It is above
 * the room of the phones and tablets, about 9 on an iPhone and 6 on an iPad, so a count there is
 * the whole room. A browser with room for this many has room to spare.
 */
export const ROOM_CAP = 10;
/** The most room that a count of the whole room found in Safari on a Mac. */
export const MOST_ROOM_SEEN = 39;
/** The cap of a count of the whole room, as the memory plan makes: room for this many is plenty. */
export const FULL_COUNT = 64;
/**
 * The pauses before each count of the room, while a page waits for it to come back. A count that
 * the browser refused ends with a collection of the page's heap, and Safari frees the dead memories
 * that the collection finds at once. Memory that something else still holds comes back later: a
 * removed frame that Safari keeps, or a worker that has not ended yet. So the pauses grow, and
 * then hold at the longest. The wait in all is about twice the slowest return of the room seen in
 * Safari, as the implementation notes record. A shorter wait failed checks whose room came back
 * later. Memory that engines keep never comes back, so a real leak still fails, only later.
 */
const ROOM_PAUSES_MS = [1_000, 1_000, 2_000, 4_000, 8_000, 15_000, 15_000, 15_000, 15_000, 15_000];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A new shared memory with the given maximum in 64 KiB pages. */
export function allocateMemory(maximumPages = DEFAULT_MAXIMUM_PAGES): WebAssembly.Memory {
	return new WebAssembly.Memory({ initial: INITIAL_PAGES, maximum: maximumPages, shared: true });
}

/** A count of the room: the memories held at once, and the error of the refusal that ended it. */
export interface RoomCount {
	room: number;
	/** Set when the browser refused a memory below the cap, so the count is the whole room. */
	error?: string;
	/** Refusals that a later ask in the same count got past. */
	passing?: number;
}

/**
 * The pauses before a count asks again after a refusal, one for each ask in a row. Safari refuses a
 * new memory while it still holds memories that the page dropped, and the refusal makes it free
 * them, but not always at once. On CI's Mac, at each of 18 refusals of a count, the same request a
 * moment later was granted. Twice, 3 more asks at once were refused too, and a count 1 s later
 * found the cap. So only a refusal that holds through these pauses ends a count.
 */
const ASK_PAUSES_MS = [50, 100, 200, 400];

/**
 * Counts the room up to `cap`, then lets the browser find the counted memories unused. A refusal
 * ends the count only when it holds through a few more asks, each after a short pause. When it
 * held, the page asks for one more memory once the counted ones are garbage. Safari refuses it too
 * and runs a full collection, which finds them; otherwise Safari can keep them until a later
 * refusal, and the next count finds less room. A count that reached the cap asks for no more, since the browser would grant it.
 */
export async function countRoom(
	cap = ROOM_CAP,
	maximumPages = DEFAULT_MAXIMUM_PAGES,
): Promise<RoomCount> {
	let counted: RoomCount;
	{
		const memories: WebAssembly.Memory[] = [];
		let passing = 0;
		let refusedInRow = 0;
		let error: string | undefined;
		while (memories.length < cap) {
			try {
				memories.push(allocateMemory(maximumPages));
				passing += refusedInRow;
				refusedInRow = 0;
				error = undefined;
			} catch (e) {
				error = (e as Error).message;
				const pause = ASK_PAUSES_MS[refusedInRow];
				if (pause === undefined) break;
				refusedInRow++;
				await sleep(pause);
			}
		}
		counted = {
			room: memories.length,
			...(error === undefined ? {} : { error }),
			...(passing > 0 ? { passing } : {}),
		};
	}
	if (counted.error === undefined) return counted;
	await sleep(0);
	try {
		allocateMemory(maximumPages);
	} catch {
		// The refusal is the point: it makes the browser collect.
	}
	return counted;
}

/**
 * Counts the room up to `cap` after each of the pauses, until it reaches `needed` or the pauses end.
 * Returns each count and the time that the wait took.
 */
export async function roomAfterPauses(
	needed: number,
	cap = ROOM_CAP,
	maximumPages = DEFAULT_MAXIMUM_PAGES,
): Promise<{ counts: number[]; waitMs: number }> {
	const waitStart = performance.now();
	const counts: number[] = [];
	for (const pause of ROOM_PAUSES_MS) {
		await sleep(pause);
		const { room } = await countRoom(cap, maximumPages);
		counts.push(room);
		if (room >= needed) break;
	}
	return { counts, waitMs: Math.round(performance.now() - waitStart) };
}
