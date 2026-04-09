// scripts/ensureDbInit.js
const db = require('../services/db');

(async () => {
  console.log('🔍 检查数据库初始化状态...');
  let retries = 5;
  let initialized = false;
  while (retries > 0 && !initialized) {
    try {
      const tableCheck = await db.get("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'users')");
      if (tableCheck.exists) {
        console.log('✅ 数据库已初始化，跳过');
        initialized = true;
        break;
      } else {
        console.log('⚠️ 数据库未初始化，开始初始化...');
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