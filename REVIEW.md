# REVIEW — Pagination for GET /api/products

SPECS pass over the final diff (`dd4ccca`): `SPEC.md`, `src/models/Product.js`,
`src/routes/products.js`, `tests/routes/products.test.js`.

## S — Security

**Inputs.** `page` and `limit` are untrusted strings, and the endpoint is public
(`optionalAuth()`, no token required). Both go through `parsePositiveInt` at the
route boundary, before any query runs. It rejects anything that isn't digits, so
negatives, decimals, empty strings and non-numeric values all return 400.
`limit` is clamped to 100 before the offset is computed, so `?page=3&limit=1000`
gives `OFFSET 200`, not 2000. All values reach SQL as `$N` parameters, including
in the new `count()`. The tests assert both that `LIMIT $n` and `OFFSET $n` are
present and that no digits are inlined.

**Authorisation.** Unchanged. Public before, public now. No row is exposed that
the existing `is_active = true` filter didn't already return, and no field is
added to the payload. `count()` reuses the same `buildFilters()` as `findAll()`,
so `total` cannot count rows the page excludes.

**New attack surface.**

1. Unbounded public requests. Before this change a caller could pull the whole
   table in one response. `MAX_LIMIT = 100` bounds it.
2. Server errors from user input. `specs-reviewer` found at
   `src/routes/products.js:44` that nothing capped `page`, so
   `?page=100000000000000000000` made Postgres throw and `errorHandler` returned
   a 500 carrying the raw driver message. `MAX_PAGE` turns it into a 400, and the
   tests assert `db.query` never runs.

Error bodies name the constraint and nothing else, matching the existing shape at
`src/routes/users.js:40`.

**Not fixed here.** `src/routes/search.js` interpolates `table` and `query`
straight into SQL, with `ALLOWED_TABLES` declared but never checked. It predates
this change and is unrelated to pagination, so fixing it here would be a
drive-by. Out of scope in SPEC.md, raised separately.

## P — Patterns

routes → models, unchanged. `buildFilters()` was extracted so `findAll()` and
`count()` cannot drift apart. Tests mock `src/config/database` and call the unit
directly, matching `tests/services/userService.test.js`. No new dependency, no
`console.log`.

## E — Edge cases

Covered: the page ceiling and one past it, empty versus absent params, a page
past the end, the clamp combined with `?category=`, and error forwarding when
either query fails on its own.

Not covered: the test mock slices a JavaScript array, so it cannot reproduce the
repeat/skip behaviour that `ORDER BY name, id` fixes. That one is checked
structurally instead, by asserting the sort columns and that `ORDER BY` comes
before `LIMIT`.

## C — Context

Every line of SPEC.md's definition of done has a test, except "the existing 44
tests still pass", which the suite total covers. `MAX_PAGE` and `ORDER BY name,
id` were both found during implementation and written back into SPEC.md rather
than shipped undocumented. `README.md` still describes the old unpaginated
response.

## S — Simplicity

The response is the five documented fields and nothing else, asserted with an
exact key match so extra fields fail the suite. `MAX_PAGE` is a literal in the
tests rather than imported from the route, so a change to `MAX_LIMIT` breaks a
test instead of silently moving the boundary with it.

## Result

`npm test`: 69 pass, 8 suites. 44 existing, 25 new.
