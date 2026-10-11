// How the docs word the release of a `since` value. Pages' `since` values name the roadmap's steps,
// and the first release holds all of them. The rule for `since` values comes before that release
// (D-108), so the wording lives here alone and changes in one place.

/** The roadmap's steps before the first release, which `since` values name. */
const ROADMAP_STEPS: readonly string[] = ['0.1', '0.2', '0.3'];
const FIRST_RELEASE = '0.1.0';

/** What the docs say of `since` values, on the pages that list them. */
export const STEPS_NOTE = `The roadmap's steps 0.1, 0.2 and 0.3 all ship in the first release, null3D ${FIRST_RELEASE}.`;

/**
 * When a `since` value's feature ships: "roadmap step 0.2, first released in null3D 0.1.0",
 * "null3D 1.0" or "after null3D 1.0".
 */
export function releaseOf(since: string): string {
	if (ROADMAP_STEPS.includes(since))
		return `roadmap step ${since}, first released in null3D ${FIRST_RELEASE}`;
	return since.startsWith('after ')
		? `after null3D ${since.slice('after '.length)}`
		: `null3D ${since}`;
}

/** The sentence that opens the note under a written page's title. */
export function shipsSentence(since: string): string {
	const when = releaseOf(since);
	return ROADMAP_STEPS.includes(since)
		? `${when.charAt(0).toUpperCase()}${when.slice(1)}.`
		: `Ships in ${when}.`;
}
