# Horsepower

Horsepower 是 Pi 的显式、模型中立多 Agent runtime。它协调持久 Pi RPC worker；官方 **Fission-AI/OpenSpec** CLI 独占 proposal、spec、design、tasks、apply 状态、verification facts 和 archive。

[English](../README.md)

## 要求与安装

- Linux 或 macOS
- Node.js 22.19+
- Pi 0.80.10 或更新版本
- 官方 OpenSpec 1.6.0+

从 `raw/main` 下载并检查仓库自带的 `install.sh`。脚本只从 `LosFurina/horsepower` GitHub Releases 页面下载安装 asset；默认会解析并安装仓库当前的 Latest Release：

```sh
curl -fsSLO https://github.com/LosFurina/horsepower/raw/main/install.sh
sh install.sh --locale zh-CN
```

交互安装是首选路径。bootstrap 下载 `horsepower-v<version>.tar.gz` 及 SHA-256 asset，验证精确布局和内部 digest，执行激活前 Skill gate，原子切换 `current`，再启动语言、Skill 边界、webhook 与模型的完整配置。它不使用 `sudo`、不修改 shell 启动文件、不复制 Pi resource。可使用 `--locale en` 或 `--locale zh-CN`；没有终端和既有设置时默认英文。

无人值守安装使用 `sh install.sh --locale zh-CN --no-setup`。它跳过全部交互配置问题，但仍执行只读审计并显示警告。需要可复现安装时，可使用 `--version VERSION` 或 `HORSEPOWER_VERSION=VERSION` 固定版本。安装后运行 `horsepower configure --interactive` 完成完整配置；`horsepower setup --interactive` 只用于模型 slot 选择或重新验证。

## 技能隔离与暴露审计

每个 Horsepower one-shot 和持久 worker 启动 Pi 时都使用 `--no-skills`；worker 不会发现全局、项目、settings、package 或 extension 动态提供的 Skill。这是指令边界，不是文件系统、凭据、网络或操作系统 sandbox。

主 Captain 有意保留在用户正常且由用户控制的 Pi 环境中。Superpowers 等外部 Skill 由用户管理；Horsepower 绝不会安装、删除、启用、禁用或配置它们。安装程序在 staged preflight 之后、activation 之前审计静态启用的 Skill。交互安装发现外部暴露或审计不完整时，只接受明确的 `y`、`Y` 或 `yes`（默认 No）；无人值守安装向 stderr 警告后继续，且不修改 Pi Skill 配置。

可随时运行 `horsepower configure --interactive` 进行完整配置：输出语言、Captain/worker Skill 边界与当前上下文审计、可选 webhook、必需模型 slot。后续步骤跳过或取消时，先前已确认的独立配置会保留，并显示精确的后续命令。

可在任意项目运行 `horsepower skill-audit` 或 `horsepower skill-audit --json`。只读审计涵盖全局和当前项目上下文；缺失 package 会跳过而不是安装，也不会加载 extension 或执行 Skill 内容。审计不会枚举 extension 动态提供的 Skill，也无法预测未来项目。命令会显示可选、可移植的 `find "$HOME" ...` 候选文件扫描命令，但绝不自动执行；找到候选文件不表示 Pi 已启用它。

## 模型能力 slot

每次 worker 创建或 one-shot dispatch 都必须明确提供 `modelSlot`。必需 slot 为 `judgment`、`craft`、`utility`；内置 fallback 为 `speed -> utility`、`context -> judgment`，也支持自定义 slot。Agent 定义不再包含 recommended-slot 映射：`agent`、`workKind`、`modelSlot` 相互独立，Captain 不得从 `tester` 或 `workKind=test` 推导出 `test` slot。role 不绑定 provider/model。

用户负责在运行 Horsepower 前正确配置每个 Pi provider、model 和模型专属 `thinkingLevelMap`。Horsepower 只消费 Pi 暴露的 model catalog；不会发现模型完整的 thinking-level 集合、决定 provider-specific wire value，也不会修改或修复 `~/.pi/agent/models.json`。其中，本地映射中的 `null` 会被视为明确排除。请先查阅 provider 文档并正确配置 Pi。

