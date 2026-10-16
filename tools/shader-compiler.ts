// Builds a shader manifest with the shader compiler, the WebAssembly module that build tools
// load, and prints the result as JSON. The request comes on standard input: the manifest's text
// and every WGSL file, as `{ "manifest": ..., "files": { "<path>": ... } }`. The shader crate's
// build tests run this to check that the module gives the native build's results:
//   bun tools/shader-compiler.ts < request.json
//
// The module's answer goes to standard output as it stands, without being read into objects and
// written out again. The engine's own manifest answers with more than a gigabyte, and the round
// trip through `buildShaders` would hold several copies of that at once for no gain: the caller
// reads JSON either way, and this leaves the module's own pieces as the only copy.
import { CompilerCalls } from '../packages/vite-plugin/src/compiler-calls.js';
import { compilerModule } from '../packages/vite-plugin/src/shader-compiler';

const call = new CompilerCalls(compilerModule());
process.stdout.write(call.call('build', await Bun.stdin.text()));
