import { fetchWithAuth } from '../utils/api';
import { appState } from './state';
import { escapeHtml, setActiveNavByView } from '../utils/helpers';

export async function renderKnowledgeView() {
  const dynamicContent = document.getElementById('dynamicContent');
  dynamicContent.innerHTML = `
    <div class="knowledge-view">
      <div class="knowledge-filters">
        ${['全部','土地管理','产业发展','民生保障','矛盾纠纷','基层治理','项目申报','生态环保','乡村建设','创业就业','政策法规'].map(t =>
          `<button class="filter-btn ${t==='全部'?'active':''}" data-type="${t==='全部'?'all':t}">${t}</button>`
        ).join('')}
      </div>
      <div class="knowledge-category-filters">
        <button class="category-filter active" data-category="all">全部</button>
        <button class="category-filter" data-category="政策">政策</button>
        <button class="category-filter" data-category="案例">案例</button>
        <button class="category-filter" data-category="常见问题">常见问题</button>
      </div>
      <div style="text-align:right;margin:8px 0;">
        <button id="uploadKnowledgeBtn" class="new-session" style="background:#2e5d34;color:white;">+上传知识</button>
        <button id="policyQuickSearchBtn" class="new-session" style="background:#2e5d34;margin-left:8px;">📜政策速查</button>
      </div>
      <div id="knowledgeList" class="knowledge-list">加载中...</div>
    </div>
  `;
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      appState.currentFilter = btn.dataset.type;
      loadKnowledge(appState.currentFilter, appState.currentCategoryFilter);
    };
  });
  document.querySelectorAll('.category-filter').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.category-filter').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      appState.currentCategoryFilter = btn.dataset.category;
      loadKnowledge(appState.currentFilter, appState.currentCategoryFilter);
    };
  });
  document.getElementById('uploadKnowledgeBtn').onclick = showUploadModal;
  document.getElementById('policyQuickSearchBtn').onclick = showPolicyQuickSearch;
  await loadKnowledge('all', 'all');
  setActiveNavByView('knowledge');
}

async function loadKnowledge(type, category) {
  let url = '/api/knowledge';
  const params = [];
  if (type !== 'all') params.push(`type=${encodeURIComponent(type)}`);
  if (category !== 'all') params.push(`category=${encodeURIComponent(category)}`);
  if (params.length) url += '?' + params.join('&');
  try {
    const res = await fetchWithAuth(url);
    appState.knowledgeData = await res.json();
    renderKnowledgeList(appState.knowledgeData);
  } catch(err) { console.error('加载知识库失败', err); }
}

function renderKnowledgeList(data) {
  const knowledgeList = document.getElementById('knowledgeList');
  if (!knowledgeList) return;
  knowledgeList.innerHTML = '';
  if (data.length === 0) { knowledgeList.innerHTML = '<div class="empty">暂无数据</div>'; return; }
  data.forEach(item => {
    let tags = [];
    if (item.tags) tags = Array.isArray(item.tags) ? item.tags : item.tags.split(',').map(t=>t.trim());
    const div = document.createElement('div');
    div.className = 'knowledge-item';
    div.innerHTML = `
      <div class="title"><span>${escapeHtml(item.title)}</span><span class="type">${item.type}·${item.category}</span></div>
      <div class="content-preview">${escapeHtml(item.content.substring(0,100))}...</div>
      <div class="tags">${tags.map(t=>`<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>
    `;
    div.addEventListener('click', () => showKnowledgeDetail(item));
    knowledgeList.appendChild(div);
  });
}

function showKnowledgeDetail(item) {
  let tags = [];
  if (item.tags) tags = Array.isArray(item.tags) ? item.tags : item.tags.split(',').map(t=>t.trim());
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="modal-content">
      <button class="modal-close">&times;</button>
      <div class="modal-title">${escapeHtml(item.title)}</div>
      <div class="modal-type">${item.type}·${item.category}</div>
      <div class="modal-content-body">${escapeHtml(item.content)}</div>
      <div class="modal-tags">${tags.map(t=>`<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>
    </div>
  `;
  modal.querySelector('.modal-close').onclick = () => document.body.removeChild(modal);
  modal.onclick = e => { if (e.target === modal) document.body.removeChild(modal); };
  document.body.appendChild(modal);
}

function showUploadModal() {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="modal-content" style="width:500px;">
      <button class="modal-close">&times;</button>
      <h3>上传新知识</h3>
      <form id="uploadForm">
        <div><label>标题：</label><br><input type="text" name="title" required style="width:100%;padding:5px;"></div>
        <div><label>内容：</label><br><textarea name="content" rows="5" required style="width:100%;padding:5px;"></textarea></div>
        <div><label>专题：</label><br>
          <select name="type" required style="width:100%;padding:5px;">
            <option value="">请选择</option>
            <option value="土地管理">土地管理</option><option value="产业发展">产业发展</option>
            <option value="民生保障">民生保障</option><option value="矛盾纠纷">矛盾纠纷</option>
            <option value="基层治理">基层治理</option><option value="项目申报">项目申报</option>
            <option value="生态环保">生态环保</option><option value="乡村建设">乡村建设</option>
            <option value="创业就业">创业就业</option><option value="政策法规">政策法规</option>
          </select>
        </div>
        <div><label>类型：</label><br>
          <select name="category" required style="width:100%;padding:5px;">
            <option value="">请选择</option><option value="政策">政策</option>
            <option value="案例">案例</option><option value="常见问题">常见问题</option>
          </select>
        </div>
        <div><label>标签(逗号分隔)：</label><br><input type="text" name="tags" style="width:100%;padding:5px;"></div>
        <div style="text-align:right;"><button type="submit" style="background:#2e5d34;color:white;padding:8px 16px;border:none;border-radius:4px;">提交</button></div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('.modal-close').onclick = () => document.body.removeChild(modal);
  modal.onclick = e => { if (e.target === modal) document.body.removeChild(modal); };
  const form = modal.querySelector('#uploadForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const data = {
      title: fd.get('title'),
      content: fd.get('content'),
      type: fd.get('type'),
      category: fd.get('category'),
      tags: fd.get('tags')
    };
    try {
      const res = await fetchWithAuth('/api/knowledge/upload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error('上传失败');
      alert('上传成功，待审核');
      document.body.removeChild(modal);
    } catch(err) { alert('上传失败：'+err.message); }
  });
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
        el.onclick = () => {
          const item = results.find(r => r.id === el.dataset.id);
          if (item) showKnowledgeDetail(item);
        };
      });
    } catch(e) { resultsDiv.innerHTML = `<div style="color:red;">搜索失败</div>`; }
  };
  input.onkeypress = e => { if (e.key === 'Enter') doSearch(); };
  modal.querySelector('#policySearchCancel').onclick = () => document.body.removeChild(modal);
  modal.querySelector('.modal-close').onclick = () => document.body.removeChild(modal);
  input.focus();
}