运行 `horsepower setup --interactive`，为全部必需 slot 选择当前 Pi 可见的标识符。Horsepower 信任用户已经完成的 Pi 认证和模型配置，设置期间不会探测上游；它只在本地校验标识符及权威的精确 thinking metadata。setup 会先校验全部 slot binding，再进行一次原子写入；取消或失败会保留原文件。setup 只写 Horsepower slot binding，不会修改 Pi 模型配置。

Horsepower 在 dispatch 前也不会预先探测上游；用户负责确保 Pi 认证和模型配置有效。实际 worker 明确拒绝能力时，Horsepower 会保留已配置 binding，绝不会静默降低 thinking、替换标识符或用 fallback 自动重试。请重新运行 `horsepower setup --interactive` 选择其他 binding。

## Pi 接口和执行 campaign

唯一 tool 是 `horsepower_subagent`。旧式 `single`、`parallel`、`chain` 与持久 `create`、`send`、`status`、`list`、`read`、`abort`、`destroy` 并存。只有 Captain 能调度，worker 不能递归委派。

持久 `create` 在 process 和初始 message 被接纳后及时确认；持久 `send`/`steer` 使用 `wait: false` 时，在 message 被接受或排队后及时确认，不会刻意等待 turn 完成。每次确认都带有稳定的 `workerId`、`messageId` 和当前 status snapshot；快速 turn 可能已经是 `completed`，但这不表示确认过程等待了完成。后续 message（包括空闲后）复用同一个 worker 和 conversation。使用 `status` 或基于 cursor 的 `read` 观察同一 worker/message 及其完成情况；需要时使用 `abort`，并显式使用 `destroy`。wait timeout 只停止等待，不会取消 turn 或销毁 worker；abort 保持既定 worker 生命周期，释放 worker 由显式 destroy 和 process cleanup 负责。worker 不会在宿主 Pi process 终止后存活。

### 持久 worker 列表

运行 `/horsepower-workers` 会追加一份耐久、仅 TUI 可见的快照；它只列出在**当前 Captain Pi 进程**中由 `create` 创建的持久 worker。该 card 在后续 render 后仍保留，但仅供观察：不会发送给 model，不会创建或推进工作，也不是 runtime 或终态真相。需要当前状态时请重新运行命令。结构化的 `horsepower_subagent` `list` action 独立于 TUI renderer，仍可使用。

空 card 会明确说明当前没有持久 worker，但这**不表示**没有运行过 one-shot 工作：已完成或进入终态的 `single`、`parallel`、`chain` 子进程属于 one-shot，绝不会进入此列表。非空 card 按确定顺序显示全部当前 worker（runtime 上限为 8 个），包括受限的 identity、lifecycle/message correlation、排队 message 数和可用 telemetry。elapsed、Pi 权威报告的 aggregate input/output usage，以及已规范化的最新 assistant utterance 仅在可用时显示；缺失值会省略而不会猜测。

Worker-list 快照排除 prompt 和 message body、reasoning、raw event/provider payload、无限制 tool output、credential、绝对 private path 和 managed-handoff path、report body 与完整 transcript；字段及 card 总体均采用 UTF-8 安全边界。runtime list、locale、append 或 renderer 失败仍只是观察性故障，会产生受限且可操作的可见诊断，而不是静默成功；它们不会递归重试或改变 worker 状态。非交互式 TUI 模式会明确报告 UI 不可用；RPC command discovery 与结构化 `list` tool contract 仍保持可用。

Operation card 是稳定且带 identity 的 one-shot/persistent 执行观察视图。`elapsed` 表示从当前 dispatch/message 被接受起经过的非负时间；`input`、`output` 表示该 dispatch/message 中 Pi 权威报告的 aggregate token 数，不是估算值或权威计费数据；没有数据时省略。`latest` 只表示最新的已完成 assistant utterance，且已做 normalization、credential/private-path 脱敏、control-character 清理和有界 UTF-8 安全截断。每个 substantive message 都会重置 telemetry；telemetry 不是终态真相。Card 不包含 prompt、reasoning、partial delta、user/system text、raw provider payload、无限制 tool output、credential、private/handoff path、完整 report 或完整 transcript。收集或渲染失败始终是 observational 的，不得改变执行、worker 生命周期、handoff validation 或 terminal truth。

### Parallel 父/子 operation card

