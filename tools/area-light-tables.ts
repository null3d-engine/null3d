// Writes the area lights' tables that the engine's package ships, packages/engine/vendor/ltc/
// area-light-tables.bin, from three.js's copy of Heitz's fit (RectAreaLightTexturesLib), as the
// half floats that three.js uploads. packages/engine/src/scene/area-light-tables.ts says how the file is
// laid out and decodes it. Run it after the engine's three.js version changes:
//
//   bun tools/area-light-tables.ts           writes the file
//   bun tools/area-light-tables.ts --check   fails when the file differs from what it would write

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import {
	AREA_TABLE_CHANNELS,
	AREA_TABLE_HALVES,
	AREA_TABLE_SIZE,
	decodeAreaTables,
} from '../packages/engine/src/scene/area-light-tables';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
/** Where the engine's package keeps the file. */
export const TABLES_FILE = join(root, 'packages/engine/vendor/ltc/area-light-tables.bin');

/**
 * three.js's two tables as the core's layers: four half floats per texel, layer after layer, as
 * three.js's `LTC_HALF_1` and `LTC_HALF_2` hold them.
 */
export async function threeTables(): Promise<Uint16Array> {
	const lib = Bun.resolveSync(
		'three/examples/jsm/lights/RectAreaLightTexturesLib.js',
		join(root, 'packages/engine'),
	);
	const { RectAreaLightTexturesLib } = await import(lib);
	RectAreaLightTexturesLib.init();
	const out = new Uint16Array(AREA_TABLE_HALVES);
	out.set(RectAreaLightTexturesLib.LTC_HALF_1.image.data as Uint16Array, 0);
	out.set(RectAreaLightTexturesLib.LTC_HALF_2.image.data as Uint16Array, AREA_TABLE_HALVES / 2);
	return out;
}

/** The file's bytes before gzip, from the core's layers: see the layout in area-light-tables.ts. */
export function encodeAreaTables(layers: Uint16Array): Uint8Array {
	const size = AREA_TABLE_SIZE;
	const plane = size * size;
	const entries = AREA_TABLE_CHANNELS * plane;
	const bytes = new Uint8Array(2 * entries);
	for (let channel = 0; channel < AREA_TABLE_CHANNELS; channel++) {
		const from = (channel >> 2) * plane * 4 + (channel & 3);
		const value = (texel: number) => layers[from + texel * 4] as number;
		for (let y = 0; y < size; y++) {
			for (let x = 0; x < size; x++) {
				const texel = y * size + x;
				const left = x > 0 ? value(texel - 1) : 0;
				const up = y > 0 ? value(texel - size) : 0;
				const corner = x > 0 && y > 0 ? value(texel - size - 1) : 0;
				const residual = (value(texel) - left - up + corner) & 0xffff;
				const at = channel * plane + texel;
				bytes[at] = residual & 0xff;
				bytes[entries + at] = residual >> 8;
			}
		}
	}
	return bytes;
}

/** The gzip file of three.js's tables. */
export async function tablesFile(): Promise<Uint8Array> {
	const layers = await threeTables();
	const bytes = encodeAreaTables(layers);
	const check = new Uint16Array(AREA_TABLE_HALVES);
	decodeAreaTables(bytes, check);
	// The file leaves out the channels that the shaders never read: the second table's last two.
	for (let i = 0; i < AREA_TABLE_HALVES; i++) {
		const unread = i >= AREA_TABLE_HALVES / 2 && (i & 3) >= 2;
		if (check[i] !== (unread ? 0 : layers[i]))
			throw new Error(`the tables do not decode to three.js's at half float ${i}`);
	}
	return gzipSync(bytes, { level: 9 });
}

if (import.meta.main) {
	const file = await tablesFile();
	if (process.argv.includes('--check')) {
		const kept = new Uint8Array(await Bun.file(TABLES_FILE).arrayBuffer());
		if (Buffer.compare(Buffer.from(kept), Buffer.from(file)) !== 0) {
			console.error(
				`${TABLES_FILE} differs from three.js's tables; run bun tools/area-light-tables.ts`,
			);
			process.exit(1);
		}
		console.log(`${TABLES_FILE} matches three.js's tables`);
	} else {
		await Bun.write(TABLES_FILE, file);
		console.log(`wrote ${TABLES_FILE}: ${file.length} bytes`);
	}
}
