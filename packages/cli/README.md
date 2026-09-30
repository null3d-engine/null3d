# null3D

The command-line tool for [null3D](https://github.com/null3d-engine/null3d), a browser 3D engine for games and heavy 3D apps.

You do not need this tool to use the engine. Install `@null3d/engine` from npm, add `@null3d/vite-plugin` to your Vite config, and run Vite. This tool adds jobs that a bundler does not do, such as headless tests, screenshots and benchmarks.

null3D is in early development. This version has one command, `shot`. It draws one frame of your project's page in a headless browser and saves it as a PNG file:

```sh
bunx @null3d/cli shot --out shot.png --time 1.5 --gpu webgl2
```

Run it in your project's folder, where it starts your project's own Vite dev server. Beside the image, it saves a JSON file with the frame's facts and the page's errors. `bunx @null3d/cli shot --help` lists its options. The `test` and `bench` commands come later.

## License

Licensed under either of the Apache License 2.0 or the MIT license, at your option.
