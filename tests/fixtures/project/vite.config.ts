// The project's Vite config: the null3D plugin, as every null3D project has. Its production build
// holds every page, so the command-line tool's tests can measure each one in the build.
import { join } from 'node:path';
import null3d from '@null3d/vite-plugin';
import { defineConfig } from 'vite';

const PAGES = ['index.html', 'broken.html', 'throws.html'];

export default defineConfig({
	plugins: [null3d()],
	build: { rolldownOptions: { input: PAGES.map((page) => join(import.meta.dirname, page)) } },
});
