// A species' other forms: the record each grows from, and the record check of each form.
import { describe, expect, it } from 'bun:test';
import { record as template } from '../species/_template/record';
import { speciesProblems } from './check';
import { formRecord } from './forms';
import type { Species, SpeciesForm } from './record';

/** The template with a young form that changes a little of each kind of field. */
const young: SpeciesForm = {
	form: 'a young template plant',
	// An object's own fields change one by one: the mean changes, the spread stays.
	size: { height: { mean: 3 }, dbh: null },
	// A number, a curve and a list replace the record's whole value.
	growth: {
		years: 5,
		buds: {
			angle: [
				[0, 30],
				[1, 40],
			],
		},
	},
	envelope: { heights: [0.2, 0.6, 1], radii: [0.1, 0.2, 0] },
	extras: null,
};
const withForms: Species = { ...template, forms: { young } };

describe("a species' other forms", () => {
	it('grow the record as it stands when no form is asked for, without the forms', () => {
		expect(formRecord(template)).toBe(template);
		const own = formRecord(withForms);
		expect('forms' in own).toBe(false);
		expect(JSON.stringify(own)).toBe(JSON.stringify(template));
	});

	it("merge a form's changes into the record: objects by field, the rest whole, null drops", () => {
		const grown = formRecord(withForms, 'young');
		expect('forms' in grown).toBe(false);
		expect(grown.form).toBe('a young template plant');
		expect(grown.size.height).toEqual({ mean: 3, spread: 1 });
		expect('dbh' in grown.size).toBe(false);
		expect(grown.size.aspect).toBe(template.size.aspect);
		expect(grown.growth.model).toBe('self-organizing');
		if (grown.growth.model !== 'self-organizing' || template.growth.model !== 'self-organizing')
			throw new Error('the template grows by the self-organizing model');
		expect(grown.growth.years).toBe(5);
		expect(grown.growth.buds.angle).toEqual([
			[0, 30],
			[1, 40],
		]);
		expect(grown.growth.buds.extinction).toEqual(template.growth.buds.extinction);
		if (grown.envelope?.kind !== 'radial' || template.envelope?.kind !== 'radial')
			throw new Error('the template and its young form fill a radial envelope');
		expect(grown.envelope.heights).toEqual([0.2, 0.6, 1]);
		expect(grown.envelope.source).toEqual(template.envelope.source);
		// The record a form merges into stays as it was.
		expect(template.size.dbh).toBe(0.25);
		expect(speciesProblems(withForms)).toEqual([]);
	});

	it("merge a form given as plain data without reaching any object's prototype", () => {
		const form = JSON.parse('{"form": "a plain-data form", "size": {"__proto__": {"aspect": 9}}}');
		const grown = formRecord({ ...template, forms: { plain: form } }, 'plain');
		expect(grown.size.aspect).toBe(template.size.aspect);
		expect(Object.getPrototypeOf(grown.size)).toBe(Object.prototype);
		expect(({} as { aspect?: number }).aspect).toBeUndefined();
	});

	it('name the forms a record has when one it lacks is asked for', () => {
		expect(() => formRecord(withForms, 'woodland')).toThrow(/no form 'woodland'.*young/);
		expect(() => formRecord(template, 'young')).toThrow(/no other forms/);
		// A name that every object carries is not a form.
		expect(() => formRecord(withForms, 'toString')).toThrow(/no form 'toString'/);
	});

	it('are checked as the records they grow from, each problem naming its form', () => {
		const broken = {
			...template,
			forms: {
				tall: { form: 'a tall plant', size: { height: { mean: 1, spread: 2 } } },
				'Old Tree': { form: 'an old plant' },
				renamed: { form: 'a renamed plant', variants: 2 },
				palm: { form: 'a palm', growth: { model: 'crown-rosette' } },
				stemless: { form: 'a plant with no growth', growth: null },
			},
		} as unknown as Species;
		const problems = speciesProblems(broken);
		expect(problems).toContain('forms.tall: size.height can draw -1; it must stay above 0');
		expect(problems.some((p) => p.startsWith("forms.Old Tree: a form's name"))).toBe(true);
		expect(problems.some((p) => p.startsWith('forms.renamed.variants is not a field'))).toBe(true);
		expect(problems.some((p) => p.startsWith("forms.palm.growth.model is 'crown-rosette'"))).toBe(
			true,
		);
		expect(problems.some((p) => p.startsWith('forms.stemless makes a record that cannot'))).toBe(
			true,
		);
	});
});
