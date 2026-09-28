// Which keys and pointers are down, so the page can release them when the sketch can no longer see
// them go up, and which page elements take typing, whose key presses belong to the page.

/** A pointer that is down: where it was last seen and which button pressed it. */
interface HeldPointer {
	x: number;
	y: number;
	button: number;
}

/** Keys and pointers that are down, so a lost focus or a cancelled touch can release them. */
export class HeldInput {
	private readonly keys = new Set<number>();
	private readonly pointers = new Map<number, HeldPointer>();

	keyDown(code: number): void {
		this.keys.add(code);
	}

	/** Forgets a key and says whether it was down. */
	keyUp(code: number): boolean {
		return this.keys.delete(code);
	}

	pointerDown(id: number, x: number, y: number, button: number): void {
		this.pointers.set(id, { x, y, button });
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

	/** Releases everything that is down, pointers first, then keys. */
	releaseAll(
		pointerUp: (id: number, x: number, y: number, button: number) => void,
		keyUp: (code: number) => void,
	): void {
		for (const [id, held] of this.pointers) pointerUp(id, held.x, held.y, held.button);
		for (const code of this.keys) keyUp(code);
		this.pointers.clear();
		this.keys.clear();
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
