import { fetchWithAuth } from '../utils/api';
import { appState, switchSession } from './state';
import { escapeHtml, playSound, updateTaskProgress } from '../utils/helpers';

let currentScenario = null;
let currentMultiVillagers = [];
let simulateMode = 'single';
let isTyping = false;

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

function analyzeEmotion(text) {
  const happy = ['谢谢', '感谢', '好', '不错', '满意', '开心', '棒'];
  const sad = ['难过', '伤心', '失望', '唉', '遗憾'];
  const angry = ['生气', '愤怒', '不满', '凭什么', '不行', '反对'];
  const worry = ['担心', '怕', '忧虑', '愁', '难'];
  const surprise = ['真的吗', '竟然', '没想到', '哇'];
  for (let w of happy) if (text.includes(w)) return 'happy';
  for (let w of sad) if (text.includes(w)) return 'sad';
  for (let w of angry) if (text.includes(w)) return 'angry';
  for (let w of worry) if (text.includes(w)) return 'worry';
  for (let w of surprise) if (text.includes(w)) return 'surprise';
  return 'neutral';
}

function createSimulateMessageElement(role, content, avatar, emotion, messageId) {
  const msgDiv = document.createElement('div');
  msgDiv.className = `message ${role}`;
  if (messageId) msgDiv.dataset.messageId = messageId;
  const emotionIcon = emotion ? { happy:'😊', sad:'😭', angry:'😡', neutral:'😐', surprise:'😲', worry:'😟' }[emotion] || '😐' : '😐';
  msgDiv.innerHTML = `
    <div class="message-avatar">
      ${avatar}
      <div class="emotion-icon">${emotionIcon}</div>
    </div>
    <div class="message-bubble">
      <div class="message-content">${escapeHtml(content)}</div>
    </div>
  `;
  return msgDiv;
}

