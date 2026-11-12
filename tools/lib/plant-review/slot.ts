// The draw slots a machine renders plants in: three. Seven shared dev servers on a fourteen-core
// Mac once pushed the load past thirty, so runs sat on their first page for minutes; one is safe but
// leaves short tests waiting behind a full turn round. Two held the load under ten while two draws
// worked. Three measured the load at nine with two draws working and a dozen rounds queued, so the
// third lane keeps a full round moving without a queue behind it. A run takes a slot before it
// starts drawing and gives it back when it is done, so no script has to know the rule. A run that is
// known to be alone skips the wait.
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** How many plant renders may draw at once. */
const DRAW_SLOTS = 3;
/** Where the slots are kept, one folder each. */
const DRAW_SLOT = '/tmp/null3d-plant-draw.slot-';
/**
 * How long a slot that records no holder counts as taken: long enough for the oldest running
 * review that keeps no record, and far longer than any round's start, since a working run gives its
 * directory back the moment it finishes.
 */
const SLOT_CLAIM_MS = 15 * 60_000;

/** Whether the run that took a slot is still alive, judged by the process it recorded. */
function slotHeld(path: string): boolean {
	let pid: number;
	try {
		pid = Number.parseInt(readFileSync(join(path, 'pid'), 'utf8').trim(), 10);
	} catch {
		// A run writes its record a moment after taking the slot, so a slot without one is taken
		// by a live run at first, and abandoned once that moment has passed.
		try {
			return Date.now() - statSync(path).mtimeMs < SLOT_CLAIM_MS;
		} catch {
			return false;
		}
	}
	if (!Number.isFinite(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		// A process this user may not signal still exists; one that does not exist raises ESRCH.
		return (error as NodeJS.ErrnoException).code === 'EPERM';
	}
}

/**
 * Takes the first free draw slot, waiting until one frees, and returns the way to give it back.
 *
 * @param noSlot Skip the wait for a run that is known to be alone.
 * @returns A function that gives the slot back.
 */
export async function takeDrawSlot(noSlot = false): Promise<() => void> {
	if (noSlot) return () => {};
	for (let attempt = 0; attempt < 720; attempt++) {
		for (let slot = 1; slot <= DRAW_SLOTS; slot++) {
			const path = `${DRAW_SLOT}${slot}`;
			try {
				mkdirSync(path);
			} catch {
				if (slotHeld(path)) continue;
				// A run that was killed leaves its directory behind. Without this the machine would
				// wait on a slot that nothing will ever give back.
				try {
					rmSync(path, { recursive: true, force: true });
					mkdirSync(path);
				} catch {
					continue;
				}
			}
			writeFileSync(join(path, 'pid'), `${process.pid}\n`);
			return () => {
				try {
					rmSync(path, { recursive: true, force: true });
				} catch {
					// Another process reclaimed it; the slot is free either way.
				}
			};
		}
		await new Promise((done) => setTimeout(done, 5000));
	}
	throw new Error('no draw slot freed in an hour: another run is holding the machine');
}
