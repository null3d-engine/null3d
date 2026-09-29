// Builds a shader manifest with the shader compiler, the WebAssembly module that build tools
// load, and prints the result as JSON. The request comes on standard input: the manifest's text
// and every WGSL file, as `{ "manifest": ..., "files": { "<path>": ... } }`. The shader crate's
// build tests run this to check that the module gives the native build's results:
//   bun tools/shader-compiler.ts < request.json
import { buildShaders, type ShaderBuildInputs } from '../packages/vite-plugin/src/shader-compiler';

const inputs = JSON.parse(await Bun.stdin.text()) as ShaderBuildInputs;
process.stdout.write(JSON.stringify(buildShaders(inputs)));
