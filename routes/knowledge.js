const express = require('express');
const db = require('../services/db');
const { initVectorIndex } = require('../services/vectorSearch');

const router = express.Router();

router.get('/', (req, res) => {
  const { type, category } = req.query;
  let sql = 'SELECT id, title, content, type, category, tags FROM knowledge WHERE status = ?';
  const params = ['approved'];
  if (type && type !== 'all') {
    sql += ' AND type = ?';
    params.push(type);
  }
  if (category && category !== 'all') {
    sql += ' AND category = ?';
    params.push(category);
  }
  const stmt = db.prepare(sql);
  const results = stmt.all(...params);
  res.json(results);
});

router.post('/upload', (req, res) => {
  const { title, content, type, category, tags } = req.body;
  if (!title || !content || !type || !category) {
    return res.status(400).json({ error: '标题、内容、专题、类型为必填项' });
  }
  const id = 'KN_' + Date.now();
  const stmt = db.prepare(`
    INSERT INTO knowledge (id, title, content, source, status, tags, type, category, submitted_by, submitted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    id, title, content, 'UGC', 'pending',
    tags ? tags.split(',').map(t => t.trim()).join(',') : '',
    type, category, req.user.username, new Date().toISOString()
  );
  // 重新初始化向量索引（可选）
  initVectorIndex();
  res.json({ success: true, id });
});

module.exports = router;