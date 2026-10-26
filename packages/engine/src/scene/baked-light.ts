// The reader and the writer of baked light files: one documented format for probe grids and light
// maps that a tool outside the engine baked (decision record D-243, and hook H6 of D-173). A file
// is JSON with a marker, a version and a kind, and its large numbers travel as base64 so that a
// reader sees one value per element rather than a JSON number array.
//
// A probe-grid file holds every value of `LightProbeGridData`, so a grid that `bakeProbes` made in
// the browser writes the same format that a bake in another tool writes. A light-map file holds a
// radiance picture and, for a directional light map, the light's direction at each texel.
//
// Every fault names itself: a wrong marker, a version that this engine does not read, a kind that
// the call does not take, an element count that does not match the file's own size, and text that
// stops before its JSON is complete.
//
// This module loads on first use, so a page that reads no baked light file downloads none of it.

import { FILE_LIMITS } from './file-limits';
import {
	FEWEST_PROBES,
	LightProbeGridData,
	MOST_PROBES,
	PROBE_FLOATS,
	type ProbeCounts,
} from './light-probes';
import type { Texture } from './textures';

/** The marker that every baked light file carries. */
export const BAKED_LIGHT_FORMAT = 'null3d.baked-light';

/** The version of the format that this engine reads. */
export const BAKED_LIGHT_VERSION = 2;

/**
 * How a light map's file encodes its radiance.
 *
 * @category api/assets
 */
export type LightMapEncoding = 'rgb8' | 'rgba16float';

/** A probe grid baked outside the engine: its placement and its probes' coefficients. */
export interface BakedProbeGrid {
	readonly kind: 'probe-grid';
	readonly grid: LightProbeGridData;
}

/** A light map baked outside the engine. */
export interface BakedLightMap {
	readonly kind: 'light-map';
	readonly width: number;
	readonly height: number;
	readonly encoding: LightMapEncoding;
	/**
	 * Three bytes per texel for `rgb8`, in sRGB, and eight bytes per texel for `rgba16float`, as
	 * little-endian half floats. Rows run along v from the first texel at u = 0, v = 0.
	 */
	readonly radiance: Uint8Array;
	/** Three signed bytes per texel, each axis divided by 127, or undefined without one. */
	readonly direction: Int8Array | undefined;
}

/** A baked light file that this engine reads. */
export type BakedLight = BakedProbeGrid | BakedLightMap;

/**
 * A light map from `assets.loadLightMap`: its radiance texture, ready for a material's `lightMap`,
 * and the light's direction at each texel for a directional light map.
 *
 * @category api/assets
 */
export interface LightMapData {
	/** The texels across. */
	readonly width: number;
	/** The texels down. */
	readonly height: number;
	/** The radiance, as a texture that a material takes as `lightMap`. */
	readonly texture: Texture;
	/**
	 * Three signed bytes per texel, from -127 to 127, each axis a direction divided by 127. It runs
	 * from the same first texel as the radiance, and it is undefined for a light map without a
	 * direction.
	 */
	readonly direction: Int8Array | undefined;
	/**
	 * The direction at each texel, in linear color: its red, green and blue map the direction's
	 * x, y and z from -1 to 1. It has the radiance's size, format and color space, so the engine
	 * reads it through the light map's own texture binding; give it to a material beside the
	 * radiance as `lightMapDirection`. It is undefined for a light map without a direction.
	 */
	readonly directionTexture: Texture | undefined;
}

/** The bytes of each texel of a light map's radiance, by encoding. */
const RADIANCE_BYTES: Record<LightMapEncoding, number> = { rgb8: 3, rgba16float: 8 };

/** The bytes of each texel of a light map's direction: three signed bytes. */
const DIRECTION_BYTES = 3;

/** The characters of base64, with the one or two padding characters at its end. */
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Reads a baked light file's text, or throws an `Error` whose message names the fault.
 *
 * @internal
 */
