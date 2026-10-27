# 人工验收

[English](manual-acceptance.md) · **简体中文**

本文是英文版的译文，两者不一致时以英文版为准。

自动化测试覆盖不了的用例按本文手动验收：V8、V9，以及 I3 中需要在 iTerm2 里实际操作的部分（见[实现约定 §6](implementation.md#6-acceptance-cases)）。每次发布前都要做一遍，结果填进发布说明里的记录表。

开始前确认：tmux 版本 ≥ 3.0；已从发布页安装 `berth` 命令和 Berth 插件；装完插件后 VS Code 重新加载过窗口。测试会话一律以 `accept-` 开头命名，方便事后清理。

如果不想影响平时用的编辑器，可以把 VS Code 相关的验收放在一个独立实例里做：它有自己的用户目录和插件目录，插件从本地构建安装：

```sh
R=~/.berth-accept
code --user-data-dir $R/user --extensions-dir $R/ext --install-extension berth-vscode-<版本>.vsix
code --user-data-dir $R/user --extensions-dir $R/ext --new-window $R/work
```

命令行工具同样可以从本地安装：`npm install -g <berthdev-berth-<版本>.tgz 的路径>`。验收结束后删除 `~/.berth-accept`。

## V9：点击系统通知能回到编辑器

macOS 上需要先装 `terminal-notifier`（`brew install terminal-notifier`）。

1. 在 VS Code 里打开一个文件夹，运行 **Berth: New Agent Session**，任选一个 agent。会打开一个接到新会话的终端，记下会话名。
2. 切到别的应用，让 VS Code 不在前台。
3. 在任意终端里运行（换成刚才的会话名）：
   `berth stamp --session <会话名> state=waiting note="manual check"`
4. 预期：几秒内弹出系统通知，内容为 "Berth — <会话名> is waiting for you: manual check"。
5. 点击这条通知。预期：VS Code 回到前台，窗口内的通知提供 **Open** 按钮；点 **Open** 后切到该会话的终端。Berth 面板里这一行显示"等待"图标，面板标题上的数字为 1。
6. 清理：`tmux kill-session -t <会话名>`。

同时开着两个 VS Code 实例时，macOS 激活的是整个应用，被拉到前台的可能是另一个实例的窗口；这种情况也算通过。

## I3：iTerm2 自动接回属于它的会话

1. 运行 `berth iterm2 install`。如果 iTerm2 询问是否允许脚本使用 Python API，选允许。
2. 建两个会话，一个归 iTerm2，一个归 VS Code：
   `berth new claude --name accept-iterm --origin iterm2 --cwd ~`
   `berth new claude --name accept-code --origin vscode --cwd ~`
3. 运行 `berth snapshot`。
4. 退出 iTerm2（会话在 tmux 里继续运行）。确认没有终端接在 `accept-iterm` 上：`tmux list-clients -t accept-iterm` 没有输出。
5. 重新打开 iTerm2。预期：自动打开一个名为 "Berth: accept-iterm" 的标签并接上该会话；不会为 `accept-code` 打开标签。
6. 在另一个终端运行 `berth stamp --session accept-iterm state=waiting`。预期：该标签出现 "◐ waiting" 角标，标签变成琥珀色，同时弹出 iTerm2 通知。
7. 重启路径（可选，需要重启电脑）：重复第 2–3 步，重启电脑，打开 iTerm2。预期：`accept-iterm` 被重建并接上；如果之前记录过对话，会续接原对话。
8. 清理：`tmux kill-session -t accept-iterm; tmux kill-session -t accept-code; berth iterm2 uninstall`。

## V8：远程工作区

需要一个装了 tmux、能连上的远端：用 Remote-SSH 连 Linux 或 macOS 主机、Dev Container（需要 Docker 在运行），或 Windows 上的 WSL。每次发布任选其一即可，记下用的是哪种。

1. 让 VS Code 连上远端，并打开远端上的一个文件夹。
2. 把 Berth 装进这个远程窗口：在扩展视图里找到 Berth，点 *Install in SSH / Container / WSL*；或者在该窗口的终端里运行 `code --install-extension <vsix 文件>`。
3. 运行 **Berth: New Agent Session**。预期：会话建在远端的 tmux 上（在远端终端运行 `tmux ls` 能看到），对应终端随之打开。
4. 重新加载窗口（**Developer: Reload Window**）。预期：该会话的终端自动重新打开，agent 仍在运行。
5. 在远端终端运行 `berth stamp --session <会话名> state=done`。预期：编辑器内弹出通知，这一行显示"完成"。
6. 清理：在远端结束该会话。

## 记录

| 用例 | 日期 | 环境 | 结果 | 备注 |
|---|---|---|---|---|
| V8 | | | | |
| V9 | | | | |
| I3 | | | | |
