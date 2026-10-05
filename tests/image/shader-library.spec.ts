// Every function of the shader library, run on the GPU on each GPU path, gives the values of its
// TypeScript reference.
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';
import { allCases, FUNCTIONS, type Mismatch } from '../pages/lib/shader-library-cases.ts';

interface LibraryResult {
	ok: boolean;
	error?: string;
	tier: string;
	functions: number;
	cases: number;
	failures: string[];
	deviceFault?: string;
	shaderFault?: string;
	precisionFault?: string;
	mismatches: Mismatch[];
}

for (const tier of ['webgpu', 'compat', 'webgl2'] as const) {
	test(`every shader library function gives its reference values on ${tier}`, async ({ page }) => {
		await page.goto(`shader-library.html?gpu=${tier}`);
		const result = await pageResult<LibraryResult>(page, 30_000);
		expect(result.error).toBeUndefined();
		expect(result.tier).toBe(tier);
		expect(result.functions).toBe(FUNCTIONS.length);
		expect(result.cases).toBe(allCases().length);
		expect(result.failures).toEqual([]);
		expect(result.deviceFault).toBeUndefined();
		expect(result.shaderFault).toBeUndefined();
		expect(result.precisionFault).toBeUndefined();
		expect(result.mismatches).toEqual([]);
	});
}
