// The task that bakes `post.set`'s grading values into the table's texels, which a job worker runs
// beside the frames (see `shared/tasks.ts`). The bake and the reference that the tests compare it
// with are one function, in `grading.ts`.

import type { TaskResult } from '../workers/tasks';
import { bakeGrade, type GradeValues } from './grading';

/** Bakes the table of the grading values that `input` holds, and moves its texels to the caller. */
export function run(input: unknown): TaskResult {
	const texels = bakeGrade(input as GradeValues);
	return { output: texels, transfer: [texels.buffer] };
}
