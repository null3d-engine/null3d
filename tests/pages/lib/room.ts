// The room for shared memories: how many memories with the engine's default maximum a page can hold
// at once. Test pages count it, and wait for it to come back, and the shared memory page and the
// judge of its results agree on what it may lose.

/**
 * Room for shared memories that the page may lose over its restarts: the single-threaded build's
 * page keeps one core for the next engine.
 */
export const ROOM_KEPT = 1;

/** The engine's default maximum of its shared memory, in 64 KiB pages: 1 GiB. */
export const DEFAULT_MAXIMUM_PAGES = 16_384;
const INITIAL_PAGES = 18;
/** The most memories a count holds at once: a browser with room for this many has room to spare. */
export const MOST_HELD = 64;
/**
 * The pauses before each count of the room, while a page waits for it to come back. Safari frees a
 * memory only after a full collection finds it unused and its sweeper then reaches it. Each count
 * ends with a collection, and the pause gives Safari time to free what it found. The pauses grow,
 * because each collection starts the sweep again, and then hold at the longest. Safari frees the
 * memory of engines in removed frames late, at times long after the frames have gone, so the wait in
 * all is about twice the slowest return of the room seen in Safari, as the implementation notes
 * record. A shorter wait failed checks whose room came back later. Memory that engines keep never
 * comes back, so a real leak still fails, only later.
 */
const ROOM_PAUSES_MS = [1_000, 1_000, 2_000, 4_000, 8_000, 15_000, 15_000, 15_000, 15_000, 15_000];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A new shared memory with the given maximum in 64 KiB pages. */
export function allocateMemory(maximumPages = DEFAULT_MAXIMUM_PAGES): WebAssembly.Memory {
	return new WebAssembly.Memory({ initial: INITIAL_PAGES, maximum: maximumPages, shared: true });
}

/** How many memories the page can hold at once, and the error that ended the count. */
function countRoom(maximumPages: number): { room: number; error?: string } {
	const memories: WebAssembly.Memory[] = [];
	try {
		while (memories.length < MOST_HELD) memories.push(allocateMemory(maximumPages));
		return { room: memories.length };
	} catch (e) {
		return { room: memories.length, error: (e as Error).message };
	}
}

/**
 * Counts the room, then lets the browser find the counted memories unused. Once they are garbage,
 * the page asks for one more memory. The count filled the room, so Safari refuses it and runs a full
 * collection, which finds them. Otherwise Safari can keep them until a later refusal, and the next
 * count finds less room.
 */
export async function countRoomAndRelease(
	maximumPages = DEFAULT_MAXIMUM_PAGES,
): Promise<{ room: number; error?: string }> {
	const counted = countRoom(maximumPages);
	await sleep(0);
	try {
		allocateMemory(maximumPages);
	} catch {
		// The refusal is the point: it makes the browser collect.
	}
	return counted;
}

/**
 * Counts the room after each of the pauses, until it reaches `needed` or the pauses end. Returns
 * each count and the time that the wait took.
 */
export async function roomAfterPauses(
	needed: number,
	maximumPages = DEFAULT_MAXIMUM_PAGES,
): Promise<{ counts: number[]; waitMs: number }> {
	const waitStart = performance.now();
	const counts: number[] = [];
	for (const pause of ROOM_PAUSES_MS) {
		await sleep(pause);
		const { room } = await countRoomAndRelease(maximumPages);
		counts.push(room);
		if (room >= needed) break;
	}
	return { counts, waitMs: Math.round(performance.now() - waitStart) };
}
