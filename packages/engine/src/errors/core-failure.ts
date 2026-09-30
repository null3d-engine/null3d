// Turns a failure the engine core reported into an EngineError. The core reports a numeric code
// from the engine's error table and two detail numbers; this names the call and the object.

import { EngineError, isErrorCode } from './engine-error';
import type { ErrorCode } from './fixes';

/** The core's error functions, which every build exports. */
export interface CoreErrors {
	lastErrorCode(): number;
	lastErrorDetail(index: number): number;
}

/**
 * The name that errors give a change that a call queued for the next frame. The frame applies the
 * changes of every call at once, so the call that queued a failing change is not known.
 */
export const QUEUED_CHANGE = 'a queued change';

const MB = 1024 * 1024;

/** Stores of fixed capacity, by the core's resource number: each store, and what it holds. */
const RESOURCES: Record<number, readonly [store: string, unit: string]> = {
	1: ['scene', 'objects'],
	2: ['batch table', 'batches'],
	3: ['command ring', 'changes'],
	4: ['background task queue', 'tasks'],
	5: ['frame arena', 'bytes'],
};

/** What the renderer ran out of, by the first detail of E1501. */
const RENDER_LIMITS: Record<number, string> = {
	1: 'the draw list is full',
	4: 'the material table is full',
	7: 'the mesh does not fit the mesh buffers',
	8: "the frame's uploads do not fit the room the renderer set aside for them",
	10: 'the texture table is full',
	11: "the texture's format, sampler settings or image size is not one the engine draws",
};
const TOO_MANY_SOURCES = 3;
const TEXTURE_TOO_LARGE = 9;
const UNKNOWN_MATERIAL = 5;
const UNKNOWN_MESH = 6;

/**
 * The error for the core's last failure. `call` names the API call, such as 'createMesh', or in
 * words what failed, such as 'the frame' or a queued change. `what` describes the object it was
 * about, such as '"Player"'.
 */
export function coreFailure(core: CoreErrors, call: string, what = 'an object'): EngineError {
	const code = core.lastErrorCode();
	const [a, b] = [core.lastErrorDetail(0), core.lastErrorDetail(1)];
	const error = (id: ErrorCode, detail: string) => new EngineError(id, detail);
	// Only the name of a call, which has no spaces, gets parentheses.
	const isCall = !call.includes(' ');
	const name = isCall ? `${call}()` : call;
	switch (code) {
		case 1101:
			return error(
				'E1101',
				`${name} ${isCall ? 'was called on' : 'named'} ${what} (slot ${a}), which was destroyed in frame ${b}.`,
			);
		case 1102: {
			const [store, unit] = RESOURCES[a] ?? ['store', 'items'];
			return error('E1102', `${name} failed: the ${store} already holds ${b} ${unit}.`);
		}
		case 1103:
			return error('E1103', `${name} got an object that is not from this engine.`);
		case 1104:
			return error(
				'E1104',
				`${name} on ${what} (slot ${a}) would put it under its own descendant (slot ${b}).`,
			);
		case 1105:
			return error('E1105', `the engine core received command ${a}.`);
		case 1106:
			return error('E1106', `${name} named ${what} (slot ${a}), which the engine never created.`);
		case 1107:
			return error('E1107', `the object in slot ${a} was created twice.`);
		case 1108:
			return error('E1108', `${name} got ${a}, above the limit of ${b}.`);
		case 1109:
			return error(
				'E1109',
				`${name} failed: the engine could not get ${Math.ceil(a / MB)} MB more memory.`,
			);
		case 1403:
			return error('E1403', `${name} ran before the engine core started.`);
		case 1501:
			if (a === TOO_MANY_SOURCES)
				return error(
					'E1501',
					`${name} failed: the scene has more objects and instance rows than this device can cull and draw (${b.toLocaleString('en-US')} at most).`,
				);
			if (a === TEXTURE_TOO_LARGE)
				return error(
					'E1501',
					`${call}() failed: the texture is larger than the ${b} pixels a side that this device's texture arrays hold.`,
				);
			if (a === UNKNOWN_MATERIAL || a === UNKNOWN_MESH)
				return error(
					'E1103',
					`${name} got a ${a === UNKNOWN_MESH ? 'mesh' : 'material'} that is not from this engine.`,
				);
			return error('E1501', `${name} failed: ${RENDER_LIMITS[a] ?? 'a render limit was reached'}.`);
		default: {
			const id = `E${code}`;
			return error(
				isErrorCode(id) ? id : 'E1105',
				`${name} failed in the engine core with code ${code}.`,
			);
		}
	}
}
