// The task that works out the wind's analytic field for the places that a page asks about, which the
// engine runs in a job worker beside the frames. The module starts the add-on's WebAssembly once in
// the worker, copies the request into it, and gives back three numbers for each place: the air's
// velocity across the ground and its rise, which is zero.
//
// The module runs on its own in the worker: it imports the layout alone, which holds no code, and
// the engine by type alone. Its WebAssembly sits beside the package's build, and the task names it.
import type { Task } from '@null3d/engine';
import { COUNT, MAX_PLACES } from './field-layout';

/**
 * The task that a page's ask runs. Its module is this one, which the build emits as the worker
 * loads it, and its WebAssembly is the add-on's field.
 */
export const FIELD_TASK: Task = {
	name: 'wind-field',
	script: new URL('./field-task.ts', import.meta.url),
	wasm: [
		{
			name: 'field',
			url: new URL('../dist/wind.wasm', import.meta.url),
			what: "the wind's field",
		},
	],
};

/** What the add-on's WebAssembly exports. */
interface FieldExports {
	readonly memory: WebAssembly.Memory;
	request(length: number): number;
	probe(): number;
	response(): number;
	response_length(): number;
}

/** One request, which the sketch fills and the worker reads. */
interface FieldInput {
	/** The count, the settings, the ring and the places, as the layout gives them. */
	readonly request: Float32Array;
	/** The answer, three numbers a place, which the worker writes or gives back. */
	readonly answer: Float32Array;
}

/** What the worker gives back: the answer, unless the page shares the memory it wrote. */
interface FieldOutput {
	output: Float32Array | null;
	transfer?: Transferable[];
}

/** The module, started once in each worker that runs the task. */
let started: { exports: FieldExports; floats: Float32Array } | undefined;

/** Starts the add-on's WebAssembly, or gives the one that this worker already started. */
function start(module: WebAssembly.Module): { exports: FieldExports; floats: Float32Array } {
	if (started) return started;
	const instance = new WebAssembly.Instance(module, {});
	const exports = instance.exports as unknown as FieldExports;
	started = { exports, floats: new Float32Array(exports.memory.buffer) };
	return started;
}

/** Works out the air at each place in the request, and answers with the velocities. */
export function run(
	input: unknown,
	wasm: (name: string) => WebAssembly.Module,
): FieldOutput | Promise<FieldOutput> {
	const { request, answer } = input as FieldInput;
	const field = start(wasm('field'));
	const { exports } = field;
	// The module keeps its buffers and never grows its memory, so its view stays valid. A newer
	// view answers anyway, so a module that grows is read rather than written past.
	if (field.floats.buffer !== exports.memory.buffer)
		field.floats = new Float32Array(exports.memory.buffer);
	const count = request[COUNT] as number;
	if (count > MAX_PLACES)
		throw new Error(
			`the wind field takes ${MAX_PLACES} places in one call, and this call asked for ${count}. Ask fewer places, or ask again in the next frame.`,
		);
	const at = exports.request(request.length * 4);
	if (at === 0)
		throw new Error(
			`the wind field takes ${MAX_PLACES} places in one call, and this call asked for ${count}. Ask fewer places, or ask again in the next frame.`,
		);
	field.floats.set(request, at / 4);
	const status = exports.probe();
	if (status !== 0) throw new Error(`the wind field could not read the request: status ${status}.`);
	const length = exports.response_length();
	answer.set(new Float32Array(exports.memory.buffer, exports.response(), length / 4));
	// A page whose buffer is shared reads the answer where it lies. Any other page gets the answer
	// back, which the engine moves rather than copies.
	if (answer.buffer instanceof SharedArrayBuffer) return { output: null };
	return { output: answer, transfer: [answer.buffer] };
}
