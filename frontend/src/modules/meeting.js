// frontend/src/modules/meeting.js
import { fetchWithAuth } from '../utils/api';
import { appState, switchSession } from './state';
import { escapeHtml, playSound, updateTaskProgress, setupVoiceInput, setActiveNavByView } from '../utils/helpers';

// ==================== 预设会议模板（5个主题） ====================
const presetTemplates = {
  '人居环境整治': {
    description: '村内部分区域存在垃圾乱倒、柴草乱堆、污水横流现象，村民投诉较多。需要制定整治方案并动员大家参与。',
    agenda: [
      '介绍当前环境问题现状',
      '讨论整治措施（垃圾定点投放、柴草集中堆放）',
      '明确各户责任和奖惩机制',
      '投票表决整治方案'
    ],
    villagers: [
      { name: '张大爷', avatar: '👴', personality: '固执、嫌麻烦', initialStance: '反对', stanceValue: 0.2, coreDemand: '不想多走路倒垃圾' },
      { name: '李大妈', avatar: '👵', personality: '爱干净、支持', initialStance: '支持', stanceValue: 0.8, coreDemand: '希望村里统一规划' },
      { name: '王叔', avatar: '👨', personality: '理性、观望', initialStance: '中立', stanceValue: 0.5, coreDemand: '担心费用和公平性' }
    ],
    systemOpening: '🏛️ 欢迎参加【人居环境整治】专题会议。目前村内垃圾乱倒、柴草乱堆问题突出，村民投诉较多。今天的任务是：讨论并通过一份可行的整治方案。请您作为主持人，引导大家发言。'
  },
  '土地流转协调': {
    description: '村东头50亩连片耕地，部分村民想流转给种植大户，但少数村民担心失去土地不愿意。需要协调矛盾，达成流转协议。',
    agenda: [
      '介绍流转方案和收益预期',
      '听取反对村民的顾虑',
      '讨论补偿和保障措施',
      '投票表决是否同意流转'
    ],
    villagers: [
      { name: '赵叔', avatar: '👨‍🌾', personality: '保守、担心', initialStance: '反对', stanceValue: 0.2, coreDemand: '怕流转后没保障' },
      { name: '孙婶', avatar: '👩', personality: '积极、愿意尝试', initialStance: '支持', stanceValue: 0.9, coreDemand: '想多拿租金' },
      { name: '李会计', avatar: '🧑‍💼', personality: '精明、算得清', initialStance: '中立', stanceValue: 0.5, coreDemand: '要看到详细合同' }
    ],
    systemOpening: '🏛️ 欢迎参加【土地流转协调】会议。村东头50亩地，大部分村民同意流转，但有少数村民担心失去土地。今天我们需要听取各方意见，制定一个让大多数人满意的流转方案。请您主持。'
  },
  '产业发展规划': {
    description: '村里计划发展特色农产品加工产业，需要申请项目资金，但部分村民担心风险。',
    agenda: [
      '介绍产业规划草案和预期收益',
      '分析风险和应对措施',
      '讨论村民参与方式和分红机制',
      '投票表决是否启动项目'
    ],
    villagers: [
      { name: '刘能人', avatar: '🧑‍🌾', personality: '胆大、敢闯', initialStance: '支持', stanceValue: 0.9, coreDemand: '想带头致富' },
      { name: '陈大妈', avatar: '👩', personality: '谨慎、怕亏', initialStance: '反对', stanceValue: 0.2, coreDemand: '怕投入的钱打水漂' },
      { name: '周会计', avatar: '🧑‍💼', personality: '精明、爱算账', initialStance: '中立', stanceValue: 0.5, coreDemand: '要看详细财务预测' }
    ],
    systemOpening: '🏛️ 欢迎参加【产业发展规划】会议。村里计划发展特色农产品加工，需要大家支持。今天要讨论项目可行性、风险应对和村民参与方式。请您主持。'
  },
  '矛盾纠纷调解': {
    description: '两户村民因宅基地边界发生激烈争吵，甚至动手，需要村干部出面调解，化解矛盾。',
    agenda: [
      '分别听取双方陈述',
      '现场勘查并查阅原始资料',
      '提出折中解决方案',
      '双方签字确认和解协议'
    ],
    villagers: [
      { name: '张老三', avatar: '👨', personality: '暴躁、不服软', initialStance: '反对', stanceValue: 0.1, coreDemand: '必须让对方赔礼道歉' },
      { name: '李老二', avatar: '👨', personality: '倔强、爱面子', initialStance: '反对', stanceValue: 0.1, coreDemand: '寸土不让' },
      { name: '王支书', avatar: '👨‍💼', personality: '公正、有威望', initialStance: '中立', stanceValue: 0.5, coreDemand: '希望尽快平息纠纷' }
    ],
    systemOpening: '🏛️ 欢迎参加【矛盾纠纷调解】会议。张老三和李老二因宅基地边界问题发生冲突，双方情绪激动。今天需要您作为调解人，依法依规、公平公正地化解矛盾。'
  },
  '惠民政策宣讲': {
    description: '村里新出台了医保补贴和养老政策，很多村民不了解、不相信，需要开会宣讲并解答疑问。',
    agenda: [
      '解读医保补贴新政策',
      '解读养老待遇调整方案',
      '村民提问与答疑',
      '收集村民反馈意见'
    ],
    villagers: [
      { name: '孙奶奶', avatar: '👵', personality: '耳背、多疑', initialStance: '反对', stanceValue: 0.2, coreDemand: '担心政策是骗人的' },
      { name: '赵大叔', avatar: '👨', personality: '精明、爱比较', initialStance: '中立', stanceValue: 0.5, coreDemand: '想知道具体能多拿多少钱' },
      { name: '钱会计', avatar: '🧑‍💼', personality: '理性、懂政策', initialStance: '支持', stanceValue: 0.8, coreDemand: '希望村民都能参保' }
    ],
    systemOpening: '🏛️ 欢迎参加【惠民政策宣讲】会议。今天主要讲解医保补贴和养老政策的新变化，请大家认真听讲，有疑问随时提出。'
  }
};

