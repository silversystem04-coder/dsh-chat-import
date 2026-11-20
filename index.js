// dsh-chat-import — 把 chat.deepseek.com 导出的对话（JSON）在 DSH 里翻看。
// 只读：不写 DSH 的会话存储，也不改导出文件。

import { readDir, readOne, searchIndex } from './lib/import.js';
import fs from 'node:fs';
import path from 'node:path';

export const name = 'chat-import';
export const inject = ['webServer'];

const BUILD = '0.1.0+20261118';
const PREFIX = '/chat-import';
const HEADER = 'x-chat-import';

const DEFAULTS = {
  order: 78,
  dirs: [],
};

function isLoopback(req) {
  const a = req.socket && req.socket.remoteAddress;
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

function siteAllowed(req) {
  const site = String((req.headers && (req.headers['sec-fetch-site'] || '')) || '');
  return site === '' || site === 'same-origin' || site === 'none';
}

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

/** 目录白名单：只认配置里列出来的目录（规范化后比较）。 */
function allowedDir(config, wanted) {
  const list = Array.isArray(config.dirs) ? config.dirs : [];
  if (!wanted) return list[0] || '';
  const norm = (p) => path.resolve(String(p)).toLowerCase();
  const hit = list.find((d) => norm(d) === norm(wanted));
  return hit || '';
}

export function apply(ctx, config) {
  const cfg = { ...DEFAULTS, ...(config || {}) };
  const dirs = (Array.isArray(cfg.dirs) ? cfg.dirs : []).filter((d) => {
    try {
      return fs.statSync(d).isDirectory();
    } catch {
      return false;
    }
  });

  const handle = async (req, res) => {
    if (!isLoopback(req)) return send(res, 403, { ok: false, error: 'loopback only' });
    if (!siteAllowed(req)) return send(res, 403, { ok: false, error: 'cross-site blocked' });
    if (req.method !== 'GET') return send(res, 405, { ok: false, error: 'GET only' });

    const url = new URL(req.url, 'http://127.0.0.1');
    const route = url.pathname.slice(PREFIX.length);
    const q = url.searchParams;

    try {
      if (route === '/api/ping') {
        return send(res, 200, { ok: true, build: BUILD, dirs, count: dirs.length });
      }

      if (route === '/api/list') {
        const dir = allowedDir(cfg, q.get('dir') || '');
        if (!dir) return send(res, 400, { ok: false, error: 'dir not allowed', dirs });
        const out = readDir(dir);
        const needle = String(q.get('q') || '').trim();
        const items = out.items || [];
        return send(res, 200, {
          ok: out.ok,
          dir,
          dirs,
          error: out.error,
          total: items.length,
          hits: needle ? searchIndex(items, needle, { dir, limit: 60 }) : [],
          items: items.slice(0, Number(q.get('limit') || 400)),
        });
      }

      if (route === '/api/item') {
        const dir = allowedDir(cfg, q.get('dir') || '');
        if (!dir) return send(res, 400, { ok: false, error: 'dir not allowed' });
        const one = readOne(dir, q.get('file') || '');
        return send(res, one.ok ? 200 : 400, { ...one, dir });
      }

      return send(res, 404, { ok: false, error: 'no such route' });
    } catch (err) {
      return send(res, 500, { ok: false, error: String(err && err.message ? err.message : err) });
    }
  };

  const register = () => {
    const webServer = ctx.webServer || (typeof ctx.get === 'function' ? ctx.get('webServer') : null);
    if (!webServer || typeof webServer.register !== 'function') return null;
    return webServer.register({ kind: 'prefix', path: PREFIX, handler: handle });
  };

  let dispose = register();
  if (!dispose) {
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      dispose = register();
      if (dispose || tries > 40) clearInterval(timer);
    }, 150);
    if (typeof timer.unref === 'function') timer.unref();
    ctx.on('dispose', () => clearInterval(timer));
  }

  // 给模型一个只读入口：列目录 / 搜 / 读一条
  const tools = typeof ctx.get === 'function' ? ctx.get('tools') : null;
  if (tools && typeof tools.register === 'function') {
    import('@deepseek-ai/dsh-tools')
      .then(({ defineTool }) => {
        const tool = defineTool({
          name: 'chat_import',
          description:
            'Browse conversations exported from chat.deepseek.com (read-only). action=list shows a folder index, action=search finds by keyword, action=read returns one conversation with its thinking blocks.',
          parameters: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['list', 'search', 'read'] },
              dir: { type: 'string', description: 'Folder to read; omit for the first configured one.' },
              q: { type: 'string', description: 'Keyword for action=search.' },
              file: { type: 'string', description: 'File name for action=read.' },
            },
            required: ['action'],
          },
          output: { schema: { type: 'object' } },
          execute: async (args) => {
            const a = args || {};
            const dir = allowedDir(cfg, a.dir || '');
            if (!dir) return { ok: false, error: 'dir not allowed', dirs };
            if (a.action === 'read') {
              const one = readOne(dir, a.file);
              if (!one.ok) return one;
              return {
                ok: true,
                title: one.title,
                turns: one.turns.slice(0, 80).map((t) => ({
                  role: t.role,
                  at: t.at,
                  model: t.model,
                  text: t.text.slice(0, 4000),
                  thinking: t.thinking ? t.thinking.slice(0, 2000) : '',
                })),
                counts: one.counts,
              };
            }
            const out = readDir(dir);
            const items = out.items || [];
            if (a.action === 'search') {
              return { ok: true, dir, hits: searchIndex(items, a.q) };
            }
            return {
              ok: out.ok,
              dir,
              total: items.length,
              items: items.slice(0, 60).map((i) => ({
                file: i.file,
                title: i.title,
                opened: i.opening,
                at: i.updatedAt || i.insertedAt,
                turns: i.turnCount,
              })),
            };
          },
        });
        tools.register(tool);
      })
      .catch(() => {});
  }
}
