# Rules for AI agents in this project

This project uses null3D {{null3dVersion}}. Every `@null3d/*` package uses that version.

Read the `null3d-develop` skill before you change the scene. If the project has
`.claude/skills/null3d-develop/SKILL.md`, read that file first. If it does not, read the engine docs
in `node_modules/@null3d/engine/docs/`. They match the installed version.

## This project's scene

The `product` template is a product viewer. `src/sketch.ts` builds a vase and an ornament from
`@null3d/geometry` on a turntable, with glazed, gold, wood and felt materials. The built-in room
environment and one light that casts shadows light them. A shadow catcher under the turntable shows
the shadows and nothing else. The Neutral tone curve keeps the base colors true. Orbit controls from
`@null3d/controls` turn the camera, with damping and limits, and turn it by themselves until the
first drag.

To show your own product, load its glTF model with `assets.loadGltf` and place it with
`scene.instantiate`, in place of the shapes. Keep the Neutral tone curve for products.

## What the hook checks

The hook holds one rule for each command and each edit. A rule with the action `refuse` blocks the
call, and the agent must find another way. A rule with the action `flag` tells the agent, and the
call goes on.

| Rule | Action | What it checks |
| --- | --- | --- |
| `no-sleep` | refuse | A command that waits with `sleep`. |
| `no-kill-by-name` | refuse | `pkill`, `killall`, or `kill` with a process name. |
| `no-log-follow` | refuse | `tail -f`, `journalctl -f`, `docker logs -f` and their like. |
| `no-unknown-api` | flag | An import that the installed engine does not export. |
| `no-allocation-in-onupdate` | flag | An object, array or string made inside `onUpdate`. |
| `no-dom-in-sketch` | flag | A DOM name in `sketch.ts`. |

Claude Code runs the hook through `.claude/settings.json`, and Codex runs it through
`.codex/hooks.json`. Both run `.agent/agent-hook.mjs`, which takes its rules from
`@null3d/cli/agent-rules` in the installed packages. The hook needs `bun install` to find the rules.
Codex asks you to trust a project's hooks before it runs them. Other agents read this file and
follow the same rules. The hook is optional: delete its entries in `.claude/settings.json` and
`.codex/hooks.json` to stop the checks.

## Before you build a feature

A user who asks for a new feature brings three things:

- What they want to see on screen, with a reference picture or the effect in another engine.
- The devices and browsers it must run on, such as a mid-range Android phone.
- The cost it may take, in milliseconds per frame or lowest frame rate.

Settle its state before you design the scene.

1. Read the docs page for the feature. Use only the calls that the page and the engine's type
   declarations show. Never invent a call or an option.
2. Check the foundation add-ons below before you write a generator, control, effect or loader of
   your own. Each is the one place that feature lives, and it gets fixes with the engine. Do not
   write a second version of one.
3. If nothing covers the need, build it above the public API: a custom material, a vertex offset, a
   post effect or a render pass. Keep that code in the project, and add no property or call that
   imitates engine API, because it breaks on the next update.
4. Say in your summary what you built above the public API, and why.

| Need | Use | Notes |
| --- | --- | --- |
| Orbit, map, fly and first-person cameras, and drag, rotate or scale handles | `@null3d/controls` | |
| Torus knots, polyhedra, lathes, extrusions and tubes | `@null3d/geometry` | |
| Far objects as camera-facing cards, or one mesh per far grid cell | `@null3d/impostors` | bake several views for any card bigger than a few pixels |
| Fire, smoke, sparks, rain and other particle effects | `@null3d/particles` | |
| Gaussian splats from a scan or a training run | `@null3d/splats` | |
| Ground from a height field | `@null3d/terrain` | |
| Grass over a ground, swaying in the wind | `@null3d/grass` | see the docs page api/grass |
| Rigid bodies, joints and character movement | Rapier or cannon-es | run the library in the sketch worker |
| Text in the scene | HTML labels | `ui.trackLabel` keeps a label on an object |
| A river or a lake, with waves, foam and soft shores | `@null3d/water` | see the docs page api/water |
| Trees, shrubs and ferns | code or glTF models | make plants in code or from glTF models, with `@null3d/wind` for the sway |
| Wind that plants, flags and smoke read, with travelling gusts and pushes | `@null3d/wind` | see the docs page api/wind |
| Sound placed in the scene: loops, groups of many sources and one-shots | `@null3d/sound` | see the docs page api/sound |
| three.js look modes for a port | `@null3d/three-compat` | |

## Rules

1. Read the docs page before you call an API. Use only the calls that the page shows.
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
