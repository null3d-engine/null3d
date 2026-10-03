// Types for the part of the gltfpack package that the meshopt test files use; the package ships none.
declare module 'gltfpack' {
	/** Reads and writes the files that gltfpack names, in place of a file system. */
	export interface GltfpackFiles {
		read(path: string): Uint8Array;
		write(path: string, data: Uint8Array): void;
	}

	/** Runs gltfpack with its command-line arguments, and resolves to its log. */
	export function pack(args: readonly string[], files: GltfpackFiles): Promise<string>;
}
