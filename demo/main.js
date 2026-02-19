/* ═══════════════════════════════════════════════════════════════
   RefereAI x Cosmos Reason 2 — Demo SPA JavaScript
   ═══════════════════════════════════════════════════════════════ */

// ── Sport Tab Switching ───────────────────────────────────────
function initSportTabs() {
  const tabs = document.querySelectorAll('.sport-tab');
  const cards = document.querySelectorAll('.sport-card');

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const sport = tab.dataset.sport;

      // Update tab active state
      tabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');

      // Show matching card, hide others
      cards.forEach((card) => {
        if (card.dataset.sport === sport) {
          card.classList.add('active');
        } else {
          card.classList.remove('active');
        }
      });
    });
  });
}


// ── Intersection Observer — Scroll Animations ─────────────────
function initScrollAnimations() {
  // Tag elements that should animate
  const animTargets = [
    ...document.querySelectorAll('.section-header'),
    ...document.querySelectorAll('.pipeline'),
    ...document.querySelectorAll('.pipeline-detail-bar'),
    ...document.querySelectorAll('.sport-tabs'),
    ...document.querySelectorAll('.sport-cards'),
    ...document.querySelectorAll('.reasoning-panel'),
    ...document.querySelectorAll('.feature-card'),
    ...document.querySelectorAll('.hardware-visual'),
    ...document.querySelectorAll('.hardware-specs'),
    ...document.querySelectorAll('.hardware-advantages'),
    ...document.querySelectorAll('.team-info'),
    ...document.querySelectorAll('.hackathon-card'),
  ];

  animTargets.forEach((el) => el.classList.add('fade-up'));

  // Stagger groups
  const staggerGroups = [
    ...document.querySelectorAll('.reasoning-explainer'),
    ...document.querySelectorAll('.hero-stats'),
  ];
  staggerGroups.forEach((el) => el.classList.add('stagger'));

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          // Stop observing once animated
          observer.unobserve(entry.target);
        }
      });
    },
    {
      threshold: 0.15,
      rootMargin: '0px 0px -40px 0px',
    }
  );

  animTargets.forEach((el) => observer.observe(el));
  staggerGroups.forEach((el) => observer.observe(el));
}


// ── Typing Animation on Reasoning Panel ───────────────────────
function initTypingAnimation() {
  const contentEl = document.getElementById('reasoning-think-content');
  if (!contentEl) return;

  const panel = document.querySelector('.reasoning-panel');
  const fullText = contentEl.textContent;
  let hasPlayed = false;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting && !hasPlayed) {
          hasPlayed = true;
          observer.unobserve(entry.target);
          playTyping(contentEl, panel, fullText);
        }
      });
    },
    { threshold: 0.3 }
  );

  observer.observe(contentEl);
}

function playTyping(el, panel, text) {
  el.textContent = '';
  el.classList.add('typing');
  panel.classList.add('is-typing');

  let index = 0;
  // Characters per tick — vary speed for a natural feel
  const baseSpeed = 18; // ms per character

  function typeNext() {
    if (index >= text.length) {
      el.classList.remove('typing');
      panel.classList.remove('is-typing');
      return;
    }

    // Type chunk (1-3 chars at a time for speed)
    const chunk = text.slice(index, index + randomInt(1, 3));
    el.textContent += chunk;
    index += chunk.length;

    // Variable delay: pause longer on newlines and periods
    let delay = baseSpeed + randomInt(0, 12);
    const lastChar = chunk[chunk.length - 1];
    if (lastChar === '\n') delay += 80;
    else if (lastChar === '.') delay += 50;

    requestAnimationFrame(() => {
      setTimeout(typeNext, delay);
    });
  }

  // Small initial delay before starting
  setTimeout(typeNext, 400);
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}


// ── Smooth Scroll for Nav Links ───────────────────────────────
function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener('click', (e) => {
      const href = link.getAttribute('href');
      if (href === '#') return; // skip logo link

      const target = document.querySelector(href);
      if (!target) return;

      e.preventDefault();

      const navHeight = document.querySelector('.navbar')?.offsetHeight || 64;
      const top = target.getBoundingClientRect().top + window.scrollY - navHeight - 16;

      window.scrollTo({
        top,
        behavior: 'smooth',
      });
    });
  });
}


