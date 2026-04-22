// routes/voice.js
const express = require('express');
const TLSSigAPIv2 = require('tls-sig-api-v2');
const { getSession, addMessage } = require('../services/sessionService');

const router = express.Router();

// 从环境变量读取配置
const SDKAppID = parseInt(process.env.TRTC_SDK_APP_ID || '1600137866');
const SECRETKEY = process.env.TRTC_SECRET_KEY || '';
const TENCENT_SECRET_ID = process.env.TENCENT_SECRET_ID || process.env.TENCENTCLOUD_SECRET_ID;
const TENCENT_SECRET_KEY = process.env.TENCENT_SECRET_KEY || process.env.TENCENTCLOUD_SECRET_KEY;

// 存储房间当前的机器人任务ID（简单内存缓存，生产环境可改用 Redis）
const roomTaskMap = new Map(); // key: roomId (string), value: taskId

// 生成 UserSig
function genUserSig(userId, expire = 86400) {
  const api = new TLSSigAPIv2.Api(SDKAppID, SECRETKEY);
  return api.genSig(userId, expire);
}

// ========== 角色音色映射 ==========
const ROLE_VOICE_MAP = {
  '张三': 'v-male-Bk7vD3xP', '李四': 'v-male-s5NqE0rZ', '王婶': 'female-kefu-xiaoyue',
  '张大爷': 'v-male-W1tH9jVc', '李大妈': 'v-female-R2s4N9qJ', '王会计': 'v-male-A4b9KqP2',
  '老赵': 'v-male-s5NqE0rZ', '刘婶': 'female-kefu-xiaomei', '周会计': 'v-male-A4b9KqP2',
  '李大叔': 'v-male-W1tH9jVc', '孙婶': 'v-female-R2s4N9qJ', '小陈': 'v-male-s5NqE0rZ',
  '老刘': 'v-male-W1tH9jVc', '王阿姨': 'female-kefu-xiaomei', '村支书': 'v-male-Bk7vD3xP',
  '村主任': 'v-male-A4b9KqP2', '妇女主任': 'v-female-R2s4N9qJ', '民兵连长': 'v-male-W1tH9jVc'
};
const DEFAULT_VOICE_ID = 'v-female-R2s4N9qJ';
function getVoiceIdByRole(roleName) {
  if (!roleName) return DEFAULT_VOICE_ID;
  return ROLE_VOICE_MAP[roleName] || DEFAULT_VOICE_ID;
}

// ========== 获取用户签名 ==========
router.post('/get-user-sig', (req, res) => {
  const userId = req.user.userId;
  const userSig = genUserSig(userId);
  res.json({ userSig, sdkAppId: SDKAppID, userId });
});

