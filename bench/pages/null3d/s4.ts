// The page of the null3d version of s4; the scene runs in its sketch module. It fills the window at
// the preset's pixel ratio, as a full-screen app on a phone does, and records a trace of each second.
import { createS4 } from '../../scenes/spec';
import { runNull3dPage } from './harness';

// S4 has a fixed count of still objects, and ignores `?n=`.
const count = createS4().count;
runNull3dPage('s4', new URL('./s4-sketch.ts', import.meta.url), count, () => count, {
	fillWindow: true,
	trace: true,
});