`parallel` dispatch 仍然是一次 Captain tool call，并共用 Pi 的 partial-result **替换**表面。因此 Horsepower 会投影一个 **父级摘要（parent summary）**，并为每个已接纳 invocation 保留 **稳定的子级行/区块（child）**（按输入/`accepted` 的规范顺序，最多 8 个子任务；并发进程上限仍为 4）。每一次 partial `onUpdate` 快照都必须同时保留全部已接纳子级；交错事件只更新权威 `invocationId` 对应的子级，不得擦除、错归属或重排兄弟子级。

父级计数（`total`、pending/running、`completed`、`failed`、`canceled`）由子级状态推导，不信任调用方传入的合计。每个子级复用 single card 的 identity 与 telemetry 语义：dispatch 名称、agent/role、requested→resolved slot、实际 model、thinking 强度、handoff mode、invocation/run ID、当前 operation/status、非负 `elapsed`、可用时的权威 usage，以及有界 `latest` utterance。人类可见标签遵循 `outputLocale`（`en` / `zh-CN`）；名称、role、slot、model ID、thinking 值、mode、status 与各类 ID 保持未翻译的机器字段。字段级与聚合级 UTF-8 安全边界仍然适用；不得为节省显示空间而省略任一已接纳子级的 identity。

**终态保留：** 当某个子级 completed、failed 或 canceled 后，其可见终态展示会对后续非终态 observational 更新冻结，其他兄弟子级可继续独立更新。第一个权威终态仍是生命周期真相；card 不会伪造缺失的 usage、report 或 completion。投影状态是短暂的，会在父级 tool call 结算后丢弃——它绝不是执行、campaign、handoff 或 verification 的权威。

**隐私排除（不变）：** parent/child 的文本与结构化 details 均不包含 prompt、reasoning、partial assistant delta、user/system text、raw provider payload、无限制 tool output、credential、private/handoff 文件系统路径、完整 report 或完整 transcript。

**观察性渲染失败：** 若投影构建或 Pi partial-result 回调抛错，Horsepower 继续执行 dispatch，仅在适用时记录有界投递证据，并仍报告真实的子级与父级终态。渲染缺陷不能授权工作、取消 worker、改变 handoff validation，或覆盖 first-terminal-wins 结算。观察降级必须可见且可操作，但不能改变执行、异步结算或生命周期真相。

如果用户在阻塞式 wait 中按下 `Esc`，Horsepower 会报告结构化的 canceled run/invocation identity 和实际取消真相，绝不伪造缺失的 managed report 或 completed，并确保没有隐藏的 active child/run。若取消与完成竞争，以第一个权威终态为准。

实施前，`/horsepower-campaign` 会通过官方 OpenSpec CLI 发现当前项目中仍有未完成任务的 apply-ready 变更，并以有界进度上下文显式列出候选；不要求自由输入 change ID，即使只有一个候选也不会自动选定。零个合格变更时给出可操作的无候选结果且无副作用；取消选择器同样不会创建任何状态。用户选定 change 后，Horsepower 加载该 change 的当前 OpenSpec tasks。用户明确选择全部未完成任务、按 section 选择未完成任务，或手动选择精确的未完成 task ID；确认规范化列表后再选择 `multi_agent` 或 `main_agent`。一个 campaign 只绑定一个 change、这些 canonical task ID 和当前 Pi 进程。范围表达式、自由文本、已完成任务和跨 change ID 都会被拒绝。创建 campaign 前会重新验证候选资格与所选 task snapshot，每次产生工作的 dispatch 前也会重新验证 selected tasks；缺失、已完成、无效或 drift 状态会 fail closed，并要求重新运行 `/horsepower-campaign` 进行新一轮发现。确认成功后会自动启动且只启动一次 Captain turn，不需要再发送 `go`。只要同一 active campaign 仍然合格，Pi 自动压缩上下文成功且 Pi 不会执行自身的 native retry 时，Horsepower 也会自动继续该 campaign；压缩后用户无需输入 `go`。每次自动继续都严格保留已确认的 change、task 顺序与范围，以及 `multi_agent` 或 `main_agent` mode；压缩绝不会扩大或改变授权。手动 `/compact` 不表示要自动继续；scope drift、显式 pause/block/terminal 状态、已有 pending message，或 session/project 被替换时都会停止自动继续，并要求采取相应的全新用户操作。使用 `/horsepower-campaign-pause` 可显式暂停当前项目的自动续跑；恢复时必须重新确认 `/horsepower-campaign`，不能发送 `go`。

