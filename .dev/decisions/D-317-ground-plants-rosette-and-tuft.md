# D-317: the plant core's ground plants grow as rosettes and tufts of merged foliage, with no wood

Status: decided. The rosette grower (`grow/rosette.ts`), the tuft grower (`grow/tuft.ts`), hosta's
ribbed leaf (`leaf/thick-leaf.ts`) and the grass and sedge blade (`leaf/grass-blade.ts`) are built.
Three test records grow end to end: hosta, pendulous sedge and meadow grass (`grow/ground.fixture.ts`).
Bracken's frond colony is D-316's. Pending: the species packages' own records, fitted to their
references and textures, and the pictures that the plant material draws.
Task: none.

Summary: a ground plant is a crown that is not a stem, with shoots on it and one axis per leaf or
blade. The wood mesher skips it all, so the whole plant draws as merged foliage. Hosta takes 66,256
triangles at the nearest level on the High tier; the sedge 8,642; the meadow grass 32,538. Each
grows in 18 to 23 ms at best on the Mac. The bytes a variant may hold are capped per detail tier.

## Question

How do hosta, pendulous sedge and meadow grass grow, and how do they draw? Each must match its
references up close and from every side. Each must stay within the owner's caps for ground plants.
Those are 200,000 triangles at the nearest level, 30,000 and 8,000 at the card levels, and 150 ms
of growth. The bytes a variant may hold were one figure, 1.5 MB, for every tier.

## Rule

The plant core's design (D-323) gives each growth model its own grower, and a plant of tens of
leaves draws them in the variant's own mesh. The owner capped a ground plant's nearest wood at 0
bytes. The look decides between options that meet the caps. The owner ruled that quality comes
before size, and that the bytes of a variant are capped per detail tier, as the nearest wood is
(D-308). Each tier's cap is the largest measured variant at that tier with about 15 per cent spare.

## Data

The runs: each test record's kit built in Bun with `buildKitNow(module, { placeholders: 'missing' })`,
then `growPlantNow(kit, { seed: 11, variant: 0, near: true })` at the High tier. Growth is the best of
nine growths over variants 0 to 3. The Mac ran at a load average of 55, with other builds and tests
beside the runs. The figures are the test records' at the commit that adds them.

| Plant | Axes | Nearest level | First card level | Second card level | Bytes a variant | Growth, best of 9 |
| --- | --- | --- | --- | --- | --- | --- |
| Hosta | 48 | 66,256 | 5,986 | 1,558 | 1.35 MB | 19 ms |
| Pendulous sedge | 210 | 8,642 | 4,312 | 1,780 | 0.37 MB | 18 ms |
| Meadow grass | 364 | 32,538 | 20,424 | 696 | 1.33 MB | 23 ms |

The median growth was 64 to 106 ms at that load. At first the crown's light took 92 to 165 ms of it.
That is G1's grid of 40 cells across, marched from every cell. A grid of 20 cells across for merged
plants takes 3 ms, at 5 cm cells on a plant one meter across.

The bytes a variant holds, by tier, without the nearest wood: the largest of variants 0 to 3 at seed
11, in summer and in blossom. The oak is G1's grown oak, every variant, in summer.

| Plant | Low | Medium | High | Ultra |
| --- | --- | --- | --- | --- |
| Hosta | 0.44 MB | 1.07 MB | 1.44 MB | 3.30 MB |
| Pendulous sedge | 0.41 MB | 0.45 MB | 0.49 MB | 0.68 MB |
| Meadow grass | 1.35 MB | 1.39 MB | 1.43 MB | 1.55 MB |
| Pedunculate oak | 6.07 MB | 6.09 MB | 6.11 MB | 6.14 MB |

At the Ultra tier the hosta's nearest level takes 175,972 triangles, with four columns a vein in its
ribs. The oak's cards and levels go over the former tree cap of 4 MB at every tier.

## Look

Hosta's look is its ribs: the blade puffs up between curved parallel veins. Its references say a
flat painted leaf misses it. Three options were weighed:

- **The texture's relief alone.** The ribs light, but the silhouette and the margin stay flat.
- **A grid clipped to the outline, with the ribs as height.** It needs about three columns a rib
  across the whole blade, 2,300 triangles a leaf, and aliases where the veins crowd at the tip.
