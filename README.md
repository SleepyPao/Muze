# Maze Rescue

INT4099 小组展示用的可运行原型。对象是香港小五、小六学生（英语约 A2）。
学生用英语向迷路的小探险家 Pip 提问，找到四件物品，再用英语指挥 Pip 走出树篱迷宫。
信息只能通过语言获得，每一步移动都由语言决定。游戏内文字全部是英文。

完整规格见 [PLAN.md](PLAN.md)（顶部有"单人游戏"修订说明），技术说明见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 怎么打开

**方式一（推荐，要用麦克风时）：双击 `start-mac.command`（Mac）或 `start-windows.bat`（Windows）。**
游戏会在浏览器打开 `http://localhost:8787/`。第一次按 Speak 时 Chrome 询问麦克风，选"始终允许 / 在每次访问时允许"，以后不会再问。
需要电脑装有 Node.js（没有 Node.js 时会尝试用 Python；都没有则提示）。Mac 第一次打开若提示"无法验证开发者"，右键 → 打开。
`config.local.js` 里的 API key 只留在这台电脑的小服务器上，不会发到浏览器。

**方式二：双击 `index.html`。** 不需要安装任何东西，但 Chrome 不会为本地文件记住麦克风权限，所以**每次按 Speak 都会询问**；不用麦克风时完全没影响。

两种方式都不需要网络。没有 API key 时右上角显示 "Demo mode"，
用离线关键词规则代替 AI，可以完整走完全部流程。

推荐浏览器：Chrome / Edge / Safari 最新版。电脑和平板（触屏）都可以，全程只用鼠标点击或触屏点按，不用方向键。

## 流程（单人）

| 画面 | 内容 |
|---|---|
| Start | 输入班号（不输姓名），选择迷宫难度（Standard / Simple），故事开场 |
| Warm-up | 10 道快速题（读指令点路径、看图选介词），即时对错，只记录答对数 |
| Ask × 4 | 向 Pip 提问，右侧事实卡 name / look / place 问到才点亮；Hint 按钮两级提示 |
| Go × 4 | 每件物品 2 个岔路口，点击选路；走错到死路，可回岔路口重新问 Pip。右侧有地标图例 "What Pip can see" |
| End of lesson 1 | 自动保存；下次输入同一班号从第 2 节继续 |
| Guide × 2 | 看全图，用英语指挥 Pip；Pip 会反问 "Left or right?"、"My left or your left?" 等；撞墙不结束游戏。右侧有地标图例和两级提示 |
| Review | 回看自己的提问记录和两条路线回放，填三条自评 |
| Teacher view | Start 页右下角 "Teacher"：每位学生一行自动计数，录入评分表 A、C，展开看这名学生本局的四件物品、完整记录和路线回放，导出 / 导入 JSON，导出全班 CSV |

同一台设备可以让多名学生先后各玩一局，证据按班号分开。多台设备的数据可在老师视图里用 "Import JSON" 合并。

**左右规则：** left / right 指 Pip 自己的左右。热身题里 Pip 总是背对学生走（学生的左 = Pip 的左），不会出现歧义。
Guide 阶段 Pip 面朝学生时，第一次说 left/right 会反问 "My left or your left?"；Pip 记住学生的回答，这条路线里不再追问，也不会悄悄换成另一种理解。

### 每一局的内容都不一样

每开一局新游戏，游戏会生成一个随机数（seed，"局号"），这一局的全部内容都由它决定：

* **四件物品**：从 8 件（key, map, lamp, bag, book, ball, hat, cup）里随机选 4 件，顺序随机，每件颜色不同、大小随机
  （例："It is small and blue."）。图标按这个颜色画。
* **Go 地图**：4 种地图形状随机分给四件物品；门的颜色、地标（fountain, big tree, windmill, scarecrow, well, bench）位置随机；
  物品藏在哪条岔路也随机。地点句按地图上真实的地标生成，例："It is next to the bench, opposite the windmill."
* **热身题**：每局 5 道路径题（turn at / next to / door / crossing / walk to 各一）+ 5 道介词题（五个介词各一），顺序和地标随机。
* **Guide 迷宫**：两条路线各自随机左右镜像，地标随机换位置（门和桥不变），难度不变。

同一个班号再次登录时，用同一个局号重建，所以内容和上次**完全一样**（中途刷新也一样）。老师视图显示每位学生本局的四件物品。
游戏保证 Pip 不会被地标挡住：高的地标（树、风车、稻草人）不会放在 Pip 走过的路正下方。
所有可能的事实句都事先列出（单元测试检查 360 个局号：地点句真实、错路是死路、迷宫可解、热身题没有歧义）。

### Guide 的提示（Hint）

提示不是固定句子，而是根据 Pip **现在**的位置和朝向算出来的，用的是地图上地标的名字：

* **第 1 次点 Hint**：Pip 现在看得见什么，例："Pip is looking up. Pip can see the windmill."
  提示里说到的地标会在地图上闪烁并显示名字。Pip 面朝学生时会加一句 "Pip’s left is your right."
* **第 2 次点 Hint**：下一句可以照着打的指令，例："Try: Go straight until the well." / "Try: Turn right. (Pip’s right is your left.)"
  Pip 问 "My left or your left?" 时，提示直接给出回答。照着第 2 级提示一句一句打，一定能走到出口（e2e 测试实际走过）。
* Pip 走动后，提示回到第 1 级。

**地标图例 "What Pip can see"**（Go 和 Guide 右侧）：列出地图上每种地标的小图和名字（fountain, big tree, red door, way out …）。
点一下，地图上的这个地标就闪烁并显示名字；直接点地图上的地标也会显示名字。学生因此知道 "the well" 指的是哪一个。

### 语音输入：10 秒倒计时

按 **Speak** 后，按钮变成 **Stop**，旁边出现一个圆形倒计时，从 10 数到 0（最后 3 秒变红）。
到 0 时自动停止；说完一句话后安静约 2 秒也会自动停止；随时可以按 Stop。听到的文字留在输入框里，学生检查后再按 Send。

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
DEEPSEEK_API_KEY=sk-... npm run serve      # 即 node server/proxy.js，零依赖；也可以把 key 写在 config.local.js，服务器会读取
# 学生用浏览器打开 http://<老师电脑的 IP>:8787/
```

中转服务器只转发学生的句子和事实表，不含班号或任何个人信息，也不把请求写入磁盘或日志。

## Pip 的声音（离线女声）

* Pip 的全部固定台词（170 句：所有可能出现的物品事实和地点句、热身指令、反问、故事等）已用 **Piper** 离线合成为 MP3，放在 `assets/voice/`，
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
npm test                    # 79 个单元测试（规则、迷宫、随机内容 360 个局号、提示、日志、AI 接口、语音输入、中转服务器）
npm run test:e2e            # 断网的无头浏览器完整通关，共 160 项检查：两名学生（内容不同）、两种难度、刷新后同一班号内容不变、
                            # 只照第 2 级提示打字走出两条路线、图例、10 秒倒计时（模拟麦克风）、老师视图、坏 AI
```

截图：`node tools/shot.js "?debug=guide&route=1&seed=2024" out.png`（`&seed=` 指定局号，可重现同一局）。所有调试链接见 docs/ARCHITECTURE.md。

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
