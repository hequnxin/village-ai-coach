import './styles/style.css';
import { initAuth, bindAuthEvents } from './modules/auth';
import { appState, loadSessions, loadMessageFavorites, loadLevelProgress, createNewSession, switchSession } from './modules/state';
import { renderChatView } from './modules/chat';
import { renderSimulateView } from './modules/simulate';
import { renderMeetingSetupView } from './modules/meeting';
import { renderKnowledgeView } from './modules/knowledge';
import { renderQuizView } from './modules/quiz';
import { renderProfileView } from './modules/profile';
import { setupSessionTabs } from './modules/ui';
import { initDailyTasks, initParticles, setupGlobalEventListeners } from './utils/helpers';

// 全局初始化函数（供 auth 模块调用）
export async function initApp() {
  await loadSessions();
  await loadMessageFavorites();
  await loadLevelProgress();
  initDailyTasks();
  initParticles();
  setupGlobalEventListeners();
  setupSessionTabs();

  // 优先查找无消息的 chat 会话
  let emptyChatSession = appState.sessions.find(s => s.type === 'chat' && (!s.messages || s.messages.length === 0));
  if (emptyChatSession) {
    await switchSession(emptyChatSession.id);
  } else {
    await createNewSession('新会话');
  }

  // 默认激活问答视图
  const { renderChatView: renderChat } = await import('./modules/chat');
  renderChat();
}

// 启动应用
initAuth();        // 检查登录状态，若已登录会调用 initApp
bindAuthEvents();  // 绑定登录/注册按钮事件

// 暴露一些全局函数供控制台调试（可选）
window.appState = appState;
window.switchSession = switchSession;