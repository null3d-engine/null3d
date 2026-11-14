// The size memo's file: the sizes of the files that earlier size measurings met, by the hash of each
// file's bytes, so that a measuring compresses only the files that changed. tools/lib/size-report.ts
// keeps the memo in memory while it measures; this file reads and writes it. The memo sits under the
// build caches' root, and CI keeps its folder in the Actions cache: each part of a split size check
// reads it, and the step that judges the parts keeps their entries as the next memo. A memo holds
// the files of the newest measuring alone, so it does not grow with the history. It names the set
// of shader modules that it was measured from, which tells CI's build job how many size parts a run
// needs: one when the memo holds this set's sizes, and the full split otherwise.
//   bun tools/lib/size-memo.ts --parts    prints the parts, such as [1], for CI's size-parts matrix
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { cacheDir, cacheOff, writeFileAtomic } from './build-cache';
import { RECORD } from './shader-modules';
import {
	isSizePartFile,
	type PartSpec,
	SIZE_MEMO_STAMP,
	type SizeEntry,
	type SizeMemo,
	sizeMemo,
	sizePartFile,
} from './size-report';

/** The memo's file under the build caches' root, which the environment can move. */
export const sizeMemoPath = (): string => join(cacheDir('size-memo'), 'sizes.json');

/** The file in which a part of a split size check writes the memo entries of its own files. */
export const sizeMemoPartFile = (spec: PartSpec): string => `memo-${sizePartFile(spec)}`;

const isSizeMemoPartFile = (name: string) =>
	name.startsWith('memo-') && isSizePartFile(name.slice('memo-'.length));

/** What a measuring hands on: the entries of the files that it met, and how many it compressed. */
export type MemoEntries = Pick<SizeMemo, 'met' | 'compressed'>;

/**
 * The size parts of a run whose memo lacks the sizes of its shader modules, which hold nearly all of
 * the bytes: enough that each part compresses its share in a few minutes.
 */
export const FULL_SIZE_PARTS = 4;

/**
 * A memo's file: the stamp of its compressors, its entries, how many of them were new, and the
 * `modules` hash of the record of the shader modules that it was measured from.
 */
interface SizeMemoFile {
	stamp: string;
	compressed: number;
	sizes: Record<string, SizeEntry>;
	modules?: string;
}

/** The memo's file in `path` under this runtime's stamp, or null when there is none or it was made under another. */
function readMemoFile(path: string): SizeMemoFile | null {
	try {
		const file = JSON.parse(readFileSync(path, 'utf8')) as SizeMemoFile;
		return file.stamp === SIZE_MEMO_STAMP ? file : null;
	} catch {
		return null;
	}
}

/** The `modules` hash of the record of the shader modules in `root`, or null without a record. */
export function recordedModules(root: string): string | null {
	try {
		return (
			(JSON.parse(readFileSync(join(root, RECORD), 'utf8')) as { modules?: string }).modules ?? null
		);
	} catch {
		return null;
	}
}

/**
 * The memo in `path`, empty when there is none, when another stamp made it, or when the caches are
 * off, as `NULL3D_NO_CACHE=1` asks.
 */
export function readSizeMemo(path = sizeMemoPath()): SizeMemo {
	if (cacheOff()) return sizeMemo();
	return sizeMemo(readMemoFile(path)?.sizes ?? {});
}

/**
 * Writes a measuring's entries to `path`, under the stamp of this runtime's compressors, with the
 * hash of the shader modules that it measured when known.
 */
export function writeSizeMemo(
	path: string,
	{ met, compressed }: MemoEntries,
	modules: string | null = null,
): void {
	mkdirSync(dirname(path), { recursive: true });
	const file: SizeMemoFile = { stamp: SIZE_MEMO_STAMP, compressed, sizes: Object.fromEntries(met) };
	if (modules) file.modules = modules;
	writeFileAtomic(path, `${JSON.stringify(file)}\n`);
}

/**
 * Keeps a measuring's entries as the memo when they would change it: when the measuring compressed
 * a file that the memo lacked, or measured other shader modules than the memo names. A run that
 * changed nothing leaves the memo as it was. Nothing is kept while the caches are off. True when
 * it wrote the memo.
 */
export function keepSizeMemo(
	entries: MemoEntries,
	modules: string | null,
	path = sizeMemoPath(),
): boolean {
	if (cacheOff()) return false;
	if (entries.compressed === 0 && readMemoFile(path)?.modules === (modules ?? undefined))
		return false;
	writeSizeMemo(path, entries, modules);
	return true;
}

/**
 * The size parts that a run needs, numbered from 1: one when the memo holds the sizes of the shader
 * modules that `modules` names, since a part then compresses only the few files that are not shader
 * modules, and FULL_SIZE_PARTS otherwise.
 */
export function sizePartsFor(modules: string | null, path = sizeMemoPath()): number[] {
	const warm = modules !== null && readMemoFile(path)?.modules === modules;
	return Array.from({ length: warm ? 1 : FULL_SIZE_PARTS }, (_, i) => i + 1);
}

/**
 * The entries that every part in `folder` wrote, merged: those of every file of the parts' build.
 * A part's file of another stamp counts as missing, since its sizes do not hold here.
 */
export function mergeSizeMemoParts(folder: string): MemoEntries {
	const names = existsSync(folder) ? readdirSync(folder).filter(isSizeMemoPartFile) : [];
	const met = new Map<string, SizeEntry>();
	let compressed = 0;
	for (const name of names) {
		const part = JSON.parse(readFileSync(join(folder, name), 'utf8')) as SizeMemoFile;
		if (part.stamp !== SIZE_MEMO_STAMP) continue;
		compressed += part.compressed;
		for (const [hash, size] of Object.entries(part.sizes)) met.set(hash, size);
	}
	return { met, compressed };
}

if (import.meta.main) {
	if (!process.argv.includes('--parts'))
		throw new Error('usage: bun tools/lib/size-memo.ts --parts');
	console.log(JSON.stringify(sizePartsFor(recordedModules(join(import.meta.dirname, '../..')))));
}