async function sendSimulateMessage(sessionId, text, container, typingIndicator, roleName) {
  const userMsg = createSimulateMessageElement('user', text, '👨‍🌾', 'neutral');
  container.appendChild(userMsg);
  const scroll = () => { const c = document.getElementById('simulateMessagesContainer'); if (c) c.scrollTop = c.scrollHeight; };
  scroll();
  isTyping = true;
  typingIndicator.classList.remove('hidden');
  setInputEnabled(false);
  try {
    const res = await fetchWithAuth('/api/simulate/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, message: text })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    typingIndicator.classList.add('hidden');
    const avatar = roleName.includes('村民') ? '👵' : '🤖';
    const emotion = analyzeEmotion(data.reply);
    const assistantMsg = createSimulateMessageElement('assistant', data.reply, avatar, emotion, data.messageId);
    container.appendChild(assistantMsg);
    if (emotion !== 'neutral') playSound('emotion');
    scroll();
  } catch(err) { alert('发送失败：' + err.message); }
  finally { isTyping = false; setInputEnabled(true); }
}

async function sendMultiSimulateMessage(sessionId, text, container, typingIndicator, scenario) {
  const userMsg = createSimulateMessageElement('user', text, '👨‍🌾', 'neutral');
  container.appendChild(userMsg);
  const scroll = () => { const c = document.getElementById('simulateMessagesContainer'); if (c) c.scrollTop = c.scrollHeight; };
  scroll();
  isTyping = true;
  typingIndicator.classList.remove('hidden');
  setInputEnabled(false);
  try {
    for (let i = 0; i < currentMultiVillagers.length; i++) {
      const villager = currentMultiVillagers[i];
      typingIndicator.innerHTML = `${villager.name} 正在思考...`;
      const res = await fetchWithAuth('/api/simulate/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, message: text, villager: { name: villager.name, personality: villager.personality } })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const emotion = analyzeEmotion(data.reply);
      const assistantMsg = createSimulateMessageElement('assistant', data.reply, villager.avatar, emotion, data.messageId);
      container.appendChild(assistantMsg);
      scroll();
      if (emotion !== 'neutral') playSound('emotion');
      await new Promise(r => setTimeout(r, 500));
    }
    typingIndicator.classList.add('hidden');
  } catch(err) { alert('发送失败：' + err.message); }
  finally { isTyping = false; setInputEnabled(true); typingIndicator.innerHTML = '对方正在思考...'; typingIndicator.classList.add('hidden'); }
}

export async function renderSimulateView(forceList = false) {
  if (forceList || !appState.currentSessionId || appState.sessions.find(s => s.id === appState.currentSessionId)?.type !== 'simulate') {
    const res = await fetchWithAuth('/api/simulate/scenarios');
    const scenarios = await res.json();
    if (scenarios.length === 0) { document.getElementById('dynamicContent').innerHTML = '<div class="scenarios-list"><p>暂无场景</p></div>'; return; }
    let html = `<div class="scenarios-list"><h2>选择场景</h2>`;
    scenarios.forEach(s => {
      html += `
        <div class="scenario-card" data-id="${s.id}">
          <h3>${escapeHtml(s.title)}</h3>
          <p>${escapeHtml(s.description)}</p>
          <p><strong>目标：</strong>${escapeHtml(s.goal)}</p>
          <p><strong>角色：</strong>${escapeHtml(s.role)}</p>
          <div class="difficulty-selector">
            <label>难度：</label>
            <select class="difficulty-select">
              <option value="easy">🌟简单</option>
              <option value="medium" selected>⚡中等</option>
              <option value="hard">🔥困难</option>
            </select>
          </div>
          <div class="mode-selector" style="margin: 8px 0;">
            <label>模式：</label>
            <select class="mode-select">
              <option value="single">👤 单人模式</option>
              <option value="multi">👥 多人模式（3位村民）</option>
            </select>
          </div>
          <button class="start-simulate" data-id="${s.id}">开始对练</button>
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
        startSimulate(scenarioId, diff, mode);
      };
    });
    return;
  }
  const sessionRes = await fetchWithAuth(`/api/session/${appState.currentSessionId}`);
  const session = await sessionRes.json();
  renderSimulateChat(session);
}

async function startSimulate(scenarioId, difficulty, mode = 'single') {
  try {
    simulateMode = mode;
    const res = await fetchWithAuth('/api/simulate/session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenarioId, difficulty })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    const sessionRes = await fetchWithAuth(`/api/session/${data.sessionId}`);
    const session = await sessionRes.json();
    if (!session.messages) session.messages = [];
    appState.sessions.push(session);
    // 重新渲染会话列表（需要从state模块导入renderSessionList）
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
          { name: '张大叔', role: scenario.role, avatar: '👴', personality: '固执、爱面子', emotion: 'neutral' },
          { name: '李大婶', role: scenario.role, avatar: '👵', personality: '热情、话多', emotion: 'neutral' },
          { name: '小王', role: scenario.role, avatar: '👨', personality: '年轻、有点急躁', emotion: 'neutral' }
        ];
      } else {
        currentMultiVillagers = [
          { name: '村民甲', role: '村民', avatar: '👤', personality: '普通', emotion: 'neutral' },
          { name: '村民乙', role: '村民', avatar: '👤', personality: '普通', emotion: 'neutral' },
          { name: '村民丙', role: '村民', avatar: '👤', personality: '普通', emotion: 'neutral' }
        ];
      }
    } else {
      currentMultiVillagers = [];
    }
    renderSimulateChat(session);
  } catch(err) { alert('启动失败：' + err.message); }
}

export async function renderSimulateChat(session) {
  const scenariosRes = await fetchWithAuth('/api/simulate/scenarios');
  const scenarios = await scenariosRes.json();
  const scenario = scenarios.find(s => s.id === session.scenarioId);
  if (!scenario) {
    document.getElementById('dynamicContent').innerHTML = `<div><p>场景不存在</p><button id="backBtn">返回</button></div>`;
    document.getElementById('backBtn').onclick = () => renderSimulateView(true);
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
    reportHtml = `
      <div class="report-section">
        <h4>评估报告</h4>
        <div class="scores">${scoresHtml}</div>
        <p><strong>建议：</strong>${escapeHtml(report.suggestions || '')}</p>
        <button id="backToScenariosFromReport" class="summary-btn">返回场景列表</button>
      </div>
    `;
  }
  const difficultyText = session.difficulty === 'hard' ? '困难' : (session.difficulty === 'easy' ? '简单' : '中等');
  const modeText = simulateMode === 'multi' ? '👥 多人模式' : '👤 单人模式';
  const dynamicContent = document.getElementById('dynamicContent');
  dynamicContent.innerHTML = `
    <div class="simulate-view">
      <div class="simulate-header">
        <div style="display:flex;justify-content:space-between;">
          <h2>${escapeHtml(scenario.title)} <span class="difficulty-badge">难度:${difficultyText}</span> <span class="difficulty-badge">${modeText}</span></h2>
          <button id="backToListBtn" class="summary-btn">←返回</button>
        </div>
        <p><strong>目标：</strong>${escapeHtml(scenario.goal)}</p>
        <p><strong>角色：</strong>${escapeHtml(scenario.role)}</p>
        <div style="display:flex;gap:10px;">
          <button id="hintBtn" class="summary-btn" ${report ? 'disabled' : ''}>💡提示</button>
          <button id="finishSimulateBtn" class="summary-btn" ${report ? 'disabled' : ''}>结束并查看报告</button>
        </div>
      </div>
      <div class="chat-container" id="simulateMessagesContainer">
        <div id="simulateMessages"></div>
        <div id="simulateTyping" class="hidden">对方正在思考...</div>
      </div>
      ${reportHtml}
      <footer class="chat-footer" ${report ? 'style="display:none;"' : ''}>
        <div class="input-area">
          <textarea id="simulateInput" placeholder="输入你的回应..." rows="2"></textarea>
          <button id="simulateVoiceBtn" class="voice-btn">🎤</button>
          <button id="simulateSendBtn">发送</button>
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

  session.messages.forEach(msg => {
    if (msg.role === 'system') return;
    let avatar = msg.role === 'user' ? '👨‍🌾' : '🤖';
    let emotion = 'neutral';
    if (msg.role === 'assistant' && msg.content) emotion = analyzeEmotion(msg.content);
    const msgDiv = createSimulateMessageElement(msg.role === 'user' ? 'user' : 'assistant', msg.content, avatar, emotion, msg.messageId);
    simulateMessagesDiv.appendChild(msgDiv);
  });

  function scrollSim() { const c = document.getElementById('simulateMessagesContainer'); if (c) c.scrollTop = c.scrollHeight; }
  scrollSim();

  if (simulateSendBtn) {
    const newSend = simulateSendBtn.cloneNode(true);
    simulateSendBtn.parentNode.replaceChild(newSend, simulateSendBtn);
    newSend.onclick = async () => {
      const text = simulateInput.value.trim();
      if (!text || isTyping) return;
      simulateInput.value = '';
      if (simulateMode === 'multi') {
        await sendMultiSimulateMessage(session.id, text, simulateMessagesDiv, simulateTyping, scenario);
      } else {
        await sendSimulateMessage(session.id, text, simulateMessagesDiv, simulateTyping, scenario.role);
      }
    };
  }
  setupSimulateVoiceInput(simulateInput);

  if (finishBtn && !report) {
    const newFinish = finishBtn.cloneNode(true);
    finishBtn.parentNode.replaceChild(newFinish, finishBtn);
    newFinish.onclick = async () => {
      if (isTyping) return;
      newFinish.disabled = true;
      try {
        const res = await fetchWithAuth('/api/simulate/finish', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
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
      } catch(err) { alert('生成报告失败：' + err.message); newFinish.disabled = false; }
    };
  }

  if (hintBtn && !report) {
    hintBtn.onclick = async () => {
      if (isTyping) return;
      hintBtn.disabled = true;
      const loading = document.createElement('div');
      loading.className = 'message assistant';
      loading.innerHTML = '<div class="message-content">🤔生成提示...</div>';
      simulateMessagesDiv.appendChild(loading);
      scrollSim();
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
        loading.innerHTML = `<div class="message-content">${escapeHtml(hint)}</div>`;
      } catch(e) { loading.innerHTML = '<div class="message-content">⚠️提示失败</div>'; }
      finally { hintBtn.disabled = false; scrollSim(); }
    };
  }
}

function setupSimulateVoiceInput(inputEl) {
  const voiceBtn = document.getElementById('simulateVoiceBtn');
  if (!voiceBtn) return;
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) { voiceBtn.disabled = true; return; }
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new SpeechRecognition();
  rec.lang = 'zh-CN';
  rec.interimResults = true;
  let recording = false;
  voiceBtn.onmousedown = () => { if (recording) return; try { rec.start(); recording = true; voiceBtn.style.background = '#d32f2f'; voiceBtn.textContent = '🔴'; } catch(e) {} };
  voiceBtn.onmouseup = () => { if (recording) rec.stop(); };
  voiceBtn.onmouseleave = () => { if (recording) rec.stop(); };
  rec.onresult = e => { const t = Array.from(e.results).map(r => r[0].transcript).join(''); inputEl.value = t; };
  rec.onerror = () => { recording = false; voiceBtn.style.background = '#4a90e2'; voiceBtn.textContent = '🎤'; };
  rec.onend = () => { recording = false; voiceBtn.style.background = '#4a90e2'; voiceBtn.textContent = '🎤'; };
}