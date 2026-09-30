// The project's Vite config: the null3D plugin, as every null3D project has.
import null3d from '@null3d/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({ plugins: [null3d()] });
