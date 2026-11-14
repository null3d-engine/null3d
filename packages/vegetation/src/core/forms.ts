// A species' other forms: the record that one form grows from, made by merging the form's changes
// into the species' own record. An object in a form merges into the record's object field by field;
// a number, a word, a curve or a list replaces the record's whole value; and null drops an optional
// field. The record a plant grows from never carries the forms themselves, so a change to one form
// leaves the kit and the variants of every other form as they were.
import type { FormField, Species, SpeciesForm } from './record';

/** Every field a form may give, its words among them, so the record check can name any other. */
export const FORM_FIELDS: Readonly<Record<'form' | FormField, true>> = {
	form: true,
	size: true,
	growth: true,
	envelope: true,
	shoots: true,
	foliage: true,
	bark: true,
	base: true,
	extras: true,
	wind: true,
	roundBand: true,
	lopsided: true,
	cuttings: true,
};

/** Whether a value is a plain object, whose fields a form's changes merge into one by one. */
function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A value with changes merged in: an object field by field, null dropping a field, all else whole.
 * Each field is defined as the object's own, so no name, `__proto__` among them, reaches a setter.
 */
function merged(value: unknown, changes: unknown): unknown {
	if (!isObject(changes)) return changes;
	const out: Record<string, unknown> = isObject(value) ? { ...value } : {};
	for (const [key, change] of Object.entries(changes)) {
		if (change === null) delete out[key];
		else
			Object.defineProperty(out, key, {
				value: merged(Object.hasOwn(out, key) ? out[key] : undefined, change),
				enumerable: true,
				writable: true,
				configurable: true,
			});
	}
	return out;
}

/**
 * The record that a plant of one of a species' forms grows from: the species' record with the
 * form's changes merged in, and without the forms themselves. With no form named, the record as it
 * stands, without its forms.
 *
 * @param record The species record.
 * @param form The name of one of the record's forms, such as `young`.
 * @returns The record the form grows from.
 * @category api/vegetation
 */
export function formRecord(record: Species, form?: string): Species {
	const changes: SpeciesForm | undefined =
		form === undefined || !record.forms || !Object.hasOwn(record.forms, form)
			? undefined
			: record.forms[form];
	if (form !== undefined && !changes) {
		const names = Object.keys(record.forms ?? {});
		throw new Error(
			`@null3d/vegetation: the species '${record.id}' has no form '${form}'. ${
				names.length > 0
					? `Ask for one of its forms: ${names.join(', ')}.`
					: 'It has no other forms: leave the form out.'
			}`,
		);
	}
	if (!record.forms) return record;
	const { forms: _forms, ...own } = record;
	return (changes ? merged(own, changes) : own) as Species;
}
