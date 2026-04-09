// frontend/src/main.js
import './styles/style.css';
import { initAuth, bindAuthEvents } from './modules/auth';
import { appState, loadSessions, loadMessageFavorites, loadLevelProgress, createNewSession, switchSession } from './modules/state';
import { renderChatView } from './modules/chat';
import { renderSimulateView } from './modules/simulate';
import { renderMeetingSetupView } from './modules/meeting';
import { renderKnowledgeView } from './modules/knowledge';
import { renderProfileView } from './modules/profile';
import { renderGameView } from './modules/game';
import { setupSessionTabs } from './modules/ui';
import { initDailyTasks, initParticles, setupGlobalEventListeners, setActiveNavByView } from './utils/helpers';

// 移动端菜单折叠
function initMobileMenu() {
  const menuToggle = document.getElementById('menuToggle');
  const sidebar = document.getElementById('sidebar');
  if (menuToggle && sidebar) {
    menuToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      sidebar.classList.toggle('open');
    });
    // 点击侧边栏外部关闭（可选）
    document.addEventListener('click', (e) => {
      if (window.innerWidth <= 768 && sidebar.classList.contains('open') && !sidebar.contains(e.target) && e.target !== menuToggle) {
        sidebar.classList.remove('open');
      }
    });
  }
}

// 移动端底部导航
function initBottomNav() {
  const bottomNav = document.getElementById('bottomNav');
  if (!bottomNav) return;
  // 只在移动端显示（由CSS控制）
  const navItems = bottomNav.querySelectorAll('.bottom-nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const view = item.dataset.view;
      if (!view) return;
      // 调用对应的视图渲染函数
      switch (view) {
        case 'chat':
          import('./modules/chat').then(m => m.switchToChat());
          break;
        case 'simulate':
          renderSimulateView(true);
          break;
        case 'meeting':
          renderMeetingSetupView();
          break;
        case 'knowledge':
          renderKnowledgeView();
          break;
        case 'game':
          renderGameView();
          break;
        case 'profile':
          renderProfileView();
          break;
        default:
          break;
      }
      // 更新激活样式
      navItems.forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      // 同时更新顶部导航的激活状态（如果有）
      setActiveNavByView(view);
    });
  });
  // 监听视图变化同步底部导航激活状态
  const observer = new MutationObserver(() => {
    const currentView = appState.currentView;
    navItems.forEach(item => {
      if (item.dataset.view === currentView) item.classList.add('active');
      else item.classList.remove('active');
    });
  });
  observer.observe(document.getElementById('dynamicContent'), { attributes: true, childList: true, subtree: true });
}

export async function initApp() {
  await loadSessions();
  await loadMessageFavorites();
  await loadLevelProgress();
  initDailyTasks();
  initParticles();
  setupGlobalEventListeners();
  setupSessionTabs();

  // 初始化移动端控件
  initMobileMenu();
  initBottomNav();

  let emptyChatSession = appState.sessions.find(s => s.type === 'chat' && (!s.messages || s.messages.length === 0));
  if (emptyChatSession) {
    await switchSession(emptyChatSession.id);
  } else {
    await createNewSession('新会话');
  }
  renderChatView();
}

initAuth();
bindAuthEvents();

window.appState = appState;
window.switchSession = switchSession;