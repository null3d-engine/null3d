// Playwright's global setup: refuses to start a run that times frames at macOS background priority
// (AGENTS.md, hard rule 30), before any browser starts. On the real GPU the engine checks judge the
// frame interval and the display's refresh rate, and the cost specs print the medians that decision
// records quote. A browser that inherits background priority draws about 10 frames a second, so
// each of those would fail, or print figures that hold nothing, without saying why.
import { defaultEnvironment } from '../../packages/cli/src/browser.js';
import { refuseBackgroundPriority } from './app-window.ts';

/**
 * The name of a variable that turns on a spec that times an effect's cost on the computer's own GPU:
 * NULL3D_<EFFECT>_COST. A new cost spec names its switch so, and the guard knows it with no list to
 * keep: a list misses the switch of a new spec.
 */
export const COST_VARIABLE = /^NULL3D_\w+_COST$/;

/** True for a run that times frames: one on the real GPU, or one that a cost variable turns on. */
export function timesFrames(env: Readonly<Record<string, string | undefined>>): boolean {
	return (
		defaultEnvironment(env) === 'chrome-real-gpu' ||
		Object.entries(env).some(([name, value]) => COST_VARIABLE.test(name) && value)
	);
}

export default function globalSetup(): void {
	if (timesFrames(process.env)) refuseBackgroundPriority();
}
