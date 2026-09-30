// Which keys and pointers are down, so the page can release them when the sketch can no longer see
// them go up, and which page elements take typing, whose key presses belong to the page.

/** A pointer that is down: where it was last seen, which button pressed it, and its kind. */
interface HeldPointer {
	x: number;
	y: number;
	button: number;
	/** The pointer's kind, as the input ring's flags give it. */
	flags: number;
}

/** Keys and pointers that are down, so a lost focus or a cancelled touch can release them. */
export class HeldInput {
	private readonly keys = new Set<number>();
	private readonly pointers = new Map<number, HeldPointer>();

	/** Notes a key as down, and says whether it was up before: a key that was down is repeating. */
	keyDown(key: number): boolean {
		if (this.keys.has(key)) return false;
		this.keys.add(key);
		return true;
	}

	/** Forgets a key and says whether it was down. */
	keyUp(key: number): boolean {
		return this.keys.delete(key);
	}

	pointerDown(id: number, x: number, y: number, button: number, flags: number): void {
		this.pointers.set(id, { x, y, button, flags });
	}

	pointerMove(id: number, x: number, y: number): void {
		const held = this.pointers.get(id);
		if (held) {
			held.x = x;
			held.y = y;
		}
	}

	/** Forgets a pointer and says whether it was down. */
	pointerUp(id: number): boolean {
		return this.pointers.delete(id);
	}

	/** Releases every key that is down. */
	releaseKeys(keyUp: (key: number) => void): void {
		for (const key of this.keys) keyUp(key);
		this.keys.clear();
	}

	/** Releases everything that is down, pointers first, then keys. */
	releaseAll(
		pointerUp: (id: number, x: number, y: number, button: number, flags: number) => void,
		keyUp: (key: number) => void,
	): void {
		for (const [id, held] of this.pointers) pointerUp(id, held.x, held.y, held.button, held.flags);
		this.pointers.clear();
		this.releaseKeys(keyUp);
	}
}

/** True for a page element that takes typing, whose key presses belong to the page, not the sketch. */
export function isEditableTarget(target: unknown): boolean {
	const element = target as { tagName?: string; isContentEditable?: boolean } | null;
	if (!element) return false;
	if (element.isContentEditable) return true;
	return (
		element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT'
	);
}