// 引导提示库
const meetingTips = [
  '💡 尝试先肯定村民的合理诉求，再提出解决方案。',
  '💡 引用相关政策条款（如《土地管理法》）能增加说服力。',
  '💡 可以承诺在会后一周内给出书面方案。',
  '💡 邀请反对最激烈的村民先表达完整意见。',
  '💡 提出一个试点方案，让大家看到可行性。',
  '💡 用数据说话，比如预计收益、成本回收周期。',
  '💡 适当让步，满足村民的部分核心诉求。',
  '💡 引导大家聚焦议题，避免跑题。'
];

// ==================== 默认角色（按会议类型） ====================
const defaultRolesByType = {
  villager: [
    { name: '张大爷', avatar: '👴', personality: '固执、爱面子', initialStance: '中立', stanceValue: 0.5, coreDemand: '' },
    { name: '李大妈', avatar: '👵', personality: '热情、话多', initialStance: '中立', stanceValue: 0.5, coreDemand: '' },
    { name: '王叔', avatar: '👨', personality: '理性、务实', initialStance: '中立', stanceValue: 0.5, coreDemand: '' }
  ],
  cadre: [
    { name: '村支书', avatar: '👨‍💼', personality: '稳重、有远见', initialStance: '支持', stanceValue: 0.8, coreDemand: '希望决策科学民主' },
    { name: '村主任', avatar: '👩‍💼', personality: '务实、执行力强', initialStance: '支持', stanceValue: 0.7, coreDemand: '希望项目尽快落地' },
    { name: '妇女主任', avatar: '👩', personality: '细心、善于沟通', initialStance: '中立', stanceValue: 0.5, coreDemand: '关注妇女和家庭利益' },
    { name: '民兵连长', avatar: '👮', personality: '直爽、急躁', initialStance: '中立', stanceValue: 0.5, coreDemand: '希望安全有保障' }
  ]
};

// ==================== 全局会议状态 ====================
let currentMeeting = null;
let meetingTyping = false;
let meetingPollInterval = null;
let roundRobinInProgress = false;
let votingInProgress = false;
let votesReceived = {};
let currentAgendaIndex = 0;
let showTips = true;
let meetingStage = 'opening';        // opening, roundRobin, discussion, voting, finished
let currentMeetingType = 'villager'; // villager 或 cadre

// ==================== 辅助函数 ====================
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function appendMeetingMessage(role, name, avatar, content) {
  const container = document.getElementById('meetingMessages');
  if (!container) return;
  const msgDiv = document.createElement('div');
  msgDiv.className = `meeting-message ${role}`;
  msgDiv.innerHTML = `
    <div class="message-avatar">${avatar}</div>
    <div class="message-bubble">
      <strong>${escapeHtml(name)}</strong><br>
      ${escapeHtml(content)}
    </div>
  `;
  container.appendChild(msgDiv);
  container.scrollTop = container.scrollHeight;
}

