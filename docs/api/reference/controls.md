---
id: api/reference/controls
title: "Controls (@null3d/controls): API reference"
status: generated
since: "0.1"
summary: "Every export of the Controls (@null3d/controls) API, from the engine's doc comments."
---

# Controls (@null3d/controls): API reference

> [Controls (@null3d/controls)](../controls.md) explains these exports. The engine's doc comments make this page.

## `createDragControls`

```ts
function createDragControls(context: SketchContext, camera: PerspectiveCamera | OrthographicCamera, objects: Object3D[], options: DragControlsOptions = {}): DragControls
```

Creates drag controls, which three.js calls `DragControls`. A press on one of `objects` drags it over a plane that faces the camera, and the right button or an option turns it instead. `controls.update(dt)` reads the input once per frame in `onUpdate`, and `controls.dragging` names the object that the pointer holds. Pass the sketch's context first, as the other controls take it.

## `createFirstPersonControls`

```ts
function createFirstPersonControls(ctx: SketchContext, camera: PerspectiveCamera | OrthographicCamera, options: FirstPersonControlsOptions = {}): FirstPersonControls
```

Creates first-person controls, which three.js calls `FirstPersonControls`, and which also take the place of its `PointerLockControls`. Keys walk, and a drag looks around. While the page holds the pointer lock, which `engine.requestPointerLock()` asks for, the mouse turns the view. Call `controls.update(dt)` once per frame in `onUpdate`.

## `createFlyControls`

```ts
function createFlyControls(ctx: SketchContext, camera: PerspectiveCamera | OrthographicCamera, options: FlyControlsOptions = {}): FlyControls
```

Creates fly controls, which three.js calls `FlyControls`. W, A, S, D, R and F move the camera, the arrow keys turn it, Q and E roll it, and the pointer steers it. Call `controls.update(dt)` once per frame in `onUpdate`.

## `createMapControls`

```ts
function createMapControls(ctx: SketchContext, camera: PerspectiveCamera | OrthographicCamera, options: OrbitControlsOptions = {}): MapControls
```

Creates map controls, which three.js calls `MapControls`. A left drag or one finger pans over the ground. The wheel, a pinch and a middle drag dolly the camera. A right drag or two fingers turn it. Call `controls.update(dt)` once per frame in `onUpdate`.

## `createOrbitControls`

```ts
function createOrbitControls(ctx: SketchContext, camera: PerspectiveCamera | OrthographicCamera, options: OrbitControlsOptions = {}): OrbitControls
```

Creates orbit controls, which three.js calls `OrbitControls`. A left drag or one finger turns the camera around the target. The wheel, a pinch and a middle drag dolly it. A right drag or two fingers pan. Call `controls.update(dt)` once per frame in `onUpdate`.

## `createTransformControls`

```ts
function createTransformControls(context: SketchContext, camera: PerspectiveCamera | OrthographicCamera, options: TransformControlsOptions = {}): TransformControls
```

Creates translate, rotate and scale gizmos for one object, which three.js calls `TransformControls`. `attach` picks the object, `setMode` picks what a drag does, and `controls.update(dt)` reads the input once per frame in `onUpdate`. A press on a handle begins the drag, and `controls.dragging` is true until the pointer comes up, so a sketch can leave its camera controls alone meanwhile.

## `DragAction`

```ts
type DragAction = 'pan' | 'rotate';
```

What a held button or a finger does to a draggable object: drag it over a plane that faces the camera, or turn it about the camera's axes.

## `DragControls`

Class `DragControls`.

Drag controls: they drag the objects of a list over a plane that faces the camera, or turn them about the camera's axes. `createDragControls` makes them. Call `update(dt)` once per frame in `onUpdate`.

| Member | Description |
| --- | --- |
| `readonly objects: Object3D[]` | The objects that a press can drag, which a sketch may add to or remove from at any time. |
| `enabled: boolean` | False ignores the user's input. |
| `recursive: boolean` | True drags a child of a listed object as its parent. |
| `transformGroup: boolean` | True drags the outermost listed object that holds the one under the pointer. |
| `rotateSpeed: number` | How fast a rotate drag turns the object. |
| `readonly mouseButtons: DragMouseButtons` | What each mouse button does. |
| `readonly touches: DragTouchActions` | What one finger does. |
| `readonly hovered: Object3D \| null` | The object that the pointer is over, or null. |
| `readonly dragging: Object3D \| null` | The object that a drag holds, or null while the user drags nothing. |
| `readonly state: DragAction \| null` | What a drag does to the object that it holds, or null while the user drags nothing. |
| `update(_dt: number): boolean` | Reads the frame's input: a press on a listed object begins a drag, and the pointer then moves or turns that object. Call it once per frame in `onUpdate`. Returns true when it moved an object. |
| `end(): void` | Ends the drag that holds an object, if one does. |

