# ChatGPT Session to CPA / sub2api / Cockpit / 9router / AxonHub

纯前端单页面工具，用来把 ChatGPT Web 登录 session JSON 转换成 CPA、sub2api、Cockpit Tools、9router 或 AxonHub 可导入 JSON。

## 在线使用

### [**》》 点我直接使用 《《**](https://zhangbo319.github.io/GPTSession2CPAandSub2API/)

## 一键脚本使用

如果你希望获得类似篡改猴一键生成的体验，可以安装：

```text
userscript/chatgpt-session-converter.user.js
```

脚本从 `0.2.1` 起内置转换核心，不再依赖 GitHub Pages 的 `converter.js`。如果你看到 `转换核心未加载`，通常是 Tampermonkey 里仍在运行旧版本脚本，请删除旧脚本后重新安装本文件。

安装后打开 `https://chatgpt.com/`，页面右上角会出现 `Session 一键转换` 面板：

- 选择输出格式：`sub2api`、`CPA`、`Cockpit`、`9router` 或 `AxonHub`
- 点击 `生成 ...`：自动读取 `https://chatgpt.com/api/auth/session` 并复制 JSON 到剪贴板
- 点击 `下载 JSON`：自动生成并下载当前格式的 JSON 文件

### 同步导入 sub2api

选择 `sub2api` 格式后，面板会显示 `sub2api 同步配置`：

1. `sub2api 地址`：填写你的 sub2api 访问地址，例如 `http://your-sub2api-host:8080`。
2. `管理员邮箱`：填写 sub2api 后台管理员邮箱。
3. `管理员密码`：填写 sub2api 后台管理员密码。
4. 点击 `保存配置`：保存地址和邮箱；密码默认不保存。
5. 点击 `同步导入 sub2api`：脚本会读取当前 ChatGPT session，转换为 sub2api 账号导出 JSON，登录 sub2api 后调用 `/api/v1/admin/accounts/data` 完成导入。

如果你勾选 `记住密码`，密码会保存到 Tampermonkey 的本地脚本存储中。这个存储不是密码库，只建议在个人可信电脑上使用。

脚本声明了 `GM_xmlhttpRequest` 和 `@connect *`，用于从 `chatgpt.com` 页面跨域请求你配置的 sub2api 地址。除非点击 `同步导入 sub2api`，否则脚本只读取 `/api/auth/session` 并在本地转换，不会主动请求 sub2api。

当前同步流程依赖 sub2api 普通账号密码登录。如果 sub2api 管理员账号启用了 2FA、Turnstile 或其他登录保护，自动同步会失败，需要先在后台使用不带额外验证的管理账号，或后续补充对应验证流程。

## 使用提示

Plus 号可以用此方式导入中转站使用；Free 号的 access token 不能用于调用接口。

本工具可用来解决 Codex OAuth 登录需要绑定手机的问题。Plus 账号通过 Web 登录后的 session 就能生成可导入中转站的账号 JSON 数据；这类数据没有 `refresh_token`，但 `access_token` 有效期通常足够长。

解释一下： plus激活前（free状态）或激活后（plus状态）获取的session在使用上没有区别（free时拿到的session, 激活plus后就可以调模型了），只是账号级别标识有点区别（标识为free or plus），不影响调模型。 换句话讲，不管你啥时候拿到的session, 用本项目转换导入中转站，只要账号当前激活了plus, 就能正常调模型接口。

本工具主要针对 Plus 账号适用，Free 账号即使转换了也没有权限调用 GPT 模型。GoPay 拉闸了，没法每天发 Plus 了；加入 Discord 频道免费获取 GPT 撸羊毛信息，然后配合本工具导入 CPA or Sub2API 使用。

## GOAPY 拉闸了， Party is OVER ～ 
## **加入 Discord 频道免费获取 GPT 撸羊毛信息：**

### [**》》 加入 Discord 频道 《《**](https://discord.gg/GFmHY2TZNy)

邀请链接：`https://discord.gg/GFmHY2TZNy`


## 支持输入

支持粘贴或拖入 ChatGPT Web session JSON，例如包含：

- `user.email`
- `accessToken`
- `sessionToken`
- `expires`
- `account.id`
- `account.planType`

也支持粘贴或拖入 9router Codex OAuth JSON，例如包含 `accessToken`、`refreshToken`、`expiresAt`、`providerSpecificData.chatgptAccountId` 和 `providerSpecificData.chatgptPlanType`。

也支持粘贴或拖入 AxonHub Codex auth.json，例如包含 `tokens.access_token`、`tokens.refresh_token`、`tokens.id_token` 和 `last_refresh`。

页面也会尝试从 `accessToken` 的 JWT payload 中补充邮箱、账号 ID、用户 ID、计划类型和过期时间。

## 输出格式

- `CPA`：生成 Codex CPA auth JSON，包含 `type: "codex"`、`access_token`、`session_token`、`id_token`、`email`、`account_id`、套餐和过期时间等字段；缺少真实 `id_token` 时会根据 session 与 access token claims 构造 Codex 可解析的占位 JWT claims。
- `sub2api`：生成参考 `CPA2sub2API` 项目的 `exported_at/proxies/accounts` 结构，账号平台为 `openai`，类型为 `oauth`。
- `Cockpit`：生成 Cockpit Tools Codex JSON 导入可识别的扁平 token 格式，包含 `id_token`、`access_token`、`refresh_token`、`account_id`、`email`、`expired` 等字段。
- `9router`：生成 9router Codex OAuth JSON，包含 `accessToken`、`refreshToken`、`expiresAt`、`providerSpecificData`、`provider`、`authType`、`priority`、`isActive`、`createdAt` 和 `updatedAt` 等字段。
- `AxonHub`：生成 AxonHub Codex auth.json，包含 `auth_mode: "chatgpt"`、`last_refresh` 和 `tokens.access_token/refresh_token/id_token`。缺少真实 `refresh_token` 时会写入 `__missing_refresh_token__` 占位值，方便在 access token 过期前试用；过期后不能自动刷新。
ChatGPT Web session 通常不包含 OAuth 文件里常见的 `refresh_token`，因此 access token 过期后不能自动刷新。

## 本地使用

直接打开：

```text
docs/index.html
```

所有解析和转换都在浏览器本地完成，不上传 token，不写入本地存储。

## 开发验证

```bash
node tests/convert-session.test.js
node tests/userscript.test.js
```
