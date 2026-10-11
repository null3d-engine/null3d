// The production build of the examples page and every demo, against this checkout's packages, as
// `bun run examples:build` makes it. Addresses are relative, so the build works under any prefix.
// `bun run examples:preview` serves the build with the isolation headers and the sample files
// under /samples/, which the demos that load files read. A website that ships the demos builds
// the same page with its own config: .dev/examples.md says how.
import { join } from 'node:path';
import { defineConfig } from 'vite';
import null3d from '../packages/vite-plugin/src/index.ts';
import { samplesServer } from '../tools/lib/samples.ts';
import { ensureShaderModules } from '../tools/lib/shader-modules.ts';
import { sourceResolve } from '../tools/lib/source-condition.ts';

const repo = join(import.meta.dirname, '..');

export default defineConfig(({ isPreview }) => {
	// The engine imports the shader modules, which git does not keep. A preview serves a build that
	// already holds them.
	if (!isPreview) ensureShaderModules(repo);
	return {
		root: import.meta.dirname,
		base: './',
		// The engine's test switches, such as ?hold= and ?gpu=, work in this build too.
		plugins: [null3d({ urlSwitches: true }), samplesServer(repo)],
		// The demos take the packages' source, not the files that their pack step builds.
		resolve: sourceResolve,
		logLevel: 'warn',
		build: { outDir: join(repo, 'target/examples'), emptyOutDir: true },
		preview: { port: Number(process.env.NULL3D_PORT ?? 5173) },
	};
});
