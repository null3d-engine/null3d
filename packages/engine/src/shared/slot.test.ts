// Every name in the slot table takes a number of its own: two names on one number is a fault that
// survives until a thread reads the wrong one. The control buffer holds one value per slot, up to
// the slot count, so the count must also cover the highest number in the table.
import { describe, expect, it } from 'bun:test';
import { SLOT_COUNT } from './control';
import * as Slot from './slot';

describe('the control block slots', () => {
	it('gives every slot a number of its own', () => {
		const owner = new Map<number, string>();
		const shared: string[] = [];
		for (const [name, number] of Object.entries(Slot)) {
			const first = owner.get(number);
			if (first === undefined) owner.set(number, name);
			else shared.push(`${name} and ${first} both take ${number}`);
		}
		expect(shared).toEqual([]);
	});

	it('numbers the slots from zero, with the count covering the highest', () => {
		const numbers = Object.values(Slot);
		expect(Math.min(...numbers)).toBe(0);
		expect(Math.max(...numbers)).toBe(SLOT_COUNT - 1);
	});
});
