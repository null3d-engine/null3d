// Whether this is a development build, for the GPU layer. It reads the constant that the Vite
// plugin defines, as errors/checks.ts does. The GPU layer keeps its own copy because the files
// that draw and the sketch's files must share no module: a shared module becomes a file of its own
// in a production build, and every page would download it.

declare const __NULL3D_DEV__: boolean | undefined;

/** True in development builds, and whenever no bundler has defined the constant. */
export const DEV: boolean = typeof __NULL3D_DEV__ === 'undefined' ? true : __NULL3D_DEV__;
