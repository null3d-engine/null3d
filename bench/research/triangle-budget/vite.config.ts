// The triangle budget study's dev server: the repository's dev server on its own port and cache,
// with one change to three.js r187's meshlet pipeline. The pipeline counts only the main view's
// kept meshlets in `info.triangles`; the change keeps the triangles of each shadow pass's latest
// readback in `info.shadowTriangles`, by its culling record, so the study can count what three.js's
// shadow map draws in a frame. Nothing else in
// the pipeline changes. The change applies to the prebundled copy as well as to a served file.
import { defineConfig, mergeConfig, type Plugin, type UserConfig } from 'vite';
import repository from '../../../vite.config.ts';

const FROM = 'if ( culling.shadow === false ) {';
const TO =
	'if ( culling.shadow === true ) ( this.info.shadowTriangles ??= new Map() ).set( record, drawn * MESHLET_SIZE );\n\n\t\t\tif ( culling.shadow === false ) {';

const transform = (code: string, id: string) => {
	// The prebundled copy reaches the dev server's transform again, already changed.
	if (!id.includes('MeshletDrawingPipeline') || code.includes('info.shadowTriangles ??='))
		return null;
	if (!code.includes(FROM))
		throw new Error(`${id} no longer holds the line that the study patches`);
	return code.replace(FROM, TO);
};
const shadowCounts: Plugin = { name: 'triangle-budget-three-shadow-counts', transform };

export default defineConfig((env) => {
	const base = (typeof repository === 'function' ? repository(env) : repository) as UserConfig;
	return mergeConfig(base, {
		cacheDir: 'node_modules/.vite-triangle-budget',
		plugins: [shadowCounts],
		server: { port: Number(process.env.TB_PORT ?? 6530) },
		optimizeDeps: {
			entries: ['bench/research/triangle-budget/pages/*.html'],
			rolldownOptions: { plugins: [{ name: 'triangle-budget-three-shadow-counts', transform }] },
		},
	});
});