function appendSystemMessage(content) {
  const container = document.getElementById('meetingMessages');
  if (!container) return;
  const sysDiv = document.createElement('div');
  sysDiv.className = 'meeting-message system';
  sysDiv.innerHTML = `<div class="message-bubble system-bubble">📢 ${escapeHtml(content)}</div>`;
  container.appendChild(sysDiv);
  container.scrollTop = container.scrollHeight;
}

async function sendSystemMessage(sessionId, content) {
  appendSystemMessage(content);
  const res = await fetchWithAuth('/api/meeting/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, message: content, isSystem: true })
  });
  return res.ok;
}

function updateMeetingUI() {
  if (!currentMeeting) return;
  const agendaContainer = document.getElementById('meetingAgenda');
  if (agendaContainer && currentMeeting.agenda) {
    agendaContainer.innerHTML = currentMeeting.agenda.map((item, idx) => `
      <div class="agenda-item ${idx === currentAgendaIndex ? 'current' : ''} ${idx < currentAgendaIndex ? 'completed' : ''}">
        ${idx+1}. ${escapeHtml(item.name)} ${item.completed ? '✅' : ''}
      </div>
    `).join('');
  }
  const satisfactionDiv = document.getElementById('meetingSatisfaction');
  if (satisfactionDiv && currentMeeting.satisfaction !== undefined) {
    satisfactionDiv.innerHTML = `满意度：${currentMeeting.satisfaction}%`;
  }
  const inputArea = document.querySelector('.meeting-input-area');
  const voteBtn = document.getElementById('voteBtn');
  const nextAgendaBtn = document.getElementById('nextAgendaBtn');
  const finishBtn = document.getElementById('finishMeetingBtn');
  if (inputArea) {
    const isDisabled = (roundRobinInProgress || votingInProgress || meetingStage === 'finished');
    const textarea = inputArea.querySelector('textarea');
    const sendBtn = inputArea.querySelector('button');
    if (textarea) textarea.disabled = isDisabled;
    if (sendBtn) sendBtn.disabled = isDisabled;
  }
  if (voteBtn) voteBtn.disabled = (meetingStage !== 'discussion') || votingInProgress;
  if (nextAgendaBtn) nextAgendaBtn.disabled = (currentAgendaIndex >= currentMeeting.agenda.length - 1) || !currentMeeting.agenda[currentAgendaIndex]?.completed;
  if (finishBtn) finishBtn.disabled = (meetingStage === 'finished');

  const tipContainer = document.getElementById('guidanceTip');
  if (tipContainer && showTips && meetingStage === 'discussion') {
    tipContainer.style.display = 'flex';
  } else if (tipContainer) {
    tipContainer.style.display = 'none';
  }
}

// 自动村民发言（简短）
async function autoVillagerSpeak(sessionId, villager, previousMessage = '') {
  try {
    const res = await fetchWithAuth('/api/meeting/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        message: `请${villager.name}根据你的性格（${villager.personality}）、立场（${villager.initialStance}）、核心诉求（${villager.coreDemand || '无'}），针对前面的话（${previousMessage.substring(0, 100)}）发表简短看法（1-2句话）。`,
        villagerId: villager.id,
        autoSpeak: true
      })
    });
    const data = await res.json();
    return data.reply;
  } catch(e) {
    console.error('自动发言失败', e);
    return `${villager.name}：嗯，我再想想。`;
  }
}

// 轮流发言（开场白后自动触发）
async function startRoundRobin(sessionId, villagers, systemOpening, meetingType) {
  roundRobinInProgress = true;
  meetingStage = 'roundRobin';
  updateMeetingUI();

  await sendSystemMessage(sessionId, systemOpening);
  await delay(1000);

  let lastMessage = systemOpening;
  for (let i = 0; i < villagers.length; i++) {
    const v = villagers[i];
    const reply = await autoVillagerSpeak(sessionId, v, lastMessage);
    appendMeetingMessage('assistant', v.name, v.avatar, reply);
    lastMessage = reply;
    await delay(1500);
  }

  roundRobinInProgress = false;
  meetingStage = 'discussion';
  updateMeetingUI();
  const roleName = meetingType === 'cadre' ? '村干部' : '村民';
  await sendSystemMessage(sessionId, `📢 ${roleName}发言结束，现在您可以引导讨论。点击💡按钮获取建议。`);
}
// ==================== 开始会议 ====================
async function startMeeting(roles, topic, agenda, isPreset, meetingType) {
  try {
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
    currentMeeting = { sessionId, villagers: roles, agenda, currentAgendaIndex: 0, votes: {}, satisfaction: 50, topic, stage: 'opening' };
    currentAgendaIndex = 0;
    meetingStage = 'opening';
    votingInProgress = false;
    votesReceived = {};
    currentMeetingType = meetingType;
    renderMeetingChatArea();
    startMeetingPolling(sessionId);
    if (isPreset && presetTemplates[topic]) {
      let opening = presetTemplates[topic].systemOpening;
      if (meetingType === 'cadre') {
        opening = opening.replace(/村民/g, '村干部');
      }
      await startRoundRobin(sessionId, roles, opening, meetingType);
    } else {
      const opening = meetingType === 'cadre'
        ? `🏛️ 村干部会议《${topic}》开始。请按照议程引导讨论。`
        : `🏛️ 村民大会《${topic}》开始。请按照议程引导讨论。`;
      await sendSystemMessage(sessionId, opening);
      meetingStage = 'discussion';
      updateMeetingUI();
    }
  } catch(err) {
    alert('启动会议失败：' + err.message);
  }
}

