# 人工验收

[English](manual-acceptance.md) · **简体中文**

本文是英文版的译文，两者不一致时以英文版为准。

自动化测试覆盖不了的用例按本文手动验收：V8、V9 和 I5（见[实现约定 §6](implementation.md#6-acceptance-cases)）。每次发布前都要做一遍，结果填进发布说明里的记录表。

开始前确认 tmux ≥ 3.0，并记录本次 CLI/VSIX 制品及哈希。`accept-*` 会话只能建在隔离服务器中。启动编辑器前约定前台验收时间，不关闭日常编辑器。

在 bash 或 zsh 中执行以下步骤，替换两个制品路径。本地前缀安装不替换日常 CLI；干净的子进程环境会移除继承的 tmux 端点、代理配置和凭据。需要认证的原生代理应在这个临时 HOME 中单独配置。

```sh
BERTH_ACCEPT_ROOT="$(mktemp -d /tmp/berth-test-accept.XXXXXX)"
mkdir -p "$BERTH_ACCEPT_ROOT"/{home,config,state,data,cache,tmp,work}
berth_accept() {
  env -i PATH="$BERTH_ACCEPT_ROOT/cli/node_modules/.bin:$PATH" \
    HOME="$BERTH_ACCEPT_ROOT/home" XDG_CONFIG_HOME="$BERTH_ACCEPT_ROOT/config" \
    XDG_STATE_HOME="$BERTH_ACCEPT_ROOT/state" XDG_DATA_HOME="$BERTH_ACCEPT_ROOT/data" \
    XDG_CACHE_HOME="$BERTH_ACCEPT_ROOT/cache" TMPDIR="$BERTH_ACCEPT_ROOT/tmp" \
    SHELL=/bin/sh TMUX_TMPDIR="$BERTH_ACCEPT_ROOT" BERTH_TMUX_SOCKET=berth-test-accept \
    BERTH_CONFIG="$BERTH_ACCEPT_ROOT/config/berth/config.toml" \
    BERTH_STATE_DIR="$BERTH_ACCEPT_ROOT/state/berth" "$@"
}
tmux_accept() { berth_accept tmux -L berth-test-accept "$@"; }
berth_accept npm install --prefix "$BERTH_ACCEPT_ROOT/cli" "/absolute/path/berthdev-berth-<version>.tgz"
berth_accept code --user-data-dir "$BERTH_ACCEPT_ROOT/user" --extensions-dir "$BERTH_ACCEPT_ROOT/ext" --install-extension "/absolute/path/berth-cr<revision>.vsix"
berth_accept code --user-data-dir "$BERTH_ACCEPT_ROOT/user" --extensions-dir "$BERTH_ACCEPT_ROOT/ext" --new-window "$BERTH_ACCEPT_ROOT/work"
```

本地 CLI 验收命令统一使用 `berth_accept berth ...`，直接查看或清理 tmux 使用 `tmux_accept ...`，不要换成裸 `berth` 或 `tmux`。保留定义这些函数的设置终端。关闭隔离编辑器后运行 `tmux_accept kill-server`，只清理 `printf '%s\n' "$BERTH_ACCEPT_ROOT"` 输出的临时目录。

这套设置用于本地 macOS 编辑器验收；iTerm2 和远程生命周期验收按下文另行隔离。

### 关闭窗口后的终端恢复

在预置 Berth Profile 中确认已启用终端持久化，进程恢复设置为
`onExitAndWindowClose`。记录终端数量、tmux 连接和 pane PID，包含一个无关 shell。
通过 File → Close Window 关闭，再打开同一工作区和 Profile；核对连接恢复、pane
进程保留、终端数量不增长。重载窗口后也检查一次。不得按名称删除回退 shell。
同时保留未保存文本：Hot Exit 无提示备份时，检查恢复内容，不要求出现保存弹窗。
用户明确设置的持久化禁用项必须保留。

## V9：点击系统通知能回到编辑器

macOS 上需要先装 `terminal-notifier`（`brew install terminal-notifier`）。
还须在系统设置中允许该程序发送通知。权限被拒绝或程序不可用时，验收编辑器内
通知回退，系统通知点击仍记为未验证。不要重置系统权限，也不要把程序正常退出
当成通知已显示的证据。

1. 在 VS Code 里打开一个文件夹，运行 **Berth: New Agent Session**，本通知用例选择 Shell。会打开一个接到新会话的终端，记下会话名。
2. 切到别的应用，让 VS Code 不在前台。
3. 在任意终端里运行（换成刚才的会话名）：
   `berth_accept berth stamp --session <会话名> state=waiting note="manual check"`
4. 预期：几秒内弹出系统通知，内容为 "Berth — <会话名> is waiting for you: manual check"。
5. 点击这条通知。预期：VS Code 回到前台，窗口内的通知提供 **Open** 按钮；点 **Open** 后切到该会话的终端。Berth 面板里这一行显示"等待"图标，面板标题上的数字为 1。
6. 清理：`tmux_accept kill-session -t =<会话名>`。

应用激活和准确打开会话分开记录。macOS 可能把同一应用的另一个窗口置前，这只能证明应用被激活；还须在发出通知的窗口验证 **Open**，才能判定会话打开通过。

## I5：iTerm2 恢复布局，每个窗格回到原来的会话

I5 在没有日常终端的临时 macOS 用户账号中执行，也可使用已核实隔离的独立实例。iTerm2 3.7.0 可使用官方应用的独立副本和唯一 `-suite`；连接前核对配置、Application Support、SavedState 和 API socket 均已隔离。Python API 必须同时指定应用路径 `IT2_APP_PATH` 和 `IT2_SUITE`，不得复制日常实例的授权状态。不要使用会禁用 AutoLaunch 的 `--command`。版本依据见[英文步骤](manual-acceptance.md#i5--iterm2-restores-its-layout-and-every-panes-session)。候选 CLI 安装到隔离测试环境。临时账号使用自己的 HOME；独立 suite 的脚本安装到该 suite 的 Application Support，并为 CLI 指定测试 HOME 和 tmux 端点，不写入日常实例。崩溃测试前核对并记录这个隔离 iTerm2 的 PID 和账号，不按进程名批量终止。重启仅针对可丢弃的测试机器或虚拟机，并先约定中断时间。

需要：iTerm2 3.7 或更高版本，已开启 Python API；已开启窗口恢复（iTerm2 设置 → General → Startup，以及 macOS 系统设置 → 桌面与程序坞 → 关闭"退出应用时关闭窗口"）；已执行 `berth tmux install` 和 `berth iterm2 install`。其他"开机为每个会话开一个标签"的脚本要先关掉。

1. 在 iTerm2 里摆一个布局：两个窗口；第一个窗口两个标签，其中一个左右分屏。每个窗格用你平时的启动方式开或接一个 agent 会话，记下哪个窗格是哪个会话。
2. **正常退出**：退出 iTerm2（⌘Q）再打开。预期：窗口、标签、分屏都和原来一样；几秒内每个窗格都回到原来的会话。
3. **崩溃**：先激活 iTerm2 再切到其他应用，使原生恢复状态保存，并核对保存的进程身份与当前窗格一致。然后在 iTerm2 以外的终端运行 `kill -9 <已核对的隔离-iTerm2-PID>`，再打开 iTerm2。预期同第 2 步。另测尚未保存就崩溃：iTerm2 可能恢复旧 shell，并把存活进程放到孤立终端窗口；Berth 不得为已在这些终端中显示的会话添加重复连接。分别记录布局恢复和连接安全，后者通过不代表布局恢复通过。
4. **状态**：运行 `berth stamp --session <会话名> state=waiting note="manual check"`。预期：该窗格的标签出现状态点和副标题 "manual check"；`state=` 可清除。
5. **重启**（可选）：重启电脑后打开 iTerm2。预期：布局恢复，每个会话被重建，agent 续接原对话。
6. 记录第 2、3、5 步窗格是否自动回到原会话；如果没有，说明 iTerm2 没有保留窗格的用户变量（见规格 §12）。

## V8：远程工作区

需要一个装了 tmux、能连上的远端：用 Remote-SSH 连 Linux 或 macOS 主机、Dev Container（需要 Docker 在运行），或 Windows 上的 WSL。每次发布任选其一即可，记下用的是哪种。使用可丢弃的远程账号或容器，独立配置代理目录、Berth 状态和测试 socket；独立的本地编辑器配置不能隔离远端，不在日常远程账号中执行这些步骤。在隔离的远程编辑器中将 `berth.tmuxSocket` 设为 `berth-test-remote`，下列 CLI 命令使用同一端点。

1. 让 VS Code 连上远端，并打开远端上的一个文件夹。
2. 把 Berth 装进这个远程窗口：在扩展视图里找到 Berth，点 *Install in SSH / Container / WSL*；或者在该窗口的终端里运行 `code --install-extension <vsix 文件>`。
3. 运行 **Berth: New Agent Session**。预期：会话建在远端的 tmux 上（在远端终端运行 `tmux -L berth-test-remote ls` 能看到），对应终端随之打开。
4. 重新加载窗口（**Developer: Reload Window**）。预期：该会话的终端自动重新打开，agent 仍在运行。
5. 切到其他应用，再在远端运行 `BERTH_TMUX_SOCKET=berth-test-remote berth stamp --session <会话名> state=done`。预期：编辑器内出现通知，这一行显示“完成”；远端服务器不运行系统通知程序。编辑器在前台时，完成状态只在列表显示，不额外弹通知。
6. 只清理隔离的远程会话：`tmux -L berth-test-remote kill-session -t =<会话名>`。

## 平台覆盖

分别记录客户端和执行宿主的操作系统。macOS/Linux 运行测试、Linux Xvfb
编辑器集成测试和 Windows 启动边界测试是不同证据。Linux 虚拟机能检验干净环境
中的依赖，不能证明 WSL 或 Remote-SSH 的断线重连行为。

没有其他测试机器时，完成可用的本机旅程和自动化矩阵；Windows 桌面、WSL、
远程重连、系统通知点击和 iTerm2 应用重启保留为未验证。独立 iTerm2 测试窗口
可以验证连接、窗格标记、断开及重连，不重启日常窗口；这不能代替 I5。

## 结果

| 用例 | 日期 | 环境 | 结果 | 备注 |
|---|---|---|---|---|
| V8 | | | | |
| V9 | | | | |
| I5 | | | | |


## 完整候选版的原生验收

使用独立编辑器配置和 `berth-test-*` tmux socket。开始前约定前台测试时间，
不要关闭或修改用户现有终端及对话。

1. 验证主终端、侧开、手工连接和仅当前窗口的 Detach；工作进程继续运行，其他宿主仍连接。
2. 用两个同名目录的不同工作区验证归属；重启独立编辑器后回到正确工作区。
   同一工作区开两个窗口时，只能有一个执行启动恢复。
3. 使用 Find a Session 搜索重名标题、无匹配和已移除对象；取消不改变当前终端。
4. 用鼠标和键盘进入详情，复制完整路径、对话 ID、标题并粘贴到临时文档。
   检查 Escape、焦点返回、缩放和读屏名称。仅调用剪贴板 API 不算端到端通过。
5. 对已记录版本的 agent 验证准确 ID 的恢复确认、错误 ID、缺少 hooks、目录移动、
   显式重试和结束。未知进程格式不能覆盖已有 ID。
6. 安装候选包后重跑关键旅程，记录包哈希、宿主与 agent 版本、结果及未支持环境。
   iTerm2 重启、机器重启和远程宿主单独记录，不用浏览器通过结果代替。
