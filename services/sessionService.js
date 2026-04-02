const { v4: uuidv4 } = require('uuid');
const db = require('./db');

function getUserSessions(userId) {
  const stmt = db.prepare(`
    SELECT id, title, type, favorite, created_at as createdAt, updated_at as updatedAt
    FROM sessions
    WHERE user_id = ?
    ORDER BY created_at DESC
  `);
  return stmt.all(userId);
}

function createSession(userId, { title = '新会话', type = 'chat', scenarioId = null }) {
  const sessionId = uuidv4();
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO sessions (id, user_id, title, type, favorite, scenario_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(sessionId, userId, title, type, 0, scenarioId, now, now);
  return { id: sessionId, title, type, favorite: 0, createdAt: now, updatedAt: now, messages: [] };
}

function getSession(userId, sessionId) {
  const session = db.prepare(`
    SELECT id, title, type, favorite, scenario_id as scenarioId, created_at as createdAt, updated_at as updatedAt
    FROM sessions
    WHERE id = ? AND user_id = ?
  `).get(sessionId, userId);
  if (!session) return null;
  const messages = db.prepare(`
    SELECT id as messageId, role, content, timestamp
    FROM messages
    WHERE session_id = ?
    ORDER BY timestamp ASC
  `).all(sessionId);
  session.messages = messages.map(m => ({
    messageId: m.messageId,
    role: m.role,
    content: m.content,
    timestamp: m.timestamp
  }));
  return session;
}

function updateSession(userId, sessionId, updates) {
  const allowedFields = ['title', 'favorite'];
  const fields = [];
  const values = [];
  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }
  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(sessionId, userId);
  const stmt = db.prepare(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`);
  stmt.run(...values);
}

function addMessage(sessionId, role, content, timestamp = Date.now()) {
  const msgId = uuidv4();
  const stmt = db.prepare(`
    INSERT INTO messages (id, session_id, role, content, timestamp)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(msgId, sessionId, role, content, timestamp);
  // 更新会话更新时间
  db.prepare(`UPDATE sessions SET updated_at = ? WHERE id = ?`).run(new Date().toISOString(), sessionId);
  return { messageId: msgId, role, content, timestamp };
}

function deleteSession(userId, sessionId) {
  db.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').run(sessionId, userId);
}

function getUserFavoriteMessages(userId) {
  const stmt = db.prepare(`
    SELECT id, session_id as sessionId, session_title as sessionTitle, message_id as messageId, content, role, favorited_at as favoritedAt
    FROM favorites
    WHERE user_id = ?
    ORDER BY favorited_at DESC
  `);
  return stmt.all(userId);
}

function toggleFavorite(userId, messageId, sessionId, sessionTitle, content, role, action) {
  if (action === 'add') {
    const existing = db.prepare('SELECT id FROM favorites WHERE user_id = ? AND message_id = ?').get(userId, messageId);
    if (!existing) {
      const id = uuidv4();
      db.prepare(`
        INSERT INTO favorites (id, user_id, session_id, message_id, session_title, content, role, favorited_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, userId, sessionId, messageId, sessionTitle, content, role, new Date().toISOString());
    }
  } else if (action === 'remove') {
    db.prepare('DELETE FROM favorites WHERE user_id = ? AND message_id = ?').run(userId, messageId);
  }
}

function setSessionFavorite(userId, sessionId, favorite) {
  db.prepare('UPDATE sessions SET favorite = ? WHERE id = ? AND user_id = ?').run(favorite ? 1 : 0, sessionId, userId);
}

module.exports = {
  getUserSessions,
  createSession,
  getSession,
  updateSession,
  deleteSession,
  addMessage,
  getUserFavoriteMessages,
  toggleFavorite,
  setSessionFavorite
};