// 轮询会议状态
async function startMeetingPolling(sessionId) {
  if (meetingPollInterval) clearInterval(meetingPollInterval);
  meetingPollInterval = setInterval(async () => {
    try {
      const res = await fetchWithAuth(`/api/meeting/status/${sessionId}`);
      const data = await res.json();
      if (currentMeeting) {
        currentMeeting.agenda = data.agenda;
        currentMeeting.satisfaction = data.satisfaction;
        currentMeeting.emotions = data.emotions;
        currentAgendaIndex = data.currentAgendaIndex;
        if (data.votes) currentMeeting.votes = data.votes;
        updateMeetingUI();
        if (data.meetingStatus === 'finished') {
          clearInterval(meetingPollInterval);
          if (data.resolution) showMeetingResolution(data.resolution);
        }
      }
    } catch(e) { console.warn('轮询失败', e); }
  }, 3000);
}

// ==================== 渲染会议聊天区 ====================
export async function renderMeetingChat(session) {
  if (meetingPollInterval) clearInterval(meetingPollInterval);
  let config = {};
  if (session.scenarioId) {
    try { config = JSON.parse(session.scenarioId); } catch(e) {}
  }
  const topic = session.title || '会议';
  const villagers = config.villagers || [];
  const agenda = config.agenda || [];
  currentAgendaIndex = config.currentAgendaIndex || 0;
  const votes = config.votes || {};
  const satisfaction = config.satisfaction || 50;
  currentMeeting = {
    sessionId: session.id,
    topic,
    villagers,
    agenda,
    currentAgendaIndex,
    votes,
    satisfaction,
    activeVillagerId: villagers[0]?.id
  };
  meetingStage = 'discussion';
  currentMeetingType = 'villager'; // 无法从历史推断，默认为村民
  renderMeetingChatArea();
  startMeetingPolling(session.id);
}

