const express = require("express");
const router = express.Router();
const Product = require("../models/Product");
const { optionalAuth } = require("../middleware/auth");

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
// Keeps (page - 1) * limit inside the safe integer range. Without a ceiling the
// bound OFFSET loses integer precision and, from 1e21 upward, stringifies in
// exponential form, which Postgres rejects — surfacing as a 500, not a 400.
// A conservative worst-case bound assuming limit = MAX_LIMIT, not the exact
// precision cliff, so the one constant holds at every limit.
const MAX_PAGE = Math.floor(Number.MAX_SAFE_INTEGER / MAX_LIMIT);

/**
 * Parse a positive-integer query param.
 * Returns `fallback` when absent, or null when malformed
 * (non-integer, negative or zero).
 */
function parsePositiveInt(value, fallback) {
  if (value === undefined) {
    return fallback;
  }
  if (!/^\d+$/.test(String(value))) {
    return null;
  }
  const parsed = parseInt(value, 10);
  return parsed >= 1 ? parsed : null;
}

/**
 * GET /api/products
 * List active products, one page at a time.
 * Optional ?category= filter. ?page= and ?limit= paginate;
 * limit defaults to 20 and is clamped to 100.
 */
router.get("/", optionalAuth(), async (req, res, next) => {
  try {
    const { category } = req.query;

    const page = parsePositiveInt(req.query.page, 1);
    const requestedLimit = parsePositiveInt(req.query.limit, DEFAULT_LIMIT);
    if (page === null || requestedLimit === null) {
      return res.status(400).json({
        error: "page and limit must be positive integers",
      });
    }
    if (page > MAX_PAGE) {
      return res.status(400).json({
        error: `page must not exceed ${MAX_PAGE}`,
      });
    }

    const limit = Math.min(requestedLimit, MAX_LIMIT);
    const offset = (page - 1) * limit;

    const [products, total] = await Promise.all([
      Product.findAll({ category, limit, offset }),
      Product.count({ category }),
    ]);

    res.json({ products, count: products.length, page, limit, total });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/products/:id
 */
router.get("/:id", async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }
    res.json({ product });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
