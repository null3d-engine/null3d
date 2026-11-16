// The record beside the shader compiler that names the inputs of a project's compile. The build
// writes it, and the Vite plugin reads it as the compiler's version. The version covers the
// compiler's own sources, the library modules, the manifest's template tables and the template
// shaders: everything a project's compile can read. An engine entry shader that no project
// compiles is not one of them, so changing it keeps the cache's entries.
//
// A record that is missing or unreadable names no version. The caller then reads the compiler's own
// bytes as its version, which is safe: a change to any shader moves that version, and every entry
// compiles again.
import { readFileSync } from 'node:fs';

/** The record's file name, in the compiler's folder. */
export const COMPILER_STAMP_FILE = 'shader-compiler.stamp.json';

/** The record's format. A record of another format names no version. */
export const COMPILER_STAMP_FORMAT = 1;

/** The version that a record holds, or undefined when it is not one that this code writes. */
export function compilerStampVersion(record: unknown): string | undefined {
	if (typeof record !== 'object' || record === null) return undefined;
	const { format, version } = record as { format?: unknown; version?: unknown };
	if (
		format !== COMPILER_STAMP_FORMAT ||
		typeof version !== 'string' ||
		!/^[0-9a-f]{64}$/.test(version)
	)
		return undefined;
	return version;
}

/** The version that the record at `file` holds, or undefined when it is missing or unreadable. */
export function readCompilerStamp(file: string | URL): string | undefined {
	try {
		return compilerStampVersion(JSON.parse(readFileSync(file, 'utf8')));
	} catch {
		return undefined;
	}
}
