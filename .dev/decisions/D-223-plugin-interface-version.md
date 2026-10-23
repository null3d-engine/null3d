# D-223: The plugin interface version for add-ons from other developers

Status: decided. Date: 2026-10-23. Task: M3-D6. This record gives the run-time check that [D-173](D-173-addon-hooks.md) section 5 and ruling 9 ask for. It sits beside the exact engine-version pin of [D-207](D-207-addon-version-checks.md).

Summary: The engine carries one whole-number plugin interface version, `PLUGIN_INTERFACE_VERSION`, which changes only when a stable add-on hook changes. An add-on from another developer calls `checkPluginInterface(name, { min, max })` as its module loads. The engine throws E1433 when its interface lies outside that range, and the message names the add-on, the range and the interface version. The engine's own add-ons keep the exact pin of `checkAddonVersion`.

## Question

An add-on from another developer does not release with the engine, so it cannot pin one engine version. What does it declare instead, and where does the engine refuse a page that does not match?

## Rule

- The engine's own add-ons ship in step with the engine and pin it exactly ([D-54](D-54-addon-modules.md), [D-173](D-173-addon-hooks.md) ruling 13, [D-207](D-207-addon-version-checks.md)). An outside add-on needs a range, because it outlives many engine releases.
- A page that loads an add-on built for another interface fails at once, before it draws. Its message names the add-on and both versions (design principle 10).
- Add-ons reach the engine only through `@null3d/engine`, so the check must be public, with TSDoc, in the API reference.
- The check runs in the engine, so the message, the code and the fix text have one source (the rule of [D-207](D-207-addon-version-checks.md)).

## Data

- `checkAddonVersion(name, version)` already compares an add-on's version with the engine's `VERSION` exactly (`packages/engine/src/shared/version.ts`). Its kind of pin suits the engine's own add-ons, which the release writes at one version.
- Five foundation add-ons call it at the top of their entry point: controls, geometry, impostors, particles and terrain. A sixth call pattern would be a second rule for one task.
- Nothing versions the public hooks that an outside add-on builds against. The feature description of [D-202](D-202-one-feature-description.md), the task hook of [D-54](D-54-addon-modules.md) and the material and pass calls can change between releases.
- The engine's start code gains only the function that an add-on calls. A sketch that imports no add-on reaches none of it after tree shaking.

## Decision

**The version.** One exported constant, `PLUGIN_INTERFACE_VERSION`, in `shared/version.ts` beside `VERSION`. It is a whole number and starts at 1. It changes only when a stable hook changes. An experimental hook may still change in a 1.x release ([D-173](D-173-addon-hooks.md) ruling 3), so it does not move the version. The interface freezes with the API at 1.0.

**The declaration.** One function:

```ts
checkPluginInterface(name: string, range: PluginInterfaceRange): void
```

`PluginInterfaceRange` holds `min` and `max`, both included. An add-on declares the versions it was built to work with:

```ts
import { checkPluginInterface } from '@null3d/engine';

checkPluginInterface('@acme/splats', { min: 1, max: 1 });
```

The add-on calls it at module scope, beside `checkAddonVersion` for an engine add-on, so the error comes when the sketch imports the add-on. A single-version range is the exact pin. A range that is not two whole versions in order is refused with the same code and a message that quotes the declaration.

**The refusal.** E1433, "Add-on for another plugin interface". Its message names the add-on, the declared range and this engine's interface version, with the engine's release in brackets:

```text
E1433: @acme/splats was built for plugin interface 1 to 2, and this page has plugin interface 3 (null3D 0.3.0).
```

The fix says to install the add-on release that matches the engine's interface, or to run an engine version that the add-on declares. It also keeps D-207's upgrade path for the engine's own packages.

## Consequences

- `packages/engine/src/index.ts` exports `PLUGIN_INTERFACE_VERSION`, `PluginInterfaceRange` and `checkPluginInterface`. `docs/api/engine.md` gives the declaration to add-on authors.
- E1433 joins `codes.ts`, `fixes.ts` and the code list in `engine-error.ts`, with a generated docs page like every other code.
- The develop skill's troubleshooting table names E1433.
- `packages/engine/src/shared/version.test.ts` covers the matching case, a range above the engine's interface, a single-version range, and a malformed declaration.
- The engine's own add-ons and `tools/lib/addon-versions.ts` are unchanged: they keep the exact pin.