One-shot worker 会实时流式展示受限且脱敏的 assistant/tool 生命周期。每个显示都包含 dispatch 名称、agent 名称和 role、requested/resolved slot、实际 model、thinking 强度与 handoff mode。每个已接受 dispatch 都异步结算为稳定机器 failure envelope，status token 为 `completed`、`failed`、`canceled` 或 `blocked_needs_human`；必须等待终态并保留结构化 identity/error 字段，只翻译人类可见文案。timeout 或缺少观察不等于完成；managed failure 会终态化已创建 handoff，不再留下静默 orphan。`main_agent` 禁止 implementation worker；只有用户单独授权有限 reviewer 后才能独立审查。排障时用 `status`/cursor-based `read` 观察，使用显式 `abort` 或 `destroy`，不要假定超时会清理。不要在诊断中放入 prompt、report、credential、webhook URL 或私有路径。

Review campaign 绑定一个 implementation campaign、精确 task scope、固定 acceptance scope 和正数有限预算。每个 scope 内根因初始为 `pending`。只有 Captain 可用有界技术理由设置 `accepted`、`rejected`、`needs_clarification` 或 `blocked_needs_human`；reviewer verdict、recommendation、confidence、表演式同意、重复样例、disposition 和 resolution 都不会自动调度工作，也不会增加或重置预算。`fix` dispatch 必须命名一个同 project/change/campaign 中、已接受、scope 内且未解决的 `reviewFindingRootCauseId`，验证后才消耗预算。已接受 finding 保持 `open`，直到 Captain 提供映射到 `review-finding:<rootCauseId>` 的新鲜 targeted verification。campaign outcome `accepted` 要求每个 scope 内 finding 都已用理由技术拒绝，或已接受且解决。仍可如实使用 `scope_changed`、`blocked_needs_human`、`canceled`。

## Task-local Check 与测试强度

Horsepower 依赖官方 strict-valid OpenSpec artifacts，不再要求独立 `## Test and Gate Plan`、测试/门禁 profiles 或 `TC-*`/`G-*` registry。

作者可以直接在 task 下添加具体且可选的验证说明：

```markdown
- [ ] 1.1 实现该行为。
  - Check: 运行 focused test 并观察 exit code zero。
```

`/horsepower-campaign` 会显示选中的 tasks 及其 checks（没有则显示 `none`），要求用户输入一段新的自由文本测试强度提示词，并与 change、精确 task IDs 和 execution mode 一起确认。该提示词只指导测试广度，不能削弱 OpenSpec validity、privacy、security、compatibility、lifecycle truth 或 fresh claim-matched completion evidence。

## Managed handoff

每个产生工作的 dispatch 都必须明确选择 `handoffMode: "managed"` 或 `handoffMode: "inline"`；`parallel`、`chain` 只能使用 `managed`。Managed `brief.md`、`report.md` 和受限 attachment 是私有保留 artifact。tool result 只返回有限 summary 和 opaque artifact reference。

handoff 只在显式 cleanup 或 purge 时删除。它不会恢复 worker conversation、不会推进 OpenSpec，也不是第二套 task/verification facts。Managed success 必须有当前合法 report。

## 终态和通知

只有 Captain 显式报告 `completed`、`blocked_needs_human`、`failed` 或 `canceled`，change 才进入终态。`completed` 必须提供 `verification` manifest：观察时间晚于 active run 起点，并在接收前十分钟以内。一到八条精确 command record 包含稳定 evidence ID、显式 `kind`（`e2e` 或 `targeted`）、整数 exit code、最长 500 字符的 summary 和显式当前 acceptance reference；每个当前 OpenSpec task claim 都必须映射到成功 evidence。Horsepower 会在报告时重新执行官方 OpenSpec 严格 context validation，并计算当前进程内 acceptance snapshot。过期、未来、失败、部分、错误映射、scope drift、缺失或仅 worker report 的 evidence 都会 fail closed。worker/reviewer 输出只能作为输入；Captain 必须独立检查当前 repository state，并亲自运行和读取 verification。

