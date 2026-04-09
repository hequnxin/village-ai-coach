// routes/knowledge.js
const express = require('express');
const db = require('../services/db');
const { initVectorIndex } = require('../services/vectorSearch');
const router = express.Router();

router.get('/', async (req, res) => {
  const { type, category } = req.query;
  let sql = 'SELECT id, title, content, type, category, tags FROM knowledge WHERE status = $1';
  const params = ['approved'];
  if (type && type !== 'all') {
    sql += ' AND type = $2';
    params.push(type);
  }
  if (category && category !== 'all') {
    sql += ' AND category = $3';
    params.push(category);
  }
  const results = await db.all(sql, params);
  res.json(results);
});

router.get('/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: '请输入关键词' });
  const keyword = `%${q}%`;
  // 修复：使用 $1, $2, $3 而不是 ?
  const sql = `SELECT * FROM knowledge WHERE status = $1 AND (title LIKE $2 OR content LIKE $3)`;
  const results = await db.all(sql, ['approved', keyword, keyword]);
  res.json(results);
});

router.post('/upload', async (req, res) => {
  const { title, content, type, category, tags } = req.body;
  if (!title || !content || !type || !category) {
    return res.status(400).json({ error: '标题、内容、专题、类型为必填项' });
  }
  const id = 'KN_' + Date.now();
  const tagsStr = tags ? tags.split(',').map(t => t.trim()).join(',') : '';
  await db.run(
    `INSERT INTO knowledge (id, title, content, source, status, tags, type, category, submitted_by, submitted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [id, title, content, 'UGC', 'pending', tagsStr, type, category, req.user.username, new Date().toISOString()]
  );
  await initVectorIndex();
  res.json({ success: true, id });
});

module.exports = router;