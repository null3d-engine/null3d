import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { decode, encode } from 'fast-png';
import pixelmatch from 'pixelmatch';
import { REPO_ROOT } from './server.ts';

const REFERENCE_DIR = join(import.meta.dirname, '../image/references');
const FAILURE_DIR = join(import.meta.dirname, '../../test-results/images');

export interface CompareOptions {
	/** Per-pixel color distance that counts as a difference, from 0 to 1. */
	threshold?: number;
	/** Share of pixels that may differ before the test fails. */
	maxDiffRatio?: number;
	/** The folder of the reference images, one subfolder per GPU tier. */
	referenceDir?: string;
	/** The folder where a failure writes the actual image and the diff, one subfolder per tier. */
	failureDir?: string;
}

function writePng(path: string, rgba: Uint8Array, width: number, height: number): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, encode({ width, height, data: rgba, channels: 4, depth: 8 }));
}

/**
 * Compares RGBA8 pixels with the reference image for one GPU tier. With UPDATE_REFERENCES=1 it
 * writes the reference instead. A failure writes the actual image and a diff under test-results/,
 * and so does a missing reference, so a run on another machine can supply it.
 */
export function compareToReference(
	name: string,
	tier: string,
	rgba: Uint8Array,
	width: number,
	height: number,
	{
		threshold = 0.1,
		maxDiffRatio = 0.001,
		referenceDir = REFERENCE_DIR,
		failureDir = FAILURE_DIR,
	}: CompareOptions = {},
): void {
	const referencePath = join(referenceDir, tier, `${name}.png`);
	if (process.env.UPDATE_REFERENCES === '1') {
		writePng(referencePath, rgba, width, height);
		return;
	}
	if (!existsSync(referencePath)) {
		writePng(join(failureDir, tier, `${name}-actual.png`), rgba, width, height);
		throw new Error(
			`no reference image ${referencePath}; run with UPDATE_REFERENCES=1 and review it`,
		);
	}
	const reference = decode(readFileSync(referencePath));
	if (reference.width !== width || reference.height !== height) {
		throw new Error(
			`${name} on ${tier}: size ${width}x${height} differs from the reference ${reference.width}x${reference.height}`,
		);
	}
	const diff = new Uint8Array(width * height * 4);
	const mismatched = pixelmatch(reference.data as Uint8Array, rgba, diff, width, height, {
		threshold,
	});
	const ratio = mismatched / (width * height);
	if (ratio > maxDiffRatio) {
		writePng(join(failureDir, tier, `${name}-actual.png`), rgba, width, height);
		writePng(join(failureDir, tier, `${name}-diff.png`), diff, width, height);
		throw new Error(
			`${name} on ${tier}: ${(ratio * 100).toFixed(3)}% of pixels differ (at most ${(maxDiffRatio * 100).toFixed(3)}%). See ${relative(REPO_ROOT, join(failureDir, tier))}.`,
		);
	}
}
