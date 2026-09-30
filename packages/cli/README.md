# null3D

The command-line tool for [null3D](https://github.com/null3d-engine/null3d), a browser 3D engine for games and heavy 3D apps.

You do not need this tool to use the engine. Install `@null3d/engine` from npm, add `@null3d/vite-plugin` to your Vite config, and run Vite. This tool adds jobs that a bundler does not do, such as headless tests, screenshots and benchmarks.

null3D is in early development. This version has two commands:

- `shot` draws one frame of your project's page in a headless browser and saves it as a PNG file.
- `bench` measures the engine on a production build of your page: CPU time per frame by thread, GPU time and frame rates, over fresh runs.

```sh
bunx @null3d/cli shot --out shot.png --time 1.5 --gpu webgl2
bunx @null3d/cli bench --gpu webgpu,webgl2
```

Run them in your project's folder. `shot` starts your project's own Vite dev server, and `bench` builds your project with its own Vite config. Each saves a JSON file with its figures and the page's errors. `bunx @null3d/cli <command> --help` lists a command's options. The `test` command comes later.

## License

Licensed under either of the Apache License 2.0 or the MIT license, at your option.
