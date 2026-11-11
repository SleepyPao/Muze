# Maze Rescue 游戏规格说明（给 Claude Code）

本文件是原型的开发规格。教学设计见同名方案文档《Maze Rescue: Instructional Design Plan》。
规格与方案冲突时，以方案的学习成果和评分表为准。

> **修订（2026-11-10，以此为准）：改为单人游戏。** 一名学生独立完成全部流程（4 件物品 + 2 条路线）。
> 不再有 Player A / Player B、Speaker / Navigator 和交换角色提示；Start 只输入一个班号；日志不带 `player` 字段，证据按班号区分。
> 老师视图每位学生的合计相应变为：事实数共 12、岔路口首次正确数共 8、到达出口共 2。下文中与双人有关的描述均按此修订理解。

> **修订（2026-11-11，以此为准）：每件物品的问题不同。** 事实类型由 name / look / place 三种扩为七种：
> place（Where）、name（What）、colour、size、whose、why、when。每件物品的事实卡仍是 3 格：place 固定，另外两格按当局种子从其余六种里抽取，
> 四件物品组合各不相同，一局内六种都会用到。问了卡片上没有的类型，Pip 不给事实（"I can't tell you that. Look at your card."）。
> 每位学生合计仍为 12 个事实；日志的 `category` / `fact_given` 取这七种值。物品、颜色、地图、热身题、Guide 迷宫也按种子每局随机。

## 1. 目标与范围

- 对象：香港小五至小六学生，英语约 A2，两人共用一台设备。
- 用途：INT4099 小组展示用的可运行原型，不是上线产品。
- 一句话：学生用英语向 AI 角色 Pip（一个在树篱迷宫里迷路的小探险家）提问来取得四件物品，再用英语指挥 Pip 走出迷宫。
- 核心规则：信息只能通过语言获得，每一步移动都由语言决定。

## 2. 硬性约束

1. 单页网页应用，浏览器直接打开即可运行，不需要安装。
2. 移动只用鼠标点击（或触屏点按），不用键盘方向键。
3. 像素风、斜俯视的 2.5D 画面，可爱明亮，不恐怖（详见第 12 节）；走错不扣血、不死亡。
4. 所有游戏内文字为英文，句子短，用词不超过 A2。
5. 语音输入可用时启用，同时永远保留打字输入。
6. 没有 API key 时必须能用"离线模式"完整演示（见第 8 节）。
7. AI 不决定对错：路径是否正确、是否到达出口，全部由游戏逻辑判断。

## 3. 画面流程

```
Start → Warm-up → Ask & Go（4 件物品）→ [第 1 节结束]
      → Guide（2 条路线）→ Review → Teacher view
```

| 画面 | 内容 |
|---|---|
| Start | 输入班号（不输姓名），选择 Player A / Player B，故事开场 |
| Warm-up | 10 道快速题，即时对错，不计分，不使用迷宫事实 |
| Ask | 左侧 Pip 和对话框，右侧事实卡（name / look / place 三格，问到才点亮）|
| Go | 迷宫视图，每件物品 2 个岔路口，点击选择路径 |
| Guide | 学生看全图，输入指令，Pip 逐条执行并画出走过的路径 |
| Review | 回放本人对话记录和路线，填写自评 |
| Teacher view | 按学生列出证据，录入评分表 A 和 C，查看 B 的自动计数 |

每件物品或每条路线结束后，画面提示交换角色（Speaker ↔ Navigator）。

## 4. 各阶段逻辑

### 4.1 Warm-up

- 题型一：听或读一句指令（如 "Turn left at the tree."），点击正确的路径。
- 题型二：看图选介词（next to / behind / in front of / between / opposite）。
- 即时显示对或错，错了显示正确答案。不写入评分数据，只记录正确数供老师参考。

### 4.2 Ask

1. Pip 开场："I need something. Ask me!"
2. 学生提问。AI 把问题归类为：`name`、`look`、`place`、`unclear`、`off_task`。
3. 能理解的问题（包括有小语法错误的，如 "Where it is?"）→ 从事实表取对应事实作答。
4. 不清楚的问题（如片段 "Where key?"，或只有一个词）→ 反问澄清（如 "Do you mean where it is?"），不给事实。
5. 与任务无关 → 一句话引导回任务，不给事实。
6. 三格事实全部点亮后，Go 阶段解锁。
7. 提示阶梯（学生主动点 Hint 才出现）：
   - 第 1 级：泛提示，如 "Ask about the place."
   - 第 2 级：句子开头，如 "Where is …?"
   - 用过第 2 级的事实标记为 `assisted`。
8. 对话中不纠正语法。语法问题只写入日志，供老师在 Explain 环节使用。

### 4.3 Go

- 每件物品的路线上有 2 个岔路口，每个岔路口 2 至 3 条路。
- 正确路径由 Pip 给出的地点描述决定（如 "the path next to the blue fountain"）。
- 记录每个岔路口的**第一次选择**是否正确。
- 选错 → 走到死路，显示 "Dead end. Go back and ask Pip again."，回到岔路口，可重新提问。
- 取到物品后得一颗星，交换角色。

