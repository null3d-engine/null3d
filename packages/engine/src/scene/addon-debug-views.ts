// The debug views that add-ons add through their feature descriptions. `debug.view` and the
// `?view` switch set one by name, and the add-on that registered it hears when it becomes active
// and when another view replaces it. The registry lives on the thread's global object, under a
// registered symbol, so every copy of this module in the thread shares it, as the namespace table
// does. An add-on registers a view as its feature is added, and may register it after the page has
// asked for it: the registry keeps the requested name and tells the new view to start.

/**
 * A debug view that an add-on adds, as its feature description declares it.
 *
 * @category api/features
 */
export interface AddonDebugView {
	/** The name that `debug.view` and `?view=` take. */
	readonly name: string;
	/**
	 * Called with `true` when this view becomes the active one, and with `false` when another view
	 * replaces it or the engine stops.
	 */
	readonly set: (active: boolean) => void;
}

/** The thread's registry: the views by name, and the name asked for last. */
interface DebugViews {
	readonly views: Map<string, AddonDebugView>;
	active: string | undefined;
}

/** The key of the thread's registry on its global object. */
const KEY = Symbol.for('null3d.addonDebugViews');

/** The thread's global object, which holds the registry that every copy of this module shares. */
type Thread = { [key: symbol]: DebugViews | undefined };

/** The registry of this thread. */
function registry(): DebugViews {
	const thread = globalThis as Thread;
	const held = thread[KEY];
	if (held !== undefined) return held;
	const created: DebugViews = { views: new Map(), active: undefined };
	thread[KEY] = created;
	return created;
}

/**
 * Registers a view for as long as its feature lives. A view that the page asked for before it was
 * registered starts at once. A name that another view holds is replaced, as a module that loads
 * again does.
 */
export function registerAddonDebugView(view: AddonDebugView): void {
	const held = registry();
	held.views.set(view.name, view);
	if (held.active === view.name) view.set(true);
}

/** Stops a view, tells it that it is no longer active, and forgets it. */
export function unregisterAddonDebugView(name: string): void {
	const held = registry();
	const view = held.views.get(name);
	if (view === undefined) return;
	if (held.active === name) {
		view.set(false);
		held.active = undefined;
	}
	held.views.delete(name);
}

/**
 * Makes `name` the active view, or clears the active view with `undefined`. Returns true when a
 * registered view took it, and false for a name that no view has registered yet, which the
 * registry keeps so that a view that registers it later starts.
 */
export function activateAddonDebugView(name: string | undefined): boolean {
	const held = registry();
	if (held.active === name) return name === undefined || held.views.has(name);
	const previous = held.active;
	held.active = name;
	if (previous !== undefined) held.views.get(previous)?.set(false);
	if (name === undefined) return true;
	const view = held.views.get(name);
	view?.set(true);
	return view !== undefined;
}

/** True when an add-on has registered a view with `name`. */
export function hasAddonDebugView(name: string): boolean {
	return registry().views.has(name);
}
