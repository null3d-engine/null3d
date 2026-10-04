// The production build of the benchmark pages, as a developer builds a null3D page to ship it: the
// engine's development checks are off, and Vite minifies as it does by default. The benchmark tools
// build the pages with this file and serve the build, so they measure the engine that ships.
// NULL3D_BENCH_ROOT names another copy of the repository whose pages to build, such as the baseline
// of a comparison. That copy's pages, engine and three.js go into the build, through this copy's
// Vite and plugin, so a copy from before this file builds too.
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig } from 'vite';
import null3d from '../packages/vite-plugin/src/index.ts';
import { ensureShaderModules } from '../tools/lib/shader-modules.ts';
import { sourceResolve } from '../tools/lib/source-condition.ts';

const root = resolve(process.env.NULL3D_BENCH_ROOT || join(import.meta.dirname, '..'));
// The pages import the shader modules, which git does not keep. Another copy's build (`bun run
// build`) makes that copy's modules, or the copy keeps them in git.
if (!process.env.NULL3D_BENCH_ROOT) ensureShaderModules(root);
const pagesDir = join(root, 'bench/pages');
/** Every page under the benchmark pages' folder, by its path there without the extension. */
const pages = readdirSync(pagesDir, { recursive: true, encoding: 'utf8' })
	.filter((path) => path.endsWith('.html'))
	.map((path) => [path.replace(/\.html$/, ''), join(pagesDir, path)]);

export default defineConfig({
	root,
	// Relative addresses, so the build works under any address prefix, such as a load route's.
	base: './',
	plugins: [null3d({ urlSwitches: true })],
	// The pages take the packages' source, not the files that their pack step builds.
	resolve: sourceResolve,
	logLevel: 'warn',
	build: {
		emptyOutDir: true,
		// Every file of the build lies under bench/, so a server can tell it from the test pages' build.
		assetsDir: 'bench/assets',
		// Maps beside the files, for tools that name the functions in a profile; the files stay as a
		// developer's production build writes them.
		sourcemap: 'hidden',
		rollupOptions: { input: Object.fromEntries(pages) },
	},
});
