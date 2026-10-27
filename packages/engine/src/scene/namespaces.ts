// Names for add-ons: an add-on claims a namespace as its module loads, and the namespace gives it a
// shader library name, a range of error codes and the quality keys that it adds. The engine owns
// the name `null3d` and the codes of its own table, so an add-on cannot take either. A name that
// another add-on holds, whether the namespace's own or a feature, output or lighting slot that it
// registers, is refused where the add-on registers it, with an error that names both owners. A
// module that loads again under the same package gets the namespace that it claimed, so a
// development reload works while a second add-on with the same name stops.
//
// The registry lives on the thread's global object, under a registered symbol, so every add-on and
// every copy of this module in the thread share one table, as the table of error fixes does. A page
// and its sketches have one thread each, and an add-on's names are claimed in the thread that loads
// it.

import { ENGINE_DEBUG_VIEWS } from '../debug/view-names';
import { EngineError } from '../errors/engine-error';
import { QUALITY_SETTINGS } from '../quality/presets';
import { checkPluginInterface, type PluginInterfaceRange } from '../shared/version';
import type { FeatureSlot } from './features';

/**
 * The names that an add-on claims as its module loads. The engine refuses a name that its own code
 * or another add-on holds.
 *
 * @category api/features
 */
export interface AddonNamespace {
	/**
	 * The add-on's name, from 1 to 32 lowercase letters, digits or underscores, starting with a
	 * letter. It names the add-on in errors and prefixes the budgets of its features. The engine
	 * reserves `null3d`.
	 */
	readonly name: string;
	/**
	 * The package or module that owns the add-on, such as its npm package name. It tells a module
	 * that loads again, as a development reload does, from a second add-on. Give the same value
	 * every time the add-on loads.
	 */
	readonly package: string;
	/**
	 * The WGSL library name that the add-on owns, from 1 to 32 lowercase letters, digits or
	 * underscores, starting with a letter. It is the name by default, and the engine reserves it so
	 * that another add-on cannot take it. The engine reserves `null3d` too.
	 */
	readonly shaderLibrary?: string;
	/**
	 * The range of error codes that the add-on's own errors use, as its first and last code. Codes
	 * from 2000 to 9999 belong to the add-ons, and the engine's own codes lie below 2000.
	 */
	readonly errorCodes?: readonly [number, number];
	/**
	 * The keys that the add-on adds to the quality settings that a sketch reads. They must not be
	 * keys of the engine's own quality table or another add-on's.
	 */
	readonly qualityKeys?: readonly string[];
	/**
	 * The plugin interface versions that the add-on was built for, both included. The engine refuses
	 * a page whose interface lies outside the range, with E1433, which names the add-on and both
	 * versions. An add-on that ships with the engine leaves it out and keeps its exact version pin
	 * through `checkAddonVersion`.
	 */
	readonly pluginInterface?: PluginInterfaceRange;
}

/** The engine's own name, and the prefix of its shader library. */
const ENGINE_NAME = 'null3d';

/** The longest name of an add-on or its shader library. */
const NAME_MAX = 32;

/** The longest package name that an add-on gives. */
const PACKAGE_MAX = 128;

/** The names that an add-on or its shader library takes: lowercase, digits and underscores. */
const NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

/** The first code that an add-on may use; the engine's own codes lie below it. */
const CODES_FROM = 2000;

/** The last code that an add-on may use. */
const CODES_TO = 9999;

/** The options that namespace takes, which the check refuses when it meets another one. */
const TAKES: ReadonlySet<string> = new Set([
	'name',
	'package',
	'shaderLibrary',
	'errorCodes',
	'qualityKeys',
	'pluginInterface',
]);

/** The keys of the engine's own quality table, which an add-on cannot take. */
const ENGINE_KEYS: ReadonlySet<string> = new Set(Object.keys(QUALITY_SETTINGS));

/** The error-code range that an add-on registered. */
interface CodeRange {
	readonly first: number;
	readonly last: number;
	readonly addon: string;
}

/** E1225 for a name that the engine or another add-on holds. */
function clash(call: string, detail: string): EngineError {
	return new EngineError('E1225', `${call}() ${detail}`);
}

/** The add-on's name or shader library, or throws E1225. */
function checkAddonName(call: string, value: unknown, what: string): string {
	if (typeof value !== 'string' || value.length > NAME_MAX || !NAME_PATTERN.test(value))
		throw clash(
			call,
			`got the ${what} ${JSON.stringify(value)}; it takes 1 to ${NAME_MAX} lowercase letters, digits or underscores, starting with a letter.`,
		);
	if (value === ENGINE_NAME)
		throw clash(
			call,
			`got the ${what} '${ENGINE_NAME}', which the engine reserves. Give the add-on a name of its own, such as its package's short name.`,
		);
	return value;
}

