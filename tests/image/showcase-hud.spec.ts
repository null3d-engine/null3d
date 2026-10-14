// The showcase controls HUD names every change in a toast at the top centre of the view. Playwright
// opens the night town's HUD, picks a button in each group, and checks the toast's text
// ([D-171](../../.dev/decisions/D-171-showcase-controls-hud.md), owner, 14 October 2026).
import { expect, type Page, test } from '@playwright/test';
import { watchPageProblems } from '../lib/page-result.ts';

/** The panel of a group, by the group's name in the model. */
const panel = (page: Page, name: string) => page.locator(`#hud-panel-${name}`);
/** The six picks, the startup and the slow software GPU need longer than the default limit. */
test.describe.configure({ timeout: 180_000 });

/**
 * Picks a button of a group and checks the toast that names the change: selects the group's tab,
 * then clicks the button, and reads the toast.
 */
async function pick(
	page: Page,
	tab: string,
	group: string,
	button: string,
	text: string,
): Promise<void> {
	await page.getByRole('tab', { name: tab }).click();
	await panel(page, group).getByRole('button', { name: button }).click();
	// A frame on the software GPU can take a while, and the toast shows for 2 s, so allow for it.
	const toast = page.locator('.hud__toast');
	await expect(toast).toHaveClass(/\bshow\b/, { timeout: 20_000 });
	await expect(toast).toHaveText(text, { timeout: 20_000 });
}

test('the showcase HUD names each group change in a toast at the top centre', async ({ page }) => {
	const errors = watchPageProblems(page);
	// A fresh page, the light preset, so CI's software GPU draws it quickly. The demo builds its
	// own look from code, so the toast text does not depend on the preset.
	await page.goto('/examples/index.html?demo=night-town&preset=low');
	const hud = page.locator('.hud');
	// The sketch posts the HUD once its setup has run, which loads nothing but builds the town.
	await expect(hud).toBeVisible({ timeout: 90_000 });
	await expect(page.getByRole('tab', { name: 'Post' })).toBeVisible();
	// Open the panel, as a visitor does, with the chevron.
	await page.locator('.hud__chevron').click();
	await expect(hud).toHaveClass(/\bopen\b/);

	// Camera is a radio group: a pick names the group and the new mode.
	await pick(page, 'Camera', 'camera', 'Manual', 'camera: manual');
	// The toast sits at the top centre of the stage, where the scene draws.
	const stage = await page.locator('main.stage').boundingBox();
	const toast = await page.locator('.hud__toast').boundingBox();
	expect(stage).not.toBeNull();
	expect(toast).not.toBeNull();
	expect(
		Math.abs(
			(toast?.x ?? 0) + (toast?.width ?? 0) / 2 - ((stage?.x ?? 0) + (stage?.width ?? 0) / 2),
		),
	).toBeLessThan(3);
	expect(toast?.y ?? 0).toBeLessThan(80);

	// Time of day is a radio group too.
	await pick(page, 'Time of day', 'mood', 'Dawn', 'time of day: dawn');
	// Atmosphere, Lighting and Post are toggles: each names the effect, with its label's own case,
	// and its new state.
	await pick(page, 'Atmosphere', 'atmosphere', 'Sky', 'Sky: off');
	await pick(page, 'Lighting', 'lighting', 'Shadows', 'Shadows: off');
	await pick(page, 'Post', 'post', 'Bloom', 'Bloom: on');
	// Quality is a radio group of the presets.
	await pick(page, 'Quality', 'quality', 'Medium', 'quality: medium');

	expect(errors).toEqual([]);
});
