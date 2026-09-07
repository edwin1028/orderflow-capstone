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
- **Validation behavior: Over-max clamps, malformed rejects.** `limit=1000` → 100, malformed or invalid values reject with `400 (limit=abc, page=0)`.

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
- [ ] All SQL stays parameterised ($1, $2…); no interpolation
- [ ] The existing 44 tests still pass

## Out of scope
- The SQL injection in src/routes/search.js (pre-existing; separate PR)
- Pagination on any other endpoint

## Verification
- `npm test -- tests/routes/products.test.js`
- `npm test`
