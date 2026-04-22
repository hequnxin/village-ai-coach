// frontend/src/modules/meeting.js

import { fetchWithAuth } from '../utils/api';
import { appState, switchSession } from './state';
import { escapeHtml, playSound, updateTaskProgress, setupVoiceInput, setActiveNavByView, showCelebration } from '../utils/helpers';
import { startVoiceCall, stopVoiceCall, toggleMute, restartRobot } from './voice';
import { createVoiceCallUI } from './VoiceCallManager';

let currentMeeting = null;
let currentAgendaIndex = 0;
let meetingStage = 'opening';
let votingInProgress = false;
let votesReceived = {};
let currentMeetingType = 'villager';
let meetingPollInterval = null;
let roundRobinInProgress = false;
let meetingTyping = false;
let voiceModeActive = false; // 语音通话模式是否激活（仅该模式下朗读）

// ==================== 语音合成 ====================
let speechSynthesisEnabled = true;
function speakText(text, voiceName = 'Tingting') {
  if (!voiceModeActive) return; // 非语音模式不朗读
  if (!speechSynthesisEnabled) return;
  if (!window.speechSynthesis) {
    console.warn('浏览器不支持语音合成');
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'zh-CN';
  utterance.rate = 1.1; // 调快语速
  utterance.pitch = 1.0;
  const voices = window.speechSynthesis.getVoices();
  const cnVoice = voices.find(v => v.lang === 'zh-CN' && (v.name.includes('Tingting') || v.name.includes('Xiaoxiao')));
  if (cnVoice) utterance.voice = cnVoice;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

// ==================== 预设模板（每个模板都有独立的村民和村干部） ====================
const presetTemplates = {
  '人居环境整治': {
    description: '村内部分区域存在垃圾乱倒、柴草乱堆、污水横流现象，村民投诉较多。需要制定整治方案并动员大家参与。',
    agenda: ['介绍当前环境问题现状', '讨论整治措施（垃圾定点投放、柴草集中堆放）', '明确各户责任和奖惩机制', '投票表决整治方案'],
    villagers: [
      { name: '张大爷', avatar: '👴', personality: '固执、嫌麻烦', initialStance: '反对', stanceValue: 0.2, coreDemand: '不想多走路倒垃圾', id: `v_${Date.now()}_1` },
      { name: '李大妈', avatar: '👵', personality: '爱干净、支持', initialStance: '支持', stanceValue: 0.8, coreDemand: '希望村里统一规划', id: `v_${Date.now()}_2` },
      { name: '王叔', avatar: '👨', personality: '理性、观望', initialStance: '中立', stanceValue: 0.5, coreDemand: '担心费用和公平性', id: `v_${Date.now()}_3` }
    ],
    cadreVillagers: [
      { name: '村支书', avatar: '👨‍💼', personality: '稳重、有远见', initialStance: '支持', stanceValue: 0.9, coreDemand: '推动环境整治', id: `c_${Date.now()}_1` },
      { name: '村主任', avatar: '👩‍💼', personality: '务实、执行力强', initialStance: '支持', stanceValue: 0.8, coreDemand: '尽快落实措施', id: `c_${Date.now()}_2` },
      { name: '环保专干', avatar: '🌿', personality: '专业、细致', initialStance: '支持', stanceValue: 0.7, coreDemand: '确保垃圾分类科学', id: `c_${Date.now()}_3` },
      { name: '妇女主任', avatar: '👩', personality: '善于沟通', initialStance: '中立', stanceValue: 0.5, coreDemand: '关注家庭参与', id: `c_${Date.now()}_4` }
    ],
    systemOpening: '🏛️ 欢迎参加【人居环境整治】专题会议。目前村内垃圾乱倒、柴草乱堆问题突出，村民投诉较多。今天的任务是：讨论并通过一份可行的整治方案。请您作为主持人，引导大家发言。'
  },
  '土地流转协调': {
    description: '村东头50亩连片耕地，部分村民想流转给种植大户，但少数村民担心失去土地不愿意。需要协调矛盾，达成流转协议。',
    agenda: ['介绍流转方案和收益预期', '听取反对村民的顾虑', '讨论补偿和保障措施', '投票表决是否同意流转'],
    villagers: [
      { name: '赵叔', avatar: '👨‍🌾', personality: '保守、担心', initialStance: '反对', stanceValue: 0.2, coreDemand: '怕流转后没保障', id: `v_${Date.now()}_1` },
      { name: '孙婶', avatar: '👩', personality: '积极、愿意尝试', initialStance: '支持', stanceValue: 0.9, coreDemand: '想多拿租金', id: `v_${Date.now()}_2` },
      { name: '李会计', avatar: '🧑‍💼', personality: '精明、算得清', initialStance: '中立', stanceValue: 0.5, coreDemand: '要看到详细合同', id: `v_${Date.now()}_3` }
    ],
    cadreVillagers: [
      { name: '村支书', avatar: '👨‍💼', personality: '有远见', initialStance: '支持', stanceValue: 0.9, coreDemand: '促进土地规模经营', id: `c_${Date.now()}_1` },
      { name: '村主任', avatar: '👩‍💼', personality: '务实', initialStance: '支持', stanceValue: 0.8, coreDemand: '保障村民利益', id: `c_${Date.now()}_2` },
      { name: '村会计', avatar: '🧑‍💼', personality: '细心、精打细算', initialStance: '中立', stanceValue: 0.5, coreDemand: '算清账目', id: `c_${Date.now()}_3` },
      { name: '治保主任', avatar: '👮‍♂️', personality: '公正', initialStance: '中立', stanceValue: 0.5, coreDemand: '维护稳定', id: `c_${Date.now()}_4` }
    ],
    systemOpening: '🏛️ 欢迎参加【土地流转协调】会议。村东头50亩地，大部分村民同意流转，但有少数村民担心失去土地。今天我们需要听取各方意见，制定一个让大多数人满意的流转方案。请您主持。'
  },
  '产业发展规划': {
    description: '村里计划发展特色农产品加工产业，需要申请项目资金，但部分村民担心风险。',
    agenda: ['介绍产业规划草案和预期收益', '分析风险和应对措施', '讨论村民参与方式和分红机制', '投票表决是否启动项目'],
    villagers: [
      { name: '刘能人', avatar: '🧑‍🌾', personality: '胆大、敢闯', initialStance: '支持', stanceValue: 0.9, coreDemand: '想带头致富', id: `v_${Date.now()}_1` },
      { name: '陈大妈', avatar: '👩', personality: '谨慎、怕亏', initialStance: '反对', stanceValue: 0.2, coreDemand: '怕投入的钱打水漂', id: `v_${Date.now()}_2` },
      { name: '周会计', avatar: '🧑‍💼', personality: '精明、爱算账', initialStance: '中立', stanceValue: 0.5, coreDemand: '要看详细财务预测', id: `v_${Date.now()}_3` }
    ],
    cadreVillagers: [
      { name: '村支书', avatar: '👨‍💼', personality: '有远见', initialStance: '支持', stanceValue: 0.9, coreDemand: '推动产业升级', id: `c_${Date.now()}_1` },
      { name: '村主任', avatar: '👩‍💼', personality: '执行力强', initialStance: '支持', stanceValue: 0.8, coreDemand: '争取项目落地', id: `c_${Date.now()}_2` },
      { name: '团支部书记', avatar: '🧑‍🌾', personality: '年轻有干劲', initialStance: '支持', stanceValue: 0.7, coreDemand: '带动青年创业', id: `c_${Date.now()}_3` },
      { name: '村监委会主任', avatar: '👓', personality: '正直', initialStance: '中立', stanceValue: 0.5, coreDemand: '监督资金使用', id: `c_${Date.now()}_4` }
    ],
    systemOpening: '🏛️ 欢迎参加【产业发展规划】会议。村里计划发展特色农产品加工，需要大家支持。今天要讨论项目可行性、风险应对和村民参与方式。请您主持。'
  },
  '矛盾纠纷调解': {
    description: '两户村民因宅基地边界发生激烈争吵，甚至动手，需要村干部出面调解，化解矛盾。',
    agenda: ['分别听取双方陈述', '现场勘查并查阅原始资料', '提出折中解决方案', '双方签字确认和解协议'],
    villagers: [
      { name: '张老三', avatar: '👨', personality: '暴躁、不服软', initialStance: '反对', stanceValue: 0.1, coreDemand: '必须让对方赔礼道歉', id: `v_${Date.now()}_1` },
      { name: '李老二', avatar: '👨', personality: '倔强、爱面子', initialStance: '反对', stanceValue: 0.1, coreDemand: '寸土不让', id: `v_${Date.now()}_2` },
      { name: '王支书', avatar: '👨‍💼', personality: '公正、有威望', initialStance: '中立', stanceValue: 0.5, coreDemand: '希望尽快平息纠纷', id: `v_${Date.now()}_3` }
    ],
    cadreVillagers: [
      { name: '村支书', avatar: '👨‍💼', personality: '公正、有威望', initialStance: '支持', stanceValue: 0.9, coreDemand: '化解矛盾', id: `c_${Date.now()}_1` },
      { name: '治保主任', avatar: '👮‍♂️', personality: '严肃、公正', initialStance: '支持', stanceValue: 0.8, coreDemand: '维护秩序', id: `c_${Date.now()}_2` },
      { name: '德高望重老人', avatar: '👴', personality: '有威信、明事理', initialStance: '中立', stanceValue: 0.6, coreDemand: '希望和好', id: `c_${Date.now()}_3` }
    ],
    systemOpening: '🏛️ 欢迎参加【矛盾纠纷调解】会议。张老三和李老二因宅基地边界问题发生冲突，双方情绪激动。今天需要您作为调解人，依法依规、公平公正地化解矛盾。'
  },
  '惠民政策宣讲': {
    description: '村里新出台了医保补贴和养老政策，很多村民不了解、不相信，需要开会宣讲并解答疑问。',
    agenda: ['解读医保补贴新政策', '解读养老待遇调整方案', '村民提问与答疑', '收集村民反馈意见'],
    villagers: [
      { name: '孙奶奶', avatar: '👵', personality: '耳背、多疑', initialStance: '反对', stanceValue: 0.2, coreDemand: '担心政策是骗人的', id: `v_${Date.now()}_1` },
      { name: '赵大叔', avatar: '👨', personality: '精明、爱比较', initialStance: '中立', stanceValue: 0.5, coreDemand: '想知道具体能多拿多少钱', id: `v_${Date.now()}_2` },
      { name: '钱会计', avatar: '🧑‍💼', personality: '理性、懂政策', initialStance: '支持', stanceValue: 0.8, coreDemand: '希望村民都能参保', id: `v_${Date.now()}_3` }
    ],
    cadreVillagers: [
      { name: '村支书', avatar: '👨‍💼', personality: '稳重、有远见', initialStance: '支持', stanceValue: 0.9, coreDemand: '让惠民政策落地', id: `c_${Date.now()}_1` },
      { name: '村主任', avatar: '👩‍💼', personality: '务实、执行力强', initialStance: '支持', stanceValue: 0.8, coreDemand: '确保村民知晓', id: `c_${Date.now()}_2` },
      { name: '妇女主任', avatar: '👩', personality: '耐心、善于沟通', initialStance: '中立', stanceValue: 0.6, coreDemand: '解答妇女疑问', id: `c_${Date.now()}_3` },
      { name: '村会计', avatar: '🧑‍💼', personality: '细心、专业', initialStance: '支持', stanceValue: 0.7, coreDemand: '准确解释补贴标准', id: `c_${Date.now()}_4` }
    ],
    systemOpening: '🏛️ 欢迎参加【惠民政策宣讲】会议。今天主要讲解医保补贴和养老政策的新变化，请大家认真听讲，有疑问随时提出。'
  }
};

// 默认角色（当自定义输入为空时使用）
const defaultRolesByType = {
  villager: [
    { name: '张大爷', avatar: '👴', personality: '固执、爱面子', initialStance: '中立', stanceValue: 0.5, coreDemand: '', id: `v_${Date.now()}_1` },
    { name: '李大妈', avatar: '👵', personality: '热情、话多', initialStance: '中立', stanceValue: 0.5, coreDemand: '', id: `v_${Date.now()}_2` },
    { name: '王叔', avatar: '👨', personality: '理性、务实', initialStance: '中立', stanceValue: 0.5, coreDemand: '', id: `v_${Date.now()}_3` }
  ],
  cadre: [
    { name: '村支书', avatar: '👨‍💼', personality: '稳重、有远见', initialStance: '支持', stanceValue: 0.8, coreDemand: '希望决策科学民主', id: `c_${Date.now()}_1` },
    { name: '村主任', avatar: '👩‍💼', personality: '务实、执行力强', initialStance: '支持', stanceValue: 0.7, coreDemand: '希望项目尽快落地', id: `c_${Date.now()}_2` },
    { name: '妇女主任', avatar: '👩', personality: '细心、善于沟通', initialStance: '中立', stanceValue: 0.5, coreDemand: '关注妇女和家庭利益', id: `c_${Date.now()}_3` },
    { name: '民兵连长', avatar: '👮', personality: '直爽、急躁', initialStance: '中立', stanceValue: 0.5, coreDemand: '希望安全有保障', id: `c_${Date.now()}_4` }
  ]
};

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

// ==================== 辅助函数 ====================
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function getEmotionIcon(emotion) {
  const map = { happy:'😊', sad:'😭', angry:'😡', neutral:'😐', surprise:'😲', worry:'😟' };
  return map[emotion] || '😐';
}

function scrollMeetingMessages() {
  const container = document.getElementById('meetingMessages');
  if (container) container.scrollTop = container.scrollHeight;
}

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
  scrollMeetingMessages();
  // 仅语音模式下播放语音
  if (role === 'assistant' && voiceModeActive) {
    speakText(content);
  }
  if (currentMeeting) {
    const session = appState.sessions.find(s => s.id === currentMeeting.sessionId);
    if (session) {
      if (!session.messages) session.messages = [];
      session.messages.push({ role: role === 'user' ? 'user' : 'assistant', name, avatar, content, timestamp: new Date().toISOString() });
    }
  }
}

function appendSystemMessage(content) {
  const container = document.getElementById('meetingMessages');
  if (!container) return;
  const sysDiv = document.createElement('div');
  sysDiv.className = 'meeting-message system';
  sysDiv.innerHTML = `<div class="message-bubble system-bubble">📢 ${escapeHtml(content)}</div>`;
  container.appendChild(sysDiv);
  scrollMeetingMessages();
  if (currentMeeting) {
    const session = appState.sessions.find(s => s.id === currentMeeting.sessionId);
    if (session) {
      if (!session.messages) session.messages = [];
      session.messages.push({ role: 'system', content, timestamp: new Date().toISOString() });
    }
  }
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

function updateVillagerStance(villager, newValue) {
  if (!villager) return;
  villager.stanceValue = Math.max(0, Math.min(1, newValue));
  if (villager.stanceValue >= 0.65) villager.stance = '支持';
  else if (villager.stanceValue <= 0.35) villager.stance = '反对';
  else villager.stance = '中立';
  if (window.innerWidth > 768) renderMeetingVillagersDesktop();
}

function updateOverallSatisfaction(value) {
  const overall = value !== undefined ? value : 50;
  const satDiv = document.getElementById('meetingSatisfaction');
  if (satDiv) satDiv.innerHTML = `整体满意度：${overall}%`;
  const drawerSat = document.getElementById('drawerSatisfaction');
  if (drawerSat) drawerSat.innerText = `${overall}%`;
}

function updateMeetingUI() {
  if (!currentMeeting) return;
  const overall = currentMeeting.satisfaction !== undefined ? currentMeeting.satisfaction : 50;
  updateOverallSatisfaction(overall);
  const agendaContainer = document.getElementById('meetingAgenda');
  if (agendaContainer && currentMeeting.agenda) {
    agendaContainer.innerHTML = currentMeeting.agenda.map((item, idx) => `
      <div class="agenda-item ${idx === currentAgendaIndex ? 'current' : ''} ${idx < currentAgendaIndex ? 'completed' : ''}">
        ${idx+1}. ${escapeHtml(item.name)} ${item.completed ? '✅' : ''}
      </div>
    `).join('');
  }
  const voteBtn = document.getElementById('voteBtn');
  const nextAgendaBtn = document.getElementById('nextAgendaBtn');
  const finishBtn = document.getElementById('finishMeetingBtn');
  if (voteBtn) voteBtn.disabled = (meetingStage !== 'discussion') || votingInProgress;
  if (nextAgendaBtn) nextAgendaBtn.disabled = (currentAgendaIndex >= currentMeeting.agenda.length - 1) || !currentMeeting.agenda[currentAgendaIndex]?.completed;
  if (finishBtn) finishBtn.disabled = (meetingStage === 'finished');
}

function renderMeetingVillagersDesktop() {
  const container = document.getElementById('meetingVillagers');
  if (!container) return;
  container.innerHTML = '';
  currentMeeting.villagers.forEach(v => {
    const card = document.createElement('div');
    card.className = 'villager-card';
    card.dataset.id = v.id;
    const realStance = v.stance || v.initialStance;
    const stanceIcon = realStance === '支持' ? '✅' : (realStance === '反对' ? '❌' : '⚪');
    const stanceClass = `stance-${realStance === '支持' ? 'support' : (realStance === '反对' ? 'oppose' : 'neutral')}`;
    const personalSat = v.satisfaction !== undefined ? v.satisfaction : 50;
    card.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px;">
        <div class="villager-avatar" style="font-size:1.2rem;">${v.avatar}</div>
        <div style="flex:1;">
          <div class="villager-name" style="font-weight:bold; font-size:0.9rem;">${escapeHtml(v.name)}</div>
          <div class="villager-stance ${stanceClass}" style="font-size:0.8rem;">${stanceIcon} ${realStance}</div>
          <div style="background:#eee; border-radius:4px; height:4px; margin-top:4px;">
            <div style="width:${(v.stanceValue || 0.5) * 100}%; background:#4caf50; height:4px; border-radius:4px;"></div>
          </div>
          <div class="villager-satisfaction" style="font-size:0.7rem; margin-top:2px;">满意度: ${personalSat}%</div>
        </div>
      </div>
    `;
    card.onclick = async () => {
      const targetVillager = v;
      currentMeeting.activeVillagerId = targetVillager.id;
      document.querySelectorAll('.villager-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      const input = document.getElementById('meetingInput');
      if (input) input.placeholder = `向 ${targetVillager.name} 说...`;
      if (voiceCallUI) {
        await restartRobot({
          sceneType: 'meeting',
          sessionId: currentMeeting.sessionId,
          roleName: targetVillager.name
        });
        if (voiceCallUI) {
          const participants = currentMeeting.villagers.map(p => ({
            name: p.name,
            avatar: p.avatar,
            satisfaction: p.satisfaction,
            stance: p.stance || p.initialStance
          }));
          voiceCallUI.updateParticipants(participants, targetVillager.name);
        }
      } else {
        if (meetingTyping) return;
        meetingTyping = true;
        try {
          const reply = await autoVillagerSpeak(currentMeeting.sessionId, targetVillager, "请发表你的看法");
          appendMeetingMessage('assistant', targetVillager.name, targetVillager.avatar, reply);
        } catch(e) { console.error("发言失败", e); }
        finally { meetingTyping = false; }
      }
    };
    container.appendChild(card);
  });
  if (currentMeeting.villagers.length) {
    const firstCard = container.querySelector('.villager-card');
    if (firstCard) firstCard.classList.add('active');
    currentMeeting.activeVillagerId = currentMeeting.villagers[0].id;
    const input = document.getElementById('meetingInput');
    if (input) input.placeholder = `向 ${currentMeeting.villagers[0].name} 说...`;
  }
}

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
    if (data.stanceValue !== undefined) updateVillagerStance(villager, data.stanceValue);
    if (data.satisfaction !== undefined && currentMeeting) {
      currentMeeting.satisfaction = data.satisfaction;
      updateOverallSatisfaction(data.satisfaction);
    }
    if (data.villagerSatisfaction !== undefined && currentMeeting) {
      const idx = currentMeeting.villagers.findIndex(v => v.id === villager.id);
      if (idx !== -1) {
        currentMeeting.villagers[idx].satisfaction = data.villagerSatisfaction;
        if (window.innerWidth > 768) renderMeetingVillagersDesktop();
      }
    }
    return data.reply || `${villager.name}：我没什么意见。`;
  } catch(e) {
    console.error('自动发言失败', e);
    return `${villager.name}：嗯，我再想想。`;
  }
}

// 让指定角色主动发言（结合上下文）
async function speakAsVillager(villager, contextHint = '') {
  if (!currentMeeting) return;
  const container = document.getElementById('meetingMessages');
  if (!container) return;

  const recentMessages = Array.from(container.querySelectorAll('.meeting-message'))
    .slice(-5)
    .map(msg => msg.querySelector('.message-bubble')?.innerText || '')
    .filter(t => t.trim())
    .join('\n');
  const currentAgenda = currentMeeting.agenda[currentAgendaIndex]?.name || '当前议题';
  let prompt = `当前议程：${currentAgenda}。`;
  if (recentMessages) prompt += `\n最近讨论内容：${recentMessages.substring(0, 300)}`;
  if (contextHint) prompt += `\n${contextHint}`;
  else prompt += `\n请结合你的立场（${villager.initialStance}）和核心诉求（${villager.coreDemand || '无'}），主动发表你对当前议题的看法。`;

  const thinkingMsg = document.createElement('div');
  thinkingMsg.className = 'meeting-message assistant thinking-message';
  thinkingMsg.innerHTML = `<div class="message-avatar">${villager.avatar}</div><div class="message-bubble">💭 ${villager.name} 思考中...</div>`;
  container.appendChild(thinkingMsg);
  scrollMeetingMessages();

  try {
    const res = await fetchWithAuth('/api/meeting/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: currentMeeting.sessionId,
        message: prompt,
        villagerId: villager.id,
        autoSpeak: true
      })
    });
    const data = await res.json();
    thinkingMsg.remove();
    const reply = data.reply || `${villager.name}：嗯，我再想想。`;
    appendMeetingMessage('assistant', villager.name, villager.avatar, reply);
    if (data.stanceValue !== undefined) updateVillagerStance(villager, data.stanceValue);
    if (data.satisfaction !== undefined) {
      currentMeeting.satisfaction = data.satisfaction;
      updateOverallSatisfaction(data.satisfaction);
    }
  } catch (err) {
    console.error('主动发言失败', err);
    thinkingMsg.innerHTML = `<div class="message-avatar">${villager.avatar}</div><div class="message-bubble">⚠️ ${villager.name} 暂时无法发言</div>`;
    setTimeout(() => thinkingMsg.remove(), 2000);
  }
}

function showMobileTip(tipText, keepUntilManualClose = false) { console.log('提示:', tipText); }
function hideMobileTip() {}
function toggleMobileTip() { const tipText = getDynamicTip(); showMobileTip(tipText, true); }
function getDynamicTip() {
  const container = document.getElementById('meetingMessages');
  if (!container) return meetingTips[Math.floor(Math.random() * meetingTips.length)];
  const messages = container.querySelectorAll('.meeting-message');
  const lastUserMsg = Array.from(messages).reverse().find(m => m.classList.contains('user'));
  if (lastUserMsg) {
    const text = lastUserMsg.querySelector('.message-bubble')?.innerText || '';
    if (text.includes('垃圾')) return '💡 可以引用《垃圾分类管理条例》，强调政府补贴和长期效益。';
    if (text.includes('土地') || text.includes('宅基地')) return '💡 建议查阅《土地管理法》相关条款，明确权属。';
    if (text.includes('医保') || text.includes('养老')) return '💡 可以引用最新医保报销比例和养老金调整方案。';
    if (text.includes('产业') || text.includes('项目')) return '💡 强调项目可行性、收益预期和风险保障措施。';
    if (text.includes('噪音') || text.includes('纠纷')) return '💡 建议引导双方换位思考，提出折中方案。';
  }
  return meetingTips[Math.floor(Math.random() * meetingTips.length)];
}
// ==================== 核心会议函数 ====================

async function startRoundRobin(sessionId, villagers, systemOpening, meetingType, loadingMsgElement = null) {
  roundRobinInProgress = true;
  meetingStage = 'roundRobin';
  updateMeetingUI();
  await sendSystemMessage(sessionId, systemOpening);
  if (loadingMsgElement) {
    loadingMsgElement.style.display = 'block';
    scrollMeetingMessages();
  }
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
  if (loadingMsgElement) loadingMsgElement.remove();
}

async function startMeeting(roles, topic, agenda, isPreset, meetingType) {
  try {
    const res = await fetchWithAuth('/api/meeting/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, villagers: roles, agenda, meetingType })
    });
    const data = await res.json();
    const sessionId = data.sessionId;
    const session = {
      id: sessionId,
      title: topic,
      type: 'meeting',
      messages: [],
      createdAt: new Date().toISOString(),
      scenarioId: JSON.stringify({ meetingType, villagers: roles, agenda, currentAgendaIndex: 0, satisfaction: 50, isFinished: false })
    };
    appState.sessions.unshift(session);
    const { renderSessionList } = await import('./ui');
    renderSessionList();
    await switchSession(sessionId);
    currentMeeting = {
      sessionId, villagers: roles, agenda,
      currentAgendaIndex: 0, votes: {},
      satisfaction: 50, topic, stage: 'opening'
    };
    currentMeeting.villagers.forEach(v => {
      if (v.initialStance === '支持') v.satisfaction = 70;
      else if (v.initialStance === '反对') v.satisfaction = 30;
      else v.satisfaction = 50;
    });
    currentAgendaIndex = 0;
    meetingStage = 'opening';
    votingInProgress = false;
    votesReceived = {};
    currentMeetingType = meetingType;
    renderMeetingChatArea();
    startMeetingPolling(sessionId);
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'meeting-message system';
    loadingDiv.style.display = 'none';
    loadingDiv.innerHTML = `<div class="message-bubble system-bubble">⏳ 场景加载中，请稍候...</div>`;
    const container = document.getElementById('meetingMessages');
    if (container) container.appendChild(loadingDiv);
    scrollMeetingMessages();
    if (isPreset && presetTemplates[topic]) {
      let opening = presetTemplates[topic].systemOpening;
      if (meetingType === 'cadre') opening = opening.replace(/村民/g, '村干部');
      await startRoundRobin(sessionId, roles, opening, meetingType, loadingDiv);
    } else {
      const opening = meetingType === 'cadre'
        ? `🏛️ 村干部会议《${topic}》开始。请按照议程引导讨论。`
        : `🏛️ 村民大会《${topic}》开始。请按照议程引导讨论。`;
      await sendSystemMessage(sessionId, opening);
      meetingStage = 'discussion';
      updateMeetingUI();
      loadingDiv.remove();
    }
  } catch(err) {
    alert('启动会议失败：' + err.message);
  }
}

async function startMeetingPolling(sessionId) {
  if (meetingPollInterval) clearInterval(meetingPollInterval);
  meetingPollInterval = setInterval(async () => {
    try {
      const res = await fetchWithAuth(`/api/meeting/status/${sessionId}`);
      const data = await res.json();
      if (currentMeeting) {
        currentMeeting.agenda = data.agenda;
        if (data.satisfaction !== undefined) {
          currentMeeting.satisfaction = data.satisfaction;
          updateOverallSatisfaction(data.satisfaction);
        }
        currentMeeting.emotions = data.emotions;
        currentAgendaIndex = data.currentAgendaIndex !== undefined ? data.currentAgendaIndex : currentAgendaIndex;
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
    if (data.stanceValue !== undefined) updateVillagerStance(activeVillager, data.stanceValue);
    if (data.satisfaction !== undefined) {
      currentMeeting.satisfaction = data.satisfaction;
      updateOverallSatisfaction(data.satisfaction);
    }
    if (data.villagerSatisfaction !== undefined) {
      const idx = currentMeeting.villagers.findIndex(v => v.id === activeVillager.id);
      if (idx !== -1) {
        currentMeeting.villagers[idx].satisfaction = data.villagerSatisfaction;
        if (window.innerWidth > 768) renderMeetingVillagersDesktop();
      }
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

async function startVoting() {
  if (votingInProgress || meetingStage !== 'discussion') return;
  const currentAgenda = currentMeeting.agenda[currentAgendaIndex];
  if (!currentAgenda) return;
  votingInProgress = true;
  meetingStage = 'voting';
  votesReceived = {};
  updateMeetingUI();
  await sendSystemMessage(currentMeeting.sessionId, `🗳️ 现在开始对【${currentAgenda.name}】进行投票。AI村民正在根据各自立场和满意度自动投票...`);
  for (let v of currentMeeting.villagers) {
    let option = '弃权';
    const satisfaction = v.satisfaction !== undefined ? v.satisfaction : 50;
    const stance = v.stance || v.initialStance;
    if (stance === '支持') {
      option = '支持';
    } else if (stance === '反对') {
      option = '反对';
    } else {
      if (satisfaction >= 70) option = '支持';
      else if (satisfaction <= 30) option = '反对';
      else option = Math.random() > 0.5 ? '支持' : '反对';
    }
    votesReceived[v.id] = option;
    await sendSystemMessage(currentMeeting.sessionId, `${v.name} 投票：${option}`);
    await fetchWithAuth('/api/meeting/vote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: currentMeeting.sessionId, villagerId: v.id, option })
    });
    await delay(500);
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
      await sendSystemMessage(currentMeeting.sessionId, '🎉 所有议程已完成！请点击"结束会议"生成纪要。');
    }
  } else {
    meetingStage = 'discussion';
    await sendSystemMessage(currentMeeting.sessionId, '💬 投票未通过，请继续讨论修改方案，然后再次投票。');
  }
  votingInProgress = false;
  updateMeetingUI();
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
    const session = appState.sessions.find(s => s.id === currentMeeting.sessionId);
    if (session && data.summary) {
      session.minutes = data.summary;
      session.isFinished = true;
      session.scenarioId = JSON.stringify({ ...JSON.parse(session.scenarioId || '{}'), isFinished: true, finalScore: data.finalScore || 0 });
    }
    if (data.summary) {
      showMeetingResolution(data.summary);
      alert(`会议结束！最终得分：${data.finalScore || 0} / 100`);
      if (data.finalScore >= 80) showCelebration(window.innerWidth/2, window.innerHeight/2);
      window.refreshGrowthChart?.();
    } else {
      alert('会议纪要生成失败');
    }
    if (meetingPollInterval) clearInterval(meetingPollInterval);
    renderMeetingSetupView();
  } catch(e) {
    alert('结束会议失败：' + e.message);
  }
}

function exportMeetingMinutes() {
  const session = appState.sessions.find(s => s.id === currentMeeting.sessionId);
  if (!session || !session.minutes) {
    alert('暂无会议纪要可导出，请先结束会议');
    return;
  }
  const m = session.minutes;
  const content = `
【会议纪要】${session.title}
时间：${new Date().toLocaleString()}
综合评分：${m.overallScore || 0} / 100
通过议题：${(m.resolutions || []).join('、') || '无'}
争议点：${(m.disputes || []).join('、') || '无'}
待办事项：${(m.actionItems || []).join('；') || '无'}
会议详情：
${m.minutes || ''}
改进建议：${m.suggestions || '无'}
  `.trim();
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `会议纪要_${session.title}_${new Date().getTime()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

function showMeetingResolution(resolution) {
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); display:flex; align-items:center; justify-content:center; z-index:9999;';
  modal.innerHTML = `
    <div style="background:white; width:95%; max-width:500px; padding:20px; border-radius:16px; position:relative; max-height:80vh; overflow-y:auto;">
      <button class="modal-close" style="position:absolute; right:12px; top:12px; background:none; border:none; font-size:1.2rem; cursor:pointer;">&times;</button>
      <h3 style="margin-top:0;">📄 会议决议与评分</h3>
      <div style="line-height:1.6;">
        <p><strong>通过的议题：</strong>${resolution.resolutions?.join('、') || '无'}</p>
        <p><strong>争议点：</strong>${resolution.disputes?.join('、') || '无'}</p>
        <p><strong>待办事项：</strong>${resolution.actionItems?.join('；') || '无'}</p>
        <hr>
        <h4>会议纪要</h4>
        <div style="white-space:pre-wrap; font-size:0.9rem;">${escapeHtml(resolution.minutes || '')}</div>
        <p><strong>综合评分：</strong> ${resolution.overallScore || 0} / 100</p>
        <p><strong>改进建议：</strong> ${resolution.suggestions || '无'}</p>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('.modal-close').onclick = () => modal.remove();
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
}

// ==================== 会议聊天界面渲染 ====================
export async function renderMeetingChat(session) {
  if (meetingPollInterval) clearInterval(meetingPollInterval);
  let extra = {};
  if (session.scenarioId) {
    try { extra = JSON.parse(session.scenarioId); } catch(e) {}
  }
  const topic = session.title || '会议';
  const villagers = extra.villagers || [];
  const agenda = extra.agenda || [];
  currentAgendaIndex = extra.currentAgendaIndex || 0;
  const votes = extra.votes || {};
  const satisfaction = extra.satisfaction !== undefined ? extra.satisfaction : 50;
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
  currentMeeting.villagers.forEach(v => {
    if (v.satisfaction === undefined) {
      if (v.initialStance === '支持') v.satisfaction = 70;
      else if (v.initialStance === '反对') v.satisfaction = 30;
      else v.satisfaction = 50;
    }
  });
  meetingStage = 'discussion';
  currentMeetingType = extra.meetingType || 'villager';
  renderMeetingChatArea();
  startMeetingPolling(session.id);
}

function renderMeetingChatArea() {
  if (!currentMeeting) return;
  const isMobile = window.innerWidth <= 768;
  const dynamicContent = document.getElementById('dynamicContent');
  const overallSat = currentMeeting.satisfaction !== undefined ? currentMeeting.satisfaction : 50;
  if (isMobile) {
    dynamicContent.innerHTML = `
      <div class="meeting-layout-mobile" style="display:flex; flex-direction:column; height:100%; background:#f5f7fa;">
        <div class="meeting-header-mobile" style="background:white; padding:8px 12px; border-bottom:1px solid #eee; display:flex; justify-content:space-between; align-items:center;">
          <button id="backToListBtn" class="summary-btn" style="background:#f0f0f0; padding:4px 8px; font-size:12px;">← 返回</button>
          <div style="font-size:14px; font-weight:bold; text-align:center; flex:1;">${escapeHtml(currentMeeting.topic)}</div>
          <button id="infoDrawerBtn" class="summary-btn" style="background:#2e5d34; color:white; padding:4px 8px; font-size:12px;">📋 会议信息</button>
          <button id="voiceCallBtn" class="summary-btn" style="background:#2196f3; color:white; padding:4px 8px; font-size:12px;">🎤</button>
        </div>
        <div class="meeting-chat-area" style="flex:1; display:flex; flex-direction:column; overflow:hidden;">
          <div id="meetingMessages" class="meeting-messages" style="flex:1; overflow-y:auto; padding:12px;"></div>
          <div class="meeting-input-area" style="border-top:1px solid #eee; padding:8px; background:white;">
            <div style="display:flex; gap:6px; align-items:center;">
              <textarea id="meetingInput" placeholder="向 ${currentMeeting.activeVillagerId ? currentMeeting.villagers.find(v => v.id === currentMeeting.activeVillagerId)?.name : '与会人员'} 说..." rows="1" style="flex:1; padding:6px 10px; border-radius:20px; border:1px solid #ccc; resize:none; font-family:inherit; font-size:13px; min-height:32px;"></textarea>
              <button id="sendMeetingBtn" style="background:#2e5d34; color:white; border:none; border-radius:20px; padding:0 14px; font-size:13px;">发送</button>
              <button id="meetingVoiceBtn" style="background:#f0f0f0; border:none; border-radius:20px; width:36px; font-size:16px;">🎤</button>
            </div>
          </div>
        </div>
      </div>
      <div id="infoDrawer" class="bottom-drawer" style="display:none;">
        <div class="drawer-header">
          <span>📋 会议信息</span>
          <button class="drawer-close" id="closeDrawerBtn">&times;</button>
        </div>
        <div class="drawer-content" style="padding:12px;">
          <div style="margin-bottom:16px;">
            <h4 style="margin:0 0 8px;">整体满意度: <span id="drawerSatisfaction">${overallSat}%</span></h4>
          </div>
          <div style="margin-bottom:16px;">
            <h4 style="margin:0 0 8px;">📋 议程</h4>
            <div id="drawerAgenda"></div>
            <button id="voteBtnDrawer" class="action-btn" style="width:100%; margin-top:8px; background:#4caf50;">🗳️ 发起投票</button>
            <button id="nextAgendaBtnDrawer" class="action-btn" style="width:100%; margin-top:8px; background:#ff9800;">⏩ 下一议程</button>
          </div>
          <div>
            <h4 style="margin:0 0 8px;">👥 参会人员</h4>
            <div id="drawerVillagers"></div>
          </div>
          <button id="finishMeetingBtnDrawer" class="action-btn" style="width:100%; margin-top:16px; background:#4caf50;">结束会议并生成纪要</button>
          <button id="exportMinutesBtnDrawer" class="action-btn" style="width:100%; margin-top:8px; background:#2196f3;">💾 导出会议纪要</button>
          <button id="exitMeetingBtnDrawer" class="action-btn" style="width:100%; margin-top:8px; background:#f44336;">退出会议</button>
        </div>
      </div>
    `;
  } else {
    dynamicContent.innerHTML = `
      <div class="meeting-layout" style="display:flex; height:100%; gap:16px; padding:16px; background:#f5f7fa;">
        <div class="meeting-sidebar" style="width:280px; background:white; border-radius:16px; padding:16px; display:flex; flex-direction:column; gap:20px; overflow-y:auto; box-shadow:0 1px 3px rgba(0,0,0,0.1);">
          <div>
            <h3 style="margin:0 0 8px; font-size:1rem;">🏛️ ${escapeHtml(currentMeeting.topic)}</h3>
            <div id="meetingSatisfaction" style="font-size:0.85rem; color:#2e5d34;">整体满意度：${overallSat}%</div>
          </div>
          <div>
            <h4 style="margin:0 0 8px; font-size:0.9rem;">📋 议程</h4>
            <div id="meetingAgenda"></div>
            <button id="voteBtn" style="width:100%; margin-top:8px; padding:8px; background:#4caf50; color:white; border:none; border-radius:8px;">🗳️ 发起投票</button>
            <button id="nextAgendaBtn" style="width:100%; margin-top:8px; padding:8px; background:#ff9800; color:white; border:none; border-radius:8px;">⏩ 下一议程</button>
          </div>
          <div>
            <h4 style="margin:0 0 8px; font-size:0.9rem;">👥 参会人员</h4>
            <div id="meetingVillagers" style="display:flex; flex-direction:column; gap:8px;"></div>
          </div>
          <button id="finishMeetingBtn" style="padding:10px; background:#4caf50; color:white; border:none; border-radius:8px; font-weight:bold;">结束会议并生成纪要</button>
          <button id="exportMinutesBtn" style="padding:10px; background:#2196f3; color:white; border:none; border-radius:8px; font-weight:bold;">💾 导出会议纪要</button>
          <button id="exitMeetingBtn" style="padding:10px; background:#f44336; color:white; border:none; border-radius:8px;">退出会议</button>
          <button id="voiceCallBtn" style="padding:10px; background:#2196f3; color:white; border:none; border-radius:8px;">🎤 线上会议</button>
        </div>
        <div class="meeting-chat-area" style="flex:1; background:white; border-radius:16px; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,0.1);">
          <div id="meetingMessages" class="meeting-messages" style="flex:1; overflow-y:auto; padding:16px;"></div>
          <div class="meeting-input-area" style="border-top:1px solid #eee; padding:12px;">
            <div style="display:flex; gap:8px; align-items:center;">
              <textarea id="meetingInput" placeholder="向 ${currentMeeting.activeVillagerId ? currentMeeting.villagers.find(v => v.id === currentMeeting.activeVillagerId)?.name : '与会人员'} 说..." rows="1" style="flex:1; padding:10px; border-radius:20px; border:1px solid #ccc; resize:vertical; outline:none; min-height:40px;"></textarea>
              <button id="sendMeetingBtn" style="background:#2e5d34; color:white; border:none; border-radius:20px; padding:0 18px; height:40px;">发送</button>
              <button id="meetingVoiceBtn" style="background:#f0f0f0; border:none; border-radius:20px; width:40px; height:40px; font-size:18px;">🎤</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // 绑定基础事件
  const backBtn = document.getElementById('backToListBtn');
  if (backBtn) backBtn.onclick = () => { if (meetingPollInterval) clearInterval(meetingPollInterval); renderMeetingSetupView(); };
  const exitBtn = document.getElementById('exitMeetingBtn');
  if (exitBtn) exitBtn.onclick = () => { if (meetingPollInterval) clearInterval(meetingPollInterval); renderMeetingSetupView(); };
  const sendBtn = document.getElementById('sendMeetingBtn');
  const input = document.getElementById('meetingInput');
  const voiceBtn = document.getElementById('meetingVoiceBtn');
  if (sendBtn) sendBtn.onclick = () => sendMeetingMessage(input.value.trim(), false);
  if (input) input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey && !meetingTyping) { e.preventDefault(); sendMeetingMessage(input.value.trim(), false); } };
  if (voiceBtn) setupVoiceInput(input, voiceBtn);
  const voteBtn = document.getElementById('voteBtn');
  const nextAgendaBtn = document.getElementById('nextAgendaBtn');
  const finishBtn = document.getElementById('finishMeetingBtn');
  const exportBtn = document.getElementById('exportMinutesBtn');
  if (voteBtn) voteBtn.onclick = startVoting;
  if (nextAgendaBtn) nextAgendaBtn.onclick = nextAgenda;
  if (finishBtn) finishBtn.onclick = finishMeeting;
  if (exportBtn) exportBtn.onclick = exportMeetingMinutes;

  // 移动端抽屉事件
  const infoBtn = document.getElementById('infoDrawerBtn');
  const drawer = document.getElementById('infoDrawer');
  if (infoBtn && drawer) {
    infoBtn.onclick = () => {
      document.getElementById('drawerSatisfaction').innerText = `${currentMeeting.satisfaction !== undefined ? currentMeeting.satisfaction : 50}%`;
      const agendaContainer = document.getElementById('drawerAgenda');
      if (agendaContainer) agendaContainer.innerHTML = currentMeeting.agenda.map((item, idx) => `
        <div style="padding:4px 0; ${idx === currentAgendaIndex ? 'font-weight:bold; color:#2e5d34;' : ''}">
          ${idx+1}. ${escapeHtml(item.name)} ${item.completed ? '✅' : ''}
        </div>
      `).join('');
      const villagersContainer = document.getElementById('drawerVillagers');
      if (villagersContainer) villagersContainer.innerHTML = currentMeeting.villagers.map(v => `
        <div class="drawer-villager-item" data-name="${v.name}" style="display:flex; align-items:center; gap:8px; padding:6px 0; border-bottom:1px solid #eee;">
          <div style="font-size:24px;">${v.avatar}</div>
          <div style="flex:1;">
            <div style="font-weight:bold;">${escapeHtml(v.name)}</div>
            <div style="font-size:11px; color:#666;">${v.stance || v.initialStance} · 满意度: ${v.satisfaction !== undefined ? v.satisfaction : 50}%</div>
          </div>
          <div>${getEmotionIcon(v.emotion)}</div>
        </div>
      `).join('');
      document.querySelectorAll('#drawerVillagers .drawer-villager-item').forEach(item => {
        item.onclick = () => {
          const name = item.dataset.name;
          const newTarget = currentMeeting.villagers.find(v => v.name === name);
          if (newTarget) {
            currentMeeting.activeVillagerId = newTarget.id;
            drawer.style.display = 'none';
            if (input) input.placeholder = `向 ${newTarget.name} 说...`;
            if (voiceCallUI) {
              restartRobot({
                sceneType: 'meeting',
                sessionId: currentMeeting.sessionId,
                roleName: name
              }).then(success => {
                if (success && voiceCallUI) {
                  voiceCallUI.updateParticipants(currentMeeting.villagers.map(v => ({
                    name: v.name,
                    avatar: v.avatar,
                    satisfaction: v.satisfaction,
                    stance: v.stance || v.initialStance
                  })), name);
                  speakAsVillager(newTarget, `你刚刚被选为新发言人，请针对当前议题发表你的看法。`);
                }
              });
            } else {
              speakAsVillager(newTarget, `你刚刚被选为新发言人，请针对当前议题发表你的看法。`);
            }
          }
        };
      });
      const voteBtnDrawer = document.getElementById('voteBtnDrawer');
      const nextAgendaDrawer = document.getElementById('nextAgendaBtnDrawer');
      const finishBtnDrawer = document.getElementById('finishMeetingBtnDrawer');
      const exportBtnDrawer = document.getElementById('exportMinutesBtnDrawer');
      const exitBtnDrawer = document.getElementById('exitMeetingBtnDrawer');
      if (voteBtnDrawer) voteBtnDrawer.onclick = () => { drawer.style.display = 'none'; startVoting(); };
      if (nextAgendaDrawer) nextAgendaDrawer.onclick = () => { drawer.style.display = 'none'; nextAgenda(); };
      if (finishBtnDrawer) finishBtnDrawer.onclick = () => { drawer.style.display = 'none'; finishMeeting(); };
      if (exportBtnDrawer) exportBtnDrawer.onclick = () => { drawer.style.display = 'none'; exportMeetingMinutes(); };
      if (exitBtnDrawer) exitBtnDrawer.onclick = () => { drawer.style.display = 'none'; if (meetingPollInterval) clearInterval(meetingPollInterval); renderMeetingSetupView(); };
      drawer.style.display = 'flex';
    };
    document.getElementById('closeDrawerBtn').onclick = () => drawer.style.display = 'none';
    drawer.addEventListener('click', (e) => { if (e.target === drawer) drawer.style.display = 'none'; });
  }

  // 线上会议按钮 - 使用 PTT 模式，控制 voiceModeActive
  let voiceCallUI = null;
  const voiceCallBtn = document.getElementById('voiceCallBtn');
  if (voiceCallBtn) {
    voiceCallBtn.onclick = async () => {
      if (voiceCallUI) {
        await stopVoiceCall();
        voiceCallUI.hide();
        voiceCallUI = null;
        voiceModeActive = false; // 关闭语音模式
        voiceCallBtn.textContent = isMobile ? '🎤' : '🎤 线上会议';
        voiceCallBtn.style.background = '#2196f3';
        if (window.appendUserMessageToChat) delete window.appendUserMessageToChat;
      } else {
        voiceModeActive = true; // 开启语音模式
        const participants = currentMeeting.villagers.map(v => ({
          name: v.name,
          avatar: v.avatar,
          satisfaction: v.satisfaction,
          stance: v.stance || v.initialStance
        }));
        const currentSpeaker = currentMeeting.activeVillagerId
          ? currentMeeting.villagers.find(v => v.id === currentMeeting.activeVillagerId)?.name
          : participants[0]?.name;
        window.appendUserMessageToChat = (text) => {
          const container = document.getElementById('meetingMessages');
          if (container) {
            const userMsg = document.createElement('div');
            userMsg.className = 'meeting-message user';
            userMsg.innerHTML = `<div class="message-avatar">👨‍🌾</div><div class="message-bubble"><strong>村官</strong><br>${escapeHtml(text)}</div>`;
            container.appendChild(userMsg);
            scrollMeetingMessages();
          }
        };
        voiceCallUI = createVoiceCallUI('meeting', {
          participants,
          currentSpeakerName: currentSpeaker,
          agenda: currentMeeting.agenda,
          currentAgendaIndex,
          userName: '村官',
          userAvatar: '👨‍🌾',
          onHangup: async () => {
            await stopVoiceCall();
            voiceCallUI.hide();
            voiceCallUI = null;
            voiceModeActive = false; // 关闭语音模式
            voiceCallBtn.textContent = isMobile ? '🎤' : '🎤 线上会议';
            voiceCallBtn.style.background = '#2196f3';
            if (window.appendUserMessageToChat) delete window.appendUserMessageToChat;
          },
          onMuteToggle: async (muted) => {
            await toggleMute(muted);
          },
          onParticipantSelect: async (newSpeakerName) => {
            if (!voiceCallUI) return;
            const success = await restartRobot({
              sceneType: 'meeting',
              sessionId: currentMeeting.sessionId,
              roleName: newSpeakerName
            });
            if (success) {
              voiceCallUI.updateParticipants(participants, newSpeakerName);
              const newTarget = currentMeeting.villagers.find(v => v.name === newSpeakerName);
              if (newTarget) {
                currentMeeting.activeVillagerId = newTarget.id;
                if (input) input.placeholder = `向 ${newTarget.name} 说...`;
                await speakAsVillager(newTarget, `你刚刚被选为新发言人，请针对当前议题发表你的看法。`);
              }
            } else {
              alert('切换发言人失败，请重试');
            }
          },
          onVote: () => startVoting(),
          onNextAgenda: () => nextAgenda()
        });
        voiceCallUI.show();
        voiceCallUI.updateStatus('connecting');
        const roomId = Math.abs(currentMeeting.sessionId.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0)) % 1000000;
        const success = await startVoiceCall({
          roomId,
          sceneType: 'meeting',
          sessionId: currentMeeting.sessionId,
          roleName: currentSpeaker,
          onRemoteAudioReady: () => voiceCallUI.updateStatus('ai_speaking'),
          onVolumeChange: (vol) => voiceCallUI.updateVolume(vol),
          onStatusChange: (status) => voiceCallUI.updateStatus(status)
        });
        if (success) {
          voiceCallBtn.textContent = isMobile ? '🔴' : '🔴 挂断';
          voiceCallBtn.style.background = '#f44336';
        } else {
          voiceCallUI.hide();
          voiceCallUI = null;
          voiceModeActive = false; // 启动失败也关闭语音模式
          alert('无法启动线上会议');
          if (window.appendUserMessageToChat) delete window.appendUserMessageToChat;
        }
      }
    };
  }

  renderMeetingVillagersDesktop();
  updateMeetingUI();

  // 加载历史消息
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
        } else {
          const roleClass = msg.role === 'user' ? 'user' : 'assistant';
          const avatar = msg.avatar || (msg.role === 'user' ? '👨‍🌾' : '👤');
          const name = msg.name || (msg.role === 'user' ? '村官' : '参会者');
          const msgDiv = document.createElement('div');
          msgDiv.className = `meeting-message ${roleClass}`;
          msgDiv.innerHTML = `<div class="message-avatar">${avatar}</div><div class="message-bubble"><strong>${escapeHtml(name)}</strong><br>${escapeHtml(msg.content)}</div>`;
          container.appendChild(msgDiv);
        }
      });
      scrollMeetingMessages();
    }
  }
  setActiveNavByView('meeting');
}

