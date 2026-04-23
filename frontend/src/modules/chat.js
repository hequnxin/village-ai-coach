import { fetchWithAuth } from '../utils/api';
import { appState, switchSession, createNewSession, loadSessions, loadMessageFavorites } from './state';
import { escapeHtml, playSound, addPoints, updateTaskProgress, setupVoiceInput, setActiveNavByView, flyPaperAirplane } from '../utils/helpers';
import { renderSessionList } from './ui';

let isTyping = false;
let typingInterval = null;
let stopTypingFlag = false;
let typingSpeed = 15;

function scrollToBottom() {
    const container = document.getElementById('chatContainer');
    if (container) container.scrollTop = container.scrollHeight;
}

function setInputEnabled(enabled) {
    const userInput = document.getElementById('userInput');
    const sendBtn = document.getElementById('sendBtn');
    const voiceBtn = document.getElementById('voiceBtn');
    if (userInput) userInput.disabled = !enabled;
    if (sendBtn) sendBtn.disabled = !enabled;
    if (voiceBtn) voiceBtn.disabled = !enabled;
    if (enabled && userInput) userInput.focus();
}

function stopTyping() {
    if (typingInterval) { clearInterval(typingInterval); typingInterval = null; }
    isTyping = false;
    setInputEnabled(true);
    const btn = document.getElementById('stopTypingBtn');
    if (btn) btn.remove();
}

function addStopButton() {
    if (document.getElementById('stopTypingBtn')) return;
    const ti = document.getElementById('typingIndicator');
    if (!ti) return;
    const btn = document.createElement('button');
    btn.id = 'stopTypingBtn';
    btn.textContent = '⏹️停止';
    btn.style.marginLeft = '10px';
    btn.style.padding = '4px 12px';
    btn.style.background = '#f44336';
    btn.style.color = 'white';
    btn.style.border = 'none';
    btn.style.borderRadius = '20px';
    btn.style.cursor = 'pointer';
    btn.onclick = () => { stopTypingFlag = true; stopTyping(); };
    ti.parentNode.insertBefore(btn, ti.nextSibling);
}

