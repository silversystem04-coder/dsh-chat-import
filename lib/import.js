// 解析 chat.deepseek.com 导出的对话 JSON。
// 导出结构（实测 deepseek-all-chats/conversations/*.json）：
//   { id, title, inserted_at, updated_at, url, counts:{total,users,assistants,chars},
//     messages: [ { role:'USER'|'ASSISTANT', content, thinking, model, insertedAt } ] }
// 坑：messages 不是时间正序，也不是「先问后答」——实测 [ASSISTANT, USER, ASSISTANT, ...]，
// 且同一轮的两条 insertedAt 相同。按 (insertedAt, role 优先级 USER<ASSISTANT) 重排才是对话顺序。

import fs from 'node:fs';
import path from 'node:path';

const ROLE_ORDER = { USER: 0, ASSISTANT: 1 };
const ROLE_LABEL = { USER: '问', ASSISTANT: '答' };

function clip(s, n) {
  const t = String(s ?? '');
  return t.length > n ? t.slice(0, n) + '…' : t;
}

/** 一轮的展示标题：用户第一句的前 40 字，兜底用助手开头。 */
function openingOf(turns, title) {
  const firstUser = turns.find((t) => t.role === 'USER');
  const firstAny = firstUser || turns[0];
  return clip(title || (firstAny ? firstAny.text : ''), 40);
}

/**
 * 把一份导出的对话整理成可渲染的结构。
 * 全部字段都可缺失：坏数据返回 { ok:false, error }，不抛。
 */
export function parseConversation(raw, { maxTurns = 4000 } = {}) {
  try {
    if (!raw || typeof raw !== 'object') return { ok: false, error: '不是对象' };
    if (raw.messages != null && !Array.isArray(raw.messages)) {
      return { ok: false, error: 'messages 不是数组' };
    }
    const list = Array.isArray(raw.messages) ? raw.messages : [];
    const turns = list
      .filter((m) => m && typeof m === 'object')
      .map((m, i) => {
        const role = String(m.role || '').toUpperCase() === 'USER' ? 'USER' : 'ASSISTANT';
        const at = m.insertedAt == null ? '' : String(m.insertedAt);
        return {
          role,
          roleLabel: ROLE_LABEL[role],
          idx: i,
          at,
          ms: Date.parse(at) || 0,
          model: m.model || '',
          text: String(m.content ?? ''),
          thinking: String(m.thinking ?? ''),
        };
      })
      .sort((a, b) => {
        // 同一轮里，导出把「答」排在「问」前面，而两者的时间戳只差几毫秒。
        // 所以先按 2 秒的窗口分轮，轮内 USER 必在 ASSISTANT 前，再按原始序号。
        const ra = Math.floor(a.ms / 2000);
        const rb = Math.floor(b.ms / 2000);
        if (ra !== rb) return ra < rb ? -1 : 1;
        const ro = (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9);
        if (ro !== 0) return ro;
        return a.idx - b.idx;
      })
      .map(({ ms, ...rest }) => rest)
      .slice(0, maxTurns);

    const chars = turns.reduce((n, t) => n + t.text.length + t.thinking.length, 0);
    return {
      ok: true,
      id: String(raw.id || ''),
      title: String(raw.title || ''),
      opening: openingOf(turns, raw.title),
      insertedAt: raw.inserted_at || '',
      updatedAt: raw.updated_at || '',
      url: raw.url || '',
      model: (turns.find((t) => t.model) || {}).model || '',
      counts: {
        total: turns.length,
        users: turns.filter((t) => t.role === 'USER').length,
        assistants: turns.filter((t) => t.role === 'ASSISTANT').length,
        chars,
        thinkingChars: turns.reduce((n, t) => n + t.thinking.length, 0),
      },
      turns,
    };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

/** 只读目录里的 *.json（跳过 INDEX 之类的汇总文件）。 */
export function readDir(dir, { limit = 3000 } = {}) {
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.json'));
  } catch (err) {
    return { ok: false, dir, error: String(err && err.code ? err.code : err), items: [] };
  }
  const items = [];
  for (const name of names.slice(0, limit)) {
    const file = path.join(dir, name);
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      items.push({ ok: false, file: name, error: 'JSON 解析失败' });
      continue;
    }
    if (!raw || !Array.isArray(raw.messages)) continue; // INDEX.json 之类
    const parsed = parseConversation(raw, { maxTurns: 1 });
    if (!parsed.ok) {
      items.push({ ok: false, file: name, error: parsed.error });
      continue;
    }
    items.push({
      ok: true,
      file: name,
      id: parsed.id,
      title: parsed.title,
      opening: parsed.opening,
      insertedAt: parsed.insertedAt,
      updatedAt: parsed.updatedAt,
      url: parsed.url,
      model: parsed.model,
      counts: raw.counts && typeof raw.counts === 'object' ? raw.counts : null,
      turnCount: Array.isArray(raw.messages) ? raw.messages.length : 0,
      bytes: stat.size,
      mtime: stat.mtimeMs,
    });
  }
  items.sort((a, b) => String(b.updatedAt || b.insertedAt || '').localeCompare(String(a.updatedAt || a.insertedAt || '')));
  return { ok: true, dir, items };
}

