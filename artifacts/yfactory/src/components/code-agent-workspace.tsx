import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Code2,
  Copy,
  ExternalLink,
  GitBranch,
  GitPullRequest,
  KeyRound,
  LoaderCircle,
  Play,
  Puzzle,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import AppSelect from "@/components/app-select";
import ChatMarkdown from "@/components/chat-markdown";
import CodeIdeDashboard from "@/components/code-ide-dashboard";
import { ConnectorsHubContent } from "@/components/connectors-hub-modal";
import {
  fetchCliSessionsApi,
  fetchCodeAgentModelsApi,
  revokeCliSessionApi,
  runCodeAgentTurnApi,
  startCliPairingApi,
  type CliSessionSummary,
  type CodeAgentMode,
  type CodeAgentModelOption,
  type CodeAgentToolCall,
} from "@/lib/codeAgentApi";
import {
  createGitHubBranch,
  deleteGitHubFile,
  fetchGitHubTree,
  listGitHubRepos,
  openGitHubPullRequest,
  readGitHubFile,
  upsertGitHubFile,
  useDevConnectors,
  type GitHubRepoItem,
  type GitHubTreeEntry,
} from "@/lib/connectorsStore";
import { isRtlLanguage } from "@/lib/languages";
import "./code-agent-workspace.css";

type CodeAgentWorkspaceProps = {
  locale: string;
  getIdToken?: () => Promise<string>;
  onOpenProviderCenter: (providerId?: string) => void;
  onOpenChat: () => void;
  onOpenConnectors?: () => void;
};

type CodeSubTab = "cli" | "github" | "connectors" | "vscode";

type FeedItem = {
  id: string;
  kind: "user" | "assistant" | "tool";
  text: string;
  modelName?: string;
};

type PendingApproval = {
  call: CodeAgentToolCall;
  repo: string;
  branch: string;
  oldPreview: string;
  newPreview: string;
};

const MAX_CLOUD_STEPS = 8;

function getCopy(lang: string) {
  if (lang.startsWith("ar")) {
    return {
      tabCli: "وكيل الطرفية (Claude Code CLI)",
      tabGithub: "وكيل GitHub السحابي",
      tabConnectors: "الموصّلات (Connectors)",
      tabVscode: "إضافة VS Code",
      cliTitle: "YFactory Code CLI — نسخة Claude Code للطرفية",
      cliSub:
        "وكيل برمجة مستقل بدون أي مكتبات خارجية (Node.js 18+): يقرأ مشروعك، يبحث في الكود، يعرض Diff ملوّن قبل كل تعديل، يشغّل البناء والاختبارات، ويدعم /plan و/init و/undo و/model وملف YFACTORY.md.",
      genPairBtn: "توليد كود إقران جديد (YF-XXXXXX)",
      generatingPair: "جارٍ توليد الكود...",
      pairExpires: "صالح لمدة 10 دقائق — استخدمه داخل الطرفية عند أول تشغيل:",
      replitCmdLbl: "التشغيل المباشر داخل Replit Shell:",
      anyCmdLbl: "التشغيل في أي طرفية (VS Code / Cursor / Windsurf / JetBrains / Termux):",
      sessionsTitle: "جلسات الطرفية المتصلة",
      noSessions: "لا توجد جلسات CLI مقترنة بعد. ولّد كود إقران وشغّل الأمر أعلاه.",
      revoke: "إلغاء الجلسة",
      ghTitle: "وكيل البرمجة السحابي على GitHub (بدون طرفية — مباشرةً من هاتفك)",
      ghNeedConnect:
        "اربط حساب GitHub الخاص بك أولاً من تبويب «الموصّلات» ليتصفّح الوكيل ملفات مستودعك، يعرض لك الـ Diff، وينشئ Commit أو Pull Request مباشرةً.",
      openConnBtn: "ربط GitHub الآن",
      repoLbl: "المستودع (Repository)",
      branchLbl: "الفرع (Branch)",
      modelLbl: "نموذج البرمجة (Provider Center)",
      modeAgent: "وضع الوكيل (تعديل + Commit)",
      modePlan: "وضع التخطيط (قراءة فقط)",
      commitPrLabel: "إنشاء فرع جديد + Pull Request عند الموافقة (الأكثر أماناً)",
      promptPh:
        "اطلب مهمة برمجية حقيقية على مستودعك (مثلاً: افحص ملف App.tsx وأصلح مشكلة التجاوب، أو اكتب خطة لتحسين الأداء)...",
      send: "تنفيذ",
      thinking: "الوكيل يفحص المستودع...",
      approveCommit: "موافقة وتنفيذ Commit على GitHub",
      rejectEdit: "رفض التعديل",
      clearChat: "جلسة جديدة",
      copied: "تم النسخ!",
      noModels: "فعّل نموذجاً من مركز المزودين أولاً",
      openProviders: "مركز المزودين",
    };
  }
  return {
    tabCli: "Terminal CLI (Claude Code)",
    tabGithub: "Cloud GitHub Agent",
    tabConnectors: "Connectors",
    tabVscode: "VS Code Extension",
    cliTitle: "YFactory Code CLI — Claude Code Edition",
    cliSub:
      "Zero-dependency autonomous coding agent (Node.js 18+): reads your project, searches code, shows colored diffs before edits, runs build/tests, and supports /plan, /init, /undo, /model & YFACTORY.md.",
    genPairBtn: "Generate Pairing Code (YF-XXXXXX)",
    generatingPair: "Generating code...",
    pairExpires: "Valid for 10 minutes — paste into your terminal when prompted:",
    replitCmdLbl: "Direct Launch in Replit Shell:",
    anyCmdLbl: "Run in ANY Terminal (VS Code / Cursor / Windsurf / JetBrains / Termux):",
    sessionsTitle: "Connected CLI Sessions",
    noSessions: "No CLI sessions paired yet. Generate a code and launch the CLI above.",
    revoke: "Revoke",
    ghTitle: "Cloud GitHub Coding Agent (Mobile-Native Claude Code)",
    ghNeedConnect:
      "Connect your GitHub account in the Connectors tab first so the agent can inspect your repo, preview diffs, and create real Commits or Pull Requests from your phone.",
    openConnBtn: "Connect GitHub Now",
    repoLbl: "Repository",
    branchLbl: "Branch",
    modelLbl: "Coding Model (Provider Center)",
    modeAgent: "Agent Mode (Edit + Commit)",
    modePlan: "Plan Mode (Read-Only)",
    commitPrLabel: "Create new branch + Pull Request on approve (safest)",
    promptPh:
      "Give the agent a real coding task on this repo (e.g. Inspect src/App.tsx and fix mobile overflow, or plan a refactor)...",
    send: "Run",
    thinking: "Agent inspecting repo...",
    approveCommit: "Approve & Commit to GitHub",
    rejectEdit: "Reject",
    clearChat: "New Session",
    copied: "Copied!",
    noModels: "Enable a model in Provider Center first",
    openProviders: "Provider Center",
  };
}

