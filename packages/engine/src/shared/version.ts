// The engine's version, and the checks that an add-on runs against it. The engine's own add-ons
// ship in step with the engine and pin the engine version they were built for, so a page that
// mixes versions stops at the import with a message that names both. An add-on from another
// developer ships on its own schedule and declares the range of plugin interfaces it works with,
// so a page stops the same way when its interface lies outside that range. The module reads the
// error class alone, so the start code pays a few hundred bytes and no other file.
import { EngineError } from '../errors/engine-error';

/**
 * The engine version, which the WebAssembly core and this package always share.
 *
 * @category api/engine
 */
export const VERSION = '0.0.0';

/**
 * The version of the plugin interface that an add-on from another developer builds against. It is
 * a whole number, and it changes only when a stable add-on hook changes, never with every engine
 * release. The engine's own add-ons pin the engine version instead.
 *
 * @category api/engine
 */
export const PLUGIN_INTERFACE_VERSION = 1;

/**
 * The plugin interface versions that an add-on from another developer works with: the lowest and
 * the highest, both included.
 *
 * @category api/engine
 */
export interface PluginInterfaceRange {
	/** The lowest plugin interface version that the add-on works with. */
	readonly min: number;
	/** The highest plugin interface version that the add-on works with. */
	readonly max: number;
}

/**
 * Checks that an add-on, built for `version` of the engine, runs against this engine's version,
 * and throws E1432 when the two differ. An add-on calls it once, as its module loads, with its own
 * package name and version. An add-on from another developer calls `checkPluginInterface` instead,
 * with the range of plugin interface versions that it works with.
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

/**
 * Checks that an add-on from another developer works with this engine's plugin interface, and
 * throws E1433 when the declared range does not hold `PLUGIN_INTERFACE_VERSION`. The add-on calls
 * it once, as its module loads, with its own package name and the range it was built for.
 *
 * @param name The add-on's package name, such as `@acme/splats`.
 * @param range The plugin interface versions that the add-on works with, both included.
 *
 * @category api/engine
 */
export function checkPluginInterface(name: string, range: PluginInterfaceRange): void {
	const { min, max } = range;
	if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min)
		throw new EngineError(
			'E1433',
			`${name} declares plugin interface versions ${min} to ${max}, which is no range of whole versions.`,
		);
	if (PLUGIN_INTERFACE_VERSION >= min && PLUGIN_INTERFACE_VERSION <= max) return;
	const built = min === max ? `${min}` : `${min} to ${max}`;
	throw new EngineError(
		'E1433',
		`${name} was built for plugin interface ${built}, and this page has plugin interface ${PLUGIN_INTERFACE_VERSION} (null3D ${VERSION}).`,
	);
}
