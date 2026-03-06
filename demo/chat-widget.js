/**
 * RefereAI Chat Widget
 * Self-contained floating chatbot for all demo pages.
 * Uses Cosmos Reason 2-2B (fast model) on port 8001 for responsive chat.
 * Supports two modes: Frame Analysis (with image) and General Q&A (text-only).
 */
(function () {
  'use strict';

  // ── Config ──
  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const CHAT_API = isLocal
    ? 'http://192.168.4.124:8000/v1/chat/completions'
    : '/api/cosmos';
  const CHAT_MODEL = 'cosmos-reason2';
  function getChatApi() { return CHAT_API; }
  function getChatModel() { return CHAT_MODEL; }

  const SYSTEM_PROMPTS = {
    frame: (sport) =>
      `You are RefereAI, an expert ${sport || 'sports'} analyst powered by NVIDIA Cosmos Reason 2. Analyze the image using physical reasoning. Reason step-by-step inside <think> tags, then give a concise answer.`,
    general:
      'You are RefereAI, an expert sports analyst. Answer questions about sports rules, scoring, strategy, and techniques. Be concise and helpful.',
  };

  // ── Inject CSS ──
  const style = document.createElement('style');
  style.textContent = `
    .rai-chat-fab {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 99999;
      background: linear-gradient(135deg, #00eaff, #0088aa);
      color: #050508;
      border: none;
      border-radius: 48px;
      padding: 12px 20px;
      font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      box-shadow: 0 4px 24px rgba(0,234,255,0.3), 0 0 0 1px rgba(0,234,255,0.2);
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .rai-chat-fab:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 32px rgba(0,234,255,0.4), 0 0 0 1px rgba(0,234,255,0.3);
    }
    .rai-chat-fab svg { flex-shrink: 0; }

    .rai-chat-panel {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 99999;
      width: 380px;
      max-height: 520px;
      background: rgba(8, 8, 16, 0.95);
      backdrop-filter: blur(20px);
      border: 1px solid rgba(0, 234, 255, 0.2);
      border-radius: 16px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      box-shadow: 0 8px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(0,234,255,0.1);
      transform: scale(0.9);
      opacity: 0;
      pointer-events: none;
      transition: transform 0.25s cubic-bezier(0.4,0,0.2,1), opacity 0.25s;
    }
    .rai-chat-panel.open {
      transform: scale(1);
      opacity: 1;
      pointer-events: auto;
    }

    .rai-chat-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      border-bottom: 1px solid rgba(0,234,255,0.15);
      background: linear-gradient(135deg, rgba(0,234,255,0.08), transparent);
    }
    .rai-chat-header-title {
      font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
      font-size: 14px;
      font-weight: 700;
      color: #f0f0f0;
    }
    .rai-chat-header-title span { color: #00eaff; }
    .rai-chat-close {
      background: none;
      border: none;
      color: rgba(255,255,255,0.5);
      font-size: 20px;
      cursor: pointer;
      padding: 0 4px;
      line-height: 1;
      transition: color 0.2s;
    }
    .rai-chat-close:hover { color: #fff; }

    .rai-chat-tabs {
      display: flex;
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    .rai-chat-tab {
      flex: 1;
      padding: 8px 12px;
      font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
      font-size: 12px;
      font-weight: 600;
      color: rgba(255,255,255,0.4);
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      cursor: pointer;
      transition: color 0.2s, border-color 0.2s;
    }
    .rai-chat-tab:hover { color: rgba(255,255,255,0.7); }
    .rai-chat-tab.active {
      color: #00eaff;
      border-bottom-color: #00eaff;
    }

    .rai-chat-model-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 16px;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      background: rgba(0,0,0,0.2);
    }
    .rai-chat-model-label {
      font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
      font-size: 10px;
      color: rgba(255,255,255,0.4);
    }
    .rai-chat-model-select {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      color: #00eaff;
      background: rgba(0,234,255,0.08);
      border: 1px solid rgba(0,234,255,0.15);
      border-radius: 4px;
      padding: 2px 6px;
      outline: none;
      cursor: pointer;
    }
    .rai-chat-model-select option {
      background: #111;
      color: #eee;
    }

    .rai-chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 12px 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      min-height: 200px;
      max-height: 320px;
      scrollbar-width: thin;
      scrollbar-color: rgba(0,234,255,0.2) transparent;
    }

    .rai-chat-msg {
      max-width: 85%;
      padding: 10px 14px;
      border-radius: 12px;
      font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
      font-size: 13px;
      line-height: 1.55;
      word-break: break-word;
    }
    .rai-chat-msg.bot {
      align-self: flex-start;
      background: rgba(255,255,255,0.06);
      color: #e0e0e0;
      border-bottom-left-radius: 4px;
    }
    .rai-chat-msg.user {
      align-self: flex-end;
      background: rgba(0, 234, 255, 0.12);
      border: 1px solid rgba(0, 234, 255, 0.2);
      color: #f0f0f0;
      border-bottom-right-radius: 4px;
    }
    .rai-chat-msg.bot .rai-think-toggle {
      display: inline-block;
      margin-top: 6px;
      font-size: 11px;
      color: rgba(255,255,255,0.35);
      cursor: pointer;
      user-select: none;
    }
    .rai-chat-msg.bot .rai-think-toggle:hover { color: rgba(255,255,255,0.6); }
    .rai-chat-msg.bot .rai-think-block {
      display: none;
      margin-top: 8px;
      padding: 8px 10px;
      background: rgba(255,255,255,0.04);
      border-left: 2px solid rgba(245, 158, 11, 0.4);
      border-radius: 4px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      line-height: 1.6;
      color: rgba(255,255,255,0.5);
      white-space: pre-wrap;
      max-height: 150px;
      overflow-y: auto;
    }
    .rai-chat-msg.bot .rai-think-block.open { display: block; }

    .rai-chat-typing {
      align-self: flex-start;
      padding: 10px 14px;
      background: rgba(255,255,255,0.06);
      border-radius: 12px;
      border-bottom-left-radius: 4px;
      display: flex;
      gap: 4px;
    }
    .rai-chat-typing span {
      width: 6px;
      height: 6px;
      background: rgba(0,234,255,0.5);
      border-radius: 50%;
      animation: rai-bounce 1.4s infinite;
    }
    .rai-chat-typing span:nth-child(2) { animation-delay: 0.2s; }
    .rai-chat-typing span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes rai-bounce {
      0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
      40% { transform: scale(1); opacity: 1; }
    }

    .rai-chat-input-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      border-top: 1px solid rgba(255,255,255,0.08);
      background: rgba(0,0,0,0.3);
    }
    .rai-chat-input {
      flex: 1;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 8px;
      padding: 9px 12px;
      color: #f0f0f0;
      font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
      font-size: 13px;
      outline: none;
      transition: border-color 0.2s;
    }
    .rai-chat-input::placeholder { color: rgba(255,255,255,0.3); }
    .rai-chat-input:focus { border-color: rgba(0,234,255,0.4); }
    .rai-chat-send {
      background: #00eaff;
      color: #050508;
      border: none;
      border-radius: 8px;
      width: 36px;
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      flex-shrink: 0;
      transition: opacity 0.2s;
    }
    .rai-chat-send:hover { opacity: 0.85; }
    .rai-chat-send:disabled { opacity: 0.3; cursor: not-allowed; }

    @media (max-width: 480px) {
      .rai-chat-panel {
        width: calc(100vw - 16px);
        right: 8px;
        bottom: 8px;
        max-height: 70vh;
      }
      .rai-chat-fab { bottom: 16px; right: 16px; }
    }
  `;
  document.head.appendChild(style);

  // ── Create DOM ──
  const fab = document.createElement('button');
  fab.className = 'rai-chat-fab';
  fab.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg> Ask RefereAI`;
  document.body.appendChild(fab);

  const panel = document.createElement('div');
  panel.className = 'rai-chat-panel';
  panel.innerHTML = `
    <div class="rai-chat-header">
      <span class="rai-chat-header-title">Refere<span>AI</span> Chat</span>
      <button class="rai-chat-close">&times;</button>
    </div>
    <div class="rai-chat-tabs">
      <button class="rai-chat-tab active" data-mode="frame">Frame Analysis</button>
      <button class="rai-chat-tab" data-mode="general">General Q&amp;A</button>
    </div>
    <div class="rai-chat-model-row">
      <span class="rai-chat-model-label">Cosmos Reason 2-8B on Jetson AGX Orin</span>
    </div>
    <div class="rai-chat-messages"></div>
    <div class="rai-chat-input-row">
      <input class="rai-chat-input" placeholder="Type a question..." />
      <button class="rai-chat-send" title="Send">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
      </button>
    </div>
  `;
  document.body.appendChild(panel);

  // ── State ──
  let isOpen = false;
  let mode = 'frame'; // 'frame' | 'general'
  let history = []; // conversation messages
  let isSending = false;

  const messagesEl = panel.querySelector('.rai-chat-messages');
  const inputEl = panel.querySelector('.rai-chat-input');
  const sendBtn = panel.querySelector('.rai-chat-send');
  const closeBtn = panel.querySelector('.rai-chat-close');
  const tabs = panel.querySelectorAll('.rai-chat-tab');

  // ── Toggle ──
  function toggle() {
    isOpen = !isOpen;
    panel.classList.toggle('open', isOpen);
    fab.style.display = isOpen ? 'none' : 'flex';
    if (isOpen && messagesEl.children.length === 0) {
      addBotMessage(getWelcome());
    }
    if (isOpen) inputEl.focus();
  }

  fab.addEventListener('click', toggle);
  closeBtn.addEventListener('click', toggle);


  // ── Tabs ──
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      mode = tab.dataset.mode;
      // Clear conversation on mode switch
      history = [];
      messagesEl.innerHTML = '';
      addBotMessage(getWelcome());
    });
  });

  function getWelcome() {
    if (mode === 'frame') {
      const sport = detectSport();
      return `Ask me about this ${sport || 'sports'} frame. I'll analyze it using physical reasoning with Cosmos Reason 2.`;
    }
    return 'Ask me anything about sports rules, scoring, or strategy.';
  }

  // ── Detect current sport from page context ──
  function detectSport() {
    // broadcast.html: active sport tab
    const activeTab = document.querySelector('.sport-tab.active');
    if (activeTab) return activeTab.dataset.sport || 'tennis';
    // try.html: sport dropdown
    const sportSelect = document.getElementById('sport');
    if (sportSelect) return sportSelect.value || 'tennis';
    // index.html: active live sample
    const activeSample = document.querySelector('.live-sample.active');
    if (activeSample) return activeSample.dataset.sport || 'tennis';
    return 'sports';
  }

  // ── Capture frame from page context ──
  function captureFrame() {
    // broadcast.html: video frame capture
    const vid = document.getElementById('broadcast-video');
    if (vid && vid.style.display !== 'none' && vid.readyState >= 2) {
      const canvas = document.createElement('canvas');
      canvas.width = vid.videoWidth || 480;
      canvas.height = vid.videoHeight || 360;
      canvas.getContext('2d').drawImage(vid, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
    }
    // broadcast.html: static image
    const bImg = document.getElementById('broadcast-img');
    if (bImg && bImg.style.display !== 'none' && bImg.src) {
      return imgToBase64(bImg);
    }
    // try.html: preview image
    const tryImg = document.getElementById('preview-img');
    if (tryImg && tryImg.src && !tryImg.src.startsWith('data:')) {
      return imgToBase64(tryImg);
    }
    if (tryImg && tryImg.src && tryImg.src.startsWith('data:')) {
      return tryImg.src.split(',')[1];
    }
    // index.html: live preview image
    const liveImg = document.getElementById('live-preview-img');
    if (liveImg && liveImg.src) {
      return imgToBase64(liveImg);
    }
    return null;
  }

  function imgToBase64(img) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width || 480;
      canvas.height = img.naturalHeight || img.height || 360;
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
    } catch {
      return null;
    }
  }

  // ── Parse response ──
  function parseResponse(raw) {
    let thinking = '', answer = raw;
    const openIdx = raw.indexOf('<think>');
    if (openIdx !== -1) {
      const afterOpen = openIdx + 7;
      const closeIdx = raw.indexOf('</think>', afterOpen);
      if (closeIdx !== -1) {
        thinking = raw.slice(afterOpen, closeIdx).trim();
        answer = raw.slice(closeIdx + 8).trim();
      } else {
        thinking = raw.slice(afterOpen).trim();
        answer = '';
      }
    }
    const ansMatch = answer.match(/<answer>([\s\S]*?)<\/answer>/);
    if (ansMatch) answer = ansMatch[1].trim();
    answer = answer.replace(/<\/?(?:think|answer)>/g, '').trim();
    thinking = thinking.replace(/<\/?(?:think|answer)>/g, '').trim();
    return { thinking, answer: answer || thinking || raw };
  }

  // ── Messages ──
  function addBotMessage(text, thinking) {
    const div = document.createElement('div');
    div.className = 'rai-chat-msg bot';
    let html = escapeHtml(text).replace(/\n/g, '<br>');
    if (thinking) {
      html += `<span class="rai-think-toggle">Show reasoning</span>`;
      html += `<div class="rai-think-block">${escapeHtml(thinking)}</div>`;
    }
    div.innerHTML = html;
    messagesEl.appendChild(div);
    // Toggle reasoning
    const toggle = div.querySelector('.rai-think-toggle');
    if (toggle) {
      const block = div.querySelector('.rai-think-block');
      toggle.addEventListener('click', () => {
        block.classList.toggle('open');
        toggle.textContent = block.classList.contains('open') ? 'Hide reasoning' : 'Show reasoning';
      });
    }
    scrollToBottom();
  }

  function addUserMessage(text) {
    const div = document.createElement('div');
    div.className = 'rai-chat-msg user';
    div.textContent = text;
    messagesEl.appendChild(div);
    scrollToBottom();
  }

  function showTyping() {
    const div = document.createElement('div');
    div.className = 'rai-chat-typing';
    div.id = 'rai-typing';
    div.innerHTML = '<span></span><span></span><span></span>';
    messagesEl.appendChild(div);
    scrollToBottom();
  }

  function hideTyping() {
    const el = document.getElementById('rai-typing');
    if (el) el.remove();
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ── Send ──
  async function send() {
    const text = inputEl.value.trim();
    if (!text || isSending) return;
    isSending = true;
    sendBtn.disabled = true;
    inputEl.value = '';

    addUserMessage(text);

    // Build messages array
    const sport = detectSport();
    const systemPrompt = mode === 'frame' ? SYSTEM_PROMPTS.frame(sport) : SYSTEM_PROMPTS.general;

    const messages = [{ role: 'system', content: systemPrompt }];

    // Include conversation history (last 6 messages for context)
    const recent = history.slice(-6);
    for (const m of recent) {
      messages.push(m);
    }

    // Build user message
    const userContent = [];
    userContent.push({ type: 'text', text });

    if (mode === 'frame') {
      const frameB64 = captureFrame();
      if (frameB64) {
        userContent.push({
          type: 'image_url',
          image_url: { url: 'data:image/jpeg;base64,' + frameB64 },
        });
      }
    }

    messages.push({ role: 'user', content: userContent.length === 1 ? text : userContent });
    history.push({ role: 'user', content: text });

    showTyping();

    try {
      const res = await fetch(getChatApi(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: getChatModel(),
          messages,
          max_tokens: 1024,
          temperature: 0.4,
        }),
        signal: AbortSignal.timeout(60000),
      });

      hideTyping();

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${errText.slice(0, 150)}`);
      }

      const data = await res.json();
      const msg = data.choices[0].message;
      const reasoningContent = msg.reasoning_content || '';
      const mainContent = msg.content || '';
      const raw = reasoningContent
        ? '<think>' + reasoningContent + '</think>' + mainContent
        : mainContent;

      const parsed = parseResponse(raw);
      history.push({ role: 'assistant', content: parsed.answer });
      addBotMessage(parsed.answer, parsed.thinking || null);
    } catch (err) {
      hideTyping();
      addBotMessage(`Sorry, I couldn't get a response. ${err.message}`);
    }

    isSending = false;
    sendBtn.disabled = false;
    inputEl.focus();
  }

  sendBtn.addEventListener('click', send);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
})();
