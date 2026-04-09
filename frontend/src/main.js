// frontend/src/main.js
import './styles/style.css';
import { initAuth, bindAuthEvents } from './modules/auth';
import { appState, loadSessions, loadMessageFavorites, loadLevelProgress, createNewSession, switchSession } from './modules/state';
import { renderChatView } from './modules/chat';
import { renderSimulateView } from './modules/simulate';
import { renderMeetingSetupView } from './modules/meeting';
import { renderKnowledgeView } from './modules/knowledge';
import { renderProfileView } from './modules/profile';
import { renderGameView } from './modules/game';  // 新增
import { setupSessionTabs } from './modules/ui';
import { initDailyTasks, initParticles, setupGlobalEventListeners } from './utils/helpers';

export async function initApp() {
    await loadSessions();
    await loadMessageFavorites();
    await loadLevelProgress();
    initDailyTasks();
    initParticles();
    setupGlobalEventListeners();
    setupSessionTabs();

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