export function readBakedLight(text: string): BakedLight {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch (error) {
		throw new Error(jsonReason(error, text));
	}
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		throw new Error('it does not hold a JSON object');
	const file = value as Record<string, unknown>;
	if (file.format !== BAKED_LIGHT_FORMAT)
		throw new Error(
			file.format === undefined
				? 'it has no format member'
				: `it is not a null3D baked light file: its format is ${quote(file.format)}, not "${BAKED_LIGHT_FORMAT}"`,
		);
	if (file.version !== BAKED_LIGHT_VERSION)
		throw new Error(
			file.version === undefined
				? 'it has no version'
				: `its version is ${quote(file.version)}, and this engine reads version ${BAKED_LIGHT_VERSION}`,
		);
	if (file.kind === 'probe-grid') return readProbeGrid(file);
	if (file.kind === 'light-map') return readLightMap(file);
	throw new Error(`its kind is ${quote(file.kind)}; it takes "probe-grid" or "light-map"`);
}

/**
 * Makes a baked light file's text from a probe grid, in the format that this engine reads.
 *
 * @internal
 */
export function writeBakedProbeGrid(grid: LightProbeGridData): string {
	const counts = grid.counts;
	const probes = counts[0] * counts[1] * counts[2];
	if (grid.coefficients.length !== probes * PROBE_FLOATS)
		throw new Error(
			`a grid whose coefficients hold ${grid.coefficients.length} numbers, and ${probes} probes of ${PROBE_FLOATS} need ${probes * PROBE_FLOATS}`,
		);
	if (grid.validity.length !== probes)
		throw new Error(
			`a grid whose validity holds ${grid.validity.length} numbers, and ${probes} probes need ${probes}`,
		);
	if (grid.skyOcclusion.length !== probes)
		throw new Error(
			`a grid whose sky occlusion holds ${grid.skyOcclusion.length} numbers, and ${probes} probes need ${probes}`,
		);
	// The text is written out, so the three-number members stay on one line and a reader sees the
	// file's shape at a glance. The members hold only numbers and base64, which need no escaping.
	const three = (values: ArrayLike<number>) =>
		`[${values[0] as number}, ${values[1] as number}, ${values[2] as number}]`;
	return `{
\t"format": "${BAKED_LIGHT_FORMAT}",
\t"version": ${BAKED_LIGHT_VERSION},
\t"kind": "probe-grid",
\t"origin": ${three(grid.origin)},
\t"spacing": ${three(grid.spacing)},
\t"counts": ${three(counts)},
\t"skyLuminance": ${grid.skyLuminance},
\t"coefficients": "${encodeBase64(floatBytes(grid.coefficients))}",
\t"validity": "${encodeBase64(floatBytes(grid.validity))}",
\t"skyOcclusion": "${encodeBase64(floatBytes(grid.skyOcclusion))}"
}
`;
}

/** The little-endian 32-bit floats of `values`, as bytes. */
function floatBytes(values: Float32Array): Uint8Array {
	const bytes = new Uint8Array(values.length * 4);
	const view = new DataView(bytes.buffer);
	for (let at = 0; at < values.length; at++) view.setFloat32(at * 4, values[at] as number, true);
	return bytes;
}

/** Reads a probe-grid file's members, or throws an `Error` that names the first fault. */
function readProbeGrid(file: Record<string, unknown>): BakedProbeGrid {
	const origin = triple(file.origin, 'origin', 'finite numbers');
	const spacing = triple(file.spacing, 'spacing', 'numbers above 0');
	for (let k = 0; k < 3; k++)
		if ((spacing[k] as number) <= 0)
			throw new Error(
				`its spacing along ${'xyz'[k]} is ${spacing[k] as number}, and it takes a number above 0`,
			);
	const counts = probeCounts(file.counts);
	const probes = counts[0] * counts[1] * counts[2];
	const same = `${counts[0]} x ${counts[1]} x ${counts[2]} probes`;
	const coefficients = floatMember(
		file,
		'coefficients',
		probes * PROBE_FLOATS,
		`${same} of ${PROBE_FLOATS}`,
	);
	const validity = floatMember(file, 'validity', probes, same);
	const skyOcclusion = floatMember(file, 'skyOcclusion', probes, same);
	for (const [name, values] of [
		['validity', validity],
		['skyOcclusion', skyOcclusion],
	] as const) {
		for (let at = 0; at < values.length; at++) {
			const value = values[at] as number;
			if (value < 0 || value > 1)
				throw new Error(
					`its ${name} holds ${value} at index ${at}, and it takes a number from 0 to 1`,
				);
		}
	}
	const skyLuminance = file.skyLuminance;
	if (typeof skyLuminance !== 'number' || !Number.isFinite(skyLuminance) || skyLuminance < 0)
		throw new Error(
			`its skyLuminance is ${quote(skyLuminance)}, and it takes a number of 0 or more`,
		);
	return {
		kind: 'probe-grid',
		grid: new LightProbeGridData(
			origin,
			spacing,
			counts,
			coefficients,
			validity,
			skyOcclusion,
			skyLuminance,
		),
	};
}

