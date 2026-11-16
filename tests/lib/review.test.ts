import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseReviewArgs } from '../review-images.ts';
import {
	compareWithReference,
	type HarnessDirs,
	type ImageTest,
	imageRuns,
	type Place,
	readPng,
	writePng,
} from './images.ts';
import { acceptCandidates, readCandidates, reviewLines, reviewPage } from './review.ts';

const TESTS: readonly ImageTest[] = [
	{ name: 'boxes', sketch: 'sketches/boxes.ts', hold: 1, size: [2, 1], tiers: ['webgl2'] },
	{
		name: 'boxes-copied',
		sketch: 'sketches/boxes.ts',
		hold: 1,
		size: [2, 1],
		tiers: ['webgl2'],
		reference: 'boxes',
	},
	{ name: 'grid', page: 'pages/grid.html', size: [2, 1], tiers: ['webgpu'] },
];
const [BOXES, BOXES_COPIED, GRID] = imageRuns(TESTS) as [
	ReturnType<typeof imageRuns>[number],
	ReturnType<typeof imageRuns>[number],
	ReturnType<typeof imageRuns>[number],
];
const REAL: Place = { environment: 'chrome-real-gpu' };
const SAFARI: Place = { runner: 'mac-safari', device: 'mac' };
const SWIFT: Place = { environment: 'chromium-swiftshader' };

const image = (red: number) => ({
	width: 2,
	height: 1,
	data: new Uint8Array([red, 0, 0, 255, 0, 0, 0, 255]),
});

let dirs: HarnessDirs;
beforeEach(() => {
	const root = mkdtempSync(join(tmpdir(), 'null3d-review-'));
	dirs = {
		references: join(root, 'references'),
		candidates: join(root, 'candidates'),
		drawn: join(root, 'drawn'),
	};
	// grid is new; boxes changed on the real GPU; the copied uploads and Safari compare with boxes.
	compareWithReference(GRID, REAL, image(10), dirs);
	writePng(join(dirs.references, 'chrome-real-gpu/webgl2/boxes.png'), image(10));
	compareWithReference(BOXES, REAL, image(200), dirs);
	compareWithReference(BOXES_COPIED, REAL, image(90), dirs);
	compareWithReference(BOXES, SAFARI, image(250), dirs);
});
afterEach(() => rmSync(join(dirs.references, '..'), { recursive: true, force: true }));

