require('dotenv').config();
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

  // 确保 user_theme_progress 表存在
  await db.run(`
    CREATE TABLE IF NOT EXISTS user_theme_progress (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      theme_id TEXT REFERENCES game_themes(id) ON DELETE CASCADE,
      completed INTEGER DEFAULT 0,
      completed_at TIMESTAMPTZ,
      UNIQUE(user_id, theme_id)
    )
  `);
  console.log('✅ user_theme_progress 表已确保存在');

  // 确保 simulate_mistakes 表存在
  await db.run(`
    CREATE TABLE IF NOT EXISTS simulate_mistakes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      mistake_text TEXT NOT NULL,
      scenario_id TEXT,
      created_at TIMESTAMPTZ NOT NULL
    )
  `);
  console.log('✅ simulate_mistakes 表已确保存在');

  // 确保 daily_tasks 表存在
  await db.run(`
    CREATE TABLE IF NOT EXISTS daily_tasks (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      task_date DATE NOT NULL,
      task_data JSONB NOT NULL,
      completed BOOLEAN DEFAULT FALSE,
      reward_claimed BOOLEAN DEFAULT FALSE,
      UNIQUE(user_id, task_date)
    )
  `);
  console.log('✅ daily_tasks 表已确保存在');

  // 清理无效的每日一练题目关联
  await db.run(`
    DELETE FROM daily_quiz_questions
    WHERE question_id NOT IN (SELECT id FROM quiz_questions)
  `);
  console.log('✅ 清理了无效的每日一练题目关联');

  // 为 messages 表添加 status 字段
  try {
    await db.run(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending'`);
    console.log('✅ messages.status 字段已确保存在');
  } catch (err) {
    console.warn('⚠️ 添加 status 列失败:', err.message);
  }

  // 确保 messages.content 字段类型为 TEXT（避免长度限制）
  try {
    await db.run(`ALTER TABLE messages ALTER COLUMN content TYPE TEXT`);
    console.log('✅ messages.content 字段类型已确保为 TEXT');
  } catch (err) {
    console.warn('⚠️ 修改 content 类型失败（可能已为 TEXT）:', err.message);
  }

  // 为 knowledge 表添加 tsv 列（用于全文检索）
  try {
    // 添加 tsv 列（如果不存在）
    await db.run(`ALTER TABLE knowledge ADD COLUMN IF NOT EXISTS tsv tsvector`);
    console.log('✅ knowledge.tsv 字段已确保存在');

    // 更新现有数据的 tsv 列（合并 title 和 content）
    await db.run(`
      UPDATE knowledge 
      SET tsv = setweight(to_tsvector('simple', COALESCE(title, '')), 'A') ||
                setweight(to_tsvector('simple', COALESCE(content, '')), 'B')
      WHERE tsv IS NULL
    `);
    console.log('✅ 已更新 knowledge 表的 tsv 值');

    // 创建 GIN 索引（如果不存在）
    await db.run(`CREATE INDEX IF NOT EXISTS idx_knowledge_tsv ON knowledge USING GIN (tsv)`);
    console.log('✅ 全文检索索引已创建');
  } catch (err) {
    console.warn('⚠️ 添加 tsv 列或索引失败:', err.message);
  }
}

async function fixQuizQuestions() {
  const count = await db.get(`SELECT COUNT(*) as c FROM quiz_questions WHERE type = 'choice'`);
  const targetCount = 50;
  if (count.c < targetCount) {
    console.log(`⚠️ 选择题数量不足 (${count.c}/${targetCount})，开始补充生成...`);
    const { generateAndStoreQuestions } = require('../services/questionGenerator');
    await generateAndStoreQuestions(targetCount, true);
  } else {
    console.log(`✅ 已有 ${count.c} 道选择题，跳过生成`);
  }

  const fillCount = await db.get(`SELECT COUNT(*) as c FROM fill_questions`);
  if (fillCount.c < 30) {
    console.log(`⚠️ 填空题数量不足 (${fillCount.c}/30)，开始补充生成...`);
    const { generateAndStoreQuestions } = require('../services/questionGenerator');
    await generateAndStoreQuestions(50, true);
  } else {
    console.log(`✅ 已有 ${fillCount.c} 道填空题`);
  }
}

async function addSourceCategoryColumn() {
  try {
    await db.run(`ALTER TABLE quiz_questions ADD COLUMN IF NOT EXISTS source_category TEXT`);
    console.log('✅ source_category 字段添加成功');
  } catch(e) {
    console.warn('添加 source_category 失败:', e.message);
  }
}

async function ensureWrongQuestionsColumn() {
  try {
    const columnCheck = await db.get(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'wrong_questions' AND column_name = 'question_type'
    `);
    if (!columnCheck) {
      await db.run(`ALTER TABLE wrong_questions ADD COLUMN question_type TEXT DEFAULT 'choice'`);
      await db.run(`UPDATE wrong_questions SET question_type = 'choice' WHERE question_type IS NULL`);
      console.log('✅ 为 wrong_questions 表添加 question_type 列');
    }
  } catch(e) {
    console.warn('迁移 wrong_questions 失败:', e.message);
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

      await addSourceCategoryColumn();
      await ensureMissingTables();
      await ensureWrongQuestionsColumn();

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
        console.log('✅ 趣味闯关已启用主题模式');
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