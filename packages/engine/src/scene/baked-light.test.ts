import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readBakedLight, writeBakedProbeGrid } from './baked-light';
import { Environment } from './environment';
import { bakeProbes, LightProbeGridData, MOST_PROBES } from './light-probes';
import type { RaycastBatchHits } from './queries';
import type { Scene } from './scene';
import type { Texture } from './textures';

const LIGHT = join(import.meta.dir, '../../../../tests/pages/assets/light');

/** A baked light file that a tool outside the engine wrote, as its text. */
const fixture = (name: string) => readFileSync(join(LIGHT, `${name}.json`), 'utf8');

/** The message of the refusal that `text` causes, or a failure when it reads. */
function refusal(text: string): string {
	try {
		readBakedLight(text);
	} catch (error) {
		return (error as Error).message;
	}
	throw new Error('the text was read as a baked light file');
}

/** The fixture's text with one member's value replaced, for a file with one fault. */
function changed(name: string, member: string, value: string): string {
	return fixture(name).replace(
		new RegExp(`("${member}": )(.*?)(,)?$`, 'm'),
		(_, head: string, _old: string, comma: string | undefined) => `${head}${value}${comma ?? ''}`,
	);
}

/** The bytes of some 32-bit floats, in the format's order, as base64. */
function floats(values: readonly number[]): string {
	const bytes = new Uint8Array(values.length * 4);
	const view = new DataView(bytes.buffer);
	for (let at = 0; at < values.length; at++) view.setFloat32(at * 4, values[at] as number, true);
	let text = '';
	for (const byte of bytes) text += String.fromCharCode(byte);
	return btoa(text);
}