/** The add-on's package name, or throws E1225. It tells a reload from a second add-on. */
function checkPackage(call: string, value: unknown): string {
	if (
		typeof value !== 'string' ||
		value.length < 1 ||
		value.length > PACKAGE_MAX ||
		/\s/.test(value)
	)
		throw clash(
			call,
			`got the package ${JSON.stringify(value)}; it takes 1 to ${PACKAGE_MAX} characters with no spaces, such as the add-on's npm package name.`,
		);
	return value;
}

/** True when an add-on that claims a name again declares the same names. */
function sameNamespace(
	claimed: AddonNamespace,
	description: AddonNamespace,
	name: string,
): boolean {
	if (description.package !== claimed.package) return false;
	if ((description.shaderLibrary ?? name) !== claimed.shaderLibrary) return false;
	const codes = description.errorCodes;
	const held = claimed.errorCodes;
	if (codes === undefined || held === undefined) {
		if (codes !== held) return false;
	} else if (codes[0] !== held[0] || codes[1] !== held[1]) return false;
	const keys = description.qualityKeys ?? [];
	const own = claimed.qualityKeys ?? [];
	if (keys.length !== own.length || !keys.every((key) => own.includes(key))) return false;
	const plugin = description.pluginInterface;
	const declared = claimed.pluginInterface;
	if (plugin === undefined || declared === undefined)
		return plugin === undefined && declared === undefined;
	return plugin.min === declared.min && plugin.max === declared.max;
}

/**
 * The names that one feature exports to the whole thread, which another add-on may not also export.
 *
 * @category api/features
 */
export interface ExportedNames {
	/** The feature's name. */
	readonly feature: string;
	/** The outputs that the feature publishes, by name. */
	readonly outputs: readonly string[];
	/** The lighting slots that the feature provides. */
	readonly slots: readonly FeatureSlot[];
	/** The debug views that the feature adds, by name. */
	readonly debugViews: readonly string[];
}

/**
 * The namespaces that the add-ons of one thread claim, with the names that each of them exports.
 * `claim` registers an add-on's own names, and `claimFeature` registers the names of one of its
 * features. Each refuses a name that the engine or another add-on holds, and names both owners.
 *
 * @category api/features
 */
export class AddonNamespaces {
	/** The claimed namespaces, by name. */
	private readonly addons = new Map<string, AddonNamespace>();
	/** The add-on that owns each shader library. */
	private readonly libraries = new Map<string, string>();
	/** The code ranges that the add-ons claimed. */
	private readonly ranges: CodeRange[] = [];
	/** The add-on that owns each quality key. */
	private readonly keys = new Map<string, string>();
	/** The add-on that registers each feature name. */
	private readonly features = new Map<string, string>();
	/** The add-on that publishes each output. */
	private readonly outputs = new Map<string, string>();
	/** The add-on that provides each lighting slot. */
	private readonly slots = new Map<FeatureSlot, string>();
	/** The add-on that adds each debug view. */
	private readonly debugViews = new Map<string, string>();

	/** The number of claimed namespaces. */
	get size(): number {
		return this.addons.size;
	}