- **A grid of rows up each half and columns out to the margin, with the ribs' height from the vein
  through each vertex.** The grid follows the outline, heart-shaped lobes and all, without cutting
  it. The pleats show in the silhouette and the light. It takes 1,616 triangles a leaf at High.

The third looks best: the pleats stand in the margin's scallops and in grazing light. It is taken.

The meadow grass's blades end in a short blunt hood, its halves rising to meet. The sedge's taper to
a long fine point. Both are geometry, so the tip's shape holds up close.

The flowers, spikelets and spikes are the record's extras on sites that the grower places. That gives
them their own colors: lavender funnels, purple-green spikelets, green spikes that brown. Drawn as
foliage they could only take the leaf texture's green.

## Decision

1. **No wood.** The crown is a parentless root axis. The wood mesher skips it and every axis on it.
   Shoots, leaves, sheaths, stems and branches all draw as merged foliage.
2. **One axis per leaf or blade.** Hosta's axis runs from the crown through the stalk to the
   blade's tip; a blade's runs from its collar to its tip. A terminal bud stands at the blade's base.
   Its frame points +Y along the blade and +Z out of its upper face, and its vigor is the leaf's age.
   The meshers read only the skeleton, so the review's cut pieces mesh as the whole plant does.
   Per-leaf choices hash keys that a cut keeps: each axis's first and last radius, its node count,
   its order and its kind.
3. **The merged foliage's vertex,** agreed with G3 and M1: color bytes are the wind record's high
   and low bytes, the flutter phase and the sky. `uv` is the leaf texture's; `uv1` is the share along
   the leaf from its attach and how far it has browned.
4. **Hosta.** Shoots on a small ring, each a golden-angle spiral of leaves. Tilt, arch, stalk length,
   blade size and the blade's pitch at the stalk's top go by leaf age. The youngest leaves stand
   rolled round their midribs. Autumn collapses and browns the leaves, and a plant that dies back
   keeps only its crown in winter. In the seasons the record names, scapes carry flowers on one side.
5. **Tufts.** Shoots spread over a disc, the outer ones leaning out. Blades leave rising collars in
   two ranks (grasses) or three (sedges), the oldest lowest and widest spread. Each arches over toward
   the ground. A grass's flowering stems carry whorls of branches with spikelets on their outer parts.
   A sedge's three-angled stems bow over and hang spikes on short stalks, with one more at the tip.
6. **Extras' sites.** An extra may take the grower's flower sites (`'flower'`) or the tips of
   flowering stems (`'stem-tip'`). Old wood no longer takes flower sites.
7. **The crown's light.** A merged plant's leaves count in the leaf density, one leaf per blade
   bud. Its grid is 20 cells across.
8. **Bytes a variant, per tier.** `ModelCaps.variantBytes` and `SpeciesBudget.variantBytes` hold one
   figure per detail tier, read at the tier the plant is built for. The figure leaves out the nearest
   wood, which has its own cap. Ground plants: 1.6, 1.6, 1.7 and 3.8 MB from Low to Ultra. Trees:
   7, 7, 7.1 and 7.1 MB, so the oak keeps its cards. Palms stay at 3 MB, with no species measured.
9. **Stand-ins only where missing.** A kit built with `placeholders: 'missing'` grows every built
   stage, and a stand-in only where a stage is not built. That lets these records grow end to end
   before the material and the wind, level and far stages exist.
10. **The lawn's grass stays as it is.** `src/grass/` draws a field of short strips from a hash, on
   the engine's own material. A placed tuft needs ranks, collars, hooded tips and heads that it has
   none of. Nothing of it is shared, so its pictures do not change.

## Consequences

- The species packages for hosta, pendulous sedge and meadow grass copy their record from the test
  records. They fit it to their references and textures. A texture's measured outline replaces
  the parametric one, and its veins set the ribs' count, start and sweep.
- A species' budget gives its own bytes at each tier, under the caps. The per-species test reads
  them at the tier the kit is built for. A new species that goes over a tier's cap brings its figures
  to the owner.
- Spike and spikelet sizes are one per extra; the sedge's spikes do not vary in length.
