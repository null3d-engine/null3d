// Test support for unread-extensions.test.ts, which runs it as a development build and as a
// release build. It hands the loader's warning the extensions of a file that nothing reads: one
// that a foundation add-on reads, and one that nothing does.

import { warnUnreadExtensions } from './gltf';
import type { GltfData } from './gltf-parse';

/** What the warning printed, one string for each note. */
export interface UnreadResult {
	notes: string[];
}

/** The extensions of a file that the loader and no registered add-on reads. */
const DATA = {
	unread: [
		{ name: 'KHR_materials_variants' },
		{ name: 'KHR_gaussian_splatting', addon: '@null3d/splats' },
	],
} as unknown as GltfData;

/** Runs the warning for that file and returns what it printed. */
export function unreadNotes(): UnreadResult {
	const notes: string[] = [];
	const warn = console.warn;
	console.warn = (...values: unknown[]) => {
		notes.push(values.map(String).join(' '));
	};
	try {
		warnUnreadExtensions(DATA, new URL('https://example.com/models/ship.glb'), 'assets.loadGltf');
	} finally {
		console.warn = warn;
	}
	return { notes };
}
