import { describe, expect, it } from 'bun:test';
import { gunzipSync } from 'node:zlib';
import {
	AREA_TABLE_HALVES,
	decodeAreaTables,
} from '../packages/engine/src/scene/area-light-tables';
import { encodeAreaTables, TABLES_FILE, tablesFile, threeTables } from './area-light-tables';

describe('the area lights tables file', () => {
	it("is what the tool writes from the engine's three.js", async () => {
		const kept = new Uint8Array(await Bun.file(TABLES_FILE).arrayBuffer());
		expect(Buffer.compare(Buffer.from(kept), Buffer.from(await tablesFile()))).toBe(0);
	});

	it("decodes to three.js's half floats, less the channels that no shader reads", async () => {
		const three = await threeTables();
		const kept = new Uint8Array(await Bun.file(TABLES_FILE).arrayBuffer());
		const out = new Uint16Array(AREA_TABLE_HALVES);
		decodeAreaTables(gunzipSync(kept), out);
		const second = AREA_TABLE_HALVES / 2;
		for (let i = 0; i < AREA_TABLE_HALVES; i++)
			if (i < second || (i & 3) < 2) expect(out[i]).toBe(three[i] as number);
			else expect(out[i]).toBe(0);
	});

	it('round-trips any table through the encoding', () => {
		const layers = Uint16Array.from({ length: AREA_TABLE_HALVES }, (_, i) =>
			i >= AREA_TABLE_HALVES / 2 && (i & 3) >= 2 ? 0 : (i * 7919) & 0xffff,
		);
		const out = new Uint16Array(AREA_TABLE_HALVES);
		decodeAreaTables(encodeAreaTables(layers), out);
		expect(out).toEqual(layers);
	});
});
