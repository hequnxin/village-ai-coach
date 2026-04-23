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
import { initDailyTasks, initParticles, setupGlobalEventListeners, setActiveNavByView, bindRippleEffect } from './utils/helpers';

// 移动端底部导航
function initBottomNav() {
  const bottomNav = document.getElementById('bottomNav');
  if (!bottomNav) return;

  const navItems = bottomNav.querySelectorAll('.bottom-nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const view = item.dataset.view;
      if (!view) return;
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
      navItems.forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      setActiveNavByView(view);
    });
  });

  const observer = new MutationObserver(() => {
    const currentView = appState.currentView;
    navItems.forEach(item => {
      if (item.dataset.view === currentView) item.classList.add('active');
      else item.classList.remove('active');
    });
  });
  const dynamicContent = document.getElementById('dynamicContent');
  if (dynamicContent) {
    observer.observe(dynamicContent, { attributes: true, childList: true, subtree: true });
  }
}

// 手机端菜单按钮
function initDraggableMenu() {
  if (window.innerWidth > 768) return;

  const btn = document.getElementById('menuToggle');
  if (!btn) return;

  // 固定样式：不再支持拖拽
  btn.style.position = 'fixed';
  btn.style.left = '16px';
  btn.style.top = '20px';
  btn.style.right = 'auto';
  btn.style.bottom = 'auto';
  btn.style.cursor = 'pointer';
  btn.style.transform = 'none';
  btn.style.transition = 'none';

  // 点击按钮切换侧边栏
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.toggle('open');
  });

  document.addEventListener('click', (e) => {
    const sidebar = document.getElementById('sidebar');
    const menuBtn = document.getElementById('menuToggle');
    if (!sidebar || !sidebar.classList.contains('open')) return;

    if (!sidebar.contains(e.target) && e.target !== menuBtn && !menuBtn.contains(e.target)) {
      sidebar.classList.remove('open');
    }
  });

  // 阻止侧边栏内部点击事件冒泡导致意外关闭
  const sidebar = document.getElementById('sidebar');
  if (sidebar) {
    sidebar.addEventListener('click', (e) => e.stopPropagation());
  }
}

export async function initApp() {
  await loadSessions();
  await loadMessageFavorites();
  await loadLevelProgress();
  await initDailyTasks();
  initParticles();
  setupGlobalEventListeners();
  setupSessionTabs();
  initBottomNav();
  bindRippleEffect();

  const observer = new MutationObserver(() => {
    bindRippleEffect();
  });
  const dynamicContent = document.getElementById('dynamicContent');
  if (dynamicContent) {
    observer.observe(dynamicContent, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDraggableMenu);
  } else {
    initDraggableMenu();
  }

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