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

// 手机端悬浮按钮拖拽逻辑
function initDraggableMenu() {
  if (window.innerWidth > 768) return;
  const btn = document.getElementById('menuToggle');
  if (!btn) return;
  let startX = 0, startY = 0;
  let isDragging = false;
  let dragThreshold = 10;

  function handleStart(e) {
    const clientX = e.type === 'touchstart' ? e.touches[0].clientX : e.clientX;
    const clientY = e.type === 'touchstart' ? e.touches[0].clientY : e.clientY;
    startX = clientX;
    startY = clientY;
    isDragging = false;
    btn.style.transition = 'none';
    btn.style.cursor = 'grabbing';
  }

  function handleMove(e) {
    const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
    const clientY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;
    const deltaX = Math.abs(clientX - startX);
    const deltaY = Math.abs(clientY - startY);
    if (!isDragging && (deltaX > dragThreshold || deltaY > dragThreshold)) {
      isDragging = true;
      e.preventDefault();
    }
    if (!isDragging) return;
    let newLeft = clientX - (btn.offsetWidth / 2);
    let newTop = clientY - (btn.offsetHeight / 2);
    const bound = 10;
    const maxLeft = window.innerWidth - btn.offsetWidth - bound;
    const maxTop = window.innerHeight - btn.offsetHeight - bound;
    newLeft = Math.max(bound, Math.min(newLeft, maxLeft));
    newTop = Math.max(bound, Math.min(newTop, maxTop));
    btn.style.right = 'auto';
    btn.style.bottom = 'auto';
    btn.style.left = newLeft + 'px';
    btn.style.top = newTop + 'px';
  }

  function handleEnd(e) {
    btn.style.cursor = 'move';
    btn.style.transition = 'left 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)';
    const rect = btn.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    if (centerX < window.innerWidth / 2) {
      btn.style.left = '16px';
      btn.style.right = 'auto';
    } else {
      btn.style.left = 'auto';
      btn.style.right = '16px';
    }
    if (!isDragging) {
      const sidebar = document.getElementById('sidebar');
      if (sidebar) sidebar.classList.toggle('open');
    }
    isDragging = false;
  }

  btn.addEventListener('touchstart', handleStart, { passive: false });
  btn.addEventListener('mousedown', handleStart);
  document.addEventListener('touchmove', handleMove, { passive: false });
  document.addEventListener('mousemove', handleMove);
  document.addEventListener('touchend', handleEnd);
  document.addEventListener('mouseup', handleEnd);
}

export async function initApp() {
  await loadSessions();
  await loadMessageFavorites();
  await loadLevelProgress();
  await initDailyTasks();   // 异步加载每日任务
  initParticles();
  setupGlobalEventListeners();
  setupSessionTabs();
  initBottomNav();
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