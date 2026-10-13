(function () {
  'use strict';

  // ============================================================
  // ① 工具函数与全局状态
  // ============================================================
  const API = '/api';

  const state = {
    activeSessionId: null,
  };

  const $ = (sel) => document.querySelector(sel);

  const sessionListEl = $('#session-list');
  const chatTitleEl   = $('#chat-title');
  const messagesEl    = $('#messages');
  const inputEl       = $('#message-input');
  const sendBtn       = $('#send-btn');
  const newSessionBtn = $('#new-session-btn');
  const uploadBtn     = $('#upload-btn');
  const docList       = $("#doc-list");
  const fileInput     = $("#file-input");
  const uploadStatus  = $("#upload-status");
  const kbCount       = $("#kb-count");

  // 统一请求：返回 JSON；非 2xx 抛错
  async function api(method, path, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(API + path, opts);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || ('HTTP ' + res.status));
    }
    return res.json();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // 后端 GET /api/sessions 返回 [ [会话数组] ]，这里解一层
  function unwrapSessions(data) {
    if (Array.isArray(data) && data.length && Array.isArray(data[0])) return data[0];
    return Array.isArray(data) ? data : [];
  }

  // ============================================================
  // ② 会话管理
  // ============================================================
  async function loadSessions() {
    const data = await api('GET', '/sessions');
    renderSessionList(unwrapSessions(data));
  }

  function renderSessionList(sessions) {
    sessionListEl.innerHTML = '';
    if (!sessions.length) {
      sessionListEl.innerHTML = '<div class="session-empty">暂无会话</div>';
      return;
    }
    sessions.forEach(s => {
      const item = document.createElement('div');
      item.className = 'session-item' + (s.id === state.activeSessionId ? ' active' : '');
      item.dataset.id = s.id;
      item.innerHTML =
        '<span class="session-name">' + escapeHtml(s.title || '会话') + '</span>' +
        '<span class="session-count">' + (s.message_count || 0) + '</span>' +
        '<button class="session-more" title="更多操作">⋯</button>' +
        '<div class="more-menu">' +
          '<button class="more-item" data-action="rename">重命名</button>' +
          '<button class="more-item" data-action="delete">删除</button>' +
        '</div>';
      sessionListEl.appendChild(item);
    });
  }

  async function selectSession(id) {
    state.activeSessionId = id;
    const s = await api('GET', '/sessions/' + id);
    chatTitleEl.textContent = s.title || '会话';
    document.querySelectorAll('.session-item').forEach(el => {
      el.classList.toggle('active', el.dataset.id === id);
    });
    renderMessages(s.messages || []);
  }

  async function createNewSession() {
    const s = await api('POST', '/sessions');
    state.activeSessionId = s.id;
    chatTitleEl.textContent = s.title || '会话';
    renderMessages(s.messages || []);
    await loadSessions();
  }

  async function renameSession(id, title) {
    const s = await api('PUT', '/sessions/' + id, { title });
    if (id === state.activeSessionId) chatTitleEl.textContent = s.title;
    await loadSessions();
  }

  async function deleteSession(id) {
    await api('DELETE', '/sessions/' + id);
    if (id === state.activeSessionId) {
      state.activeSessionId = null;
      chatTitleEl.textContent = '选择一个会话';
      renderMessages([]);
    }
    await loadSessions();
  }

  // ============================================================
  // ③ 聊天（SSE 流式）
  // ============================================================
  function renderMessages(messages) {
    messagesEl.innerHTML = '';
    if (!messages.length) {
      messagesEl.innerHTML = '<div class="empty-tip">开始新的对话吧</div>';
      return;
    }
    messages.forEach(m => appendMessage(m.role, m.content, m.sources));
    scrollToBottom();
  }

  function appendMessage(role, content, sources) {
    const tip = messagesEl.querySelector('.empty-tip');
    if (tip) tip.remove();
    const wrap = document.createElement('div');
    wrap.className = 'msg ' + (role === 'user' ? 'user' : 'assistant');
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = content;
    wrap.appendChild(bubble);
    if (Array.isArray(sources) && sources.length) {
      wrap.appendChild(buildSourcesBlock(sources));
    }
    messagesEl.appendChild(wrap);
    scrollToBottom();
    return bubble;
  }

  // 构建「引用来源」块：文件名 · 第N块 · 相似度
  function buildSourcesBlock(sources) {
    const box = document.createElement('div');
    box.className = 'sources';

    const title = document.createElement('div');
    title.className = 'sources-title';
    title.textContent = '引用来源 (' + sources.length + ')';
    box.appendChild(title);

    sources.forEach((s) => {
      const item = document.createElement('div');
      item.className = 'source-item';

      const name = document.createElement('span');
      name.className = 'source-name';
      name.textContent = (s.filename || '未知文档') + ' · 第' + ((s.chunk_index || 0) + 1) + '块';

      const score = document.createElement('span');
      score.className = 'source-score';
      score.textContent = '相似度 ' + Number(s.score || 0).toFixed(3);

      item.appendChild(name);
      item.appendChild(score);
      if (s.snippet) item.title = s.snippet;
      box.appendChild(item);
    });

    return box;
  }

  async function loadDocuments() {
    const docs = await api("GET", "/documents");
    docList.innerHTML = "";
    if (kbCount) kbCount.textContent = docs.length + " 个文档";

    if (!docs.length) {
      const empty = document.createElement("li");
      empty.className = "doc-empty";
      empty.textContent = "暂无文档";
      docList.appendChild(empty);
      return;
    }

    docs.forEach((d) => {
      const li = document.createElement("li");
      li.className = "doc-item";

      const name = document.createElement("span");
      name.className = "doc-name";
      name.textContent = d.filename;
      name.title = d.filename;

      const meta = document.createElement("span");
      meta.className = "doc-meta";
      meta.textContent = d.chunk_count + " 块";

      const del = document.createElement("span");
      del.className = "del-doc";
      del.textContent = "×";
      del.title = "删除文档";
      del.onclick = async () => {
        await api("DELETE", "/documents/" + encodeURIComponent(d.filename));
        loadDocuments();
      };

      li.appendChild(name);
      li.appendChild(meta);
      li.appendChild(del);
      docList.appendChild(li);
    });
  }

  function setUploadStatus(text, kind) {
    uploadStatus.textContent = text;
    uploadStatus.className = "upload-status" + (kind ? " " + kind : "");
  }

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    setUploadStatus("上传中...", "loading");
    uploadBtn.disabled = true;
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch(API + "/documents/upload", { method: "POST", body: form });
      const data = await res.json();
      if (res.ok && !data.error) {
        setUploadStatus("上传完成", "ok");
        await loadDocuments();
      } else {
        setUploadStatus(data.error || "上传失败", "err");
      }
    } catch (err) {
      setUploadStatus("上传失败：" + err.message, "err");
    } finally {
      fileInput.value = "";
      uploadBtn.disabled = false;
      setTimeout(() => setUploadStatus("", ""), 3000);
    }
  });

  async function sendMessage() {
    const text = inputEl.value.trim();
    if (!text) return;

    if (!state.activeSessionId) {
      await createNewSession();
      if (!state.activeSessionId) return;
    }

    inputEl.value = '';
    appendMessage('user', text);
    const bubble = appendMessage('assistant', '');

    try {
      const res = await fetch(API + '/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, session_id: state.activeSessionId })
      });
      if (!res.ok || !res.body) {
        bubble.textContent = '请求失败（HTTP ' + res.status + '）';
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let full = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let idx;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const raw = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 2);
          if (!raw) continue;

          const line = raw.startsWith('data:') ? raw.slice(5).trim() : raw;
          if (line === '[DONE]') continue;

          try {
            const d = JSON.parse(line);
            if (d.type === 'content' && d.text) {
              full += d.text;
              bubble.textContent = full;
              scrollToBottom();
            } else if (d.type === 'error') {
              bubble.textContent = '错误：' + d.message;
            } else if (d.type === "meta") {
              if (Array.isArray(d.sources) && d.sources.length) {
                bubble.parentElement.appendChild(buildSourcesBlock(d.sources));
                scrollToBottom();
              }
            }
          } catch (e) { /* 忽略无法解析的行 */ }
        }
      }
      loadSessions(); // 刷新列表：标题/消息数已更新
    } catch (err) {
      bubble.textContent = '网络错误：' + err.message;
    }
  }

  // ============================================================
  // ④ 事件绑定与初始化
  // ============================================================
  sendBtn.addEventListener('click', sendMessage);
  newSessionBtn.addEventListener('click', () => createNewSession());
  uploadBtn.addEventListener('click', () => fileInput.click());

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // 会话列表事件委托：切换会话 / 打开 ⋯ 菜单 / 重命名 / 删除
  sessionListEl.addEventListener('click', (e) => {
    const item = e.target.closest('.session-item');
    if (!item) return;

    // 先关闭其它已打开的下拉菜单
    document.querySelectorAll('.more-menu.open').forEach(m => m.classList.remove('open'));

    if (e.target.closest('.session-more')) {
      item.querySelector('.more-menu').classList.toggle('open');
      return;
    }
    if (e.target.closest('.more-item[data-action="rename"]')) {
      startRename(item);
      return;
    }
    if (e.target.closest('.more-item[data-action="delete"]')) {
      onDelete(item.dataset.id);
      return;
    }
    // 点击条目本体 → 切换会话
    selectSession(item.dataset.id);
  });

  // 点击页面其它地方关闭下拉菜单
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.more-menu') && !e.target.closest('.session-more')) {
      document.querySelectorAll('.more-menu.open').forEach(m => m.classList.remove('open'));
    }
  });

  // 内联重命名：标题原位变输入框
  function startRename(item) {
    const id = item.dataset.id;
    const nameEl = item.querySelector('.session-name');
    const oldTitle = nameEl.textContent;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'rename-input';
    input.value = oldTitle;
    item.replaceChild(input, nameEl);
    input.focus();
    input.select();

    let done = false;
    const finish = async (commit) => {
      if (done) return;
      done = true;
      const newTitle = input.value.trim();
      input.remove();
      const span = document.createElement('span');
      span.className = 'session-name';
      span.textContent = (commit && newTitle) ? newTitle : oldTitle;
      item.insertBefore(span, item.querySelector('.session-count'));
      if (commit && newTitle && newTitle !== oldTitle) {
        try {
          await renameSession(id, newTitle);
        } catch (err) {
          alert('重命名失败：' + err.message);
        }
      }
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
  }

  async function onDelete(id) {
    if (!confirm('确定删除该会话？')) return;
    try {
      await deleteSession(id);
    } catch (err) {
      alert('删除失败：' + err.message);
    }
  }

  // 初始化
  async function init() {
    try {
      await loadSessions();
      await loadDocuments();
      const first = sessionListEl.querySelector('.session-item');
      if (first) await selectSession(first.dataset.id);
    } catch (err) {
      console.error('初始化失败：', err);
    }
  }
  init();
})();
