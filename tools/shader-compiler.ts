// Builds one or more shader manifests with the shader compiler, the WebAssembly module that build
// tools load, and prints the results as JSON. The request comes on standard input: either one
// manifest, as `{ "manifest": ..., "files": { "<path>": ... } }`, or a list of them. A list is
// answered with one result to a line, in order, and the compiler instance builds every manifest,
// so the library modules it composed for the first one serve the rest. The shader crate's build
// tests run this to check that the module gives the native build's results:
//   bun tools/shader-compiler.ts < request.json
//
// The module's answer goes to standard output as it stands, without being read into objects and
// written out again. The engine's own manifest answers with more than a gigabyte, and the round
// trip through `buildShaders` would hold several copies of that at once for no gain: the caller
// reads JSON either way, and this leaves the module's own pieces as the only copy. A list's
// results are written one at a time for the same reason: a caller that compared them together
// would hold every entry's answer at once.
import { CompilerCalls } from '../packages/vite-plugin/src/compiler-calls.js';
import { compilerModule } from '../packages/vite-plugin/src/shader-compiler';

const request = await Bun.stdin.text();
const parsed: unknown = JSON.parse(request);
const call = new CompilerCalls(compilerModule());
if (!Array.isArray(parsed)) {
	process.stdout.write(call.call('build', request));
} else {
	for (const manifest of parsed) {
		const result = call.call('build', JSON.stringify(manifest));
		// Awaiting the write keeps a page-sized answer from piling up in the stream's buffer.
		await Bun.write(Bun.stdout, `${result}\n`);
	}
}
