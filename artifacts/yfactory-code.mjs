#!/usr/bin/env node
/**
 * YFactory Code CLI — Autonomous Coding Agent (Claude Code Edition)
 * Zero dependencies (Node.js 18+ built-ins only).
 * Works in Replit Shell, VS Code, Cursor, Windsurf, Codespaces, JetBrains, and Termux.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const VERSION = "1.0.0";
const MAX_AGENT_STEPS = 14;
const CONFIG_DIR = path.join(os.homedir(), ".yfactory-code");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
const WORKSPACE_ROOT = process.cwd();
const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".cache",
  ".replit",
  "coverage",
  "__pycache__",
  ".venv",
]);

/* ==================== ANSI COLORS & TERMINAL UI ==================== */
const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  gold: "\x1b[38;5;220m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  gray: "\x1b[90m",
  white: "\x1b[97m",
};

const paint = (color, text) => `${color}${text}${C.reset}`;

function printBanner(state) {
  const modeBadge =
    state.mode === "plan"
      ? paint(C.cyan + C.bold, "PLAN MODE (read-only)")
      : paint(C.gold + C.bold, "AGENT MODE");
  const modelName = state.model?.modelName || "auto (best coding model)";
  console.log("");
  console.log(
    paint(C.gold + C.bold, "  ╔══════════════════════════════════════════════╗"),
  );
  console.log(
    paint(C.gold + C.bold, "  ║") +
      paint(C.white + C.bold, "   ⚡ YFACTORY CODE CLI  ") +
      paint(C.gray, `v${VERSION}               `) +
      paint(C.gold + C.bold, "║"),
  );
  console.log(
    paint(C.gold + C.bold, "  ╚══════════════════════════════════════════════╝"),
  );
  console.log(
    `  ${paint(C.dim, "Workspace:")} ${paint(C.white, path.basename(WORKSPACE_ROOT))} ${paint(C.gray, `(${WORKSPACE_ROOT})`)}`,
  );
  console.log(`  ${paint(C.dim, "Mode:")}      ${modeBadge}  ${paint(C.dim, "| Model:")} ${paint(C.cyan, modelName)}`);
  console.log(
    `  ${paint(C.gray, "Commands: /help /plan /agent /model /skills /init /diff /undo /compact /clear /exit")}`,
  );
  console.log(
    `  ${paint(C.gray, "Tip: Reference files directly with @path/to/file inside any prompt.")}`,
  );
  console.log("");
}

function startSpinner(label) {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let idx = 0;
  const timer = setInterval(() => {
    process.stdout.write(
      `\r${paint(C.gold, frames[idx++ % frames.length])} ${paint(C.dim, label)}   `,
    );
  }, 85);
  return () => {
    clearInterval(timer);
    process.stdout.write("\r\x1b[2K");
  };
}

/* ==================== CONFIG & API CLIENT ==================== */
function readConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return {};
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

function writeConfig(cfg) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n", {
    mode: 0o600,
  });
}

function defaultServerUrl() {
  if (process.env.YFACTORY_API_URL) {
    return process.env.YFACTORY_API_URL.replace(/\/+$/, "");
  }
  if (process.env.REPLIT_DEV_DOMAIN) {
    return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  }
  return "http://localhost:3000";
}

