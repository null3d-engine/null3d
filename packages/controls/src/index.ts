// Controls for null3D sketches: orbit, map, fly and first-person camera controls, and drag,
// rotate and scale gizmos, with three.js's option names and behavior. They read the sketch's input
// once per frame in update(dt), with no DOM listeners.
import { checkAddonVersion } from '@null3d/engine';
import { VERSION } from './version';

checkAddonVersion('@null3d/controls', VERSION);

export type {
	DragAction,
	DragControls,
	DragControlsOptions,
	DragMouseButtons,
	DragTouchActions,
} from './drag-controls';
export { createDragControls } from './drag-controls';
export type {
	FirstPersonControls,
	FirstPersonControlsOptions,
} from './first-person-controls';
export { createFirstPersonControls } from './first-person-controls';
export type { FlyControls, FlyControlsOptions } from './fly-controls';
export { createFlyControls } from './fly-controls';
export type { GizmoAxis, GizmoMode, GizmoSpace } from './gizmo-drag';
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
export type { TransformControls, TransformControlsOptions } from './transform-controls';
export { createTransformControls } from './transform-controls';
