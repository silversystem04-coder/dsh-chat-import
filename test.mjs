/**
 * test.mjs -- dsh-chat-import 的自检。
 *
 *   node test.mjs [语料目录]
 *
 * 三段：
 *   # 解析层   parseConversation 的排序、字段、坏输入
 *   # 索引层   readDir / readOne / searchIndex（含越界）
 *   # 接口层   假 ctx 捕获 webServer.register，再起真 http 打 fetch
 *
 * 语料目录缺省指工作区的 deepseek-all-chats/conversations；不存在就跳过真实数据那几条。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

import { parseConversation, readDir, readOne, searchIndex } from './lib/import.js';
import { apply } from './index.js';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const CORPUS = process.argv[2] || path.join(HERE, '..', 'deepseek-all-chats', 'conversations');

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) {
    pass += 1;
  } else {
    fail += 1;
    failures.push(name + (detail ? '  [' + detail + ']' : ''));
    console.log('  FAIL ' + name + (detail ? '  [' + detail + ']' : ''));
  }
}

function eq(name, got, want) {
  ok(name, got === want, 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
}

function section(title) {
  console.log('\n# ' + title);
}

// ---------------------------------------------------------------- 解析层

section('解析层');

const raw = {
  id: 'abc',
  title: '测试对话',
  inserted_at: '2026-11-08T10:00:00.000+08:00',
  updated_at: '2026-11-08T10:10:00.000+08:00',
  url: 'https://chat.deepseek.com/a/chat/s/abc',
  counts: { total: 4, users: 2, assistants: 2, chars: 120 },
  messages: [
    // 真实导出就是这样：同一轮里「答」排在「问」前面，时间戳只差几毫秒。
    { role: 'ASSISTANT', content: '第一答', thinking: '想一想', model: 'x', insertedAt: '2026-11-08T10:01:00.005+08:00' },
    { role: 'USER', content: '第一问', insertedAt: '2026-11-08T10:01:00.010+08:00' },
    { role: 'ASSISTANT', content: '第二答', thinking: '', model: 'x', insertedAt: '2026-11-08T10:05:00.005+08:00' },
    { role: 'USER', content: '第二问', insertedAt: '2026-11-08T10:05:00.010+08:00' },
  ],
};

const parsed = parseConversation(raw);
eq('ok', parsed.ok, true);
eq('title', parsed.title, '测试对话');
eq('turns 数', parsed.turns.length, 4);
eq('同一时间戳 USER 在前', parsed.turns[0].role, 'USER');
eq('第二问在第三位', parsed.turns[2].role, 'USER');
ok('第一答带思考', parsed.turns[1].thinking === '想一想');
ok('第二答无思考', parsed.turns[3].thinking === '');
ok('counts 有 thinkingChars', parsed.counts.thinkingChars === 3, String(parsed.counts.thinkingChars));
ok('opening 非空', typeof parsed.opening === 'string' && parsed.opening.length > 0);
eq('at 是字符串', typeof parsed.turns[0].at, 'string');
ok('at 可解析', !Number.isNaN(Date.parse(parsed.turns[0].at)));
eq('坏输入 ok=false', parseConversation({ messages: 'nope' }).ok, false);
eq('null 输入 ok=false', parseConversation(null).ok, false);
eq('maxTurns 截断', parseConversation(raw, { maxTurns: 2 }).turns.length, 2);
eq('roleLabel 中文', parsed.turns[0].roleLabel, '问');
eq('答语 roleLabel', parsed.turns[1].roleLabel, '答');

// ---------------------------------------------------------------- 索引层

section('索引层');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-import-'));
fs.writeFileSync(path.join(tmp, '001.json'), JSON.stringify(raw));
fs.writeFileSync(path.join(tmp, '002.json'), JSON.stringify({ ...raw, id: 'def', title: '第二个' }));
fs.writeFileSync(path.join(tmp, 'notes.txt'), 'not json');
fs.writeFileSync(path.join(tmp, 'broken.json'), '{ not json');

const dirOut = readDir(tmp);
ok('readDir ok', dirOut.ok === true, JSON.stringify(dirOut.error || ''));
eq('readDir 只数 json', (dirOut.items || []).length, 3);
ok('坏 json 不炸', (dirOut.items || []).some((i) => i.ok === false));

const one = readOne(tmp, '001.json');
eq('readOne ok', one.ok, true);
eq('readOne turns', one.turns.length, 4);
eq('readOne 越界拒绝', readOne(tmp, '../test.mjs').ok, false);
eq('readOne 子目录拒绝', readOne(tmp, 'sub/001.json').ok, false);
eq('readOne 不存在', readOne(tmp, 'nope.json').ok, false);

const hits = searchIndex(dirOut.items, '第二');
ok('搜索命中', hits.length >= 1, String(hits.length));
eq('搜索空串无命中', searchIndex(dirOut.items, '').length, 0);

// 正文搜索：只有给了 dir 才会去读盘找 content / thinking
const bodyHits = searchIndex(dirOut.items, '想一想', { dir: tmp });
ok('正文/思考链也能搜到', bodyHits.length >= 1, String(bodyHits.length));
ok('命中的位置是 thinking', bodyHits.length > 0 && bodyHits[0].where === 'thinking', bodyHits[0] ? bodyHits[0].where : 'none');
ok('命中带摘要', bodyHits.length > 0 && typeof bodyHits[0].snippet === 'string' && bodyHits[0].snippet.length > 0);
eq('不给 dir 时不搜正文', searchIndex(dirOut.items, '想一想').length, 0);

// ---------------------------------------------------------------- 接口层

section('接口层');

const server = http.createServer(() => {});
let spec = null;
const ctx = {
  webServer: { register: (s) => { spec = s; return () => {}; } },
  get: () => null,
  on: () => {},
};

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

spec = null;
apply(ctx, { order: 78, dirs: [tmp] });
ok('注册了 prefix', !!spec && spec.kind === 'prefix', spec ? spec.kind : 'none');
eq('注册路径', spec && spec.path, '/chat-import');
ok('handler 是函数', !!spec && typeof spec.handler === 'function');

const handler = spec.handler;
server.on('request', (req, res) => handler(req, res));

function get(p, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: p, method: 'GET', headers: headers || {} },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(body); } catch { /* ignore */ }
          resolve({ status: res.statusCode, json, body });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

