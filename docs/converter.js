(() => {
  const global = typeof globalThis !== "undefined" ? globalThis : window;

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

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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

function formatDisplayDate(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const pad = (item) => String(item).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function collectSessionLikeObjects(value, sourceName = "pasted-json") {
  const found = [];
  const visited = new WeakSet();

  function visit(item, path) {
    if (!isPlainObject(item) && !Array.isArray(item)) {
      return;
    }

    if (isPlainObject(item)) {
      if (visited.has(item)) {
        return;
      }
      visited.add(item);

      const token = firstNonEmpty(
        item.accessToken,
        item.access_token,
        item.token?.accessToken,
        item.token?.access_token,
        item.credentials?.accessToken,
        item.credentials?.access_token,
      );
      const hasIdentity = isPlainObject(item.user) || firstNonEmpty(
        item.email,
        item.name,
        item.providerSpecificData?.chatgptAccountId,
        item.providerSpecificData?.chatgpt_account_id,
        item.id,
      );
      if (token && hasIdentity) {
        found.push({ value: item, sourceName, path });
        return;
      }

      for (const [key, child] of Object.entries(item)) {
        if (key === "accessToken" || key === "access_token" || key === "sessionToken") {
  continue;
        }
        visit(child, `${path}.${key}`);
      }
      return;
    }

    item.forEach((child, index) => visit(child, `${path}[${index}]`));
  }

  visit(value, "$");
  return found;
}

function parseInputDocuments(text) {
  if (typeof text !== "string" || text.trim() === "") {
    return [];
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`JSON 解析失败：${error.message}`);
  }

  return collectSessionLikeObjects(parsed);
}

function convertSession(record, options = {}) {
  if (!isPlainObject(record)) {
    throw new Error("session 不是 JSON 对象");
  }

  const accessToken = firstNonEmpty(
    record.accessToken,
    record.access_token,
    record.token?.accessToken,
    record.token?.access_token,
    record.credentials?.accessToken,
    record.credentials?.access_token,
  );
  if (!accessToken) {
    throw new Error("缺少 accessToken");
  }
  const sessionToken = firstNonEmpty(
    record.sessionToken,
    record.session_token,
    record.token?.sessionToken,
    record.token?.session_token,
    record.credentials?.session_token,
  );
  const refreshToken = firstNonEmpty(
    record.refreshToken,
    record.refresh_token,
    record.token?.refreshToken,
    record.token?.refresh_token,
    record.credentials?.refresh_token,
  );
  const inputIdToken = firstNonEmpty(
    record.idToken,
    record.id_token,
    record.token?.idToken,
    record.token?.id_token,
    record.credentials?.id_token,
  );

  const payload = parseJwtPayload(accessToken);
  const idPayload = parseJwtPayload(inputIdToken);
  const auth = getOpenAIAuthSection(payload);
  const idAuth = getOpenAIAuthSection(idPayload);
  const profile = getOpenAIProfileSection(payload);
  const expiresAt = firstNonEmpty(
    payload ? timestampFromUnixSeconds(payload.exp) : undefined,
    normalizeTimestamp(record.expires),
    normalizeTimestamp(record.expiresAt),
    normalizeTimestamp(record.expired),
    normalizeTimestamp(record.expires_at),
  );
  const email = firstNonEmpty(
    record.user?.email,
    record.email,
    record.credentials?.email,
    record.providerSpecificData?.email,
    profile.email,
    idPayload?.email,
    payload?.email,
  );
  const accountId = firstNonEmpty(
    record.account?.id,
    record.account_id,
    record.chatgptAccountId,
    record.providerSpecificData?.chatgptAccountId,
    record.providerSpecificData?.chatgpt_account_id,
    record.credentials?.chatgpt_account_id,
    auth.chatgpt_account_id,
    idAuth.chatgpt_account_id,
    record.provider === "codex" ? record.id : undefined,
  );
  const userId = firstNonEmpty(
    record.user?.id,
    record.user_id,
    record.chatgptUserId,
    record.providerSpecificData?.chatgptUserId,
    record.providerSpecificData?.chatgpt_user_id,
    auth.chatgpt_user_id,
    auth.user_id,
    idAuth.chatgpt_user_id,
    idAuth.user_id,
  );
  const planType = firstNonEmpty(
    record.account?.planType,
    record.account?.plan_type,
    record.planType,
    record.plan_type,
    record.providerSpecificData?.chatgptPlanType,
    record.providerSpecificData?.chatgpt_plan_type,
    record.credentials?.plan_type,
    auth.chatgpt_plan_type,
    idAuth.chatgpt_plan_type,
  );
  const exportedAt = normalizeTimestamp(options.now || new Date());
  const expiresIn = getExpiresIn(expiresAt, options.now || new Date());
  const sourceName = firstNonEmpty(options.sourceName, "pasted-json");
  const sourceType = record.provider === "codex" && record.authType === "oauth" ? "9router" : "chatgpt_web_session";
  const name = firstNonEmpty(email, sourceName, "ChatGPT Account");
  const syntheticIdToken = !inputIdToken
    ? buildSyntheticCodexIdToken(email, accountId, planType, userId, expiresAt)
    : undefined;
  const idToken = firstNonEmpty(inputIdToken, syntheticIdToken);

  const cpa = Object.fromEntries(Object.entries({
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
    disabled: Boolean(record.disabled) || undefined,
  }).filter(([, value]) => value !== undefined && value !== null));

  const cockpit = {
    type: "codex",
    id_token: idToken,
    access_token: accessToken,
    refresh_token: refreshToken || "",
    account_id: accountId,
    last_refresh: exportedAt,
    email,
    expired: expiresAt,
    account_note: firstNonEmpty(record.account_note, record.accountInfo, record.account_info, record.note, record.notes, record.remark),
  };

  const sub2apiAccount = stripUnavailable({
    name: firstNonEmpty(name, email, sourceName, "ChatGPT Account"),
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
      expires_in: expiresIn,
      plan_type: planType,
    },
    extra: {
      email,
      email_key: toEmailKey(email),
      name,
      auth_provider: firstNonEmpty(record.authProvider, record.auth_provider),
      source: sourceType,
      last_refresh: exportedAt,
    },
  });
  const priority = Number.isFinite(Number(record.priority)) ? Number(record.priority) : 9;
  const isActive = typeof record.isActive === "boolean" ? record.isActive : !Boolean(record.disabled);
  const createdAt = normalizeTimestamp(record.createdAt) || exportedAt;
  const updatedAt = normalizeTimestamp(record.updatedAt) || exportedAt;
  const nineRouter = stripUnavailable({
    accessToken,
    refreshToken,
    expiresAt,
    testStatus: firstNonEmpty(record.testStatus, record.test_status, "active"),
    expiresIn,
    providerSpecificData: {
      chatgptAccountId: accountId,
      chatgptPlanType: planType,
    },
    id: accountId,
    provider: "codex",
    authType: "oauth",
    name,
    email,
    priority,
    isActive,
    createdAt,
    updatedAt,
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
    sourcePath: options.sourcePath,
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


const api = {
  AXONHUB_PLACEHOLDER_REFRESH_TOKEN,
  buildSub2apiDocument,
  collectSessionLikeObjects,
  convertSession,
  escapeHtml,
  firstNonEmpty,
  formatDisplayDate,
  getTimestampToken,
  normalizeTimestamp,
  parseInputDocuments,
  sanitizeFileToken,
};

if (typeof module === "object" && module.exports) {
  module.exports = api;
}

global.GPTSessionConverter = api;
})();
