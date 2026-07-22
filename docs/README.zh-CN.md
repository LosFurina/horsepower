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

每次 worker 创建或 one-shot dispatch 都必须明确提供 `modelSlot`。必需 slot 为 `judgment`、`craft`、`utility`；内置 fallback 为 `speed -> utility`、`context -> judgment`，也支持自定义 slot。role 不绑定 provider/model。

用户负责在运行 Horsepower 前正确配置每个 Pi provider、model 和模型专属 `thinkingLevelMap`。Horsepower 只消费 Pi 暴露的 model catalog；不会发现模型完整的 thinking-level 集合、决定 provider-specific wire value，也不会修改或修复 `~/.pi/agent/models.json`。其中，本地映射中的 `null` 会被视为明确排除。请先查阅 provider 文档并正确配置 Pi。

运行 `horsepower setup --interactive`，为全部必需 slot 选择当前 Pi 可见的标识符。Horsepower 信任用户已经完成的 Pi 认证和模型配置，设置期间不会探测上游；它只在本地校验标识符及权威的精确 thinking metadata。setup 会先校验全部 slot binding，再进行一次原子写入；取消或失败会保留原文件。setup 只写 Horsepower slot binding，不会修改 Pi 模型配置。

Horsepower 在 dispatch 前也不会预先探测上游；用户负责确保 Pi 认证和模型配置有效。实际 worker 明确拒绝能力时，Horsepower 会保留已配置 binding，绝不会静默降低 thinking、替换标识符或用 fallback 自动重试。请重新运行 `horsepower setup --interactive` 选择其他 binding。

## Pi 接口和执行 campaign

唯一 tool 是 `horsepower_subagent`。旧式 `single`、`parallel`、`chain` 与持久 `create`、`send`、`status`、`list`、`read`、`abort`、`destroy` 并存。只有 Captain 能调度，worker 不能递归委派。

实施前，用户通过 `/horsepower-campaign` 选择 `multi_agent` 或 `main_agent`。选择只绑定一个 change、task scope、campaign 和当前 Pi 进程。`main_agent` 禁止 implementation worker；只有用户单独授权有限 reviewer 后才能独立审查。Review campaign 的有限预算由 Captain 定义，finding 按根因去重；reviewer verdict 不会自动调度下一轮。

## Managed handoff

每个产生工作的 dispatch 都必须明确选择 `handoffMode: "managed"` 或 `handoffMode: "inline"`；`parallel`、`chain` 只能使用 `managed`。Managed `brief.md`、`report.md` 和受限 attachment 是私有保留 artifact。tool result 只返回有限 summary 和 opaque artifact reference。

handoff 只在显式 cleanup 或 purge 时删除。它不会恢复 worker conversation、不会推进 OpenSpec，也不是第二套 task/verification facts。Managed success 必须有当前合法 report。

## 终态和通知

只有 Captain 显式报告 `completed`、`blocked_needs_human`、`failed` 或 `canceled`，change 才进入终态。完成必须提供 Captain 选择且成功的 E2E evidence。若 E2E 确实不适用，Captain 必须提交 `e2eWaiver`，包含具体理由和替代证据；仅 unit tests 永远不能完成 change。

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
