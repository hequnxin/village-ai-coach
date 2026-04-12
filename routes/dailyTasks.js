// routes/dailyTasks.js
const express = require('express');
const pointsService = require('../services/pointsService');

const router = express.Router();

// 获取用户当日的任务列表
router.get('/', async (req, res) => {
  try {
    const userId = req.user.userId;
    const data = await pointsService.getUserDailyTasks(userId);
    res.json(data);
  } catch (err) {
    console.error('获取每日任务失败:', err);
    res.status(500).json({ error: '获取任务失败' });
  }
});

// 更新任务进度
router.post('/progress', async (req, res) => {
  try {
    const { taskType, delta = 1 } = req.body;
    const userId = req.user.userId;
    if (!taskType) return res.status(400).json({ error: '缺少 taskType' });
    const result = await pointsService.updateTaskProgress(userId, taskType, delta);
    // 返回更新后的任务列表
    const { tasks } = await pointsService.getUserDailyTasks(userId);
    res.json({ ...result, tasks });
  } catch (err) {
    console.error('更新任务进度失败:', err);
    res.status(500).json({ error: '更新失败' });
  }
});

// 领取每日奖励
router.post('/claim', async (req, res) => {
  try {
    const userId = req.user.userId;
    const result = await pointsService.claimDailyReward(userId);
    if (!result.success) {
      return res.status(400).json({ success: false, message: result.message });
    }
    res.json({ success: true, points: result.points });
  } catch (err) {
    console.error('领取奖励失败:', err);
    res.status(500).json({ error: '领取失败' });
  }
});

module.exports = router;