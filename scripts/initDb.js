require('dotenv').config();
const db = require('../services/db');

async function initDb() {
  console.log('开始初始化 PostgreSQL 数据库...');

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
      timestamp BIGINT
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
      vector_data TEXT
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
    `CREATE TABLE IF NOT EXISTS daily_quiz (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      quiz_date DATE,
      score INTEGER,
      completed INTEGER,
      created_at TIMESTAMPTZ
    )`,
    `CREATE TABLE IF NOT EXISTS quiz_questions (
      id TEXT PRIMARY KEY,
      type TEXT,
      question TEXT,
      options TEXT,
      answer INTEGER,
      explanation TEXT,
      category TEXT,
      difficulty INTEGER,
      created_at TIMESTAMPTZ
    )`,
    `CREATE TABLE IF NOT EXISTS daily_quiz_questions (
      id TEXT PRIMARY KEY,
      quiz_id TEXT REFERENCES daily_quiz(id) ON DELETE CASCADE,
      question_id TEXT REFERENCES quiz_questions(id)
    )`,
    `CREATE TABLE IF NOT EXISTS wrong_questions (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      question_id TEXT REFERENCES quiz_questions(id),
      wrong_count INTEGER,
      last_wrong_date DATE
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
    `CREATE TABLE IF NOT EXISTS policy_levels (
      id TEXT PRIMARY KEY,
      name TEXT,
      category TEXT,
      order_num INTEGER,
      questions TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS user_level_progress (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id),
      level_id TEXT REFERENCES policy_levels(id),
      completed INTEGER DEFAULT 0,
      score INTEGER DEFAULT 0,
      passed_at TIMESTAMPTZ
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
    `CREATE TABLE IF NOT EXISTS weekly_contest_scores (
      id TEXT PRIMARY KEY,
      contest_id TEXT REFERENCES weekly_contest(id),
      user_id TEXT REFERENCES users(id),
      score INTEGER,
      time_used INTEGER,
      submitted_at TIMESTAMPTZ
    )`,
    `CREATE TABLE IF NOT EXISTS scratch_cards (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id),
      question_id TEXT REFERENCES quiz_questions(id),
      answer INTEGER,
      reward_points INTEGER,
      is_used INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ,
      used_at TIMESTAMPTZ
    )`,
    `CREATE TABLE IF NOT EXISTS fill_questions (
      id TEXT PRIMARY KEY,
      sentence TEXT,
      correct_word TEXT,
      hint TEXT,
      category TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS fill_daily (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      date DATE,
      questions TEXT,
      completed INTEGER DEFAULT 0,
      score INTEGER DEFAULT 0
    )`
  ];

  for (const sql of tables) {
    try {
      await db.run(sql);
      console.log('表创建成功');
    } catch (err) {
      console.error('创建表失败:', err.message);
    }
  }

  // 插入默认场景数据
  const insertScenario = async (id, title, description, goal, role, initial_message, eval_dimensions) => {
    const sql = `INSERT INTO scenarios (id, title, description, goal, role, initial_message, eval_dimensions, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 ON CONFLICT (id) DO NOTHING`;
    await db.run(sql, [id, title, description, goal, role, initial_message, eval_dimensions, new Date().toISOString()]);
  };

  const now = new Date().toISOString();
  await insertScenario('scenario_001', '调解邻里土地纠纷', '村民张三和李四因宅基地边界发生争执，双方情绪激动，需要你作为村干部进行调解。', '成功调解纠纷，促成双方和解，并明确边界。', '村民张三', '村干部同志，你来得正好！李四家占了我家宅基地，还砌了围墙，你得给我评评理！', JSON.stringify(['沟通技巧', '政策熟悉度', '情绪管理', '调解能力']));
  await insertScenario('scenario_002', '推动垃圾分类', '村里推行垃圾分类，但很多村民不配合，甚至乱扔垃圾。你需要入户宣传，说服村民参与。', '至少说服3户村民同意参与垃圾分类。', '村民王大妈', '哎呀，分什么类啊，我年纪大了搞不懂，你们村干部自己分吧。', JSON.stringify(['沟通技巧', '政策熟悉度', '耐心', '说服力']));
  await insertScenario('scenario_003', '人居环境整治（乱堆乱放）', '村民老赵在自家院外长期堆放柴草和废品，影响村容村貌，邻居投诉。你需上门劝导，动员清理。', '说服老赵主动清理杂物，并建立长效保持意识。', '村民老赵', '我在自家门口放点东西怎么了？又不碍谁的事，你们村干部管得太宽了吧！', JSON.stringify(['沟通技巧', '政策宣讲能力', '共情能力', '问题解决力']));
  await insertScenario('scenario_004', '产业发展项目申报动员会', '村里想申请乡村振兴衔接资金发展特色农产品加工，但部分村民担心失败不愿配合。', '说服至少5户村民参与项目，并收集他们的意见建议。', '村民李大叔', '搞什么加工厂？我们祖祖辈辈种地，投资那么多钱要是亏了谁负责？', JSON.stringify(['政策解读能力', '动员说服力', '风险沟通', '组织协调力']));
  await insertScenario('scenario_005', '邻里噪音纠纷调解', '村民小陈家晚上经常聚会打牌，邻居老刘多次投诉，双方产生口角。你前往调解。', '促成双方相互理解，并约定合理的活动时间。', '村民老刘', '天天晚上吵到一两点，我高血压都犯了！你们村干部管不管？', JSON.stringify(['情绪安抚', '沟通技巧', '矛盾调解', '规则引导']));

  // 插入默认题目
  const existingQuestions = await db.get('SELECT COUNT(*) as count FROM quiz_questions');
  if (existingQuestions.count === 0) {
    const defaultQuestions = [
      { id: 'q1', type: 'choice', question: '宅基地三权分置不包括以下哪一项？', options: '["所有权","资格权","使用权","经营权"]', answer: 3, explanation: '三权分置是指所有权、资格权、使用权分置。', category: '土地管理', difficulty: 1, created_at: now },
      { id: 'q2', type: 'choice', question: '"四议两公开"中"两公开"是指？', options: '["决议公开、结果公开","过程公开、结果公开","决议公开、财务公开","结果公开、监督公开"]', answer: 0, explanation: '两公开是决议公开和实施结果公开。', category: '基层治理', difficulty: 1, created_at: now },
      { id: 'q3', type: 'choice', question: '农民专业合作社至少需要多少名成员？', options: '["3","5","7","10"]', answer: 1, explanation: '根据《农民专业合作社法》，至少需要5名成员。', category: '产业发展', difficulty: 1, created_at: now },
      { id: 'q4', type: 'choice', question: '农村低保申请审批一般需要多少个工作日？', options: '["15","30","45","60"]', answer: 1, explanation: '一般30个工作日左右。', category: '民生保障', difficulty: 1, created_at: now },
      { id: 'q5', type: 'choice', question: '以下哪项不属于乡村振兴促进法的主要内容？', options: '["永久基本农田保护","农民收入稳定增长","城市人口向乡村迁移","传统村落保护"]', answer: 2, explanation: '鼓励城市人才向乡村流动，但不是人口迁移。', category: '政策法规', difficulty: 2, created_at: now }
    ];
    for (const q of defaultQuestions) {
      await db.run(`INSERT INTO quiz_questions (id, type, question, options, answer, explanation, category, difficulty, created_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                    [q.id, q.type, q.question, q.options, q.answer, q.explanation, q.category, q.difficulty, q.created_at]);
    }
  }

  // 插入默认填空题目
  const existingFill = await db.get('SELECT COUNT(*) as count FROM fill_questions');
  if (existingFill.count === 0) {
    const fills = [
      { id: 'fill1', sentence: '宅基地三权分置是指所有权、资格权、______分置。', correct_word: '使用权', hint: '与"使用"相关', category: '土地管理' },
      { id: 'fill2', sentence: '"四议两公开"中"两公开"是指决议公开和______公开。', correct_word: '结果', hint: '实施后的情况', category: '基层治理' },
      { id: 'fill3', sentence: '农民专业合作社的盈余分配中，按交易量返还的比例不得低于______%。', correct_word: '60', hint: '百分之六十', category: '产业发展' }
    ];
    for (const f of fills) {
      await db.run(`INSERT INTO fill_questions (id, sentence, correct_word, hint, category)
                    VALUES ($1, $2, $3, $4, $5)`,
                    [f.id, f.sentence, f.correct_word, f.hint, f.category]);
    }
  }

  // ========== 添加全文搜索支持 ==========
  console.log('添加全文搜索支持...');
  try {
    await db.run(`ALTER TABLE knowledge ADD COLUMN IF NOT EXISTS tsv tsvector`);
    await db.run(`CREATE INDEX IF NOT EXISTS idx_knowledge_tsv ON knowledge USING GIN(tsv)`);
    await db.run(`
      CREATE OR REPLACE FUNCTION knowledge_tsv_trigger() RETURNS trigger AS $$
      BEGIN
        NEW.tsv := setweight(to_tsvector('simple', COALESCE(NEW.title, '')), 'A') ||
                   setweight(to_tsvector('simple', COALESCE(NEW.content, '')), 'B');
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await db.run(`DROP TRIGGER IF EXISTS tsvector_update ON knowledge`);
    await db.run(`
      CREATE TRIGGER tsvector_update
      BEFORE INSERT OR UPDATE ON knowledge
      FOR EACH ROW EXECUTE FUNCTION knowledge_tsv_trigger()
    `);
    await db.run(`UPDATE knowledge SET tsv = NULL`);
    console.log('全文搜索支持已就绪');
  } catch (err) {
    console.error('添加全文搜索失败:', err.message);
  }

  console.log('数据库初始化完成');
}

module.exports = initDb;