### 4.4 Guide

1. 学生看到完整地图、Pip 的位置和朝向、出口位置。
2. 学生输入一条或多条指令。
3. AI 把指令解析为受限动作序列（见第 6 节），游戏逐步执行并画出轨迹。
4. 指令不完整时 Pip 反问，例如：
   - 只说 "turn" → "Left or right?"
   - 左右可能指学生视角 → "My left or your left?"
   - 地标不存在 → "I can't see a tree. What can I see?"
5. 撞墙 → Pip 说 "There is a wall." 并停在原地，学生修改指令。
6. 记录：每条指令原文、解析结果、是否触发反问、反问后的改写是否成功。
7. 路线最短解不少于 5 步。到达出口后交换角色，第二人走另一条路线。

## 5. 数据

### 5.1 事实表（封闭）

AI 只能使用这里的内容，不能添加任何物品、地点或路线。

```json
{
  "items": [
    {
      "id": "key",
      "name": "a key",
      "look": "It is small and yellow.",
      "place": "It is behind the red door, next to the blue fountain.",
      "junctions": [
        {"clue": "the red door", "options": ["red door", "green door"], "correct": 0},
        {"clue": "next to the blue fountain", "options": ["fountain path", "tree path", "bridge path"], "correct": 0}
      ]
    }
  ]
}
```

共 4 件物品，结构相同。物品和地标请用常见、易画的东西。

### 5.2 迷宫

- 网格地图，JSON 定义：墙、通路、地标（fountain、tree、bridge、red door 等）、起点、出口。
- 准备两个难度：标准版，以及岔路更少的简化版。

### 5.3 日志

每一轮对话写一条记录，保存在浏览器本地（localStorage 外加"导出 JSON"按钮）。

```json
{
  "class_no": "5A-12",
  "player": "A",
  "stage": "ask",
  "item_id": "key",
  "turn": 3,
  "input_mode": "speech",
  "asr_text": "where it is",
  "sent_text": "Where it is?",
  "category": "place",
  "ai_reply": "It is behind the red door, next to the blue fountain.",
  "fact_given": "place",
  "hint_level": 0,
  "clarification": false,
  "timestamp": "..."
}
```

- 不保存音频。
- 阶段结束后日志只读，学生不能修改。
- `asr_text` 与 `sent_text` 不同表示学生更正了识别结果，不算语言错误。

## 6. AI 接口约定

AI 调用封装在一个函数里，便于替换服务商。两种调用都要求返回 JSON。

### 6.0 服务商：DeepSeek

- 接口为 OpenAI 兼容格式，base URL `https://api.deepseek.com`，调用 `/chat/completions`。
- 型号用 `deepseek-flash`（以响应速度为先）。型号名以官方文档为准，写成配置项。
- 请求里设置 `response_format: {"type": "json_object"}`，系统提示里必须出现 "json" 字样并附输出示例。
- 设置足够的 `max_tokens`，避免 JSON 被截断；`temperature` 取低值。
- 返回空内容、非法 JSON 或超时（建议 6 秒）时，一律按"Pip 没听清"处理：显示 "Sorry, can you say that again?"，不计入学生的错误。连续失败两次自动切换到离线规则。
- API key 不写进前端代码，不提交到仓库。原型阶段放在本地配置文件（如 `config.local.js`，加入 `.gitignore`）；给整班使用时改为经由一个小型中转服务器调用。
- DeepSeek 不负责语音，语音识别和朗读见第 7 节。
- 发送给 DeepSeek 的内容只有学生的句子和事实表，不含班号或任何个人信息。

### 6.1 Ask 阶段

输入：当前物品的事实、已给出的事实、学生的句子。
输出：

```json
{"category": "place", "reply": "It is behind the red door, next to the blue fountain.", "grammar_note": "word order: Where is it?"}
```

系统提示要点：
- 你是 Pip，一个在树篱迷宫里迷路的友好小探险家，对话对象是 10 至 12 岁的英语学习者。
- 只用提供的事实作答，每次只回答被问到的那一项。
- 回复最多两句，用简单词汇。
- 听得懂就回答，不要纠正语法；`grammar_note` 只给老师看，不显示给学生。
- 听不懂就问一个澄清问题，不要猜。
- 不给示范问句，不替学生造句。
- 与迷宫无关的内容，用一句话引回任务。

### 6.2 Guide 阶段

输入：学生的指令、Pip 当前位置和朝向、视野内的地标。
输出：

```json
{"actions": [{"type": "forward", "until": "fountain"}, {"type": "turn", "dir": "right"}], "clarify": null}
```

- 允许的动作只有：`forward`（`steps` 或 `until` 地标）、`turn`（`left` / `right`）、`stop`。
- 无法确定时 `actions` 为空，`clarify` 填一个澄清问题。
- 游戏负责校验每个动作是否可执行。AI 的输出不合法时按"听不懂"处理。