## `DragControlsOptions`

Interface `DragControlsOptions`.

Options for `createDragControls`, with three.js's names and defaults. The controls keep each option as a property of the same name, which a sketch can change at any time.

| Member | Description |
| --- | --- |
| `enabled?: boolean` | False ignores the user's input. The default is true. |
| `recursive?: boolean` | True drags a child of a listed object as its parent. The default is true. |
| `transformGroup?: boolean` | True drags the outermost listed object that holds the one under the pointer, instead of that object alone. The default is false. |
| `rotateSpeed?: number` | How fast a rotate drag turns the object. The default is 1. |
| `layers?: number` | The layers that the pointer's ray tests, as `setLayers` takes them. The default is layer 0 alone, where every new object starts. |
| `mouseButtons?: Partial<DragMouseButtons>` | What each mouse button does. The main button drags and the right one turns, as in three.js. |
| `touches?: Partial<DragTouchActions>` | What one finger does. A finger drags, as in three.js. |

## `DragMouseButtons`

Interface `DragMouseButtons`.

The action of each mouse button, with three.js's names for the buttons. Null gives a button no action.

| Member | Description |
| --- | --- |
| `LEFT: DragAction \| null` | The main button. |
| `MIDDLE: DragAction \| null` | The middle button, or a pressed wheel. |
| `RIGHT: DragAction \| null` | The right button. |

## `DragTouchActions`

Interface `DragTouchActions`.

The action of one finger on the canvas.

| Member | Description |
| --- | --- |
| `ONE: DragAction \| null` | One finger on the canvas. |

## `FirstPersonControls`

Class `FirstPersonControls`.

First-person controls: keys walk the camera over the ground. The user looks around with a drag, or with the mouse while the pointer is locked. W, A, S and D or the arrow keys walk, and R and F move up and down. A left drag or one finger walks forward along the view, and a right drag or two fingers walk back. `createFirstPersonControls` makes them. Call `update` once per frame in `onUpdate`.

| Member | Description |
| --- | --- |
| `enabled: boolean` | False ignores the user's input and stops the camera. |
| `movementSpeed: number` | How fast the keys and the pointer move the camera, in world units per second. |
| `lookSpeed: number` | How fast a drag turns the view: degrees per second for each pixel of the drag. |
| `dampingFactor: number` | The share of the remaining change of speed that each frame applies, at 60 frames per second. |
| `lookVertical: boolean` | False keeps a drag from turning the view up and down. |
| `autoForward: boolean` | True moves the camera forward along the view all the time. |
| `heightSpeed: boolean` | True moves the camera forward faster the higher it is. |
| `heightCoef: number` | How much faster, per world unit of height above `heightMin`. |
| `heightMin: number` | The height from which `heightSpeed` adds speed. |
| `heightMax: number` | The height above which `heightSpeed` adds no more. |
| `constrainVertical: boolean` | True maps the view's angle from +Y into the range from `verticalMin` to `verticalMax`. |
| `verticalMin: number` | The smallest angle between the view and +Y, in radians, with `constrainVertical`. |
| `verticalMax: number` | The largest angle between the view and +Y, in radians, with `constrainVertical`. |
| `pointerSpeed: number` | How fast the locked pointer turns the view: 1 turns 0.002 radians per pixel. |
| `minPolarAngle: number` | The smallest angle between the view and +Y while the pointer is locked, in radians. |
| `maxPolarAngle: number` | The largest angle between the view and +Y while the pointer is locked, in radians. |
| `update(dt: number): boolean` | Moves and turns the camera by the frame's input. Call it once per frame in `onUpdate`, with the frame's step in seconds. Returns true when the camera moved or turned. |
| `lookAt(x: number, y: number, z: number): void` | Turns the camera toward a point, and takes the view's angles from there. |
| `moveForward(distance: number): void` | Moves the camera forward over the ground, at right angles to its right, as three.js's `PointerLockControls.moveForward` does. Negative distances move it back. |
| `moveRight(distance: number): void` | Moves the camera to its right, as three.js's `PointerLockControls.moveRight` does. |
| `getDirection<T extends Vec3Like>(out: T): T` | Copies the direction the camera looks in into `out`, and returns `out`. |