function renderMeetingChatArea() {
  if (!currentMeeting) return;
  const dynamicContent = document.getElementById('dynamicContent');
  dynamicContent.innerHTML = `
    <div class="meeting-layout" style="display:flex; height:100%; gap:16px; padding:16px; background:#f5f7fa;">
      <div class="meeting-sidebar" id="meetingSidebar" style="width:280px; background:white; border-radius:16px; padding:16px; display:flex; flex-direction:column; gap:20px; overflow-y:auto;">
        <div>
          <h3 style="margin-bottom:8px;">🏛️ ${escapeHtml(currentMeeting.topic || '会议')}</h3>
          <div id="meetingSatisfaction" style="font-size:0.9rem; color:#2e5d34;">满意度：${currentMeeting.satisfaction || 50}%</div>
        </div>
        <div>
          <h4>📋 议程</h4>
          <div id="meetingAgenda" style="margin-top:8px;"></div>
          <button id="voteBtn" class="summary-btn" style="margin-top:12px; background:#4caf50; color:white;">🗳️ 发起投票</button>
          <button id="nextAgendaBtn" class="summary-btn" style="margin-top:8px; background:#ff9800;">⏩ 下一议程</button>
        </div>
        <div id="meetingVoteResult" style="font-size:0.85rem; background:#f0f0f0; padding:8px; border-radius:8px;"></div>
        <div>
          <h4>👥 参会人员</h4>
          <div id="meetingVillagers" style="display:flex; flex-direction:column; gap:8px; margin-top:8px;"></div>
        </div>
        <button id="finishMeetingBtn" class="summary-btn" style="background:#4caf50; color:white;">结束会议并生成纪要</button>
        <button id="exitMeetingBtn" class="summary-btn" style="background:#f44336; color:white; margin-top:8px;">退出会议</button>
      </div>
      <div class="meeting-chat-area" style="flex:1; background:white; border-radius:16px; display:flex; flex-direction:column; overflow:hidden;">
        <div class="meeting-messages" id="meetingMessages" style="flex:1; overflow-y:auto; padding:16px;"></div>
        <div class="meeting-input-area" style="border-top:1px solid #eee; padding:12px; display:flex; gap:8px; flex-direction:column;">
          <div id="guidanceTip" style="display:none; background:#e3f2fd; border-radius:12px; padding:8px; font-size:0.85rem; align-items:center; justify-content:space-between;">
            <span id="tipText">💡 试试点击获取建议</span>
            <button id="refreshTipBtn" class="summary-btn" style="background:#2e5d34; color:white; padding:2px 8px;">换一条</button>
            <button id="closeTipBtn" class="summary-btn" style="background:#ccc;">关闭</button>
          </div>
          <div style="display:flex; gap:8px;">
            <textarea id="meetingInput" placeholder="向与会人员发言..." rows="2" style="flex:1; padding:8px; border-radius:20px; border:1px solid #ccc; resize:none;"></textarea>
            <button id="sendMeetingBtn" style="background:#2e5d34; color:white; border:none; border-radius:30px; padding:0 20px;">发送</button>
            <button id="meetingVoiceBtn" class="voice-btn" style="background:#f0f0f0; border:none; border-radius:30px; padding:0 16px;">🎤</button>
          </div>
        </div>
      </div>
    </div>
    <button id="toggleSidebarBtn" class="mobile-sidebar-toggle" style="display:none;">📋 参会人员</button>
  `;

  renderMeetingVillagers();
  updateMeetingUI();

  const meetingInput = document.getElementById('meetingInput');
  const sendBtn = document.getElementById('sendMeetingBtn');
  const exitBtn = document.getElementById('exitMeetingBtn');
  const finishBtn = document.getElementById('finishMeetingBtn');
  const voteBtn = document.getElementById('voteBtn');
  const nextAgendaBtn = document.getElementById('nextAgendaBtn');
  const voiceBtn = document.getElementById('meetingVoiceBtn');
  const tipContainer = document.getElementById('guidanceTip');
  const tipText = document.getElementById('tipText');
  const refreshTipBtn = document.getElementById('refreshTipBtn');
  const closeTipBtn = document.getElementById('closeTipBtn');

  if (refreshTipBtn) {
    refreshTipBtn.onclick = () => {
      const randomTip = meetingTips[Math.floor(Math.random() * meetingTips.length)];
      if (tipText) tipText.innerHTML = randomTip;
    };
  }
  if (closeTipBtn) {
    closeTipBtn.onclick = () => {
      showTips = false;
      tipContainer.style.display = 'none';
    };
  }

  sendBtn.onclick = () => sendMeetingMessage(meetingInput.value.trim(), false);
  meetingInput.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !meetingTyping) { e.preventDefault(); sendMeetingMessage(meetingInput.value.trim(), false); } };
  exitBtn.onclick = () => { if (meetingPollInterval) clearInterval(meetingPollInterval); renderMeetingSetupView(); };
  finishBtn.onclick = () => finishMeeting();
  nextAgendaBtn.onclick = () => nextAgenda();
  voteBtn.onclick = () => startVoting();

  if (voiceBtn) setupVoiceInput(meetingInput, voiceBtn);
  setActiveNavByView('meeting');
  loadMeetingHistory();
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
          <div class="villager-stance ${stanceClass}" style="font-size:0.8rem;">${stanceIcon} ${v.stance || v.initialStance}</div>
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

async function loadMeetingHistory() {
  const session = appState.sessions.find(s => s.id === currentMeeting.sessionId);
  if (session && session.messages) {
    const container = document.getElementById('meetingMessages');
    if (container) {
      container.innerHTML = '';
      session.messages.forEach(msg => {
        if (msg.role === 'system') {
          const sysDiv = document.createElement('div');
          sysDiv.className = 'meeting-message system';
          sysDiv.innerHTML = `<div class="message-bubble system-bubble">📢 ${escapeHtml(msg.content)}</div>`;
          container.appendChild(sysDiv);
          return;
        }
        const roleClass = msg.role === 'user' ? 'user' : 'assistant';
        let avatar = msg.role === 'user' ? '👨‍🌾' : '👤';
        let name = msg.role === 'user' ? '村官' : (currentMeeting.villagers.find(v => msg.content.includes(v.name))?.name || '参会者');
        const msgDiv = document.createElement('div');
        msgDiv.className = `meeting-message ${roleClass}`;
        msgDiv.innerHTML = `<div class="message-avatar">${avatar}</div><div class="message-bubble"><strong>${escapeHtml(name)}</strong><br>${escapeHtml(msg.content)}</div>`;
        container.appendChild(msgDiv);
      });
      container.scrollTop = container.scrollHeight;
    }
  }
}

