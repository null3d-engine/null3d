# Rules for AI agents in this project

This project uses null3D {{null3dVersion}}. Every `@null3d/*` package uses that version.

Read the `null3d-develop` skill before you change the scene. If the project has
`.claude/skills/null3d-develop/SKILL.md`, read that file first. If it does not, read the engine docs
in `node_modules/@null3d/engine/docs/`. They match the installed version.

## Before you build a feature

A request may need a capability that null3D has not built. A user who asks for such a feature brings
three things:

- What they want to see on screen, with a reference picture or the effect in another engine.
- The devices and browsers it must run on, such as a mid-range Android phone.
- The cost it may take, in milliseconds per frame or lowest frame rate.

Settle its state before you design the scene.

1. Read the docs page for the feature. Its status says whether the call exists. A `planned` page or
   a part marked "not built yet" is not in this version: tell the user, and use the workaround the
   page gives. Never invent an option in its place.
2. Check the foundation add-ons below before you write a generator, control, effect or loader of
   your own. Each is the one place that feature lives, and it gets fixes with the engine. Do not
   write a second version of one.
3. If nothing covers the need, build it above the public API: a custom material, a vertex offset, a
   post effect or a render pass. Keep that code in the project, and add no property or call that
   imitates engine API, because it breaks on the next update.
4. Say in your summary what the engine lacks, what you used instead, and what a later version
   changes.

| Need | Package | Status |
| --- | --- | --- |
| Orbit, map, fly and first-person cameras, and drag, rotate or scale handles | `@null3d/controls` | built |
| Torus knots, polyhedra, lathes, extrusions and tubes | `@null3d/geometry` | built |
| Far objects as camera-facing cards, or one mesh per far grid cell | `@null3d/impostors` | built |
| Fire, smoke, sparks, rain and other particle effects | `@null3d/particles` | built |
| Gaussian splats from a scan or a training run | `@null3d/splats` | built |
| Ground from a height field | `@null3d/terrain` | built |
| Rigid bodies, joints and character movement | the physics add-on | not built yet; run Rapier or cannon-es in the sketch worker |
| Text in the scene | the MSDF text add-on | not built yet; use HTML labels |
| A river or a lake, with waves, foam and soft shores | `@null3d/water` | built; see the docs page api/water |
| Trees, shrubs, ferns, grass and their placement by ecological rules | `@null3d/vegetation` | built (generator, scatter and atlases; grass and materials not built yet) |
| Wind on plants, flags, cloth and smoke | `@null3d/wind` | not built yet; move each thing with your own noise |
| three.js look modes for a port | `@null3d/three-compat` | built |

## Rules

1. Read the docs page before you call an API. A page whose status is `planned` describes an API
   that does not exist in this version.
2. Do not wait with `sleep`. Run a check that finishes on its own, such as
   `bunx @null3d/cli test`, or use the tool's own time limit.
3. Stop only a process that you started, by its PID. Do not stop a process by name.
4. Read a log file once, for example with `tail -n 200 <file>`. Do not follow a log.
5. `onUpdate` runs every frame. Make no object, array or string there. Make each one once outside
   `onUpdate`, and reuse it.
6. The sketch runs in a worker and has no DOM. Keep HTML, `document` and `window` in `page.ts`, and
   send messages between the two. A sketch on the main thread may use the DOM, but it shares the
   page thread.
7. Run `bunx @null3d/cli test` before you report the work as done.

Claude Code checks rules 2 to 6 before each command and each edit, through the hook that
`.claude/settings.json` names. Codex checks the same rules through `.codex/hooks.json`, which runs
the same hook script on Codex's tool calls. Codex asks you to trust a project's hooks before it
runs them. Other agents read this file and follow the same rules. The hook is optional: delete
those files, or their hook entries, to remove the checks.
