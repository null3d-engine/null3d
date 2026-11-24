// The island's prop models cover its harbour and beach: the loader reads exactly the forms and
// parts that the Blender script builds, the boats and boulders carry the lower levels of detail
// while the small props do not, and each parasol's loungers land at its own places and turn.
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	LEVELED_FORMS,
	LOUNGER_OFFSETS,
	loungerStands,
	PROP_FORMS,
	PROPS_MODEL,
	type PropForm,
	ROCK_FORMS,
	standsOf,
} from './props';

interface Row {
	readonly form: string;
	readonly parts: readonly string[];
	readonly leveled: boolean;
}

/** The forms and parts that the Blender script declares, read from its `FORMS` table. */
function scriptRows(): Row[] {
	const script = readFileSync(
		join(import.meta.dir, '../../../tools/samples/blender/island-props.py'),
		'utf8',
	);
	const block = script.slice(script.indexOf('FORMS = ('), script.indexOf('class Model'));
	return [...block.matchAll(/\('([a-z-]+)', [a-z_]+, \(([^)]*)\), (True|False)\)/g)].map(
		(found) => ({
			form: found[1] as string,
			parts: [...(found[2] as string).matchAll(/'([a-z]+)'/g)].map((p) => p[1] as string),
			leveled: found[3] === 'True',
		}),
	);
}

describe('the island prop models', () => {
	it('builds one form for every form the loader reads, and no other', () => {
		const rows = scriptRows();
		expect(rows.map((row) => row.form)).toEqual(Object.keys(PROP_FORMS));
		expect(new Set(rows.map((row) => row.form)).size).toBe(rows.length);
	});

	it('names each part as the loader reads it', () => {
		for (const row of scriptRows())
			expect(row.parts).toEqual([...PROP_FORMS[row.form as PropForm]]);
	});

	it('levels the boats and the boulders, and leaves the small props whole', () => {
		const leveled = scriptRows()
			.filter((row) => row.leveled)
			.map((row) => row.form);
		expect(leveled).toEqual([...LEVELED_FORMS]);
		for (const form of LEVELED_FORMS) expect(form).toMatch(/^(yacht|skiff|rock-)/);
	});

	it('carries the three boulder forms', () => {
		const rocks = scriptRows()
			.filter((row) => row.form.startsWith('rock-'))
			.map((row) => row.form);
		expect(rocks).toEqual([...ROCK_FORMS]);
	});

	it('loads the file that the sample repository publishes', () => {
		expect(PROPS_MODEL.endsWith('/sources/showcase/island-props/props.glb')).toBe(true);
	});

	it('places two loungers at each parasol, turned with it', () => {
		const spots = [
			{ x: 10, y: 0.5, z: 20, yaw: 0 },
			{ x: -4, y: 1, z: 8, yaw: Math.PI / 2 },
		];
		const stands = loungerStands(spots);
		expect(stands.length).toBe(spots.length * LOUNGER_OFFSETS.length);
		const [near, far] = stands as [(typeof stands)[number], (typeof stands)[number]];
		expect(near).toEqual({ x: 9.1, y: 0.5, z: 19, yaw: 0, size: 1 });
		expect(far.z).toBeCloseTo(20.45, 6);
		const [turned, turnedBack] = stands.slice(2) as [
			(typeof stands)[number],
			(typeof stands)[number],
		];
		expect(turned.x).toBeCloseTo(-5, 6);
		expect(turned.z).toBeCloseTo(8.9, 6);
		expect(turnedBack.x).toBeCloseTo(-3.55, 6);
		expect(turnedBack.z).toBeCloseTo(8.9, 6);
		expect(stands[0]?.yaw).toBe(0);
		expect(stands[1]?.yaw).toBe(0);
		expect(stands[2]?.yaw).toBeCloseTo(Math.PI / 2, 6);
		expect(stands[3]?.yaw).toBeCloseTo(Math.PI / 2, 6);
	});

	it('reads a code-built batch as stands, with its turn, scale and tint', () => {
		const yaw = 0.8;
		const stands = standsOf({
			count: 2,
			positions: new Float32Array([1, 2, 3, -4, 5, 6]),
			rotations: new Float32Array([0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2), 0, 0, 0, 1]),
			scales: new Float32Array([2, 0.5, 3, 1, 1, 1]),
			colors: new Float32Array([0.2, 0.4, 0.6, 1, 1, 1, 1, 1]),
		});
		expect(stands.length).toBe(2);
		expect(stands[0]?.x).toBe(1);
		expect(stands[0]?.y).toBe(2);
		expect(stands[0]?.z).toBe(3);
		expect(stands[0]?.yaw).toBeCloseTo(yaw, 6);
		expect(stands[0]?.scale).toEqual([2, 0.5, 3]);
		const tint = stands[0]?.color ?? [];
		[0.2, 0.4, 0.6, 1].forEach((value, k) => {
			expect(tint[k]).toBeCloseTo(value, 5);
		});
		expect(stands[1]?.x).toBe(-4);
		expect(stands[1]?.yaw).toBeCloseTo(0, 6);
		expect(stands[1]?.color).toEqual([1, 1, 1, 1]);
		expect(
			standsOf({
				count: 1,
				positions: new Float32Array([0, 0, 0]),
				rotations: new Float32Array([0, 0, 0, 1]),
				scales: new Float32Array([1, 1, 1]),
				colors: undefined,
			})[0]?.color,
		).toBeUndefined();
	});
});
