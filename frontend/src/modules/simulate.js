// frontend/src/modules/simulate.js

import { fetchWithAuth } from '../utils/api';
import { appState, switchSession } from './state';
import { escapeHtml, playSound, updateTaskProgress, setupVoiceInput, setActiveNavByView, showCelebration, showPointsFloat } from '../utils/helpers';
import { startVoiceCall, stopVoiceCall, toggleMute, isInVoiceCall, restartRobot } from './voice';
import { createVoiceCallUI } from './VoiceCallManager';

let currentScenario = null;
let currentMultiVillagers = [];
let simulateMode = 'single';
let isTyping = false;
let isSending = false;
let statusPollInterval = null;
let eventInterval = null;
let currentTargetVillager = null;
let roundRobinDone = false;
let manualUserMessageCount = 0;
let generatingReport = false;

// ==================== 语音合成 ====================
let speechSynthesisEnabled = true;
function speakText(text, voiceName = 'Tingting') {
  if (!speechSynthesisEnabled) return;
  if (!window.speechSynthesis) {
    console.warn('浏览器不支持语音合成');
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'zh-CN';
  utterance.rate = 0.9;
  utterance.pitch = 1.0;
  const voices = window.speechSynthesis.getVoices();
  const cnVoice = voices.find(v => v.lang === 'zh-CN' && (v.name.includes('Tingting') || v.name.includes('Xiaoxiao')));
  if (cnVoice) utterance.voice = cnVoice;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

// 场景剧情引导状态
const scenarioGuideState = {
  'scenario_001': { stage: 0, lastSatisfaction: 50, triggeredFlags: new Set() },
  'scenario_002': { stage: 0, lastSatisfaction: 50, triggeredFlags: new Set() },
  'scenario_003': { stage: 0, lastSatisfaction: 50, triggeredFlags: new Set() },
  'scenario_004': { stage: 0, lastSatisfaction: 50, triggeredFlags: new Set() },
  'scenario_005': { stage: 0, lastSatisfaction: 50, triggeredFlags: new Set() }
};

// 场景配置（包含 guideRules 和 agendaNames）
const scenarioMultiConfig = {
  'scenario_001': {
    title: '调解邻里土地纠纷',
    description: '村民张三和李四因宅基地边界发生争执，双方情绪激动，需要你作为村干部进行调解。',
    villagers: [
      { id: 'v1', name: '张三', avatar: '👨', personality: '暴躁、固执', coreDemand: '必须让对方退让，否则不罢休', initialStance: '反对', stanceValue: 0.1 },
      { id: 'v2', name: '李四', avatar: '👨', personality: '倔强、爱面子', coreDemand: '寸土不让，要求对方道歉', initialStance: '反对', stanceValue: 0.1 },
      { id: 'v3', name: '王婶', avatar: '👵', personality: '热心、和事佬', coreDemand: '希望双方和解，村里安宁', initialStance: '中立', stanceValue: 0.5 }
    ],
    agendaNames: ['安抚情绪', '讲清政策', '达成共识'],
    guideRules: [
      { condition: (ctx) => ctx.satisfaction < 35 && !ctx.triggeredFlags.has('lowSat'), message: '⚠️ 双方情绪激动，再吵下去可能动手！建议先分开两人，分别谈话。', flag: 'lowSat' },
      { condition: (ctx) => ctx.satisfaction > 65 && !ctx.triggeredFlags.has('midSat'), message: '🎉 气氛缓和了！张三提出按老账本测量，李四也愿意商量。你可以提议邀请村里老人见证，现场划界。', flag: 'midSat' },
      { condition: (ctx) => ctx.lastUserMsg.includes('测量') && !ctx.triggeredFlags.has('measure'), message: '📏 你提到了实地测量。好办法！请立即联系老党员和退休干部一起见证，并准备好纸笔记录。', flag: 'measure' },
      { condition: (ctx) => ctx.lastUserMsg.includes('协议') && !ctx.triggeredFlags.has('agreement'), message: '✍️ 签订书面协议非常重要！起草一份《边界确认协议》，双方签字画押，调解就成功了。', flag: 'agreement' },
      { condition: (ctx) => ctx.dialogueCount >= 8 && !ctx.triggeredFlags.has('longTalk'), message: '⏳ 讨论持续了一段时间，建议提出折中方案：各让一步，以老界石为基准重新划线。', flag: 'longTalk' }
    ]
  },
  'scenario_002': {
    title: '推动垃圾分类',
    description: '村里推行垃圾分类，但很多村民不配合，甚至乱扔垃圾。你需要入户宣传，说服村民参与。',
    villagers: [
      { id: 'v1', name: '张大爷', avatar: '👴', personality: '固执、嫌麻烦', coreDemand: '不想多走路倒垃圾', initialStance: '反对', stanceValue: 0.2 },
      { id: 'v2', name: '李大妈', avatar: '👵', personality: '爱干净、支持', coreDemand: '希望村里统一规划', initialStance: '支持', stanceValue: 0.8 },
      { id: 'v3', name: '王叔', avatar: '👨', personality: '理性、观望', coreDemand: '担心费用和公平性', initialStance: '中立', stanceValue: 0.5 }
    ],
    agendaNames: ['了解抵触原因', '宣讲政策与好处', '制定激励方案'],
    guideRules: [
      { condition: (ctx) => ctx.satisfaction < 40 && !ctx.triggeredFlags.has('lowSat'), message: '😟 张大爷还是不愿意分类，他嫌麻烦。你可以告诉他村里会发放分类垃圾桶，并安排专人指导。', flag: 'lowSat' },
      { condition: (ctx) => ctx.satisfaction > 60 && !ctx.triggeredFlags.has('midSat'), message: '🌟 李大妈带头开始分类了！你可以请她帮忙宣传，带动其他村民。', flag: 'midSat' },
      { condition: (ctx) => ctx.lastUserMsg.includes('补贴') && !ctx.triggeredFlags.has('subsidy'), message: '💰 提到政府补贴是个好主意！可以告诉村民，垃圾分类做得好年底有奖励。', flag: 'subsidy' },
      { condition: (ctx) => ctx.dialogueCount >= 6 && !ctx.triggeredFlags.has('longTalk'), message: '📦 已经有几户村民同意分类了。可以设立"红黑榜"，公示分类情况，激励大家。', flag: 'longTalk' }
    ]
  },
  'scenario_003': {
    title: '人居环境整治（乱堆乱放）',
    description: '村民老赵在自家院外长期堆放柴草和废品，影响村容村貌，邻居投诉。你需上门劝导，动员清理。',
    villagers: [
      { id: 'v1', name: '老赵', avatar: '👨', personality: '倔强、爱占便宜', coreDemand: '不想花钱清理，觉得碍不着别人', initialStance: '反对', stanceValue: 0.2 },
      { id: 'v2', name: '刘婶', avatar: '👩', personality: '爱干净、爱管闲事', coreDemand: '要求村里强制清理', initialStance: '支持', stanceValue: 0.9 },
      { id: 'v3', name: '周会计', avatar: '🧑‍💼', personality: '理性、讲道理', coreDemand: '希望有公平的清理方案', initialStance: '中立', stanceValue: 0.5 }
    ],
    agendaNames: ['劝导清理', '协调解决方案', '建立长效机制'],
    guideRules: [
      { condition: (ctx) => ctx.satisfaction < 40 && !ctx.triggeredFlags.has('lowSat'), message: '🧹 老赵拒绝清理，情绪激动。你可以提出由村里组织志愿者帮忙，并告知"门前三包"责任。', flag: 'lowSat' },
      { condition: (ctx) => ctx.satisfaction > 65 && !ctx.triggeredFlags.has('midSat'), message: '👍 老赵态度松动，同意清理部分柴草。你可以承诺帮他联系废品回收，一举两得。', flag: 'midSat' },
      { condition: (ctx) => ctx.lastUserMsg.includes('罚款') && !ctx.triggeredFlags.has('fine'), message: '⚠️ 提及罚款可能激化矛盾，建议先奖励后惩罚，比如评选"卫生文明户"。', flag: 'fine' }
    ]
  },
  'scenario_004': {
    title: '产业发展项目申报动员会',
    description: '村里想申请乡村振兴衔接资金发展特色农产品加工，但部分村民担心失败不愿配合。',
    villagers: [
      { id: 'v1', name: '李大叔', avatar: '👨', personality: '保守、担心', coreDemand: '怕投资打水漂', initialStance: '反对', stanceValue: 0.2 },
      { id: 'v2', name: '孙婶', avatar: '👩', personality: '积极、愿意尝试', coreDemand: '想多赚钱', initialStance: '支持', stanceValue: 0.9 },
      { id: 'v3', name: '周会计', avatar: '🧑‍💼', personality: '精明、算得清', coreDemand: '要看到详细财务预测', initialStance: '中立', stanceValue: 0.5 }
    ],
    agendaNames: ['分析项目可行性', '回应村民顾虑', '确定参与意向'],
    guideRules: [
      { condition: (ctx) => ctx.satisfaction < 40 && !ctx.triggeredFlags.has('lowSat'), message: '📉 李大叔担心风险很大。你可以先请他参观成功的合作社，用事实说话。', flag: 'lowSat' },
      { condition: (ctx) => ctx.satisfaction > 65 && !ctx.triggeredFlags.has('midSat'), message: '📊 周会计要求看财务预测。你可以邀请乡镇农经站专家来讲解可行性报告。', flag: 'midSat' },
      { condition: (ctx) => ctx.lastUserMsg.includes('风险') && !ctx.triggeredFlags.has('risk'), message: '🛡️ 讨论风险控制：可以设立风险基金，或者先小范围试点，成功再推广。', flag: 'risk' }
    ]
  },
  'scenario_005': {
    title: '邻里噪音纠纷调解',
    description: '村民小陈家晚上经常聚会打牌，邻居老刘多次投诉，双方产生口角。你前往调解。',
    villagers: [
      { id: 'v1', name: '小陈', avatar: '🧑', personality: '年轻、爱热闹', coreDemand: '不想被管太多', initialStance: '反对', stanceValue: 0.2 },
      { id: 'v2', name: '老刘', avatar: '👨', personality: '急躁、敏感', coreDemand: '要求立即停止噪音', initialStance: '反对', stanceValue: 0.1 },
      { id: 'v3', name: '王阿姨', avatar: '👵', personality: '热心、爱调解', coreDemand: '希望双方各退一步', initialStance: '中立', stanceValue: 0.5 }
    ],
    agendaNames: ['听取双方陈述', '协商解决方案', '达成约定'],
    guideRules: [
      { condition: (ctx) => ctx.satisfaction < 35 && !ctx.triggeredFlags.has('lowSat'), message: '🔊 双方在门口争吵！建议先请他们进屋坐下，避免当众冲突。', flag: 'lowSat' },
      { condition: (ctx) => ctx.satisfaction > 65 && !ctx.triggeredFlags.has('midSat'), message: '🕊️ 小陈同意晚上10点后停止打牌，老刘也愿意不再骂人。可以拟定一份"邻里公约"。', flag: 'midSat' },
      { condition: (ctx) => ctx.lastUserMsg.includes('噪音') && !ctx.triggeredFlags.has('noise'), message: '📢 提醒小陈：噪音超过一定分贝属于扰民，可以建议他加装隔音垫。', flag: 'noise' }
    ]
  }
};

// 辅助函数
function getEmotionIcon(emotion) {
  const map = { happy:'😊', sad:'😭', angry:'😡', neutral:'😐', surprise:'😲', worry:'😟' };
  return map[emotion] || '😐';
}

function scrollSimulate() {
  const container = document.getElementById('simulateMessagesContainer');
  if (container) container.scrollTop = container.scrollHeight;
}

function showTip(tip) {
  let tipDiv = document.getElementById('strategyTip');
  if (!tipDiv) {
    tipDiv = document.createElement('div');
    tipDiv.id = 'strategyTip';
    tipDiv.style.position = 'fixed';
    tipDiv.style.bottom = '20px';
    tipDiv.style.right = '20px';
    tipDiv.style.backgroundColor = '#ff9800';
    tipDiv.style.color = 'white';
    tipDiv.style.padding = '8px 16px';
    tipDiv.style.borderRadius = '20px';
    tipDiv.style.zIndex = '1000';
    tipDiv.style.fontSize = '0.8rem';
    tipDiv.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
    document.body.appendChild(tipDiv);
    setTimeout(() => tipDiv.remove(), 3000);
  }
  tipDiv.textContent = tip;
  setTimeout(() => tipDiv.remove(), 3000);
}

function showGuideMessage(message) {
  const container = document.getElementById('simulateMessages');
  if (!container) return;
  const guideDiv = document.createElement('div');
  guideDiv.className = 'simulate-message system';
  guideDiv.innerHTML = `<div class="simulate-message-bubble" style="background:#d4e6f1; color:#0d3b66; border-left: 4px solid #ff9800;">🎬 剧情引导：${escapeHtml(message)}</div>`;
  container.appendChild(guideDiv);
  scrollSimulate();
  playSound('complete');
}

function checkScenarioGuides(scenarioId, satisfaction, lastUserMsg, dialogueCount) {
  const config = scenarioMultiConfig[scenarioId];
  if (!config || !config.guideRules) return;
  const state = scenarioGuideState[scenarioId];
  if (!state) return;
  const ctx = {
    satisfaction,
    lastUserMsg: lastUserMsg || '',
    dialogueCount,
    triggeredFlags: state.triggeredFlags,
    stage: state.stage
  };
  for (let rule of config.guideRules) {
    if (rule.condition(ctx) && !state.triggeredFlags.has(rule.flag)) {
      state.triggeredFlags.add(rule.flag);
      showGuideMessage(rule.message);
    }
  }
  state.lastSatisfaction = satisfaction;
}

function createSimulateMessageElement(role, speakerName, speakerAvatar, content, emotion, satisfaction, messageId, isThinking = false) {
  const msgDiv = document.createElement('div');
  msgDiv.className = `simulate-message ${role}`;
  if (messageId) msgDiv.dataset.messageId = messageId;
  const emotionIcon = getEmotionIcon(emotion);
  const isMobile = window.innerWidth <= 768;
  let metaHtml = '';
  if (isMobile && simulateMode === 'multi' && role === 'assistant' && satisfaction !== undefined) {
    metaHtml = `<div class="villager-meta">❤️ ${satisfaction}% ${emotionIcon}</div>`;
  }
  let displayContent = content;
  let extraClass = '';
  if (isThinking && role === 'assistant') {
    displayContent = '💭 思考中...';
    extraClass = 'thinking-message';
  }
  msgDiv.innerHTML = `
    <div class="simulate-message-avatar">${speakerAvatar}</div>
    <div class="simulate-message-bubble ${extraClass}">
      <div class="simulate-message-speaker" style="font-weight:bold; margin-bottom:2px;">${escapeHtml(speakerName)}</div>
      <div class="simulate-message-content">${escapeHtml(displayContent)}</div>
      ${satisfaction !== undefined && !isMobile && !isThinking ? `<div class="simulate-satisfaction-bar"><div style="width:${satisfaction}%;"></div></div>` : ''}
      ${!isMobile && !isThinking ? `<div class="simulate-emotion-icon">${emotionIcon}</div>` : ''}
      ${metaHtml}
    </div>
  `;
  // 如果是 assistant 消息，播放语音
  if (role === 'assistant' && !isThinking && content) {
    speakText(content);
  }
  return msgDiv;
}

function showReportModal(reportData, finalScore, satisfaction, stagesCompleted, totalStages) {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.display = 'flex';
  modal.style.alignItems = 'center';
  modal.style.justifyContent = 'center';
  modal.style.zIndex = '2000';

  let avgDimensionScore = null;
  let dimensionCount = 0;
  let dimensionTotal = 0;
  if (reportData.scores) {
    const scores = Object.values(reportData.scores);
    dimensionCount = scores.length;
    dimensionTotal = scores.reduce((a,b) => a + b, 0);
    avgDimensionScore = dimensionCount > 0 ? (dimensionTotal / dimensionCount).toFixed(1) : null;
  }

  modal.innerHTML = `
    <div class="modal-content" style="width: 90%; max-width: 750px; max-height: 85vh; overflow-y: auto; border-radius: 20px; padding: 0; background: white;">
      <div style="position: sticky; top:0; background: white; padding: 16px 20px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center;">
        <h3 style="margin:0;">📋 模拟对练报告</h3>
        <button class="modal-close" style="background:none; border:none; font-size: 24px; cursor:pointer;">&times;</button>
      </div>
      <div style="padding: 20px;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 20px; flex-wrap: wrap; gap: 12px;">
          <div><strong>🏆 最终得分：</strong> <span style="font-size: 1.4rem; font-weight: bold; color:#2e5d34;">${finalScore}</span> / 100</div>
          <div><strong>😊 满意度：</strong> ${satisfaction}%</div>
          <div><strong>📌 议程进度：</strong> ${stagesCompleted}/${totalStages}</div>
        </div>
        ${avgDimensionScore ? `
        <div style="margin-bottom: 16px; padding: 8px 12px; background: #e8f5e9; border-radius: 8px; font-size: 0.85rem;">
          💡 最终得分计算方式：维度平均分 ${avgDimensionScore} 分（满分5分）× 20 = ${(avgDimensionScore * 20).toFixed(0)} 分，加上满意度加成 ${Math.floor(satisfaction/10)} 分，合计 ${finalScore} 分。
        </div>
        ` : ''}
        ${reportData.scores ? `
        <div style="margin-bottom: 20px;">
          <strong>📊 各维度评分（满分5分）：</strong>
          <div style="display: flex; flex-wrap: wrap; gap: 12px; margin-top: 8px;">
            ${Object.entries(reportData.scores).map(([k,v]) => `<span style="background:#f0f0f0; padding:4px 12px; border-radius:20px;">${k}: ${v} / 5</span>`).join('')}
          </div>
        </div>
        ` : ''}
        ${reportData.suggestions ? `
        <div style="margin-bottom: 20px; background: #f9f9f9; padding: 12px; border-radius: 12px;">
          <strong>💡 整体建议：</strong><br>
          <div style="margin-top: 6px; line-height: 1.5;">${escapeHtml(reportData.suggestions)}</div>
        </div>
        ` : ''}
        ${reportData.examples && reportData.examples.length ? `
        <div style="margin-bottom: 20px;">
          <strong>📝 典型发言点评：</strong>
          <ul style="margin-top: 8px; padding-left: 20px;">
            ${reportData.examples.map(ex => `
              <li style="margin-bottom: 12px;">
                <strong>${ex.verdict === '优点' ? '✅' : '⚠️'} ${ex.verdict}</strong>："${escapeHtml(ex.quote)}"<br>
                <span style="font-size:0.85rem; color:#666;">${escapeHtml(ex.comment)}</span>
              </li>
            `).join('')}
          </ul>
        </div>
        ` : ''}
        ${reportData.bestPractices && reportData.bestPractices.length ? `
        <div style="margin-bottom: 20px;">
          <strong>🏆 优秀话术参考：</strong>
          <ul style="margin-top: 8px; padding-left: 20px;">
            ${reportData.bestPractices.map(p => `<li style="margin-bottom: 6px;">${escapeHtml(p)}</li>`).join('')}
          </ul>
        </div>
        ` : ''}
        ${reportData.mistakes && reportData.mistakes.length ? `
        <div style="margin-bottom: 20px;">
          <strong>❌ 主要失误点：</strong>
          <ul style="margin-top: 8px; padding-left: 20px;">
            ${reportData.mistakes.map(m => `<li style="margin-bottom: 6px;">${escapeHtml(m)}</li>`).join('')}
          </ul>
        </div>
        ` : ''}
      </div>
      <div style="padding: 16px 20px; background: #f9f9f9; text-align: right; border-top: 1px solid #eee;">
        <button class="close-report-btn" style="background:#2e5d34; color:white; border:none; padding:8px 24px; border-radius:30px; cursor:pointer;">关闭</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  const closeModal = () => modal.remove();
  modal.querySelector('.modal-close').onclick = closeModal;
  modal.querySelector('.close-report-btn').onclick = closeModal;
  modal.onclick = (e) => { if (e.target === modal) closeModal(); };
}

function updateSidebarStatus(data, villagerName = null) {
  if (!data) return;
  if (simulateMode === 'multi' && data.villagersState) {
    for (const [name, state] of Object.entries(data.villagersState)) {
      const tab = document.querySelector(`.villager-tab[data-name="${name}"]`);
      if (tab) {
        const badge = tab.querySelector('.satisfaction-badge');
        if (badge) badge.textContent = `${state.satisfaction}%`;
      }
      const sidebarItem = document.querySelector(`.villager-item[data-name="${name}"]`);
      if (sidebarItem) {
        const satSpan = sidebarItem.querySelector('.villager-satisfaction');
        if (satSpan) satSpan.textContent = `满意度: ${state.satisfaction}%`;
        const fillDiv = sidebarItem.querySelector('.satisfaction-fill');
        if (fillDiv) fillDiv.style.width = `${state.satisfaction}%`;
        const emotionSpan = sidebarItem.querySelector('.villager-emotion');
        if (emotionSpan) emotionSpan.textContent = getEmotionIcon(state.emotion);
      }
    }
  } else if (simulateMode === 'single') {
    const satisfaction = data.satisfaction;
    const emotion = data.emotion;
    const satSpan = document.querySelector('.single-satisfaction');
    if (satSpan) satSpan.textContent = `${satisfaction}%`;
    const emotionSpan = document.querySelector('.single-emotion');
    if (emotionSpan) emotionSpan.textContent = getEmotionIcon(emotion);
    const fillDiv = document.querySelector('.single-satisfaction-fill');
    if (fillDiv) fillDiv.style.width = `${satisfaction}%`;
  }
  const topStatusDiv = document.getElementById('simulateStatus');
  if (topStatusDiv && data.satisfaction !== undefined) {
    topStatusDiv.innerHTML = `满意度：${data.satisfaction}%`;
  }

  const stages = data.stages;
  if (stages && stages.length > 0) {
    const total = stages.length;
    const completed = stages.filter(s => s.completed).length;
    const progressText = document.querySelector('.agenda-progress-text');
    if (progressText) progressText.textContent = `${completed}/${total}`;
    const agendaItems = document.querySelectorAll('.agenda-item');
    if (agendaItems.length === stages.length) {
      stages.forEach((stage, idx) => {
        const item = agendaItems[idx];
        if (stage.completed) {
          item.classList.add('completed');
          item.classList.remove('current');
        } else if (idx === stages.findIndex(s => !s.completed)) {
          item.classList.add('current');
          item.classList.remove('completed');
        } else {
          item.classList.remove('current', 'completed');
        }
      });
    }
    const progressFill = document.querySelector('.agenda-progress-fill');
    if (progressFill) {
      const percent = (completed / total) * 100;
      progressFill.style.width = `${percent}%`;
    }
  }
}
async function sendSimulateMessage(sessionId, text, container, roleName, targetVillager = null, isAuto = false, singleRole = null) {
  if (!isAuto && isSending) return;
  if (!isAuto) isSending = true;
  if (!isAuto) {
    const userMsg = createSimulateMessageElement('user', '村官', '👨‍🌾', text, 'neutral');
    container.appendChild(userMsg);
    scrollSimulate();
    setInputEnabled(false);
    manualUserMessageCount++;
  }

  let thinkingMsgDiv = null;
  if (!isAuto) {
    let speakerAvatar;
    if (targetVillager) {
      speakerAvatar = targetVillager.avatar;
    } else if (singleRole && singleRole.avatar) {
      speakerAvatar = singleRole.avatar;
    } else {
      speakerAvatar = roleName.includes('村民') ? '👵' : '🤖';
    }
    thinkingMsgDiv = createSimulateMessageElement('assistant', roleName, speakerAvatar, '', 'neutral', undefined, null, true);
    container.appendChild(thinkingMsgDiv);
    scrollSimulate();
  }

  try {
    let res;
    if (targetVillager) {
      res = await fetchWithAuth('/api/simulate/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, message: text, villager: { name: targetVillager.name, personality: targetVillager.personality } })
      });
    } else {
      res = await fetchWithAuth('/api/simulate/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, message: text })
      });
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    if (!isAuto && thinkingMsgDiv) {
      let speakerAvatar;
      if (targetVillager) {
        speakerAvatar = targetVillager.avatar;
      } else if (singleRole && singleRole.avatar) {
        speakerAvatar = singleRole.avatar;
      } else {
        speakerAvatar = roleName.includes('村民') ? '👵' : '🤖';
      }
      const finalMsg = createSimulateMessageElement('assistant', roleName, speakerAvatar, data.reply, data.emotion || 'neutral', data.satisfaction, data.messageId);
      thinkingMsgDiv.replaceWith(finalMsg);
      if (data.strategyTip) showTip(data.strategyTip);
      updateSidebarStatus(data, targetVillager?.name);
      scrollSimulate();
      if (data.timeExpired) {
        alert('时间到！模拟结束。');
        document.getElementById('finishSimulateBtn')?.click();
      }
    } else if (isAuto) {
      let speakerAvatar;
      if (targetVillager) {
        speakerAvatar = targetVillager.avatar;
      } else if (singleRole && singleRole.avatar) {
        speakerAvatar = singleRole.avatar;
      } else {
        speakerAvatar = roleName.includes('村民') ? '👵' : '🤖';
      }
      const autoMsg = createSimulateMessageElement('assistant', roleName, speakerAvatar, data.reply, data.emotion || 'neutral', data.satisfaction, data.messageId);
      container.appendChild(autoMsg);
      if (data.strategyTip) showTip(data.strategyTip);
      updateSidebarStatus(data, targetVillager?.name);
      scrollSimulate();
    }
  } catch(err) {
    console.error(err);
    if (!isAuto) {
      if (thinkingMsgDiv) {
        let speakerAvatar;
        if (targetVillager) {
          speakerAvatar = targetVillager.avatar;
        } else if (singleRole && singleRole.avatar) {
          speakerAvatar = singleRole.avatar;
        } else {
          speakerAvatar = roleName.includes('村民') ? '👵' : '🤖';
        }
        const errorMsg = createSimulateMessageElement('assistant', roleName, speakerAvatar, `❌ 发送失败：${err.message}`, 'neutral');
        thinkingMsgDiv.replaceWith(errorMsg);
      }
      alert('发送失败：' + err.message);
    }
  } finally {
    if (!isAuto) {
      isSending = false;
      setInputEnabled(true);
    }
  }
}

function setInputEnabled(enabled) {
  const input = document.getElementById('simulateInput');
  const sendBtn = document.getElementById('simulateSendBtn');
  const finishBtn = document.getElementById('finishSimulateBtn');
  const hintBtn = document.getElementById('hintBtn');
  if (input) input.disabled = !enabled;
  if (sendBtn) sendBtn.disabled = !enabled;
  if (finishBtn) finishBtn.disabled = !enabled;
  if (hintBtn) hintBtn.disabled = !enabled;
  if (enabled && input) input.focus();
}

function startRandomEvents(sessionId) {
  if (eventInterval) clearInterval(eventInterval);
  let lastEventTime = 0;
  let lastEventType = null;
  eventInterval = setInterval(async () => {
    const now = Date.now();
    if (manualUserMessageCount < 3) return;
    if (now - lastEventTime < 120000) return;
    if (Math.random() > 0.1) return;
    const events = [
      { type: 'call', msg: '📞 突然接到上级电话，要求你汇报工作情况。请暂停对话，模拟接听电话。', effect: { satisfactionDelta: -5 } },
      { type: 'leave', msg: '😠 村民情绪失控，摔门而去！', effect: { satisfactionDelta: -15, stageRollback: true } },
      { type: 'good', msg: '🎉 好消息！村里刚获得一笔项目资金，村民满意度上升。', effect: { satisfactionDelta: 10 } },
      { type: 'rumor', msg: '📢 有村民在背后议论你处理不公，其他村民开始动摇。', effect: { satisfactionDelta: -8 } }
    ];
    let availableEvents = events;
    if (lastEventType) {
      availableEvents = events.filter(e => e.type !== lastEventType);
    }
    const event = availableEvents[Math.floor(Math.random() * availableEvents.length)];
    lastEventType = event.type;
    lastEventTime = now;
    const container = document.getElementById('simulateMessages');
    if (!container) return;
    const sysMsg = document.createElement('div');
    sysMsg.className = 'simulate-message system';
    sysMsg.innerHTML = `<div class="simulate-message-bubble" style="background:#f0f0f0; text-align:center;">⚠️ ${event.msg}</div>`;
    container.appendChild(sysMsg);
    scrollSimulate();
    try {
      await fetchWithAuth(`/api/simulate/event/${sessionId}`, {
        method: 'POST',
        body: JSON.stringify(event.effect)
      });
    } catch(e) { console.warn('事件上报失败', e); }
  }, 90000);
}

function startPollingStatus(sessionId) {
  if (statusPollInterval) clearInterval(statusPollInterval);
  statusPollInterval = setInterval(async () => {
    try {
      const res = await fetchWithAuth(`/api/simulate/status/${sessionId}`);
      const data = await res.json();
      updateSidebarStatus(data);
    } catch(e) {}
  }, 3000);
}

export async function renderSimulateView(forceList = false) {
  if (statusPollInterval) {
    clearInterval(statusPollInterval);
    statusPollInterval = null;
  }
  if (eventInterval) {
    clearInterval(eventInterval);
    eventInterval = null;
  }
  isSending = false;
  isTyping = false;
  manualUserMessageCount = 0;
  roundRobinDone = false;

  if (forceList || !appState.currentSessionId || appState.sessions.find(s => s.id === appState.currentSessionId)?.type !== 'simulate') {
    const res = await fetchWithAuth('/api/simulate/scenarios');
    const scenarios = await res.json();
    if (scenarios.length === 0) {
      document.getElementById('dynamicContent').innerHTML = '<div class="scenarios-list"><p>暂无场景</p></div>';
      setActiveNavByView('simulate');
      return;
    }

    let html = `<div class="scenarios-list" style="padding:20px; display:grid; grid-template-columns:repeat(auto-fill,minmax(340px,1fr)); gap:20px;">`;
    scenarios.forEach(s => {
      const multiConfig = scenarioMultiConfig[s.id];
      const singleRoles = s.singleRoles || [];
      let roleSelectorHtml = '';
      if (singleRoles.length > 1) {
        roleSelectorHtml = `
          <div class="role-selector" style="margin-top:8px;">
            <label>👥 选择对练角色：</label>
            <select class="single-role-select" data-scenario-id="${s.id}" style="width:100%; padding:6px; border-radius:20px; border:1px solid #ccc;">
              ${singleRoles.map(role => `<option value="${role.id}">${role.avatar} ${role.name}（${role.initialStance}）</option>`).join('')}
            </select>
          </div>
        `;
      } else if (singleRoles.length === 1) {
        roleSelectorHtml = `<div class="role-info" style="font-size:0.7rem; color:#666; margin-top:4px;">🎭 单人角色：${singleRoles[0].avatar} ${singleRoles[0].name}</div>`;
      }

      html += `
        <div class="scenario-card" data-id="${s.id}" style="background:white; border-radius:16px; padding:16px; box-shadow:0 2px 8px rgba(0,0,0,0.1);">
          <h3 style="color:#2e5d34; margin-bottom:8px;">${escapeHtml(s.title)}</h3>
          <p style="color:#666; font-size:0.9rem;">${escapeHtml(s.description)}</p>
          <p style="margin-top:8px;"><strong>目标：</strong>${escapeHtml(s.goal)}</p>
          <div class="difficulty-selector" style="margin:12px 0;">
            <label>难度：</label>
            <select class="difficulty-select" style="padding:4px 8px; border-radius:20px; border:1px solid #ccc;">
              <option value="easy">🌟简单</option>
              <option value="medium" selected>⚡中等</option>
              <option value="hard">🔥困难</option>
            </select>
          </div>
          <div class="time-limit-selector" style="margin:8px 0;">
            <label>时间限制（秒）：</label>
            <input type="number" class="time-limit-input" value="0" placeholder="0表示无限制" style="width:80px; padding:4px;">
          </div>
          <div class="mode-selector" style="margin:8px 0;">
            <label>模式：</label>
            <select class="mode-select" style="padding:4px 8px; border-radius:20px; border:1px solid #ccc;">
              <option value="single">👤 单人模式</option>
              <option value="multi">👥 多人模式</option>
            </select>
          </div>
          <div class="role-preview" style="margin:12px 0; padding:8px; background:#f9f9f9; border-radius:12px; font-size:0.8rem;">
            <div class="single-preview" style="display:block;">
              <strong>👤 单人角色：</strong> ${escapeHtml(s.role)}<br>
              ${singleRoles.length > 1 ? '<span style="font-size:0.7rem;">（可选不同角色）</span>' : ''}
            </div>
            <div class="multi-preview" style="display:none;">
              <strong>👥 多人村民：</strong><br>
              ${multiConfig ? multiConfig.villagers.map(v => `• ${v.name}（${v.personality}）`).join('<br>') : '暂无配置，将使用默认村民'}
            </div>
          </div>
          ${roleSelectorHtml}
          <button class="start-simulate" data-id="${s.id}" style="background:#2e5d34; color:white; border:none; border-radius:30px; padding:8px 16px; width:100%; cursor:pointer; margin-top:8px;">开始对练</button>
        </div>
      `;
    });
    html += `</div>`;
    document.getElementById('dynamicContent').innerHTML = html;

    document.querySelectorAll('.scenario-card').forEach(card => {
      const modeSelect = card.querySelector('.mode-select');
      const singlePreview = card.querySelector('.single-preview');
      const multiPreview = card.querySelector('.multi-preview');
      modeSelect.addEventListener('change', () => {
        if (modeSelect.value === 'multi') {
          singlePreview.style.display = 'none';
          multiPreview.style.display = 'block';
        } else {
          singlePreview.style.display = 'block';
          multiPreview.style.display = 'none';
        }
      });
    });

    document.querySelectorAll('.start-simulate').forEach(btn => {
      btn.onclick = () => {
        const card = btn.closest('.scenario-card');
        const scenarioId = card.dataset.id;
        const diff = card.querySelector('.difficulty-select').value;
        const mode = card.querySelector('.mode-select').value;
        const timeLimit = parseInt(card.querySelector('.time-limit-input').value) || null;
        startSimulate(scenarioId, diff, mode, timeLimit);
      };
    });
    setActiveNavByView('simulate');
    return;
  }

  const sessionRes = await fetchWithAuth(`/api/session/${appState.currentSessionId}`);
  const session = await sessionRes.json();
  renderSimulateChat(session);
}

async function startSimulate(scenarioId, difficulty, mode = 'single', timeLimit = null) {
  try {
    simulateMode = mode;
    roundRobinDone = false;
    manualUserMessageCount = 0;
    if (scenarioGuideState[scenarioId]) {
      scenarioGuideState[scenarioId] = { stage: 0, lastSatisfaction: 50, triggeredFlags: new Set() };
    }

    let roleId = null;
    if (mode === 'single') {
      const card = document.querySelector(`.scenario-card[data-id="${scenarioId}"]`);
      if (card) {
        const roleSelect = card.querySelector('.single-role-select');
        if (roleSelect) roleId = roleSelect.value;
      }
    }

    const res = await fetchWithAuth('/api/simulate/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenarioId, difficulty, timeLimit, roleId })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    const sessionRes = await fetchWithAuth(`/api/session/${data.sessionId}`);
    const session = await sessionRes.json();
    if (!session.messages) session.messages = [];
    appState.sessions.push(session);
    const { renderSessionList } = await import('./ui');
    renderSessionList();
    appState.currentSessionId = data.sessionId;
    appState.currentView = 'simulate';

    if (mode === 'multi') {
      const multiConfig = scenarioMultiConfig[scenarioId];
      if (multiConfig && multiConfig.villagers) {
        currentMultiVillagers = multiConfig.villagers.map(v => ({ ...v, satisfaction: 50, emotion: 'neutral' }));
      } else {
        currentMultiVillagers = [
          { id: 'v1', name: '村民甲', avatar: '👤', personality: '普通', coreDemand: '', initialStance: '中立', satisfaction: 50, emotion: 'neutral' },
          { id: 'v2', name: '村民乙', avatar: '👤', personality: '普通', coreDemand: '', initialStance: '中立', satisfaction: 50, emotion: 'neutral' },
          { id: 'v3', name: '村民丙', avatar: '👤', personality: '普通', coreDemand: '', initialStance: '中立', satisfaction: 50, emotion: 'neutral' }
        ];
      }
      currentTargetVillager = currentMultiVillagers[0];
    } else {
      currentMultiVillagers = [];
      currentTargetVillager = null;
    }

    renderSimulateChat(session);
    startPollingStatus(data.sessionId);
    startRandomEvents(data.sessionId);
  } catch(err) {
    alert('启动失败：' + err.message);
  }
}

async function startRoundRobin(sessionId, villagers, container, roleName, loadingMsgElement = null) {
  for (let i = 0; i < villagers.length; i++) {
    const v = villagers[i];
    try {
      await sendSimulateMessage(sessionId, `请${v.name}介绍一下自己的立场和诉求。`, container, roleName, v, true);
    } catch(e) { console.warn(`自动发言失败: ${v.name}`, e); }
    await new Promise(r => setTimeout(r, 1500));
  }
  if (loadingMsgElement) loadingMsgElement.remove();
  const sysMsgDiv = document.createElement('div');
  sysMsgDiv.className = 'simulate-message system';
  sysMsgDiv.innerHTML = `<div class="simulate-message-bubble" style="background:#e3f2fd; color:#1565c0;">✅ 对练正式开始，请尝试与村民沟通。</div>`;
  container.appendChild(sysMsgDiv);
  scrollSimulate();
}

// 让指定角色主动发言（模拟对练中切换角色后自动发言）
async function speakAsVillager(villager, contextHint = '') {
  if (!currentTargetVillager) return;
  const container = document.getElementById('simulateMessages');
  if (!container) return;

  const recentMessages = Array.from(container.querySelectorAll('.simulate-message'))
    .slice(-5)
    .map(msg => msg.querySelector('.simulate-message-content')?.innerText || '')
    .filter(t => t.trim())
    .join('\n');
  const currentAgenda = '当前对话';
  let prompt = `当前议题：${currentAgenda}。`;
  if (recentMessages) prompt += `\n最近对话内容：${recentMessages.substring(0, 300)}`;
  if (contextHint) prompt += `\n${contextHint}`;
  else prompt += `\n请结合你的立场（${villager.initialStance}）和核心诉求（${villager.coreDemand || '无'}），主动发表你对当前话题的看法。`;

  const thinkingMsg = document.createElement('div');
  thinkingMsg.className = 'simulate-message assistant thinking-message';
  thinkingMsg.innerHTML = `<div class="simulate-message-avatar">${villager.avatar}</div><div class="simulate-message-bubble">💭 ${villager.name} 思考中...</div>`;
  container.appendChild(thinkingMsg);
  scrollSimulate();

  try {
    const res = await fetchWithAuth('/api/simulate/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: appState.currentSessionId,
        message: prompt,
        villager: { name: villager.name, personality: villager.personality }
      })
    });
    const data = await res.json();
    thinkingMsg.remove();
    const reply = data.reply || `${villager.name}：嗯，我再想想。`;
    const finalMsg = createSimulateMessageElement('assistant', villager.name, villager.avatar, reply, data.emotion || 'neutral', data.satisfaction);
    container.appendChild(finalMsg);
    scrollSimulate();
    if (data.satisfaction !== undefined) {
      // 更新满意度显示（如果有的话）
      const satisfactionDiv = document.querySelector('.single-satisfaction');
      if (satisfactionDiv) satisfactionDiv.textContent = `${data.satisfaction}%`;
    }
  } catch (err) {
    console.error('主动发言失败', err);
    thinkingMsg.innerHTML = `<div class="simulate-message-avatar">${villager.avatar}</div><div class="simulate-message-bubble">⚠️ ${villager.name} 暂时无法发言</div>`;
    setTimeout(() => thinkingMsg.remove(), 2000);
  }
}

export async function renderSimulateChat(session) {
  if (statusPollInterval) clearInterval(statusPollInterval);
  if (eventInterval) clearInterval(eventInterval);
  isSending = false;

  const scenariosRes = await fetchWithAuth('/api/simulate/scenarios');
  const scenarios = await scenariosRes.json();
  let extra = {};
  if (session.scenarioId) {
    try { extra = JSON.parse(session.scenarioId); } catch(e) { extra = { stages: [], satisfaction: 50, villagersState: {} }; }
  }
  const scenarioId = extra.scenarioId || session.scenarioId;
  const scenario = scenarios.find(s => s.id === scenarioId);
  if (!scenario) {
    document.getElementById('dynamicContent').innerHTML = `<div><p>场景不存在</p><button id="backBtn">返回</button></div>`;
    document.getElementById('backBtn').onclick = () => renderSimulateView(true);
    setActiveNavByView('simulate');
    return;
  }

  const satisfaction = extra.satisfaction || 50;
  const villagersState = extra.villagersState || {};
  let currentMode = simulateMode;
  let villagers = [];
  let systemOpening = '';
  let stages = extra.stages || [];
  const config = scenarioMultiConfig[scenario.id];
  if (stages.length === 0 && config && config.agendaNames) {
    stages = config.agendaNames.map(name => ({ name, completed: false }));
  }
  const currentStageIndex = stages.findIndex(s => !s.completed);
  const completedCount = stages.filter(s => s.completed).length;
  const totalStages = stages.length;

  const singleRole = extra.singleRole;
  let roleInfoHtml = '';
  let displayRoleName = scenario.role;
  if (currentMode === 'single' && singleRole) {
    displayRoleName = singleRole.name;
    roleInfoHtml = `
      <div style="background:#e3f2fd; padding:6px 12px; border-radius:8px; margin-bottom:8px; display:flex; align-items:center; gap:8px;">
        <span style="font-size:1.2rem;">${singleRole.avatar}</span>
        <div><strong>${escapeHtml(singleRole.name)}</strong><br><span style="font-size:0.7rem;">${escapeHtml(singleRole.personality)} | 诉求：${escapeHtml(singleRole.coreDemand || '无')}</span></div>
      </div>
    `;
  }

  if (currentMode === 'multi' && currentMultiVillagers.length) {
    villagers = currentMultiVillagers.map(v => ({ ...v, satisfaction: villagersState[v.name]?.satisfaction ?? 50, emotion: villagersState[v.name]?.emotion ?? 'neutral' }));
    if (!currentTargetVillager && villagers.length) currentTargetVillager = villagers[0];
    if (config) {
      systemOpening = `🏛️ 【场景介绍】${config.description}\n👥 参会人员：${config.villagers.map(v => v.name).join('、')}\n📌 目标：${scenario.goal}`;
    } else {
      systemOpening = `🏛️ 【场景介绍】${scenario.description}\n👥 参会人员：${villagers.map(v => v.name).join('、')}\n📌 目标：${scenario.goal}`;
    }
  } else {
    currentMode = 'single';
    villagers = [{ name: displayRoleName, avatar: singleRole?.avatar || (scenario.role.includes('村民') ? '👵' : '🤖'), personality: singleRole?.personality || '', satisfaction, emotion: extra.emotion || 'neutral' }];
    currentTargetVillager = null;
    systemOpening = `🏛️ 【场景介绍】${scenario.description}\n👤 对话角色：${displayRoleName}\n📌 目标：${scenario.goal}`;
  }

  const isMobile = window.innerWidth <= 768;
  const dynamicContent = document.getElementById('dynamicContent');

  const renderProgressIndicator = () => {
    if (totalStages === 0) return '';
    if (isMobile) {
      return `
        <div class="agenda-progress-mobile" style="background:#f5f5f5; padding:6px 10px; font-size:0.7rem; border-bottom:1px solid #eee;">
          📋 流程：${stages.map((s, i) => s.completed ? `✅ ${s.name}` : (i === currentStageIndex ? `⏳ ${s.name}` : `⬚ ${s.name}`)).join(' → ')}
        </div>
      `;
    } else {
      return `
        <div class="agenda-progress-container" style="background:#f9f9f9; padding:8px 12px; border-bottom:1px solid #eee;">
          <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
            <div style="font-size:0.8rem; font-weight:bold;">📋 调解流程：</div>
            <div style="flex:1; display:flex; gap:8px; flex-wrap:wrap;">
              ${stages.map((stage, idx) => `
                <div style="display:flex; align-items:center; gap:4px;">
                  <span style="width:24px; height:24px; border-radius:50%; background:${stage.completed ? '#4caf50' : (idx === currentStageIndex ? '#ff9800' : '#e0e0e0')}; color:white; display:inline-flex; align-items:center; justify-content:center; font-size:12px; font-weight:bold;">${idx+1}</span>
                  <span class="agenda-item ${stage.completed ? 'completed' : (idx === currentStageIndex ? 'current' : '')}" style="font-size:0.75rem; ${stage.completed ? 'text-decoration:line-through; color:#888;' : (idx === currentStageIndex ? 'color:#2e5d34; font-weight:bold;' : 'color:#333;')}">${stage.name}</span>
                </div>
              `).join('')}
            </div>
            <div style="font-size:0.7rem; color:#666;">进度：<span class="agenda-progress-text">${completedCount}/${totalStages}</span></div>
          </div>
          <div class="agenda-progress-bar" style="background:#eee; border-radius:4px; height:6px; margin-top:6px;"><div class="agenda-progress-fill" style="width:${(completedCount/totalStages)*100}%; background:#4caf50; height:6px; border-radius:4px;"></div></div>
        </div>
      `;
    }
  };

  const hasReport = extra.report && extra.isFinished;
  const viewReportBtnHtml = hasReport ? `<button id="viewReportBtn" class="summary-btn" style="background:#ff9800; color:white;">📋 查看本次对练报告</button>` : '';

  // 桌面端布局
  if (!isMobile) {
    const showSidebar = (currentMode === 'multi');
    dynamicContent.innerHTML = `
      <div class="simulate-view" style="display:flex; flex-direction:column; height:100%;">
        <div class="simulate-toolbar" style="background:white; border-bottom:1px solid #eee; padding:8px 12px;">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
            <div style="display:flex; gap:8px;">
              <button id="backToListBtn" class="summary-btn" style="background:#f0f0f0;">← 返回</button>
              <button id="hintBtn" class="summary-btn">💡 提示</button>
              <button id="finishSimulateBtn" class="summary-btn" style="background:#4caf50; color:white;">结束并查看报告</button>
              ${viewReportBtnHtml}
              <button id="voiceCallBtn" class="summary-btn" style="background:#2196f3; color:white;">🎤 语音通话</button>
            </div>
            <div style="font-size:0.8rem; color:#666;">
              <span style="background:#f0f0f0; padding:2px 8px; border-radius:20px;">${escapeHtml(scenario.title)}</span>
              <span style="margin-left:8px; background:#e3f2fd; padding:2px 8px; border-radius:20px;">${currentMode === 'multi' ? '👥 多人模式' : `👤 ${displayRoleName}`}</span>
            </div>
            <div id="simulateStatus" style="font-size:0.8rem;">满意度：${satisfaction}%</div>
          </div>
          <div style="font-size:0.75rem; color:#888; margin-top:4px;">${escapeHtml(scenario.description)}</div>
        </div>
        ${renderProgressIndicator()}
        <div style="display:flex; flex:1; overflow:hidden;">
          ${showSidebar ? `
          <div class="simulate-villager-sidebar" style="width:160px; background:#f5f5f5; border-right:1px solid #ddd; overflow-y:auto; padding:8px;">
            <h4 style="text-align:center; margin-bottom:8px;">👥 村民</h4>
            <div id="villagerList">
              ${villagers.map(v => `
                <div class="villager-item" data-name="${v.name}" style="padding:8px; margin-bottom:8px; background:white; border-radius:12px; cursor:pointer; text-align:center; ${currentTargetVillager && currentTargetVillager.name === v.name ? 'border:2px solid #2e5d34;' : 'border:1px solid #eee;'}">
                  <div style="font-size:1.8rem;">${v.avatar}</div>
                  <div style="font-weight:bold;">${escapeHtml(v.name)}</div>
                  <div class="villager-satisfaction" style="font-size:0.7rem;">满意度: ${v.satisfaction}%</div>
                  <div class="villager-emotion" style="font-size:0.7rem;">${getEmotionIcon(v.emotion)}</div>
                  <div class="satisfaction-bar" style="background:#eee; border-radius:4px; height:4px; margin-top:4px;"><div class="satisfaction-fill" style="width:${v.satisfaction}%; background:#4caf50; height:4px; border-radius:4px;"></div></div>
                  <div class="villager-core" style="font-size:0.65rem; color:#666; margin-top:4px;">💬 ${escapeHtml(v.coreDemand || '')}</div>
                </div>
              `).join('')}
            </div>
          </div>
          ` : ''}
          <div class="simulate-chat-container" style="flex:1; display:flex; flex-direction:column; overflow:hidden;">
            <div id="simulateMessagesContainer" style="flex:1; overflow-y:auto; padding:16px;">
              ${roleInfoHtml}
              <div id="simulateMessages"></div>
            </div>
            <div class="simulate-input-area" style="border-top:1px solid #eee; padding:12px; background:white;">
              <div style="display:flex; gap:8px; align-items:center;">
                <textarea id="simulateInput" placeholder="${currentMode === 'multi' ? `对 ${currentTargetVillager ? currentTargetVillager.name : '村民'} 说...` : '输入你的回应...'}" rows="1" style="flex:1; padding:8px 12px; border-radius:24px; border:1px solid #ccc; resize:none; font-family:inherit; min-height:40px;"></textarea>
                <button id="simulateVoiceBtn" class="voice-btn" style="background:#f0f0f0; border:none; border-radius:30px; padding:0 16px; height:40px;">🎤</button>
                <button id="simulateSendBtn" style="background:#2e5d34; color:white; border:none; border-radius:30px; padding:0 20px; height:40px;">发送</button>
                <button id="forceStageBtn" style="background:#ff9800; color:white; border:none; border-radius:30px; padding:0 16px; height:40px;">⏩ 强制推进</button>
              </div>
              <div id="inputTip" style="font-size:0.7rem; color:#ff9800; margin-top:4px;"></div>
            </div>
          </div>
        </div>
      </div>
    `;
  } else {
    dynamicContent.innerHTML = `
      <div class="simulate-view" style="display:flex; flex-direction:column; height:100%;">
        <div class="simulate-toolbar" style="background:white; border-bottom:1px solid #eee; padding:6px 10px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div style="display:flex; gap:6px;">
              <button id="backToListBtn" class="summary-btn" style="background:#f0f0f0; padding:4px 8px; font-size:11px;">← 返回</button>
              <button id="hintBtn" class="summary-btn" style="padding:4px 8px; font-size:11px;">💡 提示</button>
              <button id="finishSimulateBtn" class="summary-btn" style="background:#4caf50; color:white; padding:4px 8px; font-size:11px;">结束</button>
              ${viewReportBtnHtml}
              <button id="voiceCallBtn" class="summary-btn" style="background:#2196f3; color:white; padding:4px 8px; font-size:11px;">🎤</button>
            </div>
            <div style="font-size:11px; color:#666;">${escapeHtml(scenario.title)}</div>
          </div>
        </div>
        ${renderProgressIndicator()}
        <div class="villager-tabs" id="villagerTabs" style="display:flex; overflow-x:auto; gap:8px; padding:8px 10px; background:white; border-bottom:1px solid #eee;">
          ${villagers.map(v => `
            <div class="villager-tab ${currentTargetVillager && currentTargetVillager.name === v.name ? 'active' : ''}" data-name="${v.name}" style="flex-shrink:0; padding:4px 12px; background:#f0f0f0; border-radius:20px; font-size:12px;">
              ${v.avatar} ${v.name}
              <span class="satisfaction-badge" style="margin-left:4px; font-size:10px;">${v.satisfaction}%</span>
            </div>
          `).join('')}
        </div>
        <div class="simulate-chat-container" style="flex:1; display:flex; flex-direction:column; overflow:hidden;">
          <div id="simulateMessagesContainer" style="flex:1; overflow-y:auto; padding:8px;">
            ${roleInfoHtml}
            <div id="simulateMessages"></div>
          </div>
          <div class="simulate-input-area" style="border-top:1px solid #eee; padding:8px; background:white;">
            <div style="display:flex; gap:6px; align-items:center;">
              <textarea id="simulateInput" placeholder="输入你的回应..." rows="1" style="flex:1; padding:6px 10px; border-radius:20px; border:1px solid #ccc; resize:none; font-family:inherit; min-height:32px; font-size:13px;"></textarea>
              <button id="simulateVoiceBtn" class="voice-btn" style="background:#f0f0f0; border:none; border-radius:30px; width:36px; height:36px; font-size:16px;">🎤</button>
              <button id="simulateSendBtn" style="background:#2e5d34; color:white; border:none; border-radius:30px; padding:0 12px; height:36px; font-size:12px;">发送</button>
              <button id="forceStageBtn" style="background:#ff9800; color:white; border:none; border-radius:30px; padding:0 12px; height:36px; font-size:12px;">⏩</button>
            </div>
            <div id="inputTip" style="font-size:10px; color:#ff9800; margin-top:4px;"></div>
          </div>
        </div>
      </div>
    `;
  }

  // 绑定基础事件
  const backBtn = document.getElementById('backToListBtn');
  if (backBtn) {
    backBtn.onclick = () => {
      if (statusPollInterval) clearInterval(statusPollInterval);
      if (eventInterval) clearInterval(eventInterval);
      statusPollInterval = null;
      eventInterval = null;
      isSending = false;
      appState.currentSessionId = null;
      renderSimulateView(true);
    };
  }

  const finishBtn = document.getElementById('finishSimulateBtn');
  if (finishBtn) {
    finishBtn.onclick = async () => {
      if (isSending || generatingReport) return;
      generatingReport = true;
      const originalText = finishBtn.textContent;
      finishBtn.disabled = true;
      finishBtn.textContent = '📄 报告生成中，请稍后...';
      try {
        const res = await fetchWithAuth('/api/simulate/finish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: session.id })
        });
        const reportData = await res.json();
        if (!res.ok) throw new Error(reportData.error);
        if (statusPollInterval) clearInterval(statusPollInterval);
        if (eventInterval) clearInterval(eventInterval);
        statusPollInterval = null;
        eventInterval = null;
        const report = reportData.report || {};
        const finalScore = reportData.finalScore || 0;
        const satisfactionVal = reportData.satisfaction || 50;
        const stagesCompleted = reportData.stagesCompleted || 0;
        const totalStages = reportData.totalStages || 0;
        showReportModal(report, finalScore, satisfactionVal, stagesCompleted, totalStages);
        appState.currentSessionId = null;
        await renderSimulateView(true);
        if (finalScore >= 80) showCelebration(window.innerWidth/2, window.innerHeight/2);
        window.refreshGrowthChart?.();
        const { loadSessions } = await import('./state');
        await loadSessions();
      } catch(err) {
        alert('生成报告失败：' + err.message);
      } finally {
        finishBtn.disabled = false;
        finishBtn.textContent = originalText;
        generatingReport = false;
      }
    };
  }

  const hintBtn = document.getElementById('hintBtn');
  if (hintBtn) {
    hintBtn.onclick = async () => {
      if (isSending) return;
      hintBtn.disabled = true;
      const loading = document.createElement('div');
      loading.className = 'simulate-message assistant';
      loading.innerHTML = '<div class="simulate-message-bubble">🤔生成提示...</div>';
      const containerMsg = document.getElementById('simulateMessages');
      containerMsg.appendChild(loading);
      scrollSimulate();
      try {
        const res = await fetchWithAuth('/api/chat/summarize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: session.id })
        });
        const data = await res.json();
        const summary = data.summary;
        let hint = '💡建议：\n';
        if (summary.suggestions && summary.suggestions.length) hint += summary.suggestions.map(s => `- ${s}`).join('\n');
        else hint += '尝试更耐心地沟通。';
        loading.innerHTML = `<div class="simulate-message-bubble">${escapeHtml(hint)}</div>`;
      } catch(e) {
        loading.innerHTML = '<div class="simulate-message-bubble">⚠️提示失败</div>';
      } finally {
        hintBtn.disabled = false;
        scrollSimulate();
      }
    };
  }

  const forceStageBtn = document.getElementById('forceStageBtn');
  if (forceStageBtn) {
    forceStageBtn.onclick = async () => {
      if (!confirm('强制推进当前议程？这会将当前阶段标记为完成。')) return;
      try {
        const res = await fetchWithAuth('/api/simulate/force-stage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: session.id })
        });
        const data = await res.json();
        if (data.success) {
          alert(`已强制完成“${data.completedStage}”阶段，剩余 ${data.remainingStages} 个阶段。`);
          const sessionRes = await fetchWithAuth(`/api/session/${session.id}`);
          const newSession = await sessionRes.json();
          const index = appState.sessions.findIndex(s => s.id === session.id);
          if (index !== -1) appState.sessions[index] = newSession;
          await renderSimulateChat(newSession);
        } else {
          alert('强制推进失败：' + (data.error || '未知错误'));
        }
      } catch(err) {
        alert('强制推进失败：' + err.message);
      }
    };
  }

  const viewReportBtn = document.getElementById('viewReportBtn');
  if (viewReportBtn) {
    viewReportBtn.onclick = async () => {
      try {
        const res = await fetchWithAuth(`/api/simulate/report/${session.id}`);
        if (!res.ok) throw new Error('获取报告失败');
        const data = await res.json();
        let finalScore = data.finalScore;
        if (finalScore < 10 && finalScore > 0) finalScore = Math.round(finalScore * 20);
        showReportModal(data.report, finalScore, data.satisfaction, data.stagesCompleted, data.totalStages);
      } catch(err) {
        alert('无法加载报告：' + err.message);
      }
    };
  }

  // 语音通话按钮 - 使用 PTT 模式
  let voiceCallUI = null;
  let voiceCallActive = false;
  const voiceCallBtn = document.getElementById('voiceCallBtn');
  if (voiceCallBtn) {
    voiceCallBtn.onclick = async () => {
      if (voiceCallUI) {
        await stopVoiceCall();
        voiceCallUI.hide();
        voiceCallUI = null;
        voiceCallActive = false;
        voiceCallBtn.textContent = isMobile ? '🎤' : '🎤 语音通话';
        voiceCallBtn.style.background = '#2196f3';
        if (window.appendUserMessageToChat) delete window.appendUserMessageToChat;
      } else {
        const roomId = Math.abs(session.id.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0)) % 1000000;
        let participantsList = [];
        let currentRoleName = '';
        let uiMode = 'single';

        if (currentMode === 'single' && singleRole) {
          uiMode = 'single';
          currentRoleName = singleRole.name;
          participantsList = [];
        } else if (currentMode === 'multi') {
          uiMode = 'multi';
          participantsList = currentMultiVillagers.map(v => ({
            name: v.name,
            avatar: v.avatar,
            satisfaction: v.satisfaction,
            stance: v.initialStance
          }));
          currentRoleName = currentTargetVillager?.name || participantsList[0]?.name;
        }

        window.appendUserMessageToChat = (text) => {
          const container = document.getElementById('simulateMessages');
          if (container) {
            const userMsg = createSimulateMessageElement('user', '村官', '👨‍🌾', text, 'neutral');
            container.appendChild(userMsg);
            scrollSimulate();
          }
        };

        voiceCallUI = createVoiceCallUI(uiMode, {
          roleName: currentMode === 'single' ? singleRole?.name : currentRoleName,
          roleAvatar: currentMode === 'single' ? singleRole?.avatar : null,
          rolePersonality: currentMode === 'single' ? singleRole?.personality : null,
          roleCoreDemand: currentMode === 'single' ? singleRole?.coreDemand : null,
          participants: participantsList,
          currentParticipantName: currentRoleName,
          userName: '村官',
          userAvatar: '👨‍🌾',
          onHangup: async () => {
            await stopVoiceCall();
            voiceCallUI.hide();
            voiceCallUI = null;
            voiceCallActive = false;
            voiceCallBtn.textContent = isMobile ? '🎤' : '🎤 语音通话';
            voiceCallBtn.style.background = '#2196f3';
            if (window.appendUserMessageToChat) delete window.appendUserMessageToChat;
          },
          onMuteToggle: async (muted) => {
            await toggleMute(muted);
          },
          onParticipantSelect: async (newRoleName) => {
            if (!voiceCallUI) return;
            const success = await restartRobot({
              sceneType: 'simulate',
              sessionId: session.id,
              roleName: newRoleName
            });
            if (success) {
              voiceCallUI.updateParticipants(participantsList, newRoleName);
              if (currentMode === 'multi') {
                const newTarget = currentMultiVillagers.find(v => v.name === newRoleName);
                if (newTarget) {
                  currentTargetVillager = newTarget;
                  const inputEl = document.getElementById('simulateInput');
                  if (inputEl) inputEl.placeholder = `对 ${newTarget.name} 说...`;
                  // 切换后主动让新角色发言
                  await speakAsVillager(newTarget, `你刚刚被选为对话对象，请针对当前话题发表你的看法。`);
                }
              } else if (currentMode === 'single' && singleRole) {
                // 单人模式切换角色后也主动发言
                await speakAsVillager({ ...singleRole, name: newRoleName, avatar: singleRole.avatar, personality: singleRole.personality, initialStance: singleRole.initialStance, coreDemand: singleRole.coreDemand }, `你刚刚被选为对话对象，请针对当前话题发表你的看法。`);
              }
            } else {
              alert('切换角色失败，请重试');
            }
          }
        });

        voiceCallUI.show();
        voiceCallUI.updateStatus('connecting');

        const success = await startVoiceCall({
          roomId,
          sceneType: 'simulate',
          sessionId: session.id,
          roleName: currentRoleName,
          onRemoteAudioReady: () => voiceCallUI.updateStatus('ai_speaking'),
          onVolumeChange: (vol) => voiceCallUI.updateVolume(vol),
          onStatusChange: (status) => voiceCallUI.updateStatus(status)
        });

        if (success) {
          voiceCallActive = true;
          voiceCallBtn.textContent = isMobile ? '🔴' : '🔴 挂断';
          voiceCallBtn.style.background = '#f44336';
        } else {
          voiceCallUI.hide();
          voiceCallUI = null;
          alert('无法启动语音通话，请检查网络');
          if (window.appendUserMessageToChat) delete window.appendUserMessageToChat;
        }
      }
    };
  }

  // 发送消息逻辑
  const sendBtn = document.getElementById('simulateSendBtn');
  const input = document.getElementById('simulateInput');
  const voiceBtn = document.getElementById('simulateVoiceBtn');
  const messagesContainer = document.getElementById('simulateMessages');

  const getShortMessageHint = (scenarioId) => {
    const hints = {
      'scenario_001': '例如：我们先去村委会查土地确权档案，再请老党员一起到现场测量。',
      'scenario_002': '例如：村里会发放分类垃圾桶，并安排专人指导，年底还有奖励。',
      'scenario_003': '例如：村里组织志愿者帮您清理，废品可以统一回收。',
      'scenario_004': '例如：我们先小范围试点，成功后再推广，风险可控。',
      'scenario_005': '例如：我建议双方约定晚上10点后停止打牌，加装隔音垫。'
    };
    return hints[scenarioId] || '例如：提出具体的解决方案或下一步行动。';
  };

  const sendMessage = async () => {
    if (isSending) return;
    const text = input.value.trim();
    if (!text) return;
    const shortWords = ['好', '嗯', '哦', '行', '走吧', '好的', '知道了', '可以', '对', '是', '没错', '嗯嗯', '哦哦'];
    const terminalPatterns = [/走吧/, /去吧/, /就这样/, /结束/, /不说了/, /行了/, /好了/];
    const isShort = text.length <= 4 && shortWords.some(w => text === w);
    const isTerminal = terminalPatterns.some(p => p.test(text));
    if (isShort || isTerminal) {
      const hintMsg = `💡 您的发言过于简短，请提出具体的下一步行动。${getShortMessageHint(scenario.id)}`;
      const hintDiv = document.createElement('div');
      hintDiv.className = 'simulate-message system';
      hintDiv.innerHTML = `<div class="simulate-message-bubble" style="background:#fff3cd; color:#856404;">${escapeHtml(hintMsg)}</div>`;
      messagesContainer.appendChild(hintDiv);
      scrollSimulate();
      input.value = text;
      return;
    }
    input.value = '';
    input.style.height = 'auto';
    let target = null;
    if (currentMode === 'multi' && currentTargetVillager) target = currentTargetVillager;
    await sendSimulateMessage(session.id, text, messagesContainer, displayRoleName, target, false, singleRole);
    checkScenarioGuides(scenario.id, satisfaction, text, manualUserMessageCount);
  };

  if (sendBtn) sendBtn.onclick = sendMessage;
  if (input) {
    input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey && !isSending) { e.preventDefault(); sendMessage(); } };
    input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(80, input.scrollHeight) + 'px'; });
  }
  if (voiceBtn) setupVoiceInput(input, voiceBtn);

  // 多人模式切换村民（桌面端侧边栏）
  if (!isMobile && currentMode === 'multi') {
    const sidebarItems = document.querySelectorAll('.villager-item');
    sidebarItems.forEach(item => {
      item.onclick = () => {
        const name = item.dataset.name;
        const newTarget = villagers.find(v => v.name === name);
        if (newTarget) {
          currentTargetVillager = newTarget;
          input.placeholder = `对 ${newTarget.name} 说...`;
          sidebarItems.forEach(i => i.style.border = '1px solid #eee');
          item.style.border = '2px solid #2e5d34';
          if (voiceCallUI) {
            restartRobot({
              sceneType: 'simulate',
              sessionId: session.id,
              roleName: newTarget.name
            }).then(success => {
              if (success && voiceCallUI) {
                const participantsList = currentMultiVillagers.map(v => ({
                  name: v.name,
                  avatar: v.avatar,
                  satisfaction: v.satisfaction,
                  stance: v.initialStance
                }));
                voiceCallUI.updateParticipants(participantsList, newTarget.name);
                // 切换后主动发言
                speakAsVillager(newTarget, `你刚刚被选为对话对象，请针对当前话题发表你的看法。`);
              }
            });
          } else {
            speakAsVillager(newTarget, `你刚刚被选为对话对象，请针对当前话题发表你的看法。`);
          }
        }
      };
    });
  }

  // 多人模式移动端标签切换
  if (isMobile && currentMode === 'multi') {
    const tabs = document.querySelectorAll('.villager-tab');
    tabs.forEach(tab => {
      tab.onclick = async () => {
        const name = tab.dataset.name;
        const newTarget = villagers.find(v => v.name === name);
        if (newTarget) {
          currentTargetVillager = newTarget;
          if (input) input.placeholder = `对 ${newTarget.name} 说...`;
          tabs.forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          const lastUserMsg = Array.from(messagesContainer.querySelectorAll('.simulate-message.user')).pop();
          const lastUserText = lastUserMsg ? lastUserMsg.querySelector('.simulate-message-content').innerText : '当前议题';
          await sendSimulateMessage(session.id, `针对刚才提到的"${lastUserText}"，请${newTarget.name}说说你的看法。`, messagesContainer, displayRoleName, newTarget, true);
          if (voiceCallUI) {
            restartRobot({
              sceneType: 'simulate',
              sessionId: session.id,
              roleName: newTarget.name
            }).then(success => {
              if (success && voiceCallUI) {
                const participantsList = currentMultiVillagers.map(v => ({
                  name: v.name,
                  avatar: v.avatar,
                  satisfaction: v.satisfaction,
                  stance: v.initialStance
                }));
                voiceCallUI.updateParticipants(participantsList, newTarget.name);
                speakAsVillager(newTarget, `你刚刚被选为对话对象，请针对当前话题发表你的看法。`);
              }
            });
          } else {
            speakAsVillager(newTarget, `你刚刚被选为对话对象，请针对当前话题发表你的看法。`);
          }
        }
      };
    });
  }

  // 开场白
  const hasSystemMsg = session.messages.some(m => m.role === 'system');
  if (!hasSystemMsg && systemOpening) {
    const sysDiv = document.createElement('div');
    sysDiv.className = 'simulate-message system';
    sysDiv.innerHTML = `<div class="simulate-message-bubble" style="background:#e3f2fd; color:#1565c0;">📢 ${escapeHtml(systemOpening)}</div>`;
    messagesContainer.appendChild(sysDiv);
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'simulate-message system';
    loadingDiv.innerHTML = `<div class="simulate-message-bubble" style="background:#fff3cd; color:#856404;">⏳ 场景加载中，请稍候...</div>`;
    messagesContainer.appendChild(loadingDiv);
    scrollSimulate();
    if (!roundRobinDone) {
      roundRobinDone = true;
      await startRoundRobin(session.id, villagers, messagesContainer, displayRoleName, loadingDiv);
    } else {
      loadingDiv.remove();
      const startDiv = document.createElement('div');
      startDiv.className = 'simulate-message system';
      startDiv.innerHTML = `<div class="simulate-message-bubble" style="background:#e3f2fd; color:#1565c0;">✅ 对练正式开始，请尝试与村民沟通。</div>`;
      messagesContainer.appendChild(startDiv);
      scrollSimulate();
    }
  }

  // 加载历史消息
  let lastMsgContent = '';
  session.messages.forEach(msg => {
    if (msg.role === 'system') {
      if (msg.content === systemOpening) return;
      const sysDiv = document.createElement('div');
      sysDiv.className = 'simulate-message system';
      sysDiv.innerHTML = `<div class="simulate-message-bubble" style="background:#e3f2fd; color:#1565c0;">📢 ${escapeHtml(msg.content)}</div>`;
      messagesContainer.appendChild(sysDiv);
      return;
    }
    if (msg.content === lastMsgContent) return;
    lastMsgContent = msg.content;
    let speakerName = '';
    let speakerAvatar = '';
    let emotion = 'neutral';
    if (msg.role === 'user') {
      speakerName = '村官';
      speakerAvatar = '👨‍🌾';
    } else {
      const colonIndex = msg.content.indexOf('：');
      if (colonIndex > 0 && colonIndex < 30) {
        speakerName = msg.content.substring(0, colonIndex);
        msg.displayContent = msg.content.substring(colonIndex + 1);
      } else {
        speakerName = currentMode === 'multi' ? (currentTargetVillager?.name || '村民') : displayRoleName;
        msg.displayContent = msg.content;
      }
      speakerAvatar = speakerName.includes('张') ? '👴' : (speakerName.includes('李') ? '👵' : '👤');
      if (msg.content.includes('谢谢')) emotion = 'happy';
      else if (msg.content.includes('生气') || msg.content.includes('凭什么')) emotion = 'angry';
      else if (msg.content.includes('难过')) emotion = 'sad';
    }
    const displayContent = msg.displayContent || msg.content;
    const msgDiv = createSimulateMessageElement(msg.role === 'user' ? 'user' : 'assistant', speakerName, speakerAvatar, displayContent, emotion, undefined, msg.messageId);
    messagesContainer.appendChild(msgDiv);
  });
  scrollSimulate();

  let debounceTimer;
  if (input) {
    input.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        const text = e.target.value.trim();
        if (text.length < 3) { document.getElementById('inputTip').innerHTML = ''; return; }
        try {
          const res = await fetchWithAuth('/api/simulate/analyze-input', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, scenarioId: scenario.id })
          });
          const data = await res.json();
          const tipContainer = document.getElementById('inputTip');
          if (tipContainer) tipContainer.innerHTML = (data.tips || []).map(t => `<div>${escapeHtml(t)}</div>`).join('');
        } catch(e) { console.warn(e); }
      }, 800);
    });
  }

  setActiveNavByView('simulate');
}