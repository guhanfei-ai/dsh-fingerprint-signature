# dsh-fingerprint-signature

面向 DeepSeek Harness（DSH）的指纹签名门。关键步骤调用插件后，DSH Host 直接调用操作系统验证器：Windows Hello、Touch ID，或当前平台提供的其它用户验证方式。

> 这是轻量的早期人类确认实验。若需要把授权密码学绑定到 Agent 即将执行的具体动作，请看 [dsh-human-intent](https://github.com/guhanfei-ai/dsh-human-intent)。

设置页分为两块：**指纹功能**与**签名变量**。指纹功能默认关闭；点击“指纹功能激活”会立刻弹出系统验证，验证通过后才会保存当前签名变量并启用功能——“指纹功能禁用”同样需要一次系统验证。签名变量包含插件自带四项（中文姓名、英文姓名、身份 ID、首次激活时生成的 UUID）和自定义 Key/Value 变量；每次“保存变量（需指纹验证）”都要完成一次系统指纹验证，功能禁用状态下保存被直接拒绝。功能开启后，工具名为 `dsh_fingerprint_signature`，每次调用都会弹出系统验证：验证通过才把签名变量注入 AI 上下文，验证不通过或功能未开启时返回中文提示、要求 AI 终止相关操作。把需要保护的工具名写入 `protectedTools` 后，可让每次成功确认只放行一个后续工具调用。

本 MVP 不判断设备上登记的是谁，也不读取或保存指纹数据。原生小型桥接器只返回 `verified`、`cancelled`、`failed` 或 `unavailable` 状态；指纹、面容、PIN 等生物或本地凭据始终留在操作系统验证器内，不经过浏览器和 DSH API。

```bash
npm install
npm run verify
```

本地开发安装到 DSH Web profile：

```bash
dsh plugin --profile web add link:/absolute/path/to/dsh-fingerprint-signature
```

安装或重新构建后必须重启对应 DSH profile；仅刷新设置窗口不会重新加载插件的 Client 模块。macOS 可运行 `npm run build:native` 构建桥接器；Windows 可在 Windows 上运行同一命令生成自包含程序。重启后在“设置”左侧应出现“指纹签名”，如果安装了 Better Sidebar，同时会出现同名侧边栏 Tab。

如果仍不显示，先确认 `client.js` 已由 `npm run build:client` 生成，再重新执行上面的 `link:` 安装命令。