// ========== 存储语音转写文本 ==========
router.post('/transcript', async (req, res) => {
  try {
    const { sessionId, text } = req.body;
    const userId = req.user.userId;
    if (!sessionId || !text) {
      return res.status(400).json({ error: '缺少 sessionId 或 text' });
    }
    const session = await getSession(userId, sessionId);
    if (!session) {
      return res.status(404).json({ error: '会话不存在' });
    }
    await addMessage(sessionId, 'user', text, Date.now());
    console.log(`✅ 语音转写已存储: ${text.substring(0, 50)}...`);
    res.json({ success: true });
  } catch (err) {
    console.error('存储语音转写失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// 内部函数：停止指定房间的机器人（如果存在）
async function stopRobotInRoom(roomId) {
  const taskId = roomTaskMap.get(String(roomId));
  if (!taskId) return false;

  console.log(`停止房间 ${roomId} 的机器人任务 ${taskId}...`);
  try {
    const tencentcloud = require('tencentcloud-sdk-nodejs-trtc');
    const TrtcClient = tencentcloud.trtc.v20190722.Client;
    const client = new TrtcClient({
      credential: {
        secretId: TENCENT_SECRET_ID,
        secretKey: TENCENT_SECRET_KEY,
      },
      region: 'ap-guangzhou',
      profile: {
        httpProfile: { endpoint: 'trtc.tencentcloudapi.com' },
      },
    });
    await client.StopAIConversation({ TaskId: taskId });
    console.log(`✅ 已停止房间 ${roomId} 的机器人任务`);
    roomTaskMap.delete(String(roomId));
    return true;
  } catch (err) {
    console.warn(`停止房间 ${roomId} 机器人失败:`, err.message);
    // 即使停止失败，也删除映射，避免卡死
    roomTaskMap.delete(String(roomId));
    return false;
  }
}

// ========== 启动 AI 机器人（返回 taskId） ==========
router.post('/start-robot', async (req, res) => {
  try {
    const { roomId, userId, sceneType, sessionId, roleName } = req.body;
    if (!roomId || !userId) {
      return res.status(400).json({ error: '缺少 roomId 或 userId' });
    }

    // 1. 先停止该房间现有的机器人（如果有）
    await stopRobotInRoom(roomId);

    // 2. 等待一下，确保腾讯云后端彻底清理（重要！）
    await new Promise(resolve => setTimeout(resolve, 800));

    // 3. 创建新的机器人
    const tencentcloud = require('tencentcloud-sdk-nodejs-trtc');
    const TrtcClient = tencentcloud.trtc.v20190722.Client;
    const client = new TrtcClient({
      credential: {
        secretId: TENCENT_SECRET_ID,
        secretKey: TENCENT_SECRET_KEY,
      },
      region: 'ap-guangzhou',
      profile: {
        httpProfile: {
          endpoint: 'trtc.tencentcloudapi.com',
        },
      },
    });

    const selectedVoiceId = getVoiceIdByRole(roleName);
    console.log(`🎤 为角色 "${roleName}" 分配音色: ${selectedVoiceId}`);

    const llmConfig = {
      LLMType: 'openai',
      Model: 'deepseek-chat',
      APIKey: process.env.DEEPSEEK_API_KEY,
      APIUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1/chat/completions',
      Streaming: true,
      SystemPrompt: `你是一名经验丰富的乡村治理专家，同时也是基层干部的"AI伙伴"。你的任务是用中文回答村官提出的各种实际问题。回答要有条理、循因导果、结尾引导。不要使用 Markdown 语法。当前场景：${sceneType === 'simulate' ? '模拟对练' : '会议模式'}，你扮演的角色是“${roleName || '村民'}”。请以该角色的身份和口吻回应村官。`
    };

    const ttsConfig = {
      TTSType: 'flow',
      VoiceId: selectedVoiceId,
      Model: 'flow_01_turbo',
      Speed: 1.0,
      Volume: 1.0,
      Language: 'zh'
    };

    const params = {
      SdkAppId: SDKAppID,
      RoomId: String(roomId),
      RoomIdType: 1,
      AgentConfig: {
        UserId: `robot_${roomId}`,
        UserSig: genUserSig(`robot_${roomId}`),
        TargetUserId: userId,
      },
      LLMConfig: JSON.stringify(llmConfig),
      TTSConfig: JSON.stringify(ttsConfig),
      SessionId: `session_${roomId}_${Date.now()}`
    };

    console.log('启动机器人参数:', params);
    const response = await client.StartAIConversation(params);
    console.log('机器人启动成功:', response);

    // 4. 记录新任务 ID
    roomTaskMap.set(String(roomId), response.TaskId);

    // 可选：设置超时自动清理（30分钟后如果机器人还在，自动释放）
    setTimeout(() => {
      if (roomTaskMap.get(String(roomId)) === response.TaskId) {
        roomTaskMap.delete(String(roomId));
      }
    }, 30 * 60 * 1000);

    res.json({ success: true, data: response, taskId: response.TaskId });
  } catch (err) {
    console.error('启动 AI 机器人失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// ========== 停止 AI 机器人（外部调用，可选） ==========
router.post('/stop-robot', async (req, res) => {
  try {
    const { taskId, roomId } = req.body;
    if (!taskId && !roomId) {
      return res.status(400).json({ error: '缺少 taskId 或 roomId' });
    }

    let actualTaskId = taskId;
    if (!actualTaskId && roomId) {
      actualTaskId = roomTaskMap.get(String(roomId));
    }
    if (!actualTaskId) {
      return res.json({ success: true, message: '没有需要停止的机器人' });
    }

    const tencentcloud = require('tencentcloud-sdk-nodejs-trtc');
    const TrtcClient = tencentcloud.trtc.v20190722.Client;
    const client = new TrtcClient({
      credential: {
        secretId: TENCENT_SECRET_ID,
        secretKey: TENCENT_SECRET_KEY,
      },
      region: 'ap-guangzhou',
      profile: {
        httpProfile: {
          endpoint: 'trtc.tencentcloudapi.com',
        },
      },
    });

    const response = await client.StopAIConversation({ TaskId: actualTaskId });
    console.log('机器人已停止:', response);
    if (roomId) roomTaskMap.delete(String(roomId));
    res.json({ success: true });
  } catch (err) {
    console.error('停止机器人失败:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;