import { fetchWithAuth } from '../utils/api';
import { appState, createNewSession } from './state';
import { escapeHtml, playSound, updateTaskProgress } from '../utils/helpers';

let currentMeeting = null;
let meetingTyping = false;

export async function renderMeetingSetupView() {
  const meetingTypes = [
    { value: 'villager', label: '村民大会', roles: [
      { name: '张大爷', avatar: '👴', personality: '固执、爱面子' },
      { name: '李大妈', avatar: '👵', personality: '热情、话多' },
      { name: '王叔', avatar: '👨', personality: '务实、理性' },
      { name: '赵婶', avatar: '👩', personality: '敏感、爱抱怨' }
    ] },
    { value: 'cadre', label: '村干部大会', roles: [
      { name: '村支书', avatar: '👨‍💼', personality: '稳重、有远见' },
      { name: '村主任', avatar: '👩‍💼', personality: '务实、执行力强' },
      { name: '妇女主任', avatar: '👩', personality: '细心、善于沟通' },
      { name: '民兵连长', avatar: '👮', personality: '直爽、急躁' }
    ] }
  ];
  const commonTopics = ['人居环境整治', '土地流转协调', '产业发展规划', '矛盾纠纷调解', '惠民政策宣传'];
  const dynamicContent = document.getElementById('dynamicContent');
  dynamicContent.innerHTML = `
    <div class="meeting-setup" style="padding:20px; max-width:600px; margin:0 auto;">
      <h3>🏛️ 会议模式</h3>
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
        <label style="display:block; margin-bottom:6px;">参与人员（用逗号分隔，格式：名字:头像:性格）</label>
        <textarea id="customRolesInput" rows="3" style="width:100%; padding:8px; border-radius:8px; border:1px solid #ccc;" placeholder="例如：&#10;张大爷:👴:固执、爱面子&#10;李大妈:👵:热情、话多"></textarea>
        <div style="font-size:0.8rem; color:#666; margin-top:4px;">留空则使用默认人员。格式：姓名:头像(emoji):性格描述，每行一个</div>
      </div>
      <button id="startMeetingBtn" class="submit-btn" style="width:100%;">开始会议</button>
    </div>
  `;
  const typeSelect = document.getElementById('meetingTypeSelect');
  const topicSelect = document.getElementById('meetingTopicSelect');
  const customInput = document.getElementById('customTopicInput');
  const customRolesInput = document.getElementById('customRolesInput');
  topicSelect.addEventListener('change', () => {
    customInput.style.display = topicSelect.value === 'custom' ? 'block' : 'none';
  });
  document.getElementById('startMeetingBtn').onclick = async () => {
    const meetingType = typeSelect.value;
    const topic = topicSelect.value === 'custom' ? customInput.value.trim() : topicSelect.value;
    if (!topic) { alert('请填写会议主题'); return; }
    let roles = [];
    const customRolesText = customRolesInput.value.trim();
    if (customRolesText) {
      const lines = customRolesText.split('\n');
      for (let line of lines) {
        const parts = line.split(':');
        if (parts.length >= 2) {
          roles.push({
            name: parts[0].trim(),
            avatar: parts[1].trim() || '👤',
            personality: parts[2] ? parts[2].trim() : '普通'
          });
        }
      }
    }
    if (roles.length === 0) {
      const defaultTypes = { villager: meetingTypes[0].roles, cadre: meetingTypes[1].roles };
      roles = defaultTypes[meetingType] || meetingTypes[0].roles;
    }
    await startMeeting(roles, topic);
  };
}

async function startMeeting(roles, topic) {
  // 创建会议会话
  const session = await createNewSession(topic);
  const sessionId = session.id;
  // 存储会议参与者信息到本地（也可以后端存储，这里简单实现）
  currentMeeting = {
    sessionId: sessionId,
    villagers: roles.map((r, idx) => ({ ...r, emotion: 'neutral', id: idx.toString() })),
    activeVillagerId: '0',
    messages: [],
    topic: topic
  };
  renderMeetingChatArea();
}

function renderMeetingChatArea() {
  if (!currentMeeting) return;
  const dynamicContent = document.getElementById('dynamicContent');
  dynamicContent.innerHTML = `
    <div class="meeting-view">
      <div class="meeting-header">
        <h2>🏛️ ${escapeHtml(currentMeeting.topic)}</h2>
        <p>参会人数：${currentMeeting.villagers.length} 人</p>
        <button id="exitMeetingBtn" class="summary-btn">退出会议</button>
      </div>
      <div class="meeting-villagers" id="meetingVillagers"></div>
      <div class="meeting-chat-area">
        <div class="meeting-messages" id="meetingMessages"></div>
        <div class="meeting-input-area">
          <textarea id="meetingInput" placeholder="向与会人员发言..." rows="2"></textarea>
          <button id="sendMeetingBtn">发送</button>
        </div>
      </div>
    </div>
  `;
  renderMeetingVillagers();
  const meetingInput = document.getElementById('meetingInput');
  const sendBtn = document.getElementById('sendMeetingBtn');
  const exitBtn = document.getElementById('exitMeetingBtn');
  sendBtn.onclick = () => sendMeetingMessage();
  meetingInput.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !meetingTyping) { e.preventDefault(); sendMeetingMessage(); } };
  exitBtn.onclick = () => renderMeetingSetupView();
}

function renderMeetingVillagers() {
  const container = document.getElementById('meetingVillagers');
  if (!container) return;
  container.innerHTML = '';
  currentMeeting.villagers.forEach(v => {
    const card = document.createElement('div');
    card.className = `villager-card ${currentMeeting.activeVillagerId === v.id ? 'active' : ''}`;
    card.dataset.id = v.id;
    card.innerHTML = `
      <div class="villager-avatar">${v.avatar}</div>
      <div class="villager-name">${v.name}</div>
      <div class="villager-emotion">${getEmotionIcon(v.emotion)}</div>
    `;
    card.onclick = () => {
      currentMeeting.activeVillagerId = v.id;
      renderMeetingVillagers();
    };
    container.appendChild(card);
  });
}

function getEmotionIcon(emotion) {
  const map = { happy:'😊', sad:'😭', angry:'😡', neutral:'😐', surprise:'😲', worry:'😟' };
  return map[emotion] || '😐';
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
    const newEmotion = analyzeEmotion(reply);
    activeVillager.emotion = newEmotion;
    renderMeetingVillagers();
    const replyDiv = document.createElement('div');
    replyDiv.className = 'meeting-message assistant';
    replyDiv.innerHTML = `<div class="message-avatar">${activeVillager.avatar}</div><div class="message-bubble">${escapeHtml(reply)}</div>`;
    messagesContainer.appendChild(replyDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    playSound('send');
    if (newEmotion !== 'neutral') playSound('emotion');
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

export function renderMeetingChat(session) {
  // 如果已有会议会话，恢复会议状态（需要后端存储会议参与者信息，这里简化）
  renderMeetingSetupView();
}