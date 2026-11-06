// The stem's base: its buttress lobes round the section, and its surface roots, which lie half
// buried along the ground and end below it rather than tapering away in the surface.
import { describe, expect, it } from 'bun:test';
import type { BaseSpec } from '../core/record';
import { stemSection, surfaceRoots } from './flare';

const base: BaseSpec = {
	flare: { amount: 0.6, height: 0.35 },
	buttress: { amount: 0.5, lobes: 5, height: 1.2, sharpness: 2 },
	roots: { count: 5, length: { mean: 1.6, spread: 0.2 }, radius: 0.11, dive: 0.06 },
};

const feet = { x: 0, y: 0, z: 0, radius: 0.32 };

describe('the stem base', () => {
	it('gathers every root into the ground, with no part of its end left in the surface', () => {
		const section = stemSection(base, 11, 7, 0, 0);
		if (!section) throw new Error('no section');
		const roots = surfaceRoots(base, section, feet, [1, 0, 0], [0, 0, 1], 11, 7, 0, 0);
		expect(roots.length).toBeGreaterThan(0);
		for (const root of roots) {
			const n = root.radii.length;
			// The last rings stand wholly under the ground: their centre is deeper than their radius.
			for (const i of [n - 2, n - 1]) {
				const y = root.points[i * 3 + 1] as number;
				expect(y + (root.radii[i] as number)).toBeLessThan(0);
			}
			// And a ring on the way out lies half buried, so the root reads as a cord over the ground.
			let exposed = false;
			for (let i = 0; i < n - 2; i++) {
				const y = root.points[i * 3 + 1] as number;
				const r = root.radii[i] as number;
				if (y + r > 0 && y - r < 0) exposed = true;
			}
			expect(exposed).toBe(true);
		}
	});

	it('buries a root whatever dive the record asks for', () => {
		const spec = base.roots as NonNullable<BaseSpec['roots']>;
		const shallow: BaseSpec = { ...base, roots: { ...spec, dive: 0.001 } };
		const section = stemSection(shallow, 11, 7, 0, 0);
		if (!section) throw new Error('no section');
		const roots = surfaceRoots(shallow, section, feet, [1, 0, 0], [0, 0, 1], 11, 7, 0, 0);
		for (const root of roots) {
			const n = root.radii.length;
			const y = root.points[(n - 1) * 3 + 1] as number;
			expect(y + (root.radii[n - 1] as number)).toBeLessThan(0);
		}
	});
});
