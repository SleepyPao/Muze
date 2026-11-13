# 网页版的 AI 中转（Cloudflare Worker）

网页版（https://sleepypao.github.io/Muze/）是公开的，DeepSeek 的 key 不能放进网页或仓库。
这个文件夹是一个很小的中转程序：key 作为**加密的 secret** 存在 Cloudflare，网页只知道中转的地址。

学生的句子 → 中转（加上 key）→ DeepSeek → 中转 → 学生的浏览器

* 只转发游戏发出的内容（学生的句子和事实表），不带班号或个人信息，不存储、不记录。
* 只接受来自 `sleepypao.github.io`（以及本机 `localhost:8787`）的网页请求。
* 每个地址每分钟最多 30 次请求，防止被刷。
* 中转不在、没有 key、或者出错时，游戏自动改用离线规则，照样能玩。

## 部署（第一次，大约 10 分钟）

需要：一个免费的 Cloudflare 账号（https://dash.cloudflare.com/sign-up ），电脑上已有的 Node.js。

在 VS Code 的终端（或"终端" App）里，一行一行运行：

```bash
cd ~/Desktop/Muzze/cloud
npx wrangler login                          # 浏览器会打开 Cloudflare，点 Allow
npx wrangler secret put DEEPSEEK_API_KEY    # 提示 "Enter a secret value" 时粘贴 DeepSeek 的 key，回车（屏幕上不显示）
npx wrangler deploy                         # 最后会打印地址：https://muze-ai.<你的名字>.workers.dev
```

第一次 `deploy` 时如果提示注册一个 `workers.dev` 子域名，随便取一个名字即可。

## 接到网页版

打开仓库根目录的 `config.public.js`，把地址填进 `RELAY`（注意结尾加 `/api/chat`）：

```js
var RELAY = 'https://muze-ai.<你的名字>.workers.dev/api/chat';
```

提交并 push 后，网页版就会使用 AI。打开 Teacher view，顶部显示 **"AI: on (DeepSeek, through the relay)"** 就说明接通了。

## 检查和维护

* 在浏览器打开 `https://muze-ai.<你的名字>.workers.dev/api/chat`：看到 `"ai":true` 说明 key 已设置好。
* 换 key：再运行一次 `npx wrangler secret put DEEPSEEK_API_KEY`，不用改网页。
* 停用 AI：把 `config.public.js` 里的 `RELAY` 改回 `''` 并 push；或在 Cloudflare 后台删除这个 Worker。
* **建议在 DeepSeek 后台设置每月消费上限**，即使有人绕过网页刷这个中转，损失也有上限。
* 老师视图显示 "last call: no balance left" 表示 DeepSeek 余额不足（402）；"wrong or missing API key" 表示 key 不对（401）。

测试：`npm test` 里的 `tests/worker.test.js` 用假的 DeepSeek 回答检查这个中转（来源限制、只转发游戏的内容、频率限制、错误处理）。
