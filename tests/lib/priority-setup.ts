// Playwright's global setup: refuses to start a run that times frames at macOS background priority
// (AGENTS.md, hard rule 30), before any browser starts. On the real GPU the engine checks judge the
// frame interval and the display's refresh rate, and the cost specs print the medians that decision
// records quote. A browser that inherits background priority draws about 10 frames a second, so
// each of those would fail, or print figures that hold nothing, without saying why.
import { defaultEnvironment } from '../../packages/cli/src/browser.js';
import { refuseBackgroundPriority } from './app-window.ts';

/** The variables that turn on the specs that time an effect's cost on the computer's own GPU. */
export const COST_VARIABLES = [
	'NULL3D_CONTACT_COST',
	'NULL3D_FOG_COST',
	'NULL3D_LOD_COST',
] as const;

/** True for a run that times frames: one on the real GPU, or one that a cost variable turns on. */
export function timesFrames(env: Readonly<Record<string, string | undefined>>): boolean {
	return defaultEnvironment(env) === 'chrome-real-gpu' || COST_VARIABLES.some((name) => env[name]);
}

export default function globalSetup(): void {
	if (timesFrames(process.env)) refuseBackgroundPriority();
}
