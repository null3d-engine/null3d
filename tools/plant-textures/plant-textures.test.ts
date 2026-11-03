// The plant texture tool's parts on small made-up pictures: which source file a slot reads, the
// outline, the tiling of bark, the leaf's frame and the KTX2 header of a one-layer array. The real
// species' outputs need the private references; the textures package's own test holds each
// committed folder to its manifest.
import { describe, expect, it } from 'bun:test';
import { makeTile, seamRatio } from './bark.ts';
import { signedArea, simplifyTo, traceLoops } from './contour.ts';
import { encodeKtx2 } from './encode.ts';
import { type Picture, picture } from './image.ts';
import { findFrame } from './leaf.ts';
import { jobIds, type SourceFolder, Sources, supersededFiles } from './sources.ts';

const INDEX = `| file | what it shows | why |
| --- | --- | --- |
| \`24-leaf-texture-upper.png\` | Superseded by \`24-leaf-texture-upper-b.png\`: the lobes were tiny | Texture source |
| \`24-leaf-texture-upper-b.png\` | Superseded by \`24-leaf-texture-upper-c.png\`, the same picture with a haze | Texture source |
| \`24-leaf-texture-upper-c.png\` | One leaf on a transparent ground | Texture source |
| \`26-bark-texture.png\` | Mature trunk bark | Texture source |
`;

/** A folder of empty files with an index. */
function folder(names: readonly string[]): SourceFolder {
	return {
		commit: 'local',
		list: () => [...names, 'INDEX.md', 'jobs.jsonl'],
		read: (name) =>
			new TextEncoder().encode(
				name === 'INDEX.md'
					? INDEX
					: name === 'jobs.jsonl'
						? '{"file": "26-bark-texture.png", "job_id": "job-26"}\n'
						: name,
			),
	};
}

describe('the source files of a slot', () => {
	it('skips every row the index marks superseded', () => {
		expect([...supersededFiles(INDEX)].sort()).toEqual([
			'24-leaf-texture-upper-b.png',
			'24-leaf-texture-upper.png',
		]);
	});

	it('reads the remake in use, and a plain slot name, with its job', () => {
		const sources = new Sources(
			folder([
				'24-leaf-texture-upper.png',
				'24-leaf-texture-upper-b.png',
				'24-leaf-texture-upper-c.png',
				'26-bark-texture.png',
			]),
			'oak',
		);
		expect(sources.nameOf(24)).toBe('24-leaf-texture-upper-c.png');
		expect(sources.read(26).job).toBe('job-26');
		expect(sources.nameOf(27)).toBeUndefined();
	});

	it('refuses a slot with two files in use', () => {
		const sources = new Sources(folder(['26-bark-texture.png', '26-bark-texture-b.png']), 'oak');
		expect(() => sources.nameOf(26)).toThrow('2 files in use');
	});

	it('finds the job of a file renamed on publishing by its final name', () => {
		const jobs = jobIds(
			[
				'{"file": "24-leaf-texture-upper.png", "job_id": "first", "in_repository": false}',
				'{"file": "24-leaf-texture-upper-b.png", "job_id": "remake", "rejected": "haze", "in_repository": false}',
				'{"file": "24-leaf-texture-upper-c.png", "job_id": "kept", "final_name": "24-leaf-texture-upper.png"}',
				'{"file": "26-bark-texture.png", "job_id": "bark"}',
			].join('\n'),
		);
		expect(Object.fromEntries(jobs)).toEqual({
			'24-leaf-texture-upper.png': 'kept',
			'26-bark-texture.png': 'bark',
		});
	});
});

/** A picture of `size` texels whose coverage is 1 inside `inside`. */
function shape(size: number, inside: (x: number, y: number) => boolean): Picture {
	const p = picture(size, size);
	for (let y = 0; y < size; y++)
		for (let x = 0; x < size; x++) {
			const i = y * size + x;
			if (inside(x + 0.5, y + 0.5)) {
				p.a[i] = 1;
				p.g[i] = 0.3;
			}
		}
	return p;
}

describe('the outline', () => {
	it('traces a disc as one loop, thinned to between 24 and 64 points', () => {
		const disc = shape(64, (x, y) => (x - 32) * (x - 32) + (y - 32) * (y - 32) < 400);
		const loops = traceLoops({ width: 64, height: 64, data: disc.a }, 0.5);
		expect(loops.length).toBe(1);
		const loop = loops[0] as (typeof loops)[number];
		// Half the shoelace sum is the area, within 2 per cent of π·20² texels.
		expect(Math.abs(Math.abs(signedArea(loop)) / 2 / (Math.PI * 400) - 1)).toBeLessThan(0.02);
		const thinned = simplifyTo(loop, 24, 64);
		expect(thinned.length).toBeGreaterThanOrEqual(24);
		expect(thinned.length).toBeLessThanOrEqual(64);
	});
});

describe('the leaf frame', () => {
	it('puts the petiole at the narrow stalk and the tip at the blade end, whichever way up', () => {
		// A blade as an ellipse with a thin stalk below it, then the same turned upside down.
		const leaf = (flip: boolean) =>
			shape(128, (x, yy) => {
				const y = flip ? 128 - yy : yy;
				const blade = ((x - 64) / 30) ** 2 + ((y - 50) / 40) ** 2 < 1;
				const stalk = Math.abs(x - 64) < 2 && y >= 85 && y < 118;
				return blade || stalk;
			});
		const up = findFrame(leaf(false));
		expect(up.petiole[1]).toBeGreaterThan(110);
		expect(up.tip[1]).toBeLessThan(15);
		expect(up.petiole[0]).toBeCloseTo(64, 0);
		const down = findFrame(leaf(true));
		expect(down.petiole[1]).toBeLessThan(18);
		expect(down.tip[1]).toBeGreaterThan(113);
	});
});

describe('the bark tile', () => {
	it('wraps across and down with seams no stronger than the steps inside', () => {
		const n = 64;
		const extra = 8;
		const p = picture(n + extra, n + extra);
		let seed = 7;
		for (let i = 0; i < p.r.length; i++) {
			seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
			const v = (seed >>> 8) / 16777216;
			const x = i % (n + extra);
			// Vertical grain: columns of slowly changing tone with noise on them.
			p.r[i] = 0.3 + 0.2 * (((x * 7) % 23) / 23) + 0.05 * v;
			p.g[i] = p.r[i] as number;
			p.b[i] = p.r[i] as number;
			p.a[i] = 1;
		}
		const tile = makeTile(p, n);
		expect(tile.width).toBe(n);
		expect(tile.height).toBe(n);
		const seams = seamRatio(tile);
		expect(seams.across).toBeLessThan(1.5);
		expect(seams.down).toBeLessThan(1.5);
	});
});

describe('the KTX2 files', () => {
	it('write a texture array of one layer with a layer count of one', async () => {
		const size = 8;
		const texels = new Uint8Array(size * size * 4).fill(200);
		const file = await encodeKtx2({
			layers: [texels],
			size,
			kind: 'normal',
			array: true,
			tile: false,
			quality: 128,
		});
		expect(new DataView(file.buffer).getUint32(32, true)).toBe(1);
		const plain = await encodeKtx2({
			layers: [texels],
			size,
			kind: 'color',
			array: false,
			tile: true,
			quality: 128,
		});
		expect(new DataView(plain.buffer).getUint32(32, true)).toBe(0);
	});
});
