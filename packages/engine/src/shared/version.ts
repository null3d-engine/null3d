// The engine's version, and the checks that an add-on runs against it. The engine's own add-ons
// ship in step with the engine and pin the engine version they were built for, so a page that
// mixes versions stops at the import with a message that names both. An add-on from another
// developer ships on its own schedule and declares the range of plugin interfaces it works with,
// so a page stops the same way when its interface lies outside that range. The module reads the
// error class alone, so the start code pays a few hundred bytes and no other file.
import { EngineError } from '../errors/engine-error';
import { DEV } from './dev';

/**
 * The engine version, which the WebAssembly core and this package always share.
 *
 * @category api/engine
 */
export const VERSION = '0.1.1';

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
 * Where a thread keeps, in a development build, the handlers that hear each add-on check its
 * version. The sketch's thread names an add-on whose use the page's options make useless, such as
 * @null3d/controls on an engine that takes no input. A thread can hold two copies of this module,
 * one in the engine's code and one in the sketch's bundle, so the handlers live on the thread's
 * global object under a shared symbol, as the error mark does. A production build keeps none.
 */
const ADDONS = /* @__PURE__ */ Symbol.for('null3d.addonsChecked');

/** The thread's handlers, which the first copy of this module to need them makes. */
function addonHearers(): Set<(name: string) => void> {
	const thread = globalThis as { [ADDONS]?: Set<(name: string) => void> };
	thread[ADDONS] ??= new Set();
	return thread[ADDONS];
}

/**
 * Calls `heard` with each add-on that checks its version in this thread from now on, whichever copy
 * of this module it calls. An add-on that checked before is not heard: a module checks once, as it
 * loads, so a check that came earlier belongs to another sketch's load. Returns a function that
 * stops it. Development builds only.
 */
export function onAddonChecked(heard: (name: string) => void): () => void {
	const hearers = addonHearers();
	hearers.add(heard);
	return () => hearers.delete(heard);
}

/** The add-ons that a sketch's module loaded before its runner existed, as `hearAddonsEarly` hears them. */
export interface EarlyAddons {
	/**
	 * Gives `heard` each add-on heard so far, ends this hearing, and hears each later add-on for
	 * `heard`. Returns a function that stops that.
	 */
	hand(heard: (name: string) => void): () => void;
	/** Ends the hearing, for a runner that never asks for it. */
	stop(): void;
}

/**
 * Hears each add-on that checks its version in this thread from now on, for a sketch runner that
 * does not exist yet: a thread that loads the sketch's module before its runner starts hands the
 * runner what the module loaded. Development builds only.
 */
export function hearAddonsEarly(): EarlyAddons {
	const names: string[] = [];
	const stop = onAddonChecked((name) => names.push(name));
	return {
		hand(heard) {
			stop();
			for (const name of names) heard(name);
			return onAddonChecked(heard);
		},
		stop,
	};
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
	if (DEV) for (const heard of addonHearers()) heard(name);
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