async function apiRequest(cfg, apiPath, init = {}) {
  const base = (cfg.serverUrl || defaultServerUrl()).replace(/\/+$/, "");
  const url = `${base}/api${apiPath}`;
  const resp = await fetch(url, {
    ...init,
    headers: {
      ...(cfg.sessionToken
        ? {
            Authorization: `Bearer ${cfg.sessionToken}`,
            "X-YFactory-Code-Token": cfg.sessionToken,
          }
        : {}),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  const text = await resp.text().catch(() => "");
  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    // non-JSON
  }
  if (!resp.ok) {
    const msg =
      typeof data.error === "string" && data.error
        ? data.error
        : `HTTP ${resp.status} calling ${apiPath}`;
    const err = new Error(msg);
    err.status = resp.status;
    err.code = data.code || `http_${resp.status}`;
    throw err;
  }
  return data;
}

/* ==================== WORKSPACE SAFETY & TOOLS ==================== */
function resolveSafePath(relPath) {
  const cleaned = String(relPath || ".").trim() || ".";
  const resolved = path.resolve(WORKSPACE_ROOT, cleaned);
  const rel = path.relative(WORKSPACE_ROOT, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Blocked path outside workspace: ${relPath}`);
  }
  return resolved;
}

function getGitBranch() {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: WORKSPACE_ROOT,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

function buildProjectTree(dir = WORKSPACE_ROOT, depth = 0, maxDepth = 3, budget = { count: 0 }) {
  if (depth > maxDepth || budget.count > 160) return [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  const lines = [];
  for (const ent of entries) {
    if (IGNORED_DIRS.has(ent.name)) continue;
    if (ent.name.startsWith(".") && ent.name !== ".env.example") continue;
    budget.count += 1;
    if (budget.count > 160) {
      lines.push(`${"  ".repeat(depth)}... (truncated)`);
      break;
    }
    const suffix = ent.isDirectory() ? "/" : "";
    lines.push(`${"  ".repeat(depth)}${ent.name}${suffix}`);
    if (ent.isDirectory() && depth < maxDepth) {
      lines.push(...buildProjectTree(path.join(dir, ent.name), depth + 1, maxDepth, budget));
    }
  }
  return lines;
}

function readYFactoryMd() {
  for (const name of ["YFACTORY.md", "CLAUDE.md"]) {
    const p = path.join(WORKSPACE_ROOT, name);
    if (fs.existsSync(p)) {
      try {
        return fs.readFileSync(p, "utf8").slice(0, 5000);
      } catch {
        // ignore
      }
    }
  }
  return "";
}

function toolListDir(args) {
  const target = resolveSafePath(args.path || ".");
  const maxDepth = Math.min(3, Math.max(1, Number(args.maxDepth) || 2));
  const tree = buildProjectTree(target, 0, maxDepth, { count: 0 });
  return tree.length ? tree.join("\n") : "(empty directory)";
}

function toolFindFiles(args) {
  const pattern = String(args.pattern || "").trim().toLowerCase();
  const maxResults = Math.min(60, Math.max(1, Number(args.maxResults) || 40));
  const rx = pattern
    ? new RegExp(
        pattern
          .replace(/[.+^${}()|[\]\\]/g, "\\$&")
          .replace(/\*/g, ".*")
          .replace(/\?/g, "."),
        "i",
      )
    : null;
  const matches = [];
  const walk = (dir) => {
    if (matches.length >= maxResults) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (matches.length >= maxResults) return;
      if (IGNORED_DIRS.has(ent.name)) continue;
      const full = path.join(dir, ent.name);
      const rel = path.relative(WORKSPACE_ROOT, full);
      if (ent.isDirectory()) {
        walk(full);
      } else if (!rx || rx.test(rel) || rx.test(ent.name)) {
        matches.push(rel);
      }
    }
  };
  walk(WORKSPACE_ROOT);
  return matches.length ? matches.join("\n") : "No matching files found.";
}

function toolGrepSearch(args) {
  const query = String(args.query || "").trim();
  if (!query) return "Error: query is required.";
  const root = resolveSafePath(args.path || ".");
  const flags = args.caseSensitive ? "g" : "gi";
  let rx;
  try {
    rx = args.isRegex
      ? new RegExp(query, flags)
      : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
  } catch (err) {
    return `Invalid regex: ${err.message}`;
  }

  const hits = [];
  const walk = (target) => {
    if (hits.length >= 60) return;
    let stat;
    try {
      stat = fs.statSync(target);
    } catch {
      return;
    }
    if (stat.isDirectory()) {
      for (const ent of fs.readdirSync(target, { withFileTypes: true })) {
        if (hits.length >= 60) return;
        if (IGNORED_DIRS.has(ent.name)) continue;
        walk(path.join(target, ent.name));
      }
      return;
    }
    if (stat.size > 350_000) return;
    let content;
    try {
      content = fs.readFileSync(target, "utf8");
    } catch {
      return;
    }
    if (content.includes("\0")) return;
    const rel = path.relative(WORKSPACE_ROOT, target);
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      if (rx.test(lines[i])) {
        hits.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 180)}`);
        if (hits.length >= 60) return;
      }
      rx.lastIndex = 0;
    }
  };
  walk(root);
  return hits.length ? hits.join("\n") : `No matches for "${query}".`;
}

