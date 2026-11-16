// S7's shared per-frame code alone: the camera is fixed and nothing in the scene moves, so a frame
// runs no code and the page measures the loop's own overhead.
import { S7_COUNT } from '../../scenes/s7';
import { runSceneCodePage } from './harness';

runSceneCodePage('s7', () => ({
	n: S7_COUNT,
	frame(_t: number) {},
}));
