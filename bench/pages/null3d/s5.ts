// The page of the null3d version of S5; the scene runs in its sketch module. It fills the window at
// the preset's pixel ratio and records a trace of each second, as S4's page does.
import { S5_DEFAULT_COUNT } from '../../scenes/s5';
import { runNull3dPage } from './harness';

runNull3dPage('s5', new URL('./s5-sketch.ts', import.meta.url), S5_DEFAULT_COUNT, undefined, {
	fillWindow: true,
	trace: true,
});
