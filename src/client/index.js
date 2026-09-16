// dsh-fingerprint-signature Web Client. 依照 dsh-mindmap 的侧边栏/设置页模式，
// 不直接写文件；所有配置和授权状态通过 Host 的 loopback 路由完成。
window.__ModuleLoader__.load({
  id: "dsh-fingerprint-signature",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    const React = require("react");
    const { createElement: h, useEffect, useState } = React;

    const API = "/fingerprint-signature/api";
    const emptyConfig = {
      zhName: "", enName: "", identityId: "", bindingUuid: "", signatureEnabled: false,
      customVariables: [], protectedTools: [],
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
      subgroup: { display: "flex", flexDirection: "column", gap: "8px" },
      divider: { border: 0, borderTop: "1px solid var(--dsw-alias-border-l2)", margin: "4px 0 0", width: "100%" },
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
      return h("div", { style: styles.subgroup },
        h("strong", null, "自定义变量"),
        h("p", { style: styles.muted }, "Key 不能为空且不能重复；密码、Token、私钥等敏感值不要放在这里。"),
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
      const [notice, setNotice] = useState(null);
      const [busy, setBusy] = useState("");
      async function reload() { try { setError(""); const state = await request("/state"); setConfig({ ...emptyConfig, ...state.config }); } catch (err) { setError(err.message); } }
      useEffect(() => { reload(); }, []);
      if (!config) return h("div", { style: styles.root }, h("p", { style: styles.muted }, error || "正在读取设置…"));
      function outcomeNotice(res) {
        if (res.status === "disabled") return { text: "指纹功能未激活：请先激活指纹功能，再保存变量。", tone: "info" };
        if (res.status === "cancelled") return { text: "已在系统验证窗口中取消：未保存任何改动。", tone: "info" };
        if (res.status === "unavailable") return { text: "系统验证器不可用：请先在本机构建原生 helper（npm run build:native），并确认系统已设置指纹或密码。", tone: "info" };
        if (res.status === "timeout" || res.status === "expired") return { text: "验证超时：未保存任何改动。", tone: "info" };
        return { text: `验证失败：未保存任何改动。${res.error ? `（${res.error}）` : ""}`, tone: "info" };
      }
      async function save() {
        if (!config.signatureEnabled) { setNotice({ text: "指纹功能未激活：请先激活指纹功能，再保存变量。", tone: "info" }); return; }
        setBusy("save"); setError(""); setNotice({ text: "已唤起系统验证，请在系统弹窗中完成 Touch ID / Windows Hello 验证…", tone: "info" });
        try {
          const result = await request("/settings", "POST", config);
          setConfig({ ...emptyConfig, ...result.config });
          setNotice(result.status === "verified"
            ? { text: "系统验证通过：签名变量已保存。", tone: "success" }
            : outcomeNotice(result));
        } catch (err) { setError(err.message); setNotice(null); } finally { setBusy(""); }
      }
      async function activate() {
        setBusy("activate"); setError(""); setNotice({ text: "已唤起系统验证，请在系统弹窗中完成 Touch ID / Windows Hello 验证…", tone: "info" });
        try {
          const result = await request("/activate", "POST", config);
          setConfig({ ...emptyConfig, ...result.config });
          setNotice(result.config.signatureEnabled
            ? { text: "系统验证通过：指纹功能已激活，当前签名变量已一并保存。", tone: "success" }
            : outcomeNotice(result));
        } catch (err) { setError(err.message); setNotice(null); } finally { setBusy(""); }
      }
      async function disable() {
        if (!config.signatureEnabled) { setNotice({ text: "指纹功能当前未激活。", tone: "info" }); return; }
        setBusy("deactivate"); setError(""); setNotice({ text: "已唤起系统验证，请在系统弹窗中完成 Touch ID / Windows Hello 验证…", tone: "info" });
        try {
          const result = await request("/deactivate", "POST");
          setConfig({ ...emptyConfig, ...result.config });
          setNotice(result.status === "noop"
            ? { text: "指纹功能在此前已被禁用，本次未弹出验证。", tone: "info" }
            : result.config.signatureEnabled === false
              ? { text: "系统验证通过：指纹功能已禁用，签名变量已保留。", tone: "success" }
              : outcomeNotice(result));
        } catch (err) { setError(err.message); setNotice(null); } finally { setBusy(""); }
      }
      const disabled = busy !== "";
      return h("div", { style: styles.root },
        h("h2", { style: styles.title }, "指纹签名"),
        h("p", { style: styles.muted }, "只确认系统用户验证是否成功，不判断设备上登记的是谁。"),
        h("div", { style: styles.group },
          h("strong", null, "指纹功能"),
          h("p", { style: styles.muted }, "激活后，AI 在关键步骤调用 dsh_fingerprint_signature 时会弹出系统验证，验证通过才会向 AI 注入签名变量。激活与禁用都需要本人完成一次系统验证；激活通过时会一并保存当前签名变量。"),
          h("div", { style: styles.badge }, h("span", { style: { ...styles.dot, background: config.signatureEnabled ? "var(--dsw-alias-state-positive-primary, #2a9d68)" : "var(--dsw-alias-label-tertiary)" } }), config.signatureEnabled ? "指纹功能已激活" : "指纹功能未激活"),
          h("div", { style: styles.row },
            h("button", { type: "button", style: { ...styles.button, ...styles.primary }, disabled, onClick: activate }, busy === "activate" ? "验证中…" : "指纹功能激活"),
            h("button", { type: "button", style: styles.button, disabled, onClick: disable }, busy === "deactivate" ? "验证中…" : "指纹功能禁用"),
          ),
        ),
        h("div", { style: styles.group },
          h("strong", null, "签名变量"),
          h("p", { style: styles.muted }, "指纹验证通过后，这些变量会随结果一起进入 AI 上下文：前四项是插件自带变量，下方可添加自定义变量。每次保存变量都需要完成一次系统指纹验证。"),
          field("中文姓名", config.zhName, (value) => setConfig({ ...config, zhName: value }), disabled, "用于在验证成功后标识你，填写常用中文姓名即可。"),
          field("英文姓名", config.enName, (value) => setConfig({ ...config, enName: value }), disabled, "用于需要英文显示的场景，填写英文姓名即可；没有可留空。"),
          field("身份 ID", config.identityId, (value) => setConfig({ ...config, identityId: value }), disabled, "这是自定义的身份 ID 标识，可以是工号、手机号，或者其它公司或组织内互相认可的 ID 字符串。"),
          h("div", { style: styles.label },
            h("span", { style: styles.fieldHead }, h("label", { htmlFor: "dsh-fingerprint-signature-field-uuid" }, "UUID"), h(InfoHint, { label: "UUID", text: "首次激活并通过系统验证时自动生成的唯一绑定标识，用来区分这份指纹签名配置；不需要手动修改。" })),
            h("input", { id: "dsh-fingerprint-signature-field-uuid", style: { ...styles.input, opacity: .7 }, value: config.bindingUuid || "首次激活时生成", readOnly: true, "aria-label": "UUID" }),
          ),
          h("hr", { style: styles.divider }),
          h(Variables, { value: config.customVariables, onChange: (customVariables) => setConfig({ ...config, customVariables }), disabled }),
          h("button", { type: "button", style: { ...styles.button, ...styles.primary }, disabled, onClick: save }, busy === "save" ? "验证中…" : "保存变量（需指纹验证）"),
        ),
        notice ? h("p", { style: notice.tone === "success" ? styles.success : styles.muted }, notice.text) : null,
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
      async function cancel() { if (current) await request("/cancel", "POST", { requestId: current.requestId }).catch(() => {}); }
      return h("div", { style: styles.root, "data-dsh-fingerprint-signature": "panel" },
        h("h2", { style: styles.title }, "指纹签名"),
        h("p", { style: styles.muted }, state.config?.signatureEnabled === false ? "指纹功能未开启：AI 调用工具会得到“指纹功能未开启，工具调用无效，无法读取签名变量”。" : "等待 AI 在关键步骤发起确认。"),
        current ? h("div", { style: styles.group }, h("strong", null, "待确认请求"), h("p", { style: styles.muted }, current.reason || "AI 请求继续执行关键操作"), h("p", { style: styles.muted }, "系统验证器已由 DSH Host 弹出，请完成验证；如需停止可以取消。"), h("div", { style: styles.row }, h("button", { type: "button", style: styles.button, onClick: cancel }, "取消"))) : h("p", { style: styles.muted }, "当前没有待处理的请求。"),
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
