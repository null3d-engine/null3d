import { join } from 'node:path';
import sokko3d from '@sokko3d/vite-plugin';
import { defineConfig } from 'vite';
import { reportCollector } from './lib/report-collector.ts';

// Serves the test pages with the isolation headers. SOKKO3D_HTTPS=1 serves HTTPS on the local
// network, for tablets and phones that reach the Mac by its .local name.
export default defineConfig({
	root: join(import.meta.dirname, 'pages'),
	plugins: [
		sokko3d({
			https: process.env.SOKKO3D_HTTPS === '1',
			certDir: join(import.meta.dirname, '../target/dev-cert'),
		}),
		reportCollector(),
	],
	server: { port: 5173, strictPort: true, fs: { allow: [join(import.meta.dirname, '..')] } },
});
