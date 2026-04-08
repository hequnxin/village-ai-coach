const express = require('express');
const { chat } = require('../services/openai');
const router = express.Router();

router.post('/chat', async (req, res) => {
    const { villagerName, personality, message } = req.body;
    const prompt = `你正在模拟村民大会。当前村民是：${villagerName}，性格：${personality}。请以第一人称用中文回复村官的问题，回复内容要自然口语化，符合村民身份。问题：${message}`;
    try {
        const reply = await chat([{ role: 'user', content: prompt }], { temperature: 0.8, max_tokens: 200 });
        res.json({ reply });
    } catch (err) {
        res.status(500).json({ error: 'AI服务异常' });
    }
});

module.exports = router;