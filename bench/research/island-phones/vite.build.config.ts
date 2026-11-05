// The production build of the phones study's page, as the benchmark pages are built: the engine's
// development checks are off and Vite minifies. `vite preview` with the repository's config serves
// it with the isolation headers that the threaded engine needs.
import { join, resolve } from 'node:path';
import { defineConfig } from 'vite';
import null3d from '../../../packages/vite-plugin/src/index.ts';
import { ensureShaderModules } from '../../../tools/lib/shader-modules.ts';
import { sourceResolve } from '../../../tools/lib/source-condition.ts';

const root = resolve(join(import.meta.dirname, '../../..'));
ensureShaderModules(root);

export default defineConfig({
	root,
	base: './',
	plugins: [null3d({ urlSwitches: true })],
	resolve: sourceResolve,
	logLevel: 'warn',
	build: {
		emptyOutDir: true,
		outDir: join(root, 'target/island-phones'),
		// Every file lies under the study's own folder, so the device runner's load route can tell
		// the build from the benchmark pages' build.
		assetsDir: 'bench/research/island-phones/assets',
		sourcemap: 'hidden',
		rollupOptions: {
			input: {
				'bench/research/island-phones/pages/island': join(
					root,
					'bench/research/island-phones/pages/island.html',
				),
			},
		},
	},
});
