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

// 移动端菜单折叠（已清空，避免冲突）
function initMobileMenu() {
  // 已清空，防止事件冲突
}

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

// ========== 🚀 终极修复：手机端悬浮按钮拖拽逻辑 ==========
function initDraggableMenu() {
  if (window.innerWidth > 768) return;

  const btn = document.getElementById('menuToggle');
  if (!btn) return;

  let startX = 0, startY = 0;
  let isDragging = false;
  let dragThreshold = 10; // 移动超过10px才算拖拽

  function handleStart(e) {
    // 不再无条件 preventDefault，让 click 有机会触发
    const clientX = e.type === 'touchstart' ? e.touches[0].clientX : e.clientX;
    const clientY = e.type === 'touchstart' ? e.touches[0].clientY : e.clientY;
    startX = clientX;
    startY = clientY;
    isDragging = false; // 重置拖拽标志
    btn.style.transition = 'none';
    btn.style.cursor = 'grabbing';
  }

  function handleMove(e) {
    const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
    const clientY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;
    const deltaX = Math.abs(clientX - startX);
    const deltaY = Math.abs(clientY - startY);

    if (!isDragging && (deltaX > dragThreshold || deltaY > dragThreshold)) {
      // 超过阈值，确认为拖拽模式，阻止页面滚动
      isDragging = true;
      e.preventDefault();
    }

    if (!isDragging) return;

    // 拖拽移动逻辑
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

    // 如果没有发生拖拽，说明是纯点击，手动触发侧边栏切换
    if (!isDragging) {
      const sidebar = document.getElementById('sidebar');
      if (sidebar) sidebar.classList.toggle('open');
    }

    isDragging = false;
  }

  // 绑定触摸与鼠标事件
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
  initDailyTasks();
  initParticles();
  setupGlobalEventListeners();
  setupSessionTabs();

  // 旧菜单已禁用
  // initMobileMenu();
  initBottomNav();

  // 初始化拖动按钮
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