// frontend/src/modules/meeting.js
import { fetchWithAuth } from '../utils/api';
import { appState, createNewSession, switchSession } from './state';
import { escapeHtml, playSound, updateTaskProgress, setupVoiceInput, setActiveNavByView } from '../utils/helpers';

let currentMeeting = null;
let meetingTyping = false;
let meetingPollInterval = null;

const meetingTypes = [
  { value: 'villager', label: '村民大会', roles: [
    { name: '张大爷', avatar: '👴', personality: '固执、爱面子', stance: '中立', stanceValue: 0.5, id: 'v1' },
    { name: '李大妈', avatar: '👵', personality: '热情、话多', stance: '中立', stanceValue: 0.5, id: 'v2' },
    { name: '王叔', avatar: '👨', personality: '务实、理性', stance: '中立', stanceValue: 0.5, id: 'v3' },
    { name: '赵婶', avatar: '👩', personality: '敏感、爱抱怨', stance: '中立', stanceValue: 0.5, id: 'v4' }
  ] },
  { value: 'cadre', label: '村干部大会', roles: [
    { name: '村支书', avatar: '👨‍💼', personality: '稳重、有远见', stance: '支持', stanceValue: 0.8, id: 'c1' },
    { name: '村主任', avatar: '👩‍💼', personality: '务实、执行力强', stance: '支持', stanceValue: 0.7, id: 'c2' },
    { name: '妇女主任', avatar: '👩', personality: '细心、善于沟通', stance: '中立', stanceValue: 0.5, id: 'c3' },
    { name: '民兵连长', avatar: '👮', personality: '直爽、急躁', stance: '中立', stanceValue: 0.5, id: 'c4' }
  ] }
];

const commonTopics = ['人居环境整治', '土地流转协调', '产业发展规划', '矛盾纠纷调解', '惠民政策宣传'];

export async function renderMeetingSetupView() {
  if (meetingPollInterval) clearInterval(meetingPollInterval);
  const dynamicContent = document.getElementById('dynamicContent');
  dynamicContent.innerHTML = `
    <div class="meeting-setup" style="max-width:600px; margin:20px auto; padding:20px; background:white; border-radius:16px; box-shadow:0 2px 8px rgba(0,0,0,0.1);">
      <h3 style="margin-bottom:20px;">🏛️ 会议模式</h3>
      <div style="margin-bottom:16px;">
        <label style="display:block; margin-bottom:6px;">会议类型：</label>
        <select id="meetingTypeSelect" style="width:100%; padding:8px; border-radius:8px; border:1px solid #ccc;">
          ${meetingTypes.map(t => `<option value="${t.value}">${t.label}</option>`).join('')}
        </select>
      </div>
      <div style="margin-bottom:16px;">
        <label style="display:block; margin-bottom:6px;">会议主题：</label>
        <select id="meetingTopicSelect" style="width:100%; padding:8px; border-radius:8px; border:1px solid #ccc;">
          <option value="custom">自定义主题</option>
          ${commonTopics.map(t => `<option value="${t}">${t}</option>`).join('')}
        </select>
        <input type="text" id="customTopicInput" placeholder="输入自定义主题" style="width:100%; margin-top:8px; padding:8px; border-radius:8px; border:1px solid #ccc; display:none;">
      </div>
      <div style="margin-bottom:16px;">
        <label style="display:block; margin-bottom:6px;">议程（每行一个，可调整顺序）</label>
        <textarea id="agendaInput" rows="4" style="width:100%; padding:8px; border-radius:8px; border:1px solid #ccc;" placeholder="例如：&#10;1. 开场致辞&#10;2. 村民意见收集&#10;3. 方案讨论&#10;4. 投票表决"></textarea>
      </div>
      <div style="margin-bottom:16px;">
        <label style="display:block; margin-bottom:6px;">参与人员（格式：姓名:头像:性格，每行一个）</label>
        <textarea id="customRolesInput" rows="3" style="width:100%; padding:8px; border-radius:8px; border:1px solid #ccc;"></textarea>
        <div style="font-size:0.8rem; color:#666; margin-top:4px;">留空则使用默认人员</div>
      </div>
      <button id="startMeetingBtn" class="submit-btn" style="width:100%;">开始会议</button>
    </div>
  `;

  const typeSelect = document.getElementById('meetingTypeSelect');
  const topicSelect = document.getElementById('meetingTopicSelect');
  const customInput = document.getElementById('customTopicInput');
  topicSelect.addEventListener('change', () => {
    const isCustom = topicSelect.value === 'custom';
    customInput.style.display = isCustom ? 'block' : 'none';
    if (!isCustom) customInput.value = '';
  });
  document.getElementById('startMeetingBtn').onclick = async () => {
    const meetingType = typeSelect.value;
    let topic = topicSelect.value;
    if (topic === 'custom') topic = customInput.value.trim();
    if (!topic) { alert('请填写会议主题'); return; }
    let roles = [];
    const customRolesText = document.getElementById('customRolesInput').value.trim();
    if (customRolesText) {
      const lines = customRolesText.split('\n');
      for (let line of lines) {
        const parts = line.split(':');
        if (parts.length >= 2) {
          roles.push({
            name: parts[0].trim(),
            avatar: parts[1].trim() || '👤',
            personality: parts[2] ? parts[2].trim() : '普通',
            stance: '中立',
            stanceValue: 0.5,
            id: `custom_${Date.now()}_${Math.random()}`
          });
        }
      }
    }
    if (roles.length === 0) {
      const defaultTypes = { villager: meetingTypes[0].roles, cadre: meetingTypes[1].roles };
      roles = defaultTypes[meetingType] || meetingTypes[0].roles;
    }
    let agendaText = document.getElementById('agendaInput').value.trim();
    let agenda = [];
    if (agendaText) {
      agenda = agendaText.split('\n').filter(l => l.trim()).map((l, idx) => ({ name: l.replace(/^\d+\.\s*/, ''), description: '', order: idx }));
    } else {
      agenda = [
        { name: '议题介绍', description: '主持人介绍本次会议议题', order: 0 },
        { name: '村民发言', description: '听取各方意见', order: 1 },
        { name: '讨论与辩论', description: '针对分歧进行讨论', order: 2 },
        { name: '投票表决', description: '对最终方案进行投票', order: 3 }
      ];
    }
    await startMeeting(roles, topic, agenda);
  };
  setActiveNavByView('meeting');
}

