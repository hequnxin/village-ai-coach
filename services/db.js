const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// 将 SQL 语句中的 ? 占位符转换为 PostgreSQL 的 $1, $2...
function convertPlaceholders(sql, params) {
  if (!params || params.length === 0) return sql;
  let index = 1;
  return sql.replace(/\?/g, () => `$${index++}`);
}

const db = {
  // 查询多行
  async all(sql, params = []) {
    const convertedSql = convertPlaceholders(sql, params);
    const res = await pool.query(convertedSql, params);
    return res.rows;
  },
  // 查询单行
  async get(sql, params = []) {
    const convertedSql = convertPlaceholders(sql, params);
    const res = await pool.query(convertedSql, params);
    return res.rows[0];
  },
  // 执行更新/插入/删除，返回兼容 better-sqlite3 的格式
  async run(sql, params = []) {
    const convertedSql = convertPlaceholders(sql, params);
    const res = await pool.query(convertedSql, params);
    return { lastID: null, changes: res.rowCount };
  },
  // 直接暴露 pool 实例，以备特殊需求
  pool,
};

module.exports = db;