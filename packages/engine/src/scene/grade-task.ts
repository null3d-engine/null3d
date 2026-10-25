// The task that bakes `post.set`'s grading values into the table's texels, which a job worker runs
// beside the frames (see `shared/tasks.ts`). The bake and the reference that the tests compare it
// with are one function, in `grading.ts` and `grading-hdr.ts`. The task also packs the grade's
// controls, which the 8-bit path's shaders apply one pixel at a time.

import type { TaskResult } from '../workers/tasks';
import { bakeGrade, type GradeValues, resolveGradingGains } from './grading';
import { bakeGradeHdr } from './grading-hdr';

/** What the task bakes: the grading values, and the table's domain. */
export interface GradeTaskInput {
	values: GradeValues;
	/** True for the table over high dynamic range light. */
	hdr: boolean;
}

/** The table's texels and the grade's controls, packed as the frame's output block lays them. */
export interface GradeTaskOutput {
	texels: Float32Array;
	grade: Float32Array;
}

/** The grade's controls as the frame's output block holds them: the white balance's factors and
 * the saturation, the lift, the gamma, the gain, and the split toning's two chromas with its
 * balance and its strength. */
function packGrade(values: GradeValues, gains: ReturnType<typeof resolveGradingGains>) {
	const grade = new Float32Array(24);
	grade.set(gains.gains, 0);
	grade[3] = values.saturation;
	grade.set(values.lift, 4);
	grade.set(values.gamma, 8);
	grade.set(values.gain, 12);
	grade.set(gains.shadowChroma, 16);
	grade[19] = values.balance;
	grade.set(gains.highlightChroma, 20);
	grade[23] = values.strength;
	return grade;
}

/** Bakes the table and packs the grade's controls, and moves both to the caller. */
export function run(input: unknown): TaskResult {
	const { values, hdr } = input as GradeTaskInput;
	const texels = hdr ? bakeGradeHdr(values) : bakeGrade(values);
	const grade = packGrade(values, resolveGradingGains(values));
	const output: GradeTaskOutput = { texels, grade };
	return { output, transfer: [texels.buffer, grade.buffer] };
}
