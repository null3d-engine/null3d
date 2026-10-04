import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUILTIN_ENVIRONMENTS, readEnvironmentFile } from './environment-file';

/** The built-in room's file in the engine's package. */
const ROOM = join(import.meta.dir, '../../environments/room.ktx2');

const IDENTIFIER = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];

interface FileParts {
	vkFormat?: number;
	size?: number;
	faces?: number;
	levels?: number;
	supercompression?: number;
	/** The key-value data's text, or none for no entry. */
	data?: string | null;
	/** Bytes to take off the last level's length in the index. */
	short?: number;
}

/**
 * A KTX2 cube map of half floats as the asset tool lays one out: the header, the level index,
 * the key-value data with one entry, then each level's six faces, the smallest level first.
 */
function cubeFile({
	vkFormat = 97,
	size = 8,
	faces = 6,
	levels = 2,
	supercompression = 0,
	data = JSON.stringify({ version: 1, sh: Array.from({ length: 27 }, (_, k) => k / 10) }),
	short = 0,
}: FileParts = {}): ArrayBuffer {
	const texel = vkFormat === 123 ? 4 : 8;
	const key = new TextEncoder().encode('null3d.environment\0');
	const value = data === null ? new Uint8Array() : new TextEncoder().encode(`${data}\0`);
	const entry = key.length + value.length;
	const kvd = data === null ? 0 : 4 + entry + ((4 - (entry % 4)) % 4);
	const index = 80 + 24 * levels;
	const sizes = Array.from({ length: levels }, (_, l) => 6 * (size >> l) ** 2 * texel);
	const total = index + kvd + sizes.reduce((a, b) => a + b, 0);
	const bytes = new Uint8Array(total);
	const view = new DataView(bytes.buffer);
	bytes.set(IDENTIFIER);
	for (const [at, word] of [
		[12, vkFormat],
		[16, 1],
		[20, size],
		[24, size],
		[36, faces],
		[40, levels],
		[44, supercompression],
		[56, data === null ? 0 : index],
		[60, kvd],
	] as const)
		view.setUint32(at, word, true);
	if (data !== null) {
		view.setUint32(index, entry, true);
		bytes.set(key, index + 4);
		bytes.set(value, index + 4 + key.length);
	}
	let at = total;
	for (let level = 0; level < levels; level++) {
		at -= sizes[level] as number;
		view.setBigUint64(80 + 24 * level, BigInt(at), true);
		const length = (sizes[level] as number) - (level === levels - 1 ? short : 0);
		view.setBigUint64(88 + 24 * level, BigInt(length), true);
		bytes.fill(level + 1, at, at + (sizes[level] as number));
	}
	return bytes.buffer;
}

describe('environment files', () => {
	test("read the built-in room's cube map and diffuse light", () => {
		const bytes = readFileSync(ROOM);
		const room = readEnvironmentFile(
			bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
		);
		expect([room.size, room.levels, room.format]).toEqual([256, 6, 'rgb9e5ufloat']);
		expect(room.texels.map((level) => level.length)).toEqual(
			[256, 128, 64, 32, 16, 8].map((side) => 6 * side * side * 4),
		);
		expect(room.sh.length).toBe(27);
		expect(room.sh.every(Number.isFinite)).toBe(true);
		// The room is white and lit from above, so its average light is gray and above 0.
		expect(room.sh[0]).toBeGreaterThan(0);
		expect(Math.abs((room.sh[0] as number) - (room.sh[2] as number))).toBeLessThan(0.05);
	});

	test('give each level its own faces, from the largest down', () => {
		const file = readEnvironmentFile(cubeFile());
		expect([file.size, file.levels, file.format]).toEqual([8, 2, 'rgba16float']);
		expect(file.texels.map((level) => [level.length, level[0]])).toEqual([
			[6 * 64 * 8, 1],
			[6 * 16 * 8, 2],
		]);
		expect(file.sh[26]).toBeCloseTo(2.6);
	});

	test('name the built-in room by the file in the package', () => {
		expect(BUILTIN_ENVIRONMENTS.room.pathname).toEndWith('/environments/room.ktx2');
	});

	test('refuse files that are not environment maps, and say why', () => {
		const refusal = (parts: FileParts | ArrayBuffer) => {
			try {
				readEnvironmentFile(parts instanceof ArrayBuffer ? parts : cubeFile(parts));
			} catch (error) {
				return (error as Error).message;
			}
			return 'read';
		};
		expect(refusal(new TextEncoder().encode('not a texture at all, just text').buffer)).toBe(
			'it is not a KTX2 file',
		);
		expect(refusal({ vkFormat: 37 })).toStartWith('its texels have the Vulkan format 37');
		expect(refusal({ faces: 1 })).toBe('it is not a cube map of square faces');
		expect(refusal({ size: 12, levels: 1 })).toStartWith('its faces are 12 texels wide');
		expect(refusal({ supercompression: 2 })).toStartWith('it is supercompressed');
		expect(refusal({ levels: 5 })).toBe('it names 5 mip levels for faces 8 texels wide');
		expect(refusal({ short: 8 })).toStartWith('its level 1 does not hold');
		expect(refusal({ data: null })).toStartWith('it has no null3d.environment data');
		expect(refusal({ data: '{"sh": [1, 2]}' })).toBe(
			'its null3d.environment data holds no 27 numbers of diffuse light',
		);
		expect(refusal({ data: '{sh' })).toBe('its null3d.environment data is not JSON');
	});
});