## 7. 语音

- 使用浏览器语音识别。识别结果先显示在输入框，学生确认或修改后再发送。
- Pip 的回复同时显示文字并朗读。
- 待确认：所选语音识别方案是否把音频发送到外部服务，以及对儿童使用的条款。

## 8. 离线模式（无 API key）

- 用关键词规则代替 AI：含 where → `place`，含 look / colour / color / big / small → `look`，含 what + need / want → `name`，否则 `unclear`。
- Guide 阶段用规则解析 go straight / turn left / turn right / stop / at the + 地标。
- 画面角落标明 "Demo mode"，保证展示现场没有网络也能演示完整流程。

## 9. 老师视图

- 每位学生一行：问到的事实数（共 6）、其中 assisted 的数量、岔路口首次正确数（共 4）、是否到达出口、触发反问次数、成功改写次数、提示使用次数。
- 点开可看完整对话记录和路线回放。
- 评分表 A（Question form 0–3）和评分表 C（Precision 0–3、Repair 0–3）由老师手动录入。
- 提示次数、用时、尝试次数只展示，不计入语言分数。
- 可导出全班 CSV。

## 10. 验收清单

- [ ] 不提问就无法进入 Go 阶段。
- [ ] 乱点路径只会走到死路，拿不到物品。
- [ ] 问一项只得到一项事实。
- [ ] AI 的回复里从不出现事实表以外的物品或地点。
- [ ] "Where it is?" 能得到答案；单个词 "Where" 得到澄清反问。
- [ ] Guide 阶段说 "turn" 会被反问左右。
- [ ] 撞墙不结束游戏，学生可以继续修改指令。
- [ ] 每条日志带 player 标记，A 和 B 的证据分开。
- [ ] 断网时离线模式可完整走完四件物品和两条路线。
- [ ] 全程不需要键盘方向键。
- [ ] AI 返回空内容或坏格式时游戏不卡死，学生可以重说。
- [ ] 前端代码和仓库里搜不到 API key。

## 11. 建议的开发顺序

1. 迷宫渲染和点击移动（Go 阶段，离线事实表）。
2. Ask 阶段加离线规则，打通"问、解锁、走、取物"。
3. Guide 阶段的指令解析和轨迹绘制。
4. 日志和老师视图。
5. 接入 AI 服务和语音。
6. Warm-up、Review、美术和音效。

## 12. 视觉风格

像素风，斜俯视（top-down 3/4 view）。不用菱形等距网格，因为那样左右是斜的，不利于教 turn left / turn right。

| 方面 | 做法 |
|---|---|
| 视角 | 斜俯视，正方形网格，镜头固定，可轻微缩放，不可旋转 |
| 立体感 | 树、门、喷泉等画出正面和高度；按 y 坐标排序绘制，角色可被前景物体遮挡 |
| 像素规格 | 16×16 或 32×32 图块，整数倍放大，关闭图像平滑 |
| 色调 | 暖色、饱和度适中，白天的小村庄或花园 |
| 场景 | 树篱和木栅栏围成迷宫，石板路，草地上有小花和蘑菇 |
| 地标 | 喷泉、大树、小桥、红门、风车、稻草人；轮廓和颜色互不相同，一眼可辨 |
| 物品 | 小图标，拾取时弹起并发光，进入屏幕上方的物品栏 |
| 对话框 | 底部木框对话栏，左侧为 Pip 的大头像，随情绪切换表情 |
| 动效 | 草随风摆动，喷泉水流，走过的路留下脚印，取物时有星星粒子 |
| 光照 | 柔和的日光和阴影，物品和出口带光晕 |
| 声音 | 轻快的芯片音乐，脚步声，拾取音效，可一键静音 |
| 字体 | 标题和按钮可用像素字体；Pip 的话和学生输入用清晰的圆体字，字号不小于 18px |

素材要求：只用原创素材或授权允许的免费素材包，并在项目里保留授权说明。不使用任何现有游戏的原素材或角色。

## 13. 角色 Pip

Pip 是人物角色，不是机器人：一个在迷宫里迷路的小探险家，Q 版大头身比例。

- 地图上：像素小人，四个方向的站立和行走动画，朝向必须清楚（Guide 阶段要靠它判断左右）。
- 对话框里：大头像，至少五种表情。

| 表情 | 出现时机 |
|---|---|
| 平常 / 等待 | 等学生说话 |
| 开心 | 给出事实、取到物品、到达出口 |
| 困惑（冒问号、摊手） | 澄清反问，如 "Do you mean…?"、"Left or right?" |
| 思考 | 等待 AI 返回 |
| 吃惊 | 撞墙、走到死路 |

- 服装用探险家式样（背包、帽子或斗篷），适合小学课堂。
- 角色须为原创设计。用户提供的参考图只用于说明想要的感觉：Q 版比例、大眼睛、夸张的困惑表情和问号符号。除非确认拥有该图的使用权，否则不得把它直接放进游戏，也不要照着重画。