// 发送消息
async function sendMeetingMessage(text, isAuto = false, targetVillagerId = null) {
  if (!text || meetingTyping) return;
  const input = document.getElementById('meetingInput');
  if (!isAuto && input) input.value = '';
  const activeVillagerId = targetVillagerId || currentMeeting.activeVillagerId;
  const activeVillager = currentMeeting.villagers.find(v => v.id === activeVillagerId) || currentMeeting.villagers[0];
  appendMeetingMessage('user', '村官', '👨‍🌾', text);
  meetingTyping = true;
  try {
    const res = await fetchWithAuth('/api/meeting/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: currentMeeting.sessionId, message: text, villagerId: activeVillager.id })
    });
    const data = await res.json();
    const reply = data.reply || '嗯...我再想想。';
    appendMeetingMessage('assistant', activeVillager.name, activeVillager.avatar, reply);
    if (data.satisfaction !== undefined && currentMeeting) {
      currentMeeting.satisfaction = data.satisfaction;
      updateMeetingUI();
    }
    if (data.stanceValue !== undefined && activeVillager) {
      activeVillager.stanceValue = data.stanceValue;
      activeVillager.stance = data.stanceValue >= 0.6 ? '支持' : (data.stanceValue <= 0.4 ? '反对' : '中立');
      renderMeetingVillagers();
    }
    playSound('send');
    updateTaskProgress('meeting', 1);
  } catch(err) {
    console.error(err);
    appendMeetingMessage('assistant', '系统', '⚠️', '系统繁忙，请稍后再试。');
  } finally {
    meetingTyping = false;
  }
}

// 发起投票
async function startVoting() {
  if (votingInProgress || meetingStage !== 'discussion') return;
  const currentAgenda = currentMeeting.agenda[currentAgendaIndex];
  if (!currentAgenda) return;
  votingInProgress = true;
  meetingStage = 'voting';
  votesReceived = {};
  updateMeetingUI();
  await sendSystemMessage(currentMeeting.sessionId, `🗳️ 现在开始对【${currentAgenda.name}】进行投票。请每位参会者依次投票（支持/反对/弃权）。`);
  for (let v of currentMeeting.villagers) {
    const option = await showVoteModalForVillager(v);
    if (option) {
      votesReceived[v.id] = option;
      await sendSystemMessage(currentMeeting.sessionId, `${v.name} 投票：${option}`);
      await fetchWithAuth('/api/meeting/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: currentMeeting.sessionId, villagerId: v.id, option })
      });
    }
    await delay(1000);
  }
  const support = Object.values(votesReceived).filter(v => v === '支持').length;
  const oppose = Object.values(votesReceived).filter(v => v === '反对').length;
  const total = currentMeeting.villagers.length;
  const passed = support / total >= 0.6;
  const resultMsg = passed ? `✅ 投票通过！支持率 ${support}/${total}` : `❌ 投票未通过。支持率 ${support}/${total}`;
  await sendSystemMessage(currentMeeting.sessionId, resultMsg);
  if (passed) {
    currentMeeting.agenda[currentAgendaIndex].completed = true;
    await sendSystemMessage(currentMeeting.sessionId, `📌 议程【${currentAgenda.name}】已完成。`);
    if (currentAgendaIndex + 1 < currentMeeting.agenda.length) {
      currentAgendaIndex++;
      meetingStage = 'discussion';
    } else {
      meetingStage = 'finished';
      await sendSystemMessage(currentMeeting.sessionId, '🎉 所有议程已完成！请点击“结束会议”生成纪要。');
    }
  } else {
    meetingStage = 'discussion';
    await sendSystemMessage(currentMeeting.sessionId, '💬 投票未通过，请继续讨论修改方案，然后再次投票。');
  }
  votingInProgress = false;
  updateMeetingUI();
}

