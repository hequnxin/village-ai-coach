// frontend/src/modules/simulate.js
import { fetchWithAuth } from '../utils/api';
import { appState, switchSession } from './state';
import { escapeHtml, playSound, updateTaskProgress, setupVoiceInput, setActiveNavByView } from '../utils/helpers';

let currentScenario = null;
let currentMultiVillagers = [];
let simulateMode = 'single';
let isTyping = false;
let statusPollInterval = null;
let eventInterval = null;
let currentTargetVillagerId = null;

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

function getEmotionIcon(emotion) {
  const map = { happy:'😊', sad:'😭', angry:'😡', neutral:'😐', surprise:'😲', worry:'😟' };
  return map[emotion] || '😐';
}

function createSimulateMessageElement(role, speakerName, speakerAvatar, content, emotion, satisfaction, messageId) {
  const msgDiv = document.createElement('div');
  msgDiv.className = `simulate-message ${role}`;
  if (messageId) msgDiv.dataset.messageId = messageId;
  const emotionIcon = getEmotionIcon(emotion);
  let speakBtnHtml = '';
  if (role === 'assistant') {
    speakBtnHtml = `<button class="speak-btn" style="background:none; border:none; cursor:pointer; margin-left:8px; font-size:1rem;">🔊</button>`;
  }
  msgDiv.innerHTML = `
    <div class="simulate-message-avatar">${speakerAvatar}</div>
    <div class="simulate-message-bubble">
      <div class="simulate-message-speaker">${escapeHtml(speakerName)}${speakBtnHtml}</div>
      <div class="simulate-message-content">${escapeHtml(content)}</div>
      ${satisfaction !== undefined ? `<div class="simulate-satisfaction-bar"><div style="width:${satisfaction}%;"></div></div>` : ''}
      <div class="simulate-emotion-icon">${emotionIcon}</div>
    </div>
  `;
  const speakBtn = msgDiv.querySelector('.speak-btn');
  if (speakBtn && role === 'assistant') {
    speakBtn.onclick = () => {
      if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(content);
        utterance.lang = 'zh-CN';
        utterance.rate = 0.9;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
      } else {
        alert('您的浏览器不支持语音播放');
      }
    };
  }
  return msgDiv;
}

