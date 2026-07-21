# Horsepower

Horsepower 是 Pi 的显式、模型中立多 Agent runtime。它协调持久 Pi RPC worker；官方 **Fission-AI/OpenSpec** CLI 独占 proposal、spec、design、tasks、apply 状态、verification facts 和 archive。

[English](../README.md)

## 要求与安装

- Linux 或 macOS
- Node.js 22.19+
- Pi 0.80.10
- 官方 OpenSpec 1.6.0+

仅从 `LosFurina/horsepower` GitHub Releases 安装。下载并检查仓库自带的 `install.sh`，指定 release version 执行：

```sh
curl -fsSLO https://github.com/LosFurina/horsepower/raw/main/install.sh
sh install.sh --version 0.1.0-alpha.1 --locale zh-CN --no-setup
horsepower setup
```

bootstrap 下载 `horsepower-v<version>.tar.gz` 及 SHA-256 asset，验证精确布局和内部 digest，然后原子切换 `current`。它不使用 `sudo`、不修改 shell 启动文件、不复制 Pi resource。可使用 `--locale en` 或 `--locale zh-CN`；没有终端和既有设置时默认英文。

## 模型能力 slot

每次 worker 创建或 one-shot dispatch 都必须明确提供 `modelSlot`。必需 slot 为 `judgment`、`craft`、`utility`；内置 fallback 为 `speed -> utility`、`context -> judgment`，也支持自定义 slot。role 不绑定 provider/model。

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
