# ChatGPT Automated Workflow Tool

<p align="center">
  一个基于 Chrome Extension Manifest V3 的网页自动化流程工具。<br>
  支持页面流程驱动、OAuth 授权、结果 JSON 导出、可选上传，以及可配置 selector / UI 动作步骤。
</p>

<p align="center">
  <img alt="Chrome Extension" src="https://img.shields.io/badge/Chrome-Extension-blue">
  <img alt="Manifest V3" src="https://img.shields.io/badge/Manifest-V3-green">
  <img alt="Configurable Selectors" src="https://img.shields.io/badge/Selectors-Configurable-orange">
</p>

---

## 目录

- [项目简介](#项目简介)
- [功能特性](#功能特性)
- [免责声明](#免责声明)
- [能力边界与环境建议](#能力边界与环境建议)
- [项目结构](#项目结构)
- [工作流程](#工作流程)
- [安装方式](#安装方式)
- [快速开始](#快速开始)
- [使用手册](#使用手册)
  - [1. 打开 Side Panel](#1-打开-side-panel)
  - [2. 基础设置](#2-基础设置)
  - [3. 主站选择器](#3-主站选择器)
  - [4. 认证页选择器](#4-认证页选择器)
  - [5. 三类 UI 动作步骤](#5-三类-ui-动作步骤)
  - [6. 邮箱 Provider 配置](#6-邮箱-provider-配置)
  - [7. OAuth 配置](#7-oauth-配置)
  - [8. 结果保存与上传](#8-结果保存与上传)
  - [9. 导入与导出配置](#9-导入与导出配置)
  - [10. 启动任务](#10-启动任务)
- [多轮运行说明](#多轮运行说明)
- [Selector 配置建议](#selector-配置建议)
- [常见问题](#常见问题)
- [项目截图占位](#项目截图占位)
- [打赏](#打赏)
- [开发说明](#开发说明)
- [License](#license)

---

## 项目简介

`ChatGPT Automated Workflow Tool` 是一个面向网页场景的 Chrome 扩展项目，用于自动驱动以下页面流程：

- 打开目标页面
- 自动填写邮箱、密码、验证码、用户名、生日
- 执行 OAuth 授权流程
- 提取 callback 信息并交换 token
- 导出结果 JSON
- 按配置可选上传结果文件

项目的核心设计目标是：

- 尽量把站点差异收敛为可配置 selector
- 把关键 UI 步骤交给 side panel 管理，而不是硬编码在流程里
- 支持不同邮箱 provider 的切换与维护
- 提供更清晰的阶段划分、结果记录与失败定位能力

---

## 功能特性

- 自动驱动 `chatgpt.com` 页面流程
- 自动处理 `auth.openai.com` 授权流程
- 自动填写：邮箱、密码、验证码、用户名、生日
- 自动读取邮箱验证码
- 支持多个邮箱 Provider 配置
- 支持最近运行结果展示
- 支持配置导入 / 导出
- 支持结果保存到本地 JSON
- 支持将结果上传到自定义接口
- 支持批量运行 / 多轮执行
- 支持 side panel 可视化维护 selector
- 支持以下三类可配置 UI 动作：
  - 退出登录前弹窗关闭
  - 注册成功后动作
  - 授权后动作

---

## 免责声明

### 用途说明

本项目仅用于学习、自动化测试、调试研究以及其他合法合规场景。

请仅在你有权控制、授权测试或允许研究的环境中使用本项目。

### 禁止用途

请勿将本项目用于以下用途：
- 批量垃圾注册
- 薅羊毛、刷号、滥用活动或其他不正当获利行为
- 违反目标平台服务条款的自动化操作
- 未经授权的测试、访问或批量操作
- 任何违反当地法律法规的用途

### 免责与合规责任

使用本项目所产生的一切风险、后果与责任均由使用者自行承担。

使用者应自行确保其使用行为符合适用法律法规、目标平台规则及服务条款；如因不当使用导致任何争议、损失或法律责任，项目作者与贡献者不承担任何责任。

---

## 能力边界与环境建议

### 当前未实现的能力

本项目当前**不包含**以下浏览器环境能力：

- 指纹生成
- 指纹篡改
- 代理管理
- 代理自动切换
- User-Agent / Canvas / WebGL / Audio / WebRTC / 时区等高级环境伪装

也就是说，本项目的重点是：
- 自动化流程编排
- selector 配置化
- 授权与结果导出

而不是浏览器环境对抗。

### 建议安装指纹扩展

由于本项目不处理浏览器指纹，建议你自行安装成熟的浏览器指纹扩展或环境管理工具，并根据自己的使用场景配置：

- User-Agent
- 时区
- 语言
- 分辨率
- Canvas / WebGL / Audio 指纹
- WebRTC
- 地理位置

### 建议开启全局代理

由于本项目不内置代理控制能力，建议在运行前：

- 先手动确认全局代理已开启
- 确认 `chatgpt.com`、`auth.openai.com`、邮箱 provider 均能正常访问
- 尽量保证一次完整注册流程中不要切换代理线路

否则容易出现：

- 页面加载失败
- OAuth 中断
- 邮件站点刷新异常
- 验证码读取不稳定
- callback / token 阶段失败

---

## 项目结构

```text
.
├─ background/        # Service Worker，负责流程编排
├─ content/           # 页面交互动作、selector 测试、页面侧逻辑
├─ sidepanel/         # Side Panel 配置界面
├─ lib/               # 公共逻辑、配置模型、token 交换
├─ icons/             # 扩展图标
├─ manifest.json      # Chrome 扩展清单
└─ README.md
```

主要文件说明：

- `manifest.json`：扩展清单与权限声明
- `background/background.js`：页面流程与授权主流程
- `content/content.js`：页面动作执行器
- `sidepanel/sidepanel.html`：配置面板结构
- `sidepanel/sidepanel.js`：配置面板逻辑
- `lib/config.js`：默认配置、迁移与配置模型
- `lib/token-exchange.js`：OAuth token 交换逻辑

---

## 工作流程

一次完整流程大致如下：

1. 打开或重建 `chatgpt.com` 页面
2. 检测当前登录状态
3. 若已登录，按配置先执行“退出登录前弹窗关闭”
4. 执行 logout，进入注册起点
5. 打开或复用邮箱 provider 页面
6. 生成新的随机邮箱
7. 回到 ChatGPT 注册页填写邮箱与密码
8. 切回邮箱页刷新收件箱并读取验证码
9. 回到注册页填写验证码
10. 填写用户名和生日并提交
11. 执行“注册成功后动作”
12. 进入 OAuth 授权流程
13. 必要时再次回邮箱页读取 OAuth 验证码
14. 完成 callback 与 token exchange
15. 执行“授权后动作”
16. 保存结果 JSON
17. 按配置可选上传文件

---

## 安装方式

### 开发者模式加载

1. 下载或克隆本仓库
2. 打开 Chrome，进入 `chrome://extensions/`
3. 打开右上角 **开发者模式**
4. 点击 **加载已解压的扩展程序**
5. 选择本项目根目录
6. 加载完成后，将扩展固定到工具栏
7. 打开 Side Panel 开始配置

---

## 快速开始

在第一次运行前，建议按下面顺序准备：

1. 打开浏览器全局代理
2. 安装并配置好你需要的指纹扩展
3. 加载本扩展
4. 打开 Side Panel
5. 配置邮箱 Provider
6. 验证主站与认证页的 selector
7. 检查三类 UI 动作步骤是否符合当前页面结构
8. 设置结果保存与上传选项
9. 点击“开始运行”

---

## 使用手册

### 1. 打开 Side Panel

扩展加载完成后，打开 Side Panel。

配置面板主要包含以下区域：

- 基础设置
- 主站选择器
- 认证页选择器
- 退出登录前弹窗关闭
- 注册成功后动作
- 授权后动作
- 邮箱 Providers
- OAuth 配置
- 结果保存
- 最近运行结果

---

### 2. 基础设置

#### 运行次数 `runCount`

- 控制连续执行多少轮
- 当大于 `1` 时，每轮会：
  - 重建 ChatGPT / Auth / callback 相关标签页
  - 尽量复用邮箱 provider 页面
  - 重新生成新的邮箱地址

#### 超时 `timeout`

- 单步操作默认超时时间
- 单位为秒
- 页面较慢时可以适当调大

#### 当前 Provider

- 从已配置邮箱 Provider 中选择本次运行使用的 Provider

---

### 3. 主站选择器

主站选择器对应 `chatgpt.com` 页面。

常见字段包括：

- 注册按钮
- 用户菜单
- 退出登录按钮
- 退出登录确认按钮
- 切换账号弹窗
- 切换账号弹窗关闭按钮
- 登录弹窗容器
- 登录邮箱输入框

如果页面结构变化，可直接在面板中修改这些 selector。

---

### 4. 认证页选择器

认证页选择器对应 `auth.openai.com` 页面。

常见字段包括：

- 邮箱输入框
- 邮箱提交按钮
- 密码输入框
- 验证码输入框
- 用户名输入框
- 生日输入框
- Continue 按钮
- OAuth 邮箱 / 密码 / 验证码 selector
- OAuth Continue 按钮
- callback 等待元素

---

### 5. 三类 UI 动作步骤

这三类步骤的目标是把流程中的关键页面差异从硬编码中抽离出来，统一交给配置面板管理。

#### 5.1 退出登录前弹窗关闭

用途：
- 在已登录状态下，logout 前如果有遮挡流程的弹窗，可以在这里配置关闭动作

行为规则：
- 检测不到元素：跳过
- 检测到并成功处理：继续执行 logout
- 检测到但处理失败：整次流程失败

推荐示例：

```css
button[data-testid="getting-started-button"]
```

#### 5.2 注册成功后动作

用途：
- 注册成功后，页面可能出现继续按钮、欢迎页按钮、确认弹窗按钮等

行为规则：
- 检测不到：跳过
- 检测到：尝试点击
- 失败或超时：仅记录日志，不阻断后续 OAuth

#### 5.3 授权后动作

用途：
- OAuth 完成后，如果页面还有确认步骤或结果弹窗，可以在这里处理

行为规则：
- 检测不到：跳过
- 检测到：必须成功处理
- 失败或超时：视为授权阶段失败

#### 步骤字段说明

每个步骤包含：

- `selector`：目标元素选择器
- `delayBeforeClick`：点击前延迟，单位毫秒
- `waitForChange`：点击后是否等待元素变化 / 弹窗关闭

建议：
- 如果按钮点击后应关闭弹窗，建议勾选 `waitForChange`
- 如果只是普通按钮且页面变化很快，可按实际情况设置

---

### 6. 邮箱 Provider 配置

你可以配置多个邮箱 provider，并在运行前选择其中一个。

每个 provider 包含：

- 名称
- URL
- 生成随机邮箱按钮
- 邮箱显示元素
- 收件箱操作按钮
- 邮件列表容器
- 邮件主题 selector

常见字段用途：

- `selGenEmailBtn`：生成或刷新一个新的邮箱地址
- `selEmailDisplay`：显示当前邮箱地址
- `selInboxAction`：刷新收件箱 / 拉取最新邮件
- `selEmailList`：邮件列表容器
- `selEmailSubject`：邮件主题元素

---

### 7. OAuth 配置

面板中会展示以下 OAuth 配置：

- Token URL
- Client ID
- Code Verifier
- Redirect URI

通常不建议随意修改，除非你明确知道你的目标流程要求。

---

### 8. 结果保存与上传

#### 本地保存

结果会保存为 JSON 文件到浏览器下载目录。

保存规则大致为：

```text
<download-folder>/<subfolder>/<sanitized_email>.json
```

#### 可选上传

你可以开启上传，并配置：

- Upload URL
- Bearer Token
- 上传超时

上传方式为：

- `multipart/form-data`
- 字段名固定为 `file`
- 请求头为 `Authorization: Bearer <token>`

---

### 9. 导入与导出配置

支持：

- 导出当前配置为 JSON
- 从 JSON 导入配置

适用场景：

- 备份当前配置
- 多机器迁移
- 多套 selector 模板切换

---

### 10. 启动任务

1. 打开 Side Panel
2. 检查 provider、selector 与动作步骤配置
3. 确认代理和指纹环境已准备好
4. 点击“开始运行”

运行过程中建议：

- 不要频繁手动切换标签页
- 不要中途切换代理线路
- 不要在关键页面上额外人工干预

---

## 多轮运行说明

当 `runCount >= 2` 时：

- 每轮开始前会关闭旧的：
  - `chatgpt.com`
  - `auth.openai.com`
  - callback 页
- 然后新建一个干净的 `chatgpt.com` 标签页
- 邮箱 provider 页面会尽量复用
- 每轮会重新生成新的随机邮箱

这样做的目的：
- 保持 ChatGPT / Auth 侧环境尽量干净
- 避免多轮执行时状态串扰
- 减少邮箱页重复打开带来的干扰

---

## Selector 配置建议

由于目标站点结构可能会变化，建议：

- 优先使用稳定属性：
  - `data-testid`
  - `name`
  - `aria-label`
- 尽量避免过深的层级路径
- 每次站点改版后重新测试关键 selector
- 对关键按钮尽量都留出配置入口
- 对弹窗关闭与后续确认步骤，优先使用独立步骤配置，不要依赖隐式逻辑

---

## 常见问题

### 1. 点击开始后没有反应

请检查：

- 当前页面是否已获得域名权限
- 目标站点是否可访问
- selector 是否配置正确
- 当前活动标签页是否属于受支持页面

### 2. 找不到元素

请检查：

- 页面是否改版
- selector 是否已过期
- 当前是否处于正确页面
- 是否有弹窗遮挡流程

### 3. 收不到验证码或总是超时

请检查：

- provider 是否可正常工作
- `selInboxAction` 是否能真正刷新列表
- `selEmailList` / `selEmailSubject` 是否正确
- 当前网络与代理是否稳定

### 4. 读到旧验证码

当前项目仍可能出现读取旧验证码的风险，这通常与邮箱 provider 的列表刷新策略有关。

建议：

- 尽量选择能稳定把最新邮件顶到顶部的 provider
- 适当优化 `selInboxAction`、`selEmailList`、`selEmailSubject`
- 在高频多轮运行时关注 provider 的刷新行为

### 5. OAuth 失败

请检查：

- `auth.openai.com` 相关 selector 是否正确
- callback 地址是否可用
- 授权后动作是否误配置
- 页面是否因代理或环境问题中断

### 6. 保存成功但上传失败

请检查：

- Upload URL 是否正确
- Token 是否正确
- 服务端是否接受 `multipart/form-data`
- 网络是否正常

---

## 项目截图占位

你可以在仓库中添加截图，例如：

```text
assets/preview-sidepanel.png
assets/preview-run-result.png
```

然后在 README 中加入：

```md
![Side Panel](assets/preview-sidepanel.png)
![Run Result](assets/preview-run-result.png)
```

---

## 打赏

如果这个项目对你有帮助，欢迎支持。

### 打赏图片占位

建议将图片放到：

```text
assets/donate-wechat.png
assets/donate-alipay.png
```

然后取消下面注释：

<!--
<p align="center">
  <img src="assets/donate-wechat.png" alt="WeChat Donate" width="280" />
  <img src="assets/donate-alipay.png" alt="Alipay Donate" width="280" />
</p>
-->

---

## 开发说明

当前项目基于：

- Chrome Extension Manifest V3
- Background Service Worker
- Content Script 页面驱动
- Side Panel 配置管理

如果你准备继续扩展，优先建议从以下方向入手：

- 指纹环境配置接入
- 代理切换接入
- 邮箱新邮件基线识别
- 更多邮箱 provider 模板
- 更细粒度的运行日志与调试能力
- 模板配置导入能力

---

## License

当前仓库尚未附带正式 License 文件。

如果你准备公开发布，建议补充一个标准 License，例如：

```text
MIT
```

并新增 `LICENSE` 文件。