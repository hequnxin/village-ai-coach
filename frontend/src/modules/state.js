import { fetchWithAuth } from '../utils/api';
import { renderSessionList, renderMessageFavoriteList, setupSessionTabs } from './ui';

export const appState = {
  currentSessionId: null,
  sessions: [],
  messageFavorites: [],
  currentFilter: 'all',
  currentCategoryFilter: 'all',
  currentView: 'chat',
  username: '',
  userLevel: 1,
  userPoints: 0,
  userNextLevelPoints: 100,
  knowledgeData: [],
  isTyping: false,
};

export function setAppState(newState) {
  Object.assign(appState, newState);
}

// 加载会话列表
export async function loadSessions() {
  const res = await fetchWithAuth('/api/sessions');
  if (!res.ok) throw new Error('加载会话失败');
  let sessionsData = await res.json();
  if (!Array.isArray(sessionsData)) sessionsData = [];
  sessionsData.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  appState.sessions = sessionsData;
  renderSessionList();
}

// 加载消息收藏
export async function loadMessageFavorites() {
  const res = await fetchWithAuth('/api/user/favorites');
  if (res.ok) {
    appState.messageFavorites = await res.json();
    renderMessageFavoriteList();
  }
}

// 加载等级进度
export async function loadLevelProgress() {
  try {
    const res = await fetchWithAuth('/api/user/growth');
    const data = await res.json();
    appState.userPoints = data.points;
    appState.userLevel = data.level;
    appState.userNextLevelPoints = data.nextLevelPoints;
    updateSidebarLevel();
  } catch (e) { console.error(e); }
}

function updateSidebarLevel() {
  let levelContainer = document.getElementById('sidebarLevelContainer');
  if (!levelContainer) {
    const container = document.createElement('div');
    container.id = 'sidebarLevelContainer';
    container.className = 'level-progress-container';
    const userInfo = document.querySelector('.user-info');
    const taskPanel = document.getElementById('taskPanel');
    if (userInfo && taskPanel) {
      taskPanel.parentNode.insertBefore(container, userInfo);
    }
    levelContainer = container;
  }
  levelContainer.style.display = 'block';
  levelContainer.innerHTML = `
    <div class="level-info"><span>Lv.${appState.userLevel}</span><span>${appState.userPoints}/${appState.userNextLevelPoints}</span></div>
    <div class="level-progress-bar"><div class="level-progress-fill" style="width: ${(appState.userPoints / appState.userNextLevelPoints) * 100}%"></div></div>
  `;
}

// 切换会话收藏
export async function toggleSessionFavorite(sessionId, favorite) {
  if (appState.isTyping) return;
  try {
    const res = await fetchWithAuth(`/api/session/${sessionId}/favorite`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ favorite })
    });
    if (!res.ok) throw new Error('操作失败');
    const session = appState.sessions.find(s => s.id === sessionId);
    if (session) session.favorite = favorite;
    renderSessionList();
  } catch (err) { alert('收藏操作失败：' + err.message); }
}

// 删除会话
export async function deleteSession(sessionId) {
  if (appState.isTyping) return;
  if (!confirm('删除会话？')) return;
  await fetchWithAuth(`/api/session/${sessionId}`, { method: 'DELETE' });
  appState.sessions = appState.sessions.filter(s => s.id !== sessionId);
  if (appState.currentSessionId === sessionId) {
    if (appState.sessions.length > 0) switchSession(appState.sessions[0].id);
    else createNewSession();
  } else renderSessionList();
}

// 切换会话（核心）
export async function switchSession(sessionId) {
  if (appState.isTyping) return;
  appState.currentSessionId = sessionId;
  const res = await fetchWithAuth(`/api/session/${sessionId}`);
  const session = await res.json();
  if (!session.messages) session.messages = [];
  if (session.type === 'chat') {
    appState.currentView = 'chat';
    const { renderChatView } = await import('./chat');
    renderChatView(session);
  } else if (session.type === 'simulate') {
    appState.currentView = 'simulate';
    const { renderSimulateChat } = await import('./simulate');
    renderSimulateChat(session);
  } else if (session.type === 'meeting') {
    appState.currentView = 'meeting';
    const { renderMeetingChat } = await import('./meeting');
    renderMeetingChat(session);
  }
  // 高亮当前会话
  renderSessionList();
}

// 跳转到特定消息
export async function switchToMessage(sessionId, messageId) {
  if (appState.isTyping) return;
  await switchSession(sessionId);
  setTimeout(() => {
    const msgElem = document.querySelector(`.message[data-message-id="${messageId}"]`);
    if (msgElem) {
      msgElem.scrollIntoView({ behavior: 'smooth', block: 'center' });
      msgElem.style.backgroundColor = '#fff3cd';
      setTimeout(() => msgElem.style.backgroundColor = '', 2000);
    }
  }, 500);
}

// 创建新会话
export async function createNewSession(title = '新会话') {
  if (appState.isTyping) return;
  const res = await fetchWithAuth('/api/session', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title })
  });
  const data = await res.json();
  if (!data.session) { alert('创建失败'); return; }
  appState.sessions.push(data.session);
  appState.sessions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  renderSessionList();
  await switchSession(data.sessionId);
}

// 设置当前视图（用于导航）
export async function switchView(view) {
  appState.currentView = view;
  // 更新导航按钮样式
  const navBtns = ['navChat', 'navSimulate', 'navMeeting', 'navKnowledge', 'navQuiz', 'navProfile'];
  navBtns.forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.classList.remove('active');
  });
  document.getElementById(`nav${view.charAt(0).toUpperCase() + view.slice(1)}`)?.classList.add('active');

  // 根据视图渲染
  if (view === 'chat') {
    const { renderChatView } = await import('./chat');
    // 确保有一个 chat 会话
    let chatSession = appState.sessions.find(s => s.type === 'chat');
    if (!chatSession) await createNewSession();
    else await switchSession(chatSession.id);
  } else if (view === 'simulate') {
    const { renderSimulateView } = await import('./simulate');
    renderSimulateView(true);
  } else if (view === 'meeting') {
    const { renderMeetingSetupView } = await import('./meeting');
    renderMeetingSetupView();
  } else if (view === 'knowledge') {
    const { renderKnowledgeView } = await import('./knowledge');
    renderKnowledgeView();
  } else if (view === 'quiz') {
    const { renderQuizView } = await import('./quiz');
    renderQuizView();
  } else if (view === 'profile') {
    const { renderProfileView } = await import('./profile');
    renderProfileView();
  }
}

// 初始化应用（加载数据、设置事件）
export async function initAppState() {
  await loadSessions();
  await loadMessageFavorites();
  await loadLevelProgress();
  setupSessionTabs();

  // 设置导航事件
  document.getElementById('navChat').onclick = () => switchView('chat');
  document.getElementById('navSimulate').onclick = () => switchView('simulate');
  document.getElementById('navMeeting').onclick = () => switchView('meeting');
  document.getElementById('navKnowledge').onclick = () => switchView('knowledge');
  document.getElementById('navQuiz').onclick = () => switchView('quiz');
  document.getElementById('navProfile').onclick = () => switchView('profile');
  document.getElementById('newSessionBtn').onclick = () => createNewSession();

  // 默认进入聊天视图
  await switchView('chat');
}