// Each error code's fix: the text that ends every EngineError message, and the only part of the
// error table that runtime code needs. The page imports this table and hands it to each worker it
// starts, so the text downloads once, with the page. The rest of each code's docs text is in
// codes.ts, which only the docs generator and the tests import. Codes group by area: 11xx objects
// and handles, 12xx values, 13xx browsers and GPUs, 14xx setup and loading, 15xx rendering.

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
		'Change a static object with setPosition(), setRotation(), setScale() or another setter: each one marks the object for the engine to update. Code that writes values straight into engine memory needs a dynamic object, which the engine updates in every frame. For a row of a static batch, call markDirty(start, count) on the batch after you write its arrays, or create the batch with dynamic: true. If your code writes no engine memory, this is an engine bug: report it with the message.',
	E1111:
		'Destroy the objects and instance batches that use the mesh or model first, with destroy() on each. Then destroy the mesh or model, in the same frame or later. Destroying the group that scene.instantiate() returned takes the whole copy of a model. To keep an object and drop its mesh, give it another mesh with setMesh() first.',
	E1203:
		'Check the value computed before this call. NaN often comes from dividing zero by zero, or from normalizing a zero-length vector.',
	E1204:
		"Pass a hex string such as '#4a8cff', a number such as 0x4a8cff, or three linear components from 0 to 1, such as [0.07, 0.26, 1].",
	E1205:
		"Use a KeyboardEvent.code name such as 'KeyW' or 'ArrowLeft', or a mouse button from 'Mouse0' to 'Mouse4'. Gamepad names start with 'Gamepad', such as 'GamepadA' or 'GamepadLeftStickUp'. Define an action with input.actions.define() before you use it, and give it a name that no key or button has. Objects take the pointer events 'click', 'pointerdown', 'pointerup', 'pointermove', 'pointerenter' and 'pointerleave'.",
	E1206:
		'Give positions and normals three numbers per vertex, uvs and uvs1 two, colors three or four, and tangents four. Give three indices per triangle, each below the vertex count. Without indices, use a vertex count that is a multiple of three. Pass normals or computeNormals: true, and pass uvs with computeTangents: true. Replace NaN and Infinity values. Give mesh.updateVertices() the values of every vertex in the array type the mesh was made with, for an attribute the mesh has, and a range within its vertices. A mesh with joints or morph targets takes no updates.',
	E1207:
		'Pass a whole number whose bits name the layers: 1 << n is layer n. The operator | joins layers, so (1 << 0) | (1 << 3) is layers 0 and 3. Layers run from 0 to 31.',
	E1208:
		"Give options from the texture's docs page, such as wrap: 'repeat', filter: 'nearest' or anisotropy: 8. Give fromDatafour numbers per texel: a Uint8Array for rgba8unorm, and a Uint16Array of half floats or a Float32Array for rgba16float. Resize images larger than textures.maxSize, and decode a closed image again. Encode a KTX2 file flipped instead of passing flipY: true, and load it again instead of updating its texture.",
	E1209:
		"Give the material fewer textures. WebGL2 gives each shader stage at least 16 texture units, as many as the device reports, and the engine's lit shader reads most of them, so a custom material's own textures must fit in what is left. Use the standard material's own maps where they draw the effect.",
	E1213:
		"Pass only the settings that the call has, each with a value that it takes. The call's docs page lists them.",
	E1214:
		'Give fixedRate the fixed steps per second, a number above 0 such as 60 or 120. Give maxFixedSteps a whole number of 1 or more, such as 8.',
	E1215:
		'Add the null3D Vite plugin to vite.config.ts. Write the WGSL in a template literal right after a /* wgsl */ comment, or import it from a .wgsl file. Declare fn surface(input: SurfaceInput) -> Surface, fn vertexOffset(input: VertexInput) -> vec3f or fn lobe(input: LobeInput) -> vec3f in it, with no @vertex or @fragment entry point. For a full shader, give the @vertex entry point an InstanceIn from null3d::mesh. For a draw that makes its own vertices, give it @builtin(vertex_index) and @builtin(instance_index) and no mesh attribute. Give post.addEffect() WGSL that declares fn effect(input: EffectInput) -> vec4f, post.set({ toneMapping }) WGSL that declares fn toneCurve(color: vec3f) -> vec3f, and scene.setSkyLayer() WGSL that declares fn skyLayer(input: SkyLayerInput) -> SkyLayer.',
	E1216:
		'Use the names of the fields of struct Uniforms in the WGSL. Give an f32 a number, and an i32 or a u32 a whole number. Give a vec2f, vec3f or vec4f an array of 2, 3 or 4 numbers. A vec3f also takes a color. Rename a field that has the name of a standard value, such as color. Give a slot that the WGSL declares as a texture_2d<f32> a texture of one layer, and a slot that it declares as a texture_2d_array<f32> a texture of several layers, from textures.fromData with a depth or a KTX2 file of layers. Give post.setEffectUniform() an effect that post.addEffect() returned.',
	E1217:
		"Give alphaMode 'opaque', 'mask', 'hash' or 'blend', and blending 'normal', 'additive', 'multiply' or 'weighted'. three.js's transparent: true is alphaMode: 'blend', and its alphaTest is alphaMode: 'mask' with alphaCutoff. A custom material takes 'opaque', 'mask' or 'blend', no alphaToCoverage, and no 'weighted' blending. A draw that makes its own vertices blends, and its WGSL declares no texture. A material with transmission takes 'opaque' or 'blend', not the 'weighted' blending, and a custom one needs WGSL that sets the surface's transmission. A layered material takes no lightMap or specular maps: give clearcoatMap with clearcoatRoughnessMap as one texture, and sheenColorMap with sheenRoughnessMap as one. Give diffuseTransmissionMap and diffuseTransmissionColorMap only with diffuseTransmission, and no specular maps beside them. Give transmissionMap and thicknessMap only with transmission, and no specular maps beside them either, since they take the same slots. A layered material keeps them beside the layer map of the light map's slot, but not beside a layer map of the slot that one of them takes: transmissionMap shares the specular intensity map's slot, and thicknessMap the specular color map's. Give diffuseTransmission without a clear coat, a sheen or the 'weighted' blending. A material's layer maps come from one family: the coat's and the sheen's, or iridescence's and the anisotropy's, since they take the same slots. A custom material with diffuseTransmission needs WGSL that sets the surface's diffuseTransmission. Give subsurfaceRadius to materials.standard: a custom material draws no subsurface blur.",
	E1218:
		"Use the names in animator.clips, and the joint names of the model's skeleton. Give layers whole numbers from 0 to 3, weights from 0 to 1, and fades of 0 or more seconds. Call animator() only on an object that a glTF file with animations created. Name your clip events anything but 'loop' and 'finished', which the animator reports itself. Give setMorphWeight a target number below its geometry's morphTargets, or a name in its morphTargetNames. Trim a clip that holds keys hours apart, or split a long clip into shorter ones.",
	E1219:
		"Give each label an id of its own, such as 'hp-12', and pass the same id to engine.labels.bind on the page. Give transform one of 'screen', 'world' or 'billboard', and a rotation only to a billboard label. Untrack labels that you no longer show with ui.untrackLabel. To track more labels at once, raise createEngine's maxLabels option, or maxLabels3d for labels that are planes of the scene.",
	E1220:
		"Give render.addPass the options of its kind, such as { kind: 'scene', camera, writes: 'minimap', size: [256, 256] }. Give a compute pass a workgroup size that the shader declares and that a device runs, and a fallback for WebGL2. Give each pass a name and a texture name of its own. Remove passes that no longer draw before you add more.",
	E1221:
		'List the levels from the most detailed down, each with a larger error or distance than the one before, at most 7 of them. Make each level from the same kind of arrays as the base mesh, with the same attributes, such as the same texture coordinates and tangents.',
	E1222:
		"Make the grid's texture with LightProbeGridData.toTexture(), which a 3D texture alone holds, or with textures.fromVolumeData(). An image texture, or one made with textures.fromData() and a depth, is a texture array, which the probe grid cannot bind.",
	E1223:
		"Give each feature and output a name of its own. Give a frame point and a kind that go together, such as 'opaque' with 'draw' or 'post' with 'fullscreen'. Keep an order inside its band. Name resources, lighting slots and views from the lists. Give every output a neutral default: 'black', 'white' or 'transparent', and 'black' or 'transparent' for a compute pass. One feature provides each lighting slot. Give each setting's presets a value that its values take, and a governor only with a budget. Give the budget four times in ms above 0. A sky layer's description records at the background point, as a draw, provides the sky, and draws in the main, scene-pass and reflection views.",
	E1224:
		'Give scene.overrideMaterial a material that draws meshes, from materials.standard(), materials.unlit(), materials.shader() or materials.decal(), or null to draw each mesh with its own material.',
	E1225:
		"Give each add-on a namespace of its own: one name at declareAddonNamespace(), claimed once where the add-on's module loads, with the package that owns it. Let its shader library default to that name, keep its error codes inside 2000 to 9999, and give its quality keys names that the engine's table lacks. Give each feature, output and lighting slot a name that no other add-on registers. Two add-ons that share a name cannot load together.",
	E1301:
		'Remove a ?gpu= switch or createEngine gpu option that forces a path this browser lacks. Update the browser, or turn on hardware acceleration in its settings.',
	E1302:
		'Listen with engine.onFailure. Destroy the engine, put a new canvas element in place of the old one, and start the engine again on it. If losses keep coming, lower the quality preset.',
	E1303:
		'Update the browser. Chrome and Edge 91, Firefox 89, Safari 18 and later versions run the engine.',
	E1304:
		'Lower the quality preset, use smaller or compressed textures, and share meshes and textures between objects. Destroy objects and textures that the scene no longer shows.',
	E1305:
		"Read the message: it quotes the GPU path. A buffer or texture past the device's limits names the limit: make the scene smaller there. Otherwise this is an engine bug: report it with the message and the browser.",
	E1306:
		'Update Safari to version 18 or later. On iPhone and iPad, update iOS or iPadOS to 18 or later, which updates the engine of every browser there.',
	E1401:
		'End the sketch module with export default defineSketch(...), and pass that module to createEngine.',
	E1402:
		'Reinstall the engine package so all of its parts come from one version. If you build the engine from source, run bun run build again.',
	E1403:
		'Create objects in the setup function you pass to defineSketch, or later, never when the sketch module loads.',
	E1404:
		'This is an engine bug. Report it with the message and the browser, then destroy the engine and start it again.',
	E1405:
		"Read the message: it names the worker that did not start, and why. The sketch worker also reports an error that your sketch's setup function threw, with that error's message: fix the setup function. Otherwise, check that the page is served with the isolation headers and that the engine files load. Allow the workers in the worker-src of a Content-Security-Policy. For the engine's files on another origin, such as a CDN, the hosting page of the docs gives the headers and the policy. Report the error if it repeats.",
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
		'Call engine.capture() while the engine runs, before destroy(). When the message names a GPU failure, wait for the engine to recover from it and call capture() again. When it says that the worker did not answer, the thread that draws is stuck, often inside a GPU call that never returned: reload the page, or start another engine on another canvas.',
	E1415:
		"Stop the other engine with destroy() and wait for its promise before you start this one. To run both at once, leave out sketchThread: 'main' on one of them, so that its sketch runs in a worker.",
	E1416:
		'Check that the file is a glTF 2.0 model, as a .glb file or a .gltf file with its buffers and images beside it. Open it in the Khronos glTF Validator, which names the broken part, and export it again from your modelling tool. For a model whose skeleton is too large, export each character to a file of its own. A file that passes a limit on what it decodes to is broken, or holds more than a scene can use. Split it into several files, or simplify its meshes.',
	E1417:
		'Export the model again without the extension that the message names, or import the add-on that the message names and register its handler on assets. Call createInstances with a model that has meshes and no instancing of its own, or with one of its meshes and a material.',
	E1418:
		"Add 'wasm-unsafe-eval' to the script-src of the page's Content-Security-Policy, for example script-src 'self' 'wasm-unsafe-eval'. It allows WebAssembly and no JavaScript eval. The hosting page of the docs gives the whole policy that the engine needs.",
	E1419:
		"Wait for the other engine's destroy() promise before you start a new engine on its canvas. In React, call destroy() in the effect's cleanup. When the message says that no engine can draw on the canvas again, put a new canvas element in its place.",
	E1420:
		"Remove the sketch's timers, event listeners and message handlers in its onDestroy callback, which runs when the engine stops.",
	E1421:
		'Name each feature as the message lists it. Leave a feature out to let its shaders download the first time the sketch uses it.',
	E1422:
		"Add what the message names to the page's Content-Security-Policy. Its worker-src needs blob: and the origin of the engine's files, and its script-src and connect-src need that origin. For example: worker-src 'self' blob: https://cdn.example.com; script-src 'self' https://cdn.example.com 'wasm-unsafe-eval'; connect-src 'self' https://cdn.example.com. Or serve the engine's files from the page's own origin.",
	E1423:
		"Have the server of the engine's files send Access-Control-Allow-Origin with the page's origin or *, on every file: the scripts, the workers and the .wasm files. If it does, check that the file exists at the address that the message names.",
	E1424:
		'Deploy every file that the build wrote, the material-*.js, effect-*.js and curve-*.js files among them, from one build, and serve them as JavaScript at the paths that the build gave them. A strict Content-Security-Policy must allow them in its script-src. On the dev server, reload the page. After a failure during play, destroy the engine and start a new one.',
	E1425:
		"Call engine.requestPointerLock() inside a click or key handler on the page, as browsers lock the pointer only right after the user acts. A page in an iframe needs allow-pointer-lock in the iframe's sandbox attribute. Browsers on phones have no pointer lock, so give touch screens other controls. Pressing Esc ends the lock, and Chrome then refuses a new lock for about a second.",
	E1430:
		"Destroy a probe that you no longer need before you make another, or let one probe's box cover more of the scene. Probes blend where their boxes overlap, so a few large boxes with a blend distance often look as good as many small ones. For the views, remove a scene pass or a reflection pass before you make the first probe.",
	E1431:
		"Serve the engine's area-light-tables.bin file at the address that the message names. A build with the null3D Vite plugin copies it beside the engine's code: deploy it with the rest of the build. When the engine's files come from another origin, that server must send Access-Control-Allow-Origin, and the page's connect-src must allow the origin.",
	E1432:
		"Run bunx @null3d/cli upgrade in the project's folder, then bun install, so that every null3D package takes one version. An add-on that the project builds itself names the engine version that the project develops against.",
	E1433:
		"Install the release of the add-on that matches this engine's plugin interface, or run the project on an engine whose plugin interface the add-on declares. The engine's own add-ons need no range: run bunx @null3d/cli upgrade, then bun install, so that each one takes the engine's version.",
	E1434:
		"Read the fault that the message names in the baked light file. Write version 1 of the format, which docs/guides/baked-light-data.md describes: a JSON object with the marker null3d.baked-light, the version, the kind, and the base64 payloads that its kind needs. Make each payload's length match the counts or the size that the same file gives. Read the file to its end, since a file cut short has no complete JSON.",
	E1435:
		"Record the session again with the engine that recorded it, or update the engine that reads the file. When the message names a sketch, open the page with that sketch: a replay runs the file's frames on the scene that recorded them. When it names a key or a fixed step rate, the recording came from a sketch that this engine cannot run as it ran. A replay starts at the file's first frame, so a file must come from a session that started at the page's first frame.",
	E1501:
		'Share meshes and materials between objects instead of creating them per object. Draw many copies of one mesh with an instance batch. Every row of a batch counts toward the culling limit, active or not, so size each batch for the rows it uses. For a large crowd of skinned characters on WebGPU, use models with fewer vertices or fewer copies. Each copy skins its own vertices, even when copies share a mesh. The crowd draws again once it fits.',
	E1502:
		"Name in reads only the textures that your other passes write, as their writes option spells them. Add the pass that writes a texture before a pass that reads it, and remove a pass that reads a texture before the pass that writes it. If the message names only the engine's own passes, report it with the message, the browser and the quality preset.",
	E1503:
		"Give each pass's texture a name that no other pass writes. The engine's own passes write sceneColor, sceneDepth, outlineMask and the other names that render.dumpGraph() shows, so pick another name.",
	E1504:
		'Break the loop: a pass cannot read its own texture. To show a mirror in a mirror, add a pass for the inner mirror first, and let the outer pass read its texture.',
	E1505:
		"Draw into targets of one size and one sample count in each pass, and into at most four color targets. If the message names only the engine's own passes, report it with the message, the browser and the quality preset.",
} satisfies Record<string, string>;

/**
 * The code of an engine error. Each code has a docs page that gives its cause and its fix.
 *
 * @category api/engine
 */
export type ErrorCode = keyof typeof ERROR_FIXES;

/** Each code's fix, as a thread holds the table. */
export type ErrorFixes = Readonly<Record<ErrorCode, string>>;
