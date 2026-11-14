// The pedunculate oak's shipped textures load on every GPU path: WebGPU, its compatibility mode and
// WebGL2. Each file of both sets becomes a texture of its own size and layers, with the leaf relief
// an array of one layer that a texture-array slot takes, and a custom material that binds all six
// draws each texture's own texels: green leaves, a paler lower face, bluish relief maps, grey bark
// and olive young bark, with no strip left white, which a texture that never arrived would draw.
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

/** A strip's mean 8-bit colour. */
type Rgb = readonly [number, number, number];

/** The eight strips of a plane, left to right. */
type Strips = readonly [Rgb, Rgb, Rgb, Rgb, Rgb, Rgb, Rgb, Rgb];

/** What the page reports. */
interface PlantTexturesResult {
	readonly error?: string;
	readonly recorded: {
		readonly textures: readonly {
			readonly set: 'full' | 'half';
			readonly name: string;
			readonly size: readonly [number, number, number];
			readonly format: string;
		}[];
		readonly manifest: { readonly species: string; readonly outputs: number };
	};
	/** Mean 8-bit colour of each strip of the full and the half plane. */
	readonly strips: readonly (readonly Rgb[])[];
}

/** Texels a side and layers of each file of the full set; the half set takes half the size. */
const EXPECTED: Record<string, readonly [number, number]> = {
	leafColor: [1024, 2],
	leafNormal: [1024, 1],
	barkColor: [1024, 1],
	barkNormal: [1024, 1],
	youngColor: [512, 1],
	youngNormal: [512, 1],
};

for (const gpu of ['webgpu', 'compat', 'webgl2'] as const)
	test(`the oak's textures load and draw on ${gpu}`, async ({ page }) => {
		await page.goto(`plant-textures.html?gpu=${gpu}`);
		const result = await pageResult<PlantTexturesResult>(page, 120_000);
		expect(result.error).toBeUndefined();
		const { textures, manifest } = result.recorded;
		expect(manifest).toEqual({ species: 'pedunculate-oak', outputs: 12 });
		expect(textures).toHaveLength(12);
		for (const texture of textures) {
			const [side, layers] = EXPECTED[texture.name] as readonly [number, number];
			const size = texture.set === 'full' ? side : side / 2;
			expect(texture.size, `${texture.set} ${texture.name}`).toEqual([size, size, layers]);
		}
		for (const [plane, strips] of result.strips.entries()) {
			expect(strips).toHaveLength(8);
			const [upper, lower, relief, bark, barkRelief, young, youngRelief, coverage] =
				strips as Strips;
			const where = `${plane === 0 ? 'full' : 'half'} set`;
			const notWhite = (c: readonly number[]) => Math.min(...c) < 230;
			for (const strip of strips)
				expect(notWhite(strip), `${where}: a strip draws white`).toBe(true);
			// Leaf faces: green over red and blue; the lower face paler than the upper.
			for (const face of [upper, lower]) {
				expect(face[1], `${where}: a leaf face`).toBeGreaterThan(face[0]);
				expect(face[1], `${where}: a leaf face`).toBeGreaterThan(face[2]);
			}
			const sum = (c: readonly number[]) => c[0]! + c[1]! + c[2]!;
			expect(sum(lower), `${where}: the lower face`).toBeGreaterThan(sum(upper));
			// Relief maps face out of the surface: blue over red and green.
			for (const normal of [relief, barkRelief, youngRelief]) {
				expect(normal[2], `${where}: a relief map`).toBeGreaterThan(normal[0]);
				expect(normal[2], `${where}: a relief map`).toBeGreaterThan(normal[1]);
			}
			// Bark is near grey; young bark is olive, its red and green above its blue.
			expect(Math.max(...bark) - Math.min(...bark), `${where}: the bark`).toBeLessThan(40);
			expect(Math.min(young[0], young[1]), `${where}: the young bark`).toBeGreaterThan(young[2]);
			// The middle of the leaf is fully covered.
			expect(coverage[0], `${where}: the leaf's coverage`).toBeGreaterThan(150);
		}
	});
