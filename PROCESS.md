# PROCESS — Pagination for GET /api/products

Single agent, one file at a time. The route calls the `findAll()` signature the
model changes, so the two files were never independent.

Review was serial too: five specs-reviewer rounds until it passed, then four
test-auditor rounds, fixes in between.

Right call. The two reviewers could have run in parallel since they read the same
diff, but at four files that was never the bottleneck.

## Commits

- `ccc512b` CI + agents tracked
- `2ef5a15` fixed a stale `PLAN.md` reference in specs-reviewer
- `05545f7` SPEC.md, before any code
- `c837d37` failing tests, 14 red with the existing 44 still green
- `dd4ccca` implementation, 69 green

Branch `feature/product-pagination`. No squash or amend.

## Prompts

Planning:

> Plan the implemntation for the Product pagination for GET /api/products. Follow
> @SPEC.md and @tests/routes/products.test.js, stay inside the decision of
> SPEC.md and the products.test.js.

Pointing at the files instead of restating them kept it on the *how*.

Review, five times unchanged:

> @"specs-reviewer (agent)" review the staged diff agains @SPEC.md

Then this one, which I added mid-run:

> @"test-auditor (agent)" review the staged test file. Don't silently update if
> FAILED, show the result first.

Fixes were arriving already folded into the report, so I couldn't see what I was
agreeing to. After this every round was verdict → I pick → fix. `Fix the 2 MEDs.`
`Only the MED.` I declined two LOWs, brittleness to future refactors rather than
coverage gaps.

Nine rounds. Six FAIL, three PASS.

## What Claude got wrong

**1. Sorting by name alone can lose products.** `src/models/Product.js:26`, MED.

Two products can share a name. Only `sku` is unique. Sort by name only and the
database can order them differently on each query, and every page is its own
query, so a product lands on two pages or none. Harmless before, when the
endpoint returned everything at once. Fixed with `ORDER BY name, id`.

Rated MED. I took it as HIGH, since losing rows silently is a correctness bug. In
scope even though I didn't write that line: my change is what broke it.

**2. The reviewer's own reasoning was wrong, twice.** `src/routes/products.js:8`, LOW.

It said the page cap was about Postgres number limits. JavaScript loses accuracy
long before Postgres would care. Then it said the cap sits exactly where numbers
break, when it is two pages short of that. One command to check each. I stopped
taking the agents at their word after the first.