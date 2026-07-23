# Horsepower

Horsepower 是 Pi 的显式、模型中立多 Agent runtime。它协调持久 Pi RPC worker；官方 **Fission-AI/OpenSpec** CLI 独占 proposal、spec、design、tasks、apply 状态、verification facts 和 archive。

[English](../README.md)

## 要求与安装

- Linux 或 macOS
- Node.js 22.19+
- Pi 0.80.10 或更新版本（低于 0.82.0）
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

Operation card 是稳定且带 identity 的 one-shot/persistent 执行观察视图。`elapsed` 表示从当前 dispatch/message 被接受起经过的非负时间；`input`、`output` 表示该 dispatch/message 中 Pi 权威报告的 aggregate token 数，不是估算值或权威计费数据；没有数据时省略。`latest` 只表示最新的已完成 assistant utterance，且已做 normalization、credential/private-path 脱敏、control-character 清理和有界 UTF-8 安全截断。每个 substantive message 都会重置 telemetry；telemetry 不是终态真相。Card 不包含 prompt、reasoning、partial delta、user/system text、raw provider payload、无限制 tool output、credential、private/handoff path、完整 report 或完整 transcript。收集或渲染失败始终是 observational 的，不得改变执行、worker 生命周期、handoff validation 或 terminal truth。

如果用户在阻塞式 wait 中按下 `Esc`，Horsepower 会报告结构化的 canceled run/invocation identity 和实际取消真相，绝不伪造缺失的 managed report 或 completed，并确保没有隐藏的 active child/run。若取消与完成竞争，以第一个权威终态为准。

实施前，`/horsepower-campaign` 会加载一个 apply-ready change 的当前 OpenSpec tasks。用户明确选择全部未完成任务、按 section 选择未完成任务，或手动选择精确的未完成 task ID；确认规范化列表后再选择 `multi_agent` 或 `main_agent`。一个 campaign 只绑定一个 change、这些 canonical task ID 和当前 Pi 进程。范围表达式、自由文本、已完成任务和跨 change ID 都会被拒绝。每次产生工作的 dispatch 前都会重新验证 selected tasks；相关 drift 必须新建 campaign。确认成功后会自动启动且只启动一次 Captain turn，不需要再发送 `go`。

One-shot worker 会实时流式展示受限且脱敏的 assistant/tool 生命周期。每个显示都包含 dispatch 名称、agent 名称和 role、requested/resolved slot、实际 model、thinking 强度与 handoff mode。每个已接受 dispatch 都返回结构化 `completed`、`failed` 或 `canceled`；managed failure 会终态化已创建 handoff，不再留下静默 orphan。`main_agent` 禁止 implementation worker；只有用户单独授权有限 reviewer 后才能独立审查。

Review campaign 绑定一个 implementation campaign、精确 task scope、固定 acceptance scope 和正数有限预算。每个 scope 内根因初始为 `pending`。只有 Captain 可用有界技术理由设置 `accepted`、`rejected`、`needs_clarification` 或 `blocked_needs_human`；reviewer verdict、recommendation、confidence、表演式同意、重复样例、disposition 和 resolution 都不会自动调度工作，也不会增加或重置预算。`fix` dispatch 必须命名一个同 project/change/campaign 中、已接受、scope 内且未解决的 `reviewFindingRootCauseId`，验证后才消耗预算。已接受 finding 保持 `open`，直到 Captain 提供映射到 `review-finding:<rootCauseId>` 的新鲜 targeted verification。campaign outcome `accepted` 要求每个 scope 内 finding 都已用理由技术拒绝，或已接受且解决。仍可如实使用 `scope_changed`、`blocked_needs_human`、`canceled`。

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

可选 change/dispatch webhook 支持 HMAC、Bearer、none。人类可见 summary 遵循 `outputLocale`（`en` 或 `zh-CN`）；status、ID、命令、路径、digest、artifact reference 和 raw evidence 不翻译。重试只在当前进程内有限执行：Pi 退出后未完成 retry 会丢失，不存在持久 outbox。

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
