// The page of the sokko3d version of s1; the scene runs in its game module.
import { S1_DEFAULT_COUNT } from '../../scenes/spec';
import { runSokko3dPage } from './harness';

runSokko3dPage('s1', new URL('./s1-game.ts', import.meta.url), S1_DEFAULT_COUNT);