async function startMeeting(roles, topic, agenda) {
  const res = await fetchWithAuth('/api/meeting/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic, villagers: roles, agenda })
  });
  const data = await res.json();
  const sessionId = data.sessionId;
  const session = { id: sessionId, title: topic, type: 'meeting', messages: [], createdAt: new Date().toISOString() };
  appState.sessions.unshift(session);
  const { renderSessionList } = await import('./ui');
  renderSessionList();
  await switchSession(sessionId);
  currentMeeting = { sessionId, villagers: roles, agenda, currentAgendaIndex: 0, votes: {}, topic };
  renderMeetingChatArea();
  startMeetingPolling(sessionId);
}

async function startMeetingPolling(sessionId) {
  if (meetingPollInterval) clearInterval(meetingPollInterval);
  meetingPollInterval = setInterval(async () => {
    try {
      const res = await fetchWithAuth(`/api/meeting/status/${sessionId}`);
      const data = await res.json();
      if (currentMeeting) {
        currentMeeting.agenda = data.agenda;
        currentMeeting.currentAgendaIndex = data.currentAgendaIndex;
        currentMeeting.votes = data.votes;
        currentMeeting.satisfaction = data.satisfaction;
        currentMeeting.emotions = data.emotions;
        if (data.meetingStatus === 'finished' && data.resolution) {
          clearInterval(meetingPollInterval);
          showMeetingResolution(data.resolution);
        }
        updateMeetingUI();
      }
    } catch(e) { console.warn('轮询会议状态失败', e); }
  }, 3000);
}

