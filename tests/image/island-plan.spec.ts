// The island's stored plan: a browser builds the same roads, houses, trees and ground as the plan
// tests pass, to the millimeter, so the plan that the tests hold is the plan that the viewer sees.
import { expect, test } from '@playwright/test';

test('the browser builds the plan that the tests pass', async ({ page }) => {
	await page.goto('/tests/pages/image.html');
	const { found, named } = await page.evaluate(async () => {
		const plan = await import('/examples/showcase/island/plan.ts' as string);
		return { found: plan.planFingerprint() as number, named: plan.PLAN_FINGERPRINT as number };
	});
	expect(found).toBe(named);
});
