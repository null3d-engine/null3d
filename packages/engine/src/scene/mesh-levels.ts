// The run-time level planner's start in the thread that runs the sketch, which `mesh.buildLevels`
// imports the first time a mesh plans its levels, so a sketch without such a mesh downloads none
// of it, nor meshoptimizer's modules. It hands the mesh's words to the planner's task on a job
// worker (scene/levels-task.ts), which the on-demand loader runs (shared/tasks.ts), and the task's
// modules compile once per page on the first plan.
//
// The module imports no engine module but constants, types and the on-demand loader, as the KTX2
// loader does, so the caller hands it the engine's error class.

import { TaskFailure } from '../shared/task-failure';
import { runTaskWithError, type Task } from '../shared/tasks';
import type { WasmError } from '../shared/wasm';
import { CLUSTERIZER_MODULE, ENCODER_MODULE, SIMPLIFIER_MODULE } from './level-words';
import type { LevelsTaskInput, LevelsTaskOutput } from './levels-task';

/**
 * The planner's task, with meshoptimizer's simplifier, the encoder's vertex cache order and the
 * clusterizer, which splits the pieces of a large list into groups.
 */
const PLANNER: Task = {
	name: 'levels',
	wasm: [
		{
			name: SIMPLIFIER_MODULE,
			url: new URL('../../vendor/meshopt/meshopt_simplifier.wasm', import.meta.url),
			what: "meshoptimizer's simplifier",
		},
		{
			name: ENCODER_MODULE,
			url: new URL('../../vendor/meshopt/meshopt_encoder.wasm', import.meta.url),
			what: "meshoptimizer's vertex cache order",
		},
		{
			name: CLUSTERIZER_MODULE,
			url: new URL('../../vendor/meshopt/meshopt_clusterizer.wasm', import.meta.url),
			what: "meshoptimizer's clusterizer",
		},
	],
};

/** Makes one of the engine's coded errors: the caller's `EngineError`. */
export type LevelsError = (code: Parameters<WasmError>[0] | 'E1420', message: string) => Error;

/**
 * Plans a mesh's levels on a job worker, from the words that moved there. Rejects with E1406, or
 * with the policy's or the server's code, when the planner does not load, and with E1420 when the
 * engine stops first.
 */
export async function planLevels(
	input: LevelsTaskInput,
	call: string,
	error: LevelsError,
): Promise<LevelsTaskOutput> {
	try {
		return await runTaskWithError<LevelsTaskOutput>(
			PLANNER,
			input,
			input.masks ? [input.words, input.masks] : [input.words],
			error as WasmError,
		);
	} catch (thrown) {
		if (!(thrown instanceof TaskFailure)) throw thrown;
		if (thrown.stage === 'stopped')
			throw error('E1420', 'a mesh was still planning its levels when the engine stopped.');
		throw error(
			'E1406',
			`the level planner did not ${thrown.stage === 'run' ? 'run' : 'load'} for ${call}(): ${thrown.message.replace(/\.$/, '')}.`,
		);
	}
}
