/**
 * Tests for GET /api/products pagination.
 * One test per line of SPEC.md's definition of done.
 */

jest.mock("../../src/config/database", () => ({
  query: jest.fn(),
}));

const db = require("../../src/config/database");
const productRoutes = require("../../src/routes/products");

const CATALOGUE = Array.from({ length: 8 }, (_, i) => ({
  id: i + 1,
  name: `Product ${String.fromCharCode(65 + i)}`,
  sku: `SKU-${i + 1}`,
  category: "tools",
  is_active: true,
}));

/** Math.floor(Number.MAX_SAFE_INTEGER / MAX_LIMIT) — the largest page accepted. */
const MAX_PAGE = 90071992547409;

const isCount = (sql) => /count\(\*\)/i.test(sql);
const pageQuery = () => db.query.mock.calls.find(([sql]) => !isCount(sql));
const countQuery = () => db.query.mock.calls.find(([sql]) => isCount(sql));

/** Pull the final GET / handler off the router, skipping optionalAuth. */
function routeHandler(router, method, path) {
  const layer = router.stack.find(
    (l) => l.route && l.route.path === path && l.route.methods[method],
  );
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

const listProducts = routeHandler(productRoutes, "get", "/");

async function get(query = {}) {
  const res = {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  const next = jest.fn();
  await listProducts({ query, headers: {} }, res, next);
  return { res, next };
}

beforeEach(() => {
  db.query.mockImplementation((sql, params = []) => {
    if (isCount(sql)) {
      return Promise.resolve({ rows: [{ count: String(CATALOGUE.length) }] });
    }
    const lim = sql.match(/LIMIT \$(\d+)/i);
    const off = sql.match(/OFFSET \$(\d+)/i);
    const take = lim ? params[Number(lim[1]) - 1] : CATALOGUE.length;
    const skip = off ? params[Number(off[1]) - 1] : 0;
    return Promise.resolve({ rows: CATALOGUE.slice(skip, skip + take) });
  });
});

afterEach(() => {
  jest.clearAllMocks();
});

describe("GET /api/products pagination", () => {
  it("returns exactly `limit` products", async () => {
    const { res } = await get({ page: "1", limit: "2" });
    expect(res.statusCode).toBe(200);
    expect(res.body.products).toHaveLength(2);
  });

  it("responds with products, count, page, limit and total", async () => {
    const { res } = await get({ page: "1", limit: "2" });
    expect(Object.keys(res.body).sort()).toEqual([
      "count",
      "limit",
      "page",
      "products",
      "total",
    ]);
    expect(res.body).toMatchObject({ page: 1, limit: 2, count: 2, total: 8 });
  });

  it("defaults to page 1, limit 20 and still returns every product", async () => {
    const { res } = await get();
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ page: 1, limit: 20, count: 8, total: 8 });
    expect(res.body.products).toHaveLength(8);
  });

  it("clamps a limit above the maximum to 100", async () => {
    const { res } = await get({ limit: "1000" });
    expect(res.statusCode).toBe(200);
    expect(res.body.limit).toBe(100);
    // The echoed limit is not enough on its own: the clamped value has to reach
    // the query, or we answer "limit: 100" while asking Postgres for 1000 rows.
    expect(pageQuery()[1]).toEqual(expect.arrayContaining([100]));
  });

  it("computes the offset from the clamped limit, not the requested one", async () => {
    await get({ page: "3", limit: "1000" });
    const [, params] = pageQuery();
    // Clamped limit 100, so the offset is (3 - 1) * 100 — never (3 - 1) * 1000.
    expect(params).toEqual([100, 200]);
  });

  it("forwards a query failure to next() rather than answering 200", async () => {
    db.query.mockRejectedValue(new Error("connection terminated"));
    const { res, next } = await get();
    expect(next).toHaveBeenCalledTimes(1);
    // Bare next() would fall through to the 404 handler, swallowing the error.
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: "connection terminated" }),
    );
    // `res` starts out at 200, so only an untouched body proves we never replied.
    expect(res.body).toBeUndefined();
  });

  // Failing both queries at once would not catch a `.catch()` on just one of
  // them, which would quietly ship `total: 0` or an empty page with a 200.
  it.each([
    ["count", (sql) => isCount(sql)],
    ["page", (sql) => !isCount(sql)],
  ])("forwards a %s query failure even when the other succeeds", async (
    _side,
    fails,
  ) => {
    const succeed = db.query.getMockImplementation();
    db.query.mockImplementation((sql, params) =>
      fails(sql)
        ? Promise.reject(new Error("connection terminated"))
        : succeed(sql, params),
    );

    const { res, next } = await get();
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: "connection terminated" }),
    );
    expect(res.body).toBeUndefined();
  });

  it.each([
    { limit: "abc" },
    { limit: "-1" },
    { limit: "0" },
    { limit: "1.5" },
    { page: "0" },
    { page: "-2" },
    { page: "abc" },
    // Only an *absent* param falls back to the default; empty is malformed.
    { limit: "" },
    { page: "" },
  ])("rejects %o with 400", async (query) => {
    const { res } = await get(query);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/positive integers/);
  });

  it.each(["1000000000000000000", "100000000000000000000"])(
    "rejects page=%s with 400 instead of overflowing OFFSET",
    async (page) => {
      const { res } = await get({ page });
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/must not exceed/);
      expect(db.query).not.toHaveBeenCalled();
    },
  );

  it("accepts page exactly at the maximum", async () => {
    const { res, next } = await get({ page: String(MAX_PAGE) });
    expect(res.statusCode).toBe(200);
    // `res` starts out at 200, so a thrown query would slip past that alone.
    expect(next).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({
      page: MAX_PAGE,
      limit: 20,
      count: 0,
      total: 8,
    });
  });

  it("rejects the first page past the maximum", async () => {
    const { res } = await get({ page: String(MAX_PAGE + 1) });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/must not exceed/);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("returns an empty page past the end, with the real total", async () => {
    const { res } = await get({ page: "99", limit: "20" });
    expect(res.statusCode).toBe(200);
    expect(res.body.products).toEqual([]);
    expect(res.body.count).toBe(0);
    expect(res.body.total).toBe(8);
  });

  it("still filters by category, and counts only the filtered set", async () => {
    const { res } = await get({ category: "tools", limit: "1000" });
    expect(res.body.limit).toBe(100);

    // A filter param precedes LIMIT/OFFSET here, so hardcoded $1/$2 misbind and
    // the page comes back wrong — only asserting the body catches that.
    expect(res.body.products).toHaveLength(8);

    const [pageSql, pageParams] = pageQuery();
    expect(pageSql).toMatch(/category = \$\d+/);
    expect(pageSql).toMatch(/is_active = true/);
    expect(pageParams).toEqual(expect.arrayContaining(["tools"]));

    // The count has to filter identically, or `total` counts rows the page excludes.
    const [countSql, countParams] = countQuery();
    expect(countSql).toMatch(/category = \$\d+/);
    expect(countSql).toMatch(/is_active = true/);
    expect(countParams).toEqual(["tools"]);
  });

  it("binds limit and offset as parameters, never inlined", async () => {
    await get({ page: "3", limit: "5" });
    const [sql, params] = pageQuery();
    expect(sql).toMatch(/LIMIT \$\d+/i);
    expect(sql).toMatch(/OFFSET \$\d+/i);
    expect(sql).not.toMatch(/LIMIT\s+\d/i);
    expect(sql).not.toMatch(/OFFSET\s+\d/i);
    expect(params).toEqual(expect.arrayContaining([5, 10]));
  });

  it("sorts on a unique tiebreaker so pages cannot repeat or skip rows", async () => {
    await get({ page: "2", limit: "2" });
    const [sql] = pageQuery();
    expect(sql).toMatch(/ORDER BY\s+name\s*,\s*id/i);
    // Position matters: ORDER BY after LIMIT is a syntax error the regex misses.
    expect(sql.indexOf("ORDER BY")).toBeLessThan(sql.indexOf("LIMIT"));
  });
});
