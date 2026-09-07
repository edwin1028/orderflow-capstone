# SPEC — Pagination for GET /api/products

## Problem
GET /api/products returns every active product in a single response. The result
set is unbounded and grows with the catalogue.

## Files changed, in order
1. src/models/Product.js — findAll() accepts { limit, offset }; add a count query
2. src/routes/products.js — parse, validate and clamp ?page & ?limit; new response shape
3. tests/routes/products.test.js — NEW

## Decisions

- **`count`remains unchanged** — products returned in the current response. Add `total` for the full number of matching products.
- **`total` uses a separate `COUNT(*)` query.** avoids leaking a window-count field into product objects.
- **Pagination limits: DEFAULT_LIMIT = 20, MAX_LIMIT = 100.** to prevent unbounded public requests.
- **Validation behavior: Over-max clamps, malformed rejects.** `limit=1000` → 100. Absent → the default; present but not a positive integer — including empty (`?limit=`) → 400.
- **Page ceiling: MAX_PAGE = ⌊Number.MAX_SAFE_INTEGER / MAX_LIMIT⌋ = 90071992547409.**
  `offset = (page - 1) * limit` is computed in JavaScript and must stay exactly
  representable; a large enough offset loses precision, and from `1e21` upward
  stringifies in exponential form, which Postgres rejects as a 500. The ceiling is
  a conservative worst-case bound assuming `limit = MAX_LIMIT`, not the exact
  precision cliff — one constant that holds at every limit. Over it → 400.
- **Ordering: `ORDER BY name, id`.** `name` has no UNIQUE constraint, so it alone is not a total order — under real Postgres rows with duplicate names can repeat or be skipped across pages. The `id` tiebreaker makes paging stable.

## Definition of done
- [ ] `?page=1&limit=2` returns exactly 2 products
- [ ] Response is `{ products, count, page, limit, total }`
- [ ] No params → page 1, limit 20; existing callers keep working
- [ ] `limit=1000` → clamped to 100, HTTP 200
- [ ] `limit=abc`, `limit=-1`, `limit=0`, `page=0` → 400 in the existing error shape
- [ ] Page past the end → empty `products`, `count: 0`, correct `total`, HTTP 200
- [ ] `?category=` still filters and composes with pagination
- [ ] Non-integer, zero or negative `page`/`limit` → 400 in the existing error shape
      (covers limit=abc, limit=-1, limit=0, limit=1.5, page=0, page=-2, page=abc)
- [ ] `page` above MAX_PAGE → 400 in the existing error shape, not a 500
- [ ] `page = MAX_PAGE` → 200 returning a normal page body; `page = MAX_PAGE + 1` → 400
- [ ] Empty `?limit=` / `?page=` → 400; only an *absent* param falls back to the default
- [ ] Page query sorts on `name, id`, so pages cannot repeat or skip rows
- [ ] All SQL stays parameterised ($1, $2…); no interpolation
- [ ] The existing 44 tests still pass

## Out of scope
- The SQL injection in src/routes/search.js (pre-existing; separate PR)
- Pagination on any other endpoint

## Verification
- `npm test -- tests/routes/products.test.js`
- `npm test`
