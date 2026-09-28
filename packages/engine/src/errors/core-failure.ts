// Turns a failure the engine core reported into an EngineError. The core reports a numeric code
// from the engine's error table and two detail numbers; this names the call and the object.

import { ERRORS, type ErrorCode } from './codes';
import { EngineError } from './engine-error';

/** The core's error functions, which every build exports. */
export interface CoreErrors {
	lastErrorCode(): number;
	lastErrorDetail(index: number): number;
}

/** Stores of fixed capacity, by the core's resource number. */
const RESOURCES: Record<number, string> = {
	1: 'scene',
	2: 'batch table',
	3: 'command ring',
	4: 'background task queue',
	5: 'frame arena',
};

/** What the renderer ran out of, by the first detail of E1501. */
const RENDER_LIMITS: Record<number, string> = {
	1: 'the draw list is full',
	2: 'the mesh buffers are full',
	3: 'the scene has more objects than one culling pass covers',
	4: 'the material table is full',
	7: 'the mesh has more than 65536 vertices, or indices past its vertices',
	8: "the frame's uploads do not fit the room the renderer set aside for them",
};
const UNKNOWN_MATERIAL = 5;
const UNKNOWN_MESH = 6;

/**
 * The error for the core's last failure. `call` names the API call, and `what` describes the
 * object it was about, such as '"Player"'.
 */
export function coreFailure(core: CoreErrors, call: string, what = 'an object'): EngineError {
	const code = core.lastErrorCode();
	const [a, b] = [core.lastErrorDetail(0), core.lastErrorDetail(1)];
	const error = (id: ErrorCode, detail: string) => new EngineError(id, detail);
	switch (code) {
		case 1101:
			return error(
				'E1101',
				`${call}() was called on ${what} (slot ${a}), which was destroyed in frame ${b}.`,
			);
		case 1102:
			return error('E1102', `${call}() failed: the ${RESOURCES[a] ?? 'store'} already holds ${b}.`);
		case 1103:
			return error('E1103', `${call}() got an object that is not from this engine.`);
		case 1104:
			return error(
				'E1104',
				`${call}() on ${what} (slot ${a}) would put it under its own descendant (slot ${b}).`,
			);
		case 1105:
			return error('E1105', `the engine core received command ${a}.`);
		case 1106:
			return error(
				'E1106',
				`${call}() on ${what} (slot ${a}) ran before the frame that creates it.`,
			);
		case 1107:
			return error('E1107', `the object in slot ${a} was created twice.`);
		case 1108:
			return error('E1108', `${call}() got ${a}, above the limit of ${b}.`);
		case 1403:
			return error('E1403', `${call}() ran before the engine core started.`);
		case 1501:
			if (a === UNKNOWN_MATERIAL || a === UNKNOWN_MESH)
				return error(
					'E1103',
					`${call}() got a ${a === UNKNOWN_MESH ? 'mesh' : 'material'} that is not from this engine.`,
				);
			return error(
				'E1501',
				`${call}() failed: ${RENDER_LIMITS[a] ?? 'a render limit was reached'}.`,
			);
		default: {
			const known = `E${code}` in ERRORS;
			return error(
				known ? (`E${code}` as ErrorCode) : 'E1105',
				`${call}() failed in the engine core with code ${code}.`,
			);
		}
	}
}
