// Each error code's fix: the text that ends every EngineError message, and the only part of the
// error table that runtime code needs. The page imports this table and hands it to each worker it
// starts, so the text downloads once, with the page. The rest of each code's docs text is in
// codes.ts, which only the docs generator and the tests import. Codes group by area: 11xx objects
// and handles, 12xx values, 13xx browsers and GPUs, 14xx setup and loading, 15xx rendering.

/** The fix for every render graph error: only the engine declares render passes. */
const RENDER_GRAPH_FIX =
	'The engine declares every render pass itself, so this is an engine bug. Report it with the message, the browser and the quality preset.';

export const ERROR_FIXES = {
	E1101:
		'Stop using an object after you call destroy() on it. Look for places that still keep a reference, such as arrays of enemies or selection state.',
	E1102:
		'Use scene.createInstances() for many copies of one mesh: a batch is one object however many rows it has. Destroy objects you no longer need.',
	E1103:
		'Pass objects created by this engine. Each engine has its own scene, and objects do not move between engines.',
	E1104:
		'Choose a parent outside the subtree of the object. To swap two objects in a hierarchy, move one of them to the root first.',
	E1105:
		'Reinstall the engine package so all of its parts come from one version. If you build the engine from source, run bun run build again.',
	E1106:
		'Read world positions and matrices from the next frame on, for example in the next onUpdate call.',
	E1107: 'This is an engine bug. Report it with the code that created the object.',
	E1108:
		'Keep counts and indices within the capacity you created the batch with, or create a larger batch.',
	E1109:
		'Use fewer instance rows. Size each batch for the rows it uses, and give a batch colors only when it needs them. Destroy the batches you no longer draw.',
	E1203:
		'Check the value computed before this call. NaN often comes from dividing zero by zero, or from normalizing a zero-length vector.',
	E1204:
		"Pass a hex string such as '#4a8cff', a number such as 0x4a8cff, or three sRGB components from 0 to 1, such as [0.29, 0.55, 1].",
	E1205:
		"Use a KeyboardEvent.code name such as 'KeyW' or 'ArrowLeft', or a mouse button from 'Mouse0' to 'Mouse4'. Gamepad names start with 'Gamepad', such as 'GamepadA' or 'GamepadLeftStickUp'. Define an action with input.actions.define() before you use it, and give it a name that no key or button has.",
	E1301:
		'Remove a ?gpu= switch or createEngine gpu option that forces a path this browser lacks. Update the browser, or turn on hardware acceleration in its settings.',
	E1302:
		'Listen with engine.onFailure. Destroy the engine, put a new canvas element in place of the old one, and start the engine again on it. If losses keep coming, lower the quality preset.',
	E1303:
		'Update the browser. Chrome 91, Firefox 89, Safari 16.4 and later versions run the engine.',
	E1401:
		'End the sketch module with export default defineSketch(...), and pass that module to createEngine.',
	E1402:
		'Reinstall the engine package so all of its parts come from one version. If you build the engine from source, run bun run build again.',
	E1403:
		'Create objects in the setup function you pass to defineSketch, or later, never when the sketch module loads.',
	E1404:
		'This is an engine bug. Report it with the message and the browser, then destroy the engine and start it again.',
	E1405:
		'Read the message for the thread and its cause. Check that the page is served with the isolation headers and that the engine files load, then report it if it repeats.',
	E1406:
		"Check that the host serves the files from the engine's dist/wasm folder at the paths that the build gave them. If the page loads at other times, the network dropped: reload the page.",
	E1407:
		'Give the sketch time to hold at in seconds, such as ?hold=1.5 or hold: 1.5. A bare ?hold holds at the time of the hold option, or at 0 without one.',
	E1408:
		'Fix the error that the message quotes. When the message gives a sketch time, the sketch failed at that time, and the console shows the error with its stack.',
	E1501:
		'Share meshes and materials between objects instead of creating them per object. Draw many copies of one mesh with an instance batch. Every row of a batch counts toward the culling limit, active or not, so size each batch for the rows it uses.',
	E1502: RENDER_GRAPH_FIX,
	E1503: RENDER_GRAPH_FIX,
	E1504: RENDER_GRAPH_FIX,
	E1505: RENDER_GRAPH_FIX,
} satisfies Record<string, string>;

/**
 * The code of an engine error. Each code has a docs page that gives its cause and its fix.
 *
 * @category api/engine
 */
export type ErrorCode = keyof typeof ERROR_FIXES;

/** Each code's fix, as a thread holds the table. */
export type ErrorFixes = Readonly<Record<ErrorCode, string>>;
