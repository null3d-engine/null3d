// The area lights' fitted tables, which load with the first rectangle or tube light (decision
// record D-145). This is first-use code: a page that makes no area light downloads none of it.
//
// The tables of 64 x 64 entries ship in a gzip file, which this module downloads, unpacks with the
// browser's DecompressionStream, decodes and writes into engine memory for the core to upload.
// tools/area-light-tables.ts writes the file. The file holds six planes of 64 x 64 half floats, one
// per channel: the four values of the inverse matrix, then the scale and the bias of the Fresnel
// term. Each entry is stored as its difference from the prediction left + up - upper left of its
// plane, as 16-bit integers that wrap around, with the low bytes of every entry first and the high
// bytes after them. Smooth tables predict well, so the differences are small and compress to less
// than half.

import type { CoreMemory } from './memory';

/** Entries along each side of each table. */
export const AREA_TABLE_SIZE = 64;
/** Channels that the file holds: four of the first table and two of the second. */
export const AREA_TABLE_CHANNELS = 6;
/** Half floats that the core takes: two layers of four channels. */
export const AREA_TABLE_HALVES = 2 * 4 * AREA_TABLE_SIZE * AREA_TABLE_SIZE;

/** The file, which bundlers ship beside the engine's code. */
export const AREA_TABLES_URL = new URL('../../vendor/ltc/area-light-tables.bin', import.meta.url);

/**
 * Decodes the unpacked file `bytes` into the texels of the core's two layers, four half floats
 * each, layer after layer. The channels that the file does not hold stay 0.
 */
export function decodeAreaTables(bytes: Uint8Array, out: Uint16Array): void {
	const size = AREA_TABLE_SIZE;
	const plane = size * size;
	const entries = AREA_TABLE_CHANNELS * plane;
	if (bytes.length !== 2 * entries || out.length !== AREA_TABLE_HALVES)
		throw new Error(`the area light tables hold ${bytes.length} bytes, not ${2 * entries}`);
	out.fill(0);
	for (let channel = 0; channel < AREA_TABLE_CHANNELS; channel++) {
		const layer = channel >> 2;
		const component = channel & 3;
		const into = layer * plane * 4 + component;
		for (let y = 0; y < size; y++) {
			for (let x = 0; x < size; x++) {
				const texel = y * size + x;
				const at = channel * plane + texel;
				const value = (k: number) => out[into + k * 4] as number;
				const left = x > 0 ? value(texel - 1) : 0;
				const up = y > 0 ? value(texel - size) : 0;
				const corner = x > 0 && y > 0 ? value(texel - size - 1) : 0;
				const residual = (bytes[at] as number) | ((bytes[entries + at] as number) << 8);
				out[into + texel * 4] = (residual + left + up - corner) & 0xffff;
			}
		}
	}
}

/**
 * Downloads the area lights' tables and writes them into engine memory, for the core to upload with
 * the next frame. Area lights light the frames from then on. Throws the reason when the file does
 * not download.
 */
export async function writeAreaTables(core: CoreMemory): Promise<void> {
	const response = await fetch(AREA_TABLES_URL);
	if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
	const unpacked = response.body.pipeThrough(new DecompressionStream('gzip'));
	const bytes = new Uint8Array(await new Response(unpacked).arrayBuffer());
	if (core.stopped) return;
	const at = core.check(core.glue.areaLightTables(), 'createRectAreaLight', undefined, false);
	decodeAreaTables(bytes, core.view(Uint16Array, at, AREA_TABLE_HALVES));
	core.check(core.glue.finishAreaLightTables(), 'createRectAreaLight', undefined, true);
}
