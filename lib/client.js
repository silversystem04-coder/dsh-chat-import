/**
 * dsh-chat-import — 浏览器半边。
 *
 * 右侧栏一页「导入」：把 chat.deepseek.com 导出的对话（JSON）翻出来看。
 * 左列表（标题/时间/回合），点开右侧详情（问与答，思考链单独一栏、可折叠）。
 *
 * 手写 ModuleLoader bundle，没有打包器。
 */

window.__ModuleLoader__.load({
  id: 'dsh-chat-import',
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require('react');
    var h = React.createElement;

    var TAB_ID = 'dsh-chat-import';
    var TAB_KIND = 'chat-import';
    var NS = 'chatImport';
    var PREFIX = '/chat-import/api';

    var zh = {
      tab: '导入',
      guide: '看 chat.deepseek.com 导出的旧对话',
      title: '导入的对话',
      search: '搜标题或开场…',
      empty: '这个目录里没有可读的对话',
      loading: '读 …',
      failed: '读不到',
      back: '← 列表',
      turn: '回合',
      chars: '字',
      thinking: '思考过程',
      thinkingShort: '思',
      copy: '复制全文',
      copied: '已复制',
      openWeb: '在网页里打开',
      refresh: '刷新',
      dir: '目录',
      noThinking: '这条没有留下思考过程',
      model: '模型',
    };
    var en = {
      tab: 'Imported',
      guide: 'Browse conversations exported from chat.deepseek.com',
      title: 'Imported conversations',
      search: 'Search title or opening…',
      empty: 'Nothing readable in this folder',
      loading: 'loading …',
      failed: 'failed',
      back: '← list',
      turn: 'turns',
      chars: 'chars',
      thinking: 'Thinking',
      thinkingShort: 'think',
      copy: 'Copy all',
      copied: 'copied',
      openWeb: 'Open on the web',
      refresh: 'Refresh',
      dir: 'Folder',
      noThinking: 'No thinking kept for this turn',
      model: 'model',
    };

    var C = {
      text: 'var(--dsw-alias-label-primary)',
      dim: 'var(--dsw-alias-label-secondary)',
      faint: 'var(--dsw-alias-label-tertiary)',
      line: 'var(--dsw-alias-border-l1)',
      line2: 'var(--dsw-alias-border-l2)',
      bg: 'var(--dsw-alias-bg-layer-1)',
      bg2: 'var(--dsw-alias-bg-layer-2)',
      brand: 'var(--dsw-alias-brand-primary)',
    };

    var S = {
      root: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, gap: 10, padding: '12px 14px', boxSizing: 'border-box', background: C.bg },
      head: { display: 'flex', alignItems: 'baseline', gap: 8, flexShrink: 0 },
      title: { fontSize: 13, fontWeight: 600, color: C.text },
      meta: { fontSize: 11, color: C.faint },
      row: { display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 },
      input: { flex: 1, minWidth: 0, height: 28, padding: '0 9px', fontSize: 12, color: C.text, background: C.bg2, border: '1px solid ' + C.line, borderRadius: 7, outline: 'none' },
      select: { height: 28, maxWidth: 150, fontSize: 11, color: C.dim, background: C.bg2, border: '1px solid ' + C.line, borderRadius: 7, padding: '0 6px' },
      btn: { height: 28, padding: '0 10px', fontSize: 12, color: C.dim, background: C.bg2, border: '1px solid ' + C.line, borderRadius: 7, cursor: 'pointer', whiteSpace: 'nowrap' },
      list: { flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 },
      item: { padding: '8px 9px', borderRadius: 7, cursor: 'pointer', border: '1px solid transparent' },
      itemOn: { background: C.bg2, borderColor: C.line2 },
      ititle: { fontSize: 12.5, color: C.text, lineHeight: 1.5, wordBreak: 'break-word' },
      imeta: { fontSize: 11, color: C.faint, marginTop: 3, display: 'flex', gap: 8, flexWrap: 'wrap' },
      detail: { flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, paddingRight: 2 },
      dtitle: { fontSize: 14, fontWeight: 600, color: C.text, lineHeight: 1.5 },
      dmeta: { fontSize: 11, color: C.faint, display: 'flex', gap: 10, flexWrap: 'wrap' },
      turn: { borderLeft: '2px solid ' + C.line2, paddingLeft: 10, display: 'flex', flexDirection: 'column', gap: 6 },
      turnA: { borderLeftColor: C.brand },
      who: { fontSize: 11, color: C.faint, display: 'flex', gap: 8, alignItems: 'center' },
      body: { fontSize: 13, color: C.text, lineHeight: 1.75, whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
      thinkBox: { background: C.bg2, border: '1px solid ' + C.line, borderRadius: 7, padding: '7px 9px', fontSize: 12, color: C.dim, lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
      thinkHead: { fontSize: 11, color: C.faint, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none' },
      err: { fontSize: 12, color: 'var(--dsw-alias-label-danger, #c0392b)' },
      mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 11, color: C.faint },
    };

    function pad(n) { return n < 10 ? '0' + n : String(n); }
    function when(iso) {
      if (!iso) return '';
      var d = new Date(iso);
      if (isNaN(d.getTime())) return String(iso).slice(0, 16);
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }
    function kb(n) {
      if (!n) return '0';
      return n >= 10000 ? (n / 10000).toFixed(1) + 'w' : String(n);
    }

    var store = {
      state: { dirs: [], dir: '', items: [], total: 0, q: '', busy: false, error: '', one: null, oneFile: '', opened: '' },
      at: 0,
      listeners: [],
      subscribe: function (fn) {
        store.listeners.push(fn);
        return function () {
          store.listeners = store.listeners.filter(function (x) { return x !== fn; });
        };
      },
      snap: function () { return store.state; },
      set: function (patch) {
        store.state = Object.assign({}, store.state, patch);
        store.at = Date.now();
        store.listeners.slice().forEach(function (fn) { try { fn(store.state); } catch (e) {} });
      },
    };

    function api(path, params) {
      var qs = Object.keys(params || {}).filter(function (k) { return params[k] !== '' && params[k] != null; })
        .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
      var url = PREFIX + path + (qs ? '?' + qs : '');
      return fetch(url, { headers: { 'x-chat-import': '1' }, cache: 'no-store' }).then(function (r) {
        return r.json().then(function (body) {
          if (!r.ok) throw new Error(body && body.error ? body.error : ('HTTP ' + r.status));
          return body;
        });
      });
    }

    function loadList(dir, q) {
      store.set({ busy: true, error: '' });
      return api('/list', { dir: dir || store.state.dir, q: q == null ? store.state.q : q, limit: 400 })
        .then(function (body) {
          store.set({
            busy: false,
            dirs: body.dirs || store.state.dirs,
            dir: body.dir || store.state.dir,
            items: body.items || [],
            total: body.total || 0,
            error: body.ok ? '' : (body.error || ''),
          });
        })
        .catch(function (e) { store.set({ busy: false, error: String(e.message || e) }); });
    }

    function openOne(file) {
      store.set({ busy: true, error: '' });
      return api('/item', { dir: store.state.dir, file: file })
        .then(function (body) {
          store.set({ busy: false, one: body, oneFile: file });
        })
        .catch(function (e) { store.set({ busy: false, error: String(e.message || e) }); });
    }

    function ping() {
      return api('/ping').then(function (body) {
        var dirs = body.dirs || [];
        store.set({ dirs: dirs, dir: store.state.dir || dirs[0] || '' });
        return loadList(store.state.dir || dirs[0] || '', '');
      }).catch(function (e) { store.set({ error: String(e.message || e) }); });
    }

    // ------------------------------------------------------------ 思考链
    function ThinkBox(props) {
      var openBox = React.useState(false);
      var open = openBox[0];
      var setOpen = openBox[1];
      var t = props.t;
      var text = props.text || '';
      if (!text) return null;
      var lines = text.split('\n').filter(function (l) { return l.trim(); });
      var head = lines.length ? lines[0] : '';
      var rest = lines.length > 1 ? lines.slice(1).join('\n') : '';
      return h('div', { style: S.thinkBox },
        h('div', { style: S.thinkHead, onClick: function () { setOpen(!open); } },
          h('span', null, open ? '▾' : '▸'),
          h('span', null, t('thinking')),
          h('span', { style: { color: 'var(--dsw-alias-label-tertiary)' } }, '· ' + text.length + ' ' + t('chars')),
        ),
        h('div', { style: { marginTop: open || !rest ? 6 : 4, color: 'var(--dsw-alias-label-secondary)' } },
          open ? text : (head.length > 120 ? head.slice(0, 120) + '…' : head)
        )
      );
    }

    function TurnView(props) {
      var turn = props.turn;
      var t = props.t;
      var isA = turn.role === 'ASSISTANT';
      return h('div', { style: isA ? Object.assign({}, S.turn, S.turnA) : S.turn },
        h('div', { style: S.who },
          h('span', { style: { fontWeight: 600, color: isA ? C.brand : C.dim } }, turn.roleLabel),
          h('span', null, when(turn.at)),
          turn.model ? h('span', { style: S.mono }, turn.model) : null
        ),
        isA && turn.thinking ? h(ThinkBox, { text: turn.thinking, t: t }) : null,
        h('div', { style: S.body }, turn.text || '')
      );
    }

    function Detail(props) {
      var t = props.t;
      var body = props.body;
      var turnOf = (body && body.turns) || [];
      var counts = (body && body.counts) || {};
      var copiedBox = React.useState(false);
      var copied = copiedBox[0];
      var setCopied = copiedBox[1];

      function copyAll() {
        var text = turnOf.map(function (x) {
          return '【' + x.roleLabel + '】' + (x.at ? ' ' + when(x.at) : '') + '\n' + (x.thinking ? '（思考）' + x.thinking + '\n' : '') + x.text;
        }).join('\n\n');
        try {
          navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(function () { setCopied(false); }, 1400);
        } catch (e) { /* ignore */ }
      }

      return h('div', { style: S.detail },
        h('div', { style: S.row },
          h('button', { style: S.btn, onClick: props.onBack }, t('back')),
          h('button', { style: S.btn, onClick: copyAll }, copied ? t('copied') : t('copy')),
          body && body.url ? h('button', { style: S.btn, onClick: function () { window.open(body.url, '_blank'); } }, t('openWeb')) : null,
        ),
        h('div', { style: S.dtitle }, body.title || body.file || ''),
        h('div', { style: S.dmeta },
          h('span', null, when(body.updatedAt || body.insertedAt)),
          h('span', null, (counts.users || 0) + ' 问 · ' + (counts.assistants || 0) + ' 答 · ' + kb(counts.chars || 0) + ' ' + t('chars')),
          counts.thinkingChars ? h('span', null, t('thinking') + ' ' + kb(counts.thinkingChars) + ' ' + t('chars')) : null,
          body.model ? h('span', { style: S.mono }, body.model) : null
        ),
        turnOf.map(function (x, i) { return h(TurnView, { key: i, turn: x, t: t }); }),
        !turnOf.length ? h('div', { style: S.meta }, t('empty')) : null
      );
    }

    function ListPane(props) {
      var t = props.t;
      var items = props.items || [];
      var opened = props.opened;
      var qBox = React.useState('');
      var q = qBox[0];
      var setQ = qBox[1];
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0, flex: 1 } },
        h('div', { style: S.row },
          h('input', {
            style: S.input, placeholder: t('search'), value: q,
            onChange: function (e) { setQ(e.target.value); },
            onKeyDown: function (e) { if (e.key === 'Enter') props.onSearch(q); },
          }),
          h('button', { style: S.btn, onClick: function () { props.onSearch(q); } }, t('search') ? '搜' : '搜'),
        ),
        h('div', { style: S.list },
          items.map(function (it) {
            var on = opened === it.file;
            return h('div', {
              key: it.file,
              style: on ? Object.assign({}, S.item, S.itemOn) : S.item,
              onClick: function () { props.onOpen(it.file); },
              title: it.file,
            },
              h('div', { style: S.ititle }, it.ok ? (it.title || it.opening || it.file) : (it.file + ' · ' + it.error)),
              h('div', { style: S.imeta },
                h('span', null, when(it.updatedAt || it.insertedAt)),
                it.ok ? h('span', null, it.turnCount + ' 条') : null,
                it.ok && it.counts ? h('span', null, kb(it.counts.chars) + ' ' + t('chars')) : null
              )
            );
          }),
          !items.length && !props.busy ? h('div', { style: S.meta }, props.error ? props.error : t('empty')) : null,
          props.busy ? h('div', { style: S.meta }, t('loading')) : null
        )
      );
    }

    function Panel(props) {
      var stateBox = React.useState(store.snap());
      var st = stateBox[0];
      var setSt = stateBox[1];
      var t = props.t || function (k) { return zh[k] || k; };

      React.useEffect(function () {
        var off = store.subscribe(setSt);
        if (!store.at) ping().then(function () {}, function () {});
        return off;
      }, []);

      return h('div', { style: S.root },
        h('div', { style: S.head },
          h('span', { style: S.title }, t('title')),
          h('span', { style: S.meta }, (st.total || 0) + ' 条 · ' + (st.dir ? st.dir.split(/[\\/]/).pop() : '')),
        ),
        h('div', { style: S.row },
          st.dirs && st.dirs.length > 1 ? h('select', {
            style: S.select, value: st.dir,
            onChange: function (e) { loadList(e.target.value, st.q); },
          }, st.dirs.map(function (d) {
            return h('option', { key: d, value: d }, d.split(/[\\/]/).pop());
          })) : null,
          h('button', { style: S.btn, onClick: function () { ping(); } }, t('refresh')),
          st.error ? h('span', { style: S.err }, st.error) : null
        ),
        st.one
          ? h(Detail, { body: st.one, t: t, onBack: function () { store.set({ one: null, oneFile: '' }); } })
          : h(ListPane, {
            items: st.items, busy: st.busy, error: st.error, opened: st.oneFile, t: t,
            onSearch: function (q) { loadList(st.dir, q); },
            onOpen: function (file) { openOne(file); },
          })
      );
    }

    function apply(ctx) {
      var t = function (k) {
        try {
          if (typeof ctx.locale === 'object' && ctx.locale && typeof ctx.locale.t === 'function') {
            return ctx.locale.t(NS + '.' + k);
          }
        } catch (e) { /* ignore */ }
        return zh[k] || k;
      };

      try {
        ctx.locale.register(NS, { zh: zh, en: en });
      } catch (e) { /* ignore */ }

      try {
        ctx.effect(function () {
          return ctx.sidebarRightTabs.register({
            id: TAB_KIND,
            kind: TAB_KIND,
            priority: 'extension',
            title: function () { return t('tab'); },
            guide: [{
              id: 'chat-import',
              order: 70,
              title: function () { return t('tab'); },
              description: function () { return t('guide'); },
            }],
          });
        }, 'chat-import: sidebar page type');
      } catch (e) { /* ignore */ }

      try {
        ctx.effect(function () {
          return ctx.slots.inject('sidebar.right.pane.tab', function () {
            return ctx.slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID, locale: NS }, function (props) {
              return h(Panel, Object.assign({}, props, { t: t }));
            });
          });
        }, 'chat-import: sidebar page body');
      } catch (e) { /* ignore */ }
    }

    exports.apply = apply;
    exports.inject = ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight'];
    exports.__internals = { Panel: Panel, Detail: Detail, ListPane: ListPane, ThinkBox: ThinkBox, store: store, api: api, loadList: loadList, openOne: openOne, zh: zh, en: en };
    return module.exports;
  },
});
