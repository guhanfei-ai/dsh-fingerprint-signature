// dsh-fingerprint-signature Web Client. 依照 dsh-mindmap 的侧边栏/设置页模式，
// 不直接写文件；所有配置和授权状态通过 Host 的 loopback 路由完成。
window.__ModuleLoader__.load({
  id: "dsh-fingerprint-signature",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    const React = require("react");
    const { createElement: h, Fragment, useEffect, useMemo, useState } = React;

    const API = "/fingerprint-signature/api";
    const emptyConfig = {
      zhName: "", enName: "", identityId: "", bindingUuid: "", signatureEnabled: true,
      credentialId: "", rpId: "", customVariables: [], protectedTools: [],
    };

    const styles = {
      root: { display: "flex", flexDirection: "column", gap: "12px", padding: "14px", minHeight: "100%", boxSizing: "border-box", color: "var(--dsw-alias-label-primary)", fontSize: "13px" },
      title: { margin: 0, fontSize: "14px", fontWeight: 650 },
      muted: { margin: 0, color: "var(--dsw-alias-label-tertiary)", fontSize: "12px", lineHeight: 1.55 },
      group: { display: "flex", flexDirection: "column", gap: "8px", padding: "12px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "10px", background: "var(--dsw-alias-bg-layer-2, transparent)" },
      label: { display: "flex", flexDirection: "column", gap: "4px", color: "var(--dsw-alias-label-secondary)", fontSize: "12px" },
      fieldHead: { display: "inline-flex", alignItems: "center", gap: "4px" },
      hintWrap: { position: "relative", display: "inline-flex", alignItems: "center" },
      hint: { display: "inline-flex", alignItems: "center", justifyContent: "center", width: "16px", height: "16px", padding: 0, border: 0, borderRadius: "50%", background: "transparent", color: "var(--dsw-alias-label-tertiary)", cursor: "help", font: "inherit", fontSize: "11px", lineHeight: 1 },
      hintPopup: { position: "absolute", zIndex: 10, left: "50%", top: "calc(100% + 6px)", transform: "translateX(-50%)", width: "min(280px, calc(100vw - 48px))", boxSizing: "border-box", padding: "7px 9px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "7px", background: "var(--dsw-alias-bg-layer-3)", color: "var(--dsw-alias-label-primary)", boxShadow: "0 4px 14px rgba(0, 0, 0, .16)", fontSize: "12px", fontWeight: 400, lineHeight: 1.45, whiteSpace: "normal" },
      input: { width: "100%", boxSizing: "border-box", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "7px", background: "var(--dsw-alias-bg-layer-3)", color: "var(--dsw-alias-label-primary)", padding: "6px 8px", font: "inherit", fontSize: "13px" },
      row: { display: "flex", gap: "6px", alignItems: "center" },
      button: { border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "8px", padding: "6px 10px", background: "var(--dsw-alias-bg-layer-3)", color: "var(--dsw-alias-label-primary)", cursor: "pointer", font: "inherit", fontSize: "12px" },
      primary: { background: "var(--dsw-alias-state-business-primary)", color: "white", borderColor: "var(--dsw-alias-state-business-primary)" },
      danger: { color: "var(--dsw-alias-label-error)", borderColor: "var(--dsw-alias-label-error)" },
      badge: { display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "12px", color: "var(--dsw-alias-label-secondary)" },
      dot: { width: "7px", height: "7px", borderRadius: "50%", background: "var(--dsw-alias-state-positive-primary, #2a9d68)" },
      variableHead: { display: "grid", gridTemplateColumns: "1fr 1.4fr 28px", gap: "6px", color: "var(--dsw-alias-label-tertiary)", fontSize: "11px" },
      variableRow: { display: "grid", gridTemplateColumns: "1fr 1.4fr 28px", gap: "6px", alignItems: "center" },
      error: { margin: 0, color: "var(--dsw-alias-label-error)", fontSize: "12px", lineHeight: 1.5 },
      success: { margin: 0, color: "var(--dsw-alias-state-positive-primary, #2a9d68)", fontSize: "12px" },
    };

    async function request(path, method = "GET", value) {
      const response = await fetch(`${API}${path}`, {
        method,
        headers: value === undefined ? {} : { "content-type": "application/json" },
        body: value === undefined ? undefined : JSON.stringify(value),
      });
      const parsed = await response.json().catch(() => null);
      if (!response.ok || !parsed || parsed.ok !== true) throw new Error(parsed?.error || `HTTP ${response.status}`);
      return parsed;
    }

    function base64urlToBytes(value) {
      const text = String(value || "");
      const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
      const binary = atob(padded);
      return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    }

    function textBytes(value) { return new TextEncoder().encode(String(value || "")); }
    function bytesToBase64url(value) {
      const bytes = new Uint8Array(value);
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    }

    async function registerAuthenticator() {
      if (!navigator.credentials?.create) throw new Error("当前 DSH 页面不支持 WebAuthn");
      const { options } = await request("/register/options", "POST", {});
      const credential = await navigator.credentials.create({ publicKey: {
        challenge: textBytes(options.challenge),
        rp: { name: "DeepSeek Harness" },
        user: { id: textBytes(options.userId), name: options.userName || "dsh-user", displayName: options.userName || "dsh-user" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        authenticatorSelection: { userVerification: "required" },
        timeout: 120000,
      } });
      if (!credential) throw new Error("未完成验证器绑定");
      await request("/binding", "POST", { credentialId: bytesToBase64url(credential.rawId), rpId: options.rpId || location.hostname });
    }

    async function authorize(requestId) {
      if (!navigator.credentials?.get) throw new Error("当前 DSH 页面不支持 WebAuthn");
      const { options } = await request("/authorize/options", "POST", { requestId });
      if (!options.credentialId) throw new Error("尚未设置本机验证，请先完成设置");
      const credential = await navigator.credentials.get({ publicKey: {
        challenge: textBytes(options.challenge),
        rpId: options.rpId || location.hostname,
        allowCredentials: [{ type: "public-key", id: base64urlToBytes(options.credentialId) }],
        userVerification: "required",
        timeout: 120000,
      } });
      if (!credential) throw new Error("指纹签名未完成");
      await request("/verify", "POST", { requestId, verified: true, credentialId: bytesToBase64url(credential.rawId) });
    }

    function InfoHint({ label, text }) {
      const [open, setOpen] = useState(false);
      const tooltipId = `dsh-fingerprint-signature-hint-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
      return h("span", { style: styles.hintWrap, onMouseEnter: () => setOpen(true), onMouseLeave: () => setOpen(false) },
        h("button", {
          type: "button",
          style: styles.hint,
          "aria-label": `${label}说明`,
          "aria-expanded": open,
          "aria-describedby": tooltipId,
          onFocus: () => setOpen(true),
          onBlur: () => setOpen(false),
          onClick: () => setOpen(true),
          onKeyDown: (event) => { if (event.key === "Escape") { event.preventDefault(); setOpen(false); event.currentTarget.blur(); } },
        }, "ⓘ"),
        open ? h("span", { id: tooltipId, role: "tooltip", style: styles.hintPopup }, text) : null,
      );
    }

    function field(label, value, onChange, disabled, hint) {
      const inputId = `dsh-fingerprint-signature-field-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
      return h("div", { style: styles.label, key: label },
        h("span", { style: styles.fieldHead }, h("label", { htmlFor: inputId }, label), hint ? h(InfoHint, { label, text: hint }) : null),
        h("input", { id: inputId, style: styles.input, value: value || "", disabled, "aria-label": label, onChange: (event) => onChange(event.target.value) }),
      );
    }

    function shieldIcon(size = 18) {
      return h("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" },
        h("path", { d: "M12 3 20 6v5c0 4.8-3.1 8.9-8 10-4.9-1.1-8-5.2-8-10V6l8-3Z" }),
        h("path", { d: "m8.5 12 2.2 2.2 4.8-4.8" }),
      );
    }

    function registerSettingsNavIcon(label) {
      let disposed = false;
      const marker = "data-dsh-fingerprint-signature-settings-nav";
      const sync = () => {
        if (disposed) return;
        const currentLabel = String(label()).trim();
        document.querySelectorAll('[role="dialog"] nav button').forEach((button) => {
          if (currentLabel && button.textContent?.trim() === currentLabel) button.setAttribute(marker, "");
          else button.removeAttribute(marker);
        });
      };
      sync();
      const observer = new MutationObserver(sync);
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      return () => {
        disposed = true;
        observer.disconnect();
        document.querySelectorAll(`[${marker}]`).forEach((element) => element.removeAttribute(marker));
      };
    }

    function Variables({ value, onChange, disabled }) {
      const rows = Array.isArray(value) ? value : [];
      function update(index, patch) { onChange(rows.map((row, i) => i === index ? { ...row, ...patch } : row)); }
      return h("div", { style: styles.group },
        h("strong", null, "自定义变量"),
        h("p", { style: styles.muted }, "指纹签名成功后，这些变量会随结果进入 AI 上下文。"),
        h("div", { style: styles.variableHead }, h("span", null, "Key"), h("span", null, "Value"), h("span", null)),
        ...rows.map((row, index) => h("div", { style: styles.variableRow, key: row.id || index },
          h("input", { style: styles.input, value: row.key || "", disabled, onChange: (event) => update(index, { key: event.target.value }) }),
          h("input", { style: styles.input, value: row.value || "", disabled, onChange: (event) => update(index, { value: event.target.value }) }),
          h("button", { type: "button", style: { ...styles.button, ...styles.danger }, disabled, title: "删除变量", onClick: () => onChange(rows.filter((_, i) => i !== index)) }, "×"),
        )),
        h("button", { type: "button", style: styles.button, disabled, onClick: () => onChange([...rows, { id: `var_${Date.now()}_${rows.length}`, key: "", value: "" }]) }, "增加新变量"),
      );
    }

    function SettingsPanel() {
      const [config, setConfig] = useState(null);
      const [error, setError] = useState("");
      const [notice, setNotice] = useState("");
      const [saving, setSaving] = useState(false);
      async function reload() { try { setError(""); const state = await request("/state"); setConfig({ ...emptyConfig, ...state.config }); } catch (err) { setError(err.message); } }
      useEffect(() => { reload(); }, []);
      if (!config) return h("div", { style: styles.root }, h("p", { style: styles.muted }, error || "正在读取设置…"));
      async function save() { setSaving(true); setError(""); setNotice(""); try { const result = await request("/settings", "POST", config); setConfig(result.config); setNotice("变量已保存"); } catch (err) { setError(err.message); } finally { setSaving(false); } }
      async function bind() { setSaving(true); setError(""); try { await registerAuthenticator(); await reload(); setNotice("本机验证已设置"); } catch (err) { setError(err.message); } finally { setSaving(false); } }
      const disabled = saving;
      return h("div", { style: styles.root },
        h("h2", { style: styles.title }, "指纹签名"),
        h("p", { style: styles.muted }, "只确认系统用户验证是否成功，不判断设备上登记的是谁。"),
        h("div", { style: styles.group },
          h("div", { style: styles.badge }, h("span", { style: { ...styles.dot, background: config.signatureEnabled ? "var(--dsw-alias-state-positive-primary, #2a9d68)" : "var(--dsw-alias-label-tertiary)" } }), config.signatureEnabled ? "签名已激活" : "签名已禁用"),
          field("中文姓名", config.zhName, (value) => setConfig({ ...config, zhName: value }), disabled, "用于在验证成功后标识你，填写常用中文姓名即可。"),
          field("英文姓名", config.enName, (value) => setConfig({ ...config, enName: value }), disabled, "用于需要英文显示的场景，填写英文姓名即可；没有可留空。"),
          field("身份 ID", config.identityId, (value) => setConfig({ ...config, identityId: value }), disabled, "这是自定义的身份 ID 标识，可以是工号、手机号，或者其它公司或组织内互相认可的 ID 字符串。"),
          h("div", { style: styles.label },
            h("span", { style: styles.fieldHead }, h("label", { htmlFor: "dsh-fingerprint-signature-field-uuid" }, "UUID"), h(InfoHint, { label: "UUID", text: "这是系统自动生成的唯一绑定标识，用来区分这次指纹签名配置；一般不需要手动修改。" })),
            h("input", { id: "dsh-fingerprint-signature-field-uuid", style: { ...styles.input, opacity: .7 }, value: config.bindingUuid || "首次保存时生成", readOnly: true, "aria-label": "UUID" }),
          ),
          h("div", { style: styles.row },
            h("button", { type: "button", style: { ...styles.button, ...styles.primary }, disabled, onClick: () => setConfig({ ...config, signatureEnabled: true }) }, "签名激活"),
            h("button", { type: "button", style: styles.button, disabled, onClick: () => setConfig({ ...config, signatureEnabled: false }) }, "签名禁用"),
            h("button", { type: "button", style: styles.button, title: "使用本机的指纹、面容、PIN 或其它系统验证方式完成设置。", disabled, onClick: bind }, config.credentialId ? "重新设置本机验证" : "设置本机验证"),
          ),
        ),
        h(Variables, { value: config.customVariables, onChange: (customVariables) => setConfig({ ...config, customVariables }), disabled }),
        h("button", { type: "button", style: { ...styles.button, ...styles.primary }, disabled, onClick: save }, saving ? "保存中…" : "保存变量"),
        notice ? h("p", { style: styles.success }, notice) : null,
        error ? h("p", { style: styles.error }, error) : null,
      );
    }

    function SignaturePanel() {
      const [state, setState] = useState({ config: null, pending: [] });
      const [error, setError] = useState("");
      useEffect(() => {
        let alive = true;
        request("/state").then((value) => { if (alive) setState(value); }).catch((err) => { if (alive) setError(err.message); });
        const events = new EventSource(`${API}/events`);
        events.onmessage = (event) => { try { const message = JSON.parse(event.data); if (message.config || message.pending) setState((current) => ({ ...current, ...message })); if (message.type === "request-created") setState((current) => ({ ...current, pending: [...(current.pending || []).filter((item) => item.requestId !== message.requestId), message] })); if (message.type === "request-settled") setState((current) => ({ ...current, pending: (current.pending || []).filter((item) => item.requestId !== message.requestId) })); } catch { /* ignore malformed event */ } };
        events.onerror = () => events.close();
        return () => { alive = false; events.close(); };
      }, []);
      const current = state.pending?.[0];
      async function verify() { if (!current) return; setError(""); try { await authorize(current.requestId); } catch (err) { setError(err.message); await request("/cancel", "POST", { requestId: current.requestId }).catch(() => {}); } }
      async function cancel() { if (current) await request("/cancel", "POST", { requestId: current.requestId }).catch(() => {}); }
      return h("div", { style: styles.root, "data-dsh-fingerprint-signature": "panel" },
        h("h2", { style: styles.title }, "指纹签名"),
        h("p", { style: styles.muted }, state.config?.signatureEnabled === false ? "签名已禁用" : "等待 AI 在关键步骤发起确认。"),
        current ? h("div", { style: styles.group }, h("strong", null, "待确认请求"), h("p", { style: styles.muted }, current.reason || "AI 请求继续执行关键操作"), h("div", { style: styles.row }, h("button", { type: "button", style: { ...styles.button, ...styles.primary }, onClick: verify }, "立即确认"), h("button", { type: "button", style: styles.button, onClick: cancel }, "取消"))) : h("p", { style: styles.muted }, "当前没有待处理的请求。"),
        error ? h("p", { style: styles.error }, error) : null,
      );
    }

    function HeaderButton(props) {
      const { onOpen } = props;
      return h("button", { type: "button", title: "打开指纹签名", style: { border: 0, background: "none", color: "inherit", cursor: "pointer", font: "inherit", fontSize: "12px", padding: "2px 8px" }, onClick: () => onOpen?.() }, "◉ 指纹签名");
    }

    function apply(ctx) {
      if (typeof ctx.effect === "function") {
        ctx.effect(() => { const style = document.createElement("style"); style.textContent = "[data-dsh-fingerprint-signature] input:focus{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}[data-dsh-fingerprint-signature-settings-nav]>svg:first-child{display:none}[data-dsh-fingerprint-signature-settings-nav]::before{content:'';display:inline-flex;align-items:center;justify-content:center;flex:none;width:16px;height:16px;background:currentColor;-webkit-mask:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 3 20 6v5c0 4.8-3.1 8.9-8 10-4.9-1.1-8-5.2-8-10V6l8-3Z'/%3E%3Cpath d='m8.5 12 2.2 2.2 4.8-4.8'/%3E%3C/svg%3E\") center / contain no-repeat;mask:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 3 20 6v5c0 4.8-3.1 8.9-8 10-4.9-1.1-8-5.2-8-10V6l8-3Z'/%3E%3Cpath d='m8.5 12 2.2 2.2 4.8-4.8'/%3E%3C/svg%3E\") center / contain no-repeat}"; document.head.appendChild(style); return () => style.remove(); });
        ctx.effect(() => registerSettingsNavIcon(() => "指纹签名"));
      }
      if (typeof ctx.slots?.inject === "function") {
        ctx.slots.inject("settings.section", () => ctx.slots.register({ name: "settings.section", id: "dsh-fingerprint-signature", order: 105, label: "指纹签名", icon: shieldIcon }, SettingsPanel));
        const openPanel = () => { try { ctx.get?.("betterSidebar")?.open?.("dsh-fingerprint-signature:main"); } catch { /* optional sidebar */ } };
        ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({ name: "conversation.session.header.actions", id: "dsh-fingerprint-signature", order: 105, inject: () => ({ onOpen: openPanel }) }, HeaderButton));
      }
      if (typeof ctx.inject === "function") {
        try { ctx.inject(["betterSidebar"], (ctx2) => { const service = ctx2?.betterSidebar; if (!service?.registerTab) return; const dispose = service.registerTab({ id: "dsh-fingerprint-signature:main", title: () => "指纹签名", icon: shieldIcon, order: 105, single: true, component: SignaturePanel }); return () => dispose?.(); }); } catch { /* 旧 Host 无 Better Sidebar 时使用设置入口 */ }
      }
    }

    exports.apply = apply;
    exports.inject = ["slots"];
    return module.exports;
  },
});
