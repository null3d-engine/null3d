# D-345: The showroom's tablet rate and its look

Status: decided by the owner. Both clauses are met: the rate by dynamic resolution and the look by
the owner's approval. Task: M3-C2.

Summary: the Showroom to street demo's rate clause asks for 60 frames a second on the tablet. Its
studio view is the heavy one, and the engine's quality governor lowers the render scale until the
frame fits. The owner ruled that dynamic resolution is the mechanism the clause is read against,
with no change to the demo or the engine.

## Question

The showroom at Low on the iPad Pro 13 reads 47.6 to 47.8 frames a second in its opening seconds
against the 60 target. Is the clause met by lowering the render scale, by cutting the scene's draw,
or by accepting the recorded rate?

## Rule

- The rate is held by dynamic resolution. The engine's governor lowers the render scale one
  twentieth at a time and waits for a judged second and a settle second after each step; the demo
  asks for nothing of its own.
- Steady play at the lowered scale holds 60. The opening seconds read 45 to 50 while the governor
  walks down, which takes about ten seconds.
- The time outside the engine's passes is the browser's presentation of the canvas. It is on a page
  that draws one triangle, so no change to the demo removes it.
- No picture moves for this ruling, and no engine or demo code changes with it.

## The look
The owner ruled that the showroom's look stands. The car, its paint's flakes and its clear coat are
approved as the demo draws them, so the look clause is met. The approval joins the rate ruling here.

## Data

Session one, run `20261111-180918-showroom-fps`: the studio view at the whole render scale reads 45
to 46 frames a second with 15.95 ms of GPU passes; the governor's five-second windows read 48.5 to
50.5 and end between 0.75 and 0.85; a fixed 0.75 scale holds 59.2 with 10.84 ms of passes; a
15-second window at 0.85 reads 59.8. The time outside the passes is 5.07 to 5.51 ms on the studio
pages and 4.7 to 7.8 across the session.

Session two, run `20261111-182001-showroom-fps`: the car had left the studio and the view cost about
half; the whole render scale itself held 60 after settling, with 0.85 also at 60, and the lower
scale saved only 1.8 ms of that street view.

The Mac's rows, 108.0 and 106.2 frames a second at Low, and the Galaxy S24's 29.4 of its 30 Hz cap,
stand as the evidence records them. Both sessions are in
`.dev/tested-devices/ipad-pro-13-safari/`.

## Consequences

- The clause is judged in steady play. The first ten seconds after the start run below 60 while the
  governor steps down; a faster walk is the only engine change that would shorten it, and it is not
  made.
- Cutting the studio view's draw would meet 60 at the whole scale but move its pictures. The owner
  chose this route over that one.
- The look's answer is recorded above; C2's two clauses are both met.
