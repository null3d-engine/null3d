# guides-2-substance-11

## Finding as given

- page: guides/performance, guides/phones
- anchor: performance line 157 and phones line 85 (object tables); performance lines 224-227 and phones lines 79-81, 105 (texture budget, KTX2, cache of derived data)
- category: duplication
- severity: medium
- claim: Both pages carry the same facts about memory: object tables doubling (16,383 to 32,767, 2.4 to 5.3 ms, expectedObjects), the texture budget, KTX2 at a quarter or an eighth, and the cache of derived data with its S6 figures. Each copy has different detail.
- evidence: performance.md:157,224-227; phones.md:79-81,85,105.
- proposedEdit: Keep texture memory and KTX2 on phones and object tables on performance. Each page links to the other in one line.

Verdict: partly

## Evidence

- Object tables: real duplicate. performance.md:157 gives the start size (1,023), the growth rule, 1 ms on a MacBook Pro, 2.4 to 5.3 ms on a Galaxy S25 and a Pixel 9, and `expectedObjects`. phones.md:85 repeats the phone figure and `expectedObjects`. The numbers agree.
- Texture budget: both pages explain that the engine drops the largest mip levels and loads them again (performance.md:224, phones.md:79). phones.md:79 adds the 5.3 MiB example and points to the budget sizes in phones.md:67. Real overlap.
- KTX2: both pages say "load large textures from KTX2 files" with the same CLI command (performance.md:226, phones.md:81). performance.md says "a quarter or an eighth". phones.md does not use those words; it gives 1.3 MiB and 0.7 MiB against 5.3 MiB, plus ASTC/ETC2, mip levels, UASTC/ETC1S and `texture.format`. Same fact, different detail.
- Cache of derived data: the claim is wrong here. Only performance.md:227 has the S6 figures (50% sooner on an iPad Pro, about 6% on phones). phones.md:105 says only that the cache "saves less time than on a tablet". It has no S6 figures.
- Links that exist already: performance.md:200 says "[Phones and tablets](phones.md) covers texture memory". phones.md:77 links to performance.md#memory-peak, and phones.md:137 lists the Performance guide. So part of the "each page links to the other" edit is done.
- Problem with the proposed edit: the Performance guide serves every device. Texture budgets exist on desktop presets too, and the S6 cache figures compare a tablet with phones, so they are not phone-only. Moving all of "Textures and memory" off performance.md would send desktop readers to a page titled "Phones and tablets" for a general topic.
- Cost to a reader: the copies agree, so nobody is misled. The cost is extra reading and a risk that the figures drift apart later. Medium is at the top of what this deserves; low to medium is fairer.

## Corrected claim

Both pages repeat the object-table growth figures and `expectedObjects` (performance.md:157, phones.md:85). They also repeat the texture budget's mip-dropping behavior and the advice to load KTX2 files (performance.md:224-226, phones.md:79-81). Both mention the cache of derived data, but only performance.md:227 gives the S6 figures; phones.md:105 gives a one-sentence summary. The copies agree, so the cost is repetition and later drift, not a wrong fact.

## Corrected edit

- Object tables: keep the full bullet on performance.md:157. In phones.md:85, keep one sentence with the phone figure and `expectedObjects`, and link to [Objects during play](performance.md#objects-during-play) for the rest. Or cut it to that link.
- Textures: keep a short "Textures and memory" section on performance.md, because the budget applies to every device: one sentence on the budget and `quality.textureMemory`, one on KTX2 ("a quarter or an eighth"), then a link to [Phones and tablets: memory](phones.md#memory) for the phone formats, sizes and encoding advice. Keep the full KTX2 detail (ASTC/ETC2, mip levels, UASTC/ETC1S, `texture.format`) on phones.md:81.
- Cache of derived data: keep the S6 figures on performance.md:227. In phones.md:105, keep the one-sentence summary and add a link to performance.md#textures-and-memory for the figures. Do not move the figures to phones.md.
