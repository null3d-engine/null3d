---
id: api/reference/input
title: "Input: API reference"
status: generated
since: "0.1"
summary: "Every export of the Input API, from the engine's doc comments."
---

# Input: API reference

> [Input](../input.md) explains these exports. The engine's doc comments make this page.

## `Input`

Interface `Input`.

The input that the page forwards to the sketch: pointer, touch, keyboard and gamepad. It changes once per frame, before `onUpdate`, so every call in one frame gives the same answer. Keys take their `KeyboardEvent.code` names, such as `KeyW`, `Space` or `ArrowLeft`, which name the key's place on the keyboard whatever its layout. Mouse buttons are `Mouse0` (the main button, or a finger) to `Mouse4`. Gamepad names follow the standard layout, as on an Xbox controller.

| Member | Description |
| --- | --- |
| `readonly pointer: InputPointer` | The main pointer: the mouse, a pen, or the first finger on the canvas. |
| `readonly touches: readonly InputTouch[]` | The fingers on the canvas, oldest first. The list and its entries change in place. |
| `readonly actions: InputActions` | Named actions, such as `jump`, each for a list of keys and buttons. |
| `isDown(name: string): boolean` | True while the key, button or action is down. |
| `wasPressed(name: string): boolean` | True in the first frame after the key, button or action went down. |
| `wasReleased(name: string): boolean` | True in the first frame after the key, button or action came up. |
| `value(name: string): number` | How far the key, button or action is down, from 0 to 1. Keys and most buttons give 0 or 1. The triggers `GamepadLT` and `GamepadRT` and the stick directions, such as `GamepadLeftStickUp`, give the values between. A stick gives 0 until it leaves its dead zone near the center. |

## `InputActions`

Interface `InputActions`.

Named actions, each for a list of keys and buttons.

| Member | Description |
| --- | --- |
| `define(actions: Readonly<Record<string, readonly string[]>>): void` | Names actions, each for a list of key and button names, such as `{ jump: ['Space', 'GamepadA'] }`. The input calls then take the action's name. An action is down while any of its keys and buttons is down, and its value is the largest of their values. Defining a name again replaces its list. |

## `InputPointer`

Interface `InputPointer`.

The main pointer: the mouse, a pen, or the first finger that touches the canvas. A frame's drag belongs to one press: a press that follows a release in the same frame waits for the next frame.

| Member | Description |
| --- | --- |
| `readonly x: number` | Distance from the canvas's left edge in CSS pixels, at the pointer's last event. |
| `readonly y: number` | Distance from the canvas's top edge in CSS pixels, at the pointer's last event. |
| `readonly ndcX: number` | `x` in normalized device coordinates: -1 at the canvas's left edge and 1 at its right edge. |
| `readonly ndcY: number` | `y` in normalized device coordinates: -1 at the canvas's bottom edge and 1 at its top edge. |
| `readonly buttons: number` | The buttons held, as `PointerEvent.buttons` gives them: 1 for the main button, 2 for the right button and 4 for the middle button, added together. A finger on the screen holds the main button. |
| `readonly dx: number` | Movement to the right since the previous frame, in CSS pixels. |
| `readonly dy: number` | Movement down since the previous frame, in CSS pixels. |
| `readonly dragDx: number` | The part of `dx` made while a button was held: a drag. Movement before a press or after a release in the same frame does not count. |
| `readonly dragDy: number` | The part of `dy` made while a button was held: a drag. |
| `readonly wheel: number` | The wheel's scroll since the previous frame, in pixels: positive where a page would scroll down. A wheel that scrolls by lines counts 16 pixels a line, and one that scrolls by pages counts 100 a page, as three.js's controls count them. Scroll that follows a release of the pointer waits for the next frame, so a frame's scroll never comes after the end of its drag. |
| `readonly pinch: number` | The part of `wheel` that came from a pinch on a trackpad: positive as the fingers close. Browsers send a pinch as wheel scroll that holds the Control key's flag while no Control key is down. |
| `readonly isTouch: boolean` | True when the pointer is a finger on a touch screen. |
| `readonly locked: boolean` | True while the canvas holds the pointer lock, which `engine.requestPointerLock()` asks for on the page. The browser then hides the pointer and keeps it still: `x` and `y` stay where the lock began, `dx` and `dy` give the mouse's movement, and objects take no pointer events. |

## `InputTouch`

Interface `InputTouch`.

A finger on the canvas.

| Member | Description |
| --- | --- |
| `readonly id: number` | A number that stays the same while the finger stays down. |
| `readonly x: number` | Distance from the canvas's left edge in CSS pixels. |
| `readonly y: number` | Distance from the canvas's top edge in CSS pixels. |
| `readonly dx: number` | Movement to the right since the previous frame, in CSS pixels. |
| `readonly dy: number` | Movement down since the previous frame, in CSS pixels. |

## `ObjectEventHandler`

```ts
type ObjectEventHandler = (event: ObjectPointerEvent) => void;
```

A handler of pointer events on an object.

## `ObjectEventType`

```ts
type ObjectEventType =
	| 'click'
	| 'pointerdown'
	| 'pointerup'
	| 'pointermove'
	| 'pointerenter'
	| 'pointerleave';
```

The pointer events that objects take, as `object.on` names them. The section on pointer events above says when each one comes.

## `ObjectPointerEvent`

Interface `ObjectPointerEvent`.

A pointer event on an object, which the handlers of `object.on` take. The engine reuses one event object for every handler, so copy any value that you keep after the handler returns.

| Member | Description |
| --- | --- |
| `readonly type: ObjectEventType` | The event's type. |
| `readonly object: Object3D \| InstanceBatch \| SpriteBatch \| PointBatch \| LineBatch \| null` | The object under the pointer: the closest object that the ray hits, or the batch of a row: an instance, sprite, point or line batch. It can be a child of the object whose handler runs. For `pointerleave`, it is the object that the pointer moved onto, or null when the pointer is over nothing. |
| `readonly instance: number` | The row of a batch: an instance row, a sprite, a point or a line's segment. -1 for an object. |
| `readonly point: Vec3Like` | Where the ray hits `object`, in world space. |
| `readonly normal: Vec3Like` | The unit normal of the hit triangle in world space, on the side that faces the camera. A hit on a sprite or a point faces the camera; on a line, it points back along the ray. |
| `readonly distance: number` | The distance from the ray's origin to the hit, in meters. |
| `readonly triangle: number` | The index of the hit triangle in its mesh, as three.js's `faceIndex`, or -1 for a sprite, a point or a line. |
| `readonly ray: Ray` | The ray from the camera through the pointer, from the frame that was on screen at the event. |
| `readonly x: number` | The pointer's distance from the canvas's left edge in CSS pixels. |
| `readonly y: number` | The pointer's distance from the canvas's top edge in CSS pixels. |
| `readonly pointerId: number` | The browser's `pointerId`: each finger on a touch screen has its own. |
| `readonly isTouch: boolean` | True when the pointer is a finger on a touch screen. |
| `readonly button: number` | The button that went down or came up, as `PointerEvent.button` gives it: 0 for the main button or a finger, 1 for the middle button and 2 for the right button. -1 for the other events. |
| `readonly buttons: number` | The buttons held, as `PointerEvent.buttons` gives them: 1 for the main button, 2 for the right. |
| `stopPropagation(): void` | Stops the event from going on to the parents of the object whose handler runs. |