## `FirstPersonControlsOptions`

Interface `FirstPersonControlsOptions`.

Options for `createFirstPersonControls`, with the names and defaults of three.js's `FirstPersonControls` and `PointerLockControls`. The controls keep each option as a property of the same name, which a sketch can change at any time.

| Member | Description |
| --- | --- |
| `enabled?: boolean` | False ignores the user's input and stops the camera. The default is true. |
| `movementSpeed?: number` | How fast the keys and the pointer move the camera, in world units per second. 0 leaves the moves to the sketch, as with three.js's `PointerLockControls`. The default is 1. |
| `lookSpeed?: number` | How fast a drag turns the view: degrees per second for each pixel of the drag. The default is 0.005. |
| `dampingFactor?: number` | The share of the remaining change of speed that each frame applies, at 60 frames per second, so moves and turns start and stop smoothly. Other frame rates get the same motion over the same time. The default is 0.1. |
| `lookVertical?: boolean` | False keeps a drag from turning the view up and down. The default is true. |
| `autoForward?: boolean` | True moves the camera forward along the view all the time. The default is false. |
| `heightSpeed?: boolean` | True moves the camera forward faster the higher it is. The default is false. |
| `heightCoef?: number` | How much faster, per world unit of height above `heightMin`. The default is 1. |
| `heightMin?: number` | The height from which `heightSpeed` adds speed. The default is 0. |
| `heightMax?: number` | The height above which `heightSpeed` adds no more. The default is 1. |
| `constrainVertical?: boolean` | True maps the view's angle from +Y into the range from `verticalMin` to `verticalMax`. The default is false. |
| `verticalMin?: number` | The smallest angle between the view and +Y, in radians, with `constrainVertical`. The default is 0. |
| `verticalMax?: number` | The largest angle between the view and +Y, in radians, with `constrainVertical`. The default is π. |
| `pointerSpeed?: number` | How fast the locked pointer turns the view: 1 turns 0.002 radians per pixel. The default is 1. |
| `minPolarAngle?: number` | The smallest angle between the view and +Y while the pointer is locked, in radians. The default is 0. |
| `maxPolarAngle?: number` | The largest angle between the view and +Y while the pointer is locked, in radians. The default is π. |

## `FlyControls`

Class `FlyControls`.

Fly controls: they move the camera in all directions and turn it about its own axes, as in a flight game. W, A, S and D move it forward, left, back and right, and R and F move it up and down. The arrow keys turn it, and Q and E roll it. The pointer steers: the farther it is from the canvas's middle, the faster the camera turns. `createFlyControls` makes them. Call `update` once per frame in `onUpdate`.

| Member | Description |
| --- | --- |
| `enabled: boolean` | False ignores the user's input and stops the camera. |
| `movementSpeed: number` | How fast the camera moves, in world units per second. |
| `rollSpeed: number` | How fast the camera turns: about twice this, in radians per second, at full turn. |
| `dragToLook: boolean` | True steers only while a button or a finger is down. |
| `autoForward: boolean` | True moves the camera forward all the time, unless a key moves it back. |
| `update(dt: number): boolean` | Moves and turns the camera by the frame's input. Call it once per frame in `onUpdate`, with the frame's step in seconds. Returns true when the camera moved or turned. |

## `FlyControlsOptions`

Interface `FlyControlsOptions`.

Options for `createFlyControls`, with three.js's names and defaults. The controls keep each option as a property of the same name, which a sketch can change at any time.

| Member | Description |
| --- | --- |
| `enabled?: boolean` | False ignores the user's input and stops the camera. The default is true. |
| `movementSpeed?: number` | How fast the camera moves, in world units per second. The default is 1. |
| `rollSpeed?: number` | How fast the camera turns, in radians per second at full turn: about twice this, as three.js counts it. The default is 0.005. |
| `dragToLook?: boolean` | True steers only while a button or a finger is down. False steers by the pointer's place whenever it moves over the canvas, and the left and right buttons move forward and back. The default is false. |
| `autoForward?: boolean` | True moves the camera forward all the time, unless a key moves it back. The default is false. |

