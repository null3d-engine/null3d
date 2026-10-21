// The handlers of glTF extensions that an add-on reads, which a sketch registers before it loads
// its first model. They live apart from the loader so that `assets.registerGltfExtension` answers
// at once, with its errors, while the loader loads on the first call that reads a file.

import { EngineError } from '../errors/engine-error';
import type { GltfExtensionHandler } from './assets';

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

	/** The handlers to hand the loader, each once. */
	all(): GltfExtensionHandler[] {
		return [...new Set(this.handlers.values())];
	}
}