function updateMeetingUI() {
  if (!currentMeeting) return;
  // 更新议程高亮
  const agendaContainer = document.getElementById('meetingAgenda');
  if (agendaContainer && currentMeeting.agenda) {
    agendaContainer.innerHTML = currentMeeting.agenda.map((item, idx) => `
      <div class="agenda-item ${idx === currentMeeting.currentAgendaIndex ? 'current' : ''} ${idx < currentMeeting.currentAgendaIndex ? 'completed' : ''}">
        ${idx+1}. ${escapeHtml(item.name)}
      </div>
    `).join('');
  }
  // 更新村民卡片
  const villagersContainer = document.getElementById('meetingVillagers');
  if (villagersContainer && currentMeeting.villagers) {
    currentMeeting.villagers.forEach(v => {
      const card = villagersContainer.querySelector(`.villager-card[data-id="${v.id}"]`);
      if (card) {
        const stanceSpan = card.querySelector('.villager-stance');
        if (stanceSpan) {
          stanceSpan.textContent = v.stance === '支持' ? '✅' : (v.stance === '反对' ? '❌' : '⚪');
          stanceSpan.className = `villager-stance stance-${v.stance === '支持' ? 'support' : (v.stance === '反对' ? 'oppose' : 'neutral')}`;
        }
        const fill = card.querySelector('.satisfaction-mini-fill');
        if (fill && v.stanceValue !== undefined) fill.style.width = `${v.stanceValue * 100}%`;
      }
    });
  }
  // 更新投票结果
  const voteResultContainer = document.getElementById('meetingVoteResult');
  if (voteResultContainer && currentMeeting.votes) {
    const currentVotes = currentMeeting.votes[currentMeeting.currentAgendaIndex] || {};
    const support = Object.values(currentVotes).filter(v => v === '支持').length;
    const oppose = Object.values(currentVotes).filter(v => v === '反对').length;
    voteResultContainer.innerHTML = `<div>当前投票：支持 ${support} 人，反对 ${oppose} 人</div>`;
  }
  // 更新满意度
  const satisfactionDiv = document.getElementById('meetingSatisfaction');
  if (satisfactionDiv && currentMeeting.satisfaction !== undefined) {
    satisfactionDiv.innerHTML = `村民满意度：${currentMeeting.satisfaction}%`;
  }
}

function renderMeetingChatArea() {
  if (!currentMeeting) return;
  const dynamicContent = document.getElementById('dynamicContent');
  dynamicContent.innerHTML = `
    <div class="meeting-layout" style="display:flex; height:100%; gap:16px; padding:16px; background:#f5f7fa;">
      <!-- 左侧信息栏 -->
      <div class="meeting-sidebar" style="width:280px; background:white; border-radius:16px; padding:16px; display:flex; flex-direction:column; gap:20px; overflow-y:auto;">
        <div>
          <h3 style="margin-bottom:8px;">🏛️ ${escapeHtml(currentMeeting.topic || '会议')}</h3>
          <div id="meetingSatisfaction" style="font-size:0.9rem; color:#2e5d34;">村民满意度：${currentMeeting.satisfaction || 50}%</div>
        </div>
        <div>
          <h4>📋 议程</h4>
          <div id="meetingAgenda" style="margin-top:8px;"></div>
          <button id="nextAgendaBtn" class="summary-btn" style="margin-top:12px; background:#ff9800;">下一议程</button>
          <button id="voteBtn" class="summary-btn" style="margin-top:8px; background:#4caf50;">投票</button>
        </div>
        <div id="meetingVoteResult" style="font-size:0.85rem; background:#f0f0f0; padding:8px; border-radius:8px;"></div>
        <div>
          <h4>👥 参会人员</h4>
          <div id="meetingVillagers" style="display:flex; flex-direction:column; gap:8px; margin-top:8px;"></div>
        </div>
        <button id="exitMeetingBtn" class="summary-btn" style="background:#f44336; color:white;">退出会议</button>
      </div>
      <!-- 右侧聊天区 -->
      <div class="meeting-chat-area" style="flex:1; background:white; border-radius:16px; display:flex; flex-direction:column; overflow:hidden;">
        <div class="meeting-messages" id="meetingMessages" style="flex:1; overflow-y:auto; padding:16px;"></div>
        <div class="meeting-input-area" style="border-top:1px solid #eee; padding:12px; display:flex; gap:8px;">
          <textarea id="meetingInput" placeholder="向与会人员发言..." rows="2" style="flex:1; padding:8px; border-radius:20px; border:1px solid #ccc; resize:none;"></textarea>
          <button id="sendMeetingBtn" style="background:#2e5d34; color:white; border:none; border-radius:30px; padding:0 20px;">发送</button>
          <button id="meetingVoiceBtn" class="voice-btn" style="background:#f0f0f0; border:none; border-radius:30px; padding:0 16px;">🎤</button>
        </div>
      </div>
    </div>
  `;
  renderMeetingVillagers();
  const meetingInput = document.getElementById('meetingInput');
  const sendBtn = document.getElementById('sendMeetingBtn');
  const exitBtn = document.getElementById('exitMeetingBtn');
  const nextAgendaBtn = document.getElementById('nextAgendaBtn');
  const voteBtn = document.getElementById('voteBtn');
  const voiceBtn = document.getElementById('meetingVoiceBtn');
  sendBtn.onclick = () => sendMeetingMessage();
  meetingInput.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !meetingTyping) { e.preventDefault(); sendMeetingMessage(); } };
  exitBtn.onclick = () => { if (meetingPollInterval) clearInterval(meetingPollInterval); renderMeetingSetupView(); };
  nextAgendaBtn.onclick = async () => {
    await fetchWithAuth('/api/meeting/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: currentMeeting.sessionId, action: 'nextAgenda' })
    });
    const statusRes = await fetchWithAuth(`/api/meeting/status/${currentMeeting.sessionId}`);
    const data = await statusRes.json();
    currentMeeting.currentAgendaIndex = data.currentAgendaIndex;
    currentMeeting.agenda = data.agenda;
    updateMeetingUI();
  };
  voteBtn.onclick = () => showVoteModal();
  if (voiceBtn) setupVoiceInput(meetingInput, voiceBtn);
  setActiveNavByView('meeting');
  // 加载历史消息
  loadMeetingHistory();
}

