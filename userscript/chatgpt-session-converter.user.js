// ==UserScript==
// @name         ChatGPT Session Converter
// @namespace    https://github.com/zhangbo319/GPTSession2CPAandSub2API
// @version      0.2.1
// @description  在 ChatGPT 页面一键读取 session，并本地转换为 sub2api / CPA / Cockpit / 9router / AxonHub JSON，可选同步导入 sub2api。
// @author       zhangbo319
// @match        https://chatgpt.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(() => {
  "use strict";

  const FORMAT_LABELS = {
    sub2api: "sub2api",
    cpa: "CPA",
    cockpit: "Cockpit",
    "9router": "9router",
    axonhub: "AxonHub",
  };
  const EMBEDDED_CONVERTER = (() => {
    const AXONHUB_PLACEHOLDER_REFRESH_TOKEN = "__missing_refresh_token__";

    function isPlainObject(value) {
      return Boolean(value) && typeof value === "object" && !Array.isArray(value);
    }

    function firstNonEmpty(...values) {
      for (const value of values) {
        if (typeof value === "string" && value.trim() !== "") {
          return value.trim();
        }
      }
      return undefined;
    }

    function decodeBase64Url(value) {
      const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
      const binary = atob(padded);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    }

    function bytesToBase64Url(bytes) {
      let binary = "";
      for (let index = 0; index < bytes.length; index += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
      }
      return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    }

    function encodeBase64UrlJson(value) {
      return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)));
    }

    function parseJwtPayload(token) {
      if (typeof token !== "string" || token.trim() === "") {
        return undefined;
      }
      const segments = token.split(".");
      if (segments.length < 2) {
        return undefined;
      }
      try {
        return JSON.parse(decodeBase64Url(segments[1]));
      } catch {
        return undefined;
      }
    }

    function getOpenAIAuthSection(payload) {
      if (!isPlainObject(payload)) {
        return {};
      }
      const auth = payload["https://api.openai.com/auth"];
      return isPlainObject(auth) ? auth : {};
    }

    function getOpenAIProfileSection(payload) {
      if (!isPlainObject(payload)) {
        return {};
      }
      const profile = payload["https://api.openai.com/profile"];
      return isPlainObject(profile) ? profile : {};
    }

    function normalizeTimestamp(value) {
      if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toISOString();
      }
      if (typeof value === "number" && Number.isFinite(value)) {
        const milliseconds = value > 1e11 ? value : value * 1000;
        const date = new Date(milliseconds);
        return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
      }
      if (typeof value !== "string" || value.trim() === "") {
        return undefined;
      }
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
    }

    function timestampFromUnixSeconds(value) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        return undefined;
      }
      const date = new Date(numeric * 1000);
      return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
    }

    function epochSecondsFromValue(value) {
      if (value === undefined || value === null || value === "") {
        return 0;
      }
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        return Math.trunc(numeric > 1e11 ? numeric / 1000 : numeric);
      }
      const parsed = Date.parse(String(value));
      return Number.isFinite(parsed) ? Math.trunc(parsed / 1000) : 0;
    }

    function getExpiresIn(expiresAt, now = new Date()) {
      if (!expiresAt) {
        return undefined;
      }
      const expiresMs = new Date(expiresAt).getTime();
      if (Number.isNaN(expiresMs)) {
        return undefined;
      }
      return Math.max(0, Math.floor((expiresMs - now.getTime()) / 1000));
    }

    function getAxonHubLastRefresh(expiresAt, now = new Date()) {
      const expiresMs = expiresAt ? new Date(expiresAt).getTime() : NaN;
      if (Number.isNaN(expiresMs)) {
        return normalizeTimestamp(now);
      }
      return new Date(expiresMs - 60 * 60 * 1000).toISOString();
    }

    function stripUnavailable(value) {
      if (Array.isArray(value)) {
        return value.map(stripUnavailable).filter((item) => item !== undefined);
      }
      if (isPlainObject(value)) {
        const entries = Object.entries(value)
          .map(([key, item]) => [key, stripUnavailable(item)])
          .filter(([, item]) => item !== undefined);
        return entries.length ? Object.fromEntries(entries) : undefined;
      }
      if (value === undefined || value === null || value === "") {
        return undefined;
      }
      return value;
    }

    function toEmailKey(email) {
      if (typeof email !== "string") {
        return undefined;
      }
      return email
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
    }

    function sanitizeFileToken(value, fallback = "chatgpt-session") {
      const base = firstNonEmpty(value, fallback) || fallback;
      return base
        .replace(/\.[^.]+$/u, "")
        .replace(/[\\/:*?"<>|]+/g, "-")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase()
        .slice(0, 80) || fallback;
    }

    function getTimestampToken(date = new Date()) {
      const pad = (value) => String(value).padStart(2, "0");
      return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate()),
      ].join("-") + "_" + [
        pad(date.getHours()),
        pad(date.getMinutes()),
        pad(date.getSeconds()),
      ].join("-");
    }

    function buildSyntheticCodexIdToken(email, accountId, planType, userId, expiresAt) {
      if (!accountId) {
        return undefined;
      }
      const now = Math.trunc(Date.now() / 1000);
      const authInfo = { chatgpt_account_id: accountId };
      const expires = epochSecondsFromValue(expiresAt) || now + 90 * 24 * 60 * 60;
      if (planType) {
        authInfo.chatgpt_plan_type = planType;
      }
      if (userId) {
        authInfo.chatgpt_user_id = userId;
        authInfo.user_id = userId;
      }
      const payload = {
        iat: now,
        exp: expires,
        "https://api.openai.com/auth": authInfo,
      };
      if (email) {
        payload.email = email;
      }
      return `${encodeBase64UrlJson({ alg: "none", typ: "JWT", cpa_synthetic: true })}.${encodeBase64UrlJson(payload)}.synthetic`;
    }

    function cleanObject(value) {
      return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null));
    }

    function convertSession(record, options = {}) {
      if (!isPlainObject(record)) {
        throw new Error("session 数据格式不正确。");
      }

      const accessToken = firstNonEmpty(
        record.accessToken,
        record.access_token,
        record.token?.access_token,
        record.tokens?.access_token,
        record.credentials?.access_token,
      );
      if (!accessToken) {
        throw new Error("session 中缺少 accessToken。");
      }

      const inputIdToken = firstNonEmpty(
        record.id_token,
        record.idToken,
        record.token?.id_token,
        record.tokens?.id_token,
        record.credentials?.id_token,
      );
      const accessPayload = parseJwtPayload(accessToken) || {};
      const idPayload = parseJwtPayload(inputIdToken) || {};
      const auth = getOpenAIAuthSection(accessPayload);
      const idAuth = getOpenAIAuthSection(idPayload);
      const profile = getOpenAIProfileSection(accessPayload);
      const exportedAt = normalizeTimestamp(options.now || new Date());
      const sourceName = firstNonEmpty(options.sourceName, "chatgpt-session-api");
      const expiresAt = firstNonEmpty(
        normalizeTimestamp(record.expires),
        normalizeTimestamp(record.expired),
        normalizeTimestamp(record.expiresAt),
        timestampFromUnixSeconds(record.expires_in ? Math.trunc(Date.now() / 1000) + Number(record.expires_in) : undefined),
        timestampFromUnixSeconds(accessPayload.exp),
        timestampFromUnixSeconds(idPayload.exp),
      );
      const accountId = firstNonEmpty(
        record.account?.id,
        record.account_id,
        record.chatgpt_account_id,
        record.credentials?.chatgpt_account_id,
        record.providerSpecificData?.chatgptAccountId,
        auth.chatgpt_account_id,
        idAuth.chatgpt_account_id,
      );
      const userId = firstNonEmpty(
        record.user?.id,
        record.user_id,
        record.chatgpt_user_id,
        record.credentials?.chatgpt_user_id,
        auth.chatgpt_user_id,
        auth.user_id,
        idAuth.chatgpt_user_id,
        idAuth.user_id,
      );
      const email = firstNonEmpty(
        record.user?.email,
        record.email,
        record.credentials?.email,
        accessPayload.email,
        idPayload.email,
        profile.email,
      );
      const planType = firstNonEmpty(
        record.account?.planType,
        record.account?.plan_type,
        record.planType,
        record.plan_type,
        record.credentials?.plan_type,
        record.providerSpecificData?.chatgptPlanType,
        auth.chatgpt_plan_type,
        idAuth.chatgpt_plan_type,
      );
      const sessionToken = firstNonEmpty(record.sessionToken, record.session_token, record.credentials?.session_token);
      const refreshToken = firstNonEmpty(record.refreshToken, record.refresh_token, record.tokens?.refresh_token, record.credentials?.refresh_token);
      const name = firstNonEmpty(email, sourceName, "ChatGPT Account");
      const syntheticIdToken = !inputIdToken
        ? buildSyntheticCodexIdToken(email, accountId, planType, userId, expiresAt)
        : undefined;
      const idToken = firstNonEmpty(inputIdToken, syntheticIdToken);

      const cpa = cleanObject({
        type: "codex",
        account_id: accountId,
        chatgpt_account_id: accountId,
        email,
        name,
        plan_type: planType,
        chatgpt_plan_type: planType,
        id_token: idToken,
        id_token_synthetic: Boolean(syntheticIdToken) || undefined,
        access_token: accessToken,
        refresh_token: refreshToken || "",
        session_token: sessionToken,
        last_refresh: exportedAt,
        expired: expiresAt,
      });
      const cockpit = {
        type: "codex",
        id_token: idToken,
        access_token: accessToken,
        refresh_token: refreshToken || "",
        account_id: accountId,
        last_refresh: exportedAt,
        email,
        expired: expiresAt,
      };
      const sub2apiAccount = stripUnavailable({
        name,
        platform: "openai",
        type: "oauth",
        concurrency: 10,
        priority: 1,
        credentials: {
          access_token: accessToken,
          chatgpt_account_id: accountId,
          chatgpt_user_id: userId,
          email,
          expires_at: expiresAt,
          expires_in: getExpiresIn(expiresAt, options.now || new Date()),
          plan_type: planType,
        },
        extra: {
          email,
          email_key: toEmailKey(email),
          name,
          source: "chatgpt_web_session",
          last_refresh: exportedAt,
        },
      });
      const nineRouter = stripUnavailable({
        accessToken,
        refreshToken,
        expiresAt,
        expiresIn: getExpiresIn(expiresAt, options.now || new Date()),
        providerSpecificData: {
          chatgptAccountId: accountId,
          chatgptPlanType: planType,
        },
        id: accountId,
        provider: "codex",
        authType: "oauth",
        name,
        email,
        priority: 9,
        isActive: true,
        createdAt: exportedAt,
        updatedAt: exportedAt,
      });
      const axonHubRefreshToken = refreshToken || AXONHUB_PLACEHOLDER_REFRESH_TOKEN;
      const axonHub = stripUnavailable({
        auth_mode: "chatgpt",
        last_refresh: getAxonHubLastRefresh(expiresAt, options.now || new Date()),
        tokens: {
          access_token: accessToken,
          refresh_token: axonHubRefreshToken,
          id_token: idToken,
        },
        axonhub_refresh_token_placeholder: refreshToken ? undefined : true,
        axonhub_note: refreshToken ? undefined : "refresh_token is a placeholder; access_token works only until it expires.",
      });

      return {
        sourceName,
        email,
        name,
        expiresAt,
        cpa,
        cockpit,
        nineRouter,
        axonHub,
        sub2apiAccount,
      };
    }

    function buildSub2apiDocument(converted, now = new Date()) {
      return {
        exported_at: normalizeTimestamp(now),
        proxies: [],
        accounts: converted.map((item) => item.sub2apiAccount),
      };
    }

    return {
      AXONHUB_PLACEHOLDER_REFRESH_TOKEN,
      buildSub2apiDocument,
      convertSession,
      firstNonEmpty,
      getTimestampToken,
      normalizeTimestamp,
      sanitizeFileToken,
    };
  })();
  globalThis.GPTSessionConverter = globalThis.GPTSessionConverter || EMBEDDED_CONVERTER;
  const STORAGE_KEYS = {
    sub2apiBaseUrl: "sub2apiBaseUrl",
    sub2apiEmail: "sub2apiEmail",
    sub2apiPassword: "sub2apiPassword",
    rememberSub2apiPassword: "rememberSub2apiPassword",
  };
  const state = {
    format: "sub2api",
    busy: false,
    syncing: false,
    lastOutput: "",
    config: loadConfig(),
  };

  function getStoredValue(key, fallback = "") {
    if (typeof GM_getValue === "function") {
      return GM_getValue(key, fallback);
    }
    return fallback;
  }

  function setStoredValue(key, value) {
    if (typeof GM_setValue === "function") {
      GM_setValue(key, value);
    }
  }

  function loadConfig() {
    const remember = Boolean(getStoredValue(STORAGE_KEYS.rememberSub2apiPassword, false));
    return {
      sub2apiBaseUrl: String(getStoredValue(STORAGE_KEYS.sub2apiBaseUrl, "")),
      sub2apiEmail: String(getStoredValue(STORAGE_KEYS.sub2apiEmail, "")),
      sub2apiPassword: remember ? String(getStoredValue(STORAGE_KEYS.sub2apiPassword, "")) : "",
      rememberSub2apiPassword: remember,
    };
  }

  function saveConfig(config) {
    setStoredValue(STORAGE_KEYS.sub2apiBaseUrl, config.sub2apiBaseUrl);
    setStoredValue(STORAGE_KEYS.sub2apiEmail, config.sub2apiEmail);
    setStoredValue(STORAGE_KEYS.rememberSub2apiPassword, Boolean(config.rememberSub2apiPassword));
    setStoredValue(STORAGE_KEYS.sub2apiPassword, config.rememberSub2apiPassword ? config.sub2apiPassword : "");
    state.config = { ...config };
  }

  function showToast(message, tone = "info") {
    const toast = document.createElement("div");
    toast.textContent = message;
    toast.style.cssText = [
      "position:fixed",
      "right:18px",
      "bottom:18px",
      "z-index:2147483647",
      "max-width:min(420px,calc(100vw - 36px))",
      "padding:11px 13px",
      "border-radius:8px",
      "font:13px/1.45 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
      "color:#fff",
      `background:${tone === "error" ? "#a33b3b" : tone === "ok" ? "#1e6b50" : "#24505a"}`,
      "box-shadow:0 12px 34px rgba(0,0,0,.22)",
    ].join(";");
    document.body.append(toast);
    setTimeout(() => toast.remove(), tone === "error" ? 5200 : 2600);
  }

  function getConverter() {
    const converter = globalThis.GPTSessionConverter || window.GPTSessionConverter || EMBEDDED_CONVERTER;
    if (!converter) {
      throw new Error("转换核心不可用，请重新安装最新版本 userscript。");
    }
    return converter;
  }

  async function fetchSession() {
    const response = await fetch("/api/auth/session", {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`读取 ChatGPT session 失败：HTTP ${response.status}`);
    }
    const session = await response.json();
    if (!session || !session.accessToken) {
      throw new Error("当前页面没有读取到 accessToken，请确认已登录 ChatGPT。");
    }
    return session;
  }

  function buildOutput(converter, converted, format) {
    if (format === "sub2api") {
      return converter.buildSub2apiDocument([converted]);
    }
    if (format === "cpa") {
      return converted.cpa;
    }
    if (format === "cockpit") {
      return converted.cockpit;
    }
    if (format === "9router") {
      return converted.nineRouter;
    }
    if (format === "axonhub") {
      return converted.axonHub;
    }
    return converter.buildSub2apiDocument([converted]);
  }

  function buildSub2apiImportDocument(converter, converted) {
    return converter.buildSub2apiDocument([converted]);
  }

  async function copyText(text) {
    if (typeof GM_setClipboard === "function") {
      GM_setClipboard(text, "text");
      return;
    }
    await navigator.clipboard.writeText(text);
  }

  function downloadText(text, converter, converted, format) {
    const base = converter.sanitizeFileToken(converted.email || converted.name || format);
    const filename = `${base}.${format}.${converter.getTimestampToken()}.json`;
    const blob = new Blob([text], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function generate({ download = false } = {}) {
    if (state.busy) {
      return;
    }
    state.busy = true;
    updateButtonLabel("处理中...");
    try {
      const converter = getConverter();
      const session = await fetchSession();
      const converted = converter.convertSession(session, {
        sourceName: "chatgpt-session-api",
      });
      const output = JSON.stringify(buildOutput(converter, converted, state.format), null, 2);
      state.lastOutput = output;
      if (download) {
        downloadText(output, converter, converted, state.format);
        showToast(`已下载 ${FORMAT_LABELS[state.format]} JSON`, "ok");
      } else {
        await copyText(output);
        showToast(`已复制 ${FORMAT_LABELS[state.format]} JSON`, "ok");
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "转换失败", "error");
    } finally {
      state.busy = false;
      updateButtonLabel();
    }
  }

  function normalizeBaseUrl(value) {
    const trimmed = String(value || "").trim().replace(/\/+$/g, "");
    if (!trimmed) {
      throw new Error("请先配置 sub2api 地址。");
    }
    if (!/^https?:\/\//i.test(trimmed)) {
      throw new Error("sub2api 地址必须以 http:// 或 https:// 开头。");
    }
    return trimmed;
  }

  function extractApiData(responseBody) {
    if (responseBody && typeof responseBody === "object" && "code" in responseBody) {
      if (responseBody.code === 0) {
        return responseBody.data;
      }
      throw new Error(responseBody.message || "sub2api 接口返回失败。");
    }
    return responseBody;
  }

  function requestJson({ method = "GET", url, headers = {}, body }) {
    if (typeof GM_xmlhttpRequest !== "function") {
      throw new Error("当前油猴环境不支持 GM_xmlhttpRequest，无法跨域同步到 sub2api。");
    }

    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...headers,
        },
        data: body === undefined ? undefined : JSON.stringify(body),
        timeout: 30000,
        responseType: "json",
        onload: (response) => {
          const status = Number(response.status || 0);
          let payload = response.response;
          if (payload === null || payload === undefined) {
            try {
              payload = response.responseText ? JSON.parse(response.responseText) : undefined;
            } catch {
              payload = response.responseText;
            }
          }

          if (status < 200 || status >= 300) {
            const message = payload && typeof payload === "object"
              ? payload.message || payload.detail || payload.error
              : String(payload || "");
            reject(new Error(`sub2api 请求失败：HTTP ${status}${message ? `，${message}` : ""}`));
            return;
          }

          try {
            resolve(extractApiData(payload));
          } catch (error) {
            reject(error);
          }
        },
        onerror: () => reject(new Error("sub2api 请求失败，请检查地址、网络或油猴 @connect 权限。")),
        ontimeout: () => reject(new Error("sub2api 请求超时，请检查服务是否可访问。")),
      });
    });
  }

  async function loginSub2api(config) {
    const baseUrl = normalizeBaseUrl(config.sub2apiBaseUrl);
    const email = String(config.sub2apiEmail || "").trim();
    const password = String(config.sub2apiPassword || "");
    if (!email) {
      throw new Error("请先配置 sub2api 管理员邮箱。");
    }
    if (!password) {
      throw new Error("请输入 sub2api 管理员密码。");
    }

    const data = await requestJson({
      method: "POST",
      url: `${baseUrl}/api/v1/auth/login`,
      body: { email, password },
    });
    if (data && data.requires_2fa) {
      throw new Error("sub2api 当前账号启用了 2FA，油猴脚本暂不支持自动登录 2FA。");
    }
    if (!data || !data.access_token) {
      throw new Error("sub2api 登录成功响应中没有 access_token。");
    }
    return data.access_token;
  }

  async function importToSub2api(config, data, token) {
    const baseUrl = normalizeBaseUrl(config.sub2apiBaseUrl);
    return requestJson({
      method: "POST",
      url: `${baseUrl}/api/v1/admin/accounts/data`,
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: {
        data,
        skip_default_group_bind: true,
      },
    });
  }

  function summarizeImportResult(result) {
    if (!result || typeof result !== "object") {
      return "同步导入已提交。";
    }
    const accountCreated = Number(result.account_created || 0);
    const accountFailed = Number(result.account_failed || 0);
    const proxyCreated = Number(result.proxy_created || 0);
    const proxyFailed = Number(result.proxy_failed || 0);
    return `导入完成：账号新增 ${accountCreated}，账号失败 ${accountFailed}，代理新增 ${proxyCreated}，代理失败 ${proxyFailed}`;
  }

  async function syncToSub2api() {
    if (state.syncing) {
      return;
    }
    if (state.format !== "sub2api") {
      showToast("只有选择 sub2api 格式时才支持同步导入。", "error");
      return;
    }

    const config = readConfigFromPanel();
    saveConfig(config);
    state.syncing = true;
    updateSyncButtonLabel("同步中...");
    try {
      const converter = getConverter();
      const session = await fetchSession();
      const converted = converter.convertSession(session, {
        sourceName: "chatgpt-session-api",
      });
      const data = buildSub2apiImportDocument(converter, converted);
      const token = await loginSub2api(config);
      const result = await importToSub2api(config, data, token);
      showToast(summarizeImportResult(result), "ok");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "同步导入 sub2api 失败", "error");
    } finally {
      state.syncing = false;
      updateSyncButtonLabel();
    }
  }

  function updateButtonLabel(text) {
    const button = document.querySelector("#gpt-session-converter-run");
    if (button) {
      button.textContent = text || `生成 ${FORMAT_LABELS[state.format]}`;
      button.disabled = state.busy;
    }
    updateSyncVisibility();
  }

  function updateSyncButtonLabel(text) {
    const button = document.querySelector("#gpt-session-converter-sync");
    if (button) {
      button.textContent = text || "同步导入 sub2api";
      button.disabled = state.syncing || state.busy;
    }
  }

  function updateSyncVisibility() {
    const section = document.querySelector("#gpt-session-converter-sub2api-config");
    if (section) {
      section.style.display = state.format === "sub2api" ? "grid" : "none";
    }
    updateSyncButtonLabel();
  }

  function createInput({ id, type = "text", placeholder = "", value = "" }) {
    const input = document.createElement("input");
    input.id = id;
    input.type = type;
    input.placeholder = placeholder;
    input.value = value;
    input.style.cssText = "height:30px;border:1px solid #d9e1e4;border-radius:6px;padding:0 8px;background:#fff;color:#142126;box-sizing:border-box;width:100%;";
    return input;
  }

  function createSmallButton(text) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    button.style.cssText = "height:32px;border:1px solid #d9e1e4;border-radius:6px;background:#f8fafb;color:#142126;cursor:pointer;";
    return button;
  }

  function readConfigFromPanel() {
    const baseUrl = document.querySelector("#gpt-session-converter-sub2api-url")?.value || "";
    const email = document.querySelector("#gpt-session-converter-sub2api-email")?.value || "";
    const password = document.querySelector("#gpt-session-converter-sub2api-password")?.value || "";
    const remember = Boolean(document.querySelector("#gpt-session-converter-sub2api-remember")?.checked);
    return {
      sub2apiBaseUrl: baseUrl.trim(),
      sub2apiEmail: email.trim(),
      sub2apiPassword: password,
      rememberSub2apiPassword: remember,
    };
  }

  function createSub2apiConfigSection() {
    const section = document.createElement("div");
    section.id = "gpt-session-converter-sub2api-config";
    section.style.cssText = "display:grid;gap:7px;border-top:1px solid #edf1f3;padding-top:8px;";

    const label = document.createElement("div");
    label.textContent = "sub2api 同步配置";
    label.style.cssText = "font-weight:800;font-size:12px;";

    const urlInput = createInput({
      id: "gpt-session-converter-sub2api-url",
      placeholder: "sub2api 地址，如 http://127.0.0.1:8080",
      value: state.config.sub2apiBaseUrl,
    });
    const emailInput = createInput({
      id: "gpt-session-converter-sub2api-email",
      type: "email",
      placeholder: "管理员邮箱",
      value: state.config.sub2apiEmail,
    });
    const passwordInput = createInput({
      id: "gpt-session-converter-sub2api-password",
      type: "password",
      placeholder: "管理员密码",
      value: state.config.sub2apiPassword,
    });

    const rememberLabel = document.createElement("label");
    rememberLabel.style.cssText = "display:flex;align-items:center;gap:6px;color:#64747c;font-size:12px;";
    const remember = document.createElement("input");
    remember.id = "gpt-session-converter-sub2api-remember";
    remember.type = "checkbox";
    remember.checked = state.config.rememberSub2apiPassword;
    const rememberText = document.createElement("span");
    rememberText.textContent = "记住密码（保存到油猴本地存储）";
    rememberLabel.append(remember, rememberText);

    const actions = document.createElement("div");
    actions.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:7px;";
    const save = createSmallButton("保存配置");
    save.addEventListener("click", () => {
      saveConfig(readConfigFromPanel());
      showToast("sub2api 配置已保存。", "ok");
    });
    const sync = createSmallButton("同步导入 sub2api");
    sync.id = "gpt-session-converter-sync";
    sync.style.background = "#1e6b50";
    sync.style.color = "#fff";
    sync.style.border = "0";
    sync.style.fontWeight = "800";
    sync.addEventListener("click", syncToSub2api);
    actions.append(save, sync);

    const note = document.createElement("div");
    note.textContent = "同步会登录 sub2api 并调用 /api/v1/admin/accounts/data。";
    note.style.cssText = "color:#64747c;font-size:12px;";

    section.append(label, urlInput, emailInput, passwordInput, rememberLabel, actions, note);
    return section;
  }

  function createPanel() {
    if (document.querySelector("#gpt-session-converter-panel")) {
      return;
    }

    const panel = document.createElement("div");
    panel.id = "gpt-session-converter-panel";
    panel.style.cssText = [
      "position:fixed",
      "right:16px",
      "top:88px",
      "z-index:2147483647",
      "display:grid",
      "gap:8px",
      "width:286px",
      "padding:10px",
      "border:1px solid rgba(20,33,38,.14)",
      "border-radius:8px",
      "background:#fff",
      "box-shadow:0 14px 36px rgba(0,0,0,.18)",
      "font:13px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
      "color:#142126",
    ].join(";");

    const title = document.createElement("div");
    title.textContent = "Session 一键转换";
    title.style.cssText = "font-weight:800;";

    const select = document.createElement("select");
    select.style.cssText = "height:32px;border:1px solid #d9e1e4;border-radius:6px;padding:0 8px;background:#fff;";
    Object.entries(FORMAT_LABELS).forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      select.append(option);
    });
    select.addEventListener("change", () => {
      state.format = select.value;
      updateButtonLabel();
      updateSyncVisibility();
    });

    const run = document.createElement("button");
    run.id = "gpt-session-converter-run";
    run.type = "button";
    run.style.cssText = "height:34px;border:0;border-radius:6px;background:#24505a;color:#fff;font-weight:800;cursor:pointer;";
    run.addEventListener("click", () => generate({ download: false }));

    const download = document.createElement("button");
    download.type = "button";
    download.textContent = "下载 JSON";
    download.style.cssText = "height:32px;border:1px solid #d9e1e4;border-radius:6px;background:#f8fafb;color:#142126;cursor:pointer;";
    download.addEventListener("click", () => generate({ download: true }));

    const sub2apiConfig = createSub2apiConfigSection();

    const note = document.createElement("div");
    note.textContent = "转换在本地完成；仅点击同步时请求你配置的 sub2api。";
    note.style.cssText = "color:#64747c;font-size:12px;";

    panel.append(title, select, run, download, sub2apiConfig, note);
    document.body.append(panel);
    updateButtonLabel();
    updateSyncVisibility();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", createPanel, { once: true });
  } else {
    createPanel();
  }
})();