## `GizmoAxis`

```ts
type GizmoAxis = 'X' | 'Y' | 'Z' | 'XY' | 'YZ' | 'XZ' | 'XYZ' | 'E';
```

The handle that the user grabs, with three.js's names: one axis, two axes of a plane handle, all three for the center handle, and `E` for the outer ring that turns about the view.

## `GizmoMode`

```ts
type GizmoMode = 'translate' | 'rotate' | 'scale';
```

What a drag does to the object: move it, turn it or scale it.

## `GizmoSpace`

```ts
type GizmoSpace = 'world' | 'local';
```

The axes that a drag works along: the three axes of the world, or the object's own axes.

## `MapControls`

Class `MapControls`, which extends `OrbitControls`.

Map controls: orbit controls for a camera that looks down on a map. A left drag or one finger pans over the ground and keeps the point under the pointer there. A right drag or two fingers turn the camera. `createMapControls` makes them.

## `MouseAction`

```ts
type MouseAction = 'rotate' | 'dolly' | 'pan';
```

What a held mouse button does: turn the camera around the target, dolly it toward the target, or pan the camera and the target together.

## `MouseButtons`

Interface `MouseButtons`.

The action of each mouse button, with three.js's names for the buttons. Null gives a button no action.

| Member | Description |
| --- | --- |
| `LEFT: MouseAction \| null` | The main button. |
| `MIDDLE: MouseAction \| null` | The middle button, or a pressed wheel. |
| `RIGHT: MouseAction \| null` | The right button. |

## `OneFingerAction`

```ts
type OneFingerAction = 'rotate' | 'pan';
```

What one finger does.

## `OrbitControls`

Class `OrbitControls`.

Orbit controls: they turn a camera around a target point, dolly it toward the target, and pan both. They follow the sketch's pointer, wheel and touch input. `createOrbitControls` makes them. Call `update` once per frame in `onUpdate`.

| Member | Description |
| --- | --- |
| `readonly target: [number, number, number]` | The point the camera orbits and looks at. Change it in place, such as with `vec3.set(controls.target, x, y, z)`. |
| `enabled: boolean` | False ignores the user's input. Damping and auto-rotation still move the camera. |
| `enableDamping: boolean` | True keeps the camera moving for a moment after the user lets go. |
| `dampingFactor: number` | The share of the remaining motion that each frame applies with damping on, at 60 frames per second. |
| `enableRotate: boolean` | False stops the user turning the camera. |
| `rotateSpeed: number` | How fast drags turn the camera. |
| `enableZoom: boolean` | False stops the user dollying the camera. |
| `zoomSpeed: number` | How fast the wheel, a pinch and a dolly drag move the camera. |
| `enablePan: boolean` | False stops the user panning the camera. |
| `panSpeed: number` | How fast drags pan the camera. |
| `screenSpacePanning: boolean` | True pans in the plane of the screen; false pans over the ground. |
| `minDistance: number` | The closest the camera comes to the target. |
| `maxDistance: number` | The farthest the camera goes from the target. |
| `minZoom: number` | The smallest zoom of an orthographic camera: 1 shows the view's height when the controls start. |
| `maxZoom: number` | The largest zoom of an orthographic camera. |
| `minPolarAngle: number` | The smallest angle between the camera and +Y as seen from the target, in radians. |
| `maxPolarAngle: number` | The largest angle between the camera and +Y as seen from the target, in radians. |
| `minAzimuthAngle: number` | The smallest angle around +Y, in radians. |
| `maxAzimuthAngle: number` | The largest angle around +Y, in radians. |
| `autoRotate: boolean` | True turns the camera around the target while the user is not dragging. |
| `autoRotateSpeed: number` | How fast auto-rotation turns: 2 takes 30 seconds for one turn. |
| `readonly mouseButtons: MouseButtons` | What each mouse button does. |
| `readonly touches: TouchActions` | What one and two fingers do. |
| `update(dt: number): boolean` | Moves the camera by the frame's input, damping and auto-rotation, and turns it toward the target. Call it once per frame in `onUpdate`, with the frame's step in seconds. Returns true when the camera or the target moved. |
| `getDistance(): number` | The distance from the camera to the target. |
| `getPolarAngle(): number` | The angle between the camera and +Y as seen from the target, in radians, after the last update. |
| `getAzimuthalAngle(): number` | The camera's angle around +Y as seen from the target, in radians, after the last update. |
| `rotateLeft(angle: number): void` | Turns the camera around +Y by `angle` radians, to the camera's left. The next `update` applies it. |
| `rotateUp(angle: number): void` | Turns the camera up over the target by `angle` radians. The next `update` applies it. |
| `pan(deltaX: number, deltaY: number): void` | Pans the camera and the target as a drag of `deltaX` pixels to the right and `deltaY` pixels down would. The next `update` applies it. |
| `dollyIn(dollyScale: number): void` | Moves the camera toward the target: `dollyScale` below 1 scales the distance by it. The next `update` applies it. |
| `dollyOut(dollyScale: number): void` | Moves the camera away from the target: `dollyScale` below 1 divides the distance by it. The next `update` applies it. |
| `stop(): void` | Freezes the camera: it drops the turn, the tilt, the pan and the zoom that damping has left to apply, so the camera stays exactly where it is. A page that takes the camera from the controls for a while, such as a route that drives it, calls this at the handover, or the motion that was still decaying resumes at the next `update`. |

