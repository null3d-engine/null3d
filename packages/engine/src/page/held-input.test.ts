import { describe, expect, it } from 'bun:test';
import { FLAG_PRIMARY, FLAG_TOUCH } from '../shared/control';
import { HeldInput, isEditableTarget } from './held-input';

const TOUCH = FLAG_TOUCH | FLAG_PRIMARY;

describe('HeldInput', () => {
	it('releases every held pointer at its last position with its kind, then every held key', () => {
		const held = new HeldInput();
		held.pointerDown(1, 10, 20, 0, FLAG_PRIMARY);
		held.pointerMove(1, 30, 40);
		held.pointerDown(2, 5, 5, 0, TOUCH);
		held.keyDown(87);
		held.keyDown(16);
		const released: string[] = [];
		held.releaseAll(
			(id, x, y, button, flags) =>
				released.push(`pointer ${id} at ${x},${y} button ${button} flags ${flags}`),
			(key) => released.push(`key ${key}`),
		);
		expect(released).toEqual([
			`pointer 1 at 30,40 button 0 flags ${FLAG_PRIMARY}`,
			`pointer 2 at 5,5 button 0 flags ${TOUCH}`,
			'key 87',
			'key 16',
		]);
		held.releaseAll(
			() => released.push('again'),
			() => released.push('again'),
		);
		expect(released).not.toContain('again');
	});

	it('says whether a key was up before it went down, so a repeat is not a new press', () => {
		const held = new HeldInput();
		expect(held.keyDown(65)).toBe(true);
		expect(held.keyDown(65)).toBe(false);
		expect(held.keyUp(65)).toBe(true);
		expect(held.keyUp(65)).toBe(false);
		held.pointerDown(3, 0, 0, 0, 0);
		expect(held.pointerUp(3)).toBe(true);
		expect(held.pointerUp(4)).toBe(false);
	});

	it('releases the keys alone and keeps the pointers', () => {
		const held = new HeldInput();
		held.keyDown(1);
		held.keyDown(2);
		held.pointerDown(7, 0, 0, 0, 0);
		const keys: number[] = [];
		held.releaseKeys((key) => keys.push(key));
		expect(keys).toEqual([1, 2]);
		expect(held.keyDown(1)).toBe(true);
		expect(held.pointerUp(7)).toBe(true);
	});
});

describe('isEditableTarget', () => {
	it('finds form fields and editable content, and nothing else', () => {
		for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT'])
			expect(isEditableTarget({ tagName })).toBe(true);
		expect(isEditableTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
		expect(isEditableTarget({ tagName: 'CANVAS' })).toBe(false);
		expect(isEditableTarget(null)).toBe(false);
	});
});
