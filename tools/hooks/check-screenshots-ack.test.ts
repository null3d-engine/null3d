import { describe, expect, it } from 'bun:test';
import type { ShotEntry } from '../lib/docs';
import type { CommitWithFiles } from './check-gpu-ack';
import {
	SCREENSHOTS_TRAILER,
	screenshotsProblem,
	unmatchedScreenshots,
} from './check-screenshots-ack';

const ENTRY: ShotEntry = {
	id: 'concepts/instances/instances',
	pages: ['concepts/instances#under the opening paragraphs'],
	source: 'reference',
	images: ['webgpu/demo-instances.png'],
	alt: 'A field of columns.',
	caption: 'One dynamic batch.',
	files: [
		'examples/instances/',
		'tests/image/references/chrome-real-gpu/webgpu/demo-instances.png',
	],
	verdict: 'shots-concepts__instances.md',
};

const PICTURE = 'docs/images/concepts/instances/instances.webp';
const commit = (
	files: readonly string[],
	message = 'feat(examples): move the columns',
): CommitWithFiles => ({
	sha: 'abc',
	message,
	files,
});

describe('unmatchedScreenshots', () => {
	it('flags a changed demo whose picture the range does not redraw', () => {
		expect(
			unmatchedScreenshots([commit(['examples/instances/sketch.ts'])], [ENTRY], () => true),
		).toEqual([PICTURE]);
	});

	it('accepts a range that redraws the picture', () => {
		expect(
			unmatchedScreenshots(
				[commit(['examples/instances/sketch.ts', PICTURE])],
				[ENTRY],
				() => true,
			),
		).toEqual([]);
	});

	it('flags a changed reference image', () => {
		expect(
			unmatchedScreenshots(
				[commit(['tests/image/references/chrome-real-gpu/webgpu/demo-instances.png'])],
				[ENTRY],
				() => true,
			),
		).toEqual([PICTURE]);
	});

	it('matches a file below a folder that the shot names', () => {
		const nested = { ...ENTRY, files: ['examples/instances/'] };
		expect(
			unmatchedScreenshots([commit(['examples/instances/lib/columns.ts'])], [nested], () => true),
		).toEqual([PICTURE]);
	});

	it('ignores a shot whose picture does not exist yet', () => {
		expect(
			unmatchedScreenshots([commit(['examples/instances/sketch.ts'])], [ENTRY], () => false),
		).toEqual([]);
	});

	it('ignores a range that changes nothing the shot names', () => {
		expect(
			unmatchedScreenshots([commit(['docs/concepts/handles.md'])], [ENTRY], () => true),
		).toEqual([]);
	});
});

describe('the screenshot trailer check', () => {
	it('passes a range that redraws every picture it moves', () => {
		expect(
			screenshotsProblem([commit(['examples/instances/sketch.ts', PICTURE])], [ENTRY], () => true),
		).toBeNull();
	});

	it('refuses a stale picture without a trailer', () => {
		const problem = screenshotsProblem(
			[commit(['examples/instances/sketch.ts'])],
			[ENTRY],
			() => true,
		);
		expect(problem).toContain(PICTURE);
		expect(problem).toContain(`${SCREENSHOTS_TRAILER}: trailer`);
	});

	it('accepts a trailer that gives the reason', () => {
		const message = `feat(examples): move the columns\n\n${SCREENSHOTS_TRAILER}: the columns stay outside the camera's first view`;
		expect(
			screenshotsProblem([commit(['examples/instances/sketch.ts'], message)], [ENTRY], () => true),
		).toBeNull();
	});

	it('refuses a bare trailer value', () => {
		const message = `feat(examples): move the columns\n\n${SCREENSHOTS_TRAILER}: done`;
		const problem = screenshotsProblem(
			[commit(['examples/instances/sketch.ts'], message)],
			[ENTRY],
			() => true,
		);
		expect(problem).toContain('gives no reason');
	});
});
