const UPSTREAM = "https://madou.casa";
const DASH = "https://dash.madou.casa";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const PREFIX = "(?:madou_casa-)?";

const CACHE_TTL = 300;

async function fetchHTML(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      "Accept-Language": "zh-CN,zh;q=0.9",
      Accept: "text/html,application/xhtml+xml",
    },
    cf: { cacheTtl: CACHE_TTL, cacheEverything: true },
  });
  if (!res.ok) throw new Error("upstream " + res.status);
  return await res.text();
}

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function parseItems(html) {
  const items = [];
  const re = new RegExp(`<article class="${PREFIX}excerpt[^"]*"[\\s\\S]*?<\\/article>`, "g");
  let m;
  while ((m = re.exec(html))) {
    const b = m[0];
    const href = (b.match(/href="(https:\/\/madou\.casa\/[^"]+\.html)"/) || [])[1] || "";
    if (!href) continue;
    const title = (b.match(/<h2[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/) || [])[1] || "";
    const cover = (b.match(/data-src="([^"]+)"/) || [])[1] || "";
    const pid = (b.match(/data-pid="(\d+)"/) || [])[1] || "";
    const likes = (b.match(/etap="like"[\s\S]*?<span[^>]*>([^<]*)</) || [])[1] || "";
    const badge = (b.match(new RegExp(`class="${PREFIX}hot"[^>]*>([^<]*)<`)) || [])[1] || "";
    const views = (b.match(/post-view"[^>]*>([^<]*)</) || [])[1] || "";
    items.push({
      id: pid || "",
      title: esc(title.trim()),
      path: href.replace("https://madou.casa", ""),
      cover,
      views: (views.match(/观看\(([^)]+)\)/) || [])[1] || views.trim(),
      likes: likes.trim(),
      badge: badge.trim(),
    });
  }
  return items;
}

function parseNav(html) {
  const seen = new Set();
  const cats = [];
  const re = /href="https:\/\/madou\.casa\/category\/([^"]+)"[^>]*>([^<]{1,40})<\/a>/g;
  let m;
  while ((m = re.exec(html))) {
    const slug = decodeURIComponent(m[1]);
    if (seen.has(slug)) continue;
    seen.add(slug);
    cats.push({ name: m[2].trim(), slug, path: "/category/" + encodeURIComponent(slug) });
  }
  return {
    categories: cats,
    extras: [
      { name: "点赞排行", slug: "_likes", path: "/likes", kind: "rank" },
      { name: "7天热门", slug: "_week", path: "/week", kind: "rank" },
      { name: "30天热门", slug: "_month", path: "/month", kind: "rank" },
    ],
  };
}

function hasNextPage(html) {
  const re = /<a[^>]+href="([^"]*page[^"]*)"[^>]*>下一页<\/a>/;
  return re.test(html);
}