/** 按文件读一条完整对话。 */
export function readOne(dir, file) {
  const base = path.basename(String(file || ''));
  if (!base || base !== String(file || '')) return { ok: false, error: '文件名不合法' };
  const full = path.join(dir, base);
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch (err) {
    return { ok: false, error: String(err && err.code ? err.code : err) };
  }
  const parsed = parseConversation(raw);
  return parsed.ok ? { ...parsed, file: base } : parsed;
}

/**
 * 搜对话。
 *
 *   searchIndex(items, q)              只搜标题与开场（快，不读盘）
 *   searchIndex(items, q, { dir })     正文也搜（含提问、回答、思考），带 60 字上下文
 *
 * 命中返回 { file, title, where, snippet, turnCount }；where ∈ title|body|thinking。
 */
export function searchIndex(items, q, { limit = 60, dir = '' } = {}) {
  const needle = String(q || '').trim().toLowerCase();
  if (!needle) return [];
  const out = [];
  const clipAround = (text, at) => {
    const from = Math.max(0, at - 24);
    const to = Math.min(text.length, at + 36);
    return (from > 0 ? '…' : '') + text.slice(from, to).replace(/\s+/g, ' ') + (to < text.length ? '…' : '');
  };

  for (const it of items) {
    if (!it.ok) continue;
    const head = `${it.title} ${it.opening}`.toLowerCase();
    if (head.includes(needle)) {
      out.push({ file: it.file, title: it.title, where: 'title', snippet: it.opening, turnCount: it.turnCount });
      if (out.length >= limit) break;
      continue;
    }
    if (!dir) continue;

    // 正文：读一遍文件，按 问 → 答 → 思考 的顺序找第一处。
    let raw = null;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(dir, it.file), 'utf8'));
    } catch {
      continue;
    }
    const one = parseConversation(raw, { maxTurns: 4000 });
    if (!one.ok) continue;
    for (const turn of one.turns) {
      const text = turn.text || '';
      const at = text.toLowerCase().indexOf(needle);
      if (at >= 0) {
        out.push({ file: it.file, title: it.title, where: 'body', snippet: clipAround(text, at), turnCount: it.turnCount });
        break;
      }
      const think = turn.thinking || '';
      const at2 = think.toLowerCase().indexOf(needle);
      if (at2 >= 0) {
        out.push({ file: it.file, title: it.title, where: 'thinking', snippet: clipAround(think, at2), turnCount: it.turnCount });
        break;
      }
    }
    if (out.length >= limit) break;
  }
  return out;
}
