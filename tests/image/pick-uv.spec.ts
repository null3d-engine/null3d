// The texture coordinates of a pixel-exact pick, against the coordinates that the same point
// returns from a raycast and that the surface's own geometry gives. A repeated texture reports
// coordinates past 1, a texture transform leaves the mesh's own coordinates alone, a mesh with no
// coordinates says so, and the rows of a batch that differ in scale each land on their own texel.
import { expect, type Page, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

/** What a query or a pick said about a point. */
interface Said {
	object: string;
	instance: number;
	hasUv: boolean;
	uv: [number, number] | null;
}

/** One probe's answers from the two ways of asking. */
interface Answered {
	surface: string;
	instance: number;
	expected: [number, number] | null;
	screen: [number, number];
	ray: Said | null;
	pick: Said | null;
}

/** How long a test waits for the page to start and for the picks to answer. */
const WAIT_MS = 120_000;

/** How far a reported coordinate may lie from the one the geometry gives, in texels of the set. */
const TOLERANCE = 0.02;

/** Opens the page, and returns a function that asks the sketch for the probes' answers. */
async function open(page: Page, tier: string) {
	await page.goto(`pick-uv.html?gpu=${tier}`);
	const result = await pageResult<{ ok: boolean; error?: string }>(page, WAIT_MS);
	expect(result.error).toBeUndefined();
	return page.evaluate(
		() =>
			(
				globalThis as {
					pickUv?: () => Promise<{ error?: string; answers: Answered[] }>;
				}
			).pickUv?.() as Promise<{ error?: string; answers: Answered[] }>,
	);
}

for (const tier of ['webgpu', 'webgl2'] as const)
	test(`a pick reports the texture coordinates of the pixel under it, on ${tier}`, async ({
		page,
	}) => {
		// The first pick of the page loads the picking shader files and builds their pipelines.
		test.setTimeout(WAIT_MS);
		const { error, answers } = await open(page, tier);
		expect(error).toBeUndefined();
		expect(answers.length).toBe(14);
		const wrong: string[] = [];
		for (const answer of answers) {
			const where = `${answer.surface} probe at ${answer.screen.map((v) => v.toFixed(1)).join(', ')}`;
			const { pick, ray, expected } = answer;
			if (!pick) {
				wrong.push(`${where}: the pick answered nothing`);
				continue;
			}
			if (!ray) {
				wrong.push(`${where}: the raycast hit nothing`);
				continue;
			}
			// The two ways of asking must name the same source.
			const named = `${pick.object}:${pick.instance}`;
			if (named !== `${answer.surface}:${answer.instance}`)
				wrong.push(`${where}: the pick named ${named}`);
			if (`${ray.object}:${ray.instance}` !== named)
				wrong.push(`${where}: the raycast named ${ray.object}:${ray.instance}, the pick ${named}`);
			// A surface with no coordinates reports that it has none, and not a coordinate of zero.
			if (pick.hasUv !== (expected !== null))
				wrong.push(`${where}: the pick said hasUv ${pick.hasUv}, expected ${expected !== null}`);
			if (ray.hasUv !== (expected !== null))
				wrong.push(`${where}: the ray said hasUv ${ray.hasUv}, expected ${expected !== null}`);
			if (expected === null || !pick.uv || !ray.uv) continue;
			// The two ways of asking give one answer.
			if (Math.abs(pick.uv[0] - ray.uv[0]) > 1e-4 || Math.abs(pick.uv[1] - ray.uv[1]) > 1e-4)
				wrong.push(
					`${where}: the pick said ${pick.uv.map((v) => v.toFixed(4))}, the raycast ${ray.uv.map((v) => v.toFixed(4))}`,
				);
			for (const [way, said] of [
				['pick', pick.uv],
				['raycast', ray.uv],
			] as const) {
				if (
					Math.abs(said[0] - expected[0]) > TOLERANCE ||
					Math.abs(said[1] - expected[1]) > TOLERANCE
				)
					wrong.push(
						`${where}: the ${way} said ${said.map((v) => v.toFixed(4))}, the geometry gives ${expected.map((v) => v.toFixed(4))}`,
					);
			}
		}
		// The repeated set reports coordinates past the first copy of the texture.
		for (const answer of answers.filter((a) => a.surface === 'repeated'))
			if ((answer.pick?.uv?.[0] ?? 0) <= 1 || (answer.pick?.uv?.[1] ?? 0) <= 1)
				wrong.push(`the repeated set reported ${answer.pick?.uv}, not a coordinate past 1`);
		expect(wrong).toEqual([]);
	});
