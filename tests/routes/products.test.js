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
  });

  it.each([
    { limit: "abc" },
    { limit: "-1" },
    { limit: "0" },
    { limit: "1.5" },
    { page: "0" },
    { page: "-2" },
    { page: "abc" },
  ])("rejects %o with 400", async (query) => {
    const { res } = await get(query);
    expect(res.statusCode).toBe(400);
    expect(typeof res.body.error).toBe("string");
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

    const [pageSql, pageParams] = pageQuery();
    expect(pageSql).toMatch(/category = \$\d+/);
    expect(pageParams).toEqual(expect.arrayContaining(["tools"]));

    const [countSql] = countQuery();
    expect(countSql).toMatch(/category = \$\d+/);
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
});
