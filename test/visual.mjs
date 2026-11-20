/**
 * 出图：node test/visual.mjs [语料目录] [out.html]
 *
 * 没有 puppeteer、也没有 React UMD，所以自带两样东西：
 *   1) 一个「迷你 React」——state 真存、effect 真跑、setState 会重渲染；
 *   2) 把 React 元素树序列化成 HTML 的小函数。
 * fetch 换成直接读 lib/import.js 的真数据，所以画出来的是真语料。
 *
 * 产出 visual.html，用 Edge 无头截：见 README。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const bundle = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8');

const { readDir, readOne } = await import('../lib/import.js');

const dir = process.argv[2] || path.join(root, '..', 'deepseek-all-chats', 'conversations');
const outFile = process.argv[3] || path.join(here, 'visual.html');

// ------------------------------------------------------------ 迷你 React
const hooks = { list: [], index: 0 };
let rerender = null;
function resetHooks() { hooks.list = []; hooks.index = 0; }
const React = {
  createElement(type, props, ...children) {
    const kids = [];
    for (const c of children) if (c !== null && c !== undefined && c !== false) kids.push(c);
    return { type, props: Object.assign({}, props, { children: kids.length === 1 ? kids[0] : (kids.length ? kids : undefined) }) };
  },
  Fragment: 'Fragment',
  useState(init) {
    const i = hooks.index++;
    if (!(i in hooks.list)) hooks.list[i] = typeof init === 'function' ? init() : init;
    const set = (v) => {
      const next = typeof v === 'function' ? v(hooks.list[i]) : v;
      if (next === hooks.list[i]) return;
      hooks.list[i] = next;
      if (rerender) rerender();
    };
    return [hooks.list[i], set];
  },
  useRef(v) { const i = hooks.index++; if (!(i in hooks.list)) hooks.list[i] = { current: v }; return hooks.list[i]; },
  useMemo(fn) { return fn(); },
  useCallback(fn) { return fn; },
  useEffect(fn) { const i = hooks.index++; if (!(i in hooks.list)) { hooks.list[i] = true; if (fn()) hooks.list['clean' + i] = fn(); } },
  useLayoutEffect(fn) { React.useEffect(fn); },
};

// ------------------------------------------------------------ 装 bundle
let factoryMod = null;
globalThis.window = { __ModuleLoader__: { load(spec) { factoryMod = spec; } } };
const requireShim = (n) => {
  if (n === 'react') return React;
  throw new Error(`unexpected require(${n})`);
};
new Function('module', 'exports', 'require', 'window', 'React', bundle)(
  { exports: {} }, {}, requireShim, globalThis.window, React,
);
const I = factoryMod.factory(requireShim, { exports: {} }).__internals;

// ------------------------------------------------------------ 真数据
const listed = readDir(dir);
const items = (listed.items || []).filter((i) => i.ok);
// 挑一条有思考链、回合多的，详情页才好看
let sample = null;
for (const it of items.slice(0, 40)) {
  const one = readOne(dir, it.file);
  if (one.ok && one.counts && one.counts.thinkingChars > 400 && one.turns.length >= 2) { sample = one; break; }
}
if (!sample) sample = readOne(dir, items[0].file);

const listBody = {
  ok: true,
  dir,
  dirs: [dir],
  total: items.length,
  hits: [],
  items: items.slice(0, 400),
};

globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('/item')) return { ok: true, json: async () => sample };
  return { ok: true, json: async () => listBody };
};

// 序列化只画一遍、不重渲染，所以先把数据塞进 store —— 真跑时是 effect 里 ping() 填的。
const base = I.store.snap();
I.store.state = Object.assign({}, base, {
  dirs: [dir], dir, items: listBody.items, total: listBody.total, busy: false, error: '',
});

// ------------------------------------------------------------ 序列化
function css(style) {
  if (!style) return '';
  return Object.keys(style).map((k) => {
    const v = style[k];
    if (v === null || v === undefined || v === false) return '';
    if (typeof v === 'number' && !/^(flex|zIndex|opacity|order|lineHeight)$/.test(k)) return `${k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}:${v}px`;
    return `${k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}:${v}`;
  }).filter(Boolean).join(';');
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function toHtml(node) {
  if (node === null || node === undefined || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return esc(node);
  if (Array.isArray(node)) return node.map(toHtml).join('');
  if (typeof node === 'function') return toHtml(renderOnce(node, {}));
  if (!node.props) return '';
  if (typeof node.type === 'function') return toHtml(renderOnce(node.type, node.props));
  const { children, style, ...rest } = node.props;
  const attrs = Object.keys(rest)
    .filter((k) => /^(className|title|placeholder)$/.test(k))
    .map((k) => `${k === 'className' ? 'class' : k}="${esc(rest[k])}"`).join(' ');
  const st = style ? ` style="${esc(css(style))}"` : '';
  const tag = typeof node.type === 'string' ? node.type : 'div';
  const voidTag = /^(input|img|br|hr)$/.test(tag);
  const inner = voidTag ? '' : toHtml(children);
  return `<${tag}${attrs}${st}>${inner}</${tag}>`;
}

function renderOnce(component, props) {
  resetHooks();
  const prev = globalThis.React;
  globalThis.React = React;
  try { return component(props || {}); } finally { globalThis.React = prev; }
}

// ------------------------------------------------------------ 画两屏
const t = (k) => (I.zh && I.zh[k]) || k;
const listHtml = toHtml(renderOnce(I.Panel, { t }));

// 详情页：直接喂 Detail，别走 store（mini-React 的 effect 会跑 ping，时序不好控）
const detailHtml = toHtml(renderOnce(I.Detail, { body: sample, t, onBack: function () {} }));

const page = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8">
<title>dsh-chat-import preview</title>
<style>
  :root {
    --dsw-alias-label-primary: #1b1b1b;
    --dsw-alias-label-secondary: #4a4a4a;
    --dsw-alias-label-tertiary: #8a8a8a;
    --dsw-alias-border-l1: #e6e6e6;
    --dsw-alias-border-l2: #d6d6d6;
    --dsw-alias-bg-base: #ffffff;
    --dsw-alias-bg-layer-1: #ffffff;
    --dsw-alias-bg-layer-2: #fafafa;
    --dsw-alias-brand-primary: #3b6ef0;
    --dsw-alias-state-error-primary: #d14343;
  }
  html, body { margin: 0; padding: 0; background: #f2f2f2; font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; }
  .stage { display: flex; gap: 26px; padding: 26px; align-items: flex-start; }
  .col { display: flex; flex-direction: column; width: 340px; height: 760px; border-radius: 12px; overflow: hidden; box-shadow: 0 8px 26px rgba(0,0,0,.10); background: #fff; }
  .col.wide { width: 620px; height: 880px; }
  .col > div { min-height: 0; }
  .cap { font-size: 12px; color: #888; margin: 0 0 8px 2px; }
  .wrap { display: flex; flex-direction: column; }
</style></head>
<body><div class="stage">
  <div class="wrap"><div class="cap">右侧栏 · 列表</div><div class="col">${listHtml}</div></div>
  <div class="wrap"><div class="cap">右侧栏 · 点开一条（思考链折叠）</div><div class="col wide">${detailHtml}</div></div>
</div></body></html>`;

fs.writeFileSync(outFile, page, 'utf8');
console.log(`corpus  ${dir}`);
console.log(`items   ${items.length}`);
console.log(`sample  ${sample.file} · ${sample.turns.length} turns · thinking ${sample.counts.thinkingChars}`);
console.log(`wrote   ${outFile}`);
process.exit(0);
