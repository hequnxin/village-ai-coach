// scripts/initGameData.js
const db = require('../services/db');
const { v4: uuidv4 } = require('uuid');

async function initGameData() {
    console.log('初始化游戏主题和关卡数据...');

    // 检查是否已有主题数据
    const themeCount = await db.get(`SELECT COUNT(*) as count FROM game_themes`);
    if (themeCount.count > 0) {
        console.log('游戏主题已存在，跳过初始化');
        return;
    }

    // 插入主题（仅当表为空时）
    const themes = [
        { id: 'theme_land', name: '土地管理', icon: '🌾', description: '宅基地、土地流转、确权登记', sort_order: 1 },
        { id: 'theme_industry', name: '产业发展', icon: '🏭', description: '合作社、电商、乡村旅游', sort_order: 2 },
        { id: 'theme_livelihood', name: '民生保障', icon: '❤️', description: '低保、医保、养老保险', sort_order: 3 },
        { id: 'theme_conflict', name: '矛盾调解', icon: '🤝', description: '邻里纠纷、土地纠纷', sort_order: 4 },
        { id: 'theme_governance', name: '基层治理', icon: '🏛️', description: '四议两公开、村规民约', sort_order: 5 }
    ];
    for (const t of themes) {
        await db.run(`INSERT INTO game_themes (id, name, icon, description, sort_order, is_active) VALUES (?, ?, ?, ?, ?, 1)`,
            [t.id, t.name, t.icon, t.description, t.sort_order]);
    }

    // 创建关卡（同样仅当不存在时）
    const levels = [];
    for (const theme of themes) {
        for (let i = 1; i <= 3; i++) {
            const levelId = uuidv4();
            const difficulty = i;
            const questionCount = 5;
            const passingScore = 60;
            const rewardPoints = i === 1 ? 30 : (i === 2 ? 50 : 80);
            levels.push({
                id: levelId,
                theme_id: theme.id,
                level_num: i,
                name: `${theme.name}${i === 1 ? '初级' : (i === 2 ? '中级' : '高级')}`,
                description: `掌握${theme.name}的基础知识`,
                difficulty,
                question_count: questionCount,
                passing_score: passingScore,
                unlock_points: i === 1 ? 0 : (i === 2 ? 100 : 300),
                reward_points: rewardPoints
            });
        }
    }
    for (const lvl of levels) {
        await db.run(`INSERT OR IGNORE INTO game_levels (id, theme_id, level_num, name, description, difficulty, question_count, passing_score, unlock_points, reward_points, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
            [lvl.id, lvl.theme_id, lvl.level_num, lvl.name, lvl.description, lvl.difficulty, lvl.question_count, lvl.passing_score, lvl.unlock_points, lvl.reward_points]);
    }

    // 关联题目（仅当关卡-题目关联表为空时）
    const linkCount = await db.get(`SELECT COUNT(*) as count FROM game_level_questions`);
    if (linkCount.count === 0) {
        const allQuestions = await db.all(`SELECT id, theme, difficulty FROM quiz_questions WHERE theme IS NOT NULL AND difficulty IS NOT NULL`);
        if (allQuestions.length > 0) {
            for (const lvl of levels) {
                const themeName = themes.find(t => t.id === lvl.theme_id).name;
                const levelDifficulty = lvl.difficulty;
                const candidates = allQuestions.filter(q => q.theme === themeName && q.difficulty === levelDifficulty);
                if (candidates.length >= lvl.question_count) {
                    const shuffled = candidates.sort(() => 0.5 - Math.random());
                    const selected = shuffled.slice(0, lvl.question_count);
                    for (const q of selected) {
                        await db.run(`INSERT OR IGNORE INTO game_level_questions (level_id, question_id) VALUES (?, ?)`, [lvl.id, q.id]);
                    }
                } else {
                    console.warn(`关卡 ${lvl.name} 题目不足，需要 ${lvl.question_count}，实际 ${candidates.length}`);
                }
            }
        } else {
            console.warn('没有找到任何带 theme 和 difficulty 的题目，请先运行题目生成脚本');
        }
    }

    console.log('游戏主题和关卡初始化完成');
}

module.exports = initGameData;