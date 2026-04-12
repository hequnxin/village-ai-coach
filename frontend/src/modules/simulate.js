// frontend/src/modules/simulate.js
import { fetchWithAuth } from '../utils/api';
import { appState, switchSession } from './state';
import { escapeHtml, playSound, updateTaskProgress, setupVoiceInput, setActiveNavByView, showCelebration } from '../utils/helpers';

let currentScenario = null;
let currentMultiVillagers = [];
let simulateMode = 'single';
let isTyping = false;
let statusPollInterval = null;
let eventInterval = null;
let currentTargetVillager = null;

// ==================== 场景多人模式村民配置（硬编码，可扩展） ====================
const scenarioMultiConfig = {
  'scenario_001': {
    title: '调解邻里土地纠纷',
    description: '村民张三和李四因宅基地边界发生争执，双方情绪激动，需要你作为村干部进行调解。',
    villagers: [
      { id: 'v1', name: '张三', avatar: '👨', personality: '暴躁、固执', coreDemand: '必须让对方退让，否则不罢休', initialStance: '反对', stanceValue: 0.1 },
      { id: 'v2', name: '李四', avatar: '👨', personality: '倔强、爱面子', coreDemand: '寸土不让，要求对方道歉', initialStance: '反对', stanceValue: 0.1 },
      { id: 'v3', name: '王婶', avatar: '👵', personality: '热心、和事佬', coreDemand: '希望双方和解，村里安宁', initialStance: '中立', stanceValue: 0.5 }
    ]
  },
  'scenario_002': {
    title: '推动垃圾分类',
    description: '村里推行垃圾分类，但很多村民不配合，甚至乱扔垃圾。你需要入户宣传，说服村民参与。',
    villagers: [
      { id: 'v1', name: '张大爷', avatar: '👴', personality: '固执、嫌麻烦', coreDemand: '不想多走路倒垃圾', initialStance: '反对', stanceValue: 0.2 },
      { id: 'v2', name: '李大妈', avatar: '👵', personality: '爱干净、支持', coreDemand: '希望村里统一规划', initialStance: '支持', stanceValue: 0.8 },
      { id: 'v3', name: '王叔', avatar: '👨', personality: '理性、观望', coreDemand: '担心费用和公平性', initialStance: '中立', stanceValue: 0.5 }
    ]
  },
  'scenario_003': {
    title: '人居环境整治（乱堆乱放）',
    description: '村民老赵在自家院外长期堆放柴草和废品，影响村容村貌，邻居投诉。你需上门劝导，动员清理。',
    villagers: [
      { id: 'v1', name: '老赵', avatar: '👨', personality: '倔强、爱占便宜', coreDemand: '不想花钱清理，觉得碍不着别人', initialStance: '反对', stanceValue: 0.2 },
      { id: 'v2', name: '刘婶', avatar: '👩', personality: '爱干净、爱管闲事', coreDemand: '要求村里强制清理', initialStance: '支持', stanceValue: 0.9 },
      { id: 'v3', name: '周会计', avatar: '🧑‍💼', personality: '理性、讲道理', coreDemand: '希望有公平的清理方案', initialStance: '中立', stanceValue: 0.5 }
    ]
  },
  'scenario_004': {
    title: '产业发展项目申报动员会',
    description: '村里想申请乡村振兴衔接资金发展特色农产品加工，但部分村民担心失败不愿配合。',
    villagers: [
      { id: 'v1', name: '李大叔', avatar: '👨', personality: '保守、担心', coreDemand: '怕投资打水漂', initialStance: '反对', stanceValue: 0.2 },
      { id: 'v2', name: '孙婶', avatar: '👩', personality: '积极、愿意尝试', coreDemand: '想多赚钱', initialStance: '支持', stanceValue: 0.9 },
      { id: 'v3', name: '周会计', avatar: '🧑‍💼', personality: '精明、算得清', coreDemand: '要看到详细财务预测', initialStance: '中立', stanceValue: 0.5 }
    ]
  },
  'scenario_005': {
    title: '邻里噪音纠纷调解',
    description: '村民小陈家晚上经常聚会打牌，邻居老刘多次投诉，双方产生口角。你前往调解。',
    villagers: [
      { id: 'v1', name: '小陈', avatar: '🧑', personality: '年轻、爱热闹', coreDemand: '不想被管太多', initialStance: '反对', stanceValue: 0.2 },
      { id: 'v2', name: '老刘', avatar: '👨', personality: '急躁、敏感', coreDemand: '要求立即停止噪音', initialStance: '反对', stanceValue: 0.1 },
      { id: 'v3', name: '王阿姨', avatar: '👵', personality: '热心、爱调解', coreDemand: '希望双方各退一步', initialStance: '中立', stanceValue: 0.5 }
    ]
  }
};

