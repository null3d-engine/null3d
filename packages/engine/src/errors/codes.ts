// The engine's error table for the docs: each code's title, cause, example and first version, joined
// with its fix from fixes.ts. tools/gen-docs.ts writes each code's docs page from it (docs/errors/).
// The engine's runtime code never imports this file, because that would bundle the docs text of
// every code into the engine's JavaScript: it imports the fixes alone. The render graph's codes
// (15xx from 1502) are `GraphError` in crates/null3d-render/src/graph/error.rs, and a Rust test
// keeps their examples equal to the messages the graph prints.

import { ERROR_FIXES, type ErrorCode } from './fixes';

export interface ErrorEntry {
	/** A short name for the error. */
	title: string;
	/** What went wrong, in one or two sentences. */
	cause: string;
	/** How to fix it. */
	fix: string;
	/** A message as the engine prints it. */
	example: string;
	/** The first engine version with this error. */
	since: string;
}

/** Each code's docs text besides its fix. */
const DOCS = {
	E1101: {
		title: 'Stale handle',
		cause: 'A call used an object after it was destroyed. Its slot may already hold a new object.',
		example:
			'E1101: setPosition() was called on "Crate" (slot 7), which was destroyed in frame 120.',
		since: '0.1',
	},
	E1102: {
		title: 'Too many objects',
		cause:
			'The scene, the table of instance batches or the queue of changes for the next frame is full. The message names which one, and how many it holds.',
		example: 'E1102: createMesh() failed: the scene already holds 16383 objects.',
		since: '0.1',
	},
	E1103: {
		title: 'Object from another engine',
		cause: 'A call received an object that this engine did not create.',
		example: 'E1103: createInstances() got a mesh that is not from this engine.',
		since: '0.1',
	},
	E1104: {
		title: 'Parent loop',
		cause:
			'A call would make an object its own ancestor: the new parent is the object itself or one of its descendants.',
		example:
			'E1104: a queued change on an object (slot 9) would put it under its own descendant (slot 12).',
		since: '0.1',
	},
	E1105: {
		title: 'Unknown command',
		cause:
			'The engine core received a structural change it does not know, so the TypeScript side and the core come from different builds.',
		example: 'E1105: the engine core received command 42.',
		since: '0.1',
	},
	E1106: {
		title: 'Object never created',
		cause:
			'A call such as `setVisible` or `setParent` queued a change for an object that the engine never created. The engine creates an object when the next frame starts. When that fails, for example because its parent was destroyed, the object never joins the scene.',
		example: 'E1106: a queued change named an object (slot 7), which the engine never created.',
		since: '0.1',
	},
	E1107: {
		title: 'Object created twice',
		cause:
			'The engine core received a second create command for one object, so the TypeScript side and the core disagree about the scene.',
		example: 'E1107: the object in slot 7 was created twice.',
		since: '0.1',
	},
	E1108: {
		title: 'Value out of range',
		cause:
			"A call received a number outside the range it takes. Examples are a row past the capacity of an instance batch, an opacity above 1, a negative radius, and a camera's far plane that does not lie beyond its near plane.",
		example: 'E1108: setActiveCount() got 1200, above the limit of 1000.',
		since: '0.1',
	},
	E1109: {
		title: 'Engine memory full',
		cause:
			"The engine could not create or grow its WebAssembly memory. A page with worker threads gives the engine 1 GiB by default, and up to 4 GiB through the memory option of createEngine. Each instance row takes about 180 bytes, or about 230 with per-row colors. So about 5 million rows fill 1 GiB, along with the rest of the scene. A browser can refuse memory sooner, as phones often do. It can also refuse a new engine's memory while the memory of an engine that stopped a moment before is not free yet. The engine then tries again for about 3 seconds before it fails.",
		example: 'E1109: createInstances() failed: the engine could not get 1282 MB more memory.',
		since: '0.1',
	},
	E1110: {
		title: 'Unmarked write to a static object',
		cause:
			"A static object's position, rotation, scale or bounding sphere changed without a setter. The engine recomputes a static object only in a frame where a setter marks it or its parent moves. So such a change can show late, or never. Development builds check these values of every static object before each transform update. Each frame has one transform update, and a sketch with onLateUpdate gets a second one after that callback. Release builds leave the check out.",
		example: 'E1110: the position of "Crate" (slot 7) changed without a setter.',
		since: '0.1',
	},
	E1203: {
		title: 'Invalid number',
		cause: 'A call received a number that is not finite, such as NaN or Infinity.',
		example:
			'E1203: setPosition() got NaN for x on "Player" (slot 12). Check the value computed before this call.',
		since: '0.1',
	},
	E1204: {
		title: 'Invalid color',
		cause:
			'A call received a color that is not a hex string, a number from 0 to 0xffffff, or three numbers from 0 to 1.',
		example: 'E1204: setBackground() got the color "blue-ish".',
		since: '0.1',
	},
	E1205: {
		title: 'Unknown input name',
		cause:
			'An input call received a name that no key, button or action has, or `input.actions.define()` received an action name that a key or button already has. Names are case-sensitive: `KeyW` is the W key, and `keyW` names nothing.',
		example: 'E1205: isDown() got "keyW", which names no key, button or action.',
		since: '0.1',
	},
	E1206: {
		title: 'Invalid mesh arrays',
		cause:
			'geometry.fromArrays() received arrays that make no mesh. An array can have the wrong length for the vertex count, an index can name no vertex, or a value can be NaN or Infinity. Normals can also be missing, or both given and computed.',
		example: 'E1206: geometry.fromArrays() got 9 numbers in normals for 4 vertices, not 12.',
		since: '0.1',
	},
	E1207: {
		title: 'Invalid layer mask',
		cause:
			'A call that sets layers received a number that is not a 32-bit layer mask: a fraction, NaN, or a number past 32 bits.',
		example: 'E1207: setLayers() got 2.5 on "Player" (slot 12), which is not a 32-bit layer mask.',
		since: '0.1',
	},
	E1208: {
		title: 'Invalid texture',
		cause:
			"A call that makes or updates a texture received something it cannot use. It can be an option the engine does not know, or an image without pixels or larger than the device takes. It can also be data that does not fit the texture's size and format. With a KTX2 file, it can be an option that the file cannot take, or an update of its texture.",
		example:
			'E1208: textures.fromData() got 12 numbers for 2 x 2 x 1 texels, not 16: give four per texel.',
		since: '0.1',
	},
	E1213: {
		title: 'Invalid setting',
		cause:
			'A call received a setting that it does not have, or a value that the setting does not take. Examples are a tone mapping that the engine does not know, and a negative exposure.',
		example: `E1213: post.set() got the tone mapping "filmic", which is not 'aces', 'agx', 'neutral' or 'none'.`,
		since: '0.1',
	},
	E1214: {
		title: 'Invalid sketch option',
		cause:
			'defineSketch() received an option out of its range. fixedRate must be a number above 0, and maxFixedSteps a whole number of 1 or more. The engine checks the options before it runs the setup function.',
		example: 'E1214: defineSketch() got 0 for fixedRate.',
		since: '0.1',
	},
	E1217: {
		title: 'Invalid material option',
		cause:
			'A material factory received a value that one of its options does not take, such as an alpha mode that the engine does not know.',
		example: `E1217: materials.standard() got the alpha mode "cutout"; it takes 'opaque' or 'mask'.`,
		since: '0.1',
	},
	E1301: {
		title: 'No usable GPU path',
		cause: 'The browser offers neither WebGPU nor WebGL2 for the way the engine was asked to draw.',
		example: 'E1301: no usable GPU path for ?gpu=webgpu in this browser.',
		since: '0.1',
	},
	E1302: {
		title: 'GPU lost',
		cause:
			'The browser took the GPU away while the engine drew, for example after a driver reset or a GPU crash, and the engine could not carry on. No new GPU device started, or the GPU was lost more than twice within a minute. The engine stopped drawing.',
		example: 'E1302: the render worker lost its GPU: the GPU device was lost.',
		since: '0.1',
	},
	E1303: {
		title: 'WebAssembly SIMD missing',
		cause: "The browser runs WebAssembly without SIMD, which the engine's core needs.",
		example: 'E1303: this browser runs WebAssembly without SIMD.',
		since: '0.1',
	},
	E1401: {
		title: 'Not a sketch module',
		cause:
			'The module passed to createEngine as the sketch does not export a sketch as its default export.',
		example: 'E1401: /sketch.ts must export default defineSketch(...).',
		since: '0.1',
	},
	E1402: {
		title: 'Engine core out of date',
		cause:
			'The engine core WebAssembly file lacks functions that the TypeScript side calls, so the two come from different builds. Development builds check this when the core loads.',
		example: 'E1402: the threaded engine core lacks isThreadedBuild.',
		since: '0.1',
	},
	E1403: {
		title: 'Engine core not ready',
		cause:
			'An engine call ran before the engine core started in this worker, or the core started twice.',
		example: 'E1403: createMesh() ran before the engine core started.',
		since: '0.1',
	},
	E1404: {
		title: 'Engine thread failed',
		cause:
			'An engine thread hit an error it could not handle after the engine started, so the engine may have stopped.',
		example: 'E1404: the render worker failed: out of memory.',
		since: '0.1',
	},
	E1405: {
		title: 'Engine thread did not start',
		cause:
			"An engine worker failed while the engine started. The worker's script, the engine core or the renderer did not start there, or the sketch's setup function threw an error without an engine code.",
		example: 'E1405: the render worker did not start: no WebGPU adapter.',
		since: '0.1',
	},
	E1406: {
		title: 'Engine file not downloaded',
		cause:
			'A file of the engine core, or of the KTX2 transcoder that the first KTX2 file loads, did not download whole. The server answered with an error, or the connection broke off.',
		example: 'E1406: /assets/null3d_memory-3f9c1a2b.json did not download: HTTP 404.',
		since: '0.1',
	},
	E1407: {
		title: 'Invalid hold time',
		cause:
			'The ?hold= switch or the hold option of createEngine gave a hold time that is not a number of seconds from 0 to 600.',
		example: 'E1407: ?hold=1500ms is not a number of seconds from 0 to 600.',
		since: '0.1',
	},
	E1408: {
		title: 'Hold failed',
		cause:
			'The sketch or the engine failed in hold mode, before the engine read the held frame back. A live engine logs an error in the sketch and carries on. Hold mode stops at the first one, so a test fails at once.',
		example:
			'E1408: hold mode stopped at 0.75 seconds, in frame 46: TypeError: player is undefined.',
		since: '0.1',
	},
	E1409: {
		title: 'Invalid memory maximum',
		cause:
			'The memory option of createEngine asked for a maximum that is not a whole number of MiB from 256 to 4096.',
		example:
			'E1409: the memory.maximumMiB option 8192 is not a whole number of MiB from 256 to 4096.',
		since: '0.1',
	},
	E1410: {
		title: 'Sketch module not loaded',
		cause:
			'The sketch module that createEngine got did not load. It did not download, or its code threw an error while the module loaded.',
		example:
			'E1410: the sketch module https://example.com/assets/sketch-3f9c1a2b.js did not load: Failed to fetch dynamically imported module: https://example.com/assets/sketch-3f9c1a2b.js.',
		since: '0.1',
	},
	E1411: {
		title: 'Asset not downloaded',
		cause:
			'A loading call could not download its file. The server answered with an error, such as 404 for a missing file, or the network failed.',
		example:
			'E1411: assets.loadTexture() could not download https://example.com/tex/brick.png: HTTP 404.',
		since: '0.1',
	},
	E1412: {
		title: 'Asset not decoded',
		cause:
			'A loading call downloaded its file but could not read it. The browser could not decode the image, as with a format it does not support. Or the file was a KTX2 file that the engine does not load, or not valid JSON.',
		example:
			'E1412: assets.loadTexture() could not decode https://example.com/tex/brick.tga as an image: The source image could not be decoded.',
		since: '0.1',
	},
	E1413: {
		title: 'Asset from another origin blocked',
		cause:
			"A loading call could not read a file from another origin. The browser reads such a file only when its server allows the page's origin with an Access-Control-Allow-Origin header. The browser gives no reason, so the server may also have been unreachable.",
		example:
			'E1413: assets.loadTexture() could not read https://cdn.example.com/brick.png: its server did not allow this page to read it, or could not be reached (Failed to fetch).',
		since: '0.1',
	},
	E1414: {
		title: 'Frame not captured',
		cause:
			'engine.capture() could not give an image of a frame. The engine had stopped, or the thread that draws could not read the frame back from the GPU or encode it.',
		example: 'E1414: engine.capture() failed: the engine has stopped.',
		since: '0.1',
	},
	E1415: {
		title: 'Page thread already runs a sketch',
		cause:
			"createEngine() was asked to run a sketch on the page's thread while another engine still runs its sketch there. The page's copy of the engine core serves one engine at a time. This happens with sketchThread: 'main', and in the single-threaded build, which runs every sketch on the page's thread.",
		example:
			'E1415: createEngine() found another engine that runs its sketch on this page, which has not stopped.',
		since: '0.1',
	},
	E1501: {
		title: 'Render space full',
		cause:
			'The scene needs more room than the renderer set aside. The full part is the draw list, the material table, the upload space or the culling pass. On WebGPU the culling pass covers 2,097,152 objects and instance rows on every device, and more on devices with larger GPU buffers. On WebGL2 the number follows the largest texture the device allows. The number for the device is in engine.capabilities.maxInstances.',
		example: 'E1501: materials.standard() failed: the material table is full.',
		since: '0.1',
	},
	E1502: {
		title: 'Pass input missing',
		cause:
			'A render pass uses a target or buffer that no pass creates, or reads one that no pass running in the frame writes. The render graph checks every pass before the frame draws.',
		example:
			'E1502: the pass "Final" reads "sceneColor", but no pass that runs this frame writes it.',
		since: '0.1',
	},
	E1503: {
		title: 'Target created twice',
		cause:
			'Two render passes create the same target, or a pass creates a target that the render graph keeps between frames. Each target has one creator, which sets its format and size.',
		example: 'E1503: both "Opaque" and "Sky" create "sceneColor".',
		since: '0.1',
	},
	E1504: {
		title: 'Render pass cycle',
		cause:
			'Render passes need each other in a loop, so no order runs each pass after the passes whose output it reads.',
		example: 'E1504: the passes form a cycle: "Tint" runs after "Glow", and "Glow" after "Tint".',
		since: '0.1',
	},
	E1505: {
		title: 'Pass targets do not match',
		cause:
			"A render pass draws into targets that one GPU render pass cannot hold together. A target can have another size than the pass, or the targets can have different sample counts. The pass can also draw into two depth targets, into a whole texture array instead of one layer, or into no target. A resolve pass fails the same way when it cannot resolve its target into the canvas. That target must be multisampled, in the canvas's format and size, and read by no other running pass.",
		example: 'E1505: the pass "Blur" draws at half size into "sceneColor", which is full size.',
		since: '0.1',
	},
} satisfies Record<ErrorCode, Omit<ErrorEntry, 'fix'>>;

/** Every code's docs text with its fix, in code order. */
export const ERRORS = Object.fromEntries(
	Object.entries(DOCS).map(([code, docs]) => [
		code,
		{ ...docs, fix: ERROR_FIXES[code as ErrorCode] },
	]),
) as Record<ErrorCode, ErrorEntry>;