function showVoteModalForVillager(villager) {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'flex';
    modal.innerHTML = `
      <div class="modal-content" style="width:300px;">
        <h3>${villager.name} 投票</h3>
        <p>请选择你的态度：</p>
        <div style="display:flex; gap:16px; justify-content:center; margin:20px 0;">
          <button class="vote-option" data-opt="支持" style="background:#4caf50; color:white; padding:8px 24px; border:none; border-radius:30px;">✅ 支持</button>
          <button class="vote-option" data-opt="反对" style="background:#f44336; color:white; padding:8px 24px; border:none; border-radius:30px;">❌ 反对</button>
          <button class="vote-option" data-opt="弃权" style="background:#9e9e9e; color:white; padding:8px 24px; border:none; border-radius:30px;">🤐 弃权</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    const handleClick = (e) => {
      const opt = e.target.dataset.opt;
      if (opt) {
        modal.remove();
        resolve(opt);
      }
    };
    modal.querySelectorAll('.vote-option').forEach(btn => btn.addEventListener('click', handleClick));
    modal.onclick = (e) => { if (e.target === modal) { modal.remove(); resolve(null); } };
  });
}

async function nextAgenda() {
  if (currentAgendaIndex + 1 >= currentMeeting.agenda.length) return;
  const current = currentMeeting.agenda[currentAgendaIndex];
  if (!current.completed) {
    alert('请先完成当前议程（投票通过）后再继续。');
    return;
  }
  currentAgendaIndex++;
  meetingStage = 'discussion';
  votingInProgress = false;
  updateMeetingUI();
  await sendSystemMessage(currentMeeting.sessionId, `📌 进入下一议程：${currentMeeting.agenda[currentAgendaIndex].name}`);
}

async function finishMeeting() {
  if (!confirm('结束会议并生成会议纪要？')) return;
  try {
    const res = await fetchWithAuth(`/api/meeting/finish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: currentMeeting.sessionId })
    });
    const data = await res.json();
    if (data.summary) {
      showMeetingResolution(data.summary);
      alert(`会议结束！最终得分：${data.finalScore} / 100`);
    } else {
      alert('会议纪要生成失败');
    }
    if (meetingPollInterval) clearInterval(meetingPollInterval);
    renderMeetingSetupView();
  } catch(e) {
    alert('结束会议失败：' + e.message);
  }
}

function showMeetingResolution(resolution) {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="modal-content" style="width:500px;">
      <button class="modal-close" style="position:absolute;right:12px;top:12px;">&times;</button>
      <h3>📄 会议决议与评分</h3>
      <div class="meeting-resolution">
        <p><strong>通过的议题：</strong>${resolution.resolutions?.join('、') || '无'}</p>
        <p><strong>争议点：</strong>${resolution.disputes?.join('、') || '无'}</p>
        <p><strong>待办事项：</strong>${resolution.actionItems?.join('；') || '无'}</p>
        <hr>
        <h4>会议纪要</h4>
        <div style="white-space:pre-wrap;">${escapeHtml(resolution.minutes || '')}</div>
        <p><strong>综合评分：</strong> ${resolution.overallScore || 0} / 100</p>
        <p><strong>改进建议：</strong> ${resolution.suggestions || '无'}</p>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('.modal-close').onclick = () => modal.remove();
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
}

