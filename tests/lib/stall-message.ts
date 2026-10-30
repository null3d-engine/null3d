// The message of a page that stopped noting steps: its last steps, its start reading and the tests
// that ran beside it. A page that stalls without new steps is a case the instrument exists for, so
// its message carries the same readings as any other failure.
import { neighbourNote } from './running-tests.ts';
import { calibrationNote } from './start-calibrations.ts';

/** How many of the page's last steps the stall message quotes. */
const STALL_STEPS = 5;

/** The message of a page that noted no new step within `stallMs`, with what the readings say. */
export function stallMessage(
	trail: readonly string[],
	stallMs: number,
	calibrationMs: unknown,
): string {
	const notes = `${calibrationNote(calibrationMs)}${neighbourNote()}`;
	const suffix = notes === '' ? '' : `\n${notes.replace(/^; /, '')}`;
	return `no result and no new step within ${stallMs / 1000} s. The last steps:\n${trail.slice(-STALL_STEPS).join('\n')}${suffix}`;
}