```json
{
  "action": "report_terminal",
  "status": "completed",
  "verification": {
    "observedAt": "2026-07-22T12:00:00.000Z",
    "commands": [{
      "id": "e2e-current",
      "kind": "e2e",
      "command": "npm run test:e2e",
      "exitCode": 0,
      "summary": "当前 claim-matched E2E 已通过",
      "acceptanceRefs": ["task:5.4"]
    }],
    "acceptance": [{ "ref": "task:5.4", "evidenceIds": ["e2e-current"] }]
  }
}
```

若 E2E 确实不适用，请把具体 `e2eWaiver` 和一到八条有界 `alternativeEvidence` 放在 `verification` 内；每条仍须有稳定 ID 和当前 acceptance mapping。旧的顶层 bare `e2e`/`e2eWaiver` payload 会有意以 `VERIFICATION_LEGACY_E2E_MIGRATION_REQUIRED` 失败，不会被推断或升级。`failed`、`canceled`、`blocked_needs_human` 仍可不带成功 verification 上报。manifest 是进程内 runtime evidence，不是 OpenSpec 之外的平行 store。

Terminal webhook 不包含 manifest、command output、prompt、report 或 path。它保持 8 KiB canonical payload 上限，最多暴露 20 个 opaque hashed evidence reference；输入 summary 在 notifier hash 前最多 500 字符，每条 reference 最多 2,048 字符。

可选 change/dispatch webhook 使用显式 `generic` 或 `discord` provider。没有 `provider` 的旧设置仍按 `generic` 处理；Horsepower 不会根据 URL 猜测平台。`generic` 保持 canonical JSON，并支持 HMAC、Bearer 或 `none`。直接 Discord incoming webhook 必须选择 `discord` provider，并使用 `auth.mode: "none"`，因为 webhook URL 本身已包含 credential。Discord 请求只发送有界文本并关闭 parsed mentions，不会增加私有 lifecycle 数据。

Discord 设置步骤：在目标 channel 创建 incoming webhook，在 Horsepower webhook 配置中选择 `discord`，仅通过 mode-`0600` Horsepower settings 流程粘贴 URL，并将 authentication 保持为 `none`。使用 `horsepower webhook test` 显式发送一条可见测试消息；该操作经过生产 normalization、adapter、timeout 和 HTTP path。结果只报告 provider、有界 failure class/status 与 attempt count，绝不输出 URL、token、signature 或 receiver body。`horsepower doctor` 只做静态配置检查，绝不会发送 webhook。

人类可见 summary 遵循 `outputLocale`（`en` 或 `zh-CN`）；status、`workKind`、`agent`、`modelSlot` 与 opaque identifier 保持稳定的机器 token。重试只在当前进程内有限执行：Pi 退出后未完成 retry 会丢失，不存在持久 outbox；receiver 失败绝不改变 change 或 dispatch 的 terminal truth。迁移时可保持旧 integration 不变以继续使用 generic 行为；若 endpoint 是 Discord，则必须显式重新配置为 `discord`，不要把 generic HMAC/Bearer endpoint 直接改标为 Discord。轮换 credential 时，应 transactionally 替换 webhook URL 或 generic secret/token，显式测试新 credential 后再撤销旧值；disable 会删除已存 webhook credential。

## 生命周期和删除

```sh
horsepower disable   # 只删除 Pi extension/skill links
horsepower enable    # 验证 current release 后恢复 links
horsepower uninstall # 删除 managed code/links，保留用户数据
horsepower purge --yes # uninstall 后删除保留数据和 handoffs
```

`horsepower disable` 保留 CLI、`current`、versions、settings、state 和 handoffs。已运行的 Pi 仍持有加载过的 runtime，直到 `/reload` 或重启。worker 只在当前 Captain Pi 进程内持久；没有 daemon，也不能跨进程 resume conversation。

## 开发验证

```sh
npm run check
```

该 gate 包含 typecheck、unit/integration tests、确定性 build、真实 Pi extension loading、two-turn persistent worker smoke、installer/link lifecycle、managed handoff retention/cleanup、webhook receiver、本地化和 Captain completion gate E2E。

### CLI 帮助

`horsepower --help` 和 `horsepower <command> --help` 提供本地化、无副作用的帮助。使用 `horsepower help <path>` 查看嵌套路径，并使用 `--json` 获取稳定的机器可读元数据。通过 `horsepower configure --locale en|zh-CN` 设置输出语言。
