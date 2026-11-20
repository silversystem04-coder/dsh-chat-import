# dsh-chat-import · 导入的对话

把 **chat.deepseek.com 导出的对话**（官方「导出全部」得到的 `conversations/*.json`）读进 DSH 右侧栏：
列表、搜索、一问一答，**每条回答的思考过程单独一栏、可折叠**。

只读。不改导出的文件，不联网，不写库。

---

## 它解决什么

DeepSeek 网页端的对话记录在导出之后只是一堆 JSON。想看回某一段推理是怎么走的，
以前只能在文件里翻。这个插件把它们放回阅读界面：

- 左列表：标题 + 时间 + 回合数 + 字数，可按标题/开场搜索；
- 点开：按真实对话顺序排好的问与答；
- 每条答语上方是它的**思考链**，默认只显示首句，点一下展开全文；
- 「复制全文」把整段（含思考）按纯文本复制走；
- 「在网页里打开」跳到原始 `chat.deepseek.com` 链接。

## 一个必须知道的坑

导出的 `messages` **不是时间正序，也不是「先问后答」**。实测第一条常常是
`ASSISTANT`，而同一轮的两条消息 `insertedAt` 只差几毫秒（答比问早 5ms）。

所以排序不是简单的 `sort by time`，而是：

1. 以 **2 秒**为窗口分轮（同一轮的问答必落在同一窗口内）；
2. 轮内 `USER` 一定排在 `ASSISTANT` 前面；
3. 同角色再按原始数组序号。

`lib/import.js` 的 `parseConversation()` 里就这三行逻辑，`test.mjs` 的
「同一时间戳 USER 在前」等四条断言守着它。

## 数据从哪来

只认配置里 `dirs` 列出的目录（白名单，别的路径一律 400）。缺省指向：

```
C:/Users/Lenovo/Documents/deepseek-harness/default-workspace/deepseek-all-chats/conversations
```

换目录：装的时候传 `-ChatsDir`，或改 `cordis.patch.yml` 里本插件的 `dirs`。

单个文件形如：

```json
{ "id": "...", "title": "...", "inserted_at": "...", "updated_at": "...",
  "url": "...", "counts": { "total": 4, "users": 2, "assistants": 2, "chars": 120 },
  "messages": [ { "role": "USER", "content": "...", "thinking": "", "model": "...", "insertedAt": "..." } ] }
```

## 装

### A. 从 GitHub 装（需要先 clone 得到 install.ps1）

```powershell
git clone https://github.com/silversystem04-coder/dsh-chat-import
cd dsh-chat-import
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
# 换语料目录：
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -ChatsDir "D:/chats"
```

### B. 已经有一份源码

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -ChatsDir "D:/chats"
```

装完 **重启 DSH**（host 半边只在进程启动时加载），然后 Ctrl+R 刷新页面，
右侧栏多一个「导入」页。

卸载：删掉 `cordis.patch.yml` 里 `# --- chat-import` 那段 insert，再删
`plugins\dsh-chat-import` 与 `node_modules\dsh-chat-import` 两份副本。

## 接口

全部 `GET`，只认 loopback + 同源：

| 路径 | 作用 |
| --- | --- |
| `/chat-import/api/ping` | 版本与可用目录 |
| `/chat-import/api/list?dir=&q=&limit=` | 目录索引（含 `hits` 搜索结果） |
| `/chat-import/api/item?dir=&file=` | 一条对话的完整回合 |

`dir` 必须在白名单里，`file` 只能是 `path.basename`（`../x.json` 之类一律拒）。

工具 `chat_import`（`action=list|search|read`）给模型一个只读入口。

## 自检

```bash
node test.mjs                 # 49 项：解析层 / 索引层 / 接口层 / 真实语料
node test.mjs "D:/chats"      # 换语料目录
```

## 已知边界

1. 只读；不改写导出的 JSON。
2. 大对话一律按 4000 回合截断（`parseConversation` 的 `maxTurns`）。
3. 思考链只有导出里带了 `thinking` 的记录才有；早期会话可能是空。
4. 目录索引每次都重新读盘，没有缓存——语料几万个文件时会慢。
5. 不做全文索引（`searchIndex` 只在标题/开场里找）。

## 文件

| 文件 | 作用 |
| --- | --- |
| `index.js` | host 半边：路由 + 工具 |
| `lib/import.js` | 解析、目录索引、搜索 |
| `lib/client.js` | 右栏页面（手写 ModuleLoader bundle） |
| `install.ps1` | 复制两份 + 追加 patch 块 |
| `test.mjs` | 自检 |

MIT.
