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

  // 确保 weekly_contest_attempts 表存在
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

  // 清理 daily_quiz_questions 中无效的外键（指向不存在的题目）
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
  const linkCount = await db.get(`SELECT COUNT(*) as c FROM game_level_questions`);
  if (linkCount.c === 0) {
    console.log('⚠️ 游戏关卡无题目，重新关联...');
    const initGameData = require('./initGameData');
    await initGameData();
  } else {
    console.log(`✅ 游戏关卡已有 ${linkCount.c} 条关联，跳过`);
  }
}

(async () => {
  console.log('🔍 检查数据库初始化状态...');
  let retries = 5;
  let initialized = false;

  while (retries > 0 && !initialized) {
    try {
      await db.get('SELECT 1');
      console.log('✅ 数据库连接成功');

      // 无论表是否存在，都先创建缺失的表和清理无效数据
      await ensureMissingTables();

      // 检查关键表
      const themesExist = await tableExists('game_themes');
      const quizExist = await tableExists('quiz_questions');

      if (!themesExist || !quizExist) {
        console.log('⚠️ 缺失关键表，执行完整初始化...');
        const initDb = require('./initDb');
        await initDb();
        const importKnowledge = require('./importKnowledge');
        await importKnowledge();
      } else {
        // 修复题目数量不足的问题
        await fixQuizQuestions();
        // 修复关卡题目关联
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