function toolReadFile(args) {
  const target = resolveSafePath(args.path);
  if (!fs.existsSync(target)) return `Error: File not found: ${args.path}`;
  const stat = fs.statSync(target);
  if (stat.isDirectory()) return `Error: "${args.path}" is a directory.`;
  if (stat.size > 600_000) {
    return `Error: File too large (${stat.size} bytes). Use grep_search first.`;
  }
  const lines = fs.readFileSync(target, "utf8").split(/\r?\n/);
  const start = Math.max(1, Number(args.startLine) || 1);
  const end = Math.min(lines.length, Number(args.endLine) || start + 199);
  const sliced = lines
    .slice(start - 1, end)
    .map((line, i) => `${String(start + i).padStart(4, " ")} | ${line}`);
  const footer =
    end < lines.length
      ? `\n... (${lines.length - end} more lines — pass startLine=${end + 1} to continue)`
      : "";
  return `FILE: ${path.relative(WORKSPACE_ROOT, target)} (lines ${start}-${end} of ${lines.length})\n${sliced.join("\n")}${footer}`;
}

function printColoredDiff(oldText, newText, filePath) {
  console.log(paint(C.cyan + C.bold, `\n  ── Diff Preview: ${filePath} ──`));
  const oldLines = String(oldText || "").split(/\r?\n/);
  const newLines = String(newText || "").split(/\r?\n/);
  for (const l of oldLines.slice(0, 40)) {
    console.log(paint(C.red, `  - ${l}`));
  }
  if (oldLines.length > 40) console.log(paint(C.dim, `  ... (${oldLines.length - 40} more removed lines)`));
  for (const l of newLines.slice(0, 40)) {
    console.log(paint(C.green, `  + ${l}`));
  }
  if (newLines.length > 40) console.log(paint(C.dim, `  ... (${newLines.length - 40} more added lines)`));
  console.log("");
}

function isDangerousCommand(cmd) {
  return /(?:rm\s+-rf\s+\/|mkfs\.|dd\s+if=|git\s+push\s+.*--force|git\s+reset\s+--hard|shutdown|reboot)/i.test(
    cmd,
  );
}

/* ==================== UNDO STACK & PERMISSION GATE ==================== */
const undoStack = [];

function saveUndoSnapshot(absPath) {
  const existed = fs.existsSync(absPath);
  const prevContent = existed ? fs.readFileSync(absPath, "utf8") : null;
  undoStack.push({ absPath, existed, prevContent });
  if (undoStack.length > 25) undoStack.shift();
}

function performUndo() {
  const last = undoStack.pop();
  if (!last) {
    console.log(paint(C.yellow, "  Nothing to undo in this session."));
    return;
  }
  const rel = path.relative(WORKSPACE_ROOT, last.absPath);
  if (last.existed && last.prevContent !== null) {
    fs.writeFileSync(last.absPath, last.prevContent, "utf8");
    console.log(paint(C.green, `  ✓ Restored previous version of ${rel}`));
  } else if (!last.existed && fs.existsSync(last.absPath)) {
    fs.unlinkSync(last.absPath);
    console.log(paint(C.green, `  ✓ Removed newly created file ${rel}`));
  }
}

async function askPermission(rl, state, call) {
  if (call.tool === "edit_file") {
    printColoredDiff(call.args.oldText, call.args.newText, call.args.path);
  } else if (call.tool === "write_file") {
    const content = String(call.args.content || "");
    const lines = content.split(/\r?\n/).length;
    console.log(
      paint(C.cyan + C.bold, `\n  ── Write File: ${call.args.path} (${lines} lines) ──`),
    );
    for (const l of content.split(/\r?\n/).slice(0, 20)) {
      console.log(paint(C.green, `  + ${l}`));
    }
    if (lines > 20) console.log(paint(C.dim, `  ... (${lines - 20} more lines)`));
  } else if (call.tool === "delete_file") {
    console.log(paint(C.red + C.bold, `\n  ── Delete File: ${call.args.path} ──`));
  } else if (call.tool === "run_command") {
    const cmd = String(call.args.command || "");
    console.log(paint(C.yellow + C.bold, `\n  ── Run Command ──`));
    console.log(`  $ ${paint(C.white + C.bold, cmd)}`);
    if (isDangerousCommand(cmd)) {
      console.log(paint(C.red + C.bold, "  ⚠ WARNING: Potentially destructive command detected!"));
    }
  }

  if (call.reason) {
    console.log(paint(C.dim, `  Reason: ${call.reason}`));
  }

  if (state.autoApprove && call.tool !== "delete_file" && !isDangerousCommand(String(call.args.command || ""))) {
    console.log(paint(C.green, "  ✓ Auto-approved (session policy)"));
    return true;
  }

  const ans = (
    await rl.question(
      paint(C.gold, "  Allow? ") +
        paint(C.dim, "[y] yes  [a] allow all this session  [n] no: "),
    )
  )
    .trim()
    .toLowerCase();

  if (ans === "a" || ans === "all") {
    state.autoApprove = true;
    return true;
  }
  return ans === "y" || ans === "yes" || ans === "";
}

