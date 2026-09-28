// The page of the null3d version of s1; the scene runs in its game module.
import { S1_DEFAULT_COUNT } from '../../scenes/spec';
import { runNull3dPage } from './harness';

runNull3dPage('s1', new URL('./s1-game.ts', import.meta.url), S1_DEFAULT_COUNT);
