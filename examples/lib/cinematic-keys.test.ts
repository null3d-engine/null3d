// One key does one thing in a showcase scene. The cinematic camera owns the key table: the camera's
// keys, the controls' keys and any key that a scene adds, and a clash throws. No showcase scene reads
// a key outside the table, so a scene cannot give a camera key a second job, as a lens key on D once
// did while D also panned the Manual camera.
import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { keyTable, SHOWCASE_KEYS } from './cinematic';

const SHOWCASE = join(import.meta.dir, '..', 'showcase');

test('the shared key table takes each key once', () => {
	const codes = keyTable().map((key) => key.code);
	expect(new Set(codes).size).toBe(codes.length);
});

test('a scene key that the camera or the controls already take throws', () => {
	for (const { code } of SHOWCASE_KEYS)
		expect(() => keyTable([{ code, does: 'toggle the lens' }])).toThrow(code);
});

test('two scene keys on one key throw, and a free key joins the table', () => {
	const lens = { code: 'KeyL', does: 'toggle the lens' };
	expect(() => keyTable([lens, { code: 'KeyL', does: 'toggle the snow' }])).toThrow('KeyL');
	expect(keyTable([lens]).at(-1)).toEqual(lens);
});

test("a driven scene's keys take the Manual camera's place, and keep their own clashes", () => {
	const drive = [
		{ code: 'KeyW', does: 'speed the car up' },
		{ code: 'KeyV', does: 'switch the view' },
	];
	const table = keyTable([], drive);
	expect(table.map((key) => key.does)).toContain('speed the car up');
	expect(table.map((key) => key.does)).not.toContain('pan the Manual camera forward');
	expect(table.map((key) => key.code)).toContain('KeyC');
	expect(table.map((key) => key.code)).toContain('KeyH');
	expect(() => keyTable([{ code: 'KeyV', does: 'toggle the lens' }], drive)).toThrow('KeyV');
});

test('no showcase scene reads a key outside the table', () => {
	const reads: string[] = [];
	for (const file of readdirSync(SHOWCASE, { recursive: true, encoding: 'utf8' })) {
		if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
		const source = readFileSync(join(SHOWCASE, file), 'utf8');
		if (/\.(isDown|wasPressed|wasReleased)\s*\(/.test(source)) reads.push(file);
	}
	expect(reads).toEqual([]);
});