function parseDetail(html, path) {
  const h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || "";
  const art = html.match(new RegExp(`<article class="${PREFIX}article-content"[\\s\\S]*?<\\/article>`)) || [""];
  const share = (art[0].match(/dash\.madou\.casa\/share\/([a-f0-9]+)/) || [])[1] || "";
  const tagsSec = html.match(new RegExp(`<div class="${PREFIX}article-tags"[\\s\\S]*?<\\/div>`)) || [""];
  const tags = [];
  const tre = /href="https:\/\/madou\.casa\/tag\/([^"]+)"[^>]*>([^<]*)<\/a>/g;
  let t;
  while ((t = tre.exec(tagsSec[0]))) {
    const slug = decodeURIComponent(t[1]);
    tags.push({ name: t[2].trim(), slug, path: "/tag/" + encodeURIComponent(slug) });
  }
  const cats = [];
  const cre = /href="https:\/\/madou\.casa\/category\/([^"]+)"[^>]*rel="category tag"[^>]*>([^<]*)<\/a>/g;
  let c;
  while ((c = cre.exec(html))) {
    const slug = decodeURIComponent(c[1]);
    cats.push({ name: c[2].trim(), slug });
  }
  const prev = (html.match(new RegExp(`${PREFIX}article-nav-prev">[\\s\\S]*?<a[^>]+href="(https:\\/\\/madou\\.casa\\/[^"]+\\.html)"[^>]*>([^<]+)</a>`)) || []);
  const next = (html.match(new RegExp(`${PREFIX}article-nav-next">[\\s\\S]*?<a[^>]+href="(https:\\/\\/madou\\.casa\\/[^"]+\\.html)"[^>]*>([^<]+)</a>`)) || []);
  const views = (html.match(/观看\(([^)]+)\)/) || [])[1] || "";
  const likes = (html.match(new RegExp(`${PREFIX}action-like"[^>]*data-pid="\\d+"[^>]*>[\\s\\S]*?赞\\(<span>([^<]*)</span>`)) || [])[1] || "";
  const covers = [...new Set([...html.matchAll(/https:\/\/madou\.casa\/covers\/[^"')\s]+/g)].map((x) => x[0]))];
  const cover = covers.find((u) => !/-\d+x\d+\.(jpe?g|png|webp)$/.test(u)) || covers[0] || "";
  const catName = cats.map((x) => x.name).join("、");
  return {
    title: h1.trim(),
    path,
    shareId: share,
    cover,
    tags,
    categories: cats,
    views,
    likes,
    date: "",
    metaText: [catName ? `分类：${catName}` : "", views ? `观看(${views})` : ""].filter(Boolean).join(" "),
    prev: prev[2] ? { title: prev[2].trim(), path: prev[1].replace("https://madou.casa", "") } : null,
    next: next[2] ? { title: next[2].trim(), path: next[1].replace("https://madou.casa", "") } : null,
    related: [],
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=60" },
  });
}

async function handleList(url) {
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const params = new URLSearchParams();
  const upstream = new URL(UPSTREAM);
  let hasRank = false;
  for (const [k, v] of url.searchParams) {
    if (k === "page") continue;
    params.set(k, v);
  }
  if (params.get("rank")) {
    upstream.pathname = "/" + encodeURIComponent(params.get("rank"));
    hasRank = true;
  } else if (params.get("category")) {
    upstream.pathname = "/category/" + encodeURIComponent(params.get("category")) + (page > 1 ? "/page/" + page : "");
  } else if (params.get("tag")) {
    upstream.pathname = "/tag/" + encodeURIComponent(params.get("tag")) + (page > 1 ? "/page/" + page : "");
  } else if (params.get("q")) {
    upstream.pathname = page > 1 ? "/page/" + page : "/";
    upstream.searchParams.set("s", params.get("q"));
  } else {
    upstream.pathname = page > 1 ? "/page/" + page : "/";
  }
  let html;
  try {
    html = await fetchHTML(upstream.toString());
  } catch {
    return json({ error: "内容源暂时不可用" }, 502);
  }
  const items = parseItems(html);
  const nextPage = hasRank ? 0 : hasNextPage(html) ? page + 1 : 0;
  return json({ items, page, nextPage, prevPage: page > 1 ? page - 1 : 0 });
}

async function handleDetail(url) {
  const path = url.searchParams.get("path") || "";
  if (!path || !path.endsWith(".html")) return json({ error: "请求参数无效" }, 400);
  let html;
  try {
    html = await fetchHTML(UPSTREAM + path);
  } catch {
    return json({ error: "内容源暂时不可用" }, 502);
  }
  return json(parseDetail(html, path));
}

async function handlePlay(url, id) {
  if (!/^[a-f0-9]{24}$/.test(id)) return json({ error: "请求参数无效" }, 400);
  return json({
    shareId: id,
    title: "",
    m3u8: `${DASH}/videos/${id}/index.m3u8`,
  });
}

async function handleNav() {
  let html;
  try {
    html = await fetchHTML(UPSTREAM + "/");
  } catch {
    return json({ error: "内容源暂时不可用" }, 502);
  }
  return json(parseNav(html));
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === "/api/nav") return handleNav();
    if (pathname === "/api/list") return handleList(url);
    if (pathname === "/api/detail") return handleDetail(url);
    if (pathname.startsWith("/api/play/")) return handlePlay(url, pathname.slice("/api/play/".length));
    if (pathname === "/api/health") return json({ ok: true });

    return new Response("Not Found", { status: 404 });
  },
};