function scrollSimulate() {
  const c = document.getElementById('simulateMessagesContainer');
  if (c) c.scrollTop = c.scrollHeight;
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

function updateSidebarStatus(data, villagerId = null) {
  if (!data) return;
  if (simulateMode === 'multi' && data.villagersState) {
    for (const [name, state] of Object.entries(data.villagersState)) {
      const card = document.querySelector(`.villager-card[data-name="${name}"]`);
      if (card) {
        const satisfactionFill = card.querySelector('.satisfaction-fill');
        if (satisfactionFill) satisfactionFill.style.width = `${state.satisfaction}%`;
        const emotionSpan = card.querySelector('.villager-emotion');
        if (emotionSpan) emotionSpan.textContent = getEmotionIcon(state.emotion);
      }
    }
  } else if (simulateMode === 'single') {
    const satisfaction = data.satisfaction;
    const emotion = data.emotion;
    const satisfactionFill = document.querySelector('.single-satisfaction-fill');
    if (satisfactionFill) satisfactionFill.style.width = `${satisfaction}%`;
    const emotionSpan = document.querySelector('.single-emotion');
    if (emotionSpan) emotionSpan.textContent = getEmotionIcon(emotion);
  }
  const stages = data.stageProgress;
  const timeRemaining = data.timeRemaining;
  let stagesHtml = '';
  if (stages && stages.length) {
    stagesHtml = '<div class="stages">阶段进度：' + stages.map(s => `<span class="${s.completed ? 'completed' : ''}">${s.name}</span>`).join(' → ') + '</div>';
  }
  const statusDiv = document.getElementById('simulateStatus');
  if (statusDiv) {
    statusDiv.innerHTML = `
      <div class="satisfaction">满意度：<progress value="${data.satisfaction || 50}" max="100"></progress> ${data.satisfaction || 50}%</div>
      <div class="emotion">情绪：${getEmotionIcon(data.emotion)}</div>
      ${timeRemaining !== null ? `<div class="timer">⏰ 剩余时间：${Math.floor(timeRemaining/60)}:${(timeRemaining%60).toString().padStart(2,'0')}</div>` : ''}
      ${stagesHtml}
    `;
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
    updateSidebarStatus(data, targetVillager?.id);
    scrollSimulate();
    if (data.timeExpired) {
      alert('时间到！模拟结束。');
      document.getElementById('finishSimulateBtn')?.click();
    }
    if (simulateMode === 'multi' && targetVillager) {
      const remaining = currentMultiVillagers.filter(v => v.name !== targetVillager.name);
      for (const villager of remaining) {
        typingIndicator.innerHTML = `${villager.name} 正在思考...`;
        const nextRes = await fetchWithAuth('/api/simulate/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, message: text, villager: { name: villager.name, personality: villager.personality } })
        });
        const nextData = await nextRes.json();
        if (!nextRes.ok) throw new Error(nextData.error);
        const nextMsg = createSimulateMessageElement('assistant', villager.name, villager.avatar, nextData.reply, nextData.emotion || 'neutral', nextData.satisfaction, nextData.messageId);
        container.appendChild(nextMsg);
        scrollSimulate();
        if (nextData.strategyTip) showTip(nextData.strategyTip);
        updateSidebarStatus(nextData, villager.id);
        await new Promise(r => setTimeout(r, 500));
      }
    }
  } catch(err) {
    alert('发送失败：' + err.message);
  } finally {
    isTyping = false;
    setInputEnabled(true);
    typingIndicator.classList.add('hidden');
  }
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

export async function renderSimulateView(forceList = false) {
  if (forceList || !appState.currentSessionId || appState.sessions.find(s => s.id === appState.currentSessionId)?.type !== 'simulate') {
    const res = await fetchWithAuth('/api/simulate/scenarios');
    const scenarios = await res.json();
    if (scenarios.length === 0) {
      document.getElementById('dynamicContent').innerHTML = '<div class="scenarios-list"><p>暂无场景</p></div>';
      setActiveNavByView('simulate');
      return;
    }
    let html = `<div class="scenarios-list" style="padding:20px; display:grid; grid-template-columns:repeat(auto-fill,minmax(320px,1fr)); gap:20px;">`;
    scenarios.forEach(s => {
      html += `
        <div class="scenario-card" data-id="${s.id}" style="background:white; border-radius:16px; padding:16px; box-shadow:0 2px 8px rgba(0,0,0,0.1); transition:transform 0.2s;">
          <h3 style="color:#2e5d34; margin-bottom:8px;">${escapeHtml(s.title)}</h3>
          <p style="color:#666; font-size:0.9rem;">${escapeHtml(s.description)}</p>
          <p style="margin-top:8px;"><strong>目标：</strong>${escapeHtml(s.goal)}</p>
          <p><strong>角色：</strong>${escapeHtml(s.role)}</p>
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
              <option value="multi">👥 多人模式（3位村民）</option>
            </select>
          </div>
          <button class="start-simulate" data-id="${s.id}" style="background:#2e5d34; color:white; border:none; border-radius:30px; padding:8px 16px; width:100%; cursor:pointer; margin-top:8px;">开始对练</button>
        </div>
      `;
    });
    html += `</div>`;
    document.getElementById('dynamicContent').innerHTML = html;
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
      const scenariosRes = await fetchWithAuth('/api/simulate/scenarios');
      const scenarios = await scenariosRes.json();
      const scenario = scenarios.find(s => s.id === scenarioId);
      if (scenario) {
        currentMultiVillagers = [
          { id: 'v1', name: '张大叔', role: scenario.role, avatar: '👴', personality: '固执、爱面子', emotion: 'neutral', satisfaction: 50 },
          { id: 'v2', name: '李大婶', role: scenario.role, avatar: '👵', personality: '热情、话多', emotion: 'neutral', satisfaction: 50 },
          { id: 'v3', name: '小王', role: scenario.role, avatar: '👨', personality: '年轻、有点急躁', emotion: 'neutral', satisfaction: 50 }
        ];
      } else {
        currentMultiVillagers = [
          { id: 'v1', name: '村民甲', role: '村民', avatar: '👤', personality: '普通', emotion: 'neutral', satisfaction: 50 },
          { id: 'v2', name: '村民乙', role: '村民', avatar: '👤', personality: '普通', emotion: 'neutral', satisfaction: 50 },
          { id: 'v3', name: '村民丙', role: '村民', avatar: '👤', personality: '普通', emotion: 'neutral', satisfaction: 50 }
        ];
      }
      currentTargetVillagerId = currentMultiVillagers[0].id;
    } else {
      currentMultiVillagers = [];
      currentTargetVillagerId = null;
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
  currentScenario = scenario;
  let report = null;
  for (const msg of session.messages) {
    if (msg.role === 'system' && msg.content.startsWith('report:')) {
      try { report = JSON.parse(msg.content.substring(7)); } catch(e) {}
      break;
    }
  }
  let reportHtml = '';
  if (report) {
    const scoresHtml = Object.entries(report.scores || {}).map(([dim, score]) => `<div class="score-item">${dim}: ${'⭐'.repeat(score)} (${score}/5)</div>`).join('');
    const examplesHtml = (report.examples || []).map(ex => `<div class="example-item ${ex.verdict === '优点' ? 'good' : 'bad'}"><strong>${ex.verdict}</strong>：${escapeHtml(ex.quote)}<br><span class="comment">${escapeHtml(ex.comment)}</span></div>`).join('');
    const bestHtml = (report.bestPractices || []).map(p => `<div class="best-practice">💡 ${escapeHtml(p)}</div>`).join('');
    reportHtml = `
      <div class="report-section" style="background:white; border-radius:16px; padding:16px; margin-top:20px;">
        <h4>评估报告</h4>
        <div class="scores">${scoresHtml}</div>
        <div class="examples"><strong>逐句点评</strong>${examplesHtml}</div>
        <div class="best-practices"><strong>优秀话术参考</strong>${bestHtml}</div>
        <p><strong>建议：</strong>${escapeHtml(report.suggestions || '')}</p>
        <button id="exportReportBtn" class="summary-btn" style="margin-top:8px;">📄 导出报告为PDF</button>
        <button id="backToScenariosFromReport" class="summary-btn" style="margin-left:8px;">返回场景列表</button>
      </div>
    `;
  }
  const difficultyText = session.difficulty === 'hard' ? '困难' : (session.difficulty === 'easy' ? '简单' : '中等');
  const modeText = simulateMode === 'multi' ? '👥 多人模式' : '👤 单人模式';
  const dynamicContent = document.getElementById('dynamicContent');
  dynamicContent.innerHTML = `
    <div class="simulate-view" style="display:flex; flex-direction:column; height:100%;">
      <div class="simulate-header" style="background:white; border-bottom:1px solid #eee; padding:12px 20px;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <h2 style="font-size:1.2rem;">${escapeHtml(scenario.title)} <span style="background:#f0f0f0; padding:2px 8px; border-radius:20px; font-size:0.8rem;">难度:${difficultyText}</span> <span style="background:#f0f0f0; padding:2px 8px; border-radius:20px; font-size:0.8rem;">${modeText}</span></h2>
          <button id="backToListBtn" class="summary-btn">←返回</button>
        </div>
        <p style="margin-top:8px;"><strong>目标：</strong>${escapeHtml(scenario.goal)}</p>
        <p><strong>角色：</strong>${escapeHtml(scenario.role)}</p>
        <div style="display:flex; gap:10px; margin-top:8px;">
          <button id="hintBtn" class="summary-btn" ${report ? 'disabled' : ''}>💡提示</button>
          <button id="finishSimulateBtn" class="summary-btn" ${report ? 'disabled' : ''}>结束并查看报告</button>
        </div>
      </div>
      <div style="display:flex; flex:1; overflow:hidden;">
        <div class="simulate-sidebar" style="width:240px; background:#f5f5f5; border-right:1px solid #ddd; overflow-y:auto; padding:12px;">
          ${simulateMode === 'multi' ? `
            <h4 style="margin-bottom:12px;">👥 参会村民</h4>
            <div id="villagersList">
              ${currentMultiVillagers.map(v => `
                <div class="villager-card" data-id="${v.id}" data-name="${v.name}" style="margin-bottom:12px; padding:8px; background:white; border-radius:12px; cursor:pointer; transition:0.2s;">
                  <div style="display:flex; align-items:center; gap:8px;">
                    <div style="font-size:1.8rem;">${v.avatar}</div>
                    <div style="flex:1;">
                      <div style="font-weight:bold;">${escapeHtml(v.name)}</div>
                      <div class="villager-emotion" style="font-size:0.8rem;">${getEmotionIcon(v.emotion)}</div>
                      <div class="satisfaction-bar" style="background:#eee; border-radius:4px; height:4px; margin-top:4px;">
                        <div class="satisfaction-fill" style="width:${v.satisfaction}%; background:#4caf50; height:4px; border-radius:4px;"></div>
                      </div>
                    </div>
                  </div>
                </div>
              `).join('')}
            </div>
          ` : `
            <h4 style="margin-bottom:12px;">👤 村民</h4>
            <div class="single-villager" style="padding:8px; background:white; border-radius:12px;">
              <div style="display:flex; align-items:center; gap:8px;">
                <div style="font-size:1.8rem;">${scenario.role.includes('村民') ? '👵' : '🤖'}</div>
                <div style="flex:1;">
                  <div style="font-weight:bold;">${escapeHtml(scenario.role)}</div>
                  <div class="single-emotion" style="font-size:0.8rem;">😐</div>
                  <div class="satisfaction-bar" style="background:#eee; border-radius:4px; height:4px; margin-top:4px;">
                    <div class="single-satisfaction-fill" style="width:50%; background:#4caf50; height:4px; border-radius:4px;"></div>
                  </div>
                </div>
              </div>
            </div>
          `}
          <div id="simulateStatus" style="margin-top:16px; padding:8px; background:white; border-radius:12px;"></div>
        </div>
        <div class="chat-container" id="simulateMessagesContainer" style="flex:1; overflow-y:auto; padding:16px;">
          <div id="simulateMessages"></div>
          <div id="simulateTyping" class="hidden" style="padding:8px; color:#666;">对方正在思考...</div>
        </div>
      </div>
      ${reportHtml}
      <footer class="chat-footer" ${report ? 'style="display:none;"' : ''} style="background:white; border-top:1px solid #eee; padding:12px;">
        <div class="input-area" style="display:flex; gap:8px; flex-direction:column;">
          <textarea id="simulateInput" placeholder="输入你的回应..." rows="2" style="flex:1; padding:10px; border-radius:24px; border:1px solid #ccc; resize:none;"></textarea>
          <div id="inputTip" style="font-size:0.8rem; color:#ff9800; min-height:40px;"></div>
          <div style="display:flex; gap:8px;">
            <button id="simulateVoiceBtn" class="voice-btn" style="background:#f0f0f0; border:none; border-radius:30px; padding:0 16px;">🎤</button>
            <button id="simulateSendBtn" style="background:#2e5d34; color:white; border:none; border-radius:30px; padding:0 20px;">发送</button>
          </div>
        </div>
      </footer>
    </div>
  `;
  document.getElementById('backToListBtn').onclick = () => renderSimulateView(true);
  if (document.getElementById('backToScenariosFromReport')) {
    document.getElementById('backToScenariosFromReport').onclick = () => renderSimulateView(true);
  }
  const simulateMessagesDiv = document.getElementById('simulateMessages');
  const simulateInput = document.getElementById('simulateInput');
  const simulateSendBtn = document.getElementById('simulateSendBtn');
  const finishBtn = document.getElementById('finishSimulateBtn');
  const hintBtn = document.getElementById('hintBtn');
  const simulateTyping = document.getElementById('simulateTyping');
  const tipContainer = document.getElementById('inputTip');

  // 智能提示输入监听
  let debounceTimer;
  simulateInput.addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      const text = e.target.value.trim();
      if (text.length < 3) {
        tipContainer.innerHTML = '';
        return;
      }
      try {
        const res = await fetchWithAuth('/api/simulate/analyze-input', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, scenarioId: scenario.id })
        });
        const data = await res.json();
        tipContainer.innerHTML = (data.tips || []).map(t => `<div>${escapeHtml(t)}</div>`).join('');
      } catch(e) { console.warn(e); }
    }, 800);
  });

  // 村民卡片点击事件（多人模式）
  if (simulateMode === 'multi') {
    const cards = document.querySelectorAll('.villager-card');
    cards.forEach(card => {
      card.onclick = () => {
        cards.forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        currentTargetVillagerId = card.dataset.id;
        const villager = currentMultiVillagers.find(v => v.id === currentTargetVillagerId);
        if (villager) {
          simulateInput.placeholder = `对 ${villager.name} 说...`;
        }
      };
    });
    if (cards.length) cards[0].classList.add('active');
    currentTargetVillagerId = currentMultiVillagers[0]?.id;
    simulateInput.placeholder = `对 ${currentMultiVillagers[0]?.name} 说...`;
  } else {
    simulateInput.placeholder = '输入你的回应...';
  }

  // 显示历史消息
  session.messages.forEach(msg => {
    if (msg.role === 'system') return;
    let speakerName = msg.role === 'user' ? '村官' : (msg.role === 'assistant' ? (simulateMode === 'multi' ? (currentMultiVillagers.find(v => msg.content.includes(v.name))?.name || '村民') : scenario.role) : '');
    let speakerAvatar = msg.role === 'user' ? '👨‍🌾' : (simulateMode === 'multi' ? (currentMultiVillagers.find(v => v.name === speakerName)?.avatar || '👤') : (scenario.role.includes('村民') ? '👵' : '🤖'));
    let emotion = 'neutral';
    if (msg.role === 'assistant' && msg.content) {
      if (msg.content.includes('谢谢') || msg.content.includes('感谢')) emotion = 'happy';
      else if (msg.content.includes('生气') || msg.content.includes('凭什么')) emotion = 'angry';
      else if (msg.content.includes('难过') || msg.content.includes('失望')) emotion = 'sad';
      else if (msg.content.includes('担心') || msg.content.includes('怕')) emotion = 'worry';
      else if (msg.content.includes('真的吗') || msg.content.includes('竟然')) emotion = 'surprise';
    }
    const msgDiv = createSimulateMessageElement(msg.role === 'user' ? 'user' : 'assistant', speakerName, speakerAvatar, msg.content, emotion, undefined, msg.messageId);
    simulateMessagesDiv.appendChild(msgDiv);
  });
  scrollSimulate();

  if (simulateSendBtn) {
    const newSend = simulateSendBtn.cloneNode(true);
    simulateSendBtn.parentNode.replaceChild(newSend, simulateSendBtn);
    newSend.onclick = async () => {
      const text = simulateInput.value.trim();
      if (!text || isTyping) return;
      simulateInput.value = '';
      tipContainer.innerHTML = '';
      let targetVillager = null;
      if (simulateMode === 'multi' && currentTargetVillagerId) {
        targetVillager = currentMultiVillagers.find(v => v.id === currentTargetVillagerId);
      }
      await sendSimulateMessage(session.id, text, simulateMessagesDiv, simulateTyping, scenario.role, targetVillager);
    };
  }
  const voiceBtn = document.getElementById('simulateVoiceBtn');
  if (voiceBtn) setupVoiceInput(simulateInput, voiceBtn);

  if (finishBtn && !report) {
    const newFinish = finishBtn.cloneNode(true);
    finishBtn.parentNode.replaceChild(newFinish, finishBtn);
    newFinish.onclick = async () => {
      if (isTyping) return;
      newFinish.disabled = true;
      try {
        const res = await fetchWithAuth('/api/simulate/finish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: session.id })
        });
        const reportData = await res.json();
        if (!res.ok) throw new Error(reportData.error);
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
        newFinish.disabled = false;
      }
    };
  }
  if (hintBtn && !report) {
    hintBtn.onclick = async () => {
      if (isTyping) return;
      hintBtn.disabled = true;
      const loading = document.createElement('div');
      loading.className = 'simulate-message assistant';
      loading.innerHTML = '<div class="simulate-message-bubble">🤔生成提示...</div>';
      simulateMessagesDiv.appendChild(loading);
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

  // 导出报告PDF
  const exportBtn = document.getElementById('exportReportBtn');
  if (exportBtn) {
    exportBtn.onclick = () => {
      const reportElement = document.querySelector('.report-section');
      if (!reportElement) return;
      const printWindow = window.open('', '_blank');
      printWindow.document.write(`
        <html>
          <head><title>模拟对练报告</title><style>body{font-family:sans-serif;padding:20px;}</style></head>
          <body>${reportElement.outerHTML}</body>
        </html>
      `);
      printWindow.document.close();
      printWindow.print();
    };
  }

  setActiveNavByView('simulate');
}