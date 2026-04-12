// services/pointsService.js
const db = require('./db');
const { v4: uuidv4 } = require('uuid');

// ==================== 积分常量 ====================
const POINTS = {
  // 每日一练
  DAILY_QUIZ_PER_QUESTION: 5,
  DAILY_QUIZ_BONUS_FULL: 10,
  // 趣味闯关
  FUN_LEVEL_PASS: 30,
  // 每周竞赛
  WEEKLY_CONTEST_PER_CORRECT: 3,
  // 翻牌配对
  MEMORY_GAME_BASE_SCORE_DIVISOR: 20,
  // 错题本
  WRONG_CLEAR_PER_QUESTION: 5,
  // 对话
  CHAT_MESSAGE: 5,
  // 收藏消息
  FAVORITE_MESSAGE: 1,
  // 收藏会话
  FAVORITE_SESSION: 2,
  // 知识上传被采纳
  KNOWLEDGE_APPROVED: 10,
  // 每日任务奖励（单任务基础奖励）
  DAILY_TASK_REWARD: 10,
  // 每日任务全部完成额外奖励
  DAILY_TASK_BONUS_ALL: 30
};

// ==================== 积分辅助函数 ====================
async function addPoints(userId, points, reason) {
  if (!userId || points <= 0) return;
  await db.run(
    `INSERT INTO user_points (id, user_id, points, reason, created_at) VALUES ($1, $2, $3, $4, $5)`,
    [uuidv4(), userId, points, reason, new Date().toISOString()]
  );
}

// ==================== 每日任务配置 ====================
const DEFAULT_TASKS = [
  { id: 1, name: '发起3次对话', target: 3, current: 0, reward: 10, type: 'chat' },
  { id: 2, name: '完成1次趣味闯关', target: 1, current: 0, reward: 15, type: 'fun' },
  { id: 3, name: '完成每日一练', target: 1, current: 0, reward: 10, type: 'daily_quiz' },
  { id: 4, name: '完成1次翻牌配对', target: 1, current: 0, reward: 10, type: 'memory' },
  { id: 5, name: '参加每周竞赛', target: 1, current: 0, reward: 15, type: 'contest' }
];

// ==================== 每日任务业务逻辑 ====================

/**
 * 获取或创建用户当日的每日任务记录
 * @param {string} userId
 * @returns {Promise<{ id: number, tasks: Array, completed: boolean, reward_claimed: boolean }>}
 */
async function getOrCreateDailyTasks(userId) {
  const today = new Date().toISOString().slice(0, 10);
  let row = await db.get(
    'SELECT * FROM daily_tasks WHERE user_id = $1 AND task_date = $2',
    [userId, today]
  );
  if (!row) {
    const tasks = DEFAULT_TASKS.map(t => ({ ...t, current: 0, completed: false }));
    await db.run(
      'INSERT INTO daily_tasks (user_id, task_date, task_data) VALUES ($1, $2, $3)',
      [userId, today, JSON.stringify(tasks)]
    );
    row = await db.get(
      'SELECT * FROM daily_tasks WHERE user_id = $1 AND task_date = $2',
      [userId, today]
    );
  }
  return {
    id: row.id,
    tasks: JSON.parse(row.task_data),
    completed: row.completed === 1,
    reward_claimed: row.reward_claimed === 1
  };
}

/**
 * 更新用户某类任务的进度
 * @param {string} userId
 * @param {string} taskType - 'chat', 'fun', 'daily_quiz', 'memory', 'contest'
 * @param {number} delta - 增量，默认1
 * @returns {Promise<{ updated: boolean, allCompleted: boolean, tasks: Array }>}
 */
async function updateTaskProgress(userId, taskType, delta = 1) {
  const { id, tasks, completed, reward_claimed } = await getOrCreateDailyTasks(userId);
  if (completed || reward_claimed) return { updated: false, allCompleted: false, tasks };

  let updated = false;
  for (let task of tasks) {
    if (task.type === taskType && !task.completed) {
      task.current += delta;
      if (task.current >= task.target) {
        task.completed = true;
        updated = true;
      }
    }
  }
  const allCompleted = tasks.every(t => t.completed);
  if (allCompleted && !completed) {
    await db.run('UPDATE daily_tasks SET completed = true WHERE id = $1', [id]);
  }
  await db.run('UPDATE daily_tasks SET task_data = $1 WHERE id = $2', [JSON.stringify(tasks), id]);
  return { updated, allCompleted, tasks };
}

/**
 * 领取每日任务奖励
 * @param {string} userId
 * @returns {Promise<{ success: boolean, points?: number, message?: string }>}
 */
async function claimDailyReward(userId) {
  const { id, tasks, completed, reward_claimed } = await getOrCreateDailyTasks(userId);
  if (!completed) return { success: false, message: '尚未完成全部任务' };
  if (reward_claimed) return { success: false, message: '奖励已领取' };

  const totalReward = tasks.reduce((sum, t) => sum + (t.completed ? t.reward : 0), 0);
  const bonus = tasks.every(t => t.completed) ? POINTS.DAILY_TASK_BONUS_ALL : 0;
  const points = totalReward + bonus;

  await addPoints(userId, points, '每日任务奖励');
  await db.run('UPDATE daily_tasks SET reward_claimed = true WHERE id = $1', [id]);
  return { success: true, points };
}

/**
 * 获取用户当日的任务列表及状态（供前端使用）
 * @param {string} userId
 * @returns {Promise<{ tasks: Array, completed: boolean, reward_claimed: boolean }>}
 */
async function getUserDailyTasks(userId) {
  const { tasks, completed, reward_claimed } = await getOrCreateDailyTasks(userId);
  return { tasks, completed, reward_claimed };
}

// ==================== 导出 ====================
module.exports = {
  // 常量
  ...POINTS,
  // 函数
  addPoints,
  getOrCreateDailyTasks,
  updateTaskProgress,
  claimDailyReward,
  getUserDailyTasks
};