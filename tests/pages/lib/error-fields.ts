// The parts of an error that a test page or a test sketch reports: its code, message and name.

/** An error's code, message and name, as plain data that a page result can carry. */
export function errorFields(e: unknown): { code: string; message: string; name: string } {
	const error = e as Error & { code?: string };
	return { code: error.code ?? 'none', message: error.message, name: error.name };
}
