// scripts/ensureDbInit.js
const db = require('../services/db');

(async () => {
    try {
        const tableCheck = await db.get("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'users')");
        if (!tableCheck.exists) {
            console.log('数据库未初始化，开始初始化...');
            const initDb = require('./initDb');
            await initDb();
            const importKnowledge = require('./importKnowledge');
            await importKnowledge();
        } else {
            console.log('数据库已初始化，跳过');
        }
    } catch (err) {
        console.error('检查数据库失败:', err);
    } finally {
        await db.pool.end();
        process.exit(0);
    }
})();