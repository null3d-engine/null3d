// Objects with pointer event handlers, for the object events test. Three boxes face the camera: one
// on the left and one in the middle, which a group holds, and one on the right. A wide panel stands
// behind the middle box. Each handler writes a line: the event's type, the object whose handler
// runs, and the object hit. The page's messages add and remove the handlers, give the lines and the
// count of rays that pointer events cast, and start a fast pan. During the pan the camera turns a
// fixed step in each frame inside a dome, whose clicks must cast their rays from the frame on
// screen at the click. With the engine on the page's own thread, the 'loop' message also puts a loop
// on the page's global object, which dispatches presses, releases and moves over the boxes, and a
// pointer that rests, for the test that checks that pointer events allocate nothing.
import {
	defineSketch,
	type ObjectEventHandler,
	type ObjectEventType,
	type ObjectPointerEvent,
} from '@null3d/engine';
import {
	EVENT_POINTER_DOWN,
	EVENT_POINTER_MOVE,
	EVENT_POINTER_UP,
	FLAG_PRIMARY,
} from '../../../packages/engine/src/shared/control';
import { shownFrame } from '../lib/shown-frame';

/** The page's global object, which holds the loop that the test calls. */
const scope = globalThis as { __null3dPointerLoop?: (iterations: number) => number };
/** The events of each frame of the loop: their type, x in CSS pixels and buttons. */
const LOOP_EVENTS = [
	[EVENT_POINTER_MOVE, 100, 0],
	[EVENT_POINTER_DOWN, 100, 1],
	[EVENT_POINTER_UP, 100.5, 0],
	[EVENT_POINTER_MOVE, 220.25, 0],
] as const;

/** The camera's turn per frame during the pan, in radians. */
const STEP = 0.05;
/** Where the dome stands, far from the boxes. */
const DOME_HEIGHT = 100;

/** The turn about the vertical axis of a direction, in radians, as `setRotationEuler` sets it. */
const turnOf = (direction: { readonly [index: number]: number }) =>
	Math.atan2(-(direction[0] as number), -(direction[2] as number));

const nameOf = (object: ObjectPointerEvent['object']) =>
	object === null ? 'nothing' : ((object as { name?: string }).name ?? 'a batch');

export default defineSketch(({ scene, geometry, materials, input, page, time }) => {
	const camera = scene.createPerspectiveCamera({ fov: 50, position: [0, 0, 8], target: [0, 0, 0] });
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({ direction: [-1, -2, -3], intensity: 3 });
	const paint = materials.standard({ color: '#4a8cff' });
	const cube = geometry.box({ width: 1.5, height: 1.5, depth: 1.5 });
	const pair = scene.createGroup({ name: 'pair' });
	const left = scene.createMesh({ name: 'left', mesh: cube, material: paint, parent: pair });
	left.setPosition(-2.5, 0, 0);
	const middle = scene.createMesh({ name: 'middle', mesh: cube, material: paint, parent: pair });
	const right = scene.createMesh({ name: 'right', mesh: cube, material: paint });
	right.setPosition(2.5, 0, 0);
	const panel = scene.createMesh({
		name: 'panel',
		mesh: geometry.box({ width: 4, height: 4, depth: 0.5 }),
		material: materials.standard({ color: '#d9a441' }),
		position: [0, 0, -3],
	});
	const dome = scene.createMesh({
		name: 'dome',
		mesh: geometry.sphere({ radius: 10 }),
		material: materials.standard({ color: '#7c8a99', doubleSided: true }),
		position: [0, DOME_HEIGHT, 0],
	});

	const lines: string[] = [];
	const panClicks: { frame: number; shown: number; turn: number; hit: string }[] = [];
	const handlers: [typeof pair, ObjectEventType, ObjectEventHandler][] = [];
	const listen = (object: typeof pair, ...types: ObjectEventType[]) => {
		for (const type of types) {
			const handler: ObjectEventHandler = (event) =>
				lines.push(`${event.type} ${object.name} ${nameOf(event.object)}`);
			object.on(type, handler);
			handlers.push([object, type, handler]);
		}
	};
	/** The frame in which the pan started, or -1 before it. */
	let panStart = -1;
	page.onMessage((name) => {
		if (name === 'listen') {
			listen(pair, 'click', 'pointerenter', 'pointerleave');
			for (const box of [left, middle, right])
				listen(box, 'click', 'pointerdown', 'pointerup', 'pointerenter', 'pointerleave');
			listen(panel, 'click', 'pointerenter', 'pointerleave');
		} else if (name === 'unlisten') {
			for (const [object, type, handler] of handlers.splice(0)) object.off(type, handler);
		} else if (name === 'loop') {
			startLoop();
		} else if (name === 'pan') {
			panStart = time.frame;
			camera.setPosition(0, DOME_HEIGHT, 0);
			dome.on('click', (event) => {
				panClicks.push({
					frame: time.frame,
					shown: shownFrame(input),
					turn: turnOf(event.ray.direction),
					hit: nameOf(event.object),
				});
			});
		}
		const rays = (scene as unknown as { pointerEvents: { rays: number } }).pointerEvents.rays;
		const panFrames = panStart < 0 ? 0 : time.frame - panStart;
		const { x, y, buttons } = input.pointer;
		page.post('reply', {
			lines,
			rays,
			step: STEP,
			panClicks,
			panFrames,
			pointer: { x, y, buttons },
		});
	});
	/** Handlers that only count, and the loop that feeds the pointer events' log by hand. */
	function startLoop() {
		const counts = new Int32Array(1);
		const count = () => {
			counts[0] = (counts[0] as number) + 1;
		};
		for (const box of [pair, left, middle, right, panel])
			for (const type of [
				'click',
				'pointerdown',
				'pointerup',
				'pointerenter',
				'pointerleave',
			] as const)
				box.on(type, count);
		const internals = scene as unknown as {
			pointerEvents: { log: { count: number; ints: Int32Array; floats: Float32Array } };
			dispatchPointerEvents(report: (error: unknown) => void): void;
		};
		const { log } = internals.pointerEvents;
		const report = (error: unknown) => {
			throw error;
		};
		scope.__null3dPointerLoop = (iterations) => {
			const before = counts[0] as number;
			for (let i = 0; i < iterations; i++) {
				// Every other frame has no event, so the resting pointer casts its ray again.
				log.count = 0;
				if (i % 2 === 0) {
					for (let k = 0; k < LOOP_EVENTS.length; k++) {
						const [type, x, buttons] = LOOP_EVENTS[k] as (typeof LOOP_EVENTS)[number];
						const at = k * 6;
						log.ints[at] = type;
						log.ints[at + 1] = 1;
						log.ints[at + 2] = time.frame;
						log.ints[at + 3] = 0;
						log.ints[at + 4] = buttons;
						log.ints[at + 5] = FLAG_PRIMARY;
						log.floats[k * 2] = x + (i % 8) * 0.125;
						log.floats[k * 2 + 1] = 90.5;
					}
					log.count = LOOP_EVENTS.length;
				}
				internals.dispatchPointerEvents(report);
			}
			log.count = 0;
			return (counts[0] as number) - before;
		};
	}

	return {
		onUpdate() {
			if (panStart >= 0) camera.setRotationEuler(0, time.frame * STEP, 0);
		},
	};
});
