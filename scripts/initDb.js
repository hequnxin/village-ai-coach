const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '../data/village.db');
const db = new Database(dbPath);

// 创建表（保持不变，仅添加场景时检查是否存在）
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE,
  password TEXT,
  role TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  title TEXT,
  type TEXT,
  favorite INTEGER DEFAULT 0,
  scenario_id TEXT,
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  role TEXT,
  content TEXT,
  timestamp INTEGER,
  FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS favorites (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  session_id TEXT,
  message_id TEXT,
  session_title TEXT,
  content TEXT,
  role TEXT,
  favorited_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS knowledge (
  id TEXT PRIMARY KEY,
  title TEXT,
  content TEXT,
  source TEXT,
  status TEXT,
  tags TEXT,
  type TEXT,
  category TEXT,
  submitted_by TEXT,
  submitted_at TEXT,
  vector_data TEXT
);

CREATE TABLE IF NOT EXISTS scenarios (
  id TEXT PRIMARY KEY,
  title TEXT,
  description TEXT,
  goal TEXT,
  role TEXT,
  initial_message TEXT,
  eval_dimensions TEXT,
  created_at TEXT
);
`);

// 创建索引
try {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
  `);
} catch (err) {
  console.warn('创建索引失败（可能已存在）:', err.message);
}

// 插入或忽略场景（避免重复）
const insertScenario = db.prepare(`
  INSERT OR IGNORE INTO scenarios (id, title, description, goal, role, initial_message, eval_dimensions, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const now = new Date().toISOString();

// 原有场景（如果不存在则插入）
insertScenario.run(
  'scenario_001',
  '调解邻里土地纠纷',
  '村民张三和李四因宅基地边界发生争执，双方情绪激动，需要你作为村干部进行调解。',
  '成功调解纠纷，促成双方和解，并明确边界。',
  '村民张三',
  '村干部同志，你来得正好！李四家占了我家宅基地，还砌了围墙，你得给我评评理！',
  JSON.stringify(['沟通技巧', '政策熟悉度', '情绪管理', '调解能力']),
  now
);

insertScenario.run(
  'scenario_002',
  '推动垃圾分类',
  '村里推行垃圾分类，但很多村民不配合，甚至乱扔垃圾。你需要入户宣传，说服村民参与。',
  '至少说服3户村民同意参与垃圾分类。',
  '村民王大妈',
  '哎呀，分什么类啊，我年纪大了搞不懂，你们村干部自己分吧。',
  JSON.stringify(['沟通技巧', '政策熟悉度', '耐心', '说服力']),
  now
);

// --- 新增场景 1：人居环境整治 ---
insertScenario.run(
  'scenario_003',
  '人居环境整治（乱堆乱放）',
  '村民老赵在自家院外长期堆放柴草和废品，影响村容村貌，邻居投诉。你需上门劝导，动员清理。',
  '说服老赵主动清理杂物，并建立长效保持意识。',
  '村民老赵',
  '我在自家门口放点东西怎么了？又不碍谁的事，你们村干部管得太宽了吧！',
  JSON.stringify(['沟通技巧', '政策宣讲能力', '共情能力', '问题解决力']),
  now
);

// --- 新增场景 2：产业发展项目申报 ---
insertScenario.run(
  'scenario_004',
  '产业发展项目申报动员会',
  '村里想申请乡村振兴衔接资金发展特色农产品加工，但部分村民担心失败不愿配合。',
  '说服至少5户村民参与项目，并收集他们的意见建议。',
  '村民李大叔',
  '搞什么加工厂？我们祖祖辈辈种地，投资那么多钱要是亏了谁负责？',
  JSON.stringify(['政策解读能力', '动员说服力', '风险沟通', '组织协调力']),
  now
);

// --- 新增场景 3：邻里噪音纠纷调解 ---
insertScenario.run(
  'scenario_005',
  '邻里噪音纠纷调解',
  '村民小陈家晚上经常聚会打牌，邻居老刘多次投诉，双方产生口角。你前往调解。',
  '促成双方相互理解，并约定合理的活动时间。',
  '村民老刘',
  '天天晚上吵到一两点，我高血压都犯了！你们村干部管不管？',
  JSON.stringify(['情绪安抚', '沟通技巧', '矛盾调解', '规则引导']),
  now
);

console.log('数据库初始化完成（含新场景）');
db.close();

module.exports = () => {
  const db = new Database(dbPath);
  db.close();
};