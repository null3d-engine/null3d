// The task that bakes `post.set`'s grading values into the table's texels, which a job worker runs
// beside the frames (see `shared/tasks.ts`). The bake and the reference that the tests compare it
// with are one function, in `grading.ts`.

import type { TaskResult } from '../workers/tasks';
import { bakeGrade, type GradeValues } from './grading';

/** What the task bakes: the grading values. */
export interface GradeTaskInput {
	values: GradeValues;
}

/** The table's texels. */
export interface GradeTaskOutput {
	texels: Float32Array;
}

/** Bakes the table and moves its texels to the caller. */
export function run(input: unknown): TaskResult {
	const { values } = input as GradeTaskInput;
	const texels = bakeGrade(values);
	const output: GradeTaskOutput = { texels };
	return { output, transfer: [texels.buffer] };
}
