// scripts/ensureDbInit.js
const db = require('../services/db');

async function tableExists(tableName) {
  const res = await db.get(
    "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)",
    [tableName]
  );
  return res.exists;
}

(async () => {
  console.log('🔍 检查数据库初始化状态...');
  let retries = 5;
  let initialized = false;

  while (retries > 0 && !initialized) {
    try {
      await db.get('SELECT 1');
      console.log('✅ 数据库连接成功');

      // 检查关键表是否存在（game_themes 是游戏功能的必需表）
      const themesExist = await tableExists('game_themes');
      const quizExist = await tableExists('quiz_questions');

      if (themesExist && quizExist) {
        console.log('✅ 所有关键表已存在，跳过初始化');
        initialized = true;
        break;
      } else {
        console.log('⚠️ 检测到缺失表 (game_themes或quiz_questions)，开始完整初始化...');
        const initDb = require('./initDb');
        await initDb();
        const importKnowledge = require('./importKnowledge');
        await importKnowledge();
        console.log('✅ 数据库初始化完成');
        initialized = true;
        break;
      }
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