// ==================== 会议设置界面渲染 ====================
export async function renderMeetingSetupView() {
  if (meetingPollInterval) clearInterval(meetingPollInterval);
  const dynamicContent = document.getElementById('dynamicContent');
  dynamicContent.innerHTML = `
    <div class="meeting-setup" style="max-width:600px; margin:20px auto; padding:20px; background:white; border-radius:16px; box-shadow:0 2px 8px rgba(0,0,0,0.1);">
      <h3 style="margin-bottom:20px;">🏛️ 会议模式</h3>
      <div style="margin-bottom:16px;">
        <label style="display:block; margin-bottom:6px;">会议类型：</label>
        <select id="meetingTypeSelect" style="width:100%; padding:10px; border-radius:8px; border:1px solid #ccc; font-size:1rem;">
          <option value="villager">👥 村民大会</option>
          <option value="cadre">🏛️ 村干部大会</option>
        </select>
      </div>
      <div style="margin-bottom:16px;">
        <label style="display:block; margin-bottom:6px;">会议主题：</label>
        <select id="meetingTopicSelect" style="width:100%; padding:10px; border-radius:8px; border:1px solid #ccc; font-size:1rem;">
          <option value="custom" selected>✏️ 自定义主题</option>
          ${Object.keys(presetTemplates).map(t => `<option value="${t}">${t}</option>`).join('')}
        </select>
        <input type="text" id="customTopicInput" placeholder="输入自定义主题" style="width:100%; margin-top:8px; padding:10px; border-radius:8px; border:1px solid #ccc; font-size:1rem;">
      </div>
      <div style="margin-bottom:16px;">
        <label style="display:block; margin-bottom:6px;">议程（每行一个）</label>
        <textarea id="agendaInput" rows="4" style="width:100%; padding:10px; border-radius:8px; border:1px solid #ccc; font-size:1rem;" placeholder="例如：&#10;1. 介绍议题&#10;2. 意见收集&#10;3. 方案讨论&#10;4. 投票表决"></textarea>
      </div>
      <div style="margin-bottom:16px;">
        <label style="display:block; margin-bottom:6px;">参与人员（格式：姓名:头像:性格:初始立场:核心诉求，每行一个）</label>
        <textarea id="customRolesInput" rows="4" style="width:100%; padding:10px; border-radius:8px; border:1px solid #ccc; font-size:1rem;"></textarea>
        <div style="font-size:0.8rem; color:#666; margin-top:4px;">留空则使用默认人员</div>
      </div>
      <button id="startMeetingBtn" style="width:100%; padding:12px; background:#2e5d34; color:white; border:none; border-radius:8px; font-size:1rem; font-weight:bold;">开始会议</button>
    </div>
  `;

  const typeSelect = document.getElementById('meetingTypeSelect');
  const topicSelect = document.getElementById('meetingTopicSelect');
  const customInput = document.getElementById('customTopicInput');
  const agendaInput = document.getElementById('agendaInput');
  const rolesInput = document.getElementById('customRolesInput');

  const updateCustomInputVisibility = () => {
    customInput.style.display = topicSelect.value === 'custom' ? 'block' : 'none';
  };

  typeSelect.addEventListener('change', () => {
    if (topicSelect.value !== 'custom') {
      topicSelect.dispatchEvent(new Event('change'));
    }
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
    agendaInput.value = '';
    rolesInput.value = '';
    if (selected !== 'custom' && presetTemplates[selected]) {
      const template = presetTemplates[selected];
      agendaInput.value = template.agenda.join('\n');
      const meetingType = document.getElementById('meetingTypeSelect').value;
      let villagers = template.villagers;
      if (meetingType === 'cadre') {
        villagers = template.cadreVillagers || template.villagers;
      }
      rolesInput.value = villagers.map(v =>
        `${v.name}:${v.avatar}:${v.personality}:${v.initialStance}:${v.coreDemand}`
      ).join('\n');
    }
    updateCustomInputVisibility();
  });

  if (!rolesInput.value.trim()) {
    const defaultRoles = defaultRolesByType[typeSelect.value];
    if (defaultRoles) {
      const rolesText = defaultRoles.map(r => `${r.name}:${r.avatar}:${r.personality}:${r.initialStance}:${r.coreDemand}`).join('\n');
      rolesInput.value = rolesText;
    }
  }
  updateCustomInputVisibility();

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