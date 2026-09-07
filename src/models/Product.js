const db = require("../config/database");

/**
 * Build the shared WHERE clause so findAll() and count() always filter
 * on exactly the same conditions.
 */
function buildFilters({ category, activeOnly = true } = {}) {
  const params = [];
  const conditions = [];

  if (activeOnly) {
    conditions.push("is_active = true");
  }
  if (category) {
    params.push(category);
    conditions.push(`category = $${params.length}`);
  }

  const where =
    conditions.length > 0 ? " WHERE " + conditions.join(" AND ") : "";
  return { where, params };
}

async function findAll({ category, activeOnly = true, limit, offset } = {}) {
  const { where, params } = buildFilters({ category, activeOnly });
  // `name` is not unique, so it alone is not a stable sort: without the `id`
  // tiebreaker rows can repeat or be skipped across pages.
  let sql = `SELECT * FROM products${where} ORDER BY name, id`;

  if (limit != null) {
    params.push(limit);
    sql += ` LIMIT $${params.length}`;
  }
  if (offset != null) {
    params.push(offset);
    sql += ` OFFSET $${params.length}`;
  }

  const { rows } = await db.query(sql, params);
  return rows;
}

async function count({ category, activeOnly = true } = {}) {
  const { where, params } = buildFilters({ category, activeOnly });
  const { rows } = await db.query(
    `SELECT COUNT(*) as count FROM products${where}`,
    params
  );
  return parseInt(rows[0].count, 10);
}

async function findById(id) {
  const { rows } = await db.query("SELECT * FROM products WHERE id = $1", [id]);
  return rows[0] || null;
}

async function findBySku(sku) {
  const { rows } = await db.query("SELECT * FROM products WHERE sku = $1", [
    sku,
  ]);
  return rows[0] || null;
}

async function updateStock(productId, quantityDelta) {
  const { rows } = await db.query(
    `UPDATE products
     SET stock = stock + $1, updated_at = NOW()
     WHERE id = $2 AND stock + $1 >= 0
     RETURNING *`,
    [quantityDelta, productId]
  );
  return rows[0] || null;
}

module.exports = { findAll, count, findById, findBySku, updateStock };