	/**
	 * Checks a namespace and registers it. Throws E1225 for an option that a namespace does not
	 * take, a name, package or shader library that is invalid or that another add-on holds, an
	 * error-code range outside 2000 to 9999 or over another add-on's, and a quality key of the
	 * engine's own quality table or another add-on's. Throws E1433 for a plugin interface range that
	 * the engine's interface lies outside.
	 */
	claim(description: AddonNamespace): AddonNamespace {
		const call = 'declareAddonNamespace';
		if (description === null || typeof description !== 'object')
			throw clash(
				call,
				`got ${JSON.stringify(description)}; it takes an object with a name and a package, and optionally a shader library, error codes and quality keys.`,
			);
		for (const option of Object.keys(description))
			if (!TAKES.has(option))
				throw clash(
					call,
					`got the option '${option}'; a namespace takes ${[...TAKES].map((name) => `'${name}'`).join(', ')}.`,
				);
		const name = checkAddonName(call, description.name, 'add-on name');
		const owner = checkPackage(call, description.package);
		if (description.pluginInterface !== undefined)
			checkPluginInterface(name, description.pluginInterface);
		// A module that the page loads again, as a development reload does, claims the same names
		// under the same package. A second add-on that takes the name is refused, even when it
		// declares the same fields.
		const claimed = this.addons.get(name);
		if (claimed !== undefined) {
			if (claimed.package !== owner)
				throw clash(
					call,
					`got the add-on name '${name}' for the package '${owner}', which the package '${claimed.package}' claims already. Give each add-on a name of its own.`,
				);
			if (sameNamespace(claimed, description, name)) return claimed;
			throw clash(
				call,
				`got the add-on name '${name}' for the package '${owner}', which that package claims with other names. Claim the same names every time the module loads.`,
			);
		}
		const library =
			description.shaderLibrary === undefined
				? name
				: checkAddonName(call, description.shaderLibrary, 'shader library');
		const libraryOwner = this.libraries.get(library);
		if (libraryOwner !== undefined)
			throw clash(
				call,
				`got the shader library '${library}' for the add-on '${name}' of the package '${owner}', which the add-on '${libraryOwner}' of the package '${this.addons.get(libraryOwner)?.package}' uses already. Give each add-on a shader library of its own.`,
			);
		const range = this.checkRange(call, name, description.errorCodes);
		const qualityKeys = this.checkQualityKeys(call, name, description.qualityKeys);
		const plugin = description.pluginInterface;
		const namespace: AddonNamespace = Object.freeze({
			name,
			package: owner,
			shaderLibrary: library,
			errorCodes: range,
			qualityKeys,
			pluginInterface:
				plugin === undefined ? undefined : Object.freeze({ min: plugin.min, max: plugin.max }),
		});
		this.addons.set(name, namespace);
		this.libraries.set(library, name);
		if (range !== undefined) this.ranges.push({ first: range[0], last: range[1], addon: name });
		for (const key of qualityKeys) this.keys.set(key, name);
		return namespace;
	}

	/** The namespace that `name` claimed, or undefined. */
	get(name: string): AddonNamespace | undefined {
		return this.addons.get(name);
	}

	/** Removes the namespace `name` and every name that it exported. Returns false for a name that no add-on claimed. */
	release(name: string): boolean {
		const namespace = this.addons.get(name);
		if (namespace === undefined) return false;
		this.addons.delete(name);
		if (namespace.shaderLibrary !== undefined) this.libraries.delete(namespace.shaderLibrary);
		const index = this.ranges.findIndex((range) => range.addon === name);
		if (index !== -1) this.ranges.splice(index, 1);
		for (const key of namespace.qualityKeys ?? [])
			if (this.keys.get(key) === name) this.keys.delete(key);
		for (const [feature, owner] of this.features) if (owner === name) this.features.delete(feature);
		for (const [output, owner] of this.outputs) if (owner === name) this.outputs.delete(output);
		for (const [slot, owner] of this.slots) if (owner === name) this.slots.delete(slot);
		for (const [view, owner] of this.debugViews) if (owner === name) this.debugViews.delete(view);
		return true;
	}

	/**
	 * Registers the names that one feature of `addon` exports. Throws E1225 for a feature name,
	 * output or lighting slot that another add-on registers, before it registers any of them.
	 */
	claimFeature(addon: string, names: ExportedNames): void {
		const call = 'FeatureHost.add';
		const nameOwner = this.features.get(names.feature);
		if (nameOwner !== undefined)
			throw clash(
				call,
				`got the feature '${names.feature}' for the add-on '${addon}', which the add-on '${nameOwner}' registers already. Give the feature a name of its own.`,
			);
		for (const output of names.outputs) {
			const owner = this.outputs.get(output);
			if (owner !== undefined)
				throw clash(
					call,
					`got the output '${output}' for the add-on '${addon}', which the add-on '${owner}' publishes already. Give each output a name of its own.`,
				);
		}
		for (const slot of names.slots) {
			const owner = this.slots.get(slot);
			if (owner !== undefined)
				throw clash(
					call,
					`got the slot '${slot}' for the add-on '${addon}', which the add-on '${owner}' provides already. One feature provides each lighting slot.`,
				);
		}
		for (const view of names.debugViews) {
			if ((ENGINE_DEBUG_VIEWS as readonly string[]).includes(view))
				throw clash(
					call,
					`got the debug view '${view}' for the add-on '${addon}', which names one of the engine's own views. Give the add-on's view a name of its own.`,
				);
			const owner = this.debugViews.get(view);
			if (owner !== undefined)
				throw clash(
					call,
					`got the debug view '${view}' for the add-on '${addon}', which the add-on '${owner}' adds already. Give each view a name of its own.`,
				);
		}
		this.features.set(names.feature, addon);
		for (const output of names.outputs) this.outputs.set(output, addon);
		for (const slot of names.slots) this.slots.set(slot, addon);
		for (const view of names.debugViews) this.debugViews.set(view, addon);
	}

