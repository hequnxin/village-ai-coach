// frontend/src/utils/helpers.js
import { getDailyTasks, updateDailyTaskProgress, claimDailyReward } from './api';

export function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>]/g, function(m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    return m;
  });
}

let audioEnabled = true;
let particleEnabled = true;
let particlesCanvas = null;
let particlesCtx = null;
let particles = [];

export function playSound(type) {
  if (!audioEnabled) return;
  const audioMap = {
    send: 'soundSend',
    complete: 'soundComplete',
    error: 'soundError',
    reward: 'soundReward',
    emotion: 'soundEmotion'
  };
  const audio = document.getElementById(audioMap[type]);
  if (audio) {
    audio.currentTime = 0;
    audio.play().catch(e => console.log('音效播放失败', e));
  }
}

export function addParticle(x, y, color) {
  if (!particleEnabled) return;
  particles.push({
    x, y, color,
    size: Math.random() * 4 + 2,
    vx: (Math.random() - 0.5) * 3,
    vy: (Math.random() - 0.5) * 3 - 2,
    life: 1,
    decay: 0.02
  });
}

export function initParticles() {
  if (!particleEnabled) return;
  particlesCanvas = document.createElement('canvas');
  particlesCanvas.style.position = 'fixed';
  particlesCanvas.style.top = '0';
  particlesCanvas.style.left = '0';
  particlesCanvas.style.width = '100%';
  particlesCanvas.style.height = '100%';
  particlesCanvas.style.pointerEvents = 'none';
  particlesCanvas.style.zIndex = '9999';
  document.body.appendChild(particlesCanvas);
  particlesCtx = particlesCanvas.getContext('2d');
  function resizeCanvas() {
    particlesCanvas.width = window.innerWidth;
    particlesCanvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();
  function animateParticles() {
    if (!particlesCanvas) return;
    requestAnimationFrame(animateParticles);
    particlesCtx.clearRect(0, 0, particlesCanvas.width, particlesCanvas.height);
    for (let i = particles.length-1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life -= p.decay;
      if (p.life <= 0 || p.y > particlesCanvas.height || p.x < 0 || p.x > particlesCanvas.width) {
        particles.splice(i,1);
        continue;
      }
      particlesCtx.globalAlpha = p.life;
      particlesCtx.fillStyle = p.color;
      particlesCtx.fillRect(p.x, p.y, p.size, p.size);
    }
    particlesCtx.globalAlpha = 1;
  }
  animateParticles();
}

let currentDailyTasks = [];

export async function initDailyTasks() {
  try {
    const data = await getDailyTasks();
    currentDailyTasks = data.tasks;
    renderTaskPanel();
    if (data.completed && !data.reward_claimed) {
      showToast('🎉 今日任务全部完成！点击领取奖励', 'success');
    }
  } catch (err) {
    console.error('加载每日任务失败', err);
    currentDailyTasks = [
      { id: 1, name: '发起3次对话', target: 3, current: 0, reward: 10, type: 'chat', completed: false },
      { id: 2, name: '完成1次趣味闯关', target: 1, current: 0, reward: 15, type: 'fun', completed: false },
      { id: 3, name: '完成每日一练', target: 1, current: 0, reward: 10, type: 'daily_quiz', completed: false },
      { id: 4, name: '完成1次翻牌配对', target: 1, current: 0, reward: 10, type: 'memory', completed: false },
      { id: 5, name: '参加每周竞赛', target: 1, current: 0, reward: 15, type: 'contest', completed: false }
    ];
    renderTaskPanel();
  }
}

function renderTaskPanel() {
  const panel = document.getElementById('taskPanel');
  if (!panel) return;

  // 删除可能存在的静态标题
  const staticTitle = panel.querySelector('h4');
  if (staticTitle) staticTitle.remove();

  const isCollapsed = localStorage.getItem('taskPanelCollapsed') === 'true';

  let taskListDiv = panel.querySelector('#taskList');
  if (!taskListDiv) {
    taskListDiv = document.createElement('div');
    taskListDiv.id = 'taskList';
    panel.appendChild(taskListDiv);
  }

  let header = panel.querySelector('.task-panel-header');
  if (header) header.remove();

  const completedCount = currentDailyTasks.filter(t => t.completed).length;
  const totalTasks = currentDailyTasks.length;

  header = document.createElement('div');
  header.className = 'task-panel-header';
  header.innerHTML = `
    <span class="task-panel-title">📋 今日任务 (${completedCount}/${totalTasks})</span>
    <button class="task-panel-toggle">${isCollapsed ? '▼' : '▲'}</button>
  `;
  panel.insertBefore(header, taskListDiv);

  if (isCollapsed) {
    taskListDiv.style.display = 'none';
    const claimBtn = document.getElementById('claimDailyRewardBtn');
    if (claimBtn) claimBtn.style.display = 'none';
  } else {
    taskListDiv.style.display = 'block';
    const claimBtn = document.getElementById('claimDailyRewardBtn');
    if (claimBtn) claimBtn.style.display = 'block';
  }

  const toggleBtn = header.querySelector('.task-panel-toggle');
  toggleBtn.onclick = () => {
    const newCollapsed = !isCollapsed;
    localStorage.setItem('taskPanelCollapsed', newCollapsed);
    renderTaskPanel();
  };

  taskListDiv.innerHTML = '';
  currentDailyTasks.forEach(task => {
    const percent = (task.current / task.target) * 100;
    const item = document.createElement('div');
    item.className = 'task-item';
    item.innerHTML = `
      <span class="task-name">${task.name}</span>
      <div class="task-progress"><div class="task-progress-fill" style="width:${percent}%"></div></div>
      <span class="task-reward">+${task.reward}</span>
    `;
    if (task.completed) item.style.opacity = '0.6';
    taskListDiv.appendChild(item);
  });

  const allCompleted = currentDailyTasks.every(t => t.completed);
  let claimBtn = document.getElementById('claimDailyRewardBtn');
  if (allCompleted && !window._dailyRewardClaimed) {
    if (!claimBtn) {
      claimBtn = document.createElement('button');
      claimBtn.id = 'claimDailyRewardBtn';
      claimBtn.textContent = '🎁 领取今日奖励';
      claimBtn.style.width = '100%';
      claimBtn.style.marginTop = '8px';
      claimBtn.style.padding = '6px';
      claimBtn.style.backgroundColor = '#ff9800';
      claimBtn.style.color = 'white';
      claimBtn.style.border = 'none';
      claimBtn.style.borderRadius = '20px';
      claimBtn.style.cursor = 'pointer';
      claimBtn.onclick = async () => {
        try {
          const result = await claimDailyReward();
          if (result.success) {
            showToast(`领取成功！获得 ${result.points} 积分`, 'success');
            claimBtn.remove();
            await initDailyTasks();
            showCelebration(window.innerWidth/2, window.innerHeight/2);
          } else {
            showToast(result.message || '领取失败', 'error');
          }
        } catch (err) {
          showToast('领取失败', 'error');
        }
      };
      panel.appendChild(claimBtn);
    }
    if (isCollapsed) claimBtn.style.display = 'none';
    else claimBtn.style.display = 'block';
  } else {
    if (claimBtn) claimBtn.remove();
  }
}

export async function updateTaskProgress(taskType, delta = 1) {
  try {
    const result = await updateDailyTaskProgress(taskType, delta);
    if (result.updated) {
      currentDailyTasks = result.tasks;
      renderTaskPanel();
      const completedTask = result.tasks.find(t => t.type === taskType && t.completed);
      if (completedTask) {
        showToast(`✅ 任务“${completedTask.name}”完成！`, 'success');
        playSound('complete');
        showCelebration(window.innerWidth/2, window.innerHeight/2);
      }
    }
    return result;
  } catch (err) {
    console.error('更新任务进度失败', err);
    const task = currentDailyTasks.find(t => t.type === taskType);
    if (task && !task.completed) {
      task.current += delta;
      if (task.current >= task.target) {
        task.completed = true;
        renderTaskPanel();
        showCelebration(window.innerWidth/2, window.innerHeight/2);
      }
    }
  }
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  toast.style.position = 'fixed';
  toast.style.bottom = '20px';
  toast.style.left = '50%';
  toast.style.transform = 'translateX(-50%)';
  toast.style.backgroundColor = type === 'error' ? '#f44336' : '#4caf50';
  toast.style.color = 'white';
  toast.style.padding = '8px 16px';
  toast.style.borderRadius = '30px';
  toast.style.zIndex = '2000';
  toast.style.fontSize = '0.8rem';
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ========== 特效函数 ==========
export function showPointsFloat(points, x, y) {
  const div = document.createElement('div');
  div.className = 'points-float';
  div.textContent = `+${points}`;
  div.style.left = `${x}px`;
  div.style.top = `${y}px`;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 1200);
}

export function showCelebration(x, y) {
  for (let i = 0; i < 12; i++) {
    const star = document.createElement('div');
    star.className = 'celebration-star';
    star.innerHTML = ['✨', '⭐', '🌟', '💫', '🎉', '🏆'][Math.floor(Math.random() * 6)];
    const angle = (i / 12) * Math.PI * 2;
    const radius = 60 + Math.random() * 40;
    const tx = Math.cos(angle) * radius;
    const ty = Math.sin(angle) * radius;
    star.style.left = `${x + tx}px`;
    star.style.top = `${y + ty}px`;
    star.style.animationDelay = `${Math.random() * 0.2}s`;
    document.body.appendChild(star);
    setTimeout(() => star.remove(), 800);
  }
}

export function flyPaperAirplane(fromX, fromY, toX, toY) {
  const plane = document.createElement('div');
  plane.className = 'paper-airplane';
  plane.innerHTML = '✈️';
  plane.style.left = `${fromX}px`;
  plane.style.top = `${fromY}px`;
  document.body.appendChild(plane);
  requestAnimationFrame(() => {
    plane.style.transform = `translate(${toX - fromX}px, ${toY - fromY}px) rotate(20deg)`;
    plane.style.opacity = '0';
  });
  setTimeout(() => plane.remove(), 800);
}

export function bindRippleEffect() {
  document.querySelectorAll('.action-btn, .module-btn, .new-session, .summary-btn, .submit-btn').forEach(btn => {
    btn.addEventListener('click', function(e) {
      const rect = this.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      const ripple = document.createElement('span');
      ripple.className = 'ripple';
      ripple.style.width = ripple.style.height = `${size}px`;
      ripple.style.left = `${e.clientX - rect.left - size/2}px`;
      ripple.style.top = `${e.clientY - rect.top - size/2}px`;
      this.style.position = 'relative';
      this.style.overflow = 'hidden';
      this.appendChild(ripple);
      setTimeout(() => ripple.remove(), 600);
    });
  });
}

// ========== 积分飘浮特效（加强版） ==========
export async function addPoints(points, reason = '游戏奖励') {
  const x = window.innerWidth / 2;
  const y = window.innerHeight - 100;
  showPointsFloat(points, x, y);
  if (points >= 30) {
    showCelebration(x, y);
  }
  // 后端记录积分（可选，如果后端已记录则无需重复调用）
  // try {
  //   const { fetchWithAuth } = await import('./api');
  //   await fetchWithAuth('/api/game/add-points', {
  //     method: 'POST',
  //     headers: { 'Content-Type': 'application/json' },
  //     body: JSON.stringify({ points, reason })
  //   });
  // } catch(e) { console.error('积分记录失败', e); }
}

export function showComboEffect() {
  const comboDiv = document.createElement('div');
  comboDiv.textContent = '⚡ 连击 +1';
  comboDiv.style.position = 'fixed';
  comboDiv.style.bottom = '20%';
  comboDiv.style.right = '20px';
  comboDiv.style.backgroundColor = '#ff9800';
  comboDiv.style.color = 'white';
  comboDiv.style.padding = '4px 12px';
  comboDiv.style.borderRadius = '20px';
  comboDiv.style.fontSize = '0.9rem';
  comboDiv.style.fontWeight = 'bold';
  comboDiv.style.animation = 'floatUp 0.8s ease-out';
  comboDiv.style.zIndex = '999';
  document.body.appendChild(comboDiv);
  setTimeout(() => comboDiv.remove(), 800);
  playSound('reward');
}

export function setActiveNavByView(viewName) {
  const map = {
    chat: 'navChat',
    simulate: 'navSimulate',
    meeting: 'navMeeting',
    knowledge: 'navKnowledge',
    game: 'navGame',
    profile: 'navProfile'
  };
  const id = map[viewName];
  if (id) {
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    const btn = document.getElementById(id);
    if (btn) btn.classList.add('active');
  }
  const bottomItems = document.querySelectorAll('.bottom-nav-item');
  if (bottomItems.length) {
    bottomItems.forEach(item => {
      if (item.dataset.view === viewName) item.classList.add('active');
      else item.classList.remove('active');
    });
  }
}

export function setupGlobalEventListeners() {
  const newSessionBtn = document.getElementById('newSessionBtn');
  if (newSessionBtn) {
    newSessionBtn.onclick = () => {
      import('../modules/state').then(({ createNewSession }) => createNewSession('新会话'));
    };
  }
  const navChat = document.getElementById('navChat');
  const navSimulate = document.getElementById('navSimulate');
  const navMeeting = document.getElementById('navMeeting');
  const navKnowledge = document.getElementById('navKnowledge');
  const navGame = document.getElementById('navGame');
  const navProfile = document.getElementById('navProfile');
  function setActiveNav(activeBtn) {
    [navChat, navSimulate, navMeeting, navKnowledge, navGame, navProfile].forEach(btn => {
      if (btn) btn.classList.remove('active');
    });
    if (activeBtn) activeBtn.classList.add('active');
  }
  navChat.onclick = () => {
    setActiveNav(navChat);
    import('../modules/chat').then(m => {
      if (typeof m.switchToChat === 'function') m.switchToChat();
      else console.error('switchToChat not found');
    });
  };
  navSimulate.onclick = () => {
    setActiveNav(navSimulate);
    import('../modules/simulate').then(m => m.renderSimulateView(true));
  };
  navMeeting.onclick = () => {
    setActiveNav(navMeeting);
    import('../modules/meeting').then(m => m.renderMeetingSetupView());
  };
  navKnowledge.onclick = () => {
    setActiveNav(navKnowledge);
    import('../modules/knowledge').then(m => m.renderKnowledgeView());
  };
  navGame.onclick = () => {
    setActiveNav(navGame);
    import('../modules/game').then(m => m.renderGameView());
  };
  navProfile.onclick = () => {
    setActiveNav(navProfile);
    import('../modules/profile').then(m => m.renderProfileView());
  };
}

export function setupVoiceInput(inputElement, buttonElement, onResultCallback) {
  if (!inputElement || !buttonElement) return;
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    buttonElement.disabled = true;
    buttonElement.title = '浏览器不支持语音识别';
    return;
  }
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = new SpeechRecognition();
  recognition.lang = 'zh-CN';
  recognition.interimResults = true;
  recognition.continuous = false;
  let isRecording = false;
  const startRecording = () => {
    if (isRecording) return;
    try {
      recognition.start();
      isRecording = true;
      buttonElement.style.background = '#d32f2f';
      buttonElement.textContent = '🔴';
    } catch(e) { console.warn('语音启动失败', e); }
  };
  const stopRecording = () => {
    if (isRecording) recognition.stop();
  };
  recognition.onresult = (event) => {
    const transcript = Array.from(event.results).map(r => r[0].transcript).join('');
    inputElement.value = transcript;
    if (onResultCallback) onResultCallback(transcript);
  };
  recognition.onerror = () => {
    isRecording = false;
    buttonElement.style.background = '';
    buttonElement.textContent = '🎤';
  };
  recognition.onend = () => {
    isRecording = false;
    buttonElement.style.background = '';
    buttonElement.textContent = '🎤';
  };
  buttonElement.addEventListener('mousedown', startRecording);
  buttonElement.addEventListener('mouseup', stopRecording);
  buttonElement.addEventListener('mouseleave', stopRecording);
}

export function updateSidebarLevel(level, points, nextLevelPoints) {
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
  const percent = (points / nextLevelPoints) * 100;
  levelContainer.innerHTML = `
    <div class="level-info-header">
      <span class="level-badge">Lv.${level}</span>
      <span class="points-text">${points} / ${nextLevelPoints}</span>
    </div>
    <div class="level-progress-bar"><div class="level-progress-fill" style="width: ${percent}%"></div></div>
  `;
}