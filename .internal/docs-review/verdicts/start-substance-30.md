# start-substance-30

## Finding as given

```json
{
 "page": "getting-started/first-scene,getting-started/project-structure",
 "anchor": "first-scene line 22 \"Put the four files below in one folder\"; project-structure table src/page.ts, src/sketch.ts",
 "category": "unclear",
 "severity": "low",
 "claim": "Project structure says the first scene explains its modules, but the first scene puts the files flat in one folder, and the templates keep them in src/. The first scene also has no package.json or tsconfig.json, which the test command needs.",
 "evidence": "first-scene.md:22, :39; project-structure.md:54-58; packages/cli/templates/empty/src.",
 "proposedEdit": "Add to first-scene: \"A project from `bunx @null3d/cli create` keeps the two modules in `src/`, with a `package.json` and a `tsconfig.json` ([Project structure](project-structure.md)).\"",
 "generatedSource": "",
 "id": "start-substance-30",
 "slice": "start",
 "role": "substance"
}
```

Verdict: partly

## Evidence

- The folder difference is real. first-scene.md:22 says "Put the four files below in one folder", and its HTML loads `./page.ts` (first-scene.md:39). The `empty` template keeps `src/page.ts` and `src/sketch.ts` (packages/cli/templates/empty/src), and project-structure.md:54-55 lists them in `src/`.
- project-structure.md:66 says the first scene "explains the page module, the sketch module and the engine's calls". That is true. It does not claim the first scene uses the same layout. So there is no contradiction, only two layouts with no word that links them.
- first-scene.md has no link to Project structure anywhere (it links Install, Hosting, quality presets, errors and API pages). A reader who finishes the first scene does not learn that `create` makes the same project ready-made.
- The package.json part does not hold. first-scene.md:22 sends the reader to Install, and install.md:19-22 runs `bun add`, which writes `package.json`.
- The tsconfig.json part does not hold as a gap. The first scene runs only `bunx vite` (first-scene.md:118-122), and Vite needs no tsconfig to serve TypeScript. The `test` command is not on the first-scene page. install.md:97-104 covers the test command, the `typescript` dev package and the `tsconfig.json` types entry.
- Low severity is right: the cost is a missing pointer, not a wrong fact.

## Corrected claim

The first scene puts its files flat in one folder, while every `create` template keeps the two modules in `src/`. The first scene never says this and never links Project structure, so a reader does not learn that a template gives the same project ready-made. The missing package.json and tsconfig.json are not a gap on this page: Install's `bun add` writes package.json, and the first scene never runs the test command that needs tsconfig.json.

## Corrected edit

Add a short line to the end of the first-scene intro (after line 22), or as the first bullet of "Next steps":

"`bunx @null3d/cli create` writes this same project for you, with the two modules in `src/` ([Project structure](project-structure.md))."

Do not frame package.json or tsconfig.json as files the first scene lacks.
