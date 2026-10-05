import { defineConfig, type Plugin, searchForWorkspaceRoot, type UserConfig } from 'vite';
import null3d from './packages/vite-plugin/src/index.ts';
import { loadServer } from './tests/lib/load-server.ts';
import { reportCollector } from './tests/lib/report-collector.ts';
import { HTTP_PORT, HTTPS_PORT } from './tests/lib/server.ts';
import { tunnelServer } from './tests/lib/tunnel-server.ts';
import { sampleEnvironmentsServer } from './tools/lib/sample-environments.ts';
import { samplesServer } from './tools/lib/samples.ts';
import { ensureShaderModules } from './tools/lib/shader-modules.ts';
import { sourceResolve } from './tools/lib/source-condition.ts';

// One dev server for every browser page in the repository: the test pages under tests/pages, the
// benchmark pages under bench/pages and the demos under examples, with the isolation headers.
// Plain HTTP stays on localhost, which phones reach through adb. NULL3D_HTTPS=1 serves HTTPS on the
// local network instead, on its own port, for tablets and phones that reach the Mac by its .local
// name. The dev server and `vite preview` also serve the startup build of the engine test page, one
// address prefix per load, and the pinned sample content under /samples/ from the shared cache,
// with the environment maps of its HDR files under /sample-environments/. Requests that come
// through BrowserStack Local's tunnel get cache times and compression.

const https = process.env.NULL3D_HTTPS === '1';

/**
 * Files the server refuses, besides Vite's defaults: private notes, build output and agent state
 * inside this repository. The patterns are anchored at the repository, so a checkout that itself
 * lives inside such a folder still serves its pages.
 */
const DENIED = [
	'.env',
	'.env.*',
	'*.{crt,pem}',
	'**/.git/**',
	...['.dev', '.internal', 'target', '.claude'].map(
		(folder) => `${import.meta.dirname}/${folder}/**`,
	),
];

/**
 * The test page that a production build holds: the engine test page, or the page that
 * NULL3D_BUILD_PAGE names. Each page builds on its own, so no other page shares a file with the
 * engine test page or changes what the startup benchmark downloads. Another page's build adds its
 * files to the engine test page's build, with its assets in a folder of their own.
 */
const builtPage = process.env.NULL3D_BUILD_PAGE || 'engine';
const enginePage = builtPage === 'engine';

/** Sends the server's bare address to the list of test pages. */
const indexRedirect: Plugin = {
	name: 'null3d-index-redirect',
	configureServer(server) {
		server.middlewares.use((req, res, next) => {
			if (req.url !== '/') return next();
			res.statusCode = 302;
			res.setHeader('Location', '/tests/pages/');
			res.end();
		});
	},
};

const config: UserConfig = {
	root: import.meta.dirname,
	// The HTTP and HTTPS servers can run at once, so each keeps its own prebundled dependencies.
	cacheDir: https ? 'node_modules/.vite-https' : 'node_modules/.vite',
	plugins: [
		tunnelServer(),
		null3d({ https, certDir: 'target/dev-cert' }),
		reportCollector(),
		loadServer(),
		samplesServer(import.meta.dirname),
		sampleEnvironmentsServer(import.meta.dirname),
		indexRedirect,
	],
	// The pages take the packages' source, not the files that their pack step builds.
	resolve: sourceResolve,
	server: {
		port: https ? HTTPS_PORT : HTTP_PORT,
		strictPort: true,
		fs: { strict: true, allow: [searchForWorkspaceRoot(import.meta.dirname)], deny: DENIED },
		watch: {
			ignored: [
				'**/target/**',
				'**/.claude/**',
				'**/.dev/**',
				'**/.internal/**',
				'**/test-results/**',
			],
		},
	},
	optimizeDeps: {
		entries: ['tests/pages/**/*.html', 'bench/pages/**/*.html', 'examples/**/*.html'],
	},
	// The production builds of the test pages, which the production browser tests serve.
	build: {
		outDir: 'target/production-pages',
		emptyOutDir: enginePage,
		assetsDir: enginePage ? 'assets' : `assets/${builtPage}`,
		rollupOptions: {
			input: { [builtPage]: `${import.meta.dirname}/tests/pages/${builtPage}.html` },
		},
	},
};

export default defineConfig(({ isPreview }) => {
	// The pages import the shader modules, which git does not keep. `vite preview` serves builds
	// that already hold them, so it runs without the Rust toolchain that builds them.
	if (!isPreview) ensureShaderModules(import.meta.dirname);
	return config;
});
