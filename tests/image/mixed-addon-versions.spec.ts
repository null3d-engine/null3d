// A page that imports two versions of one foundation add-on stops at the import with E1432. The
// unit test checks the message the function writes; this test checks what a page meets, where the
// add-on's own module runs the check as it loads, and that nothing draws past it.
import { expect, test } from '@playwright/test';
import { VERSION } from '../../packages/engine/src/shared/version.ts';

test('two versions of one add-on stop the page with E1432', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.goto('mixed-addon-versions.html');
	await expect.poll(() => errors.length, { timeout: 60_000 }).toBeGreaterThan(0);
	const message = errors[0] as string;
	// The message names the add-on, the engine version it was built for and the page's version.
	// The fix that the code carries is not here: an error raised as a module loads is the thread's
	// first, so the engine has not downloaded the file of fixes yet, and the text arrives after the
	// browser has reported the error. The unit test holds that text, with the table installed.
	expect(message).toContain(
		`E1432: @null3d/impostors 0.1.0 was built for null3D 0.1.0, and this page runs null3D ${VERSION}.`,
	);
	expect(await page.locator('#status').textContent()).toBe('running');
});
