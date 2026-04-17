// frontend/src/modules/VoiceCallManager.js
import { startVoiceCall, stopVoiceCall, toggleMute } from './voice';

// 基类
class BaseVoiceCallUI {
  constructor(options) {
    this.onHangup = options.onHangup || (() => {});
    this.onMuteToggle = options.onMuteToggle || (() => {});
    this.container = options.container || document.body;
    this.panel = null;
    this.timerInterval = null;
    this.startTime = null;
  }
  show() { /* 子类实现 */ }
  hide() { if (this.panel) { this.panel.remove(); this.panel = null; } this.stopTimer(); }
  updateStatus(status) { /* 子类实现 */ }
  updateVolume(volume) { /* 子类实现 */ }
  setMuted(muted) { /* 子类实现 */ }
  startTimer() {
    this.startTime = Date.now();
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => {
      if (!this.startTime) return;
      const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
      const minutes = Math.floor(elapsed / 60);
      const seconds = elapsed % 60;
      const timerSpan = this.panel?.querySelector('.call-timer');
      if (timerSpan) timerSpan.textContent = `${minutes.toString().padStart(2,'0')}:${seconds.toString().padStart(2,'0')}`;
    }, 1000);
  }
  stopTimer() { if (this.timerInterval) { clearInterval(this.timerInterval); this.timerInterval = null; } this.startTime = null; }
  _bindCommonEvents() {
    const muteBtn = this.panel?.querySelector('#muteBtn');
    const hangupBtn = this.panel?.querySelector('#hangupBtn');
    const minimizeBtn = this.panel?.querySelector('.minimize-btn');
    if (muteBtn) muteBtn.onclick = () => this.onMuteToggle();
    if (hangupBtn) hangupBtn.onclick = () => this.onHangup();
    if (minimizeBtn) minimizeBtn.onclick = () => this._minimize();
  }
  _minimize() {
    if (!this.panel) return;
    this.panel.style.transform = 'scale(0.1)';
    setTimeout(() => {
      this.panel.style.display = 'none';
      let restoreBtn = document.getElementById('restoreVoiceCallBtn');
      if (!restoreBtn) {
        restoreBtn = document.createElement('div');
        restoreBtn.id = 'restoreVoiceCallBtn';
        restoreBtn.className = 'restore-voice-call-btn';
        restoreBtn.innerHTML = '🎤';
        restoreBtn.onclick = () => {
          if (this.panel) { this.panel.style.display = 'block'; this.panel.style.transform = ''; }
          restoreBtn.remove();
        };
        document.body.appendChild(restoreBtn);
      }
    }, 200);
  }
}

