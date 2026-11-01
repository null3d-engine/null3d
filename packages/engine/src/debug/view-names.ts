// The debug views that the engine draws itself. An add-on registers a view of its own through its
// feature description, so its name must not take one of these.

/**
 * The engine's own debug views, which `debug.view` and `?view=` take and an add-on's view name
 * cannot take.
 *
 * @category api/debug
 */
export const ENGINE_DEBUG_VIEWS = [
	'lit',
	'normals',
	'depth',
	'wireframe',
	'overdraw',
	'shadows',
	'motion',
	'levels',
] as const;

/**
 * One of the engine's own debug views.
 *
 * @category api/debug
 */
export type EngineDebugView = (typeof ENGINE_DEBUG_VIEWS)[number];

/** True for a name of one of the engine's own debug views. */
export function isEngineDebugView(name: string): name is EngineDebugView {
	return (ENGINE_DEBUG_VIEWS as readonly string[]).includes(name);
}
