# D-224: Namespaces for add-ons

Status: decided and built. Task: M3-D8. [D-173](D-173-addon-hooks.md) asks each add-on for a shader library name (`<add-on>::`), an error-code range and its quality keys. This record says what a namespace is, where an add-on declares it, and where a clash is refused.

Summary: An add-on claims a namespace with `declareAddonNamespace()` as its module loads, beside `checkAddonVersion`. The namespace holds the add-on's name, the package that owns it, its shader library, its error-code range and the quality keys that it adds. An add-on from another developer also declares the plugin interface range it was built for. The engine reserves `null3d` and its own codes below 2000. Every add-on of one thread shares one registry, and `FeatureHost` registers each feature's name, outputs and lighting slots there. A second owner of any name is refused with E1225, which names both add-ons and both packages. An add-on's names are checked once, where it loads, and the engine's names stay out of its reach.

## Question

Shader library names, error codes and quality keys form one flat space. `null3d::` belongs to the engine. The codes run from E1101 to E1505. The quality keys are the rows of the engine's preset table. Two add-ons from two sellers could take one name. The engine would then have two answers for it. Where does an add-on declare its names, and what refuses a second owner?

## Rule

- An add-on reaches the engine only through `@null3d/engine` ([D-173](D-173-addon-hooks.md), ruling 2), so its namespace is part of that entry point.
- Names are claimed once, where the add-on's module loads. Importing an add-on is using it, and a clash then stops the load before any frame work.
- The engine's names are reserved: the name `null3d`, the shader library `null3d`, the codes of the engine's table and every key of the preset table.
- The check names both owners, including the add-on that holds the name, so a large page finds the second add-on without a search.
- One registry belongs to one thread. A page and its sketches have a thread each, and only add-ons of the same thread can name the same thing.
- A separate registry may be passed, so a test keeps its names to itself.
- A module that loads again under the same package with the same names, as a development reload does, gets the same namespace. A claim under another package, or other names under a claimed name, raise E1225.

## Data

- `checkAddonVersion(name, version)` runs as each add-on's module loads (F9, [D-173](D-173-addon-hooks.md)), so the place for the declaration exists.
- A `FeatureRegistry` checks a feature name, an output name and a lighting slot within one host only. Without a shared registry, two hosts, one per add-on, could each register a feature named `splats`, an output named `spray` or a provider of the sky slot.
- A budget named `feature:<feature>` lets two add-ons with a feature of the same name replace each other's budget silently.
- The engine's codes run from E1101 to E1505, and `ERROR_FIXES` types the only codes `EngineError` takes. An add-on's range therefore starts above them.

## Decision

- `AddonNamespace` holds `name`, `package`, `shaderLibrary` (the name by default), `errorCodes` (a first and a last code), `qualityKeys` and `pluginInterface` (the interface versions the add-on was built for). The required `package` is the package or module that owns the namespace, such as an npm package name. A name takes 1 to 32 lowercase letters, digits or underscore characters, starting with a letter. WGSL identifiers take no hyphen, so a hyphenated package name is not the namespace name.
- The claim runs [D-223](D-223-plugin-interface-version.md)'s `checkPluginInterface` when the namespace gives a range, so one call names and versions the add-on. The engine's own add-ons leave the range out and keep their exact version pin.
- `declareAddonNamespace()` claims the namespace in the thread's `AddonNamespaces`, kept on the thread's global object under a registered symbol, as the table of error fixes is. Two copies of the engine module in one thread share it.
- An add-on's own codes must lie from 2000 to 9999 and no two add-ons' ranges may overlap. The engine's codes stay below 2000.
- A quality key must not be a key of `QUALITY_SETTINGS` or another add-on's.
- `FeatureHost` takes the namespace and registers each feature's name, outputs and lighting slots in the thread's registry. The host's budgets are named `feature:<add-on>:<feature>`. A host refuses a namespace that the registry does not hold, so no add-on skips the check.
- E1225 reports every clash, and its message names the add-on that holds the name.
- A claim under a package that already holds the name gives back the claimed namespace when every field matches. That is the development reload.
- A claim under another package is refused with E1225, even when every other field matches. The message names both packages.
- A claim under the same package with other fields is refused too, and the message says that the package claims other names.
- The package takes 1 to 128 characters with no spaces. The registry stores it on the namespace, so a `FeatureHost` and the docs can name the owner.
- The shader library name stays reserved for its owner, but the shader build resolves only the engine's own `null3d::` prefix. An add-on's WGSL imports the engine's library as every other shader does. The docs and the TSDoc show no import of an add-on's own prefix. Resolving that prefix would need the shader compiler to receive the add-on's modules at pack time, which it does not.
- Releasing a namespace or a feature gives its names back, so a sketch that unloads an add-on frees them.

## Options rejected

- **Prefix every exported name with the add-on's name.** It avoids the clash instead of reporting it, and the feature names in errors, render graphs and the stats overlay would then carry a prefix. The plan asks for a clear refusal, and a feature's name is more useful bare.
- **A registry per `FeatureHost`.** It cannot see another add-on. Two add-ons would still both own the sky slot.
- **A registry the sketch passes to each add-on.** Every sketch would have to remember it, and an add-on loaded without it would go unchecked. The thread's registry cannot be forgotten.
- **Codes allocated by the registry.** An add-on's codes would differ between runs or pages, and its docs could not name them. A declared range stays stable.
- **A hyphen in a namespace name.** WGSL identifiers take no hyphen, and the shader library defaults to the name.
- **A namespace without an owning package.** A reload that declares the same names then gets the same namespace. So two different add-ons that declare the same name with the same fields share one namespace without an error.

## Consequences

- **Code:** `packages/engine/src/scene/namespaces.ts` holds the types, the checks and the registry. `index.ts` exports them. `feature-host.ts` takes the namespace, checks each feature's names and names its budgets with the add-on. E1225 is in `codes.ts`, `fixes.ts` and the code list.
- **Tests:** `namespaces.test.ts` covers the defaults and each refusal. `feature-host.test.ts` covers two add-ons that share a feature name, an output and a slot. It also covers a released name, and two budgets that stay apart. The namespace tests also check that two packages with one name fail and that both are named. They check that a reload under its own package keeps its namespace, and that a claim without a usable package fails. The stats test add-on and the splats add-on pass their package.
- **Docs:** the namespaces section of `docs/api/features.md`, and the generated E1225 page.
- **Size:** the code runs only where an add-on registers, not on the start path. No page that uses no add-on downloads it.
- **Listing check:** the listing check (M3-D9, [D-225](D-225-addon-listing-check.md)) accepts the interface range inside `declareAddonNamespace()` as well as a direct `checkPluginInterface` call, so an add-on that declares through its namespace passes.
