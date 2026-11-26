# start-substance-24

## Finding as given

- Page: getting-started/hosting, getting-started/cdn, getting-started/network-use
- Anchor: hosting line 49; cdn line 168; network-use line 93 (strict policies)
- Category: duplication. Severity: low.
- Claim: Three pages give three strict policies. The hosting policy has no connect-src, but line 54 explains connect-src, and the Network use policy adds connect-src 'self'. The reader cannot tell which policy is the canonical one.
- Evidence: hosting.md:49 vs network-use.md:93 vs cdn.md:168.
- Proposed edit: Make hosting line 49 the one strict policy, with connect-src 'self'. In Network use, have "Check the claim" link to it instead of repeating it. Keep the CDN policy, and say how it differs.

Verdict: partly

## Evidence

- hosting.md:49 is `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'`. The bullet at hosting.md:54 explains `connect-src`, but says that `default-src 'self'` already covers the engine's own downloads. So the bullet explains a part the policy leaves out on purpose. A reader can still stumble on it: the list reads as a key to the policy above it.
- network-use.md:93 is the same policy plus `connect-src 'self'`. That part changes nothing, because `default-src 'self'` already gives it. network-use.md:96 then says "[Hosting](hosting.md#content-security-policy) gives the full policy". But the Hosting policy is the shorter of the two. This mismatch is the real cost.
- The "cannot tell which is canonical" part does not hold. network-use.md:96 points to Hosting as the full policy. hosting.md:47 says "Send this one, or add its parts to your own".
- The CDN policy (cdn.md:168) is for another setup: an inline script, a `blob:` sketch module, and engine files from a CDN. The bullets at cdn.md:171-174 explain each extra part, and cdn.md:176 links to Hosting. The third policy is not a rival to the first. Hosting has its own CDN policy (hosting.md:86) too, which the finding did not count.
- Network use is a hand-written page. The tool in tools/lib/network-use.ts checks the engine's fetch calls only and does not write this page.

## Corrected claim

Hosting (line 49) and Network use (line 93) give two different policies for the same own-origin case. Network use adds a `connect-src 'self'` that does nothing, and then calls the shorter Hosting policy "the full policy". The Hosting bullet on `connect-src` explains a part that its policy does not hold. The CDN policy is for a different setup, and its page already explains it. It is not a third policy for the same case.

## Corrected edit

Make the two own-origin policies the same. Either add `connect-src 'self'` to hosting.md:49, so that the line 54 bullet explains a part the reader can see, or drop it from network-use.md:93. Adding it to Hosting reads better. Keep the one-line policy in Network use "Check the claim". The check is a test the reader runs, so it needs the exact header on that page. It already links to Hosting for the details. Cutting it would save one line and cost the reader a page jump. Leave cdn.md as it is, or at most add one clause: "This adds the CDN, `blob:` and inline script and style to the [Hosting](hosting.md#content-security-policy) policy."