// ── Navbar background on scroll ───────────────────────────────
function initNavbarScroll() {
  const navbar = document.querySelector('.navbar');
  if (!navbar) return;

  const onScroll = () => {
    if (window.scrollY > 40) {
      navbar.style.borderBottomColor = 'rgba(118, 185, 0, 0.1)';
      navbar.style.background = 'rgba(10, 10, 10, 0.92)';
    } else {
      navbar.style.borderBottomColor = '';
      navbar.style.background = '';
    }
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}


// ── Live Inference (Image-based) ──────────────────────────────
function initLiveInference() {
  // Cosmos endpoint — configurable via ?endpoint= query param
  // Local: http://192.168.4.124:8000/v1/chat/completions
  // Tailscale: https://<jetson-hostname>:8000/v1/chat/completions
  const params = new URLSearchParams(window.location.search);
  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const COSMOS_URL = params.get('endpoint')
    || (isLocal
      ? 'http://192.168.4.124:8000/v1/chat/completions'
      : '/api/cosmos');  // Vercel proxy route (avoids mixed-content)

  const sportSelect = document.getElementById('live-sport');
  const promptInput = document.getElementById('live-prompt');
  const sendBtn = document.getElementById('live-send');
  const resultDiv = document.getElementById('live-result');
  const errorDiv = document.getElementById('live-error');
  const thinkingEl = document.getElementById('live-thinking');
  const answerEl = document.getElementById('live-answer');
  const latencyEl = document.getElementById('live-latency-val');
  const tokensEl = document.getElementById('live-tokens-val');
  const previewImg = document.getElementById('live-preview-img');
  const overlay = document.getElementById('live-overlay');
  const btnText = sendBtn?.querySelector('.live-btn-text');
  const btnSpinner = sendBtn?.querySelector('.live-btn-spinner');
  const fileInput = document.getElementById('live-upload');

  if (!sendBtn) return;

  const previewVideo = document.getElementById('live-preview-video');

  let currentImageBase64 = null;
  let cachedResults = null;
  let isCustomImage = false;
  let currentMediaType = 'image'; // 'image' or 'video'

  // Load pre-cached results
  fetch('samples/cached_results.json')
    .then((r) => r.json())
    .then((data) => { cachedResults = data; })
    .catch(() => { cachedResults = null; });

  // Sport-specific default prompts (for live inference on custom images)
  const defaultPrompts = {
    cricket: 'Analyze this cricket frame using DRS protocol. Check seam position, line and length, batsman stance and shot type. Identify the phase of play and any scoring event (dot, single, boundary 4/6, wicket). If LBW appeal possible, assess pitching, impact, and whether the ball is hitting the stumps.',
    tennis: 'Analyze this tennis frame using Hawk-Eye principles. Identify player court position, ball location relative to lines, shot type (forehand/backhand/serve/volley), and whether the ball is in or out. Note serve speed indicators and spin type if visible.',
    pickleball: 'Analyze this pickleball frame. Check player foot positions relative to the kitchen (NVZ) line for volley violations. Identify the shot type (dink, drive, third shot drop, erne, lob). Assess the double bounce rule and any service faults.',
    badminton: 'Analyze this badminton frame. Identify shuttlecock position and trajectory, shot type (smash, clear, drop, drive, net shot), and player positioning. Check service legality if serving (contact below 1.15m). Assess whether the shuttle is in or out.',
    tabletennis: 'Analyze this table tennis frame. Identify the stroke type (loop, push, chop, flick, block, smash) and spin (topspin, backspin, sidespin). Check ball position relative to the table edge — edge ball vs side contact. If serving, verify open palm, 16cm toss, and visibility.',
  };

  const deviceEl = document.getElementById('live-device-val');

  // ── Display result with typing animation ──
  function displayResult(thinking, answer, latency, tokens, animated, meta) {
    thinkingEl.textContent = '';
    answerEl.textContent = '';
    latencyEl.textContent = `${latency}s latency`;
    tokensEl.textContent = `${tokens} tokens`;

    // Show source: cached vs live Jetson
    if (meta?.source === 'live') {
      deviceEl.textContent = `Jetson AGX Orin (live)`;
      deviceEl.style.color = '#34d399'; // green — live
    } else if (meta?.source === 'cached') {
      deviceEl.textContent = `Pre-cached result`;
      deviceEl.style.color = '#fbbf24'; // amber — cached
    } else {
      deviceEl.textContent = 'Jetson AGX Orin';
      deviceEl.style.color = '';
    }

    resultDiv.style.display = 'block';

    if (animated && thinking) {
      // Typing animation for thinking
      let i = 0;
      const speed = 8;
      function typeThink() {
        if (i >= thinking.length) {
          answerEl.textContent = answer;
          resultDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          return;
        }
        const chunk = thinking.slice(i, i + randomInt(2, 5));
        thinkingEl.textContent += chunk;
        i += chunk.length;
        let delay = speed + randomInt(0, 6);
        if (chunk.includes('\n')) delay += 40;
        if (chunk.includes('.')) delay += 20;
        setTimeout(typeThink, delay);
      }
      setTimeout(typeThink, 200);
    } else {
      thinkingEl.textContent = thinking || '(no reasoning block)';
      answerEl.textContent = answer;
    }

    resultDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ── Show/hide preview elements ──
  function showPreview(type, src) {
    if (type === 'video') {
      previewImg.style.display = 'none';
      previewVideo.style.display = 'block';
      previewVideo.src = src;
      previewVideo.play().catch(() => {});
    } else {
      previewVideo.style.display = 'none';
      previewVideo.pause();
      previewImg.style.display = 'block';
      previewImg.src = src;
    }
  }

  // ── Video hover autoplay on thumbnails ──
  document.querySelectorAll('.live-sample--video').forEach((btn) => {
    const vid = btn.querySelector('video');
    if (!vid) return;
    btn.addEventListener('mouseenter', () => vid.play().catch(() => {}));
    btn.addEventListener('mouseleave', () => { vid.pause(); vid.currentTime = 0; });
  });

  // ── Sample selection (images + videos) ──
  document.querySelectorAll('.live-sample[data-src]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.live-sample').forEach((s) => s.classList.remove('active'));
      btn.classList.add('active');
      sportSelect.value = btn.dataset.sport;
      currentImageBase64 = null;
      isCustomImage = false;
      currentMediaType = btn.dataset.type || 'image';
      showPreview(currentMediaType, btn.dataset.src);
      resultDiv.style.display = 'none';
      errorDiv.style.display = 'none';
    });
  });

  // ── File upload (image or video) ──
  fileInput?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const isVideo = file.type.startsWith('video/');

    if (isVideo) {
      const url = URL.createObjectURL(file);
      currentMediaType = 'video';
      showPreview('video', url);
      currentImageBase64 = null; // will capture frame on analyze
      isCustomImage = true;
    } else {
      const reader = new FileReader();
      reader.onload = () => {
        currentMediaType = 'image';
        showPreview('image', reader.result);
        currentImageBase64 = reader.result.split(',')[1];
        isCustomImage = true;
      };
      reader.readAsDataURL(file);
    }

    document.querySelectorAll('.live-sample').forEach((s) => s.classList.remove('active'));
    document.querySelector('.live-sample--upload')?.classList.add('active');
    resultDiv.style.display = 'none';
    errorDiv.style.display = 'none';
  });

  // ── Extract frame from video as base64 JPEG ──
  function captureVideoFrame(videoEl) {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      canvas.width = videoEl.videoWidth || 480;
      canvas.height = videoEl.videoHeight || 360;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      resolve(dataUrl.split(',')[1]);
    });
  }

  // ── Get video as base64 data URL ──
  async function getVideoBase64() {
    // For sample videos, fetch the src
    const src = previewVideo.src || previewVideo.currentSrc;
    if (!src) return null;

    // If it's already a blob URL (from upload) or a relative path, fetch it
    const resp = await fetch(src);
    const blob = await resp.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result); // full data URL
      reader.readAsDataURL(blob);
    });
  }

  // ── Get base64 for current media ──
  async function getMediaContent() {
    // Video: send as video_url for multi-frame analysis
    if (currentMediaType === 'video') {
      const videoDataUrl = await getVideoBase64();
      if (videoDataUrl) {
        return { type: 'video', dataUrl: videoDataUrl };
      }
      // Fallback: capture a single frame
      if (previewVideo.readyState >= 2) {
        const b64 = await captureVideoFrame(previewVideo);
        return { type: 'image', base64: b64 };
      }
    }

    // Image: return base64
    if (currentImageBase64) {
      return { type: 'image', base64: currentImageBase64 };
    }

    // Fetch the sample image
    const resp = await fetch(previewImg.src);
    const blob = await resp.blob();
    const b64 = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result.split(',')[1]);
      reader.readAsDataURL(blob);
    });
    return { type: 'image', base64: b64 };
  }

  // ── Analyze button ──
  sendBtn.addEventListener('click', async () => {
    const sport = sportSelect.value;
    const customPrompt = promptInput.value.trim();

    // Use cached results for sample images (no custom prompt)
    if (!isCustomImage && !customPrompt && cachedResults && cachedResults[sport]) {
      const cached = cachedResults[sport];
      sendBtn.disabled = true;
      btnText.textContent = 'Loading...';
      overlay.style.display = 'flex';
      errorDiv.style.display = 'none';

      // Brief delay for visual feedback
      await new Promise((r) => setTimeout(r, 600));
      overlay.style.display = 'none';
      sendBtn.disabled = false;
      btnText.textContent = 'Analyze Frame';

      displayResult(cached.thinking, cached.answer, cached.latency_s, cached.tokens, true, { source: 'cached' });
      return;
    }

    // Live inference for custom images or custom prompts
    sendBtn.disabled = true;
    btnText.style.display = 'none';
    btnSpinner.style.display = 'inline-flex';
    overlay.style.display = 'flex';
    errorDiv.style.display = 'none';
    resultDiv.style.display = 'none';

    const prompt = customPrompt || defaultPrompts[sport] || defaultPrompts.cricket;
    const mediaLabel = currentMediaType === 'video' ? 'video' : 'image';
    const systemPrompt = `You are RefereAI, an expert ${sport} umpire powered by NVIDIA Cosmos Reason 2. Analyze the ${mediaLabel} using physical reasoning about ball trajectories, player positions, and game rules. Think step-by-step inside <think> tags, then give your final analysis.`;

    const start = performance.now();

    try {
      const media = await getMediaContent();

      // Build content parts based on media type
      const contentParts = [{ type: 'text', text: prompt }];
      if (media.type === 'video') {
        contentParts.push({ type: 'video_url', video_url: { url: media.dataUrl } });
      } else {
        contentParts.push({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + media.base64 } });
      }

      const headers = { 'Content-Type': 'application/json' };
      if (!isLocal && import.meta.env.VITE_COSMOS_KEY) headers['x-cosmos-key'] = import.meta.env.VITE_COSMOS_KEY;

      const response = await fetch(COSMOS_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: 'nvidia/cosmos-reason2-8b',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: contentParts },
          ],
          max_tokens: 512,
          temperature: 0.0,
        }),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}: ${errText.slice(0, 100)}`);
      }

      const data = await response.json();
      const elapsed = ((performance.now() - start) / 1000).toFixed(1);
      const raw = data.choices[0].message.content;
      const usage = data.usage || {};

      let thinking = '';
      let answer = raw;
      const thinkMatch = raw.match(/<think>([\s\S]*?)<\/think>/);
      if (thinkMatch) {
        thinking = thinkMatch[1].trim();
        answer = raw.slice(thinkMatch.index + thinkMatch[0].length).trim();
      }
      const ansMatch = answer.match(/<answer>([\s\S]*?)<\/answer>/);
      if (ansMatch) answer = ansMatch[1].trim();

      // Log observability metadata from proxy
      const proxyMeta = data._refereai || {};
      if (proxyMeta.request_id) {
        console.log(`[RefereAI] request_id=${proxyMeta.request_id} proxy=${proxyMeta.proxy_latency_ms}ms total=${elapsed}s tokens=${usage.total_tokens || '?'}`);
      }

      displayResult(thinking, answer, elapsed, usage.total_tokens || '?', true, { source: 'live', ...proxyMeta });
    } catch (err) {
      const hint = isLocal
        ? `Ensure the Jetson is reachable at ${COSMOS_URL}`
        : 'Live inference requires Jetson AGX Orin. Try a sample image to see cached Cosmos reasoning.';
      errorDiv.textContent = `Inference failed: ${err.message}. ${hint}`;
      errorDiv.style.display = 'block';
    } finally {
      sendBtn.disabled = false;
      btnText.style.display = 'inline';
      btnText.textContent = 'Analyze Frame';
      btnSpinner.style.display = 'none';
      overlay.style.display = 'none';
    }
  });
}


// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initSportTabs();
  initScrollAnimations();
  initTypingAnimation();
  initSmoothScroll();
  initNavbarScroll();
  initLiveInference();
});
