// The vegetation add-on's download rule: a page fetches the files of the species it prepares and
// of no other, the half set of textures on Low and the full set elsewhere, no texture file before
// the species is prepared, and no species record before the page asks for it. The page prepares
// two species that ship textures, on Low and on High, and reports every file its sketch fetched.
//
// The rule needs two species with texture files; until the second lands, the test skips.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { speciesFolders } from '../../tools/lib/vegetation-folders.ts';
import { pageResult } from '../lib/page-result.ts';
import { REPO_ROOT } from '../lib/server.ts';
import type { DownloadReport } from '../pages/lib/plant-download.ts';

/** The species folders of the registry that ship texture files, in order. */
const SHIPPED = speciesFolders(REPO_ROOT)
	.map((folder) => folder.id)
	.filter((id) =>
		existsSync(join(REPO_ROOT, 'packages/vegetation-textures/textures', id, 'manifest.json')),
	);
const [FIRST, SECOND] = SHIPPED;

/** What the page did wrong, one line a fault. */
function faults(report: DownloadReport, placed: readonly string[], low: boolean): string[] {
	const out: string[] = [];
	const others = SHIPPED.filter((id) => !placed.includes(id));
	const preparedAt = new Map(report.species.map((s) => [s.id, s]));
	for (const { url, start } of report.downloads) {
		const path = decodeURIComponent(new URL(url).pathname);
		const texture = /\/vegetation-textures\/textures\/([^/]+)\/([^/?]+\.ktx2)/.exec(path);
		const record = /\/vegetation\/src\/species\/([^/_][^/]*)\//.exec(path);
		if (texture) {
			const [, id, file] = texture as unknown as [string, string, string];
			const species = preparedAt.get(id);
			if (!species) out.push(`fetched ${file} of ${id}, which the page does not place`);
			else if (start < species.preparing)
				out.push(`fetched ${file} of ${id} before the page prepared it`);
			const half = file.endsWith('-half.ktx2');
			if (low && !half) out.push(`fetched the full set's ${file} of ${id} on Low`);
			if (!low && half) out.push(`fetched the half set's ${file} of ${id} on ${report.preset}`);
		}
		if (record) {
			const id = record[1] as string;
			const species = preparedAt.get(id);
			if (others.includes(id) || !species)
				out.push(`fetched the record of ${id}, which the page does not place`);
			else if (start < species.loading)
				out.push(`fetched the record of ${id} before the page loaded it`);
		}
	}
	for (const id of placed) {
		const fetched = report.downloads.some((d) =>
			decodeURIComponent(d.url).includes(`/vegetation-textures/textures/${id}/`),
		);
		if (!fetched) out.push(`fetched no texture file of ${id}, which the page prepared`);
	}
	return out;
}

for (const preset of ['low', 'high'] as const)
	test(`a page fetches the textures of the species it places alone, on ${preset}`, async ({
		page,
	}) => {
		test.skip(SECOND === undefined, `two species must ship textures; ${SHIPPED.length} do`);
		test.setTimeout(600_000);
		const placed = [FIRST as string, SECOND as string];
		await page.goto(`plant-download.html?preset=${preset}&species=${placed.join(',')}`);
		const report = await pageResult<DownloadReport & { ok: boolean; error?: string }>(
			page,
			540_000,
		);
		expect(report.error).toBeUndefined();
		expect(report.preset).toBe(preset);
		expect(faults(report, placed, preset === 'low')).toEqual([]);
	});
