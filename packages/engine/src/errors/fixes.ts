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
		'Draw many copies of one mesh with scene.createInstances(): a batch takes none of the places for objects, however many rows it has. Destroy the objects and batches that you no longer need, and spread a very large number of changes over several frames.',
	E1103:
		'Pass objects created by this engine. Each engine has its own scene, and objects do not move between engines.',
	E1104:
		'Choose a parent outside the subtree of the object. To swap two objects in a hierarchy, move one of them to the root first.',
	E1105:
		'Reinstall the engine package so all of its parts come from one version. If you build the engine from source, run bun run build again.',
	E1106:
		'Fix the call that created the object. When the frame applied that call, the engine logged why it failed, such as E1101 for a parent that was already destroyed.',
	E1107: 'This is an engine bug. Report it with the code that created the object.',
	E1108:
		'Pass a value inside the range that the message gives. For an instance batch, keep counts and indices within the capacity you created it with, or create a larger batch.',
	E1109:
		'Use fewer instance rows. Size each batch for the rows it uses, and give a batch colors only when it needs them. Destroy the batches you no longer draw. A scene that needs more memory can ask for a larger maximum with the memory option of createEngine. When a new engine fails to start this way, destroy the engines you no longer use, or keep one engine and detach and attach it. A smaller maximum leaves room for more engines.',
	E1110:
		'Change a static object with setPosition(), setRotation(), setScale() or another setter: each one marks the object for the engine to update. Code that writes values straight into engine memory needs a dynamic object, which the engine updates in every frame. If your code writes no engine memory, this is an engine bug: report it with the message.',
	E1203:
		'Check the value computed before this call. NaN often comes from dividing zero by zero, or from normalizing a zero-length vector.',
	E1204:
		"Pass a hex string such as '#4a8cff', a number such as 0x4a8cff, or three sRGB components from 0 to 1, such as [0.29, 0.55, 1].",
	E1205:
		"Use a KeyboardEvent.code name such as 'KeyW' or 'ArrowLeft', or a mouse button from 'Mouse0' to 'Mouse4'. Gamepad names start with 'Gamepad', such as 'GamepadA' or 'GamepadLeftStickUp'. Define an action with input.actions.define() before you use it, and give it a name that no key or button has.",
	E1206:
		'Give positions and normals three numbers per vertex, uvs and uvs1 two, colors three or four, and tangents four. Give three indices per triangle, each below the vertex count. Without indices, use a vertex count that is a multiple of three. Pass normals or computeNormals: true, and pass uvs with computeTangents: true. Replace NaN and Infinity values.',
	E1207:
		'Pass a whole number whose bits name the layers: 1 << n is layer n. The operator | joins layers, so (1 << 0) | (1 << 3) is layers 0 and 3. Layers run from 0 to 31.',
	E1208:
		"Give options from the texture's docs page, such as wrap: 'repeat', filter: 'nearest' or anisotropy: 8. Give fromData four numbers per texel: a Uint8Array for rgba8unorm, and a Uint16Array of half floats or a Float32Array for rgba16float. Resize images larger than textures.maxSize, and decode a closed image again.",
	E1213:
		"Pass only the settings that the call has, each with a value that it takes. The call's docs page lists them.",
	E1214:
		'Give fixedRate the fixed steps per second, a number above 0 such as 60 or 120. Give maxFixedSteps a whole number of 1 or more, such as 8.',
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
		"Read the message: it names the worker that did not start, and why. The sketch worker also reports an error that your sketch's setup function threw, with that error's message: fix the setup function. Otherwise, check that the page is served with the isolation headers and that the engine files load, then report the error if it repeats.",
	E1406:
		"Check that the host serves the files from the engine's dist/wasm folder at the paths that the build gave them. If the page loads at other times, the network dropped: reload the page.",
	E1407:
		'Give the sketch time to hold at in seconds, such as ?hold=1.5 or hold: 1.5. A bare ?hold holds at the time of the hold option, or at 0 without one.',
	E1408:
		'Fix the error that the message quotes. When the message gives a sketch time, the sketch failed at that time, and the console shows the error with its stack.',
	E1409:
		'Give memory.maximumMiB a whole number of MiB from 256 to 4096, such as 2048, or leave the option out for the default of 1024.',
	E1410:
		"Pass the sketch as new URL('./sketch.ts', import.meta.url), so that the bundler ships the module and the engine finds it. When the download worked, the module's own code threw the error that the message quotes while the module loaded: fix that error.",
	E1411:
		"Check the file's address: a relative address resolves against the page's address, and new URL('./file.png', import.meta.url) resolves against the sketch module's. Check that the server sends the file, and handle the error where the file is optional.",
	E1412:
		'Give loadTexture and loadImageBitmap a PNG, JPEG or WebP file, or an AVIF file in browsers that decode AVIF. Give loadJson valid JSON. Check that the server sends the file itself, not an error page.',
	E1413:
		"Serve the file from the same origin as the page, or have its server send Access-Control-Allow-Origin with the page's origin or *. On a page with Cross-Origin-Embedder-Policy: require-corp, the file needs that header too.",
	E1414:
		'Call engine.capture() while the engine runs, before destroy(). When the message names a GPU failure, wait for the engine to recover from it and call capture() again.',
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
