// The engine's version, and the check that an add-on runs against it. An add-on ships in step with
// the engine and pins the engine version it was built for, so a page that mixes versions stops at
// the import with a message that names both. The module reads the error class alone, so the start
// code pays a few hundred bytes and no other file.
import { EngineError } from '../errors/engine-error';

/**
 * The engine version, which the WebAssembly core and this package always share.
 *
 * @category api/engine
 */
export const VERSION = '0.0.0';

/**
 * Checks that an add-on, built for `version` of the engine, runs against this engine's version,
 * and throws E1432 when the two differ. An add-on calls it once, as its module loads, with its own
 * package name and version.
 *
 * @param name The add-on's package name, such as `@null3d/controls`.
 * @param version The add-on's version, which is the engine version it was built for.
 *
 * @category api/engine
 */
export function checkAddonVersion(name: string, version: string): void {
	if (version === VERSION) return;
	throw new EngineError(
		'E1432',
		`${name} ${version} was built for null3D ${version}, and this page runs null3D ${VERSION}.`,
	);
}