// ==================== 辅助函数 ====================
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

function createSimulateMessageElement(role, speakerName, speakerAvatar, content, emotion, satisfaction, messageId) {
  const msgDiv = document.createElement('div');
  msgDiv.className = `simulate-message ${role}`;
  if (messageId) msgDiv.dataset.messageId = messageId;
  const emotionIcon = getEmotionIcon(emotion);
  msgDiv.innerHTML = `
    <div class="simulate-message-avatar">${speakerAvatar}</div>
    <div class="simulate-message-bubble">
      <div class="simulate-message-speaker" style="font-weight:bold; margin-bottom:4px;">${escapeHtml(speakerName)}</div>
      <div class="simulate-message-content">${escapeHtml(content)}</div>
      ${satisfaction !== undefined ? `<div class="simulate-satisfaction-bar"><div style="width:${satisfaction}%;"></div></div>` : ''}
      <div class="simulate-emotion-icon">${emotionIcon}</div>
    </div>
  `;
  return msgDiv;
}

function updateSidebarStatus(data, villagerName = null) {
  if (!data) return;
  if (simulateMode === 'multi' && data.villagersState) {
    for (const [name, state] of Object.entries(data.villagersState)) {
      const card = document.querySelector(`.villager-item[data-name="${name}"]`);
      if (card) {
        const satSpan = card.querySelector('.villager-satisfaction');
        if (satSpan) satSpan.textContent = `满意度: ${state.satisfaction}%`;
        const emotionSpan = card.querySelector('.villager-emotion');
        if (emotionSpan) emotionSpan.textContent = getEmotionIcon(state.emotion);
        const fillDiv = card.querySelector('.satisfaction-fill');
        if (fillDiv) fillDiv.style.width = `${state.satisfaction}%`;
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
  const statusDiv = document.getElementById('simulateStatus');
  if (statusDiv && data.satisfaction !== undefined) {
    statusDiv.innerHTML = `满意度: ${data.satisfaction}%`;
  }
}

async function sendSimulateMessage(sessionId, text, container, typingIndicator, roleName, targetVillager = null) {
  const userMsg = createSimulateMessageElement('user', '村官', '👨‍🌾', text, 'neutral');
  container.appendChild(userMsg);
  scrollSimulate();
  isTyping = true;
  typingIndicator.classList.remove('hidden');
  setInputEnabled(false);
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
    typingIndicator.classList.add('hidden');
    const speakerName = targetVillager ? targetVillager.name : roleName;
    const speakerAvatar = targetVillager ? targetVillager.avatar : (roleName.includes('村民') ? '👵' : '🤖');
    const assistantMsg = createSimulateMessageElement('assistant', speakerName, speakerAvatar, data.reply, data.emotion || 'neutral', data.satisfaction, data.messageId);
    container.appendChild(assistantMsg);
    if (data.strategyTip) showTip(data.strategyTip);
    updateSidebarStatus(data, targetVillager?.name);
    scrollSimulate();
    if (data.timeExpired) {
      alert('时间到！模拟结束。');
      document.getElementById('finishSimulateBtn')?.click();
    }
  } catch(err) {
    alert('发送失败：' + err.message);
  } finally {
    isTyping = false;
    setInputEnabled(true);
    typingIndicator.classList.add('hidden');
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
  eventInterval = setInterval(async () => {
    if (Math.random() > 0.3) return;
    const events = [
      { type: 'call', msg: '📞 突然接到上级电话，要求你汇报工作情况。请暂停对话，模拟接听电话。', effect: { satisfactionDelta: -5 } },
      { type: 'leave', msg: '😠 村民情绪失控，摔门而去！', effect: { satisfactionDelta: -15, stageRollback: true } },
      { type: 'good', msg: '🎉 好消息！村里刚获得一笔项目资金，村民满意度上升。', effect: { satisfactionDelta: 10 } },
      { type: 'rumor', msg: '📢 有村民在背后议论你处理不公，其他村民开始动摇。', effect: { satisfactionDelta: -8 } }
    ];
    const event = events[Math.floor(Math.random() * events.length)];
    const container = document.getElementById('simulateMessages');
    const sysMsg = document.createElement('div');
    sysMsg.className = 'simulate-message system';
    sysMsg.innerHTML = `<div class="simulate-message-bubble" style="background:#f0f0f0; text-align:center;">⚠️ ${event.msg}</div>`;
    container.appendChild(sysMsg);
    scrollSimulate();
    await fetchWithAuth(`/api/simulate/event/${sessionId}`, {
      method: 'POST',
      body: JSON.stringify(event.effect)
    });
  }, 60000);
}

async function startPollingStatus(sessionId) {
  if (statusPollInterval) clearInterval(statusPollInterval);
  statusPollInterval = setInterval(async () => {
    try {
      const res = await fetchWithAuth(`/api/simulate/status/${sessionId}`);
      const data = await res.json();
      updateSidebarStatus(data);
    } catch(e) {}
  }, 3000);
}

// ==================== 场景列表 ====================
export async function renderSimulateView(forceList = false) {
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
      html += `
        <div class="scenario-card" data-id="${s.id}" style="background:white; border-radius:16px; padding:16px; box-shadow:0 2px 8px rgba(0,0,0,0.1); transition:transform 0.2s;">
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
            <div class="single-preview" style="display:block;"><strong>👤 单人角色：</strong> ${escapeHtml(s.role)}</div>
            <div class="multi-preview" style="display:none;">
              <strong>👥 多人村民：</strong><br>
              ${multiConfig ? multiConfig.villagers.map(v => `• ${v.name}（${v.personality}）`).join('<br>') : '暂无配置，将使用默认村民'}
            </div>
          </div>
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
    const res = await fetchWithAuth('/api/simulate/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenarioId, difficulty, timeLimit })
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

export async function renderSimulateChat(session) {
  if (statusPollInterval) clearInterval(statusPollInterval);
  if (eventInterval) clearInterval(eventInterval);
  const scenariosRes = await fetchWithAuth('/api/simulate/scenarios');
  const scenarios = await scenariosRes.json();
  const scenario = scenarios.find(s => s.id === (JSON.parse(session.scenarioId || '{}').scenarioId || session.scenarioId));
  if (!scenario) {
    document.getElementById('dynamicContent').innerHTML = `<div><p>场景不存在</p><button id="backBtn">返回</button></div>`;
    document.getElementById('backBtn').onclick = () => renderSimulateView(true);
    setActiveNavByView('simulate');
    return;
  }
  let extra = {};
  if (session.scenarioId) {
    try { extra = JSON.parse(session.scenarioId); } catch(e) { extra = { stages: [], satisfaction: 50, villagersState: {} }; }
  }
  const satisfaction = extra.satisfaction || 50;
  const villagersState = extra.villagersState || {};
  let currentMode = simulateMode;
  let villagers = [];
  let systemOpening = '';
  if (currentMode === 'multi' && currentMultiVillagers.length) {
    villagers = currentMultiVillagers.map(v => ({ ...v, satisfaction: villagersState[v.name]?.satisfaction ?? 50, emotion: villagersState[v.name]?.emotion ?? 'neutral' }));
    if (!currentTargetVillager && villagers.length) currentTargetVillager = villagers[0];
    const config = scenarioMultiConfig[scenario.id];
    if (config) {
      systemOpening = `🏛️ 【场景介绍】${config.description}\n👥 参会人员：${config.villagers.map(v => v.name).join('、')}\n📌 目标：${scenario.goal}\n💬 请开始你的调解/对话。`;
    } else {
      systemOpening = `🏛️ 【场景介绍】${scenario.description}\n👥 参会人员：${villagers.map(v => v.name).join('、')}\n📌 目标：${scenario.goal}\n💬 请开始你的调解/对话。`;
    }
  } else {
    currentMode = 'single';
    villagers = [{ name: scenario.role, avatar: scenario.role.includes('村民') ? '👵' : '🤖', personality: '', satisfaction, emotion: extra.emotion || 'neutral' }];
    currentTargetVillager = null;
    systemOpening = `🏛️ 【场景介绍】${scenario.description}\n👤 对话角色：${scenario.role}\n📌 目标：${scenario.goal}\n💬 请开始你的对话。`;
  }
  const dynamicContent = document.getElementById('dynamicContent');
  dynamicContent.innerHTML = `
    <div class="simulate-view" style="display:flex; flex-direction:column; height:100%;">
      <div class="simulate-toolbar" style="background:white; border-bottom:1px solid #eee; padding:8px 12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
          <div style="display:flex; gap:8px;">
            <button id="backToListBtn" class="summary-btn" style="background:#f0f0f0;">← 返回</button>
            <button id="hintBtn" class="summary-btn">💡 提示</button>
            <button id="finishSimulateBtn" class="summary-btn" style="background:#4caf50; color:white;">结束并查看报告</button>
          </div>
          <div style="font-size:0.8rem; color:#666;">
            <span style="background:#f0f0f0; padding:2px 8px; border-radius:20px;">${escapeHtml(scenario.title)}</span>
            <span style="margin-left:8px; background:#e3f2fd; padding:2px 8px; border-radius:20px;">${currentMode === 'multi' ? '👥 多人模式' : '👤 单人模式'}</span>
          </div>
          <div id="simulateStatus" style="font-size:0.8rem;">满意度: ${satisfaction}%</div>
        </div>
        <div style="font-size:0.75rem; color:#888; margin-top:4px;">${escapeHtml(scenario.description)}</div>
      </div>
      <div style="display:flex; flex:1; overflow:hidden;">
        ${currentMode === 'multi' ? `
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
            <div id="simulateMessages"></div>
            <div id="simulateTyping" class="hidden" style="padding:8px; color:#666;">对方正在思考...</div>
          </div>
          <div class="simulate-input-area" style="border-top:1px solid #eee; padding:12px; background:white;">
            <div style="display:flex; gap:8px; align-items:center;">
              <textarea id="simulateInput" placeholder="${currentMode === 'multi' ? `对 ${currentTargetVillager ? currentTargetVillager.name : '村民'} 说...` : '输入你的回应...'}" rows="1" style="flex:1; padding:8px 12px; border-radius:24px; border:1px solid #ccc; resize:none; font-family:inherit; min-height:40px;"></textarea>
              <button id="simulateVoiceBtn" class="voice-btn" style="background:#f0f0f0; border:none; border-radius:30px; padding:0 16px; height:40px;">🎤</button>
              <button id="simulateSendBtn" style="background:#2e5d34; color:white; border:none; border-radius:30px; padding:0 20px; height:40px;">发送</button>
            </div>
            <div id="inputTip" style="font-size:0.7rem; color:#ff9800; margin-top:4px;"></div>
          </div>
        </div>
      </div>
    </div>
  `;
  document.getElementById('backToListBtn').onclick = () => renderSimulateView(true);
  const finishBtn = document.getElementById('finishSimulateBtn');
  const hintBtn = document.getElementById('hintBtn');
  const sendBtn = document.getElementById('simulateSendBtn');
  const input = document.getElementById('simulateInput');
  const voiceBtn = document.getElementById('simulateVoiceBtn');
  const typingIndicator = document.getElementById('simulateTyping');
  const messagesContainer = document.getElementById('simulateMessages');
  const sendMessage = async () => {
    const text = input.value.trim();
    if (!text || isTyping) return;
    input.value = '';
    input.style.height = 'auto';
    let target = null;
    if (currentMode === 'multi' && currentTargetVillager) target = currentTargetVillager;
    await sendSimulateMessage(session.id, text, messagesContainer, typingIndicator, scenario.role, target);
  };
  sendBtn.onclick = sendMessage;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !isTyping) { e.preventDefault(); sendMessage(); } });
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(80, input.scrollHeight) + 'px'; });
  setupVoiceInput(input, voiceBtn);
  if (currentMode === 'multi') {
    document.querySelectorAll('.villager-item').forEach(el => {
      el.onclick = () => {
        const name = el.dataset.name;
        currentTargetVillager = villagers.find(v => v.name === name);
        input.placeholder = `对 ${currentTargetVillager.name} 说...`;
        document.querySelectorAll('.villager-item').forEach(item => item.style.border = '1px solid #eee');
        el.style.border = '2px solid #2e5d34';
      };
    });
  }
  const hasSystemMsg = session.messages.some(m => m.role === 'system');
  if (!hasSystemMsg && systemOpening) {
    const sysDiv = document.createElement('div');
    sysDiv.className = 'simulate-message system';
    sysDiv.innerHTML = `<div class="simulate-message-bubble" style="background:#e3f2fd; color:#1565c0;">📢 ${escapeHtml(systemOpening)}</div>`;
    messagesContainer.appendChild(sysDiv);
  }
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
        speakerName = currentMode === 'multi' ? (currentTargetVillager?.name || '村民') : scenario.role;
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
  input.addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      const text = e.target.value.trim();
      if (text.length < 3) { document.getElementById('inputTip').innerHTML = ''; return; }
      try {
        const res = await fetchWithAuth('/api/simulate/analyze-input', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, scenarioId: scenario.id })
        });
        const data = await res.json();
        const tipContainer = document.getElementById('inputTip');
        if (tipContainer) tipContainer.innerHTML = (data.tips || []).map(t => `<div>${escapeHtml(t)}</div>`).join('');
      } catch(e) { console.warn(e); }
    }, 800);
  });
  finishBtn.onclick = async () => {
    if (isTyping) return;
    finishBtn.disabled = true;
    try {
      const res = await fetchWithAuth('/api/simulate/finish', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.id })
      });
      const reportData = await res.json();
      if (!res.ok) throw new Error(reportData.error);
      if (reportData.finalScore >= 80) {
        showCelebration(window.innerWidth/2, window.innerHeight/2);
      }
      const sRes = await fetchWithAuth(`/api/session/${session.id}`);
      const updated = await sRes.json();
      const idx = appState.sessions.findIndex(s => s.id === session.id);
      if (idx !== -1) appState.sessions[idx] = updated;
      const { renderSessionList } = await import('./ui');
      renderSessionList();
      renderSimulateChat(updated);
      updateTaskProgress('simulate', 1);
    } catch(err) {
      alert('生成报告失败：' + err.message);
      finishBtn.disabled = false;
    }
  };
  hintBtn.onclick = async () => {
    if (isTyping) return;
    hintBtn.disabled = true;
    const loading = document.createElement('div');
    loading.className = 'simulate-message assistant';
    loading.innerHTML = '<div class="simulate-message-bubble">🤔生成提示...</div>';
    messagesContainer.appendChild(loading);
    scrollSimulate();
    try {
      const res = await fetchWithAuth('/api/chat/summarize', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
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
  setActiveNavByView('simulate');
}