# null3D

The command-line tool for [null3D](https://github.com/null3d-engine/null3d), a browser 3D engine for games and heavy 3D apps.

You do not need this tool to use the engine. Install `@null3d/engine` from npm, add `@null3d/vite-plugin` to your Vite config, and run Vite. This tool adds jobs that a bundler does not do, such as headless tests, screenshots and benchmarks.

null3D is in early development. This version has two commands. `shot` draws one frame of your project's page in a headless browser and saves it as a PNG file:

```sh
bunx @null3d/cli shot --out shot.png --time 1.5 --gpu webgl2
```

Beside the image, it saves a JSON file with the frame's facts and the page's errors.

`test` type checks your project and runs its lint script. Then it compares the image tests that `null3d.json` lists with their reference images:

```sh
bunx @null3d/cli test --gpu webgpu,webgl2
```

Run both in your project's folder, where they start your project's own Vite dev server. `bunx @null3d/cli <command> --help` lists a command's options. The `bench` command comes later.

## License

Licensed under either of the Apache License 2.0 or the MIT license, at your option.
