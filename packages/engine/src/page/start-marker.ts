// The crash marker: a note in localStorage, one per sketch, that a start of the sketch is under
// way. The page writes it before the sketch's setup runs, and removes it once the engine has drawn
// for the first seconds of play, or when the page stops the engine or leaves before then. A note
// that the next start finds therefore means that the tab died during that start, most often
// because a phone ran out of memory. The next start then runs a lighter preset (see the chooser).
// Storage that cannot be read or written counts as a normal start. Each note names the page load
// that wrote it, so the engines of one page never count each other's starts as crashes.

import type { Tier } from '../shared/tier';

/** How long the engine draws after its first frame before the page removes the note. */
export const STABLE_PLAY_MS = 5_000;

const KEY_PREFIX = 'null3d.start:';
const TIERS: readonly string[] = ['webgpu', 'webgpu-compat', 'webgl2'];

/** What the note holds while a start is under way. */
interface StartNote {
	/** The starts that crashed, one after another, before this one. */
	crashed: number;
	/** The GPU path of the start under way. */
	tier: Tier;
	/** The page load that wrote the note: its `performance.timeOrigin`. */
	page: number;
}

/** What the note says about the starts before this one. */
export interface StartHistory {
	/** The starts that crashed the tab, one after another, before this one. */
	crashed: number;
	/** The GPU path of the last start that crashed, or null. */
	lastTier: Tier | null;
}

/** The history of a start without a note. */
export const NO_HISTORY: StartHistory = { crashed: 0, lastTier: null };

/** The note in `text`, or undefined for text that is not one. */
function parseNote(text: string | null): StartNote | undefined {
	if (text === null) return undefined;
	try {
		const note = JSON.parse(text) as Partial<StartNote> | null;
		return note &&
			Number.isInteger(note.crashed) &&
			(note.crashed as number) >= 0 &&
			TIERS.includes(note.tier as string) &&
			typeof note.page === 'number'
			? (note as StartNote)
			: undefined;
	} catch {
		return undefined;
	}
}

/**
 * What a stored note says to a start in the page load `page`. A note from another page load means
 * that its start crashed. A note from this page load is another engine's start, which has not
 * crashed. Text that is not a note counts as none.
 */
export function historyOf(text: string | null, page: number): StartHistory {
	const note = parseNote(text);
	if (!note) return NO_HISTORY;
	if (note.page === page) return { crashed: note.crashed, lastTier: null };
	return { crashed: note.crashed + 1, lastTier: note.tier };
}

/** The page's localStorage, or undefined where the browser refuses it, as in a sandboxed frame. */
function pageStorage(): Storage | undefined {
	try {
		return globalThis.localStorage ?? undefined;
	} catch {
		return undefined;
	}
}

/** The crash marker of one sketch, for one start of it. */
export class StartMarker {
	private readonly key: string;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private ended = false;
	private readonly onPageHide = () => this.end();

	/**
	 * `page` names this page load, and `storage` stands in for the page's localStorage in tests.
	 */
	constructor(
		sketchUrl: string,
		private readonly page: number = globalThis.performance?.timeOrigin ?? 0,
		private readonly storage: Storage | undefined = pageStorage(),
	) {
		this.key = KEY_PREFIX + sketchUrl;
	}

	/** What the note says about the starts before this one: none when storage fails. */
	read(): StartHistory {
		try {
			return historyOf(this.storage?.getItem(this.key) ?? null, this.page);
		} catch {
			return NO_HISTORY;
		}
	}

	/**
	 * Writes the note for this start, which runs on `tier` after the crashed starts in `history`,
	 * and removes it when the page leaves.
	 */
	begin(history: StartHistory, tier: Tier): void {
		const note: StartNote = { crashed: history.crashed, tier, page: this.page };
		try {
			this.storage?.setItem(this.key, JSON.stringify(note));
		} catch {
			// A start without its note still runs; only a crash during it goes unnoticed.
		}
		globalThis.addEventListener?.('pagehide', this.onPageHide);
	}

	/** Removes the note once the engine has drawn for `playMs` after `firstFrame`. */
	endAfter(firstFrame: Promise<void>, playMs = STABLE_PLAY_MS): void {
		void firstFrame.then(() => {
			if (!this.ended) this.timer = setTimeout(() => this.end(), playMs);
		});
	}

	/** Removes the note, if this page load wrote it. Later calls do nothing. */
	end(): void {
		if (this.ended) return;
		this.ended = true;
		clearTimeout(this.timer);
		globalThis.removeEventListener?.('pagehide', this.onPageHide);
		try {
			const note = parseNote(this.storage?.getItem(this.key) ?? null);
			if (note?.page === this.page) this.storage?.removeItem(this.key);
		} catch {
			// A note that stays counts one crash too many, at worst.
		}
	}
}
