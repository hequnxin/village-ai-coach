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
      single_roles TEXT,
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

  // ========== 迁移：确保 scenarios 表有 single_roles 列 ==========
  try {
    const columnCheck = await db.get(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'scenarios' AND column_name = 'single_roles'
    `);
    if (!columnCheck) {
      await db.run(`ALTER TABLE scenarios ADD COLUMN single_roles TEXT`);
      console.log('✅ 为 scenarios 表添加 single_roles 列');
    } else {
      console.log('✅ scenarios.single_roles 列已存在');
    }
  } catch (err) {
    console.warn('⚠️ 添加 single_roles 列失败:', err.message);
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

  // ========== 插入默认场景数据（包含 single_roles） ==========
  const insertScenario = async (id, title, description, goal, role, initial_message, eval_dimensions, single_roles = null, stages = null) => {
    const sql = `INSERT INTO scenarios (id, title, description, goal, role, initial_message, eval_dimensions, single_roles, stages, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (id) DO NOTHING`;
    const singleRolesJson = single_roles ? JSON.stringify(single_roles) : null;
    const stagesJson = stages ? JSON.stringify(stages) : null;
    await db.run(sql, [id, title, description, goal, role, initial_message, eval_dimensions, singleRolesJson, stagesJson, new Date().toISOString()]);
  };

  // 场景1：邻里土地纠纷
  await insertScenario(
    'scenario_001',
    '调解邻里土地纠纷',
    '村民张三和李四因宅基地边界发生争执，双方情绪激动，需要你作为村干部进行调解。',
    '成功调解纠纷，促成双方和解，并明确边界。',
    '村民张三',
    '村干部同志，你来得正好！李四家占了我家宅基地，还砌了围墙，你得给我评评理！',
    JSON.stringify(['沟通技巧', '政策熟悉度', '情绪管理', '调解能力']),
    [
      { id: 'role_001_1', name: '张三', avatar: '👨', personality: '暴躁、固执', coreDemand: '必须让对方退让，否则不罢休', initialStance: '反对' },
      { id: 'role_001_2', name: '李四', avatar: '👨', personality: '倔强、爱面子', coreDemand: '寸土不让，要求对方道歉', initialStance: '反对' },
      { id: 'role_001_3', name: '王婶', avatar: '👵', personality: '热心、和事佬', coreDemand: '希望双方和解，村里安宁', initialStance: '中立' }
    ],
    [
      { name: '安抚情绪', completed: false },
      { name: '讲清政策', completed: false },
      { name: '达成共识', completed: false }
    ]
  );

  // 场景2：推动垃圾分类
  await insertScenario(
    'scenario_002',
    '推动垃圾分类',
    '村里推行垃圾分类，但很多村民不配合，甚至乱扔垃圾。你需要入户宣传，说服村民参与。',
    '至少说服3户村民同意参与垃圾分类。',
    '村民张大爷',
    '哎呀，分什么类啊，我年纪大了搞不懂，你们村干部自己分吧。',
    JSON.stringify(['沟通技巧', '政策熟悉度', '耐心', '说服力']),
    [
      { id: 'role_002_1', name: '张大爷', avatar: '👴', personality: '固执、嫌麻烦、耳背', coreDemand: '不想多走路倒垃圾', initialStance: '反对' },
      { id: 'role_002_2', name: '李大妈', avatar: '👵', personality: '爱干净、热心', coreDemand: '希望村里统一规划', initialStance: '支持' },
      { id: 'role_002_3', name: '王会计', avatar: '🧑‍💼', personality: '理性、观望', coreDemand: '担心费用和公平性', initialStance: '中立' }
    ],
    [
      { name: '了解抵触原因', completed: false },
      { name: '宣讲政策与好处', completed: false },
      { name: '制定激励方案', completed: false }
    ]
  );

  // 场景3：人居环境整治（乱堆乱放）
  await insertScenario(
    'scenario_003',
    '人居环境整治（乱堆乱放）',
    '村民老赵在自家院外长期堆放柴草和废品，影响村容村貌，邻居投诉。你需上门劝导，动员清理。',
    '说服老赵主动清理杂物，并建立长效保持意识。',
    '村民老赵',
    '我在自家门口放点东西怎么了？又不碍谁的事，你们村干部管得太宽了吧！',
    JSON.stringify(['沟通技巧', '政策宣讲能力', '共情能力', '问题解决力']),
    [
      { id: 'role_003_1', name: '老赵', avatar: '👨', personality: '倔强、爱占便宜', coreDemand: '不想花钱清理', initialStance: '反对' },
      { id: 'role_003_2', name: '刘婶', avatar: '👩', personality: '爱干净、爱管闲事', coreDemand: '要求村里强制清理', initialStance: '支持' },
      { id: 'role_003_3', name: '周会计', avatar: '🧑‍💼', personality: '理性、讲道理', coreDemand: '希望有公平的清理方案', initialStance: '中立' }
    ],
    [
      { name: '劝导清理', completed: false },
      { name: '协调解决方案', completed: false },
      { name: '建立长效机制', completed: false }
    ]
  );

  // 场景4：产业发展项目申报动员会
  await insertScenario(
    'scenario_004',
    '产业发展项目申报动员会',
    '村里想申请乡村振兴衔接资金发展特色农产品加工，但部分村民担心失败不愿配合。',
    '说服至少5户村民参与项目，并收集他们的意见建议。',
    '村民李大叔',
    '搞什么加工厂？我们祖祖辈辈种地，投资那么多钱要是亏了谁负责？',
    JSON.stringify(['政策解读能力', '动员说服力', '风险沟通', '组织协调力']),
    [
      { id: 'role_004_1', name: '李大叔', avatar: '👨', personality: '保守、担心', coreDemand: '怕投资打水漂', initialStance: '反对' },
      { id: 'role_004_2', name: '孙婶', avatar: '👩', personality: '积极、愿意尝试', coreDemand: '想多赚钱', initialStance: '支持' },
      { id: 'role_004_3', name: '周会计', avatar: '🧑‍💼', personality: '精明、算得清', coreDemand: '要看到详细财务预测', initialStance: '中立' }
    ],
    [
      { name: '分析项目可行性', completed: false },
      { name: '回应村民顾虑', completed: false },
      { name: '确定参与意向', completed: false }
    ]
  );

  // 场景5：邻里噪音纠纷调解
  await insertScenario(
    'scenario_005',
    '邻里噪音纠纷调解',
    '村民小陈家晚上经常聚会打牌，邻居老刘多次投诉，双方产生口角。你前往调解。',
    '促成双方相互理解，并约定合理的活动时间。',
    '村民小陈',
    '天天晚上吵到一两点，我高血压都犯了！你们村干部管不管？',
    JSON.stringify(['情绪安抚', '沟通技巧', '矛盾调解', '规则引导']),
    [
      { id: 'role_005_1', name: '小陈', avatar: '🧑', personality: '年轻、爱热闹', coreDemand: '不想被管太多', initialStance: '反对' },
      { id: 'role_005_2', name: '老刘', avatar: '👨', personality: '急躁、敏感', coreDemand: '要求立即停止噪音', initialStance: '反对' },
      { id: 'role_005_3', name: '王阿姨', avatar: '👵', personality: '热心、爱调解', coreDemand: '希望双方各退一步', initialStance: '中立' }
    ],
    [
      { name: '听取双方陈述', completed: false },
      { name: '协商解决方案', completed: false },
      { name: '达成约定', completed: false }
    ]
  );

  console.log('✅ 默认场景数据插入完成');

  // ========== 迁移：为已有场景补充 single_roles（幂等） ==========
  console.log('🔧 检查并补充已有场景的 single_roles...');
  const existingScenarios = await db.all(`SELECT id, single_roles FROM scenarios`);
  for (const s of existingScenarios) {
    if (!s.single_roles) {
      let defaultRoles = [];
      if (s.id === 'scenario_001') {
        defaultRoles = [
          { id: 'role_001_1', name: '张三', avatar: '👨', personality: '暴躁、固执', coreDemand: '必须让对方退让，否则不罢休', initialStance: '反对' },
          { id: 'role_001_2', name: '李四', avatar: '👨', personality: '倔强、爱面子', coreDemand: '寸土不让，要求对方道歉', initialStance: '反对' },
          { id: 'role_001_3', name: '王婶', avatar: '👵', personality: '热心、和事佬', coreDemand: '希望双方和解，村里安宁', initialStance: '中立' }
        ];
      } else if (s.id === 'scenario_002') {
        defaultRoles = [
          { id: 'role_002_1', name: '张大爷', avatar: '👴', personality: '固执、嫌麻烦、耳背', coreDemand: '不想多走路倒垃圾', initialStance: '反对' },
          { id: 'role_002_2', name: '李大妈', avatar: '👵', personality: '爱干净、热心', coreDemand: '希望村里统一规划', initialStance: '支持' },
          { id: 'role_002_3', name: '王会计', avatar: '🧑‍💼', personality: '理性、观望', coreDemand: '担心费用和公平性', initialStance: '中立' }
        ];
      } else if (s.id === 'scenario_003') {
        defaultRoles = [
          { id: 'role_003_1', name: '老赵', avatar: '👨', personality: '倔强、爱占便宜', coreDemand: '不想花钱清理', initialStance: '反对' },
          { id: 'role_003_2', name: '刘婶', avatar: '👩', personality: '爱干净、爱管闲事', coreDemand: '要求村里强制清理', initialStance: '支持' },
          { id: 'role_003_3', name: '周会计', avatar: '🧑‍💼', personality: '理性、讲道理', coreDemand: '希望有公平的清理方案', initialStance: '中立' }
        ];
      } else if (s.id === 'scenario_004') {
        defaultRoles = [
          { id: 'role_004_1', name: '李大叔', avatar: '👨', personality: '保守、担心', coreDemand: '怕投资打水漂', initialStance: '反对' },
          { id: 'role_004_2', name: '孙婶', avatar: '👩', personality: '积极、愿意尝试', coreDemand: '想多赚钱', initialStance: '支持' },
          { id: 'role_004_3', name: '周会计', avatar: '🧑‍💼', personality: '精明、算得清', coreDemand: '要看到详细财务预测', initialStance: '中立' }
        ];
      } else if (s.id === 'scenario_005') {
        defaultRoles = [
          { id: 'role_005_1', name: '小陈', avatar: '🧑', personality: '年轻、爱热闹', coreDemand: '不想被管太多', initialStance: '反对' },
          { id: 'role_005_2', name: '老刘', avatar: '👨', personality: '急躁、敏感', coreDemand: '要求立即停止噪音', initialStance: '反对' },
          { id: 'role_005_3', name: '王阿姨', avatar: '👵', personality: '热心、爱调解', coreDemand: '希望双方各退一步', initialStance: '中立' }
        ];
      } else {
        // 其他场景：基于 role 构造一个默认角色
        const roleInfo = await db.get(`SELECT role FROM scenarios WHERE id = $1`, [s.id]);
        defaultRoles = [{ id: `role_${s.id}_1`, name: roleInfo?.role || '村民', avatar: '👤', personality: '普通', coreDemand: '', initialStance: '中立' }];
      }
      await db.run(`UPDATE scenarios SET single_roles = $1 WHERE id = $2`, [JSON.stringify(defaultRoles), s.id]);
      console.log(`✅ 已为场景 ${s.id} 补充 single_roles`);
    }
  }

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
        answer: `【原因分析】\n村里闲置小学是宝贵的集体资产，长期闲置不仅造成资源浪费，还可能成为卫生死角或安全隐患。\n\n【具体措施】\n根据《闲置资产盘活利用指导意见》，可改造为：\n一、养老服务设施：村级养老服务中心、日间照料中心\n二、产业用房：农产品加工车间、电商直播基地\n三、文化场所：村史馆、农家书屋、文化活动中心\n四、旅游设施：游客中心、特色民宿\n五、仓储物流：农产品冷链仓库\n\n【操作建议】\n1. 通过"四议两公开"决策改造方向\n2. 对接乡镇政府申请专项资金（每村10-30万元）\n3. 改造为经营性场所需办理营业执照\n\n【引导思考】\n您村的闲置小学目前是什么状况？周边村民最急需什么服务？建议先做一个简单需求问卷。`,
        category: "乡村建设",
        keywords: ["闲置小学", "改造", "盘活", "集体资产"],
        priority: 10
      },
      {
        question: "土地流转合同要注意哪些条款？",
        answer: `【原因分析】\n土地流转合同不规范是引发纠纷的主要原因。口头约定容易导致租金拖欠、改变用途等问题。\n\n【具体措施】\n规范合同必须包含：\n一、流转双方信息（姓名、身份证号）\n二、地块详情（位置、面积、四至边界，附测绘图）\n三、流转期限（不得超过承包期剩余年限）\n四、流转用途（必须保持农业用途）\n五、租金及支付方式（明确日期和逾期责任）\n六、违约责任（如改变用途的罚则）\n七、争议解决方式（协商→调解→仲裁→诉讼）\n\n【操作建议】\n1. 使用农业农村部示范文本\n2. 签订后到乡镇经管站备案\n3. 鼓励通过产权交易平台公开流转\n\n【引导思考】\n您村目前土地流转是否已出现纠纷？建议先整理一份合同模板统一使用。`,
        category: "土地管理",
        keywords: ["土地流转", "合同", "条款", "租金", "承包"],
        priority: 10
      },
      {
        question: "如何申请高标准农田项目？",
        answer: `【原因分析】\n高标准农田建设是提升耕地质量、增加产能的重要途径，但很多村干部不了解申报流程而错过机会。\n\n【具体措施】\n申请流程：\n一、村级摸底：统计连片耕地面积（≥300亩）、水源条件、群众意愿\n二、编制方案：委托设计单位编制初步设计\n三、逐级申报：村级申请→乡镇审核→县级农业农村局立项\n四、专家评审：现场踏勘和方案评审\n五、公示批复：村内公示7天\n六、组织实施：招投标→施工→监理→验收\n补助标准：每亩1500-3000元\n\n【操作建议】\n1. 每年3-5月集中申报，提前半年准备\n2. 优先选择水源有保障的地块\n3. 可联合周边村打包申报\n\n【引导思考】\n您村有多少连片耕地？是否具备基本水利条件？建议本周内完成地块摸底。`,
        category: "项目申报",
        keywords: ["高标准农田", "申请", "项目", "补贴", "农田建设"],
        priority: 10
      },
      {
        question: "村民不配合垃圾分类怎么办？",
        answer: `【原因分析】\n村民不配合往往是因为"不会分""嫌麻烦""看不到好处"，强行罚款可能激化矛盾。\n\n【具体措施】\n六步工作法：\n一、干部带头：村干部、党员率先分类，挂牌示范户\n二、积分激励：设立"垃圾分类兑换超市"，积分换日用品\n三、简化分类：初期只分"会烂"和"不会烂"两类\n四、入户指导：网格员包户，手把手教\n五、红黑榜公示：每月评比公示\n六、纳入村规民约：与分红挂钩，但不罚款\n\n【操作建议】\n1. 先选1-2个村民小组试点\n2. 每户发放两个不同颜色垃圾桶\n3. 确保分类后能分类收运\n\n【引导思考】\n您村目前垃圾是如何收运的？是否有分类处理设施？建议先拍几张垃圾桶照片分析。`,
        category: "生态环保",
        keywords: ["垃圾分类", "村民不配合", "人居环境", "垃圾"],
        priority: 10
      },
      {
        question: "想发展民宿需要办哪些手续？",
        answer: `【原因分析】\n民宿涉及住宿、餐饮、消防、卫生等多个监管领域，手续不全可能被停业整顿。\n\n【具体措施】\n按顺序办理：\n一、选址合规：确认房屋合法，不占基本农田\n二、村民决议：经村民代表会议同意\n三、营业执照：经营范围选"民宿服务"\n四、特种行业许可证：需消防验收\n五、卫生许可证：需布草消毒、病媒防治\n六、食品经营许可证：若提供餐饮\n七、税务登记：月入10万以下免增值税\n\n【操作建议】\n1. 先咨询乡镇旅游办，了解扶持政策（每间客房补贴2000-5000元）\n2. 可委托代办机构（费用2000-5000元）\n3. 先办营业执照和特行证，其他3个月内补办\n\n【引导思考】\n您的房屋是自有还是租赁？周边是否有旅游景区？建议先做一个客源调研。`,
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