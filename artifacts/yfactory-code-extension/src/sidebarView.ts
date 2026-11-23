import * as vscode from "vscode";
import {
  detectIdeType,
  YFactoryApiClient,
  YFactoryApiError,
  type IdeAgentActions,
  type IdeCodingModelOption,
  type IdeProposedCommand,
  type IdeProposedEdit,
  type IdeSessionRecord,
} from "./apiClient";
import { LocalTerminalRunner } from "./terminalRunner";
import { WorkspaceBridge } from "./workspaceBridge";

type ChatEntry = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  actions?: IdeAgentActions;
  editStates?: Record<number, "pending" | "applied" | "rejected">;
  cmdStates?: Record<number, "pending" | "running" | "done" | "rejected">;
  cmdOutputs?: Record<number, string>;
};

export class YFactorySidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "yfactoryCode.sidebar";

  private view: vscode.WebviewView | null = null;
  private readonly extensionUri: vscode.Uri;
  private readonly api: YFactoryApiClient;
  private readonly workspace: WorkspaceBridge;
  private readonly terminal: LocalTerminalRunner;

  private session: IdeSessionRecord | null = null;
  private models: IdeCodingModelOption[] = [];
  private selectedModelKey = "";
  private activeTaskId: string | undefined = undefined;
  private activeAbort: AbortController | null = null;
  private busy = false;
  private messages: ChatEntry[] = [];
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    extensionUri: vscode.Uri,
    api: YFactoryApiClient,
    workspace: WorkspaceBridge,
    terminal: LocalTerminalRunner,
  ) {
    this.extensionUri = extensionUri;
    this.api = api;
    this.workspace = workspace;
    this.terminal = terminal;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };
    webviewView.webview.html = this.buildHtml();

    webviewView.webview.onDidReceiveMessage((msg: Record<string, unknown>) => {
      void this.handleWebviewMessage(msg);
    });

    webviewView.onDidDispose(() => {
      this.view = null;
      this.stopHeartbeat();
    });

    void this.syncConnectionState();
  }

  public async promptPairFromCommand(): Promise<void> {
    const existingUrl = await this.api.getServerUrl();
    const serverUrl = await vscode.window.showInputBox({
      title: "YFactory Code — Server URL",
      prompt: "Enter your YFactory AI URL (copy from Code tab in YFactory)",
      value: existingUrl,
      ignoreFocusOut: true,
    });
    if (!serverUrl) return;
    const code = await vscode.window.showInputBox({
      title: "YFactory Code — Pairing Code",
      prompt: "Enter the temporary pairing code (e.g. YF-XXXX-XXXX)",
      ignoreFocusOut: true,
    });
    if (!code) return;
    await this.performPair(serverUrl, code);
  }

  public async disconnectSession(): Promise<void> {
    this.cancelActiveTask();
    this.stopHeartbeat();
    await this.api.disconnect();
    this.session = null;
    this.models = [];
    this.activeTaskId = undefined;
    this.postState();
    void vscode.window.showInformationMessage("YFactory Code disconnected.");
  }

  public cancelActiveTask(): void {
    if (this.activeAbort) {
      this.activeAbort.abort();
      this.activeAbort = null;
    }
    this.terminal.stopActiveCommand();
    if (this.activeTaskId) {
      void this.api.reportTaskEvent(this.activeTaskId, { status: "cancelled" });
    }
    this.busy = false;
    this.postState();
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      const ws = this.workspace.getWorkspaceRoot();
      if (this.session && ws) {
        void this.api.sendHeartbeat(ws.name);
      }
    }, 60_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private async syncConnectionState(): Promise<void> {
    const has = await this.api.hasSession();
    if (!has) {
      this.session = null;
      this.models = [];
      this.postState();
      return;
    }
    try {
      const [status, models] = await Promise.all([
        this.api.getStatus(),
        this.api.listModels(),
      ]);
      this.session = status.session;
      this.models = models;
      if (!this.selectedModelKey && models.length > 0) {
        const first = models[0]!;
        this.selectedModelKey = `${first.provider}|${first.keyId}|${first.modelName}`;
      }
      this.startHeartbeat();
    } catch {
      this.session = null;
      this.models = [];
    }
    this.postState();
  }

  private async performPair(serverUrl: string, code: string): Promise<void> {
    const ws = this.workspace.getWorkspaceRoot();
    const wsName = ws ? ws.name : "No Workspace Open";
    this.busy = true;
    this.postState();
    try {
      this.session = await this.api.pairWithCode(serverUrl, code, wsName);
      this.models = await this.api.listModels();
      if (this.models.length > 0) {
        const first = this.models[0]!;
        this.selectedModelKey = `${first.provider}|${first.keyId}|${first.modelName}`;
      }
      this.startHeartbeat();
      this.messages.push({
        id: `sys_${Date.now()}`,
        role: "system",
        text: `Connected to YFactory AI (${wsName}). Sensitive files (.env, keys, node_modules, .git) are excluded automatically.`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Pairing failed.";
      this.postError(msg);
    } finally {
      this.busy = false;
      this.postState();
    }
  }

  private parseSelectedModel(): IdeCodingModelOption | null {
    const [provider, keyId, ...rest] = this.selectedModelKey.split("|");
    const modelName = rest.join("|");
    if (!provider || !keyId || !modelName) return null;
    return (
      this.models.find(
        (m) => m.provider === provider && m.keyId === keyId && m.modelName === modelName,
      ) ?? null
    );
  }

  private async handleSendPrompt(
    promptText: string,
    extraFiles?: string[],
    toolFeedback?: string,
  ): Promise<void> {
    const ws = this.workspace.getWorkspaceRoot();
    if (!ws) {
      this.postError("Open a project folder (Workspace) in VS Code before running YFactory Code.");
      return;
    }
    const model = this.parseSelectedModel();
    if (!model) {
      this.postError("Select a coding model first (configure one in YFactory Provider Center).");
      return;
    }

    if (!toolFeedback) {
      this.messages.push({
        id: `u_${Date.now()}`,
        role: "user",
        text: promptText,
      });
    }

    this.busy = true;
    const ctrl = new AbortController();
    this.activeAbort = ctrl;
    this.postState();

    try {
      const tree = await this.workspace.listAuthorizedTree();
      const attached = [];
      const seen = new Set<string>();

      const activeFile = await this.workspace.getActiveEditorFile();
      if (activeFile) {
        attached.push(activeFile);
        seen.add(activeFile.path);
      }
      for (const reqPath of extraFiles ?? []) {
        if (seen.has(reqPath)) continue;
        const file = await this.workspace.readAuthorizedFile(reqPath);
        if (file) {
          attached.push(file);
          seen.add(file.path);
        }
      }

      const history = this.messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .slice(-10)
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.text }));

      const res = await this.api.runAgentTurn(
        {
          taskId: this.activeTaskId,
          provider: model.provider,
          keyId: model.keyId,
          modelName: model.modelName,
          prompt: promptText,
          workspaceTree: tree,
          attachedFiles: attached,
          history,
          toolFeedback,
        },
        ctrl.signal,
      );

      this.activeTaskId = res.task.id;
      const editStates: Record<number, "pending" | "applied" | "rejected"> = {};
      res.actions.proposedEdits.forEach((_, idx) => {
        editStates[idx] = "pending";
      });
      const cmdStates: Record<number, "pending" | "running" | "done" | "rejected"> = {};
      res.actions.proposedCommands.forEach((_, idx) => {
        cmdStates[idx] = "pending";
      });

      this.messages.push({
        id: `a_${Date.now()}`,
        role: "assistant",
        text: res.explanation,
        actions: res.actions,
        editStates,
        cmdStates,
        cmdOutputs: {},
      });

      // Automatically supply requested authorized files if agent needs context (max 1 follow-up hop per turn)
      if (
        !toolFeedback &&
        res.actions.requestFiles.length > 0 &&
        res.actions.proposedEdits.length === 0 &&
        res.actions.proposedCommands.length === 0
      ) {
        this.busy = false;
        this.postState();
        await this.handleSendPrompt(
          promptText,
          res.actions.requestFiles,
          `Loaded requested workspace files: ${res.actions.requestFiles.join(", ")}`,
        );
        return;
      }
    } catch (err) {
      if (!(err instanceof YFactoryApiError && err.code === "aborted")) {
        this.postError(err instanceof Error ? err.message : "Agent turn failed.");
      }
    } finally {
      if (this.activeAbort === ctrl) this.activeAbort = null;
      this.busy = false;
      this.postState();
    }
  }

  private async handleEditAction(
    msgId: string,
    index: number,
    op: "diff" | "apply" | "reject",
  ): Promise<void> {
    const entry = this.messages.find((m) => m.id === msgId);
    const edit: IdeProposedEdit | undefined = entry?.actions?.proposedEdits[index];
    if (!entry || !edit) return;

    try {
      if (op === "diff") {
        await this.workspace.previewEditDiff(edit);
        return;
      }
      if (op === "reject") {
        if (entry.editStates) entry.editStates[index] = "rejected";
        this.postState();
        return;
      }
      const modifiedPath = await this.workspace.applyProposedEdit(edit);
      if (entry.editStates) entry.editStates[index] = "applied";
      if (this.activeTaskId) {
        await this.api.reportTaskEvent(this.activeTaskId, {
          status: "completed",
          filesModified: [modifiedPath],
        });
      }
      this.postState();
    } catch (err) {
      this.postError(err instanceof Error ? err.message : "Could not process edit.");
    }
  }

  private async handleCommandAction(
    msgId: string,
    index: number,
    op: "run" | "reject",
  ): Promise<void> {
    const ws = this.workspace.getWorkspaceRoot();
    const entry = this.messages.find((m) => m.id === msgId);
    const cmd: IdeProposedCommand | undefined = entry?.actions?.proposedCommands[index];
    if (!ws || !entry || !cmd) return;

    if (op === "reject") {
      if (entry.cmdStates) entry.cmdStates[index] = "rejected";
      if (this.activeTaskId) {
        await this.api.reportTaskEvent(this.activeTaskId, {
          commandLog: {
            command: cmd.command,
            approved: false,
            exitCode: null,
            outputPreview: "Rejected by user.",
          },
        });
      }
      this.postState();
      return;
    }

    if (entry.cmdStates) entry.cmdStates[index] = "running";
    this.postState();

    try {
      const result = await this.terminal.runApprovedCommand(ws.rootPath, cmd);
      if (entry.cmdStates) {
        entry.cmdStates[index] = result.approved ? "done" : "rejected";
      }
      if (entry.cmdOutputs) {
        entry.cmdOutputs[index] =
          `exit=${result.exitCode ?? "?"}\n${result.output.slice(0, 1200)}`;
      }
      if (this.activeTaskId) {
        await this.api.reportTaskEvent(this.activeTaskId, {
          status: result.exitCode === 0 ? "completed" : "running",
          commandLog: {
            command: cmd.command,
            approved: result.approved,
            exitCode: result.exitCode,
            outputPreview: result.output.slice(0, 750),
          },
        });
      }
    } catch (err) {
      if (entry.cmdStates) entry.cmdStates[index] = "pending";
      this.postError(err instanceof Error ? err.message : "Command failed.");
    }
    this.postState();
  }

  private async handleWebviewMessage(msg: Record<string, unknown>): Promise<void> {
    const type = String(msg.type ?? "");
    if (type === "ready") {
      await this.syncConnectionState();
    } else if (type === "pair") {
      await this.performPair(String(msg.serverUrl ?? ""), String(msg.code ?? ""));
    } else if (type === "disconnect") {
      await this.disconnectSession();
    } else if (type === "refreshModels") {
      await this.syncConnectionState();
    } else if (type === "selectModel") {
      this.selectedModelKey = String(msg.modelKey ?? "");
      this.postState();
    } else if (type === "newTask") {
      this.activeTaskId = undefined;
      this.messages = [];
      this.postState();
    } else if (type === "sendPrompt") {
      const prompt = String(msg.prompt ?? "").trim();
      if (prompt) await this.handleSendPrompt(prompt);
    } else if (type === "cancel") {
      this.cancelActiveTask();
    } else if (type === "editAction") {
      await this.handleEditAction(
        String(msg.msgId ?? ""),
        Number(msg.index ?? 0),
        String(msg.op ?? "diff") as "diff" | "apply" | "reject",
      );
    } else if (type === "cmdAction") {
      await this.handleCommandAction(
        String(msg.msgId ?? ""),
        Number(msg.index ?? 0),
        String(msg.op ?? "run") as "run" | "reject",
      );
    } else if (type === "sendCmdOutputToAgent") {
      const entry = this.messages.find((m) => m.id === String(msg.msgId ?? ""));
      const idx = Number(msg.index ?? 0);
      const out = entry?.cmdOutputs?.[idx];
      const cmd = entry?.actions?.proposedCommands[idx]?.command;
      if (out && cmd) {
        await this.handleSendPrompt(
          `Analyze the output of "${cmd}" and suggest next steps or fixes.`,
          undefined,
          `Command: ${cmd}\n${out}`,
        );
      }
    }
  }

  private postState(): void {
    if (!this.view) return;
    const ws = this.workspace.getWorkspaceRoot();
    void this.api.getServerUrl().then((savedServerUrl) => {
      void this.view?.webview.postMessage({
        type: "state",
        connected: Boolean(this.session),
        session: this.session,
        savedServerUrl,
        ideDetected: detectIdeType(),
        workspaceName: ws?.name ?? null,
        models: this.models,
        selectedModelKey: this.selectedModelKey,
        busy: this.busy,
        terminalRunning: this.terminal.isRunning(),
        messages: this.messages,
      });
    });
  }

  private postError(message: string): void {
    void this.view?.webview.postMessage({ type: "error", message });
  }

  private buildHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>YFactory Code</title>
