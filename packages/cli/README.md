# null3D

The command-line tool for [null3D](https://github.com/null3d-engine/null3d), a browser 3D engine for games and heavy 3D apps.

You do not need this tool to use the engine. Install `@null3d/engine` from npm, add `@null3d/vite-plugin` to your Vite config, and run Vite. This tool adds jobs that a bundler does not do, such as headless tests, screenshots and benchmarks.

null3D is in early development. This version has six commands:

- `shot` draws one frame of your project's page in a headless browser and saves it as a PNG file.
- `test` type checks your project and runs its lint script. Then it compares the image tests that `null3d.json` lists with their reference images.
- `bench` measures the engine on a production build of your page: CPU time per frame by thread, GPU time and frame rates, over fresh runs.
- `check-addon` runs the engine's gates on an add-on package: its public imports, the plugin interface it declares, its shaders on both GPU paths, the size of the files it loads after the start, and, with a page, its start from another origin under the strict policy and its cost per quality preset.
- `assets` prepares models and textures. `optimize` quantizes glTF meshes and encodes KTX2 textures. `convert` turns FBX, OBJ, STL and PLY files into glTF. `pack-orm` and `normal-from-bump` make material maps, and `env` makes environment maps from HDR images.
- `upgrade` moves every null3D package in your `package.json` to one version, so that an add-on and the engine never mix two versions.

```sh
bunx @null3d/cli shot --out shot.png --time 1.5 --gpu webgl2
bunx @null3d/cli test --gpu webgpu,webgl2
bunx @null3d/cli bench --gpu webgpu,webgl2
bunx @null3d/cli check-addon addons/splats
bunx @null3d/cli upgrade
```

Run them in your project's folder. `shot` and `test` start your project's own Vite dev server, `bench` builds your project with its own Vite config, and `check-addon` builds the add-on that it checks. `shot` and `bench` save a JSON file with their figures and the page's errors, and `test` and `check-addon` print one line for each result. `upgrade` writes `package.json` alone, and you run `bun install` after it. `bunx @null3d/cli <command> --help` lists a command's options.

## License

Licensed under either of the Apache License 2.0 or the MIT license, at your option.
