// The page's start view and the species a held picture draws, both read from an address. The sketch
// runs in a worker, where `location` holds the page's own address, so the page's query is read
// before the worker's: ?cam=x,y,z sets the camera and ?look=x,y,z the point it aims at, so a framing
// can be dialled in beside the page.
import { isSpeciesId, type SpeciesId } from '@null3d/vegetation';

type Point = [number, number, number];

const query = ((): ((name: string) => string | null) => {
	const page = typeof location === 'undefined' ? undefined : new URLSearchParams(location.search);
	const own = new URL(import.meta.url).searchParams;
	return (name) => page?.get(name) ?? own.get(name);
})();

const numbers = (name: string): Point | undefined => {
	const said = query(name);
	if (!said) return undefined;
	const parts = said.split(',').map(Number);
	return parts.length === 3 && parts.every(Number.isFinite)
		? [parts[0] as number, parts[1] as number, parts[2] as number]
		: undefined;
};

/** The camera position and aim the page asks for, with the meadow's own start view as the default. */
export function startView(): { cam: Point; look: Point } {
	return { cam: numbers('cam') ?? [0, 50, 140], look: numbers('look') ?? [0, 0, 0] };
}

/**
 * The species a held picture draws, named in its switch by folder id; the live page names none and
 * draws every registered species.
 */
export function heldSpecies(): readonly SpeciesId[] {
	return (new URL(import.meta.url).searchParams.get('species') ?? '')
		.split(',')
		.filter(isSpeciesId);
}