const ping = await get('/chat-import/api/ping');
eq('ping 200', ping.status, 200);
ok('ping ok', ping.json && ping.json.ok === true);
ok('ping build 0.1.', !!(ping.json && String(ping.json.build).startsWith('0.1.')));
eq('ping 目录数', ping.json && (ping.json.dirs || []).length, 1);

const list = await get('/chat-import/api/list');
eq('list 200', list.status, 200);
ok('list 有条目', list.json && Array.isArray(list.json.items) && list.json.items.length === 3);
eq('list total', list.json && list.json.total, 3);

const listQ = await get('/chat-import/api/list?q=' + encodeURIComponent('第二'));
ok('list 搜索命中', listQ.json && Array.isArray(listQ.json.hits) && listQ.json.hits.length >= 1);

const item = await get('/chat-import/api/item?file=001.json');
eq('item 200', item.status, 200);
eq('item turns', item.json && item.json.turns.length, 4);

const badItem = await get('/chat-import/api/item?file=' + encodeURIComponent('../x.json'));
eq('item 越界 400', badItem.status, 400);

const badDir = await get('/chat-import/api/list?dir=' + encodeURIComponent('C:/Windows'));
eq('dir 不在白名单 400', badDir.status, 400);

const nope = await get('/chat-import/api/nope');
eq('404', nope.status, 404);

const crossSite = await get('/chat-import/api/ping', { 'sec-fetch-site': 'cross-site' });
eq('跨站 403', crossSite.status, 403);

const post = await new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, path: '/chat-import/api/ping', method: 'POST' }, (res) => {
    res.resume();
    res.on('end', () => resolve(res.statusCode));
  });
  req.on('error', reject);
  req.end();
});
eq('POST 405', post, 405);

// ---------------------------------------------------------------- 真实语料

section('真实语料');

if (fs.existsSync(CORPUS)) {
  const real = readDir(CORPUS);
  ok('语料目录可读', real.ok === true, String(real.error || ''));
  const n = (real.items || []).filter((i) => i.ok).length;
  ok('至少 100 条可解析', n >= 100, String(n));
  const sample = (real.items || []).find((i) => i.ok && i.turnCount > 3);
  if (sample) {
    const body = readOne(CORPUS, sample.file);
    ok('抽一条能读', body.ok === true);
    ok('抽一条有回合', Array.isArray(body.turns) && body.turns.length > 1);
    ok('抽一条首转是问', body.turns[0].role === 'USER', body.turns[0].role);
  } else {
    ok('找到一条像样的样本', false, 'none');
  }
} else {
  console.log('  SKIP 语料目录不存在：' + CORPUS);
}

server.close();

console.log('\n' + pass + ' 项通过，' + fail + ' 项失败');
if (fail) {
  console.log(failures.map((f) => '  - ' + f).join('\n'));
  process.exit(1);
}
