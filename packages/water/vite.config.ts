// The add-on's own page, which `bunx @null3d/cli check-addon` opens for its browser gates. It
// resolves the workspace packages from their source, as the repository's Vite configs do, because
// a checkout holds no built package files.
import { defineConfig } from 'vite';
import { sourceResolve } from '../../tools/lib/source-condition.ts';
import null3d from '../vite-plugin/src/index.ts';

export default defineConfig({ plugins: [null3d()], resolve: sourceResolve });