// 单人模式 UI
class SingleVoiceCallUI extends BaseVoiceCallUI {
  constructor(options) {
    super(options);
    this.roleName = options.roleName || '村民';
    this.roleAvatar = options.roleAvatar || '👤';
    this.rolePersonality = options.rolePersonality || '';
    this.roleCoreDemand = options.roleCoreDemand || '';
    this.userName = options.userName || '村官';
    this.userAvatar = options.userAvatar || '👨‍🌾';
  }
  show() {
    if (this.panel) return;
    this.panel = document.createElement('div');
    this.panel.className = 'voice-call-ui-single';
    this.panel.innerHTML = `
      <div class="voice-call-card-single">
        <div class="call-header"><span>🎙️ 1对1对话</span><span class="call-timer">00:00</span><button class="minimize-btn">−</button></div>
        <div class="dual-box">
          <div class="ai-box"><div class="role-avatar">${this.roleAvatar}</div><div class="role-name">${this.roleName}</div><div class="role-desc">${this.rolePersonality}</div><div class="role-demand">💬 核心诉求：${this.roleCoreDemand || '无'}</div></div>
          <div class="user-box"><div class="role-avatar">${this.userAvatar}</div><div class="role-name">${this.userName}</div><div class="mic-status" id="micStatus">🔴 未说话</div></div>
        </div>
        <div class="system-status" id="callStatusText">🔌 连接中...</div>
        <canvas id="voiceWaveform" width="300" height="60"></canvas>
        <div class="call-buttons"><button id="muteBtn" class="btn-mute">🔇 静音</button><button id="hangupBtn" class="btn-hangup">🔴 挂断</button></div>
      </div>
    `;
    this.container.appendChild(this.panel);
    this._addStyles();
    this._bindCommonEvents();
    this.startTimer();
  }
  updateStatus(status) {
    const statusSpan = this.panel?.querySelector('#callStatusText');
    if (!statusSpan) return;
    let text = '';
    switch (status) {
      case 'connecting': text = '🔌 连接中...'; break;
      case 'speaking': text = '🎙️ 轮到你了，请说话...'; break;
      case 'ai_thinking': text = '🤔 AI 正在思考...'; break;
      case 'ai_speaking': text = '🔊 对方正在说话...'; break;
      default: text = '📞 通话中';
    }
    statusSpan.textContent = text;
    if (status === 'speaking' && 'speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance('轮到你了，请说话。');
      utterance.lang = 'zh-CN';
      utterance.rate = 0.9;
      window.speechSynthesis.speak(utterance);
    }
  }
  updateVolume(volume) {
    const canvas = this.panel?.querySelector('#voiceWaveform');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);
    const barCount = 24;
    const barWidth = (width - (barCount - 1) * 2) / barCount;
    const maxHeight = height * 0.7;
    const volumeHeight = Math.min(maxHeight, volume * maxHeight);
    for (let i = 0; i < barCount; i++) {
      const barHeight = volumeHeight * (0.4 + Math.random() * 0.6);
      const x = i * (barWidth + 2);
      const y = (height - barHeight) / 2;
      ctx.fillStyle = `hsl(${120 - volume * 60}, 100%, 50%)`;
      ctx.fillRect(x, y, barWidth, barHeight);
    }
  }
  setMuted(muted) {
    const muteBtn = this.panel?.querySelector('#muteBtn');
    if (muteBtn) muteBtn.textContent = muted ? '🔊 取消静音' : '🔇 静音';
  }
  _addStyles() {
    if (document.getElementById('voice-call-ui-single-styles')) return;
    const style = document.createElement('style');
    style.id = 'voice-call-ui-single-styles';
    style.textContent = `
      .voice-call-ui-single { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); z-index: 10000; pointer-events: none; }
      .voice-call-card-single { pointer-events: auto; background: rgba(0,0,0,0.85); backdrop-filter: blur(20px); border-radius: 32px; padding: 20px; color: white; min-width: 420px; text-align: center; box-shadow: 0 8px 32px rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.2); }
      .call-header { display: flex; justify-content: space-between; margin-bottom: 16px; }
      .call-timer { font-family: monospace; background: rgba(255,255,255,0.2); padding: 2px 8px; border-radius: 20px; }
      .minimize-btn { background: none; border: none; color: white; cursor: pointer; font-size: 1.2rem; }
      .dual-box { display: flex; gap: 20px; margin-bottom: 16px; }
      .ai-box, .user-box { flex: 1; background: rgba(255,255,255,0.1); border-radius: 24px; padding: 16px; }
      .role-avatar { font-size: 3rem; margin-bottom: 8px; }
      .role-name { font-weight: bold; font-size: 1.2rem; }
      .role-desc { font-size: 0.7rem; color: #ccc; }
      .role-demand { font-size: 0.7rem; color: #ffaa66; margin-top: 8px; }
      .mic-status { font-size: 0.8rem; margin-top: 8px; color: #aaa; }
      .system-status { background: rgba(0,0,0,0.5); display: inline-block; padding: 4px 16px; border-radius: 20px; margin-bottom: 12px; font-size: 0.8rem; color: #ffd966; }
      #voiceWaveform { display: block; margin: 12px auto; background: rgba(255,255,255,0.1); border-radius: 12px; width: 100%; max-width: 300px; height: auto; }
      .call-buttons { display: flex; justify-content: center; gap: 20px; margin-top: 12px; }
      .btn-mute, .btn-hangup { padding: 8px 20px; border: none; border-radius: 40px; font-weight: bold; cursor: pointer; }
      .btn-mute { background: #444; color: white; }
      .btn-hangup { background: #f44336; color: white; }
      @media (max-width: 768px) {
        .voice-call-ui-single { left: 5%; transform: none; width: 90%; }
        .voice-call-card-single { min-width: auto; padding: 16px; }
        .dual-box { flex-direction: column; gap: 12px; }
        .role-avatar { font-size: 2rem; }
        .role-name { font-size: 1rem; }
      }
      .restore-voice-call-btn { position: fixed; bottom: 20px; right: 20px; width: 56px; height: 56px; background: #2e5d34; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 28px; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.3); z-index: 10000; }
    `;
    document.head.appendChild(style);
  }
}

