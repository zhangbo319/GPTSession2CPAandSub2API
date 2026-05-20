#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const scriptPath = path.join(__dirname, "..", "userscript", "chatgpt-session-converter.user.js");
const source = fs.readFileSync(scriptPath, "utf8");

assert.match(source, /@name\s+ChatGPT Session Converter/);
assert.match(source, /@match\s+https:\/\/chatgpt\.com\//);
assert.doesNotMatch(source, /@require\s+https:\/\/zhangbo319\.github\.io\/GPTSession2CPAandSub2API\/converter\.js/);
assert.match(source, /@grant\s+GM_getValue/);
assert.match(source, /@grant\s+GM_setValue/);
assert.match(source, /@grant\s+GM_xmlhttpRequest/);
assert.match(source, /@connect\s+\*/);
assert.match(source, /\/api\/auth\/session/);
assert.match(source, /\/api\/v1\/auth\/login/);
assert.match(source, /\/api\/v1\/admin\/accounts\/data/);
assert.match(source, /GPTSessionConverter/);
assert.match(source, /function convertSession/);
assert.match(source, /buildSub2apiDocument/);
assert.doesNotMatch(source, /转换核心未加载，请确认 userscript 的 @require 地址可访问/);
assert.match(source, /同步导入 sub2api/);
assert.match(source, /sub2apiBaseUrl/);
assert.match(source, /sub2apiEmail/);
assert.match(source, /rememberSub2apiPassword/);
assert.match(source, /skip_default_group_bind/);
assert.match(source, /Authorization/);
assert.doesNotMatch(source, /Study1vDay/);
assert.doesNotMatch(source, /codex319@163\.com/);

console.log("userscript tests passed");
