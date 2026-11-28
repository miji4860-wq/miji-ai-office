// Miji AI Office — Notion hub relay (Vercel serverless)
// GET  /api/hub  -> assistant table, request board, latest meeting agenda + opinions
// POST /api/hub  -> { action: "instruction" | "agenda" | "memo", text, title? }

const NOTION_VERSION = "2022-06-28";
const HUB_PAGE_ID = process.env.HUB_PAGE_ID || "42588732-2916-814c-82dd-cce3cc72ffb0";
const NOTION_TOKEN = process.env.NOTION_TOKEN || "";
const OFFICE_KEY = process.env.OFFICE_KEY || "";

const ALLOWED_ORIGINS = [
  "https://miji4860-wq.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000"
];

const MEMBERS = ["초연", "담연", "부이", "키링", "뮤즈"];

function corsHeaders(origin) {
  const isVercel = /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin || "");
  const allow = ALLOWED_ORIGINS.includes(origin) || isVercel ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Office-Key",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function textOf(block) {
  const node = block[block.type] || {};
  const rt = node.rich_text || node.title || [];
  return rt.map((r) => r.plain_text || "").join("");
}

async function notion(path, method = "GET", body) {
  if (!NOTION_TOKEN) throw new Error("NOTION_TOKEN is not configured");
  const res = await fetch("https://api.notion.com/v1" + path, {
    method,
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (json && json.message) || `Notion API ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return json;
}

async function listChildren(blockId) {
  const out = [];
  let cursor;
  for (let i = 0; i < 10; i++) {
    const q = `?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`;
    const res = await notion(`/blocks/${blockId}/children${q}`);
    out.push(...(res.results || []));
    if (!res.has_more) break;
    cursor = res.next_cursor;
  }
  return out;
}

function statusNormalize(raw) {
  const s = String(raw || "").trim();
  if (!s) return "대기";
  return s;
}

function authorOf(text) {
  const bracket = text.match(/\[(초연|담연|부이|키링|뮤즈)\]/);
  if (bracket) return bracket[1];
  const handled = text.match(/(초연|담연|부이|키링|뮤즈)\s*(?:처리|의견)/);
  if (handled) return handled[1];
  const any = text.match(/(초연|담연|부이|키링|뮤즈)/);
  return any ? any[1] : "기타";
}

function cleanOpinion(text) {
  return text
    .replace(/^✅\s*/, "")
    .replace(/^(초연|담연|부이|키링|뮤즈)\s*처리\s*\([^)]*\)\s*:?\s*/, "")
    .replace(/^\[(초연|담연|부이|키링|뮤즈)\]\s*(\([^)]*\))?\s*:?\s*/, "")
    .replace(/^안건\s*#?\d*\s*/, "")
    .trim();
}

// Split the hub page into top-level sections: a heading_2 up to the next heading_2
// (heading_3 sub-sections stay inside, so the request board keeps its groups).
function sections(blocks) {
  const marks = [];
  blocks.forEach((b, i) => {
    if (b.type === "heading_2") marks.push({ i, text: textOf(b) });
  });
  return marks.map((m, k) => {
    const end = k + 1 < marks.length ? marks[k + 1].i : blocks.length;
    return { i: m.i, text: m.text, body: blocks.slice(m.i + 1, end) };
  });
}

function parseMembers(tableRows) {
  const rows = tableRows.map((r) =>
    (r.table_row && r.table_row.cells ? r.table_row.cells : []).map((cell) =>
      (cell || []).map((t) => t.plain_text || "").join("")
    )
  );
  if (!rows.length) return [];
  const header = rows[0].map((c) => c.trim());
  const iName = header.findIndex((h) => h.includes("이름"));
  const iRole = header.findIndex((h) => h.includes("담당") || h.includes("역할"));
  const iStatus = header.findIndex((h) => h.includes("상태"));
  return rows.slice(1).filter((r) => (r[iName] || "").trim()).map((r) => {
    const rawName = (iName >= 0 ? r[iName] : r[0]) || "";
    const name = MEMBERS.find((m) => rawName.includes(m)) || rawName.replace(/[^\uAC00-\uD7A3A-Za-z]/g, "");
    return {
      name,
      label: rawName.trim(),
      role: ((iRole >= 0 ? r[iRole] : r[1]) || "").trim(),
      status: statusNormalize(iStatus >= 0 ? r[iStatus] : r[2])
    };
  });
}

function parseBoard(sec) {
  const items = [];
  let group = "";
  for (const b of sec.body) {
    if (b.type === "heading_3") {
      group = textOf(b);
      continue;
    }
    if (b.type === "to_do") {
      items.push({
        group,
        text: textOf(b),
        done: !!(b.to_do && b.to_do.checked),
        id: b.id
      });
    }
  }
  return items;
}

function parseMeeting(allSecs) {
  // latest agenda: the last heading_2 whose text includes '📣'
  const agendaSecs = allSecs.filter((s) => s.text.includes("📣"));
  if (!agendaSecs.length) return null;
  const sec = agendaSecs[agendaSecs.length - 1];
  const title = sec.text.replace(/^[📣\s]+/, "").trim();
  const requests = [];
  const opinions = [];
  let inOpinions = false;
  for (const b of sec.body) {
    if (b.type === "heading_3") {
      if (textOf(b).includes("각자 의견")) inOpinions = true;
      continue;
    }
    if (!["bulleted_list_item", "paragraph", "numbered_list_item", "to_do"].includes(b.type)) continue;
    const t = textOf(b).trim();
    if (!t) continue;
    if (inOpinions) {
      opinions.push({ author: authorOf(t), text: cleanOpinion(t), raw: t, id: b.id });
    } else if (authorOf(t) !== "기타" && /\[(초연|담연|부이|키링|뮤즈)\]|(초연|담연|부이|키링|뮤즈)\s*처리/.test(t)) {
      // an opinion posted above the '💬 각자 의견' heading
      opinions.push({ author: authorOf(t), text: cleanOpinion(t), raw: t, id: b.id });
    } else {
      requests.push({ text: t, id: b.id });
    }
  }
  // keep only the newest opinion per author, for the five assistants
  const latest = {};
  for (const o of opinions) {
    if (MEMBERS.includes(o.author)) latest[o.author] = o;
  }
  return {
    title,
    requests,
    opinions: Object.values(latest),
    opinionCount: opinions.length
  };
}

function kstNow() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return {
    date: `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`,
    time: `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
  };
}

async function buildHub() {
  const blocks = await listChildren(HUB_PAGE_ID);
  const secs = sections(blocks);

  const tableBlock = blocks.find((b) => b.type === "table");
  const tableRows = tableBlock && tableBlock.has_children ? await listChildren(tableBlock.id) : [];
  const members = parseMembers(tableRows);

  const boardSec = secs.find((s) => s.text.includes("공용 요청 보드"));
  const board = boardSec ? parseBoard(boardSec) : [];

  const meeting = parseMeeting(secs);

  const memoSec = secs.find((s) => s.text.includes("비서 간 메모"));
  const memos = memoSec
    ? memoSec.body
        .filter((b) => b.type === "bulleted_list_item")
        .map((b) => ({ text: textOf(b), id: b.id }))
        .slice(-5)
    : [];

  const page = await notion(`/pages/${HUB_PAGE_ID}`);

  return {
    ok: true,
    hub: {
      pageId: HUB_PAGE_ID,
      url: page.url || "https://www.notion.so/" + HUB_PAGE_ID.replace(/-/g, ""),
      updatedAt: page.last_edited_time,
      fetchedAt: new Date().toISOString()
    },
    members,
    board: {
      pending: board.filter((i) => !i.done && (/대기/.test(i.group) || !i.group)),
      doing: board.filter((i) => !i.done && /진행/.test(i.group)),
      done: board.filter((i) => i.done || /완료/.test(i.group))
    },
    meeting,
    memos
  };
}

function rt(text, link) {
  return [
    {
      type: "text",
      text: link ? { content: text, link: { url: link } } : { content: text }
    }
  ];
}

async function findAnchor(blocks, secs, matcher) {
  const sec = secs.find(matcher);
  if (!sec) return null;
  // last block of the section body
  for (let i = sec.body.length - 1; i >= 0; i--) return sec.body[i].id;
  return null;
}

async function handlePost(body) {
  const action = body.action || "memo";
  const text = String(body.text || "").trim().slice(0, 1900);
  if (!text) {
    const e = new Error("text is required");
    e.status = 400;
    throw e;
  }
  const now = kstNow();
  const blocks = await listChildren(HUB_PAGE_ID);
  const secs = sections(blocks);
  const children = [];

  if (action === "agenda") {
    const title = String(body.title || text.split("\n")[0]).trim().slice(0, 180);
    children.push({
      object: "block",
      type: "heading_2",
      heading_2: { rich_text: rt(`📣 비서실 회의 안건: ${title} (${now.date})`) }
    });
    children.push({
      object: "block",
      type: "bulleted_list_item",
      bulleted_list_item: { rich_text: rt(`요청 (미지 님 · 지휘실): ${text}`) }
    });
    children.push({
      object: "block",
      type: "bulleted_list_item",
      bulleted_list_item: { rich_text: rt("[각 비서]: 아래 💬 각자 의견에 담당 관점 의견을 남겨 주세요.") }
    });
    children.push({
      object: "block",
      type: "heading_3",
      heading_3: { rich_text: rt("💬 각자 의견") }
    });
    // keep agenda sections above the memo section when one exists
    const memoIdx = blocks.findIndex((b, i) => b.type === "heading_2" && textOf(b).includes("비서 간 메모"));
    const anchor = memoIdx > 0 ? blocks[memoIdx - 1].id : null;
    const res = await notion(`/blocks/${HUB_PAGE_ID}/children`, "PATCH",
      anchor ? { children, after: anchor } : { children });
    const ids = (res.results || []).filter((b) => b.type === "heading_2").map((b) => b.id);
    return { ok: true, action, added: children.length, ids };
  }

  if (action === "instruction") {
    const pendingSec = (() => {
      const board = secs.find((s) => s.text.includes("공용 요청 보드"));
      if (!board) return null;
      const i = board.body.findIndex((b) => b.type === "heading_3" && textOf(b).includes("대기"));
      if (i < 0) return null;
      let j = i + 1;
      while (j < board.body.length && board.body[j].type !== "heading_3") j++;
      return { body: board.body.slice(i + 1, j) };
    })();
    let anchor = pendingSec ? pendingSec.body[pendingSec.body.length - 1] : null;
    const children2 = [
      {
        object: "block",
        type: "to_do",
        to_do: { rich_text: rt(`[${now.date} ${now.time}] [지휘실] ${text}`), checked: false }
      }
    ];
    const payload = anchor ? { children: children2, after: anchor.id } : { children: children2 };
    const res = await notion(`/blocks/${HUB_PAGE_ID}/children`, "PATCH", payload);
    return { ok: true, action, added: 1, anchor: anchor ? anchor.id : null };
  }

  // memo -> last block of the memo section, so memos stay together
  const memoSec = secs.find((s2) => s2.text.includes("비서 간 메모"));
  const memoAnchor = memoSec ? memoSec.body[memoSec.body.length - 1] : null;
  const memoChildren = [
    {
      object: "block",
      type: "bulleted_list_item",
      bulleted_list_item: { rich_text: rt(`[${now.date} ${now.time}] [지휘실] ${text}`) }
    }
  ];
  const res = await notion(`/blocks/${HUB_PAGE_ID}/children`, "PATCH",
    memoAnchor ? { children: memoChildren, after: memoAnchor.id } : { children: memoChildren });
  return { ok: true, action: "memo", added: 1 };
}

module.exports = async (req, res) => {
  const origin = req.headers.origin || "";
  const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store, max-age=0", "Vary": "X-Office-Key", ...corsHeaders(origin) };
  const send = (code, obj) => {
    res.writeHead(code, headers);
    res.end(JSON.stringify(obj));
  };

  if (req.method === "OPTIONS") {
    res.writeHead(204, headers);
    return res.end();
  }

  if (OFFICE_KEY) {
    const key = req.headers["x-office-key"] || (req.query && req.query.k);
    if (key !== OFFICE_KEY) return send(401, { ok: false, error: "unauthorized" });
  }

  try {
    if (req.method === "GET") {
      const data = await buildHub();
      res.writeHead(200, headers);
      return res.end(JSON.stringify(data));
    }

    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") {
        try {
          body = JSON.parse(body || "{}");
        } catch {
          body = {};
        }
      }
      body = body || {};
      const out = await handlePost(body);
      return send(200, out);
    }

    return send(405, { ok: false, error: "method not allowed" });
  } catch (err) {
    return send(err.status || 500, { ok: false, error: String(err.message || err) });
  }
};
