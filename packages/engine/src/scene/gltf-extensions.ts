// The handlers of glTF extensions that an add-on reads. A sketch registers one through
// `assets.registerGltfExtension`, and an add-on registers its own as its module loads, through
// `registerGltfExtension`, which serves every sketch of the thread: a page that imports the add-on
// loads the extension's files without another call. They live apart from the loader so that both
// calls answer at once, with their errors, while the loader loads on the first call that reads a
// file.

import { EngineError } from '../errors/engine-error';
import type { GltfExtensionHandler } from './assets';

/** The key of the thread's table of add-on handlers on its global object. */
const ADDON_HANDLERS = Symbol.for('null3d.addonGltfExtensions');

/** The thread's global object, which holds the add-ons' handlers for every library copy. */
const thread = globalThis as { [ADDON_HANDLERS]?: Map<string, GltfExtensionHandler> };

/** The thread's table of the handlers that add-ons registered as their modules loaded. */
function addonHandlers(): Map<string, GltfExtensionHandler> {
	let table = thread[ADDON_HANDLERS];
	if (table === undefined) {
		table = new Map();
		thread[ADDON_HANDLERS] = table;
	}
	return table;
}

/** Checks a handler's shape, and throws E1213 for one that cannot read anything. */
function checkHandler(handler: GltfExtensionHandler, call: string): readonly string[] {
	const names = handler?.extensions;
	if (
		!Array.isArray(names) ||
		names.length === 0 ||
		!names.every((name) => typeof name === 'string' && name.length > 0)
	)
		throw new EngineError(
			'E1213',
			`${call}() got a handler whose extensions is not a list of names. Name at least one extension, such as 'KHR_gaussian_splatting'.`,
		);
	if (typeof handler.load !== 'function')
		throw new EngineError(
			'E1213',
			`${call}() got a handler without a load() function, which makes the parts of a primitive that carries its extensions.`,
		);
	return names;
}

/**
 * Registers a handler for the glTF extensions that an add-on reads, for every sketch of this
 * thread. An add-on calls it once as its module loads, so a page that imports the add-on loads the
 * add-on's files with no other call. Returns a function that unregisters the handler.
 *
 * A later handler for an extension replaces the earlier one, which a development reload of the
 * add-on's module needs. Two add-ons that read one extension therefore give it to the one that
 * loaded last. A sketch that reads one extension in one scene alone uses
 * `assets.registerGltfExtension` instead.
 *
 * Throws E1213 for a handler without a list of extension names or a `load` function.
 *
 * @category api/assets
 */
export function registerGltfExtension(handler: GltfExtensionHandler): () => void {
	const call = 'registerGltfExtension';
	const names = checkHandler(handler, call);
	const table = addonHandlers();
	for (const name of names) table.set(name, handler);
	return () => {
		for (const name of names) if (table.get(name) === handler) table.delete(name);
	};
}

/** The handler of each extension name, as a sketch registers them. */
export class GltfExtensions {
	private readonly handlers = new Map<string, GltfExtensionHandler>();

	/**
	 * Registers a handler for the extensions that it names, and returns a function that unregisters
	 * it. Throws E1213 for a handler without a list of extension names or a `load` function, and
	 * for one that reads an extension which another handler reads.
	 */
	register(handler: GltfExtensionHandler): () => void {
		const call = 'assets.registerGltfExtension';
		const names = checkHandler(handler, call);
		for (const name of names) {
			const held = this.handlers.get(name);
			if (held && held !== handler)
				throw new EngineError(
					'E1213',
					`${call}() got a handler for ${name}, and another handler reads it already.`,
				);
		}
		for (const name of names) this.handlers.set(name, handler);
		return () => {
			for (const name of names) if (this.handlers.get(name) === handler) this.handlers.delete(name);
		};
	}

	/**
	 * The handlers to hand the loader, each once: the add-ons' own, then the sketch's, so that a
	 * handler the sketch registered for an extension takes the place of the add-on's.
	 */
	all(): GltfExtensionHandler[] {
		const merged = new Map(addonHandlers());
		for (const [name, handler] of this.handlers) merged.set(name, handler);
		return [...new Set(merged.values())];
	}
}
