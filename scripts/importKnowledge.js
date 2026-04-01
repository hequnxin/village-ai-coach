const Database = require('better-sqlite3');
const path = require('path');
const knowledgeData = require('../knowledge.json'); // 根据实际路径调整

const dbPath = path.join(__dirname, '../data/village.db');
const db = new Database(dbPath);

const insertStmt = db.prepare(`
  INSERT INTO knowledge (id, title, content, source, status, tags, type, category, submitted_by, submitted_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

let count = 0;
knowledgeData.forEach(k => {
  // 将 tags 数组转为逗号分隔的字符串
  const tagsStr = Array.isArray(k.tags) ? k.tags.join(',') : k.tags;
  try {
    insertStmt.run(
      k.id,
      k.title,
      k.content,
      k.source,
      k.status,
      tagsStr,
      k.type,
      k.category,
      k.submittedBy || 'system',
      k.submittedAt
    );
    count++;
  } catch (err) {
    console.error(`导入失败 ${k.id}: ${err.message}`);
  }
});

console.log(`✅ 导入完成，共 ${count} 条知识`);
db.close();