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

// 连击特效
let comboCount = 0;
let comboTimeout = null;

export function showComboEffect() {
  comboCount++;
  if (comboTimeout) clearTimeout(comboTimeout);
  comboTimeout = setTimeout(() => { comboCount = 0; }, 5000);
  const effectDiv = document.createElement('div');
  effectDiv.className = 'combo-effect';
  effectDiv.textContent = `${comboCount} 连击！ +${comboCount * 5} 经验`;
  effectDiv.style.position = 'fixed';
  effectDiv.style.bottom = '20%';
  effectDiv.style.right = '20px';
  effectDiv.style.backgroundColor = '#ff9800';
  effectDiv.style.color = 'white';
  effectDiv.style.padding = '8px 16px';
  effectDiv.style.borderRadius = '30px';
  effectDiv.style.fontWeight = 'bold';
  effectDiv.style.zIndex = '999';
  effectDiv.style.animation = 'floatUp 1s ease-out forwards';
  document.body.appendChild(effectDiv);
  setTimeout(() => effectDiv.remove(), 1000);
  playSound('reward');
  addPoints(comboCount * 5);
}

// 积分添加（调用后端接口 + 前端飘字）
export async function addPoints(points, reason = '游戏奖励') {
  const pointDiv = document.createElement('div');
  pointDiv.textContent = `+${points}`;
  pointDiv.style.position = 'fixed';
  pointDiv.style.bottom = '30%';
  pointDiv.style.right = '30px';
  pointDiv.style.color = '#ffd700';
  pointDiv.style.fontSize = '1.5rem';
  pointDiv.style.fontWeight = 'bold';
  pointDiv.style.textShadow = '0 0 2px black';
  pointDiv.style.animation = 'floatUp 1s ease-out';
  pointDiv.style.zIndex = '999';
  document.body.appendChild(pointDiv);
  setTimeout(() => pointDiv.remove(), 1000);

  try {
    const { fetchWithAuth } = await import('./api');
    await fetchWithAuth('/api/quiz/add-points', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points, reason })
    });
  } catch(e) { console.error('积分记录失败', e); }
}

// 任务系统（简化版）
let taskList = [];

export function initDailyTasks() {
  const today = new Date().toLocaleDateString();
  const saved = localStorage.getItem('dailyTasks');
  if (saved) {
    const parsed = JSON.parse(saved);
    if (parsed.date === today) {
      taskList = parsed.tasks;
      renderTaskPanel();
      return;
    }
  }
  taskList = [
    { id: 1, name: '发起3次对话', target: 3, current: 0, reward: 30, completed: false },
    { id: 2, name: '完成1次政策闯关', target: 1, current: 0, reward: 20, completed: false },
    { id: 3, name: '完成1次模拟对练', target: 1, current: 0, reward: 50, completed: false },
    { id: 4, name: '完成每日一练', target: 1, current: 0, reward: 40, completed: false },
    { id: 5, name: '参加会议', target: 1, current: 0, reward: 60, completed: false }
  ];
  localStorage.setItem('dailyTasks', JSON.stringify({ date: today, tasks: taskList }));
  renderTaskPanel();
}

function renderTaskPanel() {
  const panel = document.getElementById('taskPanel');
  if (!panel) return;
  let taskListDiv = panel.querySelector('#taskList');
  if (!taskListDiv) {
    taskListDiv = document.createElement('div');
    taskListDiv.id = 'taskList';
    panel.appendChild(taskListDiv);
  }
  taskListDiv.innerHTML = '';
  taskList.forEach(task => {
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
}

export function updateTaskProgress(type, delta = 1) {
  let updated = false;
  taskList.forEach(task => {
    if (task.completed) return;
    if (type === 'chat' && task.name === '发起3次对话') {
      task.current += delta;
      if (task.current >= task.target) { task.completed = true; showTaskCompleteToast(task); addPoints(task.reward, task.name); }
      updated = true;
    } else if (type === 'policyLevel' && task.name === '完成1次政策闯关') {
      task.current += delta;
      if (task.current >= task.target) { task.completed = true; showTaskCompleteToast(task); addPoints(task.reward, task.name); }
      updated = true;
    } else if (type === 'simulate' && task.name === '完成1次模拟对练') {
      task.current += delta;
      if (task.current >= task.target) { task.completed = true; showTaskCompleteToast(task); addPoints(task.reward, task.name); }
      updated = true;
    } else if (type === 'quiz' && task.name === '完成每日一练') {
      task.current += delta;
      if (task.current >= task.target) { task.completed = true; showTaskCompleteToast(task); addPoints(task.reward, task.name); }
      updated = true;
    } else if (type === 'meeting' && task.name === '参加会议') {
      task.current += delta;
      if (task.current >= task.target) { task.completed = true; showTaskCompleteToast(task); addPoints(task.reward, task.name); }
      updated = true;
    }
  });
  if (updated) {
    const today = new Date().toLocaleDateString();
    localStorage.setItem('dailyTasks', JSON.stringify({ date: today, tasks: taskList }));
    renderTaskPanel();
  }
}

function showTaskCompleteToast(task) {
  const toast = document.createElement('div');
  toast.className = 'task-toast';
  toast.innerHTML = `🎉 任务完成！获得 ${task.reward} 积分 🎉`;
  toast.style.position = 'fixed';
  toast.style.top = '20%';
  toast.style.left = '50%';
  toast.style.transform = 'translateX(-50%)';
  toast.style.backgroundColor = '#4caf50';
  toast.style.color = 'white';
  toast.style.padding = '12px 24px';
  toast.style.borderRadius = '40px';
  toast.style.fontWeight = 'bold';
  toast.style.zIndex = '1000';
  toast.style.animation = 'bounceIn 0.5s ease-out';
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
  playSound('complete');
}

// 全局事件监听（导航栏等）
export function setupGlobalEventListeners() {
  document.getElementById('newSessionBtn').onclick = () => {
    import('../modules/state').then(({ createNewSession }) => createNewSession('新会话'));
  };
  const navChat = document.getElementById('navChat');
  const navSimulate = document.getElementById('navSimulate');
  const navMeeting = document.getElementById('navMeeting');
  const navKnowledge = document.getElementById('navKnowledge');
  const navQuiz = document.getElementById('navQuiz');
  const navProfile = document.getElementById('navProfile');

  navChat.onclick = () => import('../modules/chat').then(m => m.switchToChat());
  navSimulate.onclick = () => import('../modules/simulate').then(m => m.renderSimulateView(true));
  navMeeting.onclick = () => import('../modules/meeting').then(m => m.renderMeetingSetupView());
  navKnowledge.onclick = () => import('../modules/knowledge').then(m => m.renderKnowledgeView());
  navQuiz.onclick = () => import('../modules/quiz').then(m => m.renderQuizView());
  navProfile.onclick = () => import('../modules/profile').then(m => m.renderProfileView());
}