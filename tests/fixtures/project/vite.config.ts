// The project's Vite config: the null3D plugin, as every null3D project has. Its production build
// holds every page, so the command-line tool's tests can measure each one in the build. The project
// lives in the repository, so it takes the plugin's and the engine's source, where a project that
// installs them takes their built files.
import { join } from 'node:path';
import { defineConfig } from 'vite';
import null3d from '../../../packages/vite-plugin/src/index.ts';
import { sourceResolve } from '../../../tools/lib/source-condition.ts';

const PAGES = ['index.html', 'broken.html', 'throws.html'];

export default defineConfig({
	plugins: [null3d()],
	resolve: sourceResolve,
	build: { rolldownOptions: { input: PAGES.map((page) => join(import.meta.dirname, page)) } },
});
