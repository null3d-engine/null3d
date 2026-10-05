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
		'Use fewer instance rows. Size each batch for the rows it uses, and give a batch colors only when it needs them. Split a mesh of millions of vertices into smaller meshes, or simplify it. Destroy the batches you no longer draw. A scene that needs more memory can ask for a larger maximum with the memory option of createEngine. When a new engine fails to start this way, destroy the engines you no longer use, or keep one engine and detach and attach it. A smaller maximum leaves room for more engines.',
	E1110:
		'Change a static object with setPosition(), setRotation(), setScale() or another setter: each one marks the object for the engine to update. Code that writes values straight into engine memory needs a dynamic object, which the engine updates in every frame. If your code writes no engine memory, this is an engine bug: report it with the message.',
	E1203:
		'Check the value computed before this call. NaN often comes from dividing zero by zero, or from normalizing a zero-length vector.',
	E1204:
		"Pass a hex string such as '#4a8cff', a number such as 0x4a8cff, or three linear components from 0 to 1, such as [0.07, 0.26, 1].",
	E1205:
		"Use a KeyboardEvent.code name such as 'KeyW' or 'ArrowLeft', or a mouse button from 'Mouse0' to 'Mouse4'. Gamepad names start with 'Gamepad', such as 'GamepadA' or 'GamepadLeftStickUp'. Define an action with input.actions.define() before you use it, and give it a name that no key or button has. Objects take the pointer events 'click', 'pointerdown', 'pointerup', 'pointermove', 'pointerenter' and 'pointerleave'.",
	E1206:
		'Give positions and normals three numbers per vertex, uvs and uvs1 two, colors three or four, and tangents four. Give three indices per triangle, each below the vertex count. Without indices, use a vertex count that is a multiple of three. Pass normals or computeNormals: true, and pass uvs with computeTangents: true. Replace NaN and Infinity values.',
	E1207:
		'Pass a whole number whose bits name the layers: 1 << n is layer n. The operator | joins layers, so (1 << 0) | (1 << 3) is layers 0 and 3. Layers run from 0 to 31.',
	E1208:
		"Give options from the texture's docs page, such as wrap: 'repeat', filter: 'nearest' or anisotropy: 8. Give fromData four numbers per texel: a Uint8Array for rgba8unorm, and a Uint16Array of half floats or a Float32Array for rgba16float. Resize images larger than textures.maxSize, and decode a closed image again. Encode a KTX2 file flipped instead of passing flipY: true, and load it again instead of updating its texture.",
	E1213:
		"Pass only the settings that the call has, each with a value that it takes. The call's docs page lists them.",
	E1214:
		'Give fixedRate the fixed steps per second, a number above 0 such as 60 or 120. Give maxFixedSteps a whole number of 1 or more, such as 8.',
	E1215:
		'Add the null3D Vite plugin to vite.config.ts. Write the WGSL in a template literal right after a /* wgsl */ comment, or import it from a .wgsl file. Declare fn surface(input: SurfaceInput) -> Surface in it, with no @vertex or @fragment entry point. For a full shader, give the @vertex entry point an InstanceIn from null3d::mesh.',
	E1216:
		'Use the names of the fields of struct Uniforms in the WGSL. Give an f32 a number, and an i32 or a u32 a whole number. Give a vec2f, vec3f or vec4f an array of 2, 3 or 4 numbers. A vec3f also takes a color. Rename a field that has the name of a standard value, such as color.',
	E1217:
		"Give alphaMode 'opaque', 'mask' or 'blend', and blending 'normal', 'additive' or 'multiply'. three.js's transparent: true is alphaMode: 'blend', and its alphaTest is alphaMode: 'mask' with alphaCutoff.",
	E1218:
		"Use the names in animator.clips, and the joint names of the model's skeleton. Give layers whole numbers from 0 to 3, weights from 0 to 1, and fades of 0 or more seconds. Call animator() only on an object that a glTF file with animations created. Name your clip events anything but 'loop' and 'finished', which the animator reports itself. Give setMorphWeight a target number below its geometry's morphTargets, or a name in its morphTargetNames. Trim a clip that holds keys hours apart, or split a long clip into shorter ones.",
	E1219:
		"Give each label an id of its own, such as 'hp-12', and pass the same id to engine.labels.bind on the page. Untrack labels that you no longer show with ui.untrackLabel. To track more labels at once, raise createEngine's maxLabels option.",
	E1301:
		'Remove a ?gpu= switch or createEngine gpu option that forces a path this browser lacks. Update the browser, or turn on hardware acceleration in its settings.',
	E1302:
		'Listen with engine.onFailure. Destroy the engine, put a new canvas element in place of the old one, and start the engine again on it. If losses keep coming, lower the quality preset.',
	E1303:
		'Update the browser. Chrome 91, Firefox 89, Safari 16.4 and later versions run the engine.',
	E1304:
		'Lower the quality preset, use smaller or compressed textures, and share meshes and textures between objects. Destroy objects and textures that the scene no longer shows.',
	E1305:
		"Read the message: it quotes the GPU path. A buffer or texture past the device's limits names the limit: make the scene smaller there. Otherwise this is an engine bug: report it with the message and the browser.",
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
		"Check that the host serves every file that the build wrote, at the paths that the build gave them. The engine's .wasm files, the KTX2 transcoder's files, the glTF loader's files and the meshopt decoder are among them. If the page loads at other times, the network dropped: reload the page.",
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
		'Give loadTexture and loadImageBitmap a PNG, JPEG or WebP file, or an AVIF file in browsers that decode AVIF. Give loadTexture KTX2 files of 2D ETC1S or UASTC data, as basisu writes them. Give loadJson valid JSON. Check that the server sends the file itself, not an error page. Save KTX2 textures no larger than textures.maxSize on each side.',
	E1413:
		"Serve the file from the same origin as the page, or have its server send Access-Control-Allow-Origin with the page's origin or *. On a page with Cross-Origin-Embedder-Policy: require-corp, the file needs that header too.",
	E1414:
		'Call engine.capture() while the engine runs, before destroy(). When the message names a GPU failure, wait for the engine to recover from it and call capture() again.',
	E1415:
		"Stop the other engine with destroy() and wait for its promise before you start this one. To run both at once, leave out sketchThread: 'main' on one of them, so that its sketch runs in a worker.",
	E1416:
		'Check that the file is a glTF 2.0 model, as a .glb file or a .gltf file with its buffers and images beside it. Open it in the Khronos glTF Validator, which names the broken part, and export it again from your modelling tool. For a model whose skeleton is too large, export each character to a file of its own. A file that passes a limit on what it decodes to is broken, or holds more than a scene can use. Split it into several files, or simplify its meshes.',
	E1417:
		'Export the model again without the extension that the message names. Call createInstances with a model that has meshes and no instancing of its own, or with one of its meshes and a material.',
	E1419:
		"Wait for the other engine's destroy() promise before you start a new engine on its canvas. In React, call destroy() in the effect's cleanup. When the message says the canvas's drawing thread failed, put a new canvas element in its place.",
	E1420:
		"Remove the sketch's timers, event listeners and message handlers in its onDestroy callback, which runs when the engine stops.",
	E1501:
		'Share meshes and materials between objects instead of creating them per object. Draw many copies of one mesh with an instance batch. Every row of a batch counts toward the culling limit, active or not, so size each batch for the rows it uses. For a large crowd of skinned characters on WebGPU, use models with fewer vertices or fewer copies. Each copy skins its own vertices, even when copies share a mesh. The crowd draws again once it fits.',
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
