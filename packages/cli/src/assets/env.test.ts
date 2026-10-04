import { afterAll, describe, expect, it, setDefaultTimeout, spyOn } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { samplePath } from '../../../../tools/lib/samples.ts';
import { main } from '../cli.js';
import { parseEnvArgs, readEnvironment } from './env.js';
import { environmentMap } from './formats.js';

// A built-in environment takes a few seconds on a busy machine or a CI runner of four cores.
setDefaultTimeout(60_000);

const ROOT = join(import.meta.dir, '../../../..');

/** The engine's built-in environments, which the tool writes and the engine's package ships. */
const BUILTIN_FILES = { room: join(ROOT, 'packages/engine/environments/room.ktx2') };

/**
 * Set to write the built-in environments again, after a change that their files must take:
 * NULL3D_WRITE_ENVIRONMENTS=1 bun test packages/cli/src/assets/env.test.ts
 */
const WRITE = process.env.NULL3D_WRITE_ENVIRONMENTS !== undefined;

const work = mkdtempSync(join(tmpdir(), 'null3d-env-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

/** A Radiance file of flat rows: `light` gives each texel's RGB from its direction. */
function radianceFile(width: number, height: number, light: (d: number[]) => number[]): Uint8Array {
	const head = new TextEncoder().encode(
		`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`,
	);
	const out = new Uint8Array(head.length + 4 * width * height);
	out.set(head);
	let at = head.length;
	for (let y = 0; y < height; y++) {
		const theta = (0.5 - (y + 0.5) / height) * Math.PI;
		for (let x = 0; x < width; x++) {
			const phi = ((x + 0.5) / width - 0.5) * 2 * Math.PI;
			const d = [Math.cos(theta) * Math.cos(phi), Math.sin(theta), Math.cos(theta) * Math.sin(phi)];
			const rgb = light(d);
			const largest = Math.max(...rgb);
			if (largest < 1e-32) at += 4;
			else {
				const e = Math.floor(Math.log2(largest)) + 1;
				const scale = 256 / 2 ** e;
				out.set([...rgb.map((c) => Math.floor(c * scale)), e + 128], at);
				at += 4;
			}
		}
	}
	return out;
}

/** The nine coefficients' red values. */
const reds = (sh: number[]) => sh.filter((_, i) => i % 3 === 0);

describe('assets env options', () => {
	it('takes an input and an output, with the size and format defaults', () => {
		const args = parseEnvArgs(['sky.hdr', 'out/sky.ktx2']);
		expect(args.settings).toEqual({ size: 256, format: 'rgb9e5ufloat' });
		expect('path' in args.source && args.source.path.endsWith('sky.hdr')).toBe(true);
		expect(parseEnvArgs(['--builtin', 'room', 'room.ktx2']).source).toEqual({ builtin: 'room' });
		expect(
			parseEnvArgs(['a.exr', 'b.ktx2', '--size', '512', '--format', 'rgba16float']).settings,
		).toEqual({
			size: 512,
			format: 'rgba16float',
		});
	});

	it('says what is wrong with its options', () => {
		expect(() => parseEnvArgs(['sky.hdr'])).toThrow('an input .hdr or .exr file and an output');
		expect(() => parseEnvArgs(['a.hdr', 'b.ktx2', '--size', '300'])).toThrow('a power of 2');
		expect(() => parseEnvArgs(['a.hdr', 'b.ktx2', '--size', '4096'])).toThrow('from 32 to 2048');
		expect(() => parseEnvArgs(['a.hdr', 'b.ktx2', '--format', 'rgba8'])).toThrow('rgb9e5ufloat or');
		expect(() => parseEnvArgs(['a.hdr', 'b.png'])).toThrow('a .ktx2 file');
		expect(() => parseEnvArgs(['--builtin', 'garden', 'b.ktx2'])).toThrow('room');
		expect(() => parseEnvArgs(['--builtin', 'room', 'a.hdr', 'b.ktx2'])).toThrow('only an output');
	});
});

describe('environment maps', () => {
	it('give a constant environment one coefficient and the same light on every level', () => {
		const file = environmentMap(
			{ file: radianceFile(64, 32, () => [1.5, 0.75, 0.375]) },
			{ size: 32, format: 'rgb9e5ufloat', samples: 64 },
		);
		const env = readEnvironment(file);
		expect(env.size).toBe(32);
		expect(env.levels.map((l) => l.length)).toEqual([32, 16, 8].map((s) => 6 * s * s * 4));
		[0, 1 - Math.sqrt(0.5), 1].forEach((r, i) => {
			expect(env.roughness[i]).toBeCloseTo(r, 6);
		});
		const first = 0.282095 * 4 * Math.PI;
		expect(env.sh[0]).toBeCloseTo(1.5 * first, 3);
		expect(env.sh[1]).toBeCloseTo(0.75 * first, 3);
		expect(env.sh[2]).toBeCloseTo(0.375 * first, 3);
		for (const c of env.sh.slice(3)) expect(Math.abs(c)).toBeLessThan(1e-3);
		const view = new DataView(file.buffer, file.byteOffset);
		for (const { offset, length } of env.levels)
			for (let at = offset; at < offset + length; at += 4) {
				const t = view.getUint32(at, true);
				const unit = 2 ** ((t >>> 27) - 24);
				expect((t & 511) * unit).toBeCloseTo(1.5, 2);
			}
	});

	it('give a sky from above the coefficients of its integrals', () => {
		// Light max(0, y): over the upper hemisphere, y integrates to pi, y squared to 2 pi / 3, y
		// cubed to pi / 2, and y times x squared or z squared to pi / 4.
		const file = environmentMap(
			{ file: radianceFile(256, 128, (d) => [Math.max(0, d[1] as number), 0, 0]) },
			{ size: 64, format: 'rgba16float', samples: 64 },
		);
		const expected = [
			0.282095 * Math.PI,
			(0.488603 * 2 * Math.PI) / 3,
			0,
			0,
			0,
			0,
			0.315392 * ((3 * Math.PI) / 4 - Math.PI),
			0,
			0.546274 * (Math.PI / 4 - Math.PI / 2),
		];
		reds(readEnvironment(file).sh).forEach((c, i) => {
			expect(Math.abs(c - (expected[i] as number))).toBeLessThan(0.01);
		});
	});

	it('read an OpenEXR file as its Radiance twin', () => {
		const settings = { size: 32, format: 'rgb9e5ufloat', samples: 64 } as const;
		const read = (path: string) =>
			readEnvironment(environmentMap({ file: new Uint8Array(readFileSync(path)) }, settings));
		const exr = read(samplePath('sources/hdri/polyhaven/studio_small_09/studio_small_09_1k.exr'));
		const hdr = read(samplePath('sources/hdri/polyhaven/studio_small_09/studio_small_09_2k.hdr'));
		for (let i = 0; i < 27; i++)
			expect(Math.abs((exr.sh[i] as number) - (hdr.sh[i] as number))).toBeLessThan(
				0.02 * (hdr.sh[i % 3] as number),
			);
	});

	it('give the same bytes on every run, and the built-in files hold them', () => {
		for (const [name, path] of Object.entries(BUILTIN_FILES)) {
			const built = environmentMap({ builtin: name }, { size: 256, format: 'rgb9e5ufloat' });
			if (WRITE) {
				mkdirSync(join(path, '..'), { recursive: true });
				writeFileSync(path, built);
			}
			expect(Buffer.from(built).equals(readFileSync(path))).toBe(true);
		}
		const sky = { file: radianceFile(64, 32, (d) => [1 + (d[0] as number), 1, 0.5]) };
		const a = environmentMap(sky, { size: 32, format: 'rgb9e5ufloat', samples: 32 });
		const b = environmentMap(sky, { size: 32, format: 'rgb9e5ufloat', samples: 32 });
		expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
	});

	it('say why a file cannot be read', () => {
		const settings = { size: 32, format: 'rgb9e5ufloat' } as const;
		expect(() => environmentMap({ file: new TextEncoder().encode('GIF89a') }, settings)).toThrow(
			'neither a Radiance file',
		);
		const cut = radianceFile(16, 8, () => [1, 1, 1]);
		expect(() => environmentMap({ file: cut.subarray(0, cut.length - 3) }, settings)).toThrow(
			'ends before its last row',
		);
	});
});

describe('the assets env command', () => {
	it('writes the map and reports its levels and size', async () => {
		const input = join(work, 'sky.hdr');
		writeFileSync(
			input,
			radianceFile(64, 32, (d) => [1, 1 + (d[1] as number), 1]),
		);
		const output = join(work, 'out', 'sky.ktx2');
		const log = spyOn(console, 'log').mockImplementation(() => {});
		try {
			expect(await main(['assets', 'env', input, output, '--size', '32'])).toBe(0);
			const printed = log.mock.calls.flat().join('\n');
			expect(printed).toContain(
				'32 x 32 faces, rgb9e5ufloat, 3 levels for roughness 0.00, 0.29, 1.00',
			);
			expect(printed).toContain('GPU memory: 31.5 KB');
		} finally {
			log.mockRestore();
		}
		expect(readEnvironment(new Uint8Array(readFileSync(output))).levels).toHaveLength(3);
	});

	it('fails with a message for a missing or unreadable input', async () => {
		const error = spyOn(console, 'error').mockImplementation(() => {});
		try {
			expect(await main(['assets', 'env', join(work, 'none.hdr'), join(work, 'a.ktx2')])).toBe(1);
			const bad = join(work, 'bad.hdr');
			writeFileSync(bad, 'not a radiance file');
			expect(await main(['assets', 'env', bad, join(work, 'b.ktx2')])).toBe(1);
			const printed = error.mock.calls.flat().join('\n');
			expect(printed).toContain('does not exist');
			expect(printed).toContain('neither a Radiance file');
		} finally {
			error.mockRestore();
		}
	});
});
