# dsh-fingerprint-signature

面向 DeepSeek Harness（DSH）的指纹签名门。关键步骤调用插件后，浏览器会弹出系统验证器：Windows Hello、Touch ID，或当前平台提供的其它用户验证方式。

第一阶段提供配置面板：中文姓名、英文姓名、身份 ID、首次保存自动生成的 UUID、签名激活/禁用、设置本机验证，以及可重复携带到 AI 上下文的自定义 Key/Value 变量。工具名为 `dsh_fingerprint_signature`；把需要保护的工具名写入 `protectedTools` 后，可让每次成功确认只放行一个后续工具调用。

本 MVP 不判断设备上登记的是谁，也不读取或保存指纹数据。浏览器在本机完成用户验证，Host 检查待确认请求和已绑定的 credential ID。当前尚未在服务端保存公钥并验证 WebAuthn assertion 签名，因此上线前还需要补充可审计级的密码学校验。

```bash
npm install
npm run verify
```

本地开发安装到 DSH Web profile：

```bash
dsh plugin --profile web add link:/Users/ttpai/tayGit/dsh-fingerprint-signature
```

安装或重新构建后必须重启对应 DSH profile；仅刷新设置窗口不会重新加载插件的 Client 模块。重启后在“设置”左侧应出现“指纹签名”，如果安装了 Better Sidebar，同时会出现同名侧边栏 Tab。

如果仍不显示，先确认 `client.js` 已由 `npm run build:client` 生成，再重新执行上面的 `link:` 安装命令。
