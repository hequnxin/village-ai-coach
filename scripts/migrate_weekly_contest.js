// scripts/migrate_weekly_contest.js
require('dotenv').config();
const db = require('../services/db');

async function migrate() {
  console.log('开始迁移：每周竞赛多次参赛支持...');
  try {
    // 创建参赛记录表
    await db.run(`
      CREATE TABLE IF NOT EXISTS weekly_contest_attempts (
        id TEXT PRIMARY KEY,
        contest_id TEXT REFERENCES weekly_contest(id) ON DELETE CASCADE,
        user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        attempt_number INTEGER NOT NULL,
        score INTEGER NOT NULL,
        total_questions INTEGER NOT NULL,
        time_used INTEGER NOT NULL,
        submitted_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(contest_id, user_id, attempt_number)
      )
    `);
    console.log('✅ 表 weekly_contest_attempts 创建成功');

    // 迁移旧数据（如果存在）
    const oldScores = await db.all(`
      SELECT contest_id, user_id, score, time_used, submitted_at 
      FROM weekly_contest_scores
    `);
    for (let old of oldScores) {
      // 获取总题数
      const contest = await db.get(`SELECT questions FROM weekly_contest WHERE id = $1`, [old.contest_id]);
      let total = 0;
      if (contest) {
        try { total = JSON.parse(contest.questions).length; } catch(e) { total = 0; }
      }
      await db.run(`
        INSERT INTO weekly_contest_attempts (id, contest_id, user_id, attempt_number, score, total_questions, time_used, submitted_at)
        VALUES ($1, $2, $3, 1, $4, $5, $6, $7)
        ON CONFLICT DO NOTHING
      `, [require('uuid').v4(), old.contest_id, old.user_id, old.score, total, old.time_used, old.submitted_at]);
    }
    console.log('✅ 旧数据迁移完成');

    // 可选：删除旧表（谨慎，可保留）
    // await db.run(`DROP TABLE IF EXISTS weekly_contest_scores`);
    console.log('迁移完成');
  } catch (err) {
    console.error('迁移失败:', err);
  } finally {
    await db.pool.end();
  }
}

migrate();