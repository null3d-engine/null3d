// A species' review data: its habit, and the pictures set aside or read without an outline.
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pictureRulings, reviewDataOf, reviewDataOfSpecies, standReason } from './review-data.ts';

const SLOTS = join(import.meta.dir, 'slots');

describe("a species' review data", () => {
	test('names the habit and each picture set aside, beside the slot queries', () => {
		const data = reviewDataOf({
			'01-whole-distant.png': { fov: 30 },
			_habit: 'clump',
			_pictures: {
				'33-mature-dense-crown-whole.png': {
					standing: 'second-form',
					reason: 'the old tree',
					ruling: 'the owner ruled it a second form',
				},
				'01-whole-distant.png': {
					outline: 'the far bank joins the outline',
					ruling: 'the lead ruled the outline void',
				},
			},
		});
		expect(data.habit).toBe('clump');
		expect(Object.keys(data.pictures)).toEqual([
			'33-mature-dense-crown-whole.png',
			'01-whole-distant.png',
		]);
		expect(reviewDataOf({ '01-whole-distant.png': { fov: 30 } })).toEqual({ pictures: {} });
		// Each picture a ruling takes out is listed with what the ruling does and who made it.
		expect(pictureRulings(data)).toEqual([
			{
				picture: '01-whole-distant.png',
				effect: 'outline-void',
				reason: 'the far bank joins the outline',
				ruling: 'the lead ruled the outline void',
			},
			{
				picture: '33-mature-dense-crown-whole.png',
				effect: 'second-form',
				reason: 'the old tree',
				ruling: 'the owner ruled it a second form',
			},
		]);
	});

	test('refuses a habit it does not know, and a picture set aside with no reason', () => {
		expect(() => reviewDataOf({ _habit: 'vine' })).toThrow('give "clump" or "mound"');
		expect(() => reviewDataOf({ _pictures: { '03-x.png': { standing: 'stand' } } })).toThrow(
			'with no reason',
		);
		expect(() =>
			reviewDataOf({ _pictures: { '03-x.png': { standing: 'odd', reason: 'r' } } }),
		).toThrow('give one of second-form, reference-limit, stand');
		expect(() => reviewDataOf({ _pictures: { '03-x.png': {} } })).toThrow('says nothing of it');
		// A picture leaves its rows only by a ruling that the entry cites.
		expect(() =>
			reviewDataOf({ _pictures: { '03-x.png': { standing: 'stand', reason: 'many stalks' } } }),
		).toThrow('cites no ruling');
	});

	test('says why a stand is not judged, with its size where the slot states one', () => {
		expect(
			standReason({ standing: 'stand', reason: 'stalks all round', count: 12, spacing: 0.5 }),
		).toBe(
			'the photograph shows a stand of about 12 plants 0.5 m apart, which the page cannot plant yet: stalks all round',
		);
	});

	test('reads every species slot file in the repository without a fault', () => {
		for (const file of readdirSync(SLOTS).filter((name) => name.endsWith('.json')))
			expect(() => reviewDataOf(JSON.parse(readFileSync(join(SLOTS, file), 'utf8')))).not.toThrow();
		// A species with no slot file has no review data, and that is no fault.
		expect(reviewDataOfSpecies(SLOTS, 'no-such-species')).toEqual({ pictures: {} });
		expect(reviewDataOfSpecies(SLOTS, 'holm-oak').habit).toBe('clump');
	});
});
