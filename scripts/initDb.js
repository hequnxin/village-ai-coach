const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../data/village.db');
const db = new Database(dbPath);

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

// 插入默认场景（如果不存在）
const scenarioCount = db.prepare('SELECT COUNT(*) as count FROM scenarios').get().count;
if (scenarioCount === 0) {
  const insertScenario = db.prepare(`
    INSERT INTO scenarios (id, title, description, goal, role, initial_message, eval_dimensions, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const now = new Date().toISOString();
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
}

console.log('数据库初始化完成');
db.close();