// 多人模式 UI（网格画廊）
class MultiVoiceCallUI extends BaseVoiceCallUI {
  constructor(options) {
    super(options);
    this.participants = options.participants || [];
    this.currentParticipantName = options.currentParticipantName || null;
    this.userName = options.userName || '村官';
    this.userAvatar = options.userAvatar || '👨‍🌾';
    this.onParticipantSelect = options.onParticipantSelect || (() => {});
  }
  show() {
    if (this.panel) return;
    this.panel = document.createElement('div');
    this.panel.className = 'voice-call-ui-multi';
    this.panel.innerHTML = `
      <div class="voice-call-card-multi">
        <div class="call-header"><span>👥 多人对话</span><span class="call-timer">00:00</span><button class="minimize-btn">−</button></div>
        <div class="system-status" id="callStatusText">🔌 连接中...</div>
        <div class="participants-grid" id="participantsGrid">${this._renderGrid()}</div>
        <canvas id="voiceWaveform" width="300" height="60"></canvas>
        <div class="call-buttons"><button id="muteBtn" class="btn-mute">🔇 静音</button><button id="hangupBtn" class="btn-hangup">🔴 挂断</button></div>
      </div>
    `;
    this.container.appendChild(this.panel);
    this._addStyles();
    this._bindCommonEvents();
    this._bindGridClicks();
    this.startTimer();
  }
  _renderGrid() {
    const all = [
      { name: this.userName, avatar: this.userAvatar, role: 'user', isCurrent: false },
      ...this.participants.map(p => ({ ...p, role: 'ai', isCurrent: p.name === this.currentParticipantName }))
    ];
    return all.map(p => `
      <div class="participant-card ${p.role === 'ai' ? 'ai-card' : 'user-card'} ${p.isCurrent ? 'active' : ''}" data-name="${p.name}" data-role="${p.role}">
        <div class="participant-avatar">${p.avatar}</div>
        <div class="participant-name">${p.name}</div>
        ${p.satisfaction !== undefined ? `<div class="participant-satisfaction">❤️ ${p.satisfaction}%</div>` : ''}
        ${p.stance ? `<div class="participant-stance">${p.stance}</div>` : ''}
        ${p.role === 'ai' && p.isCurrent ? `<div class="speaking-indicator">🔊 对话中</div>` : ''}
      </div>
    `).join('');
  }
  updateParticipants(participants, currentName) {
    this.participants = participants;
    this.currentParticipantName = currentName;
    const grid = this.panel?.querySelector('#participantsGrid');
    if (grid) grid.innerHTML = this._renderGrid();
    this._bindGridClicks();
  }
  updateStatus(status) {
    const statusSpan = this.panel?.querySelector('#callStatusText');
    if (!statusSpan) return;
    let text = '';
    switch (status) {
      case 'connecting': text = '🔌 连接中...'; break;
      case 'speaking': text = '🎙️ 轮到你了，请说话...'; break;
      case 'ai_thinking': text = '🤔 AI 正在思考...'; break;
      case 'ai_speaking': text = '🔊 对方正在说话...'; break;
      default: text = '📞 通话中';
    }
    statusSpan.textContent = text;
    if (status === 'speaking' && 'speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance('轮到你了，请说话。');
      utterance.lang = 'zh-CN';
      utterance.rate = 0.9;
      window.speechSynthesis.speak(utterance);
    }
  }
  updateVolume(volume) {
    const canvas = this.panel?.querySelector('#voiceWaveform');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);
    const barCount = 24;
    const barWidth = (width - (barCount - 1) * 2) / barCount;
    const maxHeight = height * 0.7;
    const volumeHeight = Math.min(maxHeight, volume * maxHeight);
    for (let i = 0; i < barCount; i++) {
      const barHeight = volumeHeight * (0.4 + Math.random() * 0.6);
      const x = i * (barWidth + 2);
      const y = (height - barHeight) / 2;
      ctx.fillStyle = `hsl(${120 - volume * 60}, 100%, 50%)`;
      ctx.fillRect(x, y, barWidth, barHeight);
    }
  }
  setMuted(muted) {
    const muteBtn = this.panel?.querySelector('#muteBtn');
    if (muteBtn) muteBtn.textContent = muted ? '🔊 取消静音' : '🔇 静音';
  }
  _bindGridClicks() {
    this.panel?.querySelectorAll('.participant-card[data-role="ai"]').forEach(el => {
      el.onclick = () => {
        const name = el.dataset.name;
        if (name !== this.currentParticipantName) this.onParticipantSelect(name);
      };
    });
  }
  _addStyles() {
    if (document.getElementById('voice-call-ui-multi-styles')) return;
    const style = document.createElement('style');
    style.id = 'voice-call-ui-multi-styles';
    style.textContent = `
      .voice-call-ui-multi { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); z-index: 10000; pointer-events: none; }
      .voice-call-card-multi { pointer-events: auto; background: rgba(0,0,0,0.85); backdrop-filter: blur(20px); border-radius: 32px; padding: 20px; color: white; min-width: 500px; text-align: center; box-shadow: 0 8px 32px rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.2); }
      .call-header { display: flex; justify-content: space-between; margin-bottom: 12px; }
      .call-timer { font-family: monospace; background: rgba(255,255,255,0.2); padding: 2px 8px; border-radius: 20px; }
      .minimize-btn { background: none; border: none; color: white; cursor: pointer; font-size: 1.2rem; }
      .system-status { background: rgba(0,0,0,0.5); display: inline-block; padding: 4px 16px; border-radius: 20px; margin-bottom: 12px; font-size: 0.8rem; color: #ffd966; }
      .participants-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; margin: 16px 0; max-height: 300px; overflow-y: auto; padding: 8px; }
      .participant-card { background: rgba(255,255,255,0.1); border-radius: 16px; padding: 12px; text-align: center; cursor: pointer; transition: all 0.2s; border: 2px solid transparent; }
      .participant-card.active { border-color: #4caf50; background: rgba(76,175,80,0.2); }
      .participant-card.ai-card:hover { background: rgba(255,255,255,0.2); transform: scale(1.02); }
      .participant-avatar { font-size: 2rem; margin-bottom: 4px; }
      .participant-name { font-weight: bold; font-size: 0.9rem; }
      .participant-satisfaction { font-size: 0.7rem; color: #ffaa66; }
      .participant-stance { font-size: 0.7rem; color: #ccc; }
      .speaking-indicator { font-size: 0.7rem; color: #4caf50; margin-top: 4px; }
      #voiceWaveform { display: block; margin: 12px auto; background: rgba(255,255,255,0.1); border-radius: 12px; width: 100%; max-width: 300px; height: auto; }
      .call-buttons { display: flex; justify-content: center; gap: 20px; margin-top: 12px; }
      .btn-mute, .btn-hangup { padding: 8px 20px; border: none; border-radius: 40px; font-weight: bold; cursor: pointer; }
      .btn-mute { background: #444; color: white; }
      .btn-hangup { background: #f44336; color: white; }
      @media (max-width: 768px) {
        .voice-call-ui-multi { left: 5%; transform: none; width: 90%; }
        .voice-call-card-multi { min-width: auto; padding: 16px; }
        .participants-grid { grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 8px; }
        .participant-avatar { font-size: 1.5rem; }
        .participant-name { font-size: 0.8rem; }
      }
      .restore-voice-call-btn { position: fixed; bottom: 20px; right: 20px; width: 56px; height: 56px; background: #2e5d34; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 28px; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.3); z-index: 10000; }
    `;
    document.head.appendChild(style);
  }
}

