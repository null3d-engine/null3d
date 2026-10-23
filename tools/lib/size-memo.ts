// The size memo's file: the sizes of the files that earlier size measurings met, by the hash of each
// file's bytes, so that a measuring compresses only the files that changed. tools/lib/size-report.ts
// keeps the memo in memory while it measures; this file reads and writes it. The memo sits under the
// build caches' root, and CI keeps its folder in the Actions cache: each part of a split size check
// reads it, and the step that judges the parts keeps their entries as the next memo. A memo holds
// the files of the newest measuring alone, so it does not grow with the history.
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { cacheDir, cacheOff, writeFileAtomic } from './build-cache';
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

/** A memo's file: the stamp of its compressors, its entries, and how many of them were new. */
interface SizeMemoFile {
	stamp: string;
	compressed: number;
	sizes: Record<string, SizeEntry>;
}

/**
 * The memo in `path`, empty when there is none, when another stamp made it, or when the caches are
 * off, as `NULL3D_NO_CACHE=1` asks.
 */
export function readSizeMemo(path = sizeMemoPath()): SizeMemo {
	if (cacheOff()) return sizeMemo();
	try {
		const file = JSON.parse(readFileSync(path, 'utf8')) as SizeMemoFile;
		return sizeMemo(file.stamp === SIZE_MEMO_STAMP ? file.sizes : {});
	} catch {
		return sizeMemo();
	}
}

/** Writes a measuring's entries to `path`, under the stamp of this runtime's compressors. */
export function writeSizeMemo(path: string, { met, compressed }: MemoEntries): void {
	mkdirSync(dirname(path), { recursive: true });
	const file: SizeMemoFile = { stamp: SIZE_MEMO_STAMP, compressed, sizes: Object.fromEntries(met) };
	writeFileAtomic(path, `${JSON.stringify(file)}\n`);
}

/**
 * Keeps a measuring's entries as the memo when it compressed a file that the memo lacked, so a run
 * that changed no file leaves the memo as it was. Nothing is kept while the caches are off.
 * True when it wrote the memo.
 */
export function keepSizeMemo(entries: MemoEntries, path = sizeMemoPath()): boolean {
	if (entries.compressed === 0 || cacheOff()) return false;
	writeSizeMemo(path, entries);
	return true;
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
