(() => {
  'use strict';

  const app = document.getElementById('app');
  const searchForm = document.getElementById('searchForm');
  const searchInput = document.getElementById('searchInput');
  const quickNav = document.getElementById('quickNav');
  const drawer = document.getElementById('drawer');
  const drawerMask = document.getElementById('drawerMask');
  const menuBtn = document.getElementById('menuBtn');
  const drawerClose = document.getElementById('drawerClose');
  const catNav = document.getElementById('catNav');
  const rankNav = document.getElementById('rankNav');

  const state = {
    navData: { categories: [], extras: [] },
    route: null,
    controller: null,
    navController: null,
    version: 0,
    canceledVersion: 0,
    lists: new Map(),
    detailContexts: new Map(),
    currentDetail: null,
    hls: null,
    art: null,
    mediaEvents: null,
    playerController: null,
    playerRecoveryUsed: false,
    playerTimer: null,
  };

  const esc = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const publicImage = (value) => {
    const url = String(value || '');
    if (/^https:\/\/madou\.casa\/covers\/[^"'\s]+$/.test(url)) return url;
    if (/^\/media\/image\/[A-Za-z0-9_-]+$/.test(url)) return url;
    return '';
  };

  async function request(url, { signal, method = 'GET' } = {}) {
    let response;
    try {
      response = await fetch(url, {
        method,
        signal,
        headers: { Accept: 'application/json' },
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      const networkError = new Error('网络连接异常，请稍后重试');
      networkError.status = 0;
      throw networkError;
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(
        payload?.error || (response.status >= 500 ? '服务暂时不可用' : '内容暂时无法加载'),
      );
      error.status = response.status;
      throw error;
    }
    return payload || {};
  }

  function parseHash() {
    const raw = (location.hash.replace(/^#/, '') || '/');
    const separator = raw.indexOf('?');
    const rawPath = separator >= 0 ? raw.slice(0, separator) : raw;
    const query = new URLSearchParams(separator >= 0 ? raw.slice(separator + 1) : '');
    let path;
    try {
      path = decodeURIComponent(rawPath || '/');
    } catch {
      path = '/';
    }
    if (path === '/' || path === '') return { name: 'home', page: Math.max(1, Number(query.get('page')) || 1) };
    if (path.startsWith('/category/')) return {
      name: 'category',
      slug: decodeURIComponent(path.slice('/category/'.length)),
      page: Math.max(1, Number(query.get('page')) || 1),
    };
    if (path.startsWith('/tag/')) return {
      name: 'tag',
      slug: decodeURIComponent(path.slice('/tag/'.length)),
      page: Math.max(1, Number(query.get('page')) || 1),
    };
    if (path.startsWith('/rank/')) return {
      name: 'rank',
      rank: decodeURIComponent(path.slice('/rank/'.length)),
      page: Math.max(1, Number(query.get('page')) || 1),
    };
    if (path.startsWith('/search')) return {
      name: 'search',
      q: query.get('q') || '',
      page: Math.max(1, Number(query.get('page')) || 1),
    };
    if (path.startsWith('/v/')) return { name: 'detail', path: path.slice(2) || '/' };
    if (/\.html?$/i.test(path) || path.split('/').filter(Boolean).length === 1) {
      return { name: 'detail', path: path.startsWith('/') ? path : `/${path}` };
    }
    return { name: 'home', page: 1 };
  }

  function linkTo(route) {
    if (route.name === 'home') return route.page > 1 ? `#/?page=${route.page}` : '#/';
    if (route.name === 'category') {
      const base = `#/category/${encodeURIComponent(route.slug)}`;
      return route.page > 1 ? `${base}?page=${route.page}` : base;
    }
    if (route.name === 'tag') {
      const base = `#/tag/${encodeURIComponent(route.slug)}`;
      return route.page > 1 ? `${base}?page=${route.page}` : base;
    }
    if (route.name === 'rank') {
      const base = `#/rank/${encodeURIComponent(route.rank)}`;
      return route.page > 1 ? `${base}?page=${route.page}` : base;
    }
    if (route.name === 'search') {
      const params = new URLSearchParams();
      if (route.q) params.set('q', route.q);
      if (route.page > 1) params.set('page', String(route.page));
      return `#/search${params.toString() ? `?${params}` : ''}`;
    }
    if (route.name === 'detail') return `#/v${route.path.startsWith('/') ? route.path : `/${route.path}`}`;
    return '#/';
  }

  function setDrawer(open) {
    drawer.classList.toggle('open', open);
    drawer.setAttribute('aria-hidden', open ? 'false' : 'true');
    drawerMask.hidden = !open;
    document.body.classList.toggle('drawer-open', open);
  }

  function destroyPlayer({ abortRequest = true } = {}) {
    window.clearTimeout(state.playerTimer);
    state.playerTimer = null;
    state.mediaEvents?.abort();
    state.mediaEvents = null;
    if (abortRequest) state.playerController?.abort();
    state.playerController = null;
    if (state.hls) {
      try { state.hls.destroy(); } catch {}
      state.hls = null;
    }
    if (state.art) {
      try { state.art.destroy(true); } catch {}
      state.art = null;
    }
    state.playerRecoveryUsed = false;
  }

  function skeletonGrid(count = 12) {
    return `<section class="content-grid skeleton-grid" aria-hidden="true">${Array.from({ length: count }, () => `
      <div class="skeleton-card"><div class="skeleton-media"></div><div class="skeleton-line"></div><div class="skeleton-line short"></div></div>`).join('')}</section>`;
  }

  function loadingState(message = '加载中') {
    return `<div class="inline-state loading-state"><span class="loader" aria-hidden="true"></span><span>${esc(message)}</span><button type="button" class="button" data-cancel-route>取消</button></div>`;
  }

  function emptyState(message) {
    return `<div class="empty-state"><strong>暂无内容</strong><span>${esc(message || '换一个条件试试')}</span></div>`;
  }

  function errorState(message, { title = '暂时无法加载', back = false } = {}) {
    return `<div class="error-state"><strong>${esc(title)}</strong><span>${esc(message || '请稍后重试')}</span>
      <div class="state-actions"><button type="button" class="button primary" data-retry-route>重试</button>${back ? '<button type="button" class="button" data-detail-back>返回列表</button>' : ''}</div>
    </div>`;
  }

  function imageMarkup(url, fallback = '封面不可用') {
    const source = publicImage(url);
    return `${source ? `<img src="${esc(source)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ''}<span class="image-fallback">${esc(fallback)}</span>`;
  }

  function wireImages(root = app) {
    root.querySelectorAll('[data-image-frame]').forEach((frame) => {
      const image = frame.querySelector('img');
      const loaded = () => { frame.classList.add('loaded'); frame.classList.remove('failed'); };
      const failed = () => { frame.classList.add('failed'); frame.classList.remove('loaded'); };
      if (!image) return failed();
      if (image.complete) return image.naturalWidth > 0 ? loaded() : failed();
      image.addEventListener('load', loaded, { once: true });
      image.addEventListener('error', failed, { once: true });
    });
  }

  function cardHTML(item, listKey = '', index = -1) {
    const path = item.path || '';
    const href = linkTo({ name: 'detail', path });
    return `<a class="content-card" href="${esc(href)}" data-link data-card-path="${esc(path)}" data-list-key="${esc(listKey)}" data-index="${index}">
      <div class="card-media" data-image-frame>${imageMarkup(item.cover)}${item.badge ? `<span class="card-badge">${esc(item.badge)}</span>` : ''}<span class="card-play" aria-hidden="true">▶</span></div>
      <h2 class="card-title">${esc(item.title || '未命名内容')}</h2>
      <div class="card-meta"><span>${item.views ? `观看 ${esc(item.views)}` : ''}</span><span>${item.likes ? `♥ ${esc(item.likes)}` : ''}</span></div>
    </a>`;
  }

  function quickCategories(activeSlug = '') {
    const categories = state.navData.categories.slice(0, 12);
    return `<nav class="quick-categories" aria-label="快捷分类"><a class="nav-item${activeSlug ? '' : ' active'}" href="#/" data-link>全部</a>${categories.map((category) => `
      <a class="nav-item${activeSlug === category.slug ? ' active' : ''}" href="${esc(linkTo({ name: 'category', slug: category.slug, page: 1 }))}" data-link>${esc(category.name)}</a>`).join('')}</nav>`;
  }

  function renderNav() {
    const ranks = [
      { name: '首页', href: '#/' },
      ...state.navData.extras.map((extra) => ({
        name: extra.name,
        href: linkTo({ name: 'rank', rank: String(extra.path || extra.slug || '').replace(/^\//, ''), page: 1 }),
      })),
    ];
    rankNav.innerHTML = ranks.map((item) => `<a class="chip" href="${esc(item.href)}" data-link>${esc(item.name)}</a>`).join('');
    catNav.innerHTML = state.navData.categories.map((category) => `<a href="${esc(linkTo({ name: 'category', slug: category.slug, page: 1 }))}" data-link>${esc(category.name)}</a>`).join('');
    quickNav.innerHTML = quickCategories(parseHash().slug || '');
  }

  async function loadNav() {
    state.navController?.abort();
    state.navController = new AbortController();
    try {
      const data = await request('/api/nav', { signal: state.navController.signal });
      state.navData = {
        categories: Array.isArray(data.categories) ? data.categories : [],
        extras: Array.isArray(data.extras) ? data.extras : [],
      };
    } catch (error) {
      if (error?.name !== 'AbortError') {
        state.navData = { categories: [], extras: [] };
      }
    } finally {
      renderNav();
    }
  }

  function pagerHTML(route, page, nextPage, prevPage) {
    const previous = prevPage || (page > 1 ? page - 1 : 0);
    const next = nextPage || 0;
    return `<nav class="pager" aria-label="分页"><a class="button${previous ? '' : ' disabled'}" href="${esc(previous ? linkTo({ ...route, page: previous }) : '#')}" data-link ${previous ? '' : 'aria-disabled="true"'}>上一页</a><span>${page} 页</span><a class="button${next ? '' : ' disabled'}" href="${esc(next ? linkTo({ ...route, page: next }) : '#')}" data-link ${next ? '' : 'aria-disabled="true"'}>下一页</a></nav>`;
  }

  async function renderList(route, title, query, signal, version) {
    document.title = `${title} · 麻豆社`;
    app.innerHTML = `<header class="page-head"><div><h1>${esc(title)}</h1><span class="page-meta">浏览目录</span></div></header>${route.name === 'home' || route.name === 'category' ? quickCategories(route.slug || '') : ''}${skeletonGrid()}${loadingState()}`;
    const params = new URLSearchParams({ page: String(route.page || 1) });
    Object.entries(query).forEach(([key, value]) => { if (value) params.set(key, value); });
    try {
      const data = await request(`/api/list?${params}`, { signal });
      if (version !== state.version || signal.aborted) return;
      const items = Array.isArray(data.items) ? data.items : [];
      const page = Number(data.page || route.page || 1);
      const listKey = `${route.name}:${JSON.stringify(query)}:${page}`;
      state.lists.set(listKey, items);
      const heading = `<header class="page-head"><div><h1>${esc(title)}</h1><span class="page-meta">第 ${page} 页 · ${items.length} 部</span></div></header>`;
      app.innerHTML = `${heading}${route.name === 'home' || route.name === 'category' ? quickCategories(route.slug || '') : ''}${items.length ? `<section class="content-grid">${items.map((item, index) => cardHTML(item, listKey, index)).join('')}</section>${pagerHTML(route, page, data.nextPage, data.prevPage)}` : emptyState('没有找到相关内容')}`;
      wireImages();
      window.scrollTo({ top: 0, behavior: 'auto' });
    } catch (error) {
      if (error?.name === 'AbortError' || version !== state.version || state.canceledVersion === version) return;
      app.innerHTML = errorState(error.message || '列表暂时不可用');
    }
  }

  function queueHTML(context, currentPath) {
    const list = Array.isArray(context?.list) ? context.list : [];
    if (!list.length) return '';
    return `<aside class="related-panel"><header class="related-head"><h2>同列表</h2><span>${list.length}</span></header><div class="related-list">${list.map((item, index) => `
      <a class="related-item${item.path === currentPath ? ' active' : ''}" href="${esc(linkTo({ name: 'detail', path: item.path }))}" data-link data-card-path="${esc(item.path)}" data-list-key="${esc(context.listKey || '')}" data-index="${index}">
        <div class="related-poster" data-image-frame>${imageMarkup(item.cover)}</div><div class="related-copy"><h3>${esc(item.title || '未命名内容')}</h3><span>${esc(item.views || '')}</span></div>
      </a>`).join('')}</div></aside>`;
  }

  function detailSkeleton() {
    return `<button type="button" class="button back-button" data-detail-back>← 返回</button><div class="detail-layout"><section class="detail-main"><div class="player-shell player-skeleton"><div class="skeleton-media"></div></div><div class="detail-copy"><div class="skeleton-line"></div><div class="skeleton-line short"></div></div></section><aside class="related-panel detail-related-skeleton"><header class="related-head"><h2>同列表</h2></header>${Array.from({ length: 6 }, () => '<div class="skeleton-line"></div>').join('')}</aside></div>`;
  }

  function playerHTML() {
    return `<div class="player-shell"><div class="art-player" id="art-player"></div><div class="player-feedback" id="playerFeedback"><div class="feedback-label"><span class="loader" aria-hidden="true"></span><span>正在加载</span><button type="button" class="button" data-player-cancel>取消</button></div></div></div>`;
  }

  function playerFeedback(message, mode = 'loading') {
    const box = document.getElementById('playerFeedback');
    if (!box) return;
    if (!message) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    box.hidden = false;
    box.innerHTML = mode === 'error'
      ? `<div class="feedback-label error-label"><span>${esc(message)}</span><button type="button" class="button" data-player-retry>重试</button></div>`
      : `<div class="feedback-label"><span class="loader" aria-hidden="true"></span><span>${esc(message)}</span><button type="button" class="button" data-player-cancel>取消</button></div>`;
  }

  function attachHls(video, url, art) {
    if (!window.Hls || !window.Hls.isSupported()) {
      if (video.canPlayType('application/vnd.apple.mpegurl')) video.src = url;
      else throw new Error('当前浏览器不支持 HLS 播放');
      return;
    }
    const hls = new window.Hls({
      enableWorker: true,
      lowLatencyMode: false,
      maxBufferLength: 24,
      maxMaxBufferLength: 48,
      backBufferLength: 30,
      manifestLoadingTimeOut: 12_000,
      levelLoadingTimeOut: 12_000,
      fragLoadingTimeOut: 20_000,
    });
    state.hls = hls;
    hls.on(window.Hls.Events.MEDIA_ATTACHED, () => {
      if (state.hls === hls) hls.loadSource(url);
    });
    hls.on(window.Hls.Events.MANIFEST_PARSED, () => playerFeedback(''));
    hls.on(window.Hls.Events.ERROR, (_event, data) => {
      if (!data?.fatal) return;
      if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR && !state.playerRecoveryUsed) {
        state.playerRecoveryUsed = true;
        playerFeedback('网络波动，正在重连');
        hls.startLoad();
        return;
      }
      playerFeedback('播放失败，请重试', 'error');
    });
    art.on('destroy', () => {
      if (state.hls === hls) state.hls = null;
      try { hls.destroy(); } catch {}
    });
    hls.attachMedia(video);
  }

  async function attachPlayer(shareId, poster) {
    destroyPlayer();
    const controller = new AbortController();
    state.playerController = controller;
    playerFeedback('正在解析播放地址');
    try {
      const play = await request(`/api/play/${encodeURIComponent(shareId)}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (!play.m3u8) throw new Error('播放地址暂时不可用');
      const image = publicImage(poster);
      if (!window.Artplayer) throw new Error('播放器加载失败，请刷新页面');
      playerFeedback('正在准备播放');
      const art = new window.Artplayer({
        container: '#art-player',
        url: play.m3u8,
        type: 'm3u8',
        poster: image || '',
        autoplay: false,
        autoPlayback: false,
        volume: .8,
        theme: '#d6dadd',
        hotkey: true,
        pip: true,
        mutex: true,
        setting: true,
        playbackRate: true,
        fullscreen: true,
        fullscreenWeb: true,
        miniProgressBar: true,
        lock: true,
        playsInline: true,
        moreVideoAttr: { preload: 'metadata', playsInline: true },
        customType: { m3u8: attachHls },
      });
      state.art = art;
      const video = art.video;
      const ready = () => {
        window.clearTimeout(state.playerTimer);
        state.playerTimer = null;
        playerFeedback('');
      };
      state.mediaEvents = new AbortController();
      const options = { signal: state.mediaEvents.signal };
      video.addEventListener('loadstart', () => playerFeedback('正在加载'), options);
      video.addEventListener('loadedmetadata', ready, options);
      video.addEventListener('canplay', ready, options);
      video.addEventListener('playing', ready, options);
      video.addEventListener('waiting', () => {
        playerFeedback('正在缓冲');
        window.clearTimeout(state.playerTimer);
        state.playerTimer = window.setTimeout(() => {
          if (video.readyState < 3) playerFeedback('等待时间较长，请重试', 'error');
        }, 18_000);
      }, options);
      video.addEventListener('seeking', () => playerFeedback('正在定位'), options);
      video.addEventListener('seeked', ready, options);
      video.addEventListener('error', () => {
        if (!state.hls) playerFeedback('播放失败，请重试', 'error');
      }, options);
      art.on('ready', ready);
      if (video.readyState >= 3) ready();
    } catch (error) {
      if (error?.name === 'AbortError') return;
      destroyPlayer({ abortRequest: false });
      playerFeedback(error.message || '播放地址暂时不可用', 'error');
    }
  }

  function detailMeta(data) {
    return [data.views ? `观看 ${data.views}` : '', data.likes ? `点赞 ${data.likes}` : '', data.date || '']
      .filter(Boolean).map((value) => `<span>${esc(value)}</span>`).join('');
  }

  function detailTags(data) {
    const categories = (data.categories || []).map((item) => `<a class="tag" href="${esc(linkTo({ name: 'category', slug: item.slug, page: 1 }))}" data-link>${esc(item.name)}</a>`);
    const tags = (data.tags || []).map((item) => `<a class="tag" href="${esc(linkTo({ name: 'tag', slug: item.slug, page: 1 }))}" data-link>${esc(item.name)}</a>`);
    return [...categories, ...tags].join('');
  }

  function relatedHTML(items) {
    if (!Array.isArray(items) || !items.length) return '';
    return `<section class="detail-related"><header class="section-head"><h2>相关推荐</h2></header><div class="content-grid">${items.slice(0, 10).map((item, index) => cardHTML(item, 'detail-related', index)).join('')}</div></section>`;
  }

  async function renderDetail(route, signal, version) {
    destroyPlayer();
    document.title = '加载中 · 麻豆社';
    app.innerHTML = detailSkeleton();
    try {
      const data = await request(`/api/detail?path=${encodeURIComponent(route.path)}`, { signal });
      if (version !== state.version || signal.aborted) return;
      const context = state.detailContexts.get(location.hash) || {};
      state.currentDetail = { route, data, context };
      document.title = `${data.title || '详情'} · 麻豆社`;
      const player = data.shareId ? playerHTML() : '<div class="player-shell"><div class="detail-unavailable">未找到可用播放器</div></div>';
      app.innerHTML = `<button type="button" class="button back-button" data-detail-back>← 返回</button><div class="detail-layout"><section class="detail-main">${player}<div class="detail-copy"><h1>${esc(data.title)}</h1><div class="detail-meta">${detailMeta(data)}</div><div class="tag-list">${detailTags(data)}</div>${data.metaText ? `<p class="description">${esc(data.metaText)}</p>` : ''}<div class="detail-actions"><button type="button" class="button primary" data-player-retry${data.shareId ? '' : ' disabled'}>重新加载播放</button></div><div class="nav-pair"><a class="nav-card${data.prev ? '' : ' disabled'}" href="${esc(data.prev ? linkTo({ name: 'detail', path: data.prev.path }) : '#')}" data-link><span>上一部</span><strong>${esc(data.prev?.title || '没有了')}</strong></a><a class="nav-card${data.next ? '' : ' disabled'}" href="${esc(data.next ? linkTo({ name: 'detail', path: data.next.path }) : '#')}" data-link><span>下一部</span><strong>${esc(data.next?.title || '没有了')}</strong></a></div></div></section>${queueHTML(context, route.path)}</div>${relatedHTML(data.related)}`;
      wireImages();
      window.scrollTo({ top: 0, behavior: 'auto' });
      if (data.shareId) await attachPlayer(data.shareId, data.cover);
    } catch (error) {
      if (error?.name === 'AbortError' || version !== state.version || state.canceledVersion === version) return;
      app.innerHTML = `<button type="button" class="button back-button" data-detail-back>← 返回</button>${errorState(error.message || '详情暂时不可用')}`;
    }
  }

  function openDetail(path, listKey, index) {
    if (!path) return;
    const list = state.lists.get(listKey) || [];
    const hash = linkTo({ name: 'detail', path });
    state.detailContexts.set(hash, { listKey, list, index });
    if (location.hash === hash.slice(1)) return route();
    location.hash = hash.slice(1);
  }

  function cancelCurrentRequest() {
    if (!state.controller) return;
    state.canceledVersion = state.version;
    state.controller.abort();
    destroyPlayer();
    app.innerHTML = errorState('已取消当前请求', { title: '加载已取消' });
  }

  async function route() {
    state.controller?.abort();
    destroyPlayer();
    state.controller = new AbortController();
    state.version += 1;
    state.canceledVersion = 0;
    const version = state.version;
    const next = parseHash();
    state.route = next;
    renderNav();
    if (next.name === 'home') return renderList(next, '最新更新', {}, state.controller.signal, version);
    if (next.name === 'category') {
      const category = state.navData.categories.find((item) => item.slug === next.slug);
      return renderList(next, category?.name || next.slug, { category: next.slug }, state.controller.signal, version);
    }
    if (next.name === 'tag') return renderList(next, `# ${next.slug}`, { tag: next.slug }, state.controller.signal, version);
    if (next.name === 'rank') {
      const labels = { likes: '点赞排行', week: '7天热门', month: '30天热门' };
      return renderList(next, labels[next.rank] || next.rank, { rank: next.rank }, state.controller.signal, version);
    }
    if (next.name === 'search') {
      searchInput.value = next.q || '';
      return renderList(next, next.q ? `搜索：${next.q}` : '搜索', { q: next.q }, state.controller.signal, version);
    }
    if (next.name === 'detail') return renderDetail(next, state.controller.signal, version);
    return renderList({ name: 'home', page: 1 }, '最新更新', {}, state.controller.signal, version);
  }

  searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const q = searchInput.value.trim();
    location.hash = q ? `/search?q=${encodeURIComponent(q)}` : '/';
    setDrawer(false);
  });
  menuBtn.addEventListener('click', () => setDrawer(true));
  drawerClose.addEventListener('click', () => setDrawer(false));
  drawerMask.addEventListener('click', () => setDrawer(false));

  document.addEventListener('click', (event) => {
    const cancel = event.target.closest('[data-cancel-route]');
    if (cancel) {
      event.preventDefault();
      cancelCurrentRequest();
      return;
    }
    const card = event.target.closest('[data-card-path]');
    if (card) {
      event.preventDefault();
      openDetail(card.dataset.cardPath, card.dataset.listKey || '', Number(card.dataset.index));
      setDrawer(false);
      return;
    }
    if (event.target.closest('[data-retry-route]')) {
      event.preventDefault();
      route();
      return;
    }
    if (event.target.closest('[data-detail-back]')) {
      event.preventDefault();
      history.length > 1 ? history.back() : (location.hash = '/');
      return;
    }
    if (event.target.closest('[data-player-cancel]')) {
      event.preventDefault();
      state.playerController?.abort();
      playerFeedback('已取消播放解析', 'error');
      return;
    }
    if (event.target.closest('[data-player-retry]') && state.currentDetail?.data?.shareId) {
      event.preventDefault();
      attachPlayer(state.currentDetail.data.shareId, state.currentDetail.data.cover);
    }
    if (event.target.closest('a[data-link]')) setDrawer(false);
  });

  window.addEventListener('hashchange', route);
  renderNav();
  loadNav();
  route();
})();
