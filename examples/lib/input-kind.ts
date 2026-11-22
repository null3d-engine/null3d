// The kind of input that a demos page has: a coarse pointer, as a touch screen has, or a fine one,
// as a mouse or a trackpad. The pointer's capability decides it, never the window's shape or the
// browser's name, and a device that gains or loses a pointer changes it while the page runs.

/** The kind of pointer that the page takes its input from. */
export type InputKind = 'fine' | 'coarse';

/**
 * The query for a coarse input: the primary pointer cannot point precisely, or the device cannot
 * hover. Either alone is a touch-first device; a hybrid with a mouse answers fine.
 */
export const COARSE_INPUT = '(pointer: coarse), (hover: none)';

/** The input kind that the queries answer, from a function that answers a query. */
export function inputKindOf(matches: (query: string) => boolean): InputKind {
	return matches(COARSE_INPUT) ? 'coarse' : 'fine';
}

/**
 * Watches the input kind: calls `onChange` with the kind now, and again whenever the pointer's
 * capability changes. Returns the function that stops watching.
 */
export function watchInputKind(
	query: MediaQueryList,
	onChange: (kind: InputKind) => void,
): () => void {
	const update = () => onChange(query.matches ? 'coarse' : 'fine');
	update();
	query.addEventListener('change', update);
	return () => query.removeEventListener('change', update);
}
