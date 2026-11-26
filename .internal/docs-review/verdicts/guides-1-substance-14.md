# guides-1-substance-14

## Finding as given

- page: guides/car-paint
- anchor: "Copy the folder into your project and import its entry point." (line 28)
- category: missing-prerequisite
- severity: medium
- claim: The entry point imports ./paint.wgsl, which only the null3D Vite plugin compiles; the page does not say so. The folder is not linked.
- evidence: examples/addons/car-paint/index.ts:7; examples/addons/car-paint/paint.wgsl.d.ts:3.
- proposedEdit: "The paint is an example add-on, not an npm package: [examples/addons/car-paint](https://github.com/null3d-engine/null3d/tree/main/examples/addons/car-paint). Copy the folder, with its paint.wgsl. Your project needs the null3D Vite plugin, which compiles the WGSL ([Install null3D](../getting-started/install.md))."
- generatedSource: (none; hand-written page)

Verdict: partly

## Evidence

- docs/guides/car-paint.md:28-29 names the folder only as inline code. The page has no link to it. Its only GitHub link (line 120) goes to the showroom demo. This part of the finding holds.
- examples/addons/car-paint/index.ts:7 imports `./paint.wgsl`. paint.wgsl.d.ts:1-3 says the null3D Vite plugin writes that file. The page never says the Vite plugin or WGSL. The facts in the claim are correct.
- The prerequisite is not really missing for a supported project. docs/getting-started/install.md:46 says "Every Vite build of a null3D project needs the plugin". Line 50 says the plugin compiles each imported `.wgsl` file and writes its declaration. Line 58 says "null3D requires Vite with this plugin. Other bundlers are not supported or tested." So a reader who followed Install already has the plugin, and the paint's WGSL compiles with no extra step.
- The only reader who can fail is one on the no-build CDN page. docs/getting-started/cdn.md:182 already says that a page with no build step cannot compile custom WGSL. That case is covered elsewhere, but the car-paint page does not point to it.
- So the cost to a reader is small. A missing link and a short pointer is low severity, not medium.
- The proposed edit is mostly sound. The link format matches the website contract, and the relative path to Install is correct from docs/guides/. But "Copy the folder, with its paint.wgsl" repeats what "copy the folder" already means. "Your project needs the null3D Vite plugin" reads as a new requirement when every project already has it.

## Corrected claim

The page does not link the add-on's folder. It also does not say that the folder's WGSL file compiles through the null3D Vite plugin, which every supported project already uses (install.md:46, 58). Only a no-build CDN page cannot use the paint (cdn.md:182). Severity: low.

## Corrected edit

Replace lines 28-29 with:

"The paint is an example add-on in the repository, in the [examples/addons/car-paint](https://github.com/null3d-engine/null3d/tree/main/examples/addons/car-paint) folder. It is not an npm package. Copy the folder into your project and import its entry point. The null3D Vite plugin compiles the folder's WGSL file, as it does for your own shaders ([Builds](../getting-started/install.md#builds)). A page with no build step cannot use it."
