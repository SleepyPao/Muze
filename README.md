# Maze Rescue

INT4099 小组展示用的可运行原型。对象是香港小五、小六学生（英语约 A2）。
学生用英语向迷路的小探险家 Pip 提问，找到四件物品，再用英语指挥 Pip 走出树篱迷宫。
信息只能通过语言获得，每一步移动都由语言决定。游戏内文字全部是英文。

完整规格见 [PLAN.md](PLAN.md)（顶部有"单人游戏"修订说明），技术说明见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 怎么打开

**双击 `index.html` 即可。** 不需要安装，不需要网络。没有 API key 时右上角显示 "Demo mode"，
用离线关键词规则代替 AI，可以完整走完全部流程。

推荐浏览器：Chrome / Edge / Safari 最新版。电脑和平板（触屏）都可以，全程只用鼠标点击或触屏点按，不用方向键。

## 流程（单人）

| 画面 | 内容 |
|---|---|
| Start | 输入班号（不输姓名），选择迷宫难度（Standard / Simple），故事开场 |
| Warm-up | 10 道快速题（读指令点路径、看图选介词），即时对错，只记录答对数 |
| Ask × 4 | 向 Pip 提问，右侧事实卡 name / look / place 问到才点亮；Hint 按钮两级提示 |
| Go × 4 | 每件物品 2 个岔路口，点击选路；走错到死路，可回岔路口重新问 Pip |
| End of lesson 1 | 自动保存；下次输入同一班号从第 2 节继续 |
| Guide × 2 | 看全图，用英语指挥 Pip；Pip 会反问 "Left or right?"、"My left or your left?" 等；撞墙不结束游戏 |
| Review | 回看自己的提问记录和两条路线回放，填三条自评 |
| Teacher view | Start 页右下角 "Teacher"：每位学生一行自动计数，录入评分表 A、C，展开看完整记录和路线回放，导出 / 导入 JSON，导出全班 CSV |

同一台设备可以让多名学生先后各玩一局，证据按班号分开。多台设备的数据可在老师视图里用 "Import JSON" 合并。

## 接入 DeepSeek（可选）

**一台电脑演示：**

```bash
cp config.example.js config.local.js     # config.local.js 已在 .gitignore 中，不会被提交
# 编辑 config.local.js，填入 apiKey
```

型号默认 `deepseek-flash`，请以 DeepSeek 官方文档为准，在 `config.local.js` 的 `model` 中修改。
超时 6 秒；AI 返回空内容、坏 JSON 或超时时 Pip 说 "Sorry, can you say that again?"，不计入学生错误；
连续失败两次自动切回离线规则。

**全班使用（key 不进浏览器）：**

```bash
DEEPSEEK_API_KEY=sk-... npm run serve      # 即 node server/proxy.js，零依赖
# 学生用浏览器打开 http://<老师电脑的 IP>:8787/
```

中转服务器只转发学生的句子和事实表，不含班号或任何个人信息，也不把请求写入磁盘或日志。

## Pip 的声音（离线女声）

* Pip 的全部固定台词（68 句：事实、提示、反问、故事等）已用 **Piper** 离线合成为 MP3，放在 `assets/voice/`，
  女声 "kristin"（训练数据来自 LibriVox，公有领域）。播放时完全不联网。
* 文字的打字速度按语音时长同步；新的一句会打断上一句；Pip 说话时背景音乐自动变小；语音最长不超过片段时长 + 1 秒，不会卡住游戏。
* AI 在运行时写的句子（少数反问）只使用本机系统语音（女声优先），**从不使用联网语音**；没有合适的本机语音时 Pip 不出声，文字照常显示。
* 右上角 ♪ 按钮一键静音（音乐、音效、语音全部静音）。
* 修改台词后重新生成语音：见 [tools/voice/README.md](tools/voice/README.md)。

**语音输入（麦克风）待确认事项（规格第 7 节）：** Chrome 的语音识别会把音频发送到 Google 服务器；
在确认对儿童使用的条款之前，可以在 `config.local.js` 里设 `speechInput: false` 关闭麦克风按钮，打字输入始终可用。
游戏本身不保存任何音频。

## 测试

```bash
npm install                 # 只安装开发用的 Playwright
npx playwright install chromium
npm test                    # 52 个单元测试（规则、迷宫、日志、AI 接口）
npm run test:e2e            # 断网的无头浏览器完整通关：两名学生、两种难度、老师视图、坏 AI，共 141 项检查
```

截图：`node tools/shot.js "?debug=guide&route=1" out.png`。所有调试链接见 docs/ARCHITECTURE.md。

## 验收清单（PLAN.md 第 10 节）

| 项目 | 状态 | 由谁验证 |
|---|---|---|
| 不提问就无法进入 Go 阶段 | ✅ | e2e：Go 按钮锁定；直接跳转 Go 会被送回 Ask |
| 乱点路径只会走到死路，拿不到物品 | ✅ | e2e：错路 → "Dead end…"，物品仍在 |
| 问一项只得到一项事实 | ✅ | e2e + 单元测试 |
| AI 的回复里从不出现事实表以外的物品或地点 | ✅ | 事实只取自事实表；AI 写的句子须通过校验，否则换成固定句（单元测试） |
| "Where it is?" 能得到答案；"Where" 得到澄清反问 | ✅ | e2e，4 件物品都测 |
| Guide 阶段说 "turn" 会被反问左右 | ✅ | e2e |
| 撞墙不结束游戏，可继续修改指令 | ✅ | e2e |
| 每条日志带学生标记，证据分开 | ✅（单人版：按班号） | e2e：两名学生两行，JSON 每条记录有 class_no |
| 断网时离线模式可完整走完四件物品和两条路线 | ✅ | e2e 全程屏蔽网络 |
| 全程不需要键盘方向键 | ✅ | e2e 代码检查：无方向键处理 |
| AI 返回空内容或坏格式时不卡死，可以重说 | ✅ | e2e 模拟空内容和坏 JSON |
| 前端代码和仓库里搜不到 API key | ✅ | key 只在 git 忽略的 config.local.js 或服务器环境变量 |

未覆盖：真实 DeepSeek 接口没有联网测试（没有 key）；接口按 OpenAI 兼容格式实现，单元测试用模拟响应覆盖。

## 目录

```
index.html            入口
js/                   逻辑、渲染、画面（见 docs/ARCHITECTURE.md）
css/                  样式
assets/voice/         Pip 的离线语音
server/proxy.js       全班使用时的中转服务器
tools/                截图工具、语音生成脚本
tests/                单元测试和 e2e 测试
docs/                 架构说明、素材授权（CREDITS.md）
```

素材：所有像素画和音乐都是代码绘制 / 合成的原创内容，语音来源见 [docs/CREDITS.md](docs/CREDITS.md)。
