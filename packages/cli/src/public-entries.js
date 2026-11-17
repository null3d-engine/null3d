// The engine's entry points that an add-on and an example may import: the main entry, the stats
// panel, and the maths entry with its sub-paths. The command-line tool's add-on check reads this
// list, and so does the repository's own check of its add-ons and examples
// (tools/lib/addon-imports.ts), so the two never disagree about what is public.

/**
 * The engine's entry points that an add-on may import.
 *
 * @type {ReadonlySet<string>}
 */
export const PUBLIC_ENTRIES = new Set([
	'@null3d/engine',
	'@null3d/engine/stats',
	'@null3d/engine/math',
	'@null3d/engine/math/vec3',
	'@null3d/engine/math/quat',
	'@null3d/engine/math/mat4',
	'@null3d/engine/math/math',
]);