// 格式化 AI 回复
function formatAssistantContent(content) {
    if (!content) return '';
    let cleaned = content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    cleaned = cleaned.replace(/\*(.*?)\*/g, '<em>$1</em>');
    cleaned = cleaned.replace(/^#{1,6}\s+/gm, '');
    const lines = cleaned.split('\n');
    const processedLines = lines.map(line => {
        const trimmed = line.trim();
        if (/^[一二三四五六七八九十]+、/.test(trimmed) ||
            /^\d+\./.test(trimmed) ||
            /^（[一二三四五六七八九十]+）/.test(trimmed) ||
            /^（\d+）/.test(trimmed) ||
            /^[①②③④⑤⑥⑦⑧⑨⑩]/.test(trimmed)) {
            return `<strong>${line}</strong>`;
        }
        return line;
    });
    return processedLines.join('\n');
}

function createMessageElement(role, content, messageId) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role}`;
    if (messageId) msgDiv.dataset.messageId = messageId;
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    let displayContent = content;
    if (role === 'assistant') {
        displayContent = formatAssistantContent(content);
    }
    contentDiv.innerHTML = displayContent.replace(/\n/g, '<br>');
    msgDiv.appendChild(contentDiv);
    return msgDiv;
}

function addActionIcons(msgDiv, messageId) {
    const actions = document.createElement('div');
    actions.className = 'message-actions';
    const copy = document.createElement('button');
    copy.innerHTML = '📋';
    copy.title = '复制';
    copy.onclick = () => {
        const c = msgDiv.querySelector('.message-content').textContent;
        navigator.clipboard.writeText(c);
        alert('已复制');
    };
    const redo = document.createElement('button');
    redo.innerHTML = '🔄';
    redo.title = '重新回答';
    redo.onclick = () => regenerateAnswer(msgDiv);
    const fav = document.createElement('button');
    fav.innerHTML = '☆';
    fav.title = '收藏';
    if (messageId) {
        const isFav = appState.messageFavorites.some(f => f.messageId === messageId);
        if (isFav) { fav.innerHTML = '★'; fav.classList.add('favorited'); }
        fav.onclick = async () => {
            const action = fav.classList.contains('favorited') ? 'remove' : 'add';
            await toggleMessageFavorite(messageId, action);
            if (action === 'add') { fav.innerHTML = '★'; fav.classList.add('favorited'); }
            else { fav.innerHTML = '☆'; fav.classList.remove('favorited'); }
        };
    } else { fav.disabled = true; fav.title = '暂不可收藏'; }
    actions.appendChild(copy);
    actions.appendChild(redo);
    actions.appendChild(fav);
    msgDiv.appendChild(actions);
}

// 打字机效果
async function typewriteMessage(element, fullText, speed = 15) {
    if (!element) return;
    let currentText = '';
    for (let i = 0; i < fullText.length; i++) {
        currentText += fullText[i];
        const formatted = formatAssistantContent(currentText);
        element.innerHTML = formatted;
        scrollToBottom();
        await new Promise(r => setTimeout(r, speed));
    }
}

async function toggleMessageFavorite(messageId, action) {
    try {
        const res = await fetchWithAuth('/api/user/favorite', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messageId, action })
        });
        if (!res.ok) throw new Error('操作失败');
        await loadMessageFavorites();
        if (action === 'add') updateTaskProgress('favorite', 1);
    } catch(err) { alert('消息收藏失败：' + err.message); }
}

async function regenerateAnswer(msgDiv) {
    if (isTyping) return;
    const container = document.getElementById('messages');
    const all = Array.from(container.children);
    const idx = all.indexOf(msgDiv);
    if (idx <= 0) return;
    let userMsgDiv = null;
    for (let i = idx-1; i >= 0; i--) {
        if (all[i].classList.contains('user')) { userMsgDiv = all[i]; break; }
    }
    if (!userMsgDiv) return;
    const userText = userMsgDiv.querySelector('.message-content').textContent;
    for (let i = all.length-1; i >= idx; i--) all[i].remove();
    await sendUserMessage(userText);
}

// 核心发送函数（支持中间状态）
async function sendUserMessage(text) {
    if (isTyping) return;
    if (!text || !appState.currentSessionId) return;

    const messagesDiv = document.getElementById('messages');
    if (!messagesDiv) return;

    // 显示用户消息
    const userMsgDiv = createMessageElement('user', text);
    messagesDiv.appendChild(userMsgDiv);
    addActionIcons(userMsgDiv, null);
    scrollToBottom();

    // 纸飞机动画
    const inputRect = document.getElementById('userInput')?.getBoundingClientRect();
    const lastMsg = document.querySelector('#messages .message:last-child');
    if (lastMsg && inputRect) {
        const msgRect = lastMsg.getBoundingClientRect();
        flyPaperAirplane(
            inputRect.right - 20, inputRect.top,
            msgRect.left + 20, msgRect.top
        );
    }

    // 显示占位 assistant 消息（初始 pending）
    const assistantMsgDiv = createMessageElement('assistant', '');
    assistantMsgDiv.classList.add('thinking-message');
    const contentDiv = assistantMsgDiv.querySelector('.message-content');
    contentDiv.innerHTML = '⏳ 正在准备...';
    messagesDiv.appendChild(assistantMsgDiv);
    scrollToBottom();

    setInputEnabled(false);

    const token = localStorage.getItem('token');
    if (!token) {
        setInputEnabled(true);
        throw new Error('未登录');
    }

    try {
        const response = await fetch('/api/chat-async', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ sessionId: appState.currentSessionId, message: text })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(errText || '请求失败');
        }

        const data = await response.json();
        const assistantMessageId = data.assistantMessageId;

        // 轮询检查状态
        let pollTimer;
        const checkCompletion = async () => {
            try {
                const statusRes = await fetchWithAuth(`/api/chat-async/status/${assistantMessageId}`);
                const statusData = await statusRes.json();

                if (statusData.status === 'retrieving') {
                    contentDiv.innerHTML = '🔍 正在检索知识库...';
                } else if (statusData.status === 'generating') {
                    contentDiv.innerHTML = '🤖 AI 正在思考中，请稍候...';
                } else if (statusData.status === 'completed') {
                    if (pollTimer) clearInterval(pollTimer);
                    const fullContent = statusData.content;
                    assistantMsgDiv.classList.remove('thinking-message');
                    contentDiv.innerHTML = '';
                    await typewriteMessage(contentDiv, fullContent, 15);
                    addActionIcons(assistantMsgDiv, assistantMessageId);
                    window.refreshGrowthChart?.();
                    scrollToBottom();
                    setInputEnabled(true);
                    await loadSessions();
                    await loadMessageFavorites();
                    updateTaskProgress('chat', 1);
                    playSound('send');
                }
            } catch (err) {
                console.error('轮询出错', err);
            }
        };

        pollTimer = setInterval(checkCompletion, 1500);
        checkCompletion();

        // 存储轮询定时器以便页面卸载时清理
        if (!window._pendingPollTimers) window._pendingPollTimers = [];
        window._pendingPollTimers.push(pollTimer);

    } catch (err) {
        console.error(err);
        contentDiv.innerHTML = `❌ 发送失败：${err.message}`;
        assistantMsgDiv.classList.remove('thinking-message');
        setInputEnabled(true);
        alert('发送失败：' + err.message);
    }
}

// 恢复未完成的消息（切回界面时调用）
async function resumePendingMessages(sessionId) {
    try {
        const res = await fetchWithAuth(`/api/session/${sessionId}`);
        const session = await res.json();
        const pendingMsg = (session.messages || []).find(m => m.role === 'assistant' && (m.status === 'pending' || m.status === 'retrieving' || m.status === 'generating'));
        if (pendingMsg) {
            const msgElement = document.querySelector(`.message[data-message-id="${pendingMsg.messageId}"]`);
            if (msgElement) {
                msgElement.classList.add('thinking-message');
                const contentDiv = msgElement.querySelector('.message-content');
                // 启动轮询
                const pollInterval = setInterval(async () => {
                    try {
                        const statusRes = await fetchWithAuth(`/api/chat-async/status/${pendingMsg.messageId}`);
                        const statusData = await statusRes.json();
                        if (statusData.status === 'retrieving') {
                            contentDiv.innerHTML = '🔍 正在检索知识库...';
                        } else if (statusData.status === 'generating') {
                            contentDiv.innerHTML = '🤖 AI 正在思考中，请稍候...';
                        } else if (statusData.status === 'completed') {
                            clearInterval(pollInterval);
                            msgElement.classList.remove('thinking-message');
                            contentDiv.innerHTML = '';
                            await typewriteMessage(contentDiv, statusData.content, 15);
                            addActionIcons(msgElement, pendingMsg.messageId);
                            window.refreshGrowthChart?.();
                            scrollToBottom();
                            await loadSessions();
                            await loadMessageFavorites();
                        }
                    } catch (err) {
                        console.error('恢复轮询出错', err);
                    }
                }, 1500);
            }
        }
    } catch (err) {
        console.error('恢复 pending 消息失败', err);
    }
}

export async function sendMessage() {
    const input = document.getElementById('userInput');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    if (!appState.currentSessionId) {
        await createNewSession();
        input.value = text;
        await sendUserMessage(text);
        return;
    }
    const sess = appState.sessions.find(s => s.id === appState.currentSessionId);
    if (sess && sess.type !== 'chat') {
        alert('当前不是问答模式，已创建新会话');
        await createNewSession();
        input.value = text;
        await sendUserMessage(text);
        return;
    }
    input.value = '';
    await sendUserMessage(text);
}

function displayMessages(messages) {
    const messagesDiv = document.getElementById('messages');
    if (!messagesDiv) return;
    messagesDiv.innerHTML = '';
    messages.forEach(msg => {
        const msgDiv = createMessageElement(msg.role, msg.content, msg.messageId);
        messagesDiv.appendChild(msgDiv);
        addActionIcons(msgDiv, msg.messageId);
    });
    scrollToBottom();
}

// 移动端摘要模态框
function showMobileSummaryModal(contentHtml) {
    const existingModal = document.getElementById('mobileSummaryModal');
    if (existingModal) existingModal.remove();
    const modal = document.createElement('div');
    modal.id = 'mobileSummaryModal';
    modal.className = 'mobile-summary-modal';
    modal.innerHTML = `
        <div class="mobile-summary-overlay"></div>
        <div class="mobile-summary-drawer">
            <div class="mobile-summary-header">
                <span>📋 信息提取</span>
                <button class="mobile-summary-close">&times;</button>
            </div>
            <div class="mobile-summary-content">${contentHtml}</div>
        </div>
    `;
    document.body.appendChild(modal);
    const closeBtn = modal.querySelector('.mobile-summary-close');
    const overlay = modal.querySelector('.mobile-summary-overlay');
    const closeModal = () => modal.remove();
    closeBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', closeModal);
}

export async function renderChatView(existingSession = null) {
    const isMobile = window.innerWidth <= 768;
    const dynamicContent = document.getElementById('dynamicContent');
    dynamicContent.innerHTML = `
        <div class="chat-view">
            <div class="chat-area">
                <div class="chat-header">
                    <div><h1 id="currentSessionTitle">村官AI伙伴</h1></div>
                    <div>
                        <button id="summaryBtn" class="summary-btn">📋 生成摘要</button>
                        <button id="exportBtn" class="summary-btn">📥导出</button>
                        <button id="policyQuickSearch" class="summary-btn">📜政策速查</button>
                    </div>
                </div>
                <div id="chatContainer" class="chat-container">
                    <div id="messages"></div>
                </div>
                <footer class="chat-footer">
                    <div class="input-tip">💡提示：按住麦克风语音输入</div>
                    <div class="preset-questions">
                        <button class="preset-btn" data-question="村里闲置小学可以改造成什么？">🏫闲置小学改造</button>
                        <button class="preset-btn" data-question="土地流转合同要注意哪些条款？">📄土地流转合同</button>
                        <button class="preset-btn" data-question="如何申请高标准农田项目？">🌾申请高标准农田</button>
                        <button class="preset-btn" data-question="村民不配合垃圾分类怎么办？">🗑️垃圾分类</button>
                        <button class="preset-btn" data-question="想发展民宿需要办哪些手续？">🏠发展民宿</button>
                    </div>
                    <div class="input-area">
                        <textarea id="userInput" placeholder="输入你的问题..." rows="2"></textarea>
                        <button id="voiceBtn" class="voice-btn">🎤</button>
                        <button id="sendBtn">发送</button>
                    </div>
                </footer>
            </div>
            <div class="info-panel" id="infoPanel" style="display: none;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <h3>📋信息提取</h3>
                    <button id="closeInfoPanel" style="background:none; border:none; font-size:1.2rem; cursor:pointer;">&times;</button>
                </div>
                <div id="infoContent" class="info-content"></div>
            </div>
        </div>
    `;

    const userInput = document.getElementById('userInput');
    const sendBtn = document.getElementById('sendBtn');
    const exportBtn = document.getElementById('exportBtn');
    const summaryBtn = document.getElementById('summaryBtn');

    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.onclick = () => { userInput.value = btn.dataset.question; sendMessage(); };
    });

    sendBtn.onclick = sendMessage;
    userInput.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !isTyping) { e.preventDefault(); sendMessage(); } };
    exportBtn.onclick = exportCurrentChat;
    summaryBtn.onclick = async () => {
        const sessionId = appState.currentSessionId;
        if (!sessionId) return;
        summaryBtn.disabled = true;
        summaryBtn.textContent = '生成中...';
        try {
            const res = await fetchWithAuth('/api/chat/summarize', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId })
            });
            const data = await res.json();
            const summary = data.summary || { points: [], status: '', reasons: [], suggestions: [], references: [] };
            let html = '<div style="font-size:0.9rem;">';
            if (summary.points.length) html += `<div><strong>📌 要点</strong><ul>${summary.points.map(p=>`<li>${escapeHtml(p)}</li>`).join('')}</ul></div>`;
            if (summary.status) html += `<div><strong>📋 现状</strong><div>${escapeHtml(summary.status)}</div></div>`;
            if (summary.reasons.length) html += `<div><strong>🔍 原因</strong><ul>${summary.reasons.map(r=>`<li>${escapeHtml(r)}</li>`).join('')}</ul></div>`;
            if (summary.suggestions.length) html += `<div><strong>💡 建议</strong><ul>${summary.suggestions.map(s=>`<li>${escapeHtml(s)}</li>`).join('')}</ul></div>`;
            if (summary.references.length) html += `<div><strong>📚 参考</strong><ul>${summary.references.map(r=>`<li>${escapeHtml(r)}</li>`).join('')}</ul></div>`;
            html += `</div>`;
            const isMobileInner = window.innerWidth <= 768;
            if (isMobileInner) {
                showMobileSummaryModal(html);
            } else {
                const infoPanel = document.getElementById('infoPanel');
                const infoContent = document.getElementById('infoContent');
                if (infoContent) infoContent.innerHTML = html;
                if (infoPanel) infoPanel.style.display = 'block';
            }
        } catch(e) {
            alert('生成摘要失败');
        } finally {
            summaryBtn.disabled = false;
            summaryBtn.textContent = '📋 生成摘要';
        }
    };

    const closeInfoBtn = document.getElementById('closeInfoPanel');
    if (closeInfoBtn) {
        closeInfoBtn.onclick = () => { const panel = document.getElementById('infoPanel'); if (panel) panel.style.display = 'none'; };
    }

    setupVoiceInput(userInput, document.getElementById('voiceBtn'));

    if (appState.currentSessionId && !existingSession) {
        const res = await fetchWithAuth(`/api/session/${appState.currentSessionId}`);
        const session = await res.json();
        document.getElementById('currentSessionTitle').textContent = session.title || '村官AI伙伴';
        displayMessages(session.messages || []);
        document.getElementById('infoContent').innerHTML = '<div style="color:#888;">点击"生成摘要"获取分析</div>';
    } else if (existingSession) {
        document.getElementById('currentSessionTitle').textContent = existingSession.title || '村官AI伙伴';
        displayMessages(existingSession.messages || []);
        document.getElementById('infoContent').innerHTML = '<div style="color:#888;">点击"生成摘要"获取分析</div>';
    }

    document.getElementById('policyQuickSearch')?.addEventListener('click', showPolicyQuickSearch);
    setActiveNavByView('chat');

    // 移动端适配
    if (isMobile) {
        const oldMenuToggle = document.getElementById('menuToggle');
        if (oldMenuToggle) oldMenuToggle.style.display = 'none';
        // 添加顶部栏汉堡菜单
        const headerLeftDiv = document.querySelector('.chat-header > div:first-child');
        if (headerLeftDiv && !document.querySelector('.mobile-menu-btn')) {
            const menuBtn = document.createElement('button');
            menuBtn.className = 'mobile-menu-btn';
            menuBtn.innerHTML = '☰';
            menuBtn.setAttribute('aria-label', '菜单');
            menuBtn.onclick = (e) => {
                e.stopPropagation();
                const sidebar = document.getElementById('sidebar');
                if (sidebar) sidebar.classList.toggle('open');
            };
            headerLeftDiv.insertBefore(menuBtn, headerLeftDiv.firstChild);
        }
        // 点击侧边栏外部关闭
        const closeSidebarOnOutsideClick = (e) => {
            const sidebar = document.getElementById('sidebar');
            const menuBtn = document.querySelector('.mobile-menu-btn');
            if (!sidebar || !sidebar.classList.contains('open')) return;
            if (!sidebar.contains(e.target) && e.target !== menuBtn && !menuBtn?.contains(e.target)) {
                sidebar.classList.remove('open');
            }
        };
        document.removeEventListener('click', closeSidebarOnOutsideClick);
        document.addEventListener('click', closeSidebarOnOutsideClick);
        // 更多菜单按钮
        const rightBtnGroup = document.querySelector('.chat-header > div:last-child');
        if (rightBtnGroup && !document.getElementById('moreMenuBtn')) {
            const moreBtn = document.createElement('button');
            moreBtn.id = 'moreMenuBtn';
            moreBtn.className = 'summary-btn';
            moreBtn.textContent = '⋯ 更多';
            moreBtn.onclick = () => {
                const modal = document.createElement('div');
                modal.className = 'modal';
                modal.style.display = 'flex';
                modal.innerHTML = `
                    <div class="modal-content" style="width:200px; text-align:center;">
                        <button class="modal-close" style="position:absolute;right:8px;top:8px;">&times;</button>
                        <div style="display:flex; flex-direction:column; gap:12px; margin-top:12px;">
                            <button id="summaryBtnMobile" class="summary-btn">📋 生成摘要</button>
                            <button id="exportBtnMobile" class="summary-btn">📥 导出</button>
                            <button id="policyQuickSearchMobile" class="summary-btn">📜 政策速查</button>
                        </div>
                    </div>
                `;
                document.body.appendChild(modal);
                modal.querySelector('.modal-close').onclick = () => modal.remove();
                modal.querySelector('#summaryBtnMobile').onclick = () => { modal.remove(); document.getElementById('summaryBtn')?.click(); };
                modal.querySelector('#exportBtnMobile').onclick = () => { modal.remove(); document.getElementById('exportBtn')?.click(); };
                modal.querySelector('#policyQuickSearchMobile').onclick = () => { modal.remove(); document.getElementById('policyQuickSearch')?.click(); };
            };
            rightBtnGroup.innerHTML = '';
            rightBtnGroup.appendChild(moreBtn);
        }
        // 添加闪电按钮（快捷提问）
        const inputArea = document.querySelector('.input-area');
        if (inputArea && !document.querySelector('.lightning-btn')) {
            const lightningBtn = document.createElement('button');
            lightningBtn.className = 'lightning-btn';
            lightningBtn.innerHTML = '⚡';
            lightningBtn.title = '快捷提问';
            lightningBtn.onclick = () => {
                const questions = [
                    '村里闲置小学可以改造成什么？',
                    '土地流转合同要注意哪些条款？',
                    '如何申请高标准农田项目？',
                    '村民不配合垃圾分类怎么办？',
                    '想发展民宿需要办哪些手续？'
                ];
                const modal = document.createElement('div');
                modal.className = 'modal';
                modal.style.display = 'flex';
                modal.innerHTML = `
                    <div class="modal-content" style="width:280px; text-align:center;">
                        <button class="modal-close" style="position:absolute;right:8px;top:8px;">&times;</button>
                        <h4 style="margin:0 0 12px;">⚡ 快捷提问</h4>
                        ${questions.map(q => `<button class="quick-q-btn" style="display:block; width:100%; margin:8px 0; padding:8px; background:#f5f5f5; border:none; border-radius:20px; text-align:left;">${escapeHtml(q)}</button>`).join('')}
                    </div>
                `;
                document.body.appendChild(modal);
                modal.querySelector('.modal-close').onclick = () => modal.remove();
                modal.querySelectorAll('.quick-q-btn').forEach(btn => {
                    btn.onclick = () => {
                        const input = document.getElementById('userInput');
                        if (input) input.value = btn.textContent;
                        modal.remove();
                        sendMessage();
                    };
                });
            };
            const voiceBtn = inputArea.querySelector('#voiceBtn');
            if (voiceBtn) {
                inputArea.insertBefore(lightningBtn, voiceBtn);
            } else {
                inputArea.prepend(lightningBtn);
            }
        }
    }

    // 恢复未完成的消息
    await resumePendingMessages(appState.currentSessionId);
}

async function exportCurrentChat() {
    if (!appState.currentSessionId) return;
    const res = await fetchWithAuth(`/api/session/${appState.currentSessionId}`);
    const session = await res.json();
    if (!session.messages || !session.messages.length) { alert('暂无对话'); return; }
    let text = `会话：${session.title}\n时间：${new Date(session.createdAt).toLocaleString()}\n\n`;
    session.messages.forEach(m => {
        text += `${m.role === 'user' ? '👤村官' : '🤖AI伙伴'}：${m.content}\n\n`;
    });
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `会话_${session.title}_${new Date().toISOString().slice(0,10)}.txt`; a.click();
    URL.revokeObjectURL(url);
}

async function showPolicyQuickSearch() {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content" style="width:450px;">
            <button class="modal-close" style="position:absolute;right:12px;top:12px;">&times;</button>
            <h3>📜 政策速查</h3>
            <input type="text" id="policySearchInput" placeholder="请输入关键词..." style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;">
            <div id="searchResults" style="margin-top:16px;max-height:300px;overflow-y:auto;"></div>
            <div style="margin-top:16px;text-align:right;"><button id="policySearchCancel" style="background:#ccc;padding:6px 16px;border:none;border-radius:4px;">取消</button></div>
        </div>
    `;
    document.body.appendChild(modal);
    const input = modal.querySelector('#policySearchInput');
    const resultsDiv = modal.querySelector('#searchResults');
    const doSearch = async () => {
        const keyword = input.value.trim();
        if (!keyword) return;
        resultsDiv.innerHTML = '<div style="text-align:center;padding:20px;">搜索中...</div>';
        try {
            const res = await fetchWithAuth(`/api/knowledge/search?q=${encodeURIComponent(keyword)}`);
            const results = await res.json();
            if (results.length === 0) { resultsDiv.innerHTML = '<div style="text-align:center;padding:20px;color:#999;">未找到相关内容</div>'; return; }
            resultsDiv.innerHTML = results.map(r => `
                <div style="margin-bottom:12px;padding:8px;border-bottom:1px solid #eee;cursor:pointer;" data-id="${r.id}">
                    <div style="font-weight:bold;color:#2e5d34;">${escapeHtml(r.title)}</div>
                    <div style="font-size:0.8rem;color:#666;margin-top:4px;">${escapeHtml(r.content.substring(0,150))}...</div>
                </div>
            `).join('');
            resultsDiv.querySelectorAll('[data-id]').forEach(el => {
                el.onclick = () => { showKnowledgeDetail(results.find(r => r.id === el.dataset.id)); };
            });
        } catch(e) { resultsDiv.innerHTML = `<div style="color:red;">搜索失败</div>`; }
    };
    input.onkeypress = e => { if (e.key === 'Enter') doSearch(); };
    modal.querySelector('#policySearchCancel').onclick = () => document.body.removeChild(modal);
    modal.querySelector('.modal-close').onclick = () => document.body.removeChild(modal);
    input.focus();
}

function showKnowledgeDetail(item) {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content">
            <button class="modal-close">&times;</button>
            <div class="modal-title">${escapeHtml(item.title)}</div>
            <div class="modal-type">${item.type}·${item.category}</div>
            <div class="modal-content-body">${escapeHtml(item.content)}</div>
        </div>
    `;
    modal.querySelector('.modal-close').onclick = () => document.body.removeChild(modal);
    modal.onclick = e => { if (e.target === modal) document.body.removeChild(modal); };
    document.body.appendChild(modal);
}

export function switchToChat() {
    if (appState.currentSessionId && appState.sessions.find(s => s.id === appState.currentSessionId)?.type === 'chat') {
        renderChatView();
    } else {
        createNewSession('新会话').then(() => { renderChatView(); });
    }
}