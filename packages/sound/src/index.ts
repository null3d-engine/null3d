// The sound add-on for null3D: positional sound that follows the scene. The sketch makes its sounds
// and writes their places, levels, rates and tones into a table; the page's half, in
// `@null3d/sound/page`, plays them with the browser's audio, driven from that table on the audio
// thread. Built on the engine's public API only.
import { checkAddonVersion } from '@null3d/engine';
import { VERSION } from './version';

checkAddonVersion('@null3d/sound', VERSION);

export { NAMESPACE } from './namespace';
export type {
	Sound,
	SoundGroup,
	SoundGroupOptions,
	SoundListener,
	SoundLoop,
	SoundLoopOptions,
	SoundOptions,
	SoundPlacement,
	SoundShot,
	SoundShotOptions,
} from './sound';
export { createSound } from './sound';