test('reads a probe grid that a tool outside the engine baked', () => {
	const file = readBakedLight(fixture('probe-grid'));
	expect(file.kind).toBe('probe-grid');
	if (file.kind !== 'probe-grid') return;
	const { grid } = file;
	expect(Array.from(grid.origin)).toEqual([0, 1, 0]);
	expect(Array.from(grid.spacing)).toEqual([1, 1, 1]);
	expect(grid.counts).toEqual([2, 2, 2]);
	// The fixture holds one coefficient every eighth, from 0, in the order x fastest.
	expect(grid.coefficients.length).toBe(96);
	expect(grid.coefficients[0]).toBe(0);
	expect(grid.coefficients[1]).toBe(0.125);
	expect(grid.coefficients[95]).toBe(11.875);
	// The weights, the share of the sky that each probe sees, and the sky's brightness at the bake.
	expect(Array.from(grid.validity)).toEqual([1, 1, 0.25, 1, 1, 1, 1, 1]);
	expect(Array.from(grid.skyOcclusion)).toEqual([1, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
	expect(grid.skyLuminance).toBe(0.75);
});

test('reads a light map that a tool outside the engine baked', () => {
	const file = readBakedLight(fixture('light-map'));
	expect(file.kind).toBe('light-map');
	if (file.kind !== 'light-map') return;
	expect([file.width, file.height]).toEqual([2, 2]);
	expect(file.encoding).toBe('rgb8');
	expect(Array.from(file.radiance)).toEqual([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]);
	// The direction is three signed bytes per texel: each axis divided by 127.
	expect(Array.from(file.direction ?? [])).toEqual([0, 127, 0, 127, 0, 0, 0, 0, 127, -127, 0, 0]);
});

test('a light map without a direction reads', () => {
	const text = fixture('light-map').replace(/,\n\t"direction": "[^"]*"/, '');
	const file = readBakedLight(text);
	if (file.kind !== 'light-map') throw new Error('the file is not a light map');
	expect(file.direction).toBeUndefined();
});

test('the engine writes the fixture’s own text', () => {
	const file = readBakedLight(fixture('probe-grid'));
	if (file.kind !== 'probe-grid') throw new Error('the file is not a probe grid');
	expect(writeBakedProbeGrid(file.grid)).toBe(fixture('probe-grid'));
});

test('a grid that the engine bakes writes the format and reads back the same', () => {
	const scene = {
		raycastBatch(_rays: Float32Array, _options: unknown, hits: RaycastBatchHits) {
			hits.distances.fill(-1);
		},
	} as unknown as Scene;
	const sh = new Float32Array(27);
	sh.set([1, 2, 3]);
	const environment = new Environment(
		{ handle: 1 } as unknown as Texture,
		1,
		1,
		'rgb9e5ufloat',
		sh,
	);
	const grid = bakeProbes(scene, {
		box: { min: [0, 0, 0], max: [1, 1, 1] },
		spacing: 1,
		samples: 8,
		environment,
	}).finish();
	expect(grid.counts).toEqual([2, 2, 2]);
	const file = readBakedLight(writeBakedProbeGrid(grid));
	if (file.kind !== 'probe-grid') throw new Error('the text is not a probe grid');
	expect(Array.from(file.grid.origin)).toEqual(Array.from(grid.origin));
	expect(Array.from(file.grid.spacing)).toEqual(Array.from(grid.spacing));
	expect(file.grid.counts).toEqual(grid.counts);
	expect(Array.from(file.grid.coefficients)).toEqual(Array.from(grid.coefficients));
	expect(Array.from(file.grid.validity)).toEqual(Array.from(grid.validity));
	expect(Array.from(file.grid.skyOcclusion)).toEqual(Array.from(grid.skyOcclusion));
	expect(file.grid.skyLuminance).toBe(grid.skyLuminance);
});

test('a version that the engine does not read is named', () => {
	expect(refusal(changed('probe-grid', 'version', '3'))).toBe(
		'its version is 3, and this engine reads version 2',
	);
	expect(refusal(fixture('probe-grid').replace('"version": 2,', ''))).toBe('it has no version');
});

test('a file of another kind or another format is named', () => {
	expect(refusal(changed('probe-grid', 'format', '"other"'))).toBe(
		'it is not a null3D baked light file: its format is "other", not "null3d.baked-light"',
	);
	expect(refusal(fixture('probe-grid').replace(/\t"format": "[^"]*",\n/, ''))).toBe(
		'it has no format member',
	);
	expect(refusal(changed('probe-grid', 'kind', '"mesh"'))).toBe(
		'its kind is "mesh"; it takes "probe-grid" or "light-map"',
	);
	expect(refusal('[]')).toBe('it does not hold a JSON object');
	expect(refusal('not json at all')).toStartWith('it is not JSON');
});

test('a file that stops early is named as cut short', () => {
	expect(refusal(fixture('probe-grid').slice(0, 120))).toBe(
		'its text stops before its JSON is complete, so the file is cut short',
	);
	expect(refusal(fixture('light-map').slice(0, 80))).toBe(
		'its text stops before its JSON is complete, so the file is cut short',
	);
});

test('a wrong element count is named with both counts', () => {
	// A grid whose coefficients hold one float fewer per probe than the counts need.
	expect(refusal(changed('probe-grid', 'coefficients', `"${floats([1, 2, 3])}"`))).toBe(
		'its coefficients hold 3 floats, and 2 x 2 x 2 probes of 12 need 96',
	);
	// A light map whose radiance holds too few bytes.
	expect(refusal(changed('light-map', 'radiance', '"AAAA"'))).toBe(
		'its radiance holds 3 bytes, and 2 x 2 texels of 3 bytes need 12',
	);
	// A light map whose direction holds too few bytes.
	expect(refusal(changed('light-map', 'direction', '"AAAA"'))).toBe(
		'its direction holds 3 bytes, and 2 x 2 texels of 3 bytes need 12',
	);
	// A coefficient payload that is not a whole number of floats.
	const bytes = btoa(String.fromCharCode(1, 2, 3, 4, 5));
	expect(refusal(changed('probe-grid', 'coefficients', `"${bytes}"`))).toBe(
		'its coefficients hold 5 bytes, not a whole number of 4-byte floats',
	);
});

test('a payload that is not base64 is named', () => {
	expect(refusal(changed('probe-grid', 'coefficients', '"not base64!"'))).toBe(
		'its coefficients is not base64',
	);
	expect(refusal(fixture('probe-grid').replace(/,\n\t"coefficients": "[^"]*"/, ''))).toBe(
		'its coefficients is missing',
	);
});

test('a placement or a size that a grid cannot take is named', () => {
	expect(refusal(changed('probe-grid', 'counts', '[1, 2, 2]'))).toBe(
		'its counts give 1 probe along x, and a grid takes 2 or more',
	);
	expect(refusal(changed('probe-grid', 'counts', '[2, 3.5, 2]'))).toBe(
		'its counts are not three whole numbers',
	);
	expect(refusal(changed('probe-grid', 'counts', '[2, 2, 300]'))).toBe(
		`its counts give 300 probes along z, more than the ${MOST_PROBES[2]} that a grid holds`,
	);
	expect(refusal(changed('probe-grid', 'spacing', '[1, 0, 1]'))).toBe(
		'its spacing along y is 0, and it takes a number above 0',
	);
	expect(refusal(changed('probe-grid', 'origin', '[0, "up", 0]'))).toBe(
		'its origin is not three finite numbers',
	);
	expect(refusal(changed('light-map', 'width', '0'))).toBe(
		'its width is 0, and it takes a whole number of 1 or more',
	);
	expect(refusal(changed('light-map', 'height', '8192'))).toBe(
		'its height is 8192, more than the 4096 texels that a texture may have',
	);
	expect(refusal(changed('light-map', 'encoding', '"rgb16"'))).toBe(
		'its encoding is "rgb16"; it takes "rgb8" or "rgba16float"',
	);
});

test('an rgba16float light map holds half floats', () => {
	const halves = new Uint8Array(2 * 2 * 8);
	const view = new DataView(halves.buffer);
	// Four texels of red at a half float of 1, green at 0.5, blue at 0.25 and alpha of 1.
	const red = 0x3c00;
	const green = 0x3800;
	const blue = 0x3400;
	const white = 0x3c00;
	for (let texel = 0; texel < 4; texel++)
		[red, green, blue, white].forEach((value, channel) => {
			view.setUint16(texel * 8 + channel * 2, value, true);
		});
	const text = changed('light-map', 'encoding', '"rgba16float"').replace(
		/"radiance": "[^"]*"/,
		`"radiance": "${btoa(String.fromCharCode(...halves))}"`,
	);
	const file = readBakedLight(text);
	if (file.kind !== 'light-map') throw new Error('the text is not a light map');
	expect(file.radiance.length).toBe(32);
	expect(new DataView(file.radiance.buffer).getUint16(0, true)).toBe(red);
	expect(new DataView(file.radiance.buffer).getUint16(2, true)).toBe(green);
});

test('a grid writes the values that LightProbeGridData holds', () => {
	const coefficients = new Float32Array(96);
	coefficients[0] = 1;
	coefficients[1] = 2;
	coefficients[2] = 4;
	const grid = new LightProbeGridData(
		new Float32Array([-1, 0, 2]),
		new Float32Array([0.5, 1, 2]),
		[2, 2, 2],
		coefficients,
	);
	const text = writeBakedProbeGrid(grid);
	expect(text).toContain('"origin": [-1, 0, 2]');
	expect(text).toContain('"spacing": [0.5, 1, 2]');
	const file = readBakedLight(text);
	if (file.kind !== 'probe-grid') throw new Error('the text is not a probe grid');
	expect(Array.from(file.grid.coefficients.subarray(0, 4))).toEqual([1, 2, 4, 0]);
});
