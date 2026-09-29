// The parts of an error that a test page or a test sketch reports: its code, message and name, and
// whether it is an EngineError to the code that caught it.
import { EngineError } from '@null3d/engine';

/** An error's code, message and name, and its EngineError check, as data a page result can carry. */
export interface ErrorFields {
	code: string;
	message: string;
	name: string;
	engineError: boolean;
}

/** The fields of an error that the code caught. */
export function errorFields(e: unknown): ErrorFields {
	const error = e as Error & { code?: string };
	return {
		code: error.code ?? 'none',
		message: error.message,
		name: error.name,
		engineError: e instanceof EngineError,
	};
}

/** The fields that stand for an error that did not come, with a note of what happened instead. */
export function noError(note: string): ErrorFields {
	return { code: 'none', message: note, name: '', engineError: false };
}