async function loadMeetingHistory() {
  const session = appState.sessions.find(s => s.id === currentMeeting.sessionId);
  if (session && session.messages) {
    const container = document.getElementById('meetingMessages');
    if (container) {
      container.innerHTML = '';
      session.messages.forEach(msg => {
        if (msg.role === 'system') return;
        const roleClass = msg.role === 'user' ? 'user' : 'assistant';
        let avatar = msg.role === 'user' ? '👨‍🌾' : '👤';
        let name = msg.role === 'user' ? '村官' : (currentMeeting.villagers.find(v => msg.content.includes(v.name))?.name || '村民');
        const msgDiv = document.createElement('div');
        msgDiv.className = `meeting-message ${roleClass}`;
        msgDiv.innerHTML = `<div class="message-avatar">${avatar}</div><div class="message-bubble"><strong>${escapeHtml(name)}</strong><br>${escapeHtml(msg.content)}</div>`;
        container.appendChild(msgDiv);
      });
      container.scrollTop = container.scrollHeight;
    }
  }
}

function renderMeetingVillagers() {
  const container = document.getElementById('meetingVillagers');
  if (!container) return;
  container.innerHTML = '';
  currentMeeting.villagers.forEach(v => {
    const card = document.createElement('div');
    card.className = 'villager-card';
    card.dataset.id = v.id;
    const stanceIcon = v.stance === '支持' ? '✅' : (v.stance === '反对' ? '❌' : '⚪');
    const stanceClass = `stance-${v.stance === '支持' ? 'support' : (v.stance === '反对' ? 'oppose' : 'neutral')}`;
    card.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px;">
        <div class="villager-avatar" style="font-size:1.5rem;">${v.avatar}</div>
        <div style="flex:1;">
          <div class="villager-name" style="font-weight:bold;">${escapeHtml(v.name)}</div>
          <div class="villager-stance ${stanceClass}" style="font-size:0.8rem;">${stanceIcon} ${v.stance}</div>
          <div class="satisfaction-mini" style="background:#eee; border-radius:4px; height:4px; margin-top:4px;"><div class="satisfaction-mini-fill" style="width:${(v.stanceValue || 0.5) * 100}%; background:#4caf50; height:4px; border-radius:4px;"></div></div>
        </div>
      </div>
    `;
    card.onclick = () => {
      currentMeeting.activeVillagerId = v.id;
      document.querySelectorAll('.villager-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
    };
    container.appendChild(card);
  });
  if (currentMeeting.villagers.length) {
    const firstCard = container.querySelector('.villager-card');
    if (firstCard) firstCard.classList.add('active');
    currentMeeting.activeVillagerId = currentMeeting.villagers[0].id;
  }
}

function showVoteModal() {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="modal-content" style="width:300px;">
      <button class="modal-close">&times;</button>
      <h3>投票表决</h3>
      <p>当前议程：${escapeHtml(currentMeeting.agenda[currentMeeting.currentAgendaIndex]?.name)}</p>
      <div style="display:flex; gap:16px; justify-content:center; margin-top:20px;">
        <button id="voteSupport" style="background:#4caf50; color:white; padding:8px 24px; border:none; border-radius:30px;">支持</button>
        <button id="voteOppose" style="background:#f44336; color:white; padding:8px 24px; border:none; border-radius:30px;">反对</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('.modal-close').onclick = () => document.body.removeChild(modal);
  modal.onclick = e => { if (e.target === modal) document.body.removeChild(modal); };
  modal.querySelector('#voteSupport').onclick = async () => {
    await fetchWithAuth('/api/meeting/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: currentMeeting.sessionId, action: 'vote', option: '支持' })
    });
    document.body.removeChild(modal);
    alert('投票已记录');
  };
  modal.querySelector('#voteOppose').onclick = async () => {
    await fetchWithAuth('/api/meeting/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: currentMeeting.sessionId, action: 'vote', option: '反对' })
    });
    document.body.removeChild(modal);
    alert('投票已记录');
  };
}

async function sendMeetingMessage() {
  const input = document.getElementById('meetingInput');
  const text = input.value.trim();
  if (!text || meetingTyping) return;
  input.value = '';
  const activeVillager = currentMeeting.villagers.find(v => v.id === currentMeeting.activeVillagerId);
  if (!activeVillager) return;
  const userMsgDiv = document.createElement('div');
  userMsgDiv.className = 'meeting-message user';
  userMsgDiv.innerHTML = `<div class="message-avatar">👨‍🌾</div><div class="message-bubble">${escapeHtml(text)}</div>`;
  const messagesContainer = document.getElementById('meetingMessages');
  messagesContainer.appendChild(userMsgDiv);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
  meetingTyping = true;
  try {
    const res = await fetchWithAuth('/api/meeting/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: currentMeeting.sessionId, message: text, villagerId: activeVillager.id })
    });
    const data = await res.json();
    const reply = data.reply || '嗯...我再想想。';
    const replyDiv = document.createElement('div');
    replyDiv.className = 'meeting-message assistant';
    replyDiv.innerHTML = `<div class="message-avatar">${activeVillager.avatar}</div><div class="message-bubble"><strong>${escapeHtml(activeVillager.name)}</strong><br>${escapeHtml(reply)}</div>`;
    messagesContainer.appendChild(replyDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    playSound('send');
    updateTaskProgress('meeting', 1);
  } catch(err) {
    console.error(err);
    const errDiv = document.createElement('div');
    errDiv.className = 'meeting-message assistant';
    errDiv.innerHTML = `<div class="message-avatar">⚠️</div><div class="message-bubble">系统繁忙，请稍后再试。</div>`;
    messagesContainer.appendChild(errDiv);
  } finally {
    meetingTyping = false;
  }
}

function showMeetingResolution(resolution) {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="modal-content" style="width:500px;">
      <button class="modal-close">&times;</button>
      <h3>📄 会议决议</h3>
      <div class="meeting-resolution">
        <p><strong>通过的议题：</strong>${resolution.passedItems?.join('、') || '无'}</p>
        <p><strong>未通过的议题：</strong>${resolution.failedItems?.join('、') || '无'}</p>
        <hr>
        <h4>会议纪要</h4>
        <div style="white-space:pre-wrap;">${escapeHtml(resolution.minutes || '')}</div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('.modal-close').onclick = () => document.body.removeChild(modal);
  modal.onclick = e => { if (e.target === modal) document.body.removeChild(modal); };
}

export async function renderMeetingChat(session) {
  if (meetingPollInterval) clearInterval(meetingPollInterval);
  let config = {};
  if (session.scenarioId) {
    try { config = JSON.parse(session.scenarioId); } catch(e) {}
  }
  const topic = session.title || '会议';
  const villagers = config.villagers || [];
  const agenda = config.agenda || [];
  const currentAgendaIndex = config.currentAgendaIndex || 0;
  const votes = config.votes || {};
  const satisfaction = config.satisfaction || 50;
  const emotions = config.emotions || {};
  currentMeeting = {
    sessionId: session.id,
    topic,
    villagers,
    agenda,
    currentAgendaIndex,
    votes,
    satisfaction,
    emotions,
    activeVillagerId: villagers[0]?.id
  };
  renderMeetingChatArea();
  startMeetingPolling(session.id);
}