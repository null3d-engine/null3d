// The WebGL2 texture-unit allocator on a real device: a fragment shader that declares one texture
// more than the engine hands a stage gets E1209, not the plain link error that the driver would
// give. The page builds the program by hand, so the count comes from the device rather than from a
// list in the test.
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

interface ProgramUnitsResult {
	error?: string;
	/** The units that the device reports for each stage. */
	device: { vertex: number; fragment: number };
	/** The units that the engine hands each stage, keeping the context's last unit for uploads. */
	units: readonly [number, number];
	declared: number;
	counted: number;
	/** Whether the driver linked the over-limit program by itself. */
	driverLinked: boolean;
	code: string | null;
	message: string | null;
}

test('a stage past the device’s texture units gets E1209 before the link result', async ({
	page,
}) => {
	await page.goto('program-units.html');
	const result = await pageResult<ProgramUnitsResult>(page, 30_000);
	expect(result.error).toBeUndefined();
	// WebGL2 gives every stage at least 16 units, and a device may give more.
	expect(result.device.fragment).toBeGreaterThanOrEqual(16);
	expect(result.units[1]).toBeLessThanOrEqual(result.device.fragment);
	expect(result.units[1]).toBeGreaterThanOrEqual(16);
	expect(result.declared).toBe(result.units[1] + 1);
	expect(result.counted).toBe(result.declared);
	// Most devices fail to link more samplers than a stage has units, so the engine's count must
	// have run first. A software device can report more units than the engine hands out, and then
	// link the program by itself. The engine still owes the same error, so the code and the count
	// in its message decide the test, not the link result.
	expect(result.code).toBe('E1209');
	expect(result.message).toContain(
		`reads ${result.declared} textures in its fragment stage, and a stage has ${result.units[1]} units`,
	);
});
