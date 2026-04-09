// scripts/ensureDbInit.js
const db = require('../services/db');
const { v4: uuidv4 } = require('uuid');

async function tableExists(tableName) {
  const res = await db.get(
    "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)",
    [tableName]
  );
  return res.exists;
}

async function ensureMissingTables() {
  console.log('🔧 检查并创建缺失的表...');

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
  console.log('✅ weekly_contest_attempts 表已确保存在');

  await db.run(`
    DELETE FROM daily_quiz_questions 
    WHERE question_id NOT IN (SELECT id FROM quiz_questions)
  `);
  console.log('✅ 清理了无效的每日一练题目关联');
}

async function fixQuizQuestions() {
  const count = await db.get(`SELECT COUNT(*) as c FROM quiz_questions WHERE type = 'choice'`);
  if (count.c < 10) {
    console.log(`⚠️ 选择题数量不足 (${count.c})，重新生成...`);
    const { generateAndStoreQuestions } = require('./questionGenerator');
    await generateAndStoreQuestions(50);
  } else {
    console.log(`✅ 已有 ${count.c} 道选择题，跳过生成`);
  }
}

async function fixLevelQuestions() {
  // 强制重建关联：删除所有现有关联，重新生成
  console.log('⚠️ 强制重建游戏关卡题目关联...');
  await db.run(`DELETE FROM game_level_questions`);
  // 确保 quiz_questions 有 theme 和 difficulty
  await db.run(`UPDATE quiz_questions SET theme = category, difficulty = 1 WHERE theme IS NULL`);
  const initGameData = require('./initGameData');
  await initGameData();
  console.log('✅ 游戏关卡题目关联重建完成');
}

(async () => {
  console.log('🔍 检查数据库初始化状态...');
  let retries = 5;
  let initialized = false;

  while (retries > 0 && !initialized) {
    try {
      await db.get('SELECT 1');
      console.log('✅ 数据库连接成功');

      await ensureMissingTables();

      const themesExist = await tableExists('game_themes');
      const quizExist = await tableExists('quiz_questions');

      if (!themesExist || !quizExist) {
        console.log('⚠️ 缺失关键表，执行完整初始化...');
        const initDb = require('./initDb');
        await initDb();
        const importKnowledge = require('./importKnowledge');
        await importKnowledge();
      } else {
        await fixQuizQuestions();
        // 强制重建关卡关联（不再判断是否为空）
        await fixLevelQuestions();
      }

      console.log('✅ 数据库准备就绪');
      initialized = true;
      break;
    } catch (err) {
      console.error(`❌ 检查/初始化失败 (剩余重试 ${retries-1}):`, err.message);
      retries--;
      if (retries === 0) {
        console.error('❌ 数据库初始化多次失败，退出进程');
        process.exit(1);
      }
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  await db.pool.end();
  process.exit(0);
})();