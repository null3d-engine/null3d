// The fixture's Vite config. It imports the null3D plugin by its source path and resolves the
// workspace packages from their source, as the repository's own Vite configs do: a checkout has no
// built package files, and a project that installs the packages from npm imports them by name.

import { defineConfig } from 'vite';
import null3d from '../../../packages/vite-plugin/src/index.ts';
import { sourceResolve } from '../../../tools/lib/source-condition.ts';

export default defineConfig({ plugins: [null3d()], resolve: sourceResolve });
