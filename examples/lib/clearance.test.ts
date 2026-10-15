// The clearance guard of the Auto route, and the manual camera's freedom. The guard stops the route
// entering a solid and never stops a move away from one; the manual camera may pass through
// anything and may always dolly out ([D-170](../../.dev/decisions/D-170-showcase-camera.md)).
import { expect, test } from 'bun:test';
import { createOrbitControls } from '@null3d/controls';
import { type RaycastHit, type SketchContext, vec3 } from '@null3d/engine';
import { InputRing } from '../../packages/engine/src/page/input-ring';
import { controlViews, createControlBuffer, Slot } from '../../packages/engine/src/shared/control';
import { KEY_CODES } from '../../packages/engine/src/shared/key-codes';
import { InputReader } from '../../packages/engine/src/sketch/input';
import { StandInCamera } from '../../tests/pages/lib/stand-in-cameras';
import { createClearance } from './clearance';
import { EFFECT_LAYER, INTERIOR_LAYER } from './layers';

/** A scene whose only solid is a wall at x = `wallX`, facing -x. */
function stubScene(wallX: number): SketchContext['scene'] {
	return {
		raycast(origin: number[], direction: number[], _options: unknown, hit: RaycastHit): boolean {
			if ((direction[0] as number) <= 0) return false;
			const t = (wallX - (origin[0] as number)) / (direction[0] as number);
			if (t < 0) return false;
			hit.distance = t;
			hit.normal[0] = -1;
			hit.normal[1] = 0;
			hit.normal[2] = 0;
			return true;
		},
	} as unknown as SketchContext['scene'];
}

const guardAt = (wallX: number) =>
	createClearance({ scene: stubScene(wallX) } as unknown as SketchContext);
const point = (x: number, y: number, z: number) => vec3.set(vec3.create(), x, y, z);

test('the guard stops a move into a wall', () => {
	const out = vec3.create();
	expect(guardAt(10).move(point(0, 0, 0), point(12, 0, 0), out)).toBe(true);
	expect(out[0]).toBeCloseTo(9.5, 5);
});

test('the guard never stops a move away from a surface, or a move already clear', () => {
	const out = vec3.create();
	// A move away from the wall is not clamped.
	expect(guardAt(10).move(point(9, 0, 0), point(8, 0, 0), out)).toBe(false);
	expect(out[0]).toBe(8);
	// A wall behind the wanted point does not clamp the move.
	expect(guardAt(10).move(point(0, 0, 0), point(5, 0, 0), out)).toBe(false);
	expect(out[0]).toBe(5);
});

test('the air and the interiors are not solid to the guard', () => {
	// The guard tests the layers below both: what fills the air, and what may be entered, are out.
	expect(EFFECT_LAYER).toBeGreaterThan(0);
	expect(INTERIOR_LAYER).toBeGreaterThan(EFFECT_LAYER);
});

/** A manual orbit camera over an empty scene, with the input ring the controls read. */
function manualCamera() {
	const buffer = createControlBuffer(false);
	const views = controlViews(buffer);
	views.slotFloats[Slot.CanvasCssWidth] = 640;
	views.slotFloats[Slot.CanvasCssHeight] = 360;
	const reader = new InputReader(views, KEY_CODES);
	const context = {
		input: reader,
		engine: { viewport: { width: 640, height: 360, pixelRatio: 1 } },
		preferences: { reducedMotion: false },
	} as unknown as SketchContext;
	const camera = new StandInCamera();
	camera.setPosition(0, 6, 14);
	camera.lookAt(0, 1, 0);
	const controls = createOrbitControls(context, camera as never, {
		enableDamping: true,
		screenSpacePanning: false,
		minDistance: 0.5,
		minPolarAngle: 0.05,
		maxPolarAngle: 3,
	});
	controls.target[0] = 0;
	controls.target[1] = 1;
	controls.target[2] = 0;
	controls.update(1 / 60);
	const distance = () =>
		Math.hypot(
			(camera.stored[0] as number) - (controls.target[0] as number),
			(camera.stored[1] as number) - (controls.target[1] as number),
			(camera.stored[2] as number) - (controls.target[2] as number),
		);
	return { camera, controls, distance };
}

test('the manual camera can dolly out, and the distance stays out', () => {
	const { controls, distance } = manualCamera();
	const start = distance();
	for (let k = 0; k < 10; k++) {
		controls.dollyOut(0.8);
		controls.update(1 / 60);
	}
	const grown = distance();
	expect(grown).toBeGreaterThan(start * 1.2);
	// Nothing pulls it back in: the distance stays grown over more frames.
	for (let k = 0; k < 30; k++) controls.update(1 / 60);
	expect(distance()).toBeGreaterThan(start * 1.2);
});

test('the manual camera turns without shrinking its distance', () => {
	const { controls, distance } = manualCamera();
	const start = distance();
	for (let k = 0; k < 30; k++) {
		controls.rotateLeft(0.02);
		controls.update(1 / 60);
	}
	// A turn changes the direction, never the distance to the target: no ratchet.
	expect(Math.abs(distance() - start)).toBeLessThan(0.05);
});
