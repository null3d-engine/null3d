# Shot and demo-link verdicts: api/scene

Reference images live under tests/image/references/chrome-real-gpu/<tier>/. Every file named below exists in the webgpu, compat and webgl2 tiers. I looked at each picture.

General note: the demo reference images are 320 x 180 pixels. The fog images are 640 x 360 and the time-of-day images are 480 x 270. The small demo frames will look soft if the website shows them wide.

## Shots

| Shot | Keep | Verdict | Corrected source |
| --- | --- | --- | --- |
| fog-curves | yes | The four fog test pages are real (fog-sketch with each fog setting). They show one row of towers under exponential, exp2, linear and height fog. Linear and height fog differ clearly. Exponential and exp2 look almost the same at a glance, so each panel needs a label with its curve. The pictures already exist, so no script is needed. | reference: webgpu/fog-exponential.png, fog-exp2.png, fog-linear.png, fog-height.png |
| clouds-flat-and-volume | no | The claim (Low and Medium flat, High and Ultra volumetric) is right, but the pictures do not show it. In the 320 x 180 volume frame the volumetric clouds are a thin pale strip at the horizon. The flat frame shows more visible cloud than the volume frame, so a reader would think High draws fewer clouds. clouds-ultra and clouds-environment have the same problem. | |
| atmosphere | yes | The file exists and is the demo's held frame at about 17:30 under the physical sky. It shows gold clouds and paler far ridges. The frame is dark, so the haze is less clear than the alt text says. Suggested alt: "A valley of ridges under an evening physical sky, with the far ridges paler than the near ones". | |
| aurora-sky-layer | yes | The file exists and shows green curtains over dark pines, mirrored in the frozen lake. The aurora add-on draws it through the sky-layer call, which the section describes. | |
| multiple-views | yes | The file exists and shows the split layout: the high wide camera on the left, the low camera among the stones on the right. It matches the alt text. | |
| probe-grid-on-off | yes | Both test pages exist (probe-grid-sketch with and without the off switch) and they bake the grid in the browser. With the grid, the spheres and floor take red and green light from the walls. The pictures already exist. | reference: webgpu/probe-grid-off.png, webgpu/probe-grid.png |
| reflection-probes | yes | The file exists and shows the warm room with the cool room through the doorway over a polished floor, with each room's light in the floor. | |
| light-shafts | yes | The file exists and shows sun rays through haze between pine trunks. The demo sets the fog's volumetric option, which the section describes. | |
| time-of-day-presets | yes | The four test pages call timeOfDay with each preset over a row of spheres. All four pictures exist. The blue-hour frame is dark with a red horizon, not blue, so the caption should name each preset. | reference: webgpu/time-of-day-afternoon.png, time-of-day-golden-hour.png, time-of-day-blue-hour.png, time-of-day-night.png |

## Demo links

| Concept | Code | Keep | Verdict |
| --- | --- | --- | --- |
| The physical sky | atmosphere/ | yes | The demo exists (code atmosphere/) and draws the physical sky through timeOfDay's physical model. The page already links it in "Time of day". Add the link under "The physical sky", not again under "Time of day". |
| Time of day | time-of-day/ | no | The demo exists and fits, but "Time of day" already links it. The link adds nothing. |
| Sky layers | aurora/ | yes | The demo has no code value, so aurora/ is right. Its add-on calls setSkyLayer. |
| Multiple views | multiple-views/ | yes | No code value, so the name is right. The sketch calls createView, and the demo switches between split and inset. |
| Reflection probes | reflection-probes/ | yes | Code exists. The sketch creates a reflection probe per room. |
| Volumetric fog | light-shafts/ | yes | Code exists. The sketch sets the fog's volumetric option. |
| The environment | environment/ | yes | No code value, so the name is right. The sketch loads HDR and EXR environments and the sky's environment and lights the spheres with them. |
| Instance batches | instances/ | yes | Code exists. The sketch draws 100,000 columns in one batch. |
| Decals | decals/ | yes | Code exists. The sketch uses decal boxes and setDecalLayers, with a walker on a layer that takes no decals. |

## Concepts said to have no demo

| Concept | No demo? | Finding |
| --- | --- | --- |
| overrideMaterial | wrong | The objects demo (link code objects/) sets the material override from its Look button ("One material"). Reference pictures exist for both states: demo-objects.png and demo-objects-one-material.png. They make a good before-and-after shot for "Drawing every mesh with one material". |
| bakeProbes | right | Only test pages bake probes. No demo uses the light probe grid. |
| scene.find and clone | right | No demo calls scene.find, a copy's find, or scene.clone. Only test pages and the three.js sides of comparisons do. |
| scene limits | right | No demo shows the scene's object room or its growth. The instances demo shows a large batch, but batch rows do not count toward those limits. |