	/** Removes the names that one feature of `addon` registered. */
	releaseFeature(addon: string, names: ExportedNames): void {
		if (this.features.get(names.feature) === addon) this.features.delete(names.feature);
		for (const output of names.outputs)
			if (this.outputs.get(output) === addon) this.outputs.delete(output);
		for (const slot of names.slots) if (this.slots.get(slot) === addon) this.slots.delete(slot);
		for (const view of names.debugViews)
			if (this.debugViews.get(view) === addon) this.debugViews.delete(view);
	}

	/** The error-code range, checked against the engine's codes and the other add-ons'. */
	private checkRange(
		call: string,
		addon: string,
		value: readonly [number, number] | undefined,
	): readonly [number, number] | undefined {
		if (value === undefined) return undefined;
		if (
			!Array.isArray(value) ||
			value.length !== 2 ||
			!value.every((code) => Number.isInteger(code)) ||
			value[0] < CODES_FROM ||
			value[1] > CODES_TO ||
			value[0] > value[1]
		)
			throw clash(
				call,
				`got the error codes ${JSON.stringify(value)} for the add-on '${addon}'; they take a first and a last whole code from ${CODES_FROM} to ${CODES_TO}, the first no higher than the last. The engine's own codes lie below ${CODES_FROM}.`,
			);
		const [first, last] = value;
		for (const range of this.ranges)
			if (first <= range.last && range.first <= last)
				throw clash(
					call,
					`got the error codes ${first} to ${last} for the add-on '${addon}', which overlap the add-on '${range.addon}'s ${range.first} to ${range.last}. Give each add-on a range of its own.`,
				);
		return Object.freeze([first, last]) as readonly [number, number];
	}

	/** The quality keys, checked against the engine's own keys and the other add-ons'. */
	private checkQualityKeys(
		call: string,
		addon: string,
		value: readonly string[] | undefined,
	): readonly string[] {
		if (value === undefined) return Object.freeze([]);
		if (!Array.isArray(value))
			throw clash(
				call,
				`got the quality keys ${JSON.stringify(value)} for the add-on '${addon}'; they take an array of keys.`,
			);
		const keys: string[] = [];
		for (const key of value) {
			if (typeof key !== 'string' || key.length < 1 || key.length > 64)
				throw clash(
					call,
					`got the quality key ${JSON.stringify(key)} for the add-on '${addon}'; it takes a string of 1 to 64 characters.`,
				);
			if (keys.includes(key))
				throw clash(
					call,
					`got the quality key '${key}' twice for the add-on '${addon}'. Give each key once.`,
				);
			if (ENGINE_KEYS.has(key))
				throw clash(
					call,
					`got the quality key '${key}' for the add-on '${addon}', which is a setting of the engine's own quality table. Give the add-on's keys names of their own.`,
				);
			const owner = this.keys.get(key);
			if (owner !== undefined)
				throw clash(
					call,
					`got the quality key '${key}' for the add-on '${addon}', which the add-on '${owner}' uses already. Give each add-on's keys names of their own.`,
				);
			keys.push(key);
		}
		return Object.freeze(keys);
	}
}

/** The key of the thread's namespace registry on its global object. */
const NAMESPACES = Symbol.for('null3d.addonNamespaces');

/** The thread's global object, which holds the registry that every copy of this module shares. */
const thread = globalThis as { [NAMESPACES]?: AddonNamespaces };

/**
 * The namespace registry of this thread, which every add-on of the thread claims in.
 *
 * @category api/features
 */
export function addonNamespaces(): AddonNamespaces {
	const held = thread[NAMESPACES];
	if (held !== undefined) return held;
	const created = new AddonNamespaces();
	thread[NAMESPACES] = created;
	return created;
}

/**
 * Claims the names in `description` for one add-on, and returns the frozen namespace. An add-on
 * calls it once, as its module loads, beside `checkAddonVersion`. It throws E1225 for a name that
 * the engine or another add-on holds, and a module that loads again under the same package gets
 * the namespace that it claimed.
 *
 * @category api/features
 */
export function declareAddonNamespace(description: AddonNamespace): AddonNamespace {
	return addonNamespaces().claim(description);
}
