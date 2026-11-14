// The WebGL2 texture-unit allocator, through the engine's public API: a page builds a lit material
// with six textures of its own and draws it. Its fragment stage reads twelve texture units, which a
// WebGL2 device promises at least sixteen of, so the page's context reports ten, as a reduced
// driver would. The engine must throw E1209 with both counts, and the device's own count must show
// that its hardware had room for the shader. A unit test holds that the count runs before the link
// result.
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

interface ProgramUnitsResult {
	error?: string;
	/** The units that the device reports when the page asks it directly. */
	real: { vertex: number; fragment: number };
	/** The units that the page's context reports to the engine. */
	reported: { vertex: number; fragment: number };
	code: string | null;
	message: string | null;
}

/** The texture units that the material's fragment stage reads: six of the engine's lighting, six of its own. */
const MATERIAL_UNITS = 12;
/** The fragment units that the page's context reports. */
const REPORTED_UNITS = 10;

test('a material past the units that its device reports gets E1209 with both counts', async ({
	page,
}) => {
	// The first load of the page builds the sketch's material and the engine's modules.
	test.setTimeout(120_000);
	await page.goto('program-units.html?gpu=webgl2&render=main');
	const result = await pageResult<ProgramUnitsResult>(page, 90_000);
	expect(result.error).toBeUndefined();
	// A WebGL2 device gives every stage at least sixteen units, so its hardware has room for the shader.
	expect(result.real.fragment).toBeGreaterThanOrEqual(16);
	expect(MATERIAL_UNITS).toBeLessThanOrEqual(result.real.fragment);
	// The context reports fewer units than the material's stage reads, and fewer than it has.
	expect(result.reported.fragment).toBe(REPORTED_UNITS);
	expect(result.reported.fragment).toBeLessThan(result.real.fragment);
	// The engine refuses the material with the count of its own shader and the device's number.
	expect(result.code).toBe('E1209');
	expect(result.message).toContain(
		`reads ${MATERIAL_UNITS} textures in its fragment stage, and a stage has ${REPORTED_UNITS} units`,
	);
});