async function executeToolCall(rl, state, call) {
  const { tool, args } = call;

  if (!call.mutating) {
    console.log(
      `  ${paint(C.cyan, "▸")} ${paint(C.bold, tool)} ${paint(C.gray, JSON.stringify(args).slice(0, 120))}`,
    );
    try {
      if (tool === "list_dir") return toolListDir(args);
      if (tool === "find_files") return toolFindFiles(args);
      if (tool === "grep_search") return toolGrepSearch(args);
      if (tool === "read_file") return toolReadFile(args);
      return `Unknown read tool: ${tool}`;
    } catch (err) {
      return `Tool error (${tool}): ${err.message}`;
    }
  }

  if (state.mode === "plan") {
    return "Blocked: currently in PLAN MODE (read-only).";
  }

  const ok = await askPermission(rl, state, call);
  if (!ok) {
    console.log(paint(C.red, `  ✕ Rejected ${tool}`));
    return `User rejected ${tool}. Explain alternatives or ask how to proceed.`;
  }

  try {
    if (tool === "edit_file") {
      const target = resolveSafePath(args.path);
      if (!fs.existsSync(target)) return `Error: File not found: ${args.path}`;
      const current = fs.readFileSync(target, "utf8");
      const oldText = String(args.oldText || "");
      const newText = String(args.newText ?? "");
      if (!oldText || !current.includes(oldText)) {
        return `Error: oldText was not found verbatim in ${args.path}. Call read_file first and pass exact matching lines.`;
      }
      saveUndoSnapshot(target);
      const updated = current.replace(oldText, newText);
      fs.writeFileSync(target, updated, "utf8");
      console.log(paint(C.green, `  ✓ Edited ${args.path}`));
      return `OK: Successfully edited ${args.path}.`;
    }

    if (tool === "write_file") {
      const target = resolveSafePath(args.path);
      saveUndoSnapshot(target);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, String(args.content ?? ""), "utf8");
      console.log(paint(C.green, `  ✓ Wrote ${args.path}`));
      return `OK: Successfully wrote ${args.path}.`;
    }

    if (tool === "delete_file") {
      const target = resolveSafePath(args.path);
      if (!fs.existsSync(target)) return `Error: File not found: ${args.path}`;
      saveUndoSnapshot(target);
      fs.unlinkSync(target);
      console.log(paint(C.yellow, `  ✓ Deleted ${args.path}`));
      return `OK: Deleted ${args.path}.`;
    }

    if (tool === "run_command") {
      const cmd = String(args.command || "").trim();
      if (!cmd) return "Error: Empty command.";
      const cwd = resolveSafePath(args.cwd || ".");
      const timeoutMs = Math.min(120, Math.max(5, Number(args.timeoutSec) || 45)) * 1000;
      const stopSpin = startSpinner(`Running: ${cmd.slice(0, 60)}`);
      try {
        const out = execSync(cmd, {
          cwd,
          timeout: timeoutMs,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          maxBuffer: 2 * 1024 * 1024,
        });
        stopSpin();
        const trimmed = (out || "").trim().slice(0, 6000);
        console.log(paint(C.green, `  ✓ Command exited 0`));
        if (trimmed) console.log(paint(C.gray, trimmed.split("\n").slice(0, 12).map((l) => `    ${l}`).join("\n")));
        return `EXIT 0\n${trimmed || "(no output)"}`;
      } catch (err) {
        stopSpin();
        const code = err.status ?? 1;
        const stderr = String(err.stderr || "").trim();
        const stdout = String(err.stdout || "").trim();
        const combined = `${stdout}\n${stderr}`.trim().slice(0, 6000);
        console.log(paint(C.red, `  ✕ Command exited ${code}`));
        if (combined) console.log(paint(C.red, combined.split("\n").slice(0, 12).map((l) => `    ${l}`).join("\n")));
        return `EXIT ${code}\n${combined || err.message}`;
      }
    }
    return `Unsupported tool: ${tool}`;
  } catch (err) {
    return `Tool error (${tool}): ${err.message}`;
  }
}

