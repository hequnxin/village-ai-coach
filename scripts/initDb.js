// scripts/initDb.js
require('dotenv').config();
const db = require('../services/db');
const { v4: uuidv4 } = require('uuid');

process.on('unhandledRejection', (reason) => {
    console.error('❌ 未处理的 Promise 拒绝:', reason);
    process.exit(1);
});

async function initDb() {
    console.log('🚀 开始初始化 PostgreSQL 数据库...');

    try {
        await db.get('SELECT 1');
        console.log('✅ 数据库连接成功');
    } catch (err) {
        console.error('❌ 数据库连接失败，请检查 DATABASE_URL:', err.message);
        throw err;
    }

    // ========== 创建所有表 ==========
    const tables = [
        `CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            title TEXT,
            type TEXT,
            favorite INTEGER DEFAULT 0,
            scenario_id TEXT,
            difficulty TEXT DEFAULT 'medium',
            created_at TIMESTAMPTZ,
            updated_at TIMESTAMPTZ
        )`,
        `CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            role TEXT,
            content TEXT,
            timestamp BIGINT,
            status TEXT DEFAULT 'pending'
        )`,
        `CREATE TABLE IF NOT EXISTS favorites (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            session_id TEXT,
            message_id TEXT,
            session_title TEXT,
            content TEXT,
            role TEXT,
            favorited_at TIMESTAMPTZ
        )`,
        `CREATE TABLE IF NOT EXISTS knowledge (
            id TEXT PRIMARY KEY,
            title TEXT,
            content TEXT,
            source TEXT,
            status TEXT,
            tags TEXT,
            type TEXT,
            category TEXT,
            submitted_by TEXT,
            submitted_at TIMESTAMPTZ,
            vector_data TEXT,
            tsv tsvector
        )`,
        `CREATE TABLE IF NOT EXISTS scenarios (
            id TEXT PRIMARY KEY,
            title TEXT,
            description TEXT,
            goal TEXT,
            role TEXT,
            initial_message TEXT,
            eval_dimensions TEXT,
            created_at TIMESTAMPTZ,
            stages TEXT
        )`,
        `CREATE TABLE IF NOT EXISTS game_themes (
            id TEXT PRIMARY KEY,
            name VARCHAR(50) NOT NULL,
            icon VARCHAR(10),
            description TEXT,
            sort_order INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 1
        )`,
        `CREATE TABLE IF NOT EXISTS game_levels (
            id TEXT PRIMARY KEY,
            theme_id TEXT NOT NULL REFERENCES game_themes(id) ON DELETE CASCADE,
            level_num INTEGER NOT NULL,
            name VARCHAR(50) NOT NULL,
            description TEXT,
            difficulty INTEGER DEFAULT 1,
            question_count INTEGER DEFAULT 5,
            passing_score INTEGER DEFAULT 60,
            unlock_points INTEGER DEFAULT 0,
            reward_points INTEGER DEFAULT 50,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )`,
        `CREATE TABLE IF NOT EXISTS game_level_questions (
            level_id TEXT REFERENCES game_levels(id) ON DELETE CASCADE,
            question_id TEXT REFERENCES quiz_questions(id) ON DELETE CASCADE,
            PRIMARY KEY (level_id, question_id)
        )`,
        `CREATE TABLE IF NOT EXISTS user_game_progress (
            id TEXT PRIMARY KEY,
            user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
            level_id TEXT REFERENCES game_levels(id) ON DELETE CASCADE,
            completed INTEGER DEFAULT 0,
            best_score INTEGER DEFAULT 0,
            attempts INTEGER DEFAULT 0,
            completed_at TIMESTAMPTZ,
            UNIQUE(user_id, level_id)
        )`,
        `CREATE TABLE IF NOT EXISTS quiz_questions (
            id TEXT PRIMARY KEY,
            type TEXT DEFAULT 'choice',
            question TEXT,
            options TEXT,
            answer TEXT,
            explanation TEXT,
            category TEXT,
            theme TEXT,
            difficulty INTEGER,
            source_category TEXT,
            score INTEGER DEFAULT 10,
            created_at TIMESTAMPTZ,
            question_type TEXT DEFAULT 'choice'
        )`,
        `CREATE TABLE IF NOT EXISTS fill_questions (
            id TEXT PRIMARY KEY,
            sentence TEXT,
            correct_word TEXT,
            hint TEXT,
            category TEXT
        )`,
        `CREATE TABLE IF NOT EXISTS daily_quiz (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            quiz_date DATE,
            score INTEGER,
            completed INTEGER,
            created_at TIMESTAMPTZ
        )`,
        `CREATE TABLE IF NOT EXISTS daily_quiz_questions (
            id TEXT PRIMARY KEY,
            quiz_id TEXT REFERENCES daily_quiz(id) ON DELETE CASCADE,
            question_id TEXT REFERENCES quiz_questions(id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS fill_daily (
            id TEXT PRIMARY KEY,
            user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
            date DATE,
            questions TEXT,
            completed INTEGER DEFAULT 0,
            score INTEGER DEFAULT 0
        )`,
        `CREATE TABLE IF NOT EXISTS wrong_questions (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            question_id TEXT NOT NULL,
            question_type TEXT NOT NULL DEFAULT 'choice',
            wrong_count INTEGER NOT NULL,
            last_wrong_date DATE NOT NULL,
            UNIQUE(user_id, question_id, question_type)
        )`,
        `CREATE TABLE IF NOT EXISTS simulate_mistakes (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            mistake_text TEXT NOT NULL,
            scenario_id TEXT,
            created_at TIMESTAMPTZ NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS user_points (
            id TEXT PRIMARY KEY,
            user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
            points INTEGER,
            reason TEXT,
            created_at TIMESTAMPTZ
        )`,
        `CREATE TABLE IF NOT EXISTS shop_items (
            id TEXT PRIMARY KEY,
            name TEXT,
            type TEXT,
            icon TEXT,
            price INTEGER,
            data TEXT
        )`,
        `CREATE TABLE IF NOT EXISTS user_items (
            id TEXT PRIMARY KEY,
            user_id TEXT REFERENCES users(id),
            item_id TEXT REFERENCES shop_items(id),
            purchased_at TIMESTAMPTZ,
            equipped INTEGER
        )`,
        `CREATE TABLE IF NOT EXISTS pk_rooms (
            id TEXT PRIMARY KEY,
            room_code TEXT UNIQUE,
            creator_id TEXT,
            opponent_id TEXT,
            status TEXT,
            questions TEXT,
            creator_answers TEXT,
            opponent_answers TEXT,
            creator_score INTEGER,
            opponent_score INTEGER,
            winner_id TEXT,
            created_at TIMESTAMPTZ,
            finished_at TIMESTAMPTZ
        )`,
        `CREATE TABLE IF NOT EXISTS weekly_contest (
            id TEXT PRIMARY KEY,
            week_start DATE,
            week_end DATE,
            questions TEXT,
            status TEXT
        )`,
        `CREATE TABLE IF NOT EXISTS weekly_contest_attempts (
            id TEXT PRIMARY KEY,
            contest_id TEXT REFERENCES weekly_contest(id) ON DELETE CASCADE,
            user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
            attempt_number INTEGER NOT NULL,
            score INTEGER NOT NULL,
            total_questions INTEGER NOT NULL,
            time_used INTEGER NOT NULL,
            submitted_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(contest_id, user_id, attempt_number)
        )`,
        `CREATE TABLE IF NOT EXISTS scratch_cards (
            id TEXT PRIMARY KEY,
            user_id TEXT REFERENCES users(id),
            question_id TEXT REFERENCES quiz_questions(id),
            answer TEXT,
            reward_points INTEGER,
            is_used INTEGER DEFAULT 0,
            created_at TIMESTAMPTZ,
            used_at TIMESTAMPTZ
        )`,
        `CREATE TABLE IF NOT EXISTS user_theme_progress (
            id TEXT PRIMARY KEY,
            user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
            theme_id TEXT REFERENCES game_themes(id) ON DELETE CASCADE,
            completed INTEGER DEFAULT 0,
            completed_at TIMESTAMPTZ,
            UNIQUE(user_id, theme_id)
        )`,
        `CREATE TABLE IF NOT EXISTS memory_game_records (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            difficulty TEXT NOT NULL,
            score INTEGER NOT NULL,
            time_used INTEGER NOT NULL,
            moves INTEGER NOT NULL,
            matched_count INTEGER NOT NULL,
            total_pairs INTEGER NOT NULL,
            created_at TIMESTAMPTZ NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS daily_tasks (
            id SERIAL PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            task_date DATE NOT NULL,
            task_data JSONB NOT NULL,
            completed BOOLEAN DEFAULT FALSE,
            reward_claimed BOOLEAN DEFAULT FALSE,
            UNIQUE(user_id, task_date)
        )`,
        // 新增预设问答表
        `CREATE TABLE IF NOT EXISTS preset_qa (
            id SERIAL PRIMARY KEY,
            question TEXT NOT NULL UNIQUE,
            answer TEXT NOT NULL,
            category VARCHAR(50),
            keywords TEXT[],
            priority INT DEFAULT 0,
            is_active BOOLEAN DEFAULT true,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )`
    ];

    for (const sql of tables) {
        try {
            await db.run(sql);
            console.log('✅ 表创建/检查成功');
        } catch (err) {
            console.error(`❌ 创建表失败: ${err.message}`);
        }
    }

    // ========== 迁移：确保字段存在 ==========
    try {
        await db.run(`ALTER TABLE quiz_questions ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'choice'`);
        await db.run(`ALTER TABLE quiz_questions ALTER COLUMN answer TYPE TEXT`);
        await db.run(`ALTER TABLE quiz_questions ADD COLUMN IF NOT EXISTS explanation TEXT`);
        await db.run(`ALTER TABLE quiz_questions ADD COLUMN IF NOT EXISTS source_category TEXT`);
        await db.run(`ALTER TABLE quiz_questions ADD COLUMN IF NOT EXISTS question_type TEXT DEFAULT 'choice'`);
        console.log('✅ quiz_questions 字段迁移完成');
    } catch(e) { console.warn('⚠️ 迁移 quiz_questions 失败:', e.message); }

    try {
        await db.run(`CREATE INDEX IF NOT EXISTS idx_memory_records_user ON memory_game_records(user_id)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_memory_records_difficulty ON memory_game_records(difficulty)`);
        console.log('✅ memory_game_records 索引创建成功');
    } catch(e) { console.warn('⚠️ 创建索引失败:', e.message); }

    try {
        await db.run(`ALTER TABLE wrong_questions ADD COLUMN IF NOT EXISTS question_type TEXT DEFAULT 'choice'`);
        console.log('✅ wrong_questions 表结构确认');
    } catch(e) { console.warn('⚠️ 迁移 wrong_questions 失败:', e.message); }

    // ========== 插入默认场景数据 ==========
    const insertScenario = async (id, title, description, goal, role, initial_message, eval_dimensions) => {
        const sql = `INSERT INTO scenarios (id, title, description, goal, role, initial_message, eval_dimensions, created_at)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`;
        await db.run(sql, [id, title, description, goal, role, initial_message, eval_dimensions, new Date().toISOString()]);
    };

    await insertScenario('scenario_001', '调解邻里土地纠纷', '村民张三和李四因宅基地边界发生争执，双方情绪激动，需要你作为村干部进行调解。',
        '成功调解纠纷，促成双方和解，并明确边界。', '村民张三', '村干部同志，你来得正好！李四家占了我家宅基地，还砌了围墙，你得给我评评理！',
        JSON.stringify(['沟通技巧', '政策熟悉度', '情绪管理', '调解能力']));
    await insertScenario('scenario_002', '推动垃圾分类', '村里推行垃圾分类，但很多村民不配合，甚至乱扔垃圾。你需要入户宣传，说服村民参与。',
        '至少说服3户村民同意参与垃圾分类。', '村民王大妈', '哎呀，分什么类啊，我年纪大了搞不懂，你们村干部自己分吧。',
        JSON.stringify(['沟通技巧', '政策熟悉度', '耐心', '说服力']));
    await insertScenario('scenario_003', '人居环境整治（乱堆乱放）', '村民老赵在自家院外长期堆放柴草和废品，影响村容村貌，邻居投诉。你需上门劝导，动员清理。',
        '说服老赵主动清理杂物，并建立长效保持意识。', '村民老赵', '我在自家门口放点东西怎么了？又不碍谁的事，你们村干部管得太宽了吧！',
        JSON.stringify(['沟通技巧', '政策宣讲能力', '共情能力', '问题解决力']));
    await insertScenario('scenario_004', '产业发展项目申报动员会', '村里想申请乡村振兴衔接资金发展特色农产品加工，但部分村民担心失败不愿配合。',
        '说服至少5户村民参与项目，并收集他们的意见建议。', '村民李大叔', '搞什么加工厂？我们祖祖辈辈种地，投资那么多钱要是亏了谁负责？',
        JSON.stringify(['政策解读能力', '动员说服力', '风险沟通', '组织协调力']));
    await insertScenario('scenario_005', '邻里噪音纠纷调解', '村民小陈家晚上经常聚会打牌，邻居老刘多次投诉，双方产生口角。你前往调解。',
        '促成双方相互理解，并约定合理的活动时间。', '村民老刘', '天天晚上吵到一两点，我高血压都犯了！你们村干部管不管？',
        JSON.stringify(['情绪安抚', '沟通技巧', '矛盾调解', '规则引导']));
    console.log('✅ 默认场景数据插入完成');

    // ========== 初始化游戏主题 ==========
    try {
        const themeCount = await db.get(`SELECT COUNT(*) as count FROM game_themes`);
        if (themeCount.count === 0) {
            const themes = [
                { id: 'theme_land', name: '土地管理', icon: '🌾', description: '宅基地、土地流转、确权登记', sort_order: 1 },
                { id: 'theme_industry', name: '产业发展', icon: '🏭', description: '合作社、电商、乡村旅游', sort_order: 2 },
                { id: 'theme_livelihood', name: '民生保障', icon: '❤️', description: '低保、医保、养老保险', sort_order: 3 },
                { id: 'theme_conflict', name: '矛盾调解', icon: '🤝', description: '邻里纠纷、土地纠纷', sort_order: 4 },
                { id: 'theme_governance', name: '基层治理', icon: '🏛️', description: '四议两公开、村规民约', sort_order: 5 }
            ];
            for (const t of themes) {
                await db.run(`INSERT INTO game_themes (id, name, icon, description, sort_order, is_active) VALUES ($1, $2, $3, $4, $5, 1) ON CONFLICT (id) DO NOTHING`,
                    [t.id, t.name, t.icon, t.description, t.sort_order]);
            }
            console.log('✅ 游戏主题初始化完成');
        } else {
            console.log('✅ 游戏主题已存在，跳过初始化');
        }
    } catch (err) {
        console.error('❌ 初始化游戏主题失败:', err.message);
    }

    // ========== 插入预设问答数据 ==========
    const presetCount = await db.get(`SELECT COUNT(*) as count FROM preset_qa`);
    if (presetCount.count === 0) {
        const presetAnswers = [
            {
                question: "村里闲置小学可以改造成什么？",
                answer: `【原因分析】
村里闲置小学是宝贵的集体资产，长期闲置不仅造成资源浪费，还可能成为卫生死角或安全隐患。

【具体措施】
根据《闲置资产盘活利用指导意见》，可改造为：
一、养老服务设施：村级养老服务中心、日间照料中心
二、产业用房：农产品加工车间、电商直播基地
三、文化场所：村史馆、农家书屋、文化活动中心
四、旅游设施：游客中心、特色民宿
五、仓储物流：农产品冷链仓库

【操作建议】
1. 通过"四议两公开"决策改造方向
2. 对接乡镇政府申请专项资金（每村10-30万元）
3. 改造为经营性场所需办理营业执照

【引导思考】
您村的闲置小学目前是什么状况？周边村民最急需什么服务？建议先做一个简单需求问卷。`,
                category: "乡村建设",
                keywords: ["闲置小学", "改造", "盘活", "集体资产"],
                priority: 10
            },
            {
                question: "土地流转合同要注意哪些条款？",
                answer: `【原因分析】
土地流转合同不规范是引发纠纷的主要原因。口头约定容易导致租金拖欠、改变用途等问题。

【具体措施】
规范合同必须包含：
一、流转双方信息（姓名、身份证号）
二、地块详情（位置、面积、四至边界，附测绘图）
三、流转期限（不得超过承包期剩余年限）
四、流转用途（必须保持农业用途）
五、租金及支付方式（明确日期和逾期责任）
六、违约责任（如改变用途的罚则）
七、争议解决方式（协商→调解→仲裁→诉讼）

【操作建议】
1. 使用农业农村部示范文本
2. 签订后到乡镇经管站备案
3. 鼓励通过产权交易平台公开流转

【引导思考】
您村目前土地流转是否已出现纠纷？建议先整理一份合同模板统一使用。`,
                category: "土地管理",
                keywords: ["土地流转", "合同", "条款", "租金", "承包"],
                priority: 10
            },
            {
                question: "如何申请高标准农田项目？",
                answer: `【原因分析】
高标准农田建设是提升耕地质量、增加产能的重要途径，但很多村干部不了解申报流程而错过机会。

【具体措施】
申请流程：
一、村级摸底：统计连片耕地面积（≥300亩）、水源条件、群众意愿
二、编制方案：委托设计单位编制初步设计
三、逐级申报：村级申请→乡镇审核→县级农业农村局立项
四、专家评审：现场踏勘和方案评审
五、公示批复：村内公示7天
六、组织实施：招投标→施工→监理→验收
补助标准：每亩1500-3000元

【操作建议】
1. 每年3-5月集中申报，提前半年准备
2. 优先选择水源有保障的地块
3. 可联合周边村打包申报

【引导思考】
您村有多少连片耕地？是否具备基本水利条件？建议本周内完成地块摸底。`,
                category: "项目申报",
                keywords: ["高标准农田", "申请", "项目", "补贴", "农田建设"],
                priority: 10
            },
            {
                question: "村民不配合垃圾分类怎么办？",
                answer: `【原因分析】
村民不配合往往是因为"不会分""嫌麻烦""看不到好处"，强行罚款可能激化矛盾。

【具体措施】
六步工作法：
一、干部带头：村干部、党员率先分类，挂牌示范户
二、积分激励：设立"垃圾分类兑换超市"，积分换日用品
三、简化分类：初期只分"会烂"和"不会烂"两类
四、入户指导：网格员包户，手把手教
五、红黑榜公示：每月评比公示
六、纳入村规民约：与分红挂钩，但不罚款

【操作建议】
1. 先选1-2个村民小组试点
2. 每户发放两个不同颜色垃圾桶
3. 确保分类后能分类收运

【引导思考】
您村目前垃圾是如何收运的？是否有分类处理设施？建议先拍几张垃圾桶照片分析。`,
                category: "生态环保",
                keywords: ["垃圾分类", "村民不配合", "人居环境", "垃圾"],
                priority: 10
            },
            {
                question: "想发展民宿需要办哪些手续？",
                answer: `【原因分析】
民宿涉及住宿、餐饮、消防、卫生等多个监管领域，手续不全可能被停业整顿。

【具体措施】
按顺序办理：
一、选址合规：确认房屋合法，不占基本农田
二、村民决议：经村民代表会议同意
三、营业执照：经营范围选"民宿服务"
四、特种行业许可证：需消防验收
五、卫生许可证：需布草消毒、病媒防治
六、食品经营许可证：若提供餐饮
七、税务登记：月入10万以下免增值税

【操作建议】
1. 先咨询乡镇旅游办，了解扶持政策（每间客房补贴2000-5000元）
2. 可委托代办机构（费用2000-5000元）
3. 先办营业执照和特行证，其他3个月内补办

【引导思考】
您的房屋是自有还是租赁？周边是否有旅游景区？建议先做一个客源调研。`,
                category: "产业发展",
                keywords: ["民宿", "手续", "办证", "旅游", "农家乐"],
                priority: 10
            }
        ];
        for (const p of presetAnswers) {
            await db.run(
                `INSERT INTO preset_qa (question, answer, category, keywords, priority, is_active) VALUES ($1, $2, $3, $4, $5, true)`,
                [p.question, p.answer, p.category, p.keywords, p.priority]
            );
        }
        console.log('✅ 预设问答数据插入完成');
    } else {
        console.log('预设问答数据已存在，跳过插入');
    }

    // ========== 自动生成高质量题目 ==========
    try {
        const { generateAndStoreQuestions } = require('../services/questionGenerator');
        console.log('📝 开始自动生成高质量题目（单选、填空、判断、排序）...');
        await generateAndStoreQuestions(50);
        console.log('✅ 题目生成完成');
    } catch (err) {
        console.error('❌ 题目生成失败:', err.message);
    }

    console.log('🎉 数据库初始化完成！');
}

initDb().catch(err => {
    console.error('❌ 初始化脚本执行失败:', err);
    process.exit(1);
});