// 会议模式 UI（演讲者视图）
class MeetingVoiceCallUI extends BaseVoiceCallUI {
  constructor(options) {
    super(options);
    this.participants = options.participants || [];
    this.currentSpeakerName = options.currentSpeakerName || null;
    this.agenda = options.agenda || [];
    this.currentAgendaIndex = options.currentAgendaIndex || 0;
    this.userName = options.userName || '村官';
    this.userAvatar = options.userAvatar || '👨‍🌾';
    this.onParticipantSelect = options.onParticipantSelect || (() => {});
    this.onVote = options.onVote || (() => {});
    this.onNextAgenda = options.onNextAgenda || (() => {});
  }
  show() {
    if (this.panel) return;
    this.panel = document.createElement('div');
    this.panel.className = 'voice-call-ui-meeting';
    this.panel.innerHTML = `
      <div class="voice-call-card-meeting">
        <div class="call-header"><span>🏛️ 会议通话</span><span class="call-timer">00:00</span><button class="minimize-btn">−</button></div>
        <div class="system-status" id="callStatusText">🔌 连接中...</div>
        <div class="meeting-layout">
          <div class="speaker-area">
            <div class="speaker-card" id="speakerCard"><div class="speaker-avatar" id="speakerAvatar">👤</div><div class="speaker-name" id="speakerName">发言人</div><div class="speaker-stance" id="speakerStance"></div><div class="speaker-satisfaction" id="speakerSatisfaction"></div></div>
            <canvas id="voiceWaveform" width="300" height="60"></canvas>
          </div>
          <div class="participants-sidebar">
            <h4>参会者</h4><div id="participantsList" class="participants-list"></div>
            <div class="agenda-panel"><h4>议程</h4><div id="agendaList"></div><button id="voteBtn" class="btn-vote">🗳️ 发起投票</button><button id="nextAgendaBtn" class="btn-next">⏩ 下一议程</button></div>
          </div>
        </div>
        <div class="call-buttons"><button id="muteBtn" class="btn-mute">🔇 静音</button><button id="hangupBtn" class="btn-hangup">🔴 挂断</button></div>
      </div>
    `;
    this.container.appendChild(this.panel);
    this._addStyles();
    this._bindCommonEvents();
    this._bindMeetingEvents();
    this._updateSpeakerDisplay();
    this._updateAgendaDisplay();
    this._updateParticipantsList();
    this.startTimer();
  }
  _updateSpeakerDisplay() {
    const speaker = this.participants.find(p => p.name === this.currentSpeakerName);
    if (speaker) {
      const avatarEl = this.panel?.querySelector('#speakerAvatar');
      const nameEl = this.panel?.querySelector('#speakerName');
      const stanceEl = this.panel?.querySelector('#speakerStance');
      const satEl = this.panel?.querySelector('#speakerSatisfaction');
      if (avatarEl) avatarEl.textContent = speaker.avatar;
      if (nameEl) nameEl.textContent = speaker.name;
      if (stanceEl) stanceEl.textContent = speaker.stance || '中立';
      if (satEl) satEl.textContent = speaker.satisfaction !== undefined ? `满意度: ${speaker.satisfaction}%` : '';
    }
  }
  _updateParticipantsList() {
    const container = this.panel?.querySelector('#participantsList');
    if (!container) return;
    container.innerHTML = this.participants.map(p => `
      <div class="participant-item ${p.name === this.currentSpeakerName ? 'active' : ''}" data-name="${p.name}">
        <span class="p-avatar">${p.avatar}</span>
        <span class="p-name">${p.name}</span>
        <span class="p-stance">${p.stance || '中立'}</span>
        ${p.name === this.currentSpeakerName ? '<span class="speaking-badge">🎤</span>' : ''}
      </div>
    `).join('');
    container.querySelectorAll('.participant-item').forEach(el => {
      el.onclick = () => {
        const name = el.dataset.name;
        if (name !== this.currentSpeakerName) this.onParticipantSelect(name);
      };
    });
  }
  _updateAgendaDisplay() {
    const container = this.panel?.querySelector('#agendaList');
    if (!container) return;
    container.innerHTML = this.agenda.map((item, idx) => `
      <div class="agenda-item ${idx === this.currentAgendaIndex ? 'current' : ''} ${item.completed ? 'completed' : ''}">
        ${idx+1}. ${item.name} ${item.completed ? '✅' : ''}
      </div>
    `).join('');
  }
  updateParticipants(participants, currentName) {
    this.participants = participants;
    this.currentSpeakerName = currentName;
    this._updateParticipantsList();
    this._updateSpeakerDisplay();
  }
  updateStatus(status) {
    const statusSpan = this.panel?.querySelector('#callStatusText');
    if (!statusSpan) return;
    let text = '';
    switch (status) {
      case 'connecting': text = '🔌 连接中...'; break;
      case 'speaking': text = '🎙️ 轮到你了，请说话...'; break;
      case 'ai_thinking': text = '🤔 AI 正在思考...'; break;
      case 'ai_speaking': text = '🔊 对方正在说话...'; break;
      default: text = '📞 通话中';
    }
    statusSpan.textContent = text;
    if (status === 'speaking' && 'speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance('轮到你了，请说话。');
      utterance.lang = 'zh-CN';
      utterance.rate = 0.9;
      window.speechSynthesis.speak(utterance);
    }
  }
  updateVolume(volume) {
    const canvas = this.panel?.querySelector('#voiceWaveform');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);
    const barCount = 24;
    const barWidth = (width - (barCount - 1) * 2) / barCount;
    const maxHeight = height * 0.7;
    const volumeHeight = Math.min(maxHeight, volume * maxHeight);
    for (let i = 0; i < barCount; i++) {
      const barHeight = volumeHeight * (0.4 + Math.random() * 0.6);
      const x = i * (barWidth + 2);
      const y = (height - barHeight) / 2;
      ctx.fillStyle = `hsl(${120 - volume * 60}, 100%, 50%)`;
      ctx.fillRect(x, y, barWidth, barHeight);
    }
  }
  setMuted(muted) {
    const muteBtn = this.panel?.querySelector('#muteBtn');
    if (muteBtn) muteBtn.textContent = muted ? '🔊 取消静音' : '🔇 静音';
  }
  _bindMeetingEvents() {
    const voteBtn = this.panel?.querySelector('#voteBtn');
    const nextBtn = this.panel?.querySelector('#nextAgendaBtn');
    if (voteBtn) voteBtn.onclick = () => this.onVote();
    if (nextBtn) nextBtn.onclick = () => this.onNextAgenda();
  }
  _addStyles() {
    if (document.getElementById('voice-call-ui-meeting-styles')) return;
    const style = document.createElement('style');
    style.id = 'voice-call-ui-meeting-styles';
    style.textContent = `
      .voice-call-ui-meeting { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); z-index: 10000; pointer-events: none; }
      .voice-call-card-meeting { pointer-events: auto; background: rgba(0,0,0,0.85); backdrop-filter: blur(20px); border-radius: 32px; padding: 20px; color: white; min-width: 700px; text-align: center; box-shadow: 0 8px 32px rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.2); }
      .call-header { display: flex; justify-content: space-between; margin-bottom: 12px; }
      .call-timer { font-family: monospace; background: rgba(255,255,255,0.2); padding: 2px 8px; border-radius: 20px; }
      .minimize-btn { background: none; border: none; color: white; cursor: pointer; font-size: 1.2rem; }
      .system-status { background: rgba(0,0,0,0.5); display: inline-block; padding: 4px 16px; border-radius: 20px; margin-bottom: 12px; font-size: 0.8rem; color: #ffd966; }
      .meeting-layout { display: flex; gap: 20px; margin: 16px 0; }
      .speaker-area { flex: 2; background: rgba(255,255,255,0.1); border-radius: 24px; padding: 16px; }
      .speaker-card { text-align: center; }
      .speaker-avatar { font-size: 3rem; }
      .speaker-name { font-size: 1.2rem; font-weight: bold; }
      .participants-sidebar { flex: 1; background: rgba(255,255,255,0.1); border-radius: 24px; padding: 16px; }
      .participants-list { max-height: 200px; overflow-y: auto; margin-bottom: 16px; }
      .participant-item { display: flex; align-items: center; gap: 8px; padding: 8px; cursor: pointer; border-radius: 12px; }
      .participant-item:hover { background: rgba(255,255,255,0.2); }
      .participant-item.active { background: rgba(76,175,80,0.3); }
      .p-avatar { font-size: 1.2rem; }
      .p-name { flex: 1; text-align: left; }
      .speaking-badge { color: #4caf50; }
      .agenda-panel h4 { margin: 8px 0; }
      .agenda-item { padding: 4px; font-size: 0.8rem; text-align: left; }
      .agenda-item.current { color: #ff9800; font-weight: bold; }
      .agenda-item.completed { text-decoration: line-through; color: #888; }
      .btn-vote, .btn-next { width: 100%; margin-top: 8px; padding: 6px; border: none; border-radius: 20px; background: #4caf50; color: white; cursor: pointer; }
      .btn-next { background: #ff9800; }
      #voiceWaveform { display: block; margin: 12px auto; background: rgba(255,255,255,0.1); border-radius: 12px; width: 100%; max-width: 300px; height: auto; }
      .call-buttons { display: flex; justify-content: center; gap: 20px; margin-top: 12px; }
      .btn-mute, .btn-hangup { padding: 8px 20px; border: none; border-radius: 40px; font-weight: bold; cursor: pointer; }
      .btn-mute { background: #444; color: white; }
      .btn-hangup { background: #f44336; color: white; }
      @media (max-width: 768px) {
        .voice-call-ui-meeting { left: 5%; transform: none; width: 90%; }
        .voice-call-card-meeting { min-width: auto; padding: 16px; }
        .meeting-layout { flex-direction: column; }
        .participants-sidebar { order: 2; margin-top: 12px; }
        .speaker-area { order: 1; }
        .participants-list { display: flex; overflow-x: auto; gap: 8px; max-height: none; }
        .participant-item { flex-direction: column; min-width: 70px; text-align: center; }
        .agenda-panel { margin-top: 12px; }
      }
      .restore-voice-call-btn { position: fixed; bottom: 20px; right: 20px; width: 56px; height: 56px; background: #2e5d34; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 28px; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.3); z-index: 10000; }
    `;
    document.head.appendChild(style);
  }
}

export function createVoiceCallUI(mode, options) {
  switch (mode) {
    case 'single': return new SingleVoiceCallUI(options);
    case 'multi': return new MultiVoiceCallUI(options);
    case 'meeting': return new MeetingVoiceCallUI(options);
    default: throw new Error(`Unknown mode: ${mode}`);
  }
}