## `OrbitControlsOptions`

Interface `OrbitControlsOptions`.

Options for `createOrbitControls` and `createMapControls`, with three.js's names and defaults. The controls keep each option as a property of the same name, which a sketch can change at any time.

| Member | Description |
| --- | --- |
| `target?: Vec3Like` | The point the camera orbits and looks at. The default is (0, 0, 0). |
| `enabled?: boolean` | False ignores the user's input. Damping and auto-rotation still move the camera. The default is true. |
| `enableDamping?: boolean` | True keeps the camera moving for a moment after the user lets go, and slows it each frame. The default is false. |
| `dampingFactor?: number` | The share of the remaining motion that each frame applies with damping on, at 60 frames per second. Other frame rates get the same motion over the same time. The default is 0.05. |
| `enableRotate?: boolean` | False stops the user turning the camera. The default is true. |
| `rotateSpeed?: number` | How fast drags turn the camera. The default is 1. |
| `enableZoom?: boolean` | False stops the user dollying the camera. The default is true. |
| `zoomSpeed?: number` | How fast the wheel, a pinch and a dolly drag move the camera. The default is 1. |
| `enablePan?: boolean` | False stops the user panning the camera. The default is true. |
| `panSpeed?: number` | How fast drags pan the camera. The default is 1. |
| `screenSpacePanning?: boolean` | True pans in the plane of the screen. False pans over the ground: the plane at right angles to +Y. The default is true for orbit controls and false for map controls. |
| `minDistance?: number` | The closest the camera comes to the target. The default is 0. |
| `maxDistance?: number` | The farthest the camera goes from the target. The default is Infinity. |
| `minZoom?: number` | The smallest zoom of an orthographic camera, as three.js counts zoom: 1 shows the view's height when the controls start, and 2 shows half of it. The default is 0. |
| `maxZoom?: number` | The largest zoom of an orthographic camera. The default is Infinity. |
| `minPolarAngle?: number` | The smallest angle between the camera and +Y as seen from the target, in radians. The default is 0. |
| `maxPolarAngle?: number` | The largest angle between the camera and +Y as seen from the target, in radians. The default is π. |
| `minAzimuthAngle?: number` | The smallest angle around +Y, in radians. At 0 the camera is on the target's +Z side. With both limits set, the range must lie within -2π to 2π and span less than 2π. The default is -Infinity. |
| `maxAzimuthAngle?: number` | The largest angle around +Y, in radians. The default is Infinity. |
| `autoRotate?: boolean` | True turns the camera around the target while the user is not dragging. It stops while the user asks for less motion. The default is false. |
| `autoRotateSpeed?: number` | How fast auto-rotation turns: 2 takes 30 seconds for one turn. The default is 2. |
| `mouseButtons?: Partial<MouseButtons>` | What each mouse button does. Orbit controls rotate with the left button, dolly with the middle one and pan with the right one. Map controls pan with the left button and rotate with the right one. |
| `touches?: Partial<TouchActions>` | What one and two fingers do. Orbit controls rotate with one finger and dolly and pan with two. Map controls pan with one finger and dolly and rotate with two. |

