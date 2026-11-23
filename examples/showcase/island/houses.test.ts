// The island's house models cover the town plan: every house kind has one form, the set holds no
// duplicate or stray form, the file that the script builds could carry every part that a house
// stands, and each lot lands on the stands of its own kind with its own place and turn.
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HOUSE_MODELS, HOUSE_PARTS, type HouseLot, partName, standsByKind } from './houses';
import { HOUSE_KINDS } from './kit';

describe('the island house models', () => {
	it('stand one form for every house kind, and no other', () => {
		const kinds = HOUSE_MODELS.map((model) => model.kind).sort((a, b) => a - b);
		expect(kinds).toEqual(HOUSE_KINDS.map((_, kind) => kind));
	});

	it('names each form once, in the form the script builds it', () => {
		const forms = HOUSE_MODELS.map((model) => model.form);
		expect(new Set(forms).size).toBe(forms.length);
		for (const form of forms) expect(form).toMatch(/^[a-z]+(-[a-z]+)*$/);
	});

	it('finds every form in the Blender script and the script holds no other', () => {
		const script = readFileSync(
			join(import.meta.dir, '../../../tools/samples/blender/island-houses.py'),
			'utf8',
		);
		const block = script.slice(script.indexOf('FORMS = ('), script.indexOf('\nclass Model'));
		const built = [...block.matchAll(/\('([a-z-]+)', house_/g)].map((found) => found[1] as string);
		expect(new Set(built)).toEqual(new Set(HOUSE_MODELS.map((model) => model.form)));
		expect(built.length).toBe(HOUSE_MODELS.length);
	});

	it('reads only the parts the script builds, and needs walls and roof from every form', () => {
		const script = readFileSync(
			join(import.meta.dir, '../../../tools/samples/blender/island-houses.py'),
			'utf8',
		);
		const built = new Set(
			[...script.matchAll(/model\.shape\('([a-z]+)'/g)].map((found) => found[1]),
		);
		for (const part of built) expect(HOUSE_PARTS as readonly string[]).toContain(part);
		// The loader keeps a form only when these two parts arrive, so the script must always build them.
		expect(built.has('walls')).toBe(true);
		expect(built.has('roof')).toBe(true);
		for (const { form } of HOUSE_MODELS) {
			expect(partName(form, 'walls')).toBe(`house-${form}-walls`);
			expect(partName(form, 'roof')).toBe(`house-${form}-roof`);
		}
	});

	it('places each lot on the stands of its own kind, with its own place and turn', () => {
		const lots: HouseLot[] = [
			{ x: 1, y: 2, z: 3, yaw: 0.5, kind: 0 },
			{ x: 4, y: 5, z: 6, yaw: -0.25, kind: 2 },
			{ x: 7, y: 8, z: 9, yaw: 1.5, kind: 0 },
			{ x: 10, y: 11, z: 12, yaw: 0, kind: 99 },
		];
		const stands = standsByKind(lots, 3);
		expect(stands.length).toBe(3);
		expect(stands[0]).toEqual([
			{ x: 1, y: 2, z: 3, yaw: 0.5, size: 1 },
			{ x: 7, y: 8, z: 9, yaw: 1.5, size: 1 },
		]);
		expect(stands[1]).toEqual([]);
		expect(stands[2]).toEqual([{ x: 4, y: 5, z: 6, yaw: -0.25, size: 1 }]);
	});
});
