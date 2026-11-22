// The demos page picks its controls from the pointer's capability, not from the window's shape or
// the browser's name: a coarse pointer, as a touch screen has, reads gestures; a fine one reads
// keys. A device that gains or loses a pointer moves the page with it.
import { expect, test } from 'bun:test';
import { COARSE_INPUT, inputKindOf, watchInputKind } from './input-kind';

/** A stand-in for the page's media query, whose matches the test sets. */
function fakeQuery(matches: boolean) {
	const listeners = new Set<() => void>();
	return {
		matches,
		listeners,
		query: {
			get matches() {
				return matches;
			},
			addEventListener: (_type: 'change', listener: () => void) => listeners.add(listener),
			removeEventListener: (_type: 'change', listener: () => void) => listeners.delete(listener),
		} as unknown as MediaQueryList,
		set(next: boolean) {
			matches = next;
			for (const listener of listeners) listener();
		},
	};
}

test('a pointer that cannot point precisely, or cannot hover, is coarse', () => {
	expect(inputKindOf(() => false)).toBe('fine');
	expect(inputKindOf((query) => query === COARSE_INPUT)).toBe('coarse');
	// A touch screen that also has a hovering mouse answers fine at once, from the same query.
	let hovering = false;
	expect(inputKindOf((query) => query === COARSE_INPUT && !hovering)).toBe('coarse');
	hovering = true;
	expect(inputKindOf((query) => query === COARSE_INPUT && !hovering)).toBe('fine');
});

test('the kind is read now, and again whenever the pointer changes', () => {
	const query = fakeQuery(false);
	const seen: string[] = [];
	const stop = watchInputKind(query.query, (kind) => seen.push(kind));
	expect(seen).toEqual(['fine']);
	query.set(true);
	expect(seen).toEqual(['fine', 'coarse']);
	query.set(false);
	expect(seen).toEqual(['fine', 'coarse', 'fine']);
	stop();
	query.set(true);
	expect(seen).toEqual(['fine', 'coarse', 'fine']);
});
