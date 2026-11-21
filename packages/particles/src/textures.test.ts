// The particle textures made in code: the soft ones fade to nothing at every frame's edge, so a
// particle's square never shows its straight sides.
import { describe, expect, it } from 'bun:test';
import { particleTextures } from './textures';

/** The texels that a texture's maker writes, and its frames across and down. */
function texelsOf(name: 'glow' | 'smoke' | 'flame' | 'spark' | 'rain') {
	let made: { width: number; height: number; data: Uint8Array } | undefined;
	const textures = {
		fromData(data: { width: number; height: number; data: Uint8Array }) {
			made = data;
			return {};
		},
	};
	const texture = particleTextures[name](textures as never);
	return { ...(made as { width: number; height: number; data: Uint8Array }), ...texture.flipbook };
}

/** The largest alpha, from 0 to 255, on the texels round the edge of any of a texture's frames. */
function borderAlpha(name: 'glow' | 'smoke' | 'flame' | 'spark' | 'rain'): number {
	const { width, height, data, columns, rows } = texelsOf(name);
	const across = width / columns;
	const down = height / rows;
	let most = 0;
	for (let row = 0; row < rows; row++)
		for (let column = 0; column < columns; column++)
			for (let y = 0; y < down; y++)
				for (let x = 0; x < across; x++) {
					if (x > 0 && y > 0 && x < across - 1 && y < down - 1) continue;
					const at = ((row * down + y) * width + column * across + x) * 4 + 3;
					most = Math.max(most, data[at] as number);
				}
	return most;
}

describe('the particle textures', () => {
	it('fade to nothing at the edge of every frame of the soft ones', () => {
		for (const name of ['glow', 'smoke', 'flame', 'spark', 'rain'] as const)
			expect(borderAlpha(name)).toBeLessThanOrEqual(5);
	});
});
