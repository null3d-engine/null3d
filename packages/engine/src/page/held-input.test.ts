import { describe, expect, it } from 'bun:test';
import { HeldInput, isEditableTarget } from './held-input';

describe('HeldInput', () => {
	it('releases every held pointer at its last position, then every held key', () => {
		const held = new HeldInput();
		held.pointerDown(1, 10, 20, 0);
		held.pointerMove(1, 30, 40);
		held.pointerDown(2, 5, 5, 2);
		held.keyDown(87);
		held.keyDown(16);
		const released: string[] = [];
		held.releaseAll(
			(id, x, y, button) => released.push(`pointer ${id} at ${x},${y} button ${button}`),
			(code) => released.push(`key ${code}`),
		);
		expect(released).toEqual([
			'pointer 1 at 30,40 button 0',
			'pointer 2 at 5,5 button 2',
			'key 87',
			'key 16',
		]);
		held.releaseAll(
			() => released.push('again'),
			() => released.push('again'),
		);
		expect(released).not.toContain('again');
	});

	it('says whether a key or pointer was down when it goes up', () => {
		const held = new HeldInput();
		held.keyDown(65);
		expect(held.keyUp(65)).toBe(true);
		expect(held.keyUp(65)).toBe(false);
		held.pointerDown(3, 0, 0, 0);
		expect(held.pointerUp(3)).toBe(true);
		expect(held.pointerUp(4)).toBe(false);
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
