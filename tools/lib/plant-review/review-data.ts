// A species' review data beside its slot queries: what the review must know about the species and
// about single reference pictures before it reads a figure. The data lives in the species' slot
// file under reserved keys, which name no reference file. `_habit` says how the plant stands where
// that changes how its outline is read. `_pictures` names the pictures that do not judge the
// primary plant, or whose outline cannot be read, each with its reason.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PlantHabit } from './references.ts';

/** The reserved keys of a slot file that hold review data. */
export const HABIT_KEY = '_habit';
export const PICTURES_KEY = '_pictures';

/**
 * Why a picture does not judge the primary plant: it shows a second form of the species, it is a
 * recorded limit of the reference set, or it shows a stand of many plants, which one plant cannot
 * draw.
 */
export const STANDINGS = ['second-form', 'reference-limit', 'stand'] as const;

/** One reason a picture does not judge the primary plant. */
export type Standing = (typeof STANDINGS)[number];

/** What the review data says of one reference picture. */
export interface PictureNote {
	/** Why the picture does not judge the primary plant, with `reason`. */
	readonly standing?: Standing;
	readonly reason?: string;
	/**
	 * Why the picture's outline cannot be read, such as a far bank that joins the plant's outline.
	 * Its shape, width, gap and crown figures are then void, and its color figures stand.
	 */
	readonly outline?: string;
	/** For a stand: how many plants the photograph shows, and the metres between them. */
	readonly count?: number;
	readonly spacing?: number;
}

/** A species' review data. */
export interface ReviewData {
	readonly habit?: PlantHabit;
	readonly pictures: Readonly<Record<string, PictureNote>>;
}

/** The review data a slot file holds; a key it does not hold, or holds wrongly, is a fault to name. */
export function reviewDataOf(slots: Readonly<Record<string, unknown>>): ReviewData {
	const habit = slots[HABIT_KEY];
	if (habit !== undefined && habit !== 'clump' && habit !== 'mound')
		throw new Error(`${HABIT_KEY} is ${JSON.stringify(habit)}: give "clump" or "mound".`);
	const pictures = (slots[PICTURES_KEY] ?? {}) as Record<string, PictureNote>;
	for (const [file, note] of Object.entries(pictures)) {
		if (note.standing !== undefined && !STANDINGS.includes(note.standing))
			throw new Error(
				`${PICTURES_KEY} gives ${file} the standing ${JSON.stringify(note.standing)}: give one of ${STANDINGS.join(', ')}.`,
			);
		if (note.standing !== undefined && !note.reason)
			throw new Error(`${PICTURES_KEY} sets ${file} aside as ${note.standing} with no reason.`);
		if (note.standing === undefined && note.outline === undefined)
			throw new Error(`${PICTURES_KEY} names ${file} and says nothing of it.`);
	}
	return { ...(habit !== undefined && { habit }), pictures };
}

/** The review data of a species' own slot file in a folder of slot files; none for a species without one. */
export function reviewDataOfSpecies(folder: string, species: string): ReviewData {
	const path = join(folder, `${species}.json`);
	if (!existsSync(path)) return { pictures: {} };
	return reviewDataOf(JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>);
}

/** Why a stand picture is not judged, in words for the record. */
export function standReason(note: PictureNote): string {
	const size =
		note.count !== undefined && note.spacing !== undefined
			? ` of about ${note.count} plants ${note.spacing} m apart`
			: '';
	return `the photograph shows a stand${size}, which the page cannot plant yet: ${note.reason}`;
}
