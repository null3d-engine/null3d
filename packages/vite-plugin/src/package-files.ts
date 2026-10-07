import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** A published package of the @null3d scope: its name and its folder. */
export interface Null3dPackage {
	name: string;
	root: string;
}

/**
 * Finds the null3D package that a file belongs to: the nearest package.json above the file, when
 * it names a published package of the @null3d scope. This holds for an installed package and for
 * a package's source in a copy of the repository, where the project may not install it. Each
 * folder's answer is kept for later files.
 */
export function null3dPackages(): (file: string) => Null3dPackage | undefined {
	const folders = new Map<string, Null3dPackage | null>();
	const packageOf = (folder: string): Null3dPackage | null => {
		let known = folders.get(folder);
		if (known === undefined) {
			const manifest = join(folder, 'package.json');
			const parent = dirname(folder);
			if (existsSync(manifest)) {
				const name = null3dPackageName(manifest);
				known = name === undefined ? null : { name, root: folder };
			} else known = parent === folder ? null : packageOf(parent);
			folders.set(folder, known);
		}
		return known;
	};
	return (file) => packageOf(dirname(file)) ?? undefined;
}

/** The name in the package.json at `manifest`, when it names a published package of the @null3d scope. */
function null3dPackageName(manifest: string): string | undefined {
	try {
		const { name, private: unpublished } = JSON.parse(readFileSync(manifest, 'utf8'));
		return typeof name === 'string' && name.startsWith('@null3d/') && unpublished !== true
			? name
			: undefined;
	} catch {
		return undefined;
	}
}