export default function CodeAgentWorkspace({
  locale,
  getIdToken,
  onOpenProviderCenter,
  onOpenChat,
}: CodeAgentWorkspaceProps) {
  const isRtl = isRtlLanguage(locale);
  const ui = getCopy(locale);
  const { state: connectors, update: updateConnectors, connectedCount } = useDevConnectors();

  const [subTab, setSubTab] = useState<CodeSubTab>("cli");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  // CLI Pairing & Sessions
  const [pairCode, setPairCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const [pairBusy, setPairBusy] = useState(false);
  const [sessions, setSessions] = useState<CliSessionSummary[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);

  // Models
  const [models, setModels] = useState<CodeAgentModelOption[]>([]);
  const [selectedModelKey, setSelectedModelKey] = useState("");

  // GitHub Cloud Agent state
  const [repos, setRepos] = useState<GitHubRepoItem[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState(connectors.github?.selectedRepo || "");
  const [branch, setBranch] = useState(connectors.github?.selectedBranch || "main");
  const [tree, setTree] = useState<GitHubTreeEntry[]>([]);
  const [loadingTree, setLoadingTree] = useState(false);

  const [mode, setMode] = useState<CodeAgentMode>("agent");
  const [usePrBranch, setUsePrBranch] = useState(true);
  const [draft, setDraft] = useState("");
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [running, setRunning] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [committing, setCommitting] = useState(false);

  const historyRef = useRef<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const fileCacheRef = useRef<Map<string, { content: string; sha: string }>>(new Map());
  const threadEndRef = useRef<HTMLDivElement>(null);

  const originUrl =
    typeof window !== "undefined" ? window.location.origin : "https://your-yfactory-url";
  const replitLaunchCmd = "node artifacts/yfactory-code-cli/yfactory-code.mjs";
  const universalLaunchCmd = `curl -fsSL "${originUrl}/api/code-agent/cli-script" -o yfactory-code.mjs && node yfactory-code.mjs`;

  const copyText = async (txt: string) => {
    try {
      await navigator.clipboard.writeText(txt);
      setNotice(ui.copied);
      window.setTimeout(() => setNotice(""), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  const loadCliAndModels = useCallback(async () => {
    if (!getIdToken) return;
    setLoadingSessions(true);
    try {
      const tok = await getIdToken();
      const [sessList, modList] = await Promise.all([
        fetchCliSessionsApi(tok).catch(() => [] as CliSessionSummary[]),
        fetchCodeAgentModelsApi(tok).catch(() => [] as CodeAgentModelOption[]),
      ]);
      setSessions(sessList);
      setModels(modList);
      if (modList.length > 0 && !selectedModelKey) {
        const first = modList[0]!;
        setSelectedModelKey(`${first.provider}|${first.keyId}|${first.modelName}`);
      }
    } finally {
      setLoadingSessions(false);
    }
  }, [getIdToken, selectedModelKey]);

  useEffect(() => {
    void loadCliAndModels();
  }, [loadCliAndModels]);

  // Load GitHub repos when GitHub connector is present
  useEffect(() => {
    const ghToken = connectors.github?.token;
    if (!ghToken) {
      setRepos([]);
      setTree([]);
      return;
    }
    let active = true;
    setLoadingRepos(true);
    void listGitHubRepos(ghToken)
      .then((list) => {
        if (!active) return;
        setRepos(list);
        if (!selectedRepo && list.length > 0) {
          setSelectedRepo(list[0]!.fullName);
          setBranch(list[0]!.defaultBranch);
        }
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Could not load GitHub repos.");
      })
      .finally(() => {
        if (active) setLoadingRepos(false);
      });
    return () => {
      active = false;
    };
  }, [connectors.github?.token]);

  // Load file tree when selectedRepo / branch changes
  useEffect(() => {
    const ghToken = connectors.github?.token;
    if (!ghToken || !selectedRepo) {
      setTree([]);
      return;
    }
    updateConnectors((cur) =>
      cur.github
        ? {
            ...cur,
            github: {
              ...cur.github,
              selectedRepo,
              selectedBranch: branch || "main",
            },
          }
        : cur,
    );
    let active = true;
    setLoadingTree(true);
    fileCacheRef.current.clear();
    void fetchGitHubTree(ghToken, selectedRepo, branch || "main")
      .then((entries) => {
        if (active) setTree(entries);
      })
      .catch((err) => {
        if (active) {
          setTree([]);
          setError(err instanceof Error ? err.message : "Could not read repo tree.");
        }
      })
      .finally(() => {
        if (active) setLoadingTree(false);
      });
    return () => {
      active = false;
    };
  }, [connectors.github?.token, selectedRepo, branch]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [feed.length, pendingApproval]);

  const modelSelection = useMemo(() => {
    const [provider, keyId, ...rest] = selectedModelKey.split("|");
    const modelName = rest.join("|");
    if (!provider || !keyId || !modelName) return undefined;
    return { provider, keyId, modelName };
  }, [selectedModelKey]);

  const handleGeneratePairing = async () => {
    if (!getIdToken || pairBusy) return;
    setPairBusy(true);
    setError("");
    try {
      const tok = await getIdToken();
      const res = await startCliPairingApi(tok);
      setPairCode(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create pairing code.");
    } finally {
      setPairBusy(false);
    }
  };

  const handleRevokeSession = async (id: string) => {
    if (!getIdToken) return;
    try {
      const tok = await getIdToken();
      await revokeCliSessionApi(tok, id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not revoke session.");
    }
  };

  const pushFeed = (kind: FeedItem["kind"], text: string, modelName?: string) => {
    setFeed((prev) => [
      ...prev,
      { id: `f_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, kind, text, modelName },
    ]);
  };

  const executeGitHubReadTool = async (
    ghToken: string,
    call: CodeAgentToolCall,
  ): Promise<string> => {
    const args = call.args;
    if (call.tool === "list_dir") {
      const prefix = String(args.path || ".")
        .replace(/^\.\/?/, "")
        .replace(/\/+$/, "");
      const matched = tree
        .filter((e) => !prefix || e.path.startsWith(`${prefix}/`) || e.path === prefix)
        .slice(0, 80)
        .map((e) => `${e.path}${e.type === "tree" ? "/" : ""}`);
      return matched.length ? matched.join("\n") : "(no entries)";
    }

    if (call.tool === "find_files") {
      const pat = String(args.pattern || "").trim().toLowerCase();
      const rx = pat
        ? new RegExp(
            pat.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*"),
            "i",
          )
        : null;
      const hits = tree
        .filter((e) => e.type === "blob" && (!rx || rx.test(e.path)))
        .slice(0, 50)
        .map((e) => e.path);
      return hits.length ? hits.join("\n") : "No matching files.";
    }

    if (call.tool === "grep_search") {
      const q = String(args.query || "").trim();
      if (!q) return "Error: query required.";
      const resp = await fetch(
        `https://api.github.com/search/code?q=${encodeURIComponent(`${q} repo:${selectedRepo}`)}&per_page=15`,
        {
          headers: {
            Authorization: `Bearer ${ghToken}`,
            Accept: "application/vnd.github+json",
          },
        },
      );
      if (resp.ok) {
        const data = (await resp.json().catch(() => ({}))) as {
          items?: Array<{ path?: string }>;
        };
        const paths = (data.items ?? []).map((i) => i.path).filter(Boolean);
        if (paths.length > 0) {
          return `Files matching "${q}":\n${paths.join("\n")}`;
        }
      }
      const fallback = tree
        .filter((e) => e.type === "blob" && e.path.toLowerCase().includes(q.toLowerCase()))
        .slice(0, 20)
        .map((e) => e.path);
      return fallback.length
        ? `Path matches:\n${fallback.join("\n")}`
        : `No GitHub code search hits for "${q}". Try find_files + read_file.`;
    }

    if (call.tool === "read_file") {
      const cleanPath = String(args.path || "").replace(/^\.\/?/, "");
      if (!cleanPath) return "Error: path required.";
      let cached = fileCacheRef.current.get(cleanPath);
      if (!cached) {
        cached = await readGitHubFile(ghToken, selectedRepo, cleanPath, branch || "main");
        fileCacheRef.current.set(cleanPath, cached);
      }
      const lines = cached.content.split(/\r?\n/);
      const start = Math.max(1, Number(args.startLine) || 1);
      const end = Math.min(lines.length, Number(args.endLine) || start + 199);
      const body = lines
        .slice(start - 1, end)
        .map((l, i) => `${String(start + i).padStart(4, " ")} | ${l}`)
        .join("\n");
      return `FILE: ${cleanPath} (lines ${start}-${end} of ${lines.length})\n${body}`;
    }

    return `Tool ${call.tool} is not supported in cloud read mode.`;
  };

  const runCloudAgentLoop = async (initialUserMessage?: string) => {
    const ghToken = connectors.github?.token;
    if (!getIdToken || !ghToken || !selectedRepo || running) return;
    setError("");
    setRunning(true);

    if (initialUserMessage) {
      historyRef.current.push({ role: "user", content: initialUserMessage });
      pushFeed("user", initialUserMessage);
    }

    const treeSummary = tree
      .filter((e) => e.type === "blob")
      .slice(0, 140)
      .map((e) => e.path)
      .join("\n");

    try {
      const idToken = await getIdToken();
      for (let step = 0; step < MAX_CLOUD_STEPS; step += 1) {
        const turn = await runCodeAgentTurnApi(idToken, {
          messages: historyRef.current.slice(-22),
          workspace: {
            name: selectedRepo,
            os: "GitHub Cloud API (no local shell)",
            shell: "none (use edit_file/write_file/delete_file; run_command unavailable in cloud mode)",
            gitBranch: branch || "main",
            projectTree: treeSummary,
          },
          mode,
          modelSelection,
          locale,
        });

        if (turn.assistantMessage) {
          pushFeed("assistant", turn.assistantMessage, turn.modelUsed.modelName);
        }

        historyRef.current.push({
          role: "assistant",
          content: JSON.stringify({
            assistantMessage: turn.assistantMessage,
            toolCalls: turn.toolCalls.map((t) => ({ tool: t.tool, args: t.args })),
            done: turn.done,
          }),
        });

        if (turn.done || turn.toolCalls.length === 0) {
          return;
        }

        // Handle read-only tools automatically; pause on first mutating tool for user Diff Approval!
        const readOutputs: string[] = [];
        for (const call of turn.toolCalls) {
          if (call.tool === "run_command") {
            readOutputs.push(
              `TOOL RESULT [run_command]: Shell execution is only available in YFactory Code CLI (Terminal). Skip run_command in Cloud GitHub mode.`,
            );
            continue;
          }
          if (call.mutating) {
            const targetPath = String(call.args.path || "").replace(/^\.\/?/, "");
            let oldPreview = "";
            let newPreview = "";
            if (call.tool === "edit_file") {
              oldPreview = String(call.args.oldText || "");
              newPreview = String(call.args.newText || "");
            } else if (call.tool === "write_file") {
              newPreview = String(call.args.content || "").slice(0, 4000);
            } else if (call.tool === "delete_file") {
              oldPreview = `DELETE ${targetPath}`;
            }
            if (readOutputs.length > 0) {
              historyRef.current.push({
                role: "user",
                content: readOutputs.join("\n\n"),
              });
            }
            setPendingApproval({
              call,
              repo: selectedRepo,
              branch: branch || "main",
              oldPreview,
              newPreview,
            });
            return;
          }

          pushFeed(
            "tool",
            `▸ ${call.tool} ${JSON.stringify(call.args).slice(0, 120)}`,
          );
          try {
            const out = await executeGitHubReadTool(ghToken, call);
            readOutputs.push(`TOOL RESULT [${call.tool}]:\n${out.slice(0, 7000)}`);
          } catch (err) {
            readOutputs.push(
              `TOOL ERROR [${call.tool}]: ${err instanceof Error ? err.message : "failed"}`,
            );
          }
        }

        if (readOutputs.length > 0) {
          historyRef.current.push({
            role: "user",
            content: `${readOutputs.join("\n\n")}\n\nContinue toward the user's goal. Return strict JSON.`,
          });
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Code Agent turn failed.");
    } finally {
      setRunning(false);
    }
  };

  const handleSubmitPrompt = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || running || pendingApproval) return;
    setDraft("");
    void runCloudAgentLoop(text);
  };

  const handleApproveMutation = async () => {
    const ghToken = connectors.github?.token;
    if (!pendingApproval || !ghToken || committing) return;
    setCommitting(true);
    setError("");
    const { call, repo, branch: baseBranch } = pendingApproval;
    const targetPath = String(call.args.path || "").replace(/^\.\/?/, "");
    const commitMsg = `YFactory Code: ${call.reason || call.tool} (${targetPath})`;

    try {
      let targetBranch = baseBranch;
      let createdBranch = false;
      if (usePrBranch) {
        const slug = `yfactory-code-${Date.now().toString(36)}`;
        targetBranch = await createGitHubBranch(ghToken, repo, baseBranch, slug);
        createdBranch = true;
      }

      let resultUrl = "";
      if (call.tool === "edit_file") {
        const current = await readGitHubFile(ghToken, repo, targetPath, targetBranch);
        const oldText = String(call.args.oldText || "");
        const newText = String(call.args.newText ?? "");
        if (!oldText || !current.content.includes(oldText)) {
          throw new Error(`Could not find exact oldText inside ${targetPath}.`);
        }
        const updatedContent = current.content.replace(oldText, newText);
        const up = await upsertGitHubFile(ghToken, repo, {
          path: targetPath,
          content: updatedContent,
          branch: targetBranch,
          message: commitMsg,
          sha: current.sha,
        });
        fileCacheRef.current.set(targetPath, { content: updatedContent, sha: up.sha });
        resultUrl = up.commitUrl;
      } else if (call.tool === "write_file") {
        const content = String(call.args.content ?? "");
        const up = await upsertGitHubFile(ghToken, repo, {
          path: targetPath,
          content,
          branch: targetBranch,
          message: commitMsg,
        });
        fileCacheRef.current.set(targetPath, { content, sha: up.sha });
        resultUrl = up.commitUrl;
      } else if (call.tool === "delete_file") {
        const del = await deleteGitHubFile(ghToken, repo, {
          path: targetPath,
          branch: targetBranch,
          message: commitMsg,
        });
        fileCacheRef.current.delete(targetPath);
        resultUrl = del.commitUrl;
      }

      let prNote = "";
      if (createdBranch) {
        const pr = await openGitHubPullRequest(ghToken, repo, {
          title: commitMsg.slice(0, 90),
          head: targetBranch,
          base: baseBranch,
          body: `Automated change reviewed & approved via **YFactory Code (Cloud GitHub Agent)**.\n\n- Tool: \`${call.tool}\`\n- File: \`${targetPath}\`\n- Reason: ${call.reason}`,
        });
        resultUrl = pr.prUrl;
        prNote = ` | PR #${pr.number}: ${pr.prUrl}`;
      }

      pushFeed("tool", `✓ Committed ${targetPath} on ${targetBranch}${prNote}`);
      setNotice(
        createdBranch
          ? `PR created on ${repo} (${targetBranch})`
          : `Committed ${targetPath} to ${targetBranch}`,
      );
      setPendingApproval(null);
      historyRef.current.push({
        role: "user",
        content: `TOOL RESULT [${call.tool}]: OK — committed ${targetPath} to branch ${targetBranch} (${resultUrl}). Summarize clearly for the user.`,
      });
      await runCloudAgentLoop();
    } catch (err) {
      setError(err instanceof Error ? err.message : "GitHub commit failed.");
    } finally {
      setCommitting(false);
    }
  };

  const handleRejectMutation = () => {
    if (!pendingApproval) return;
    const toolName = pendingApproval.call.tool;
    setPendingApproval(null);
    pushFeed("tool", `✕ User rejected ${toolName}`);
    historyRef.current.push({
      role: "user",
      content: `TOOL RESULT [${toolName}]: User rejected this change. Ask what they prefer or propose an alternative.`,
    });
    void runCloudAgentLoop();
  };

  return (
    <section
      className="ycw-root"
      dir={isRtl ? "rtl" : "ltr"}
      data-testid="code-agent-workspace"
    >
      <nav className="ycw-subnav" role="tablist">
        {(
          [
            ["cli", ui.tabCli, <Terminal size={14} key="cli" />],
            ["github", ui.tabGithub, <GitBranch size={14} key="gh" />],
            [
              "connectors",
              `${ui.tabConnectors}${connectedCount > 0 ? ` (${connectedCount})` : ""}`,
              <Puzzle size={14} key="conn" />,
            ],
            ["vscode", ui.tabVscode, <Code2 size={14} key="vsc" />],
          ] as const
        ).map(([id, label, icon]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={subTab === id}
            className={`ycw-subtab${subTab === id ? " is-active" : ""}`}
            onClick={() => setSubTab(id)}
            data-testid={`code-subtab-${id}`}
          >
            {icon}
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {notice && (
        <div className="ysh-ok" role="status">
          <CheckCircle2 size={14} style={{ verticalAlign: "middle", marginInlineEnd: 6 }} />
          {notice}
        </div>
      )}
      {error && (
        <div className="ysh-alert" role="alert">
          <AlertCircle size={14} style={{ verticalAlign: "middle", marginInlineEnd: 6 }} />
          {error}
        </div>
      )}

      {/* SUBTAB 1: CLAUDE CODE TERMINAL CLI */}
      {subTab === "cli" && (
        <>
          <div className="ycw-panel is-hero">
            <div className="ycw-head-row">
              <div>
                <h2 style={{ margin: 0, fontSize: 16 }}>{ui.cliTitle}</h2>
                <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--app-secondary)" }}>
                  {ui.cliSub}
                </p>
              </div>
              <button
                type="button"
                className="ych-btn"
                onClick={() => onOpenProviderCenter()}
              >
                <KeyRound size={14} />
                <span>{ui.openProviders}</span>
              </button>
            </div>

            <div className="ych-row">
              <button
                type="button"
                className="ych-btn is-primary"
                disabled={pairBusy}
                onClick={() => void handleGeneratePairing()}
                data-testid="button-cli-generate-pair"
              >
                {pairBusy ? (
                  <LoaderCircle className="loading-spinner" size={15} />
                ) : (
                  <Sparkles size={15} />
                )}
                <span>{pairBusy ? ui.generatingPair : ui.genPairBtn}</span>
              </button>
              {pairCode && (
                <button
                  type="button"
                  className="ycw-pair-code"
                  onClick={() => void copyText(pairCode.code)}
                  title="Copy pairing code"
                  data-testid="text-cli-pair-code"
                >
                  <span dir="ltr">{pairCode.code}</span>
                  <Copy size={15} />
                </button>
              )}
            </div>
            {pairCode && (
              <small style={{ color: "var(--app-secondary)", fontSize: 12 }}>
                {ui.pairExpires}
              </small>
            )}

            <div className="ycw-field">
              <label>{ui.replitCmdLbl}</label>
              <div className="ycw-code-box" dir="ltr">
                <code>{replitLaunchCmd}</code>
                <button
                  type="button"
                  className="ych-btn"
                  style={{ minHeight: 30, padding: "0 9px" }}
                  onClick={() => void copyText(replitLaunchCmd)}
                >
                  <Copy size={13} />
                </button>
              </div>
            </div>

            <div className="ycw-field">
              <label>{ui.anyCmdLbl}</label>
              <div className="ycw-code-box" dir="ltr">
                <code>{universalLaunchCmd}</code>
                <button
                  type="button"
                  className="ych-btn"
                  style={{ minHeight: 30, padding: "0 9px" }}
                  onClick={() => void copyText(universalLaunchCmd)}
                >
                  <Copy size={13} />
                </button>
              </div>
            </div>
          </div>

          <div className="ycw-panel">
            <div className="ycw-head-row">
              <strong style={{ fontSize: 14 }}>
                {ui.sessionsTitle} ({sessions.length})
              </strong>
              <button
                type="button"
                className="ych-btn"
                disabled={loadingSessions}
                onClick={() => void loadCliAndModels()}
              >
                <RefreshCw size={13} className={loadingSessions ? "loading-spinner" : ""} />
              </button>
            </div>
            {sessions.length === 0 ? (
              <p style={{ margin: 0, fontSize: 12.5, color: "var(--app-secondary)" }}>
                {ui.noSessions}
              </p>
            ) : (
              sessions.map((s) => (
                <div key={s.id} className="ycw-session-row">
                  <div>
                    <strong dir="ltr">{s.workspaceName}</strong>
                    <div style={{ fontSize: 11.5, color: "var(--app-secondary)" }} dir="ltr">
                      {s.platform} · {new Date(s.lastSeenAt).toLocaleString(locale)}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="ych-btn is-danger"
                    onClick={() => void handleRevokeSession(s.id)}
                  >
                    <Trash2 size={13} />
                    <span>{ui.revoke}</span>
                  </button>
                </div>
              ))
            )}
          </div>
        </>
      )}

      {/* SUBTAB 2: CLOUD GITHUB CODING AGENT */}
      {subTab === "github" && (
        <div className="ycw-panel">
          <div className="ycw-head-row">
            <strong style={{ fontSize: 15 }}>{ui.ghTitle}</strong>
            {feed.length > 0 && (
              <button
                type="button"
                className="ych-btn"
                onClick={() => {
                  setFeed([]);
                  historyRef.current = [];
                  setPendingApproval(null);
                }}
              >
                <span>{ui.clearChat}</span>
              </button>
            )}
          </div>

          {!connectors.github ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <p style={{ margin: 0, fontSize: 13, color: "var(--app-secondary)" }}>
                {ui.ghNeedConnect}
              </p>
              <div>
                <button
                  type="button"
                  className="ych-btn is-primary"
                  onClick={() => setSubTab("connectors")}
                >
                  <GitBranch size={15} />
                  <span>{ui.openConnBtn}</span>
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="ycw-grid-2">
                <div className="ycw-field">
                  <label>{ui.repoLbl}</label>
                  <AppSelect
                    title={ui.repoLbl}
                    value={selectedRepo}
                    searchable
                    disabled={loadingRepos || repos.length === 0}
                    dir={isRtl ? "rtl" : "ltr"}
                    valueDir="ltr"
                    options={repos.map((r) => ({
                      value: r.fullName,
                      label: r.fullName,
                      subtitle: r.description || r.defaultBranch,
                      badge: r.private ? "Private" : "Public",
                    }))}
                    onChange={(val) => {
                      setSelectedRepo(val);
                      const found = repos.find((r) => r.fullName === val);
                      if (found) setBranch(found.defaultBranch);
                    }}
                  />
                </div>

                <div className="ycw-field">
                  <label>{ui.modelLbl}</label>
                  <AppSelect
                    title={ui.modelLbl}
                    value={selectedModelKey}
                    placeholder={ui.noModels}
                    searchable={models.length >= 5}
                    disabled={models.length === 0}
                    dir={isRtl ? "rtl" : "ltr"}
                    valueDir="ltr"
                    options={models.map((m) => ({
                      value: `${m.provider}|${m.keyId}|${m.modelName}`,
                      label: m.modelName,
                      subtitle: m.providerName,
                      badge: m.recommendedForCode ? "★ Code" : m.providerName,
                    }))}
                    onChange={setSelectedModelKey}
                  />
                </div>
              </div>

              <div className="ych-row" style={{ justifyContent: "space-between" }}>
                <div className="ych-row">
                  <button
                    type="button"
                    className={`ych-btn${mode === "agent" ? " is-primary" : ""}`}
                    onClick={() => setMode("agent")}
                  >
                    <Play size={13} />
                    <span>{ui.modeAgent}</span>
                  </button>
                  <button
                    type="button"
                    className={`ych-btn${mode === "plan" ? " is-primary" : ""}`}
                    onClick={() => setMode("plan")}
                  >
                    <ShieldCheck size={13} />
                    <span>{ui.modePlan}</span>
                  </button>
                </div>
                <span className="ych-pill" dir="ltr">
                  {loadingTree
                    ? "Loading tree..."
                    : `${branch} · ${tree.filter((e) => e.type === "blob").length} files`}
                </span>
              </div>

              <label className="ych-row" style={{ fontSize: 12, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={usePrBranch}
                  onChange={(e) => setUsePrBranch(e.currentTarget.checked)}
                  style={{ accentColor: "var(--app-accent, #eab32e)" }}
                />
                <GitPullRequest size={14} />
                <span>{ui.commitPrLabel}</span>
              </label>

              {feed.length > 0 && (
                <div className="ycw-thread" aria-live="polite">
                  {feed.map((item) => (
                    <div key={item.id} className={`ycw-msg is-${item.kind}`}>
                      {item.kind === "assistant" ? (
                        <>
                          {item.modelName && (
                            <small style={{ color: "var(--app-accent-text)" }} dir="ltr">
                              ⚡ YFactory Code · {item.modelName}
                            </small>
                          )}
                          <ChatMarkdown
                            content={item.text}
                            copyLabel="Copy"
                            copiedLabel="Copied"
                          />
                        </>
                      ) : (
                        <span dir="auto">{item.text}</span>
                      )}
                    </div>
                  ))}
                  {running && (
                    <div className="ycw-msg is-tool">
                      <LoaderCircle
                        className="loading-spinner"
                        size={13}
                        style={{ verticalAlign: "middle", marginInlineEnd: 6 }}
                      />
                      {ui.thinking}
                    </div>
                  )}
                  <div ref={threadEndRef} />
                </div>
              )}

              {/* Visual Diff Approval Gate */}
              {pendingApproval && (
                <div className="ycw-diff-card" data-testid="github-diff-approval">
                  <div className="ycw-head-row">
                    <strong style={{ color: "#fde047", fontSize: 13 }} dir="ltr">
                      {pendingApproval.call.tool}: {String(pendingApproval.call.args.path || "")}
                    </strong>
                    <span className="ych-pill">{pendingApproval.call.reason}</span>
                  </div>
                  <pre className="ycw-diff-pre" dir="ltr">
                    {pendingApproval.oldPreview &&
                      pendingApproval.oldPreview
                        .split(/\r?\n/)
                        .slice(0, 35)
                        .map((l, i) => (
                          <span key={`d${i}`} className="ycw-diff-del">
                            - {l}
                          </span>
                        ))}
                    {pendingApproval.newPreview &&
                      pendingApproval.newPreview
                        .split(/\r?\n/)
                        .slice(0, 35)
                        .map((l, i) => (
                          <span key={`a${i}`} className="ycw-diff-add">
                            + {l}
                          </span>
                        ))}
                  </pre>
                  <div className="ych-row">
                    <button
                      type="button"
                      className="ych-btn is-primary"
                      disabled={committing}
                      onClick={() => void handleApproveMutation()}
                      data-testid="button-github-approve-commit"
                    >
                      {committing ? (
                        <LoaderCircle className="loading-spinner" size={14} />
                      ) : (
                        <Check size={14} />
                      )}
                      <span>{ui.approveCommit}</span>
                    </button>
                    <button
                      type="button"
                      className="ych-btn is-danger"
                      disabled={committing}
                      onClick={handleRejectMutation}
                    >
                      <X size={14} />
                      <span>{ui.rejectEdit}</span>
                    </button>
                    <a
                      className="ych-btn"
                      href={`https://github.com/${pendingApproval.repo}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink size={13} />
                      <span>GitHub</span>
                    </a>
                  </div>
                </div>
              )}

              <form className="ycw-composer" onSubmit={handleSubmitPrompt}>
                <textarea
                  className="ycw-textarea"
                  dir="auto"
                  placeholder={ui.promptPh}
                  value={draft}
                  onChange={(e) => setDraft(e.currentTarget.value)}
                  disabled={running || Boolean(pendingApproval)}
                  data-testid="input-github-agent-prompt"
                />
                <button
                  type="submit"
                  className="ych-btn is-primary"
                  style={{ minHeight: 46 }}
                  disabled={
                    running ||
                    Boolean(pendingApproval) ||
                    !draft.trim() ||
                    !selectedRepo ||
                    models.length === 0
                  }
                  data-testid="button-github-agent-send"
                >
                  {running ? (
                    <LoaderCircle className="loading-spinner" size={15} />
                  ) : (
                    <Send size={15} />
                  )}
                  <span>{ui.send}</span>
                </button>
              </form>
            </>
          )}
        </div>
      )}

      {/* SUBTAB 3: DEV CONNECTORS */}
      {subTab === "connectors" && (
        <div className="ycw-panel">
          <ConnectorsHubContent
            locale={locale}
            onOpenCodeTab={() => setSubTab("github")}
          />
        </div>
      )}

      {/* SUBTAB 4: CLASSIC VS CODE EXTENSION DASHBOARD */}
      {subTab === "vscode" && (
        <CodeIdeDashboard
          locale={locale}
          getIdToken={getIdToken}
          onOpenProviderCenter={onOpenProviderCenter}
          onOpenChat={onOpenChat}
        />
      )}
    </section>
  );
}