/**
 * Reads a member of little-endian 32-bit floats, `count` of them, or throws an `Error` that names
 * the member, its size or a number that is not finite.
 */
function floatMember(
	file: Record<string, unknown>,
	name: string,
	count: number,
	expected: string,
): Float32Array {
	const encoded = base64Text(file[name], name);
	const size = base64Bytes(encoded);
	takeBytes(size, name);
	const verb = name.endsWith('s') ? 'hold' : 'holds';
	if (size % 4 !== 0)
		throw new Error(`its ${name} ${verb} ${size} bytes, not a whole number of 4-byte floats`);
	const values = size / 4;
	if (values !== count)
		throw new Error(`its ${name} ${verb} ${values} floats, and ${expected} need ${count}`);
	const bytes = decodeBase64(encoded, name);
	const out = new Float32Array(values);
	const view = new DataView(bytes.buffer);
	for (let at = 0; at < values; at++) {
		const value = view.getFloat32(at * 4, true);
		if (!Number.isFinite(value))
			throw new Error(`its ${name} ${verb} a number that is not finite at index ${at}`);
		out[at] = value;
	}
	return out;
}

/** Reads a light-map file's members, or throws an `Error` that names the first fault. */
function readLightMap(file: Record<string, unknown>): BakedLightMap {
	const width = side(file.width, 'width');
	const height = side(file.height, 'height');
	const encoding = file.encoding;
	if (encoding !== 'rgb8' && encoding !== 'rgba16float')
		throw new Error(`its encoding is ${quote(encoding)}; it takes "rgb8" or "rgba16float"`);
	const texels = width * height;
	const expected = texels * (RADIANCE_BYTES[encoding] as number);
	const encoded = base64Text(file.radiance, 'radiance');
	const size = base64Bytes(encoded);
	takeBytes(size, 'radiance');
	if (size !== expected)
		throw new Error(
			`its radiance holds ${size} bytes, and ${width} x ${height} texels of ${RADIANCE_BYTES[encoding]} bytes need ${expected}`,
		);
	const radiance = decodeBase64(encoded, 'radiance');
	let direction: Int8Array | undefined;
	if (file.direction !== undefined) {
		const wanted = texels * DIRECTION_BYTES;
		const text = base64Text(file.direction, 'direction');
		const bytes = base64Bytes(text);
		takeBytes(bytes, 'direction');
		if (bytes !== wanted)
			throw new Error(
				`its direction holds ${bytes} bytes, and ${width} x ${height} texels of ${DIRECTION_BYTES} bytes need ${wanted}`,
			);
		const raw = decodeBase64(text, 'direction');
		direction = new Int8Array(raw.buffer, raw.byteOffset, raw.byteLength);
	}
	return { kind: 'light-map', width, height, encoding, radiance, direction };
}

/** Reads a member of three numbers, or throws an `Error` that names it and what it takes. */
function triple(value: unknown, name: string, takes: string): Float32Array {
	if (
		!Array.isArray(value) ||
		value.length !== 3 ||
		!value.every((number) => typeof number === 'number' && Number.isFinite(number))
	)
		throw new Error(`its ${name} is not three ${takes}`);
	const out = new Float32Array(3);
	for (let k = 0; k < 3; k++) out[k] = value[k] as number;
	return out;
}

/** Reads a member of three whole probe counts within the grid's limits. */
function probeCounts(value: unknown): ProbeCounts {
	if (
		!Array.isArray(value) ||
		value.length !== 3 ||
		!value.every((number) => typeof number === 'number' && Number.isInteger(number))
	)
		throw new Error('its counts are not three whole numbers');
	for (let k = 0; k < 3; k++) {
		const count = value[k] as number;
		if (count < FEWEST_PROBES)
			throw new Error(
				`its counts give ${count} ${count === 1 ? 'probe' : 'probes'} along ${'xyz'[k]}, and a grid takes ${FEWEST_PROBES} or more`,
			);
		if (count > (MOST_PROBES[k] as number))
			throw new Error(
				`its counts give ${count} probes along ${'xyz'[k]}, more than the ${MOST_PROBES[k]} that a grid holds`,
			);
	}
	return [value[0] as number, value[1] as number, value[2] as number];
}

/** Reads a light map's width or height: a whole number from 1 to the longest texture side. */
function side(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isInteger(value) || value < 1)
		throw new Error(`its ${name} is ${quote(value)}, and it takes a whole number of 1 or more`);
	if (value > FILE_LIMITS.textureSide)
		throw new Error(
			`its ${name} is ${value}, more than the ${FILE_LIMITS.textureSide} texels that a texture may have`,
		);
	return value;
}

/** A base64 member's text, or a refusal that names the member. */
function base64Text(value: unknown, name: string): string {
	if (typeof value !== 'string')
		throw new Error(`its ${name} is ${value === undefined ? 'missing' : 'not base64'}`);
	if (value.length % 4 !== 0 || !BASE64.test(value)) throw new Error(`its ${name} is not base64`);
	return value;
}

/** The bytes that a valid base64 text holds, from its length and its padding. */
function base64Bytes(text: string): number {
	const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
	return (text.length / 4) * 3 - padding;
}

/** Decodes a checked base64 member into bytes. */
function decodeBase64(text: string, name: string): Uint8Array {
	let binary: string;
	try {
		binary = atob(text);
	} catch {
		throw new Error(`its ${name} is not base64`);
	}
	const bytes = new Uint8Array(binary.length);
	for (let at = 0; at < binary.length; at++) bytes[at] = binary.charCodeAt(at);
	return bytes;
}

/** Throws when `bytes` of one decoded member is more than a file may hold. */
function takeBytes(bytes: number, name: string): void {
	if (bytes <= FILE_LIMITS.itemBytes) return;
	const mib = FILE_LIMITS.itemBytes / (1024 * 1024);
	throw new Error(
		`its ${name} decodes to ${Math.round(bytes / (1024 * 1024)).toLocaleString('en-US')} MiB, more than the ${mib.toLocaleString('en-US')} MiB that one file may hold`,
	);
}

/** Why the text is not JSON: a file whose structures never close is cut short. */
function jsonReason(error: unknown, text: string): string {
	if (isCutShort(text))
		return 'its text stops before its JSON is complete, so the file is cut short';
	const reason = error instanceof Error ? error.message : String(error);
	return `it is not JSON (${reason})`;
}

/**
 * True when the text ends inside a string or with a bracket or a brace still open, which is what a
 * file that a download cut short looks like. A parser's own reason for such a file names a token it
 * expected, which says nothing to the reader.
 */
function isCutShort(text: string): boolean {
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let at = 0; at < text.length; at++) {
		const character = text[at];
		if (inString) {
			if (escaped) escaped = false;
			else if (character === '\\') escaped = true;
			else if (character === '"') inString = false;
		} else if (character === '"') inString = true;
		else if (character === '{' || character === '[') depth++;
		else if (character === '}' || character === ']') depth--;
	}
	return inString || depth > 0;
}

/** A member's value as a message names it: a string in quotes, or the value itself. */
function quote(value: unknown): string {
	return typeof value === 'string' ? `"${value}"` : String(value);
}

/** A member's bytes as base64. */
function encodeBase64(bytes: Uint8Array): string {
	let text = '';
	// A chunk keeps the spread below the limit on the arguments of one call.
	const chunk = 0x8000;
	for (let at = 0; at < bytes.length; at += chunk)
		text += String.fromCharCode(...bytes.subarray(at, at + chunk));
	return btoa(text);
}
