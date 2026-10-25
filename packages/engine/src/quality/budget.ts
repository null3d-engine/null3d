// The render scale and the budgets' scale, in whole thousandths, which the core turns into exact
// sizes in pixels. The governor steps them, the renderer reads the render scale, and a sketch's own
// systems read their budget's scale, so the thread that draws and the thread that runs the sketch
// both need these numbers. They live apart from the governor so that a page which never governs its
// frames downloads no step of the governor's work.

/** The render scale of the whole canvas, in thousandths. */
export const FULL_SCALE = 1000;
/** How far one step moves the render scale, in thousandths. */
export const SCALE_STEP = 50;

/** The render scale in thousandths of a scale from 0 to 1, rounded, from 1 to the whole canvas. */
export function thousandths(scale: number): number {
	return Math.min(FULL_SCALE, Math.max(1, Math.round(scale * FULL_SCALE)));
}

/** How far one step moves the budgets' scale, in thousandths. */
export const BUDGET_STEP = 250;
/** The budgets' steps from the full scale down to none. */
export const BUDGET_STEPS = FULL_SCALE / BUDGET_STEP;

/** The budgets' steps from the full scale down to `min`, a scale from 0 to 1. */
export function budgetSteps(min: number): number {
	return Math.ceil((FULL_SCALE - Math.round(min * FULL_SCALE)) / BUDGET_STEP);
}

/** A budget's scale from 0 to 1 after `level` steps of the budgets, and at least `min`. */
export function budgetScale(level: number, min: number): number {
	return Math.max(min, (FULL_SCALE - level * BUDGET_STEP) / FULL_SCALE);
}
