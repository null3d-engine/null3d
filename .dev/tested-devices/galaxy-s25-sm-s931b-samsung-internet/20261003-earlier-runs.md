Plans: smoke 2026-10-03;
smoke 2026-10-04 (Automate);
smoke 2026-10-05, twice, from the M2-L9 branch;
smoke 2026-10-05, from the M2-L9 branch again;
the 21 shadow image tests 2026-10-07 on main 80a97ab51, with 16-bit and with 32-bit cascades

Result: smoke 2026-10-04: did not start, twice.
smoke 2026-10-03: 46 passed, and the same 4 WebGL2 pages failed as in Chrome, with the same figures smoke 2026-10-05: did not start, twice (runs 20261005-002120-smoke, 20261005-002218-smoke): the page read visible after a switch to its window, but still got no animation frames smoke 2026-10-05, third try: 51 of 51 (run 20261005-025410-smoke); the page was not reported hidden in that session.
Shadow image tests 2026-10-07: 22 of 22 with 16-bit cascades, and 22 of 22 with 32-bit cascades (runs 20261007-033205-checks, 20261007-034206-checks).
