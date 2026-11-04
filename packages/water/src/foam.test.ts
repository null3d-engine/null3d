// The foam map: how near each point lies to something that breaks the water, with a trail that the
// current carries downstream.
import { describe, expect, it } from 'bun:test';
import type { SketchContext, Texture } from '@null3d/engine';
import { foamMap } from './foam';

/** A sketch context that keeps the texels of the last texture made, and nothing else. */
function fakeContext(): {
	ctx: SketchContext;
	texels: () => { width: number; height: number; data: Uint8Array<ArrayBuffer> };
} {
	let last: { width: number; height: number; data: Uint8Array<ArrayBuffer> } = {
		width: 0,
		height: 0,
		data: new Uint8Array(0),
	};
	const ctx = {
		textures: {
			fromData(options: { width: number; height: number; data: Uint8Array<ArrayBuffer> }) {
				last = options;
				return { fake: true } as unknown as Texture;
			},
		},
	} as unknown as SketchContext;
	return { ctx, texels: () => last };
}

describe('the foam map', () => {
	/** A stone of radius 0.3 at (1, 0), on a map 4 m across at 0.1 m texels. */
	const stone = { x: 1, z: 0, r: 0.3 };
	const options = { origin: [-1, -2] as const, size: [4, 4] as const, width: 40, height: 40 };
	const read = (data: Uint8Array, x: number, z: number): number => {
		const i = Math.round((x + 1) / 0.1);
		const j = Math.round((z + 2) / 0.1);
		return (data[(j * 40 + i) * 4] as number) / 255;
	};

	it('marks the foam at the stone’s edge and not in open water', () => {
		const { ctx, texels } = fakeContext();
		foamMap(ctx, [stone], options);
		const { data } = texels();
		expect(read(data, 1.3, 0)).toBeGreaterThan(0.9);
		expect(read(data, 1, 1.5)).toBe(0);
		expect(read(data, -0.5, 0)).toBe(0);
	});

	it('stretches the foam downstream, behind the stone', () => {
		const { ctx, texels } = fakeContext();
		foamMap(ctx, [stone], options);
		const { data } = texels();
		// Upstream, the foam stops at the stone's edge; downstream it trails and fades.
		expect(read(data, 2.6, 0)).toBeGreaterThan(0);
		expect(read(data, 2.6, 0)).toBeLessThan(read(data, 1.3, 0));
		expect(read(data, 0.2, 0)).toBe(0);
	});

	it('takes the area and the texels that the options give', () => {
		const { ctx, texels } = fakeContext();
		const map = foamMap(ctx, [], { ...options, width: 32, height: 16 });
		expect(texels().width).toBe(32);
		expect(texels().height).toBe(16);
		expect(map.origin).toEqual([-1, -2]);
		expect(map.size).toEqual([4, 4]);
	});
});
