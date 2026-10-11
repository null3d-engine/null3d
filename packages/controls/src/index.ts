// Camera controls for null3D sketches: orbit, map, fly and first-person controls with three.js's
// option names and behavior. They read the sketch's input once per frame in update(dt), with no DOM
// listeners.

export type {
	FirstPersonControls,
	FirstPersonControlsOptions,
} from './first-person-controls';
export { createFirstPersonControls } from './first-person-controls';
export type { FlyControls, FlyControlsOptions } from './fly-controls';
export { createFlyControls } from './fly-controls';
export type {
	MapControls,
	MouseAction,
	MouseButtons,
	OneFingerAction,
	OrbitControls,
	OrbitControlsOptions,
	TouchActions,
	TwoFingerAction,
} from './orbit-controls';
export { createMapControls, createOrbitControls } from './orbit-controls';