// ==================== 会议设置界面 ====================
export async function renderMeetingSetupView() {
  if (meetingPollInterval) clearInterval(meetingPollInterval);

  const dynamicContent = document.getElementById('dynamicContent');
  dynamicContent.innerHTML = `
    <div class="meeting-setup" style="max-width:600px; margin:20px auto; padding:20px; background:white; border-radius:16px; box-shadow:0 2px 8px rgba(0,0,0,0.1);">
      <h3 style="margin-bottom:20px;">🏛️ 会议模式</h3>
      <div style="margin-bottom:16px;">
        <label style="display:block; margin-bottom:6px;">会议类型：</label>
        <select id="meetingTypeSelect" style="width:100%; padding:8px; border-radius:8px; border:1px solid #ccc;">
          <option value="villager">👥 村民大会</option>
          <option value="cadre">🏛️ 村干部大会</option>
        </select>
      </div>
      <div style="margin-bottom:16px;">
        <label style="display:block; margin-bottom:6px;">会议主题：</label>
        <select id="meetingTopicSelect" style="width:100%; padding:8px; border-radius:8px; border:1px solid #ccc;">
          <option value="custom">✏️ 自定义主题</option>
          ${Object.keys(presetTemplates).map(t => `<option value="${t}">${t}</option>`).join('')}
        </select>
        <input type="text" id="customTopicInput" placeholder="输入自定义主题" style="width:100%; margin-top:8px; padding:8px; border-radius:8px; border:1px solid #ccc; display:none;">
      </div>
      <div style="margin-bottom:16px;">
        <label style="display:block; margin-bottom:6px;">议程（每行一个）</label>
        <textarea id="agendaInput" rows="4" style="width:100%; padding:8px; border-radius:8px; border:1px solid #ccc;" placeholder="例如：&#10;1. 介绍议题&#10;2. 意见收集&#10;3. 方案讨论&#10;4. 投票表决"></textarea>
      </div>
      <div style="margin-bottom:16px;">
        <label style="display:block; margin-bottom:6px;">参与人员（格式：姓名:头像:性格:初始立场:核心诉求，每行一个）</label>
        <textarea id="customRolesInput" rows="4" style="width:100%; padding:8px; border-radius:8px; border:1px solid #ccc;"></textarea>
        <div style="font-size:0.8rem; color:#666; margin-top:4px;">留空则使用默认人员</div>
      </div>
      <button id="startMeetingBtn" class="submit-btn" style="width:100%;">开始会议</button>
    </div>
  `;

  const typeSelect = document.getElementById('meetingTypeSelect');
  const topicSelect = document.getElementById('meetingTopicSelect');
  const customInput = document.getElementById('customTopicInput');
  const agendaInput = document.getElementById('agendaInput');
  const rolesInput = document.getElementById('customRolesInput');

  // 当类型改变时，如果角色输入框为空，自动填充默认角色
  typeSelect.addEventListener('change', () => {
    if (!rolesInput.value.trim()) {
      const defaultRoles = defaultRolesByType[typeSelect.value];
      if (defaultRoles) {
        const rolesText = defaultRoles.map(r => `${r.name}:${r.avatar}:${r.personality}:${r.initialStance}:${r.coreDemand}`).join('\n');
        rolesInput.value = rolesText;
      }
    }
  });

  topicSelect.addEventListener('change', () => {
    const selected = topicSelect.value;
    if (selected !== 'custom' && presetTemplates[selected]) {
      const template = presetTemplates[selected];
      agendaInput.value = template.agenda.join('\n');
      if (typeSelect.value === 'cadre') {
        rolesInput.value = template.villagers.map(v => `${v.name}:${v.avatar}:${v.personality}:${v.initialStance}:${v.coreDemand}`).join('\n');
        alert('已加载村民角色，如需村干部角色请手动修改或切换会议类型后重新选择主题。');
      } else {
        rolesInput.value = template.villagers.map(v => `${v.name}:${v.avatar}:${v.personality}:${v.initialStance}:${v.coreDemand}`).join('\n');
      }
      customInput.style.display = 'none';
    } else {
      customInput.style.display = 'block';
    }
  });

  // 初始化时填充默认角色
  if (!rolesInput.value.trim()) {
    const defaultRoles = defaultRolesByType[typeSelect.value];
    if (defaultRoles) {
      const rolesText = defaultRoles.map(r => `${r.name}:${r.avatar}:${r.personality}:${r.initialStance}:${r.coreDemand}`).join('\n');
      rolesInput.value = rolesText;
    }
  }

  document.getElementById('startMeetingBtn').onclick = async () => {
    const meetingType = typeSelect.value;
    let topic = topicSelect.value;
    let isPreset = (topic !== 'custom');
    let customTopic = '';
    if (topic === 'custom') {
      customTopic = customInput.value.trim();
      if (!customTopic) { alert('请填写自定义主题'); return; }
      topic = customTopic;
    }
    let roles = [];
    const customRolesText = rolesInput.value.trim();
    if (customRolesText) {
      const lines = customRolesText.split('\n');
      for (let line of lines) {
        const parts = line.split(':');
        if (parts.length >= 2) {
          roles.push({
            name: parts[0].trim(),
            avatar: parts[1].trim() || '👤',
            personality: parts[2] ? parts[2].trim() : '普通',
            initialStance: parts[3] ? parts[3].trim() : '中立',
            coreDemand: parts[4] ? parts[4].trim() : '',
            stanceValue: parts[3] === '支持' ? 0.8 : (parts[3] === '反对' ? 0.2 : 0.5),
            id: `custom_${Date.now()}_${Math.random()}`
          });
        }
      }
    }
    if (roles.length === 0) {
      const defaultRoles = defaultRolesByType[meetingType];
      roles = defaultRoles.map(r => ({ ...r, id: `default_${Date.now()}_${Math.random()}` }));
    }
    let agendaText = agendaInput.value.trim();
    let agenda = [];
    if (agendaText) {
      agenda = agendaText.split('\n').filter(l => l.trim()).map((l, idx) => ({ name: l.replace(/^\d+\.\s*/, ''), completed: false, order: idx }));
    } else {
      agenda = [
        { name: '议题介绍', completed: false, order: 0 },
        { name: '意见收集', completed: false, order: 1 },
        { name: '方案讨论', completed: false, order: 2 },
        { name: '投票表决', completed: false, order: 3 }
      ];
    }
    await startMeeting(roles, topic, agenda, isPreset, meetingType);
  };

  setActiveNavByView('meeting');
}