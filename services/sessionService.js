const { v4: uuidv4 } = require('uuid');
const db = require('./db');

async function getUserSessions(userId) {
    const sql = `SELECT id, title, type, favorite, created_at as "createdAt", updated_at as "updatedAt"
                 FROM sessions
                 WHERE user_id = $1
                 ORDER BY created_at DESC`;
    return await db.all(sql, [userId]);
}

async function createSession(userId, { title = '新会话', type = 'chat', scenarioId = null, difficulty = 'medium' }) {
    const sessionId = uuidv4();
    const now = new Date().toISOString();
    const sql = `INSERT INTO sessions (id, user_id, title, type, favorite, scenario_id, difficulty, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`;
    await db.run(sql, [sessionId, userId, title, type, 0, scenarioId, difficulty, now, now]);
    return { id: sessionId, title, type, favorite: 0, difficulty, createdAt: now, updatedAt: now, messages: [] };
}

async function getSession(userId, sessionId) {
    const sessionSql = `SELECT id, title, type, favorite, scenario_id as "scenarioId", difficulty, created_at as "createdAt", updated_at as "updatedAt"
                        FROM sessions
                        WHERE id = $1 AND user_id = $2`;
    const session = await db.get(sessionSql, [sessionId, userId]);
    if (!session) return null;
    const messagesSql = `SELECT id as "messageId", role, content, timestamp
                         FROM messages
                         WHERE session_id = $1
                         ORDER BY timestamp ASC`;
    const messages = await db.all(messagesSql, [sessionId]);
    session.messages = messages.map(m => ({
        messageId: m.messageId,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp
    }));
    return session;
}

async function updateSession(userId, sessionId, updates) {
    const allowedFields = ['title', 'favorite'];
    const fields = [];
    const values = [];
    let idx = 1;
    for (const [key, value] of Object.entries(updates)) {
        if (allowedFields.includes(key)) {
            fields.push(`${key} = $${idx++}`);
            values.push(value);
        }
    }
    if (fields.length === 0) return;
    fields.push(`updated_at = $${idx++}`);
    values.push(new Date().toISOString());
    values.push(sessionId, userId);
    const sql = `UPDATE sessions SET ${fields.join(', ')} WHERE id = $${idx++} AND user_id = $${idx}`;
    await db.run(sql, values);
}

async function addMessage(sessionId, role, content, timestamp = Date.now()) {
    const msgId = uuidv4();
    const sql = `INSERT INTO messages (id, session_id, role, content, timestamp)
                 VALUES ($1, $2, $3, $4, $5)`;
    await db.run(sql, [msgId, sessionId, role, content, timestamp]);
    await db.run(`UPDATE sessions SET updated_at = $1 WHERE id = $2`, [new Date().toISOString(), sessionId]);
    return { messageId: msgId, role, content, timestamp };
}

async function deleteSession(userId, sessionId) {
    await db.run(`DELETE FROM sessions WHERE id = $1 AND user_id = $2`, [sessionId, userId]);
}

async function getUserFavoriteMessages(userId) {
    const sql = `SELECT id, session_id as "sessionId", session_title as "sessionTitle", message_id as "messageId", content, role, favorited_at as "favoritedAt"
                 FROM favorites
                 WHERE user_id = $1
                 ORDER BY favorited_at DESC`;
    return await db.all(sql, [userId]);
}

async function toggleFavorite(userId, messageId, sessionId, sessionTitle, content, role, action) {
    if (action === 'add') {
        const existing = await db.get(`SELECT id FROM favorites WHERE user_id = $1 AND message_id = $2`, [userId, messageId]);
        if (!existing) {
            const id = uuidv4();
            await db.run(`INSERT INTO favorites (id, user_id, session_id, message_id, session_title, content, role, favorited_at)
                          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                         [id, userId, sessionId, messageId, sessionTitle, content, role, new Date().toISOString()]);
        }
    } else if (action === 'remove') {
        await db.run(`DELETE FROM favorites WHERE user_id = $1 AND message_id = $2`, [userId, messageId]);
    }
}

async function setSessionFavorite(userId, sessionId, favorite) {
    await db.run(`UPDATE sessions SET favorite = $1 WHERE id = $2 AND user_id = $3`, [favorite ? 1 : 0, sessionId, userId]);
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