## `TouchActions`

Interface `TouchActions`.

The action of one finger and of two fingers, with three.js's names. Null gives no action.

| Member | Description |
| --- | --- |
| `ONE: OneFingerAction \| null` | One finger on the canvas. |
| `TWO: TwoFingerAction \| null` | Two fingers on the canvas. |

## `TransformControls`

Class `TransformControls`.

Translate, rotate and scale gizmos for one object. `createTransformControls` makes them, and `attach` picks the object. Call `update(dt)` once per frame in `onUpdate`.

| Member | Description |
| --- | --- |
| `mode: GizmoMode` | What a drag does: move the object, turn it or scale it. |
| `space: GizmoSpace` | The axes that a drag works along. A scale drag always works along the object's own axes. |
| `size: number` | The size of the handles on the screen. |
| `showX: boolean` | True shows the handles of the X axis, and the planes that it lies in. |
| `showY: boolean` | True shows the handles of the Y axis, and the planes that it lies in. |
| `showZ: boolean` | True shows the handles of the Z axis, and the planes that it lies in. |
| `enabled: boolean` | False ignores the user's input. |
| `translationSnap: number \| null` | The steps, in meters, that a move snaps to, or null for a free move. |
| `rotationSnap: number \| null` | The steps, in radians, that a turn snaps to, or null for a free turn. |
| `scaleSnap: number \| null` | The steps that a scale snaps to, or null for a free scale. |
| `readonly object: Object3D \| undefined` | The object that the handles change, or undefined while none is attached. |
| `readonly axis: GizmoAxis \| null` | The axis under the pointer while the user drags it, or null. |
| `readonly dragging: boolean` | True while the user drags a handle. |
| `attach(object: Object3D): void` | Picks the object that the handles change, and shows the handles on it. |
| `detach(): void` | Hides the handles and stops changing the object. |
| `setMode(mode: GizmoMode): void` | Sets what a drag does: move the object, turn it or scale it. |
| `setSpace(space: GizmoSpace): void` | Sets the axes that a drag works along. |
| `setSize(size: number): void` | Sets the size of the handles on the screen. |
| `update(dt: number): boolean` | Reads the frame's input: a press on a handle begins a drag, and the pointer then moves, turns or scales the object. Call it once per frame in `onUpdate`. Returns true when it changed the object. |
| `destroy(): void` | Removes the handles from the scene, and gives the camera back its own layers. |

## `TransformControlsOptions`

Interface `TransformControlsOptions`.

Options for `createTransformControls`, with three.js's names and defaults. The controls keep each option as a property of the same name, which a sketch can change at any time.

| Member | Description |
| --- | --- |
| `mode?: GizmoMode` | What a drag does: move the object, turn it or scale it. The default is `'translate'`. |
| `space?: GizmoSpace` | The axes that a drag works along: the world's or the object's own. A scale drag always works along the object's axes, as in three.js. The default is `'world'`. |
| `size?: number` | The size of the handles on the screen. The default is 1. |
| `showX?: boolean` | False hides the handles of the X axis, and the planes that it lies in. The default is true. |
| `showY?: boolean` | False hides the handles of the Y axis, and the planes that it lies in. The default is true. |
| `showZ?: boolean` | False hides the handles of the Z axis, and the planes that it lies in. The default is true. |
| `enabled?: boolean` | False ignores the user's input. The default is true. |
| `translationSnap?: number \| null` | The steps, in meters, that a move snaps to. The default is null: a free move. |
| `rotationSnap?: number \| null` | The steps, in radians, that a turn snaps to. The default is null: a free turn. |
| `scaleSnap?: number \| null` | The steps that a scale snaps to. The default is null: a free scale. |
| `layers?: number` | The layer that the handles draw on, as `setLayers` takes it. The controls add it to the camera's layers, and take it away when they are destroyed. The default is layer 30. |
| `pickLayers?: number` | The layer that the handles answer a raycast on. The camera never draws it, so give it a layer that no camera of the scene draws. The default is layer 29. |

## `TwoFingerAction`

```ts
type TwoFingerAction = 'dolly-pan' | 'dolly-rotate';
```

What two fingers do: they dolly as they spread or close, and pan or rotate as they move together.