<style>
  :root {
    --bg: #0f0f10;
    --panel: #17171a;
    --raised: #202025;
    --line: rgba(255,255,255,0.1);
    --text: #f3f3f5;
    --muted: #a1a1aa;
    --gold: #eab32e;
    --gold-dim: rgba(234,179,46,0.16);
    --ok: #22c55e;
    --err: #ef4444;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 10px; background: var(--bg); color: var(--text);
    font-family: var(--vscode-font-family, system-ui, sans-serif); font-size: 12.5px;
    display: flex; flex-direction: column; gap: 10px; min-height: 100vh;
  }
  .head {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    padding: 9px 10px; border-radius: 12px; background: var(--panel);
    border: 1px solid rgba(234,179,46,0.35);
  }
  .brand { display: flex; align-items: center; gap: 8px; font-weight: 700; color: var(--gold); }
  .pill { font-size: 10.5px; padding: 2px 7px; border-radius: 999px; background: var(--raised); color: var(--muted); }
  .pill.ok { background: rgba(34,197,94,0.16); color: var(--ok); }
  .card {
    display: flex; flex-direction: column; gap: 8px; padding: 11px;
    border-radius: 12px; background: var(--panel); border: 1px solid var(--line);
  }
  input, select, textarea {
    width: 100%; border: 1px solid var(--line); border-radius: 8px;
    background: var(--bg); color: var(--text); padding: 8px; font: inherit; outline: none;
  }
  input:focus, select:focus, textarea:focus { border-color: var(--gold); }
  textarea { min-height: 68px; resize: vertical; }
  button {
    border: 1px solid var(--line); border-radius: 8px; background: var(--raised);
    color: var(--text); padding: 6px 10px; font: inherit; font-weight: 600; cursor: pointer;
  }
  button.primary { background: var(--gold); border-color: var(--gold); color: #111; }
  button.danger { background: rgba(239,68,68,0.14); border-color: rgba(239,68,68,0.4); color: #fca5a5; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  .err { padding: 8px; border-radius: 8px; background: rgba(239,68,68,0.14); color: #fca5a5; font-size: 12px; }
  .msgs { display: flex; flex-direction: column; gap: 9px; flex: 1; overflow-y: auto; }
  .msg { padding: 9px 10px; border-radius: 10px; background: var(--panel); border: 1px solid var(--line); white-space: pre-wrap; word-break: break-word; }
  .msg.user { background: var(--gold-dim); border-color: rgba(234,179,46,0.36); }
  .msg.system { color: var(--muted); font-size: 11.5px; }
  .action-box { margin-top: 8px; padding: 8px; border-radius: 8px; background: var(--bg); border: 1px solid var(--line); display: flex; flex-direction: column; gap: 6px; }
  .action-box code { color: var(--gold); font-family: monospace; font-size: 11.5px; }
  .out-pre { margin: 4px 0 0; padding: 6px; border-radius: 6px; background: #070708; color: #d4d4d8; font-size: 11px; overflow-x: auto; max-height: 150px; }
</style>
</head>
<body>
  <div id="app">Loading YFactory Code...</div>
<script>
  const vscode = acquireVsCodeApi();
  let state = { connected: false, models: [], messages: [], busy: false, savedServerUrl: '', ideDetected: 'vscode' };
  let lastError = '';

  function esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function render() {
    const root = document.getElementById('app');
    const errHtml = lastError ? '<div class="err">' + esc(lastError) + '</div>' : '';

    if (!state.connected) {
      const ideNote = state.ideDetected === 'cursor'
        ? '<span class="pill">Cursor (Experimental)</span>'
        : '<span class="pill ok">VS Code</span>';
      root.innerHTML =
        '<div class="head"><span class="brand">Y&lt;/&gt; YFactory Code</span>' + ideNote + '</div>' +
        errHtml +
        '<div class="card">' +
          '<strong>Pair with your YFactory AI Account</strong>' +
          '<small style="color:var(--muted)">Open the Code tab in YFactory AI, generate a temporary pairing code, and paste both values below. Zero API keys are stored in VS Code.</small>' +
          '<label>YFactory Server URL</label>' +
          '<input id="srvUrl" type="url" placeholder="https://your-app.replit.dev" value="' + esc(state.savedServerUrl) + '" />' +
          '<label>Temporary Pairing Code</label>' +
          '<input id="pairCode" type="text" placeholder="YF-XXXX-XXXX" />' +
          '<button id="btnPair" class="primary"' + (state.busy ? ' disabled' : '') + '>' + (state.busy ? 'Connecting...' : 'Connect IDE') + '</button>' +
        '</div>';

      document.getElementById('btnPair').onclick = () => {
        lastError = '';
        const serverUrl = document.getElementById('srvUrl').value;
        const code = document.getElementById('pairCode').value;
        vscode.postMessage({ type: 'pair', serverUrl, code });
      };
      return;
    }

    const modelOpts = state.models.length === 0
      ? '<option value="">No coding models enabled in Provider Center</option>'
      : state.models.map(m => {
          const k = m.provider + '|' + m.keyId + '|' + m.modelName;
          return '<option value="' + esc(k) + '"' + (k === state.selectedModelKey ? ' selected' : '') + '>' + esc(m.modelName + ' (' + m.providerName + ')') + '</option>';
        }).join('');

    const msgsHtml = state.messages.map(m => {
      let extras = '';
      if (m.actions && Array.isArray(m.actions.proposedEdits)) {
        m.actions.proposedEdits.forEach((ed, idx) => {
          const st = (m.editStates && m.editStates[idx]) || 'pending';
          extras += '<div class="action-box">' +
            '<div class="row"><code>' + esc(ed.action.toUpperCase() + ' ' + ed.path) + '</code><span class="pill">' + esc(st) + '</span></div>' +
            '<small style="color:var(--muted)">' + esc(ed.summary || ed.reason) + '</small>' +
            (st === 'pending'
              ? '<div class="row">' +
                  '<button data-ed-diff="' + esc(m.id) + ':' + idx + '">View Diff</button>' +
                  '<button class="primary" data-ed-apply="' + esc(m.id) + ':' + idx + '">Accept Edit</button>' +
                  '<button class="danger" data-ed-reject="' + esc(m.id) + ':' + idx + '">Reject</button>' +
                '</div>'
              : '') +
          '</div>';
        });
      }
      if (m.actions && Array.isArray(m.actions.proposedCommands)) {
        m.actions.proposedCommands.forEach((cm, idx) => {
          const st = (m.cmdStates && m.cmdStates[idx]) || 'pending';
          const out = m.cmdOutputs && m.cmdOutputs[idx];
          extras += '<div class="action-box">' +
            '<div class="row"><code>$ ' + esc(cm.command) + '</code><span class="pill">' + esc(cm.riskLevel + ' · ' + st) + '</span></div>' +
            '<small style="color:var(--muted)">' + esc(cm.reason) + '</small>' +
            (st === 'pending'
              ? '<div class="row">' +
                  '<button class="primary" data-cmd-run="' + esc(m.id) + ':' + idx + '">Approve & Run Locally</button>' +
                  '<button class="danger" data-cmd-reject="' + esc(m.id) + ':' + idx + '">Reject</button>' +
                '</div>'
              : '') +
            (out ? '<pre class="out-pre">' + esc(out) + '</pre><button data-cmd-fb="' + esc(m.id) + ':' + idx + '">Send Output to Agent</button>' : '') +
          '</div>';
        });
      }
      return '<div class="msg ' + esc(m.role) + '">' + esc(m.text) + extras + '</div>';
    }).join('');

    root.innerHTML =
      '<div class="head">' +
        '<div><div class="brand">Y&lt;/&gt; YFactory Code</div><small style="color:var(--muted)">' + esc(state.workspaceName || 'No workspace open') + '</small></div>' +
        '<div class="row"><button id="btnNew">New</button><button id="btnDisc" class="danger">Unlink</button></div>' +
      '</div>' +
      errHtml +
      '<div class="card">' +
        '<div class="row"><select id="selModel" style="flex:1">' + modelOpts + '</select><button id="btnRef">↻</button></div>' +
      '</div>' +
      '<div class="msgs" id="msgs">' + (msgsHtml || '<div class="msg system">Describe a bug fix, refactor, explanation, or test task inside your open workspace.</div>') + '</div>' +
      '<div class="card">' +
        '<textarea id="promptBox" placeholder="Ask YFactory Code to analyze files, propose diffs, or run tests..."></textarea>' +
        '<div class="row" style="justify-content:flex-end">' +
          ((state.busy || state.terminalRunning) ? '<button id="btnStop" class="danger">Stop</button>' : '') +
          '<button id="btnSend" class="primary"' + (state.busy ? ' disabled' : '') + '>' + (state.busy ? 'Working...' : 'Run Task') + '</button>' +
        '</div>' +
      '</div>';

    document.getElementById('btnDisc').onclick = () => vscode.postMessage({ type: 'disconnect' });
    document.getElementById('btnNew').onclick = () => vscode.postMessage({ type: 'newTask' });
    document.getElementById('btnRef').onclick = () => vscode.postMessage({ type: 'refreshModels' });
    document.getElementById('selModel').onchange = (e) => vscode.postMessage({ type: 'selectModel', modelKey: e.target.value });
    const stopBtn = document.getElementById('btnStop');
    if (stopBtn) stopBtn.onclick = () => vscode.postMessage({ type: 'cancel' });
    document.getElementById('btnSend').onclick = () => {
      lastError = '';
      const prompt = document.getElementById('promptBox').value.trim();
      if (!prompt) return;
      document.getElementById('promptBox').value = '';
      vscode.postMessage({ type: 'sendPrompt', prompt });
    };

    root.querySelectorAll('[data-ed-diff]').forEach(el => {
      el.onclick = () => { const [msgId, index] = el.dataset.edDiff.split(':'); vscode.postMessage({ type: 'editAction', msgId, index: Number(index), op: 'diff' }); };
    });
    root.querySelectorAll('[data-ed-apply]').forEach(el => {
      el.onclick = () => { const [msgId, index] = el.dataset.edApply.split(':'); vscode.postMessage({ type: 'editAction', msgId, index: Number(index), op: 'apply' }); };
    });
    root.querySelectorAll('[data-ed-reject]').forEach(el => {
      el.onclick = () => { const [msgId, index] = el.dataset.edReject.split(':'); vscode.postMessage({ type: 'editAction', msgId, index: Number(index), op: 'reject' }); };
    });
    root.querySelectorAll('[data-cmd-run]').forEach(el => {
      el.onclick = () => { const [msgId, index] = el.dataset.cmdRun.split(':'); vscode.postMessage({ type: 'cmdAction', msgId, index: Number(index), op: 'run' }); };
    });
    root.querySelectorAll('[data-cmd-reject]').forEach(el => {
      el.onclick = () => { const [msgId, index] = el.dataset.cmdReject.split(':'); vscode.postMessage({ type: 'cmdAction', msgId, index: Number(index), op: 'reject' }); };
    });
    root.querySelectorAll('[data-cmd-fb]').forEach(el => {
      el.onclick = () => { const [msgId, index] = el.dataset.cmdFb.split(':'); vscode.postMessage({ type: 'sendCmdOutputToAgent', msgId, index: Number(index) }); };
    });
  }

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'state') {
      state = msg;
      render();
    } else if (msg.type === 'error') {
      lastError = msg.message || 'Unknown error';
      render();
    }
  });

  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
  }
}