describe('the review', () => {
	it('finds every candidate, in order, and skips other files', () => {
		writeFileSync(join(dirs.candidates, 'results.json'), '{"ok":true}');
		mkdirSync(join(dirs.candidates, 'empty'));
		const candidates = readCandidates(dirs.candidates);
		expect(candidates.map(({ test, drawnIn, status }) => `${test} ${drawnIn} ${status}`)).toEqual([
			'boxes chrome-real-gpu changed',
			'boxes mac-safari changed',
			'boxes-copied chrome-real-gpu changed',
			'grid chrome-real-gpu new',
		]);
		expect(readCandidates(join(dirs.candidates, 'missing'))).toEqual([]);
	});

	it('lists each candidate with its files, and says which can become references', () => {
		const candidates = readCandidates(dirs.candidates);
		const lines = reviewLines(candidates, join(dirs.candidates, 'review.html'));
		expect(lines[0]).toBe('boxes on webgl2, drawn in chrome-real-gpu, pipelined');
		expect(lines[1]).toBe(
			'  Changed: 50.000% of pixels differ from chrome-real-gpu/webgl2/boxes.png, and at most 0.100% may.',
		);
		expect(
			lines.filter((line) => line.startsWith('  It cannot become the reference')),
		).toHaveLength(2);
		expect(lines.at(-1)).toBe(
			"Accept the 2 images that can become references with bun run images:review --accept, or only some tests' images with --accept boxes.",
		);
		expect(reviewLines([], 'review.html')).toEqual(['No new or changed images to review.']);
		const fetched = reviewLines(candidates, 'review.html', join(dirs.candidates, 'run'));
		expect(fetched.at(-1)).toContain(
			`with bun run images:review --from ${join(dirs.candidates, 'run')} --accept,`,
		);
	});

	it('shows each candidate on the page beside its reference and its diff', () => {
		const page = reviewPage(readCandidates(dirs.candidates), dirs.candidates);
		expect(page).toContain(
			'<img src="chrome-real-gpu/webgl2/boxes-reference.png" alt="Reference">',
		);
		expect(page).toContain('<img src="chrome-real-gpu/webgl2/boxes.png" alt="New image">');
		expect(page).toContain('<img src="chrome-real-gpu/webgl2/boxes-diff.png" alt="Diff">');
		expect(page).toContain('<img src="chrome-real-gpu/webgpu/grid.png" alt="New image">');
		expect(page).toContain('4 new or changed images');
	});

	it('makes the candidates that can become references into references, and removes them', () => {
		const accepted = acceptCandidates(readCandidates(dirs.candidates), dirs.references);
		expect(accepted.written.map((file) => file.split('references/')[1])).toEqual([
			'chrome-real-gpu/webgl2/boxes.png',
			'chrome-real-gpu/webgpu/grid.png',
		]);
		expect(accepted.refused).toHaveLength(2);
		expect(readPng(join(dirs.references, 'chrome-real-gpu/webgl2/boxes.png'))).toEqual(image(200));
		expect(readPng(join(dirs.references, 'chrome-real-gpu/webgpu/grid.png'))).toEqual(image(10));
		expect(readdirSync(join(dirs.candidates, 'chrome-real-gpu/webgl2')).sort()).toEqual([
			'boxes-copied-diff.png',
			'boxes-copied-reference.png',
			'boxes-copied.json',
			'boxes-copied.png',
		]);
		expect(existsSync(join(dirs.candidates, 'chrome-real-gpu/webgpu/grid.json'))).toBe(false);
	});

	it('accepts only the tests named, and says why it leaves the others', () => {
		const accepted = acceptCandidates(readCandidates(dirs.candidates), dirs.references, [
			'grid',
			'boxes-copied',
			'lights',
		]);
		expect(accepted.written).toHaveLength(1);
		expect(accepted.refused).toEqual([
			'boxes-copied on webgl2, drawn in chrome-real-gpu, pipelined: it cannot become the reference: boxes-copied must draw the image of boxes, which alone makes this reference',
			'lights: no candidate to accept',
		]);
		expect(existsSync(join(dirs.references, 'chrome-real-gpu/webgl2/boxes.png'))).toBe(true);
		expect(readPng(join(dirs.references, 'chrome-real-gpu/webgl2/boxes.png'))).toEqual(image(10));
	});

	it('leaves a reference that two candidates would both write', () => {
		const [first] = readCandidates(dirs.candidates);
		if (!first) throw new Error('no candidate');
		const twin = { ...first, drawnIn: 'chrome-real-gpu-2' };
		const accepted = acceptCandidates([first, twin], dirs.references);
		expect(accepted.written).toEqual([]);
		expect(accepted.refused[0]).toContain('would both write it');
	});
});

