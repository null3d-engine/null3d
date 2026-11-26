# Verdict: api-3-readability-30

## Finding as given

- page: api/scene
- anchor: lines 140-202
- category: example-placement
- severity: low
- claim: The analytic sky table is at line 160, but its moving-sun example (lines 186-202) comes after the second-sky table, which it does not show. The environment example at line 140 calls setEnvironment, which the page explains only at line 327.
- evidence: line 179 'Two more settings add a second sky'; line 195 'The sun rises and sets, and the clouds drift with the sketch's time.'
- proposedEdit: Move the moving-sun example to just after the analytic sky table, before 'Two more settings add a second sky'. In the line 140 example, add a comment that links ahead to The environment, or keep a background-only example there and move the setEnvironment one under '## The environment'.

Verdict: partly

## Evidence

- Moving-sun example: holds. The analytic sky table is at docs/api/scene.md:160-175, then the cloud-tier paragraph at :177, then the second-sky lead-in and table at :179-184. The example at :186-202 sets only `sunPosition`, `turbidity`, `rayleigh` and `time`, all from the first table. It sets neither `secondSunPosition` nor `secondSkyWeight`. A reader who meets it straight after the second-sky table can think it shows the second sky.
- setEnvironment in the line 140 example: weak. The call is at :145, and the prose at :158 already says "The background and `setEnvironment` are separate: a scene can show one environment and take its light from another." So the page does explain its role near the example. What is missing is a link to "The environment" (:327). The example's point is that one environment serves as both the light and the background. Moving the setEnvironment call under "## The environment" (the second option in the proposed edit) would remove that point. A link inside a code comment is also not clickable on the website, so prose is the better place for it.

## Corrected claim

The moving-sun example at lines 186-202 uses only first-sky settings but comes after the second-sky table, so it reads as if it showed the second sky. The setEnvironment call at line 145 is explained in line 158, but that sentence does not link to "The environment" section.

## Corrected edit

1. Move the moving-sun example (lines 186-202) to follow the cloud-tier paragraph at line 177, before "Two more settings add a second sky".
2. Keep the setEnvironment call in the line 140 example. In line 158, link the name: "The background and [`setEnvironment`](#the-environment) are separate: ...". Do not move the example under "## The environment".