/* ==================== @FILE MENTION EXPANSION ==================== */
function expandAtMentions(prompt) {
  const mentioned = [];
  const rx = /@([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)/g;
  let m;
  while ((m = rx.exec(prompt)) !== null) {
    const rel = m[1];
    try {
      const full = resolveSafePath(rel);
      if (fs.existsSync(full) && fs.statSync(full).isFile() && fs.statSync(full).size < 200_000) {
        const content = fs.readFileSync(full, "utf8").slice(0, 10_000);
        mentioned.push(`--- @${rel} ---\n${content}`);
      }
    } catch {
      // ignore invalid path mention
    }
  }
  if (mentioned.length === 0) return prompt;
  return `${prompt}\n\nATTACHED REFERENCED FILES:\n${mentioned.join("\n\n")}`;
}

/* ==================== PAIRING LOGIN FLOW ==================== */
async function ensureAuthenticated(rl, forceLogin = false) {
  const cfg = readConfig();
  if (!forceLogin && cfg.sessionToken && cfg.serverUrl) {
    return cfg;
  }

  console.log(paint(C.gold + C.bold, "\n  🔐 Connect YFactory Code CLI to your YFactory AI account"));
  console.log(
    paint(
      C.dim,
      "  Open YFactory AI -> Code tab -> click 'Generate Pairing Code' (e.g. YF-XXXXXX)\n",
    ),
  );

  const defUrl = cfg.serverUrl || defaultServerUrl();
  const urlAns = (
    await rl.question(`  YFactory URL ${paint(C.gray, `[${defUrl}]`)}: `)
  ).trim();
  const serverUrl = (urlAns || defUrl).replace(/\/+$/, "");

  const code = (await rl.question("  Pairing Code (YF-XXXXXX): ")).trim();
  if (!code) {
    console.log(paint(C.red, "  Pairing cancelled."));
    process.exit(1);
  }

  const stop = startSpinner("Exchanging pairing code...");
  try {
    const res = await apiRequest({ serverUrl }, "/code-agent/pair/exchange", {
      method: "POST",
      body: JSON.stringify({
        code,
        workspaceName: path.basename(WORKSPACE_ROOT),
        platform: `${os.platform()}-${os.arch()}`,
      }),
    });
    stop();
    const nextCfg = {
      serverUrl,
      sessionToken: res.sessionToken,
      sessionId: res.sessionId,
      model: cfg.model || null,
    };
    writeConfig(nextCfg);
    console.log(
      paint(C.green + C.bold, `  ✓ Paired successfully! Session saved to ${CONFIG_PATH}\n`),
    );
    return nextCfg;
  } catch (err) {
    stop();
    console.log(paint(C.red, `  ✕ Pairing failed: ${err.message}`));
    process.exit(1);
  }
}

/* ==================== CORE AGENT LOOP ==================== */
async function runAgentLoop(rl, cfg, state, userPrompt) {
  const expanded = expandAtMentions(userPrompt);
  state.messages.push({ role: "user", content: expanded });

  const workspace = {
    name: path.basename(WORKSPACE_ROOT),
    os: `${os.platform()} ${os.release()}`,
    shell: process.env.SHELL || "bash",
    gitBranch: getGitBranch(),
    projectTree: buildProjectTree(WORKSPACE_ROOT, 0, 3, { count: 0 }).join("\n"),
    yfactoryMd: readYFactoryMd(),
  };

  for (let step = 1; step <= MAX_AGENT_STEPS; step += 1) {
    const stop = startSpinner(
      `Thinking (step ${step}/${MAX_AGENT_STEPS})${state.model?.modelName ? ` · ${state.model.modelName}` : ""}...`,
    );
    let turn;
    try {
      turn = await apiRequest(cfg, "/code-agent/turn", {
        method: "POST",
        body: JSON.stringify({
          messages: state.messages.slice(-26),
          workspace,
          mode: state.mode,
          modelSelection: state.model || undefined,
          locale: process.env.YFACTORY_LOCALE || "en",
        }),
      });
    } catch (err) {
      stop();
      console.log(paint(C.red, `\n  ✕ Error: ${err.message}\n`));
      return;
    }
    stop();

    if (turn.modelUsed && !state.model) {
      state.model = turn.modelUsed;
    }

    if (turn.thought && process.env.YFACTORY_DEBUG === "1") {
      console.log(paint(C.gray, `  [thought] ${turn.thought}`));
    }

    if (turn.assistantMessage) {
      console.log(`\n${paint(C.gold + C.bold, "YFactory Code")} ${paint(C.gray, `(${turn.modelUsed?.modelName || "AI"})`)}\n`);
      console.log(turn.assistantMessage);
      console.log("");
    }

    const summaryForHistory = JSON.stringify({
      assistantMessage: turn.assistantMessage,
      toolCalls: turn.toolCalls.map((t) => ({ tool: t.tool, args: t.args })),
      done: turn.done,
    });
    state.messages.push({ role: "assistant", content: summaryForHistory });

    if (turn.done || !Array.isArray(turn.toolCalls) || turn.toolCalls.length === 0) {
      return;
    }

    const toolOutputs = [];
    for (const call of turn.toolCalls) {
      const out = await executeToolCall(rl, state, call);
      toolOutputs.push(`TOOL RESULT [${call.tool}]:\n${String(out).slice(0, 7500)}`);
    }
    state.messages.push({
      role: "user",
      content: `${toolOutputs.join("\n\n")}\n\nContinue toward the user's goal. Return strict JSON.`,
    });
  }

  console.log(
    paint(C.yellow, `\n  ⚠ Reached ${MAX_AGENT_STEPS} steps. Send a follow-up message to continue.\n`),
  );
}

/* ==================== SLASH COMMANDS & MAIN ==================== */
async function handleSlashCommand(cmdLine, rl, cfg, state) {
  const [cmd] = cmdLine.trim().split(/\s+/);

  if (cmd === "/exit" || cmd === "/quit") {
    console.log(paint(C.dim, "  Goodbye!"));
    rl.close();
    process.exit(0);
  }
  if (cmd === "/help") {
    console.log(`
  ${paint(C.gold + C.bold, "YFactory Code Slash Commands")}
  ${paint(C.cyan, "/plan")}      Switch to read-only Plan Mode
  ${paint(C.cyan, "/agent")}     Switch to autonomous Agent Mode
  ${paint(C.cyan, "/model")}     Choose any enabled model from Provider Center
  ${paint(C.cyan, "/skills")}    List active YFactory Code Skills
  ${paint(C.cyan, "/init")}      Inspect project & generate YFACTORY.md memory file
  ${paint(C.cyan, "/diff")}      Show git status & diff summary
  ${paint(C.cyan, "/undo")}      Revert the last file edit made in this session
  ${paint(C.cyan, "/auto")}      Toggle session auto-approve for edits & safe commands
  ${paint(C.cyan, "/compact")}   Compact conversation history to save tokens
  ${paint(C.cyan, "/clear")}     Clear conversation history
  ${paint(C.cyan, "/login")}     Re-pair with YFactory AI
  ${paint(C.cyan, "/exit")}      Quit
`);
    return true;
  }
  if (cmd === "/plan") {
    state.mode = "plan";
    console.log(paint(C.cyan, "  ✓ Switched to PLAN MODE (read-only)."));
    return true;
  }
  if (cmd === "/agent") {
    state.mode = "agent";
    console.log(paint(C.gold, "  ✓ Switched to AGENT MODE (edits & commands allowed with approval)."));
    return true;
  }
  if (cmd === "/auto") {
    state.autoApprove = !state.autoApprove;
    console.log(
      paint(
        state.autoApprove ? C.green : C.yellow,
        `  ✓ Session auto-approve: ${state.autoApprove ? "ON" : "OFF"}`,
      ),
    );
    return true;
  }
  if (cmd === "/clear") {
    state.messages = [];
    console.log(paint(C.green, "  ✓ Conversation cleared."));
    return true;
  }
  if (cmd === "/compact") {
    if (state.messages.length <= 4) {
      console.log(paint(C.dim, "  History is already compact."));
      return true;
    }
    state.messages = state.messages.slice(-4);
    console.log(paint(C.green, "  ✓ Compacted conversation to the last 4 turns."));
    return true;
  }
  if (cmd === "/undo") {
    performUndo();
    return true;
  }
  if (cmd === "/diff") {
    try {
      const st = execSync("git status -s && git diff --stat", {
        cwd: WORKSPACE_ROOT,
        encoding: "utf8",
      }).trim();
      console.log(st ? `\n${st}\n` : paint(C.dim, "  Working tree clean."));
    } catch {
      console.log(paint(C.yellow, "  Not a git repository."));
    }
    return true;
  }
  if (cmd === "/skills") {
    try {
      const res = await apiRequest(cfg, "/code-agent/skills");
      const list = res.skills || [];
      if (list.length === 0) {
        console.log(paint(C.dim, "  No active Code skills. Activate skills in YFactory Skills Hub."));
      } else {
        console.log(paint(C.gold + C.bold, `\n  Active Code Skills (${list.length}):`));
        for (const s of list) {
          console.log(`  • ${paint(C.white, s.name)} ${paint(C.gray, `[${s.scopes.join(", ")}]`)}`);
        }
        console.log("");
      }
    } catch (err) {
      console.log(paint(C.red, `  ✕ ${err.message}`));
    }
    return true;
  }
  if (cmd === "/model") {
    try {
      const res = await apiRequest(cfg, "/code-agent/models");
      const list = res.models || [];
      if (list.length === 0) {
        console.log(paint(C.yellow, "  No enabled models found in Provider Center."));
        return true;
      }
      console.log(paint(C.gold + C.bold, "\n  Available Models from Provider Center:"));
      list.forEach((m, i) => {
        const star = m.recommendedForCode ? paint(C.gold, " ★") : "";
        console.log(`  ${paint(C.cyan, `[${i + 1}]`)} ${m.modelName} ${paint(C.gray, `(${m.providerName})`)}${star}`);
      });
      const pick = Number((await rl.question("\n  Select number (blank to keep): ")).trim());
      if (pick >= 1 && pick <= list.length) {
        const chosen = list[pick - 1];
        state.model = {
          provider: chosen.provider,
          keyId: chosen.keyId,
          modelName: chosen.modelName,
        };
        cfg.model = state.model;
        writeConfig(cfg);
        console.log(paint(C.green, `  ✓ Active model: ${chosen.modelName}\n`));
      }
    } catch (err) {
      console.log(paint(C.red, `  ✕ ${err.message}`));
    }
    return true;
  }
  if (cmd === "/init") {
    await runAgentLoop(
      rl,
      cfg,
      state,
      "Inspect the project structure and package.json, then create a concise, high-value YFACTORY.md file documenting architecture, key folders, build/test commands, and coding conventions.",
    );
    return true;
  }
  if (cmd === "/login") {
    const nextCfg = await ensureAuthenticated(rl, true);
    Object.assign(cfg, nextCfg);
    return true;
  }
  if (cmd === "/logout") {
    writeConfig({});
    console.log(paint(C.yellow, "  ✓ Logged out locally. Run --login to pair again."));
    rl.close();
    process.exit(0);
  }
  return false;
}

async function main() {
  const args = process.argv.slice(2);
  const forceLogin = args.includes("--login");
  const pIdx = args.indexOf("-p");
  const oneShotPrompt = pIdx >= 0 ? args.slice(pIdx + 1).join(" ").trim() : "";

  const rl = createInterface({ input, output });
  try {
    const cfg = await ensureAuthenticated(rl, forceLogin);
    const state = {
      mode: "agent",
      autoApprove: false,
      model: cfg.model || null,
      messages: [],
    };

    if (oneShotPrompt) {
      await runAgentLoop(rl, cfg, state, oneShotPrompt);
      rl.close();
      return;
    }

    printBanner(state);

    while (true) {
      const promptPrefix =
        state.mode === "plan"
          ? paint(C.cyan + C.bold, "plan> ")
          : paint(C.gold + C.bold, "yfactory> ");
      let line;
      try {
        line = await rl.question(promptPrefix);
      } catch {
        break;
      }
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (trimmed.startsWith("/")) {
        const handled = await handleSlashCommand(trimmed, rl, cfg, state);
        if (handled) continue;
      }

      await runAgentLoop(rl, cfg, state, trimmed);
    }
  } finally {
    rl.close();
  }
}

main().catch((err) => {
  console.error(paint(C.red, `Fatal: ${err.message}`));
  process.exit(1);
});