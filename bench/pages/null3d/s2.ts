// The page of the null3d version of s2; the scene runs in its game module.
import { S2_NODE_COUNT } from '../../scenes/spec';
import { runNull3dPage } from './harness';

// S2's object count is fixed: the page ignores ?n= and reports the real count.
runNull3dPage('s2', new URL('./s2-game.ts', import.meta.url), S2_NODE_COUNT, true);