describe('a SwiftShader reference', () => {
	const drawn = (env: Record<string, string | undefined>, red = 10) => {
		const kept = { actions: process.env.GITHUB_ACTIONS, run: process.env.GITHUB_RUN_ID };
		process.env.GITHUB_ACTIONS = env.GITHUB_ACTIONS;
		process.env.GITHUB_RUN_ID = env.GITHUB_RUN_ID;
		if (env.GITHUB_ACTIONS === undefined) delete process.env.GITHUB_ACTIONS;
		if (env.GITHUB_RUN_ID === undefined) delete process.env.GITHUB_RUN_ID;
		try {
			compareWithReference(GRID, SWIFT, image(red), dirs);
		} finally {
			if (kept.actions === undefined) delete process.env.GITHUB_ACTIONS;
			else process.env.GITHUB_ACTIONS = kept.actions;
			if (kept.run === undefined) delete process.env.GITHUB_RUN_ID;
			else process.env.GITHUB_RUN_ID = kept.run;
		}
		return readCandidates(dirs.candidates).filter((c) => c.drawnIn === 'chromium-swiftshader');
	};
	const target = () => join(dirs.references, 'chromium-swiftshader/webgpu/grid.png');
	const record = () => join(dirs.references, '..', 'local-references.json');

	it('is refused from this machine, naming the test, the file and the way to take it from CI', () => {
		const candidates = drawn({});
		expect(candidates[0]?.ciRun).toBeUndefined();
		const accepted = acceptCandidates(candidates, dirs.references, undefined, { record: record() });
		expect(accepted.written).toEqual([]);
		expect(accepted.refused).toHaveLength(1);
		expect(accepted.refused[0]).toContain('grid on webgpu, drawn in chromium-swiftshader');
		expect(accepted.refused[0]).toContain(
			'chromium-swiftshader/webgpu/grid.png was drawn on this machine, not by CI',
		);
		expect(accepted.refused[0]).toContain('bun run images:review --ci <run> --accept grid');
		expect(existsSync(target())).toBe(false);
		expect(existsSync(record())).toBe(false);
	});

	it("is taken from CI's own drawing, or from a CI run that the review fetched", () => {
		const fromCi = drawn({ GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '42' });
		expect(fromCi[0]?.ciRun).toBe('42');
		expect(
			acceptCandidates(fromCi, dirs.references, undefined, { record: record() }).refused,
		).toEqual([]);
		expect(existsSync(target())).toBe(true);
		rmSync(target());
		// A local CI=1 run sets no GitHub variable, so only a fetched run vouches for its images.
		const fetched = drawn({});
		const accepted = acceptCandidates(fetched, dirs.references, undefined, {
			ciRun: '7',
			record: record(),
		});
		expect(accepted.refused).toEqual([]);
		expect(existsSync(target())).toBe(true);
	});

	it('reads a picture that a run kept for its drawings, without a diff, and accepts it', () => {
		const kept = process.env.NULL3D_TAKE_IMAGES;
		process.env.NULL3D_TAKE_IMAGES = '1';
		try {
			drawn({ GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '42' });
		} finally {
			if (kept === undefined) delete process.env.NULL3D_TAKE_IMAGES;
			else process.env.NULL3D_TAKE_IMAGES = kept;
		}
		const folder = join(dirs.drawn as string, 'chromium-swiftshader');
		const [drawing] = readCandidates(folder);
		expect(drawing).toMatchObject({ test: 'grid', status: 'drawn', ciRun: '42' });
		expect(reviewLines(readCandidates(folder), 'review.html')[0]).toBe(
			'grid on webgpu, drawn in chromium-swiftshader',
		);
		const accepted = acceptCandidates(readCandidates(folder), dirs.references, undefined, {
			record: record(),
		});
		expect(accepted.refused).toEqual([]);
		expect(readPng(target())).toEqual(image(10));
	});

	it('is taken from this machine only with a reason, which the record keeps until CI draws it', () => {
		const accepted = acceptCandidates(drawn({}), dirs.references, undefined, {
			localReason: 'CI cannot run this page yet',
			record: record(),
			today: '2026-10-25',
		});
		expect(accepted.refused).toEqual([]);
		expect(JSON.parse(readFileSync(record(), 'utf8'))).toEqual({
			'chromium-swiftshader/webgpu/grid.png': {
				test: 'grid',
				tier: 'webgpu',
				date: '2026-10-25',
				reason: 'CI cannot run this page yet',
			},
		});
		acceptCandidates(
			drawn({ GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '43' }, 200),
			dirs.references,
			undefined,
			{
				record: record(),
			},
		);
		expect(JSON.parse(readFileSync(record(), 'utf8'))).toEqual({});
	});
});

describe('parseReviewArgs', () => {
	it('reads what to accept and where the images are', () => {
		expect(parseReviewArgs([])).toEqual({});
		expect(parseReviewArgs(['--accept'])).toEqual({ accept: [] });
		expect(parseReviewArgs(['--accept', 'scene,held'])).toEqual({ accept: ['scene', 'held'] });
		expect(parseReviewArgs(['--accept', '--from', 'dl'])).toEqual({ accept: [], from: 'dl' });
		expect(parseReviewArgs(['--ci', '18712345678'])).toEqual({ ci: '18712345678' });
		expect(() => parseReviewArgs(['--ci', 'latest'])).toThrow('unknown option --ci');
		expect(() => parseReviewArgs(['--from', 'a', '--ci', '1'])).toThrow('use --from or --ci');
		expect(parseReviewArgs(['--accept', '--local-reason', 'a page CI cannot run'])).toEqual({
			accept: [],
			localReason: 'a page CI cannot run',
		});
		expect(() => parseReviewArgs(['--local-reason'])).toThrow('unknown option --local-reason');
	});
});
