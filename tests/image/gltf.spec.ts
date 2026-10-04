// glTF files in a live engine, in every thread mode on both GPU paths: a model loads into a prefab
// that instantiate, clone and createInstances copy, and files that break the rules fail with their
// codes and never hang. The glTF loader and its worker download once, with the first glTF file,
// and a page without glTF files downloads neither. The meshopt decoder downloads once, with the
// first file that holds meshopt data, and a page without such files does not download it.
import { expect, type Page, test } from '@playwright/test';
import { ENGINE_MODES, modeProblems } from '../lib/engine-checks.ts';
import { pageResult } from '../lib/page-result.ts';

/** The files of the glTF loader, by their addresses on the dev server and in a production build. */
const GLTF_FILES: Record<string, RegExp> = {
	loader: /\/scene\/gltf\.ts$|\/gltf-[\w-]{8}\.js$/,
	worker: /\/gltf-worker(\.ts|-[\w-]{8}\.js)$/,
	meshopt: /\/scene\/gltf-meshopt\.ts$|\/gltf-meshopt-[\w-]{8}\.js$/,
};

/** Records the address of every request that the page and its workers make. */
function recordRequests(page: Page): string[] {
	const urls: string[] = [];
	page.context().on('request', (request) => urls.push(new URL(request.url()).pathname));
	return urls;
}

/** How many of the requests fetched each file of the glTF loader. */
function gltfDownloads(urls: readonly string[]): Record<string, number> {
	return Object.fromEntries(
		Object.entries(GLTF_FILES).map(([file, path]) => [
			file,
			urls.filter((url) => path.test(url)).length,
		]),
	);
}

/** What the glTF files page reports. */
interface GltfResult {
	error?: string;
	mode: Parameters<typeof modeProblems>[0];
	recorded: {
		nodes: (string | undefined)[];
		hullParts: boolean;
		cloneIsNew: boolean;
		batchRows: number;
		bounds: number[][];
		materials: number;
		codes: Record<string, string>;
	};
}

/** Numbers rounded to a thousandth, as the 32-bit floats of a file hold them. */
const rounded = (values: readonly number[] | undefined) =>
	values?.map((v) => Math.round(v * 1000) / 1000);

for (const gpu of ['webgpu', 'webgl2'] as const)
	for (const mode of ENGINE_MODES)
		test(`glTF files load, copy and fail with their codes, on ${gpu}, ${mode.name}`, async ({
			page,
		}) => {
			const requests = recordRequests(page);
			await page.goto(`gltf-files.html?gpu=${gpu}&${mode.query}`);
			const result = await pageResult<GltfResult>(page, 60_000);
			expect(result.error).toBeUndefined();
			expect(modeProblems(result.mode, mode)).toEqual([]);
			const { recorded } = result;
			expect(recorded.nodes).toEqual(['Ship', 'Hull', 'Turret']);
			expect(recorded.hullParts).toBe(true);
			expect(recorded.cloneIsNew).toBe(true);
			expect(recorded.batchRows).toBe(8);
			expect(recorded.materials).toBe(3);
			expect(rounded(recorded.bounds[0])).toEqual([-1, -0.25, -0.5]);
			expect(rounded(recorded.bounds[1])).toEqual([1, 0.85, 0.5]);
			expect(recorded.codes).toEqual({
				broken: 'E1416',
				draco: 'E1417',
				missing: 'E1411',
				loop: 'E1416',
				huge: 'E1416',
				html: 'E1416',
				absent: 'E1411',
				empty: 'none',
				named: 'E1416',
				zeros: 'E1416',
				long: 'E1416',
			});
			// One thread loads every file, so the loader and its worker download once. No file holds
			// meshopt data, so the decoder does not download.
			expect(gltfDownloads(requests)).toEqual({ loader: 1, worker: 1, meshopt: 0 });
		});

/** What the meshopt sketch reports. */
interface MeshoptResult {
	error?: string;
	mode: Parameters<typeof modeProblems>[0];
	recorded: {
		bounds: Record<'ext' | 'khr' | 'fallback', number[]>;
		materials: number;
		broken: string;
	};
}

for (const gpu of ['webgpu', 'webgl2'] as const)
	for (const mode of ENGINE_MODES)
		test(`glTF files with meshopt compression load under both names, on ${gpu}, ${mode.name}`, async ({
			page,
		}) => {
			const requests = recordRequests(page);
			await page.goto(`gltf-files.html?gpu=${gpu}&${mode.query}&meshopt`);
			const result = await pageResult<MeshoptResult>(page, 60_000);
			expect(result.error).toBeUndefined();
			expect(modeProblems(result.mode, mode)).toEqual([]);
			const { bounds, materials, broken } = result.recorded;
			for (const box of Object.values(bounds)) {
				expect(box).toHaveLength(6);
				for (let axis = 0; axis < 3; axis++)
					expect(box[axis + 3] as number).toBeGreaterThan(box[axis] as number);
			}
			// The file with a fallback buffer decodes its meshopt data too, to the same model.
			expect(bounds.fallback).toEqual(bounds.khr);
			expect(materials).toBeGreaterThan(0);
			expect(broken).toBe('E1416');
			expect(gltfDownloads(requests)).toEqual({ loader: 1, worker: 1, meshopt: 1 });
			expect(requests.filter((url) => url.endsWith('Fallback.bin'))).toEqual([]);
		});

// The engine test page, whose start the startup benchmark times, loads no glTF file.
for (const mode of ENGINE_MODES)
	test(`a page without glTF files downloads no part of the glTF loader, ${mode.name}`, async ({
		page,
	}) => {
		const requests = recordRequests(page);
		await page.goto(`engine.html?gpu=webgl2&seconds=1&${mode.query}`);
		const result = await pageResult<{ error?: string }>(page, 30_000);
		expect(result.error).toBeUndefined();
		expect(gltfDownloads(requests)).toEqual({ loader: 0, worker: 0, meshopt: 0 });
	});
