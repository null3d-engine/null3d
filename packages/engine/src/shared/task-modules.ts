// The key that one of a task's WebAssembly files goes by, in the cache of compiled modules and in
// each worker that runs the task. A file's name is its own within its task, so two add-ons may name
// a file alike: the key holds the task's script address too, and the engine's own tasks, which have
// none, keep their names alone.

/** The key of the WebAssembly file `name` of the task whose module is at `script`. */
export function moduleKey(script: string | undefined, name: string): string {
	return script ? `${script}\u0000${name}` : name;
}
