// glTF files in a live engine, in every thread mode on both GPU paths: a model loads into a prefab
// that instantiate, clone and createInstances copy, and files that break the rules fail with their
// codes and never hang. The glTF loader and its worker download once, with the first glTF file.
// The meshopt and Draco decoders each download once, with the first file that holds their data,
// and a page without such files does not download them. The engine test page's tests check that a
// page without glTF files downloads no part of the loader.
import { expect, test } from '@playwright/test';
import { ENGINE_MODES, modeProblems } from '../lib/engine-checks.ts';
import { gltfDownloads, recordRequests } from '../lib/gltf-loader-files.ts';
import { pageResult } from '../lib/page-result.ts';

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
		faceWeights: number[];
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
		}, testInfo) => {
			const requests = recordRequests(page);
			const warnings: string[] = [];
			page.on('console', (message) => {
				if (message.type() === 'warning') warnings.push(message.text());
			});
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
			// The face's shape keys are sparse accessors of 8-bit and 16-bit indices.
			expect(recorded.faceWeights).toEqual([0.5, 0, 0]);
			expect(recorded.codes).toEqual({
				broken: 'E1416',
				required: 'E1417',
				used: 'none',
				missing: 'E1411',
				loop: 'E1416',
				huge: 'E1416',
				html: 'E1416',
				absent: 'E1411',
				empty: 'none',
				named: 'E1416',
				zeros: 'E1416',
				long: 'E1416',
				rewritten: 'none',
				refused: 'E1416',
				undecodable: 'E1412',
				claimsHuge: 'E1416',
				brokenAvif: 'E1412',
			});
			// A development build notes the used extension that nothing reads, and a release build
			// prints nothing.
			const unread = warnings.filter((text) => text.includes('KHR_materials_variants'));
			if (testInfo.project.name === 'production build') expect(unread).toEqual([]);
			else
				expect(unread).toEqual([
					expect.stringContaining('an extension that the engine does not read'),
				]);
			// One thread loads every file, so the loader and its worker download once. No file holds
			// meshopt or Draco data, so no decoder downloads.
			expect(gltfDownloads(requests)).toEqual({
				loader: 1,
				worker: 1,
				meshopt: 0,
				draco: 0,
				dracoWasm: 0,
			});
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
			expect(gltfDownloads(requests)).toEqual({
				loader: 1,
				worker: 1,
				meshopt: 1,
				draco: 0,
				dracoWasm: 0,
			});
			expect(requests.filter((url) => url.endsWith('Fallback.bin'))).toEqual([]);
		});

/** What the Draco sketch reports. */
interface DracoResult {
	error?: string;
	mode: Parameters<typeof modeProblems>[0];
	recorded: {
		bounds: Record<'coordinates' | 'rigged' | 'again', number[]>;
		clips: string[];
		refused: string;
	};
}

for (const gpu of ['webgpu', 'webgl2'] as const)
	for (const mode of ENGINE_MODES)
		test(`glTF files with Draco compression load, and a broken one fails with its code, on ${gpu}, ${mode.name}`, async ({
			page,
		}, testInfo) => {
			const requests = recordRequests(page);
			const warnings: string[] = [];
			page.on('console', (message) => {
				if (message.type() === 'warning') warnings.push(message.text());
			});
			await page.goto(`gltf-files.html?gpu=${gpu}&${mode.query}&draco`);
			const result = await pageResult<DracoResult>(page, 60_000);
			expect(result.error).toBeUndefined();
			expect(modeProblems(result.mode, mode)).toEqual([]);
			const { bounds, clips, refused } = result.recorded;
			for (const box of Object.values(bounds)) {
				expect(box).toHaveLength(6);
				for (let axis = 0; axis < 2; axis++)
					expect(box[axis + 3] as number).toBeGreaterThan(box[axis] as number);
			}
			// The decoder that failed on the broken file gives way to a fresh one, which reads the
			// test file again to the same model.
			expect(bounds.again).toEqual(bounds.coordinates);
			expect(clips).toEqual(['animation_0']);
			expect(refused).toBe('E1416');
			expect(gltfDownloads(requests)).toEqual({
				loader: 1,
				worker: 1,
				meshopt: 0,
				draco: 1,
				dracoWasm: 1,
			});
			// A development build warns about each Draco file that loads, and names the converter.
			const draco = warnings.filter((text) => text.includes('bunx @null3d/cli assets optimize'));
			expect(draco.length).toBe(testInfo.project.name === 'production build' ? 0 : 3);
		});
