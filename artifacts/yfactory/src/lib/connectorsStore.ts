import { useEffect, useState } from "react";

export type ConnectorId = "github" | "vercel" | "cloudflare" | "supabase";

export type GitHubConnectorConfig = {
  token: string;
  username: string;
  selectedRepo: string; // "owner/repo"
  selectedBranch: string;
  connectedAt: number;
};

export type VercelConnectorConfig = {
  token: string;
  teamId: string;
  accountLabel: string;
  lastSummary: string;
  connectedAt: number;
};

export type CloudflareConnectorConfig = {
  token: string;
  accountId: string;
  accountLabel: string;
  lastSummary: string;
  connectedAt: number;
};

export type SupabaseConnectorConfig = {
  projectUrl: string;
  apiKey: string;
  projectLabel: string;
  lastSummary: string;
  connectedAt: number;
};

export type DevConnectorsState = {
  github: GitHubConnectorConfig | null;
  vercel: VercelConnectorConfig | null;
  cloudflare: CloudflareConnectorConfig | null;
  supabase: SupabaseConnectorConfig | null;
  injectInChat: boolean;
};

export type GitHubRepoItem = {
  fullName: string;
  defaultBranch: string;
  private: boolean;
  description: string;
  updatedAt: string;
};

export type GitHubTreeEntry = {
  path: string;
  type: "blob" | "tree";
  sha: string;
  size?: number;
};

const STORAGE_KEY = "yfactory.dev.connectors.v1";
const CHANGE_EVENT = "yfactory:connectors-changed";

let memState: DevConnectorsState | null = null;

function emptyState(): DevConnectorsState {
  return {
    github: null,
    vercel: null,
    cloudflare: null,
    supabase: null,
    injectInChat: true,
  };
}

export function readDevConnectors(): DevConnectorsState {
  if (memState) return memState;
  if (typeof window === "undefined") {
    memState = emptyState();
    return memState;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      memState = emptyState();
      return memState;
    }
    const p = JSON.parse(raw) as Partial<DevConnectorsState>;
    memState = {
      github: p.github && p.github.token ? p.github : null,
      vercel: p.vercel && p.vercel.token ? p.vercel : null,
      cloudflare: p.cloudflare && p.cloudflare.token ? p.cloudflare : null,
      supabase: p.supabase && p.supabase.projectUrl ? p.supabase : null,
      injectInChat: p.injectInChat !== false,
    };
    return memState;
  } catch {
    memState = emptyState();
    return memState;
  }
}

export function writeDevConnectors(next: DevConnectorsState): void {
  memState = next;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore storage errors
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function updateDevConnectors(
  updater: (cur: DevConnectorsState) => DevConnectorsState,
): DevConnectorsState {
  const next = updater(readDevConnectors());
  writeDevConnectors(next);
  return next;
}

export function countConnectedDevConnectors(st: DevConnectorsState): number {
  return [st.github, st.vercel, st.cloudflare, st.supabase].filter(Boolean).length;
}

export function buildConnectorsChatContext(): string {
  const st = readDevConnectors();
  if (!st.injectInChat) return "";
  const lines: string[] = [];
  if (st.github) {
    lines.push(
      `- GitHub connected as @${st.github.username || "user"}${
        st.github.selectedRepo
          ? ` | Active Repo: ${st.github.selectedRepo} (branch: ${st.github.selectedBranch || "main"})`
          : ""
      }`,
    );
  }
  if (st.vercel) {
    lines.push(
      `- Vercel connected (${st.vercel.accountLabel || "account"})${
        st.vercel.lastSummary ? `: ${st.vercel.lastSummary}` : ""
      }`,
    );
  }
  if (st.cloudflare) {
    lines.push(
      `- Cloudflare connected (${st.cloudflare.accountLabel || "account"})${
        st.cloudflare.lastSummary ? `: ${st.cloudflare.lastSummary}` : ""
      }`,
    );
  }
  if (st.supabase) {
    lines.push(
      `- Supabase connected (${st.supabase.projectLabel || st.supabase.projectUrl})${
        st.supabase.lastSummary ? `: ${st.supabase.lastSummary}` : ""
      }`,
    );
  }
  if (lines.length === 0) return "";
  return [
    `CONNECTED USER DEV ENVIRONMENT CONNECTORS (client-owned):`,
    ...lines,
    `Note: For live multi-file GitHub edits/commits/PRs or terminal CLI execution, direct the user to the YFactory Code tab.`,
  ].join("\n");
}

export function useDevConnectors() {
  const [state, setState] = useState<DevConnectorsState>(() => readDevConnectors());

  useEffect(() => {
    const sync = () => setState(readDevConnectors());
    window.addEventListener(CHANGE_EVENT, sync);
    return () => window.removeEventListener(CHANGE_EVENT, sync);
  }, []);

  return {
    state,
    connectedCount: countConnectedDevConnectors(state),
    update: updateDevConnectors,
  };
}

/* ==================== GITHUB DIRECT CLIENT API (ZERO SERVER LOAD) ==================== */

function toBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function fromBase64Utf8(b64: string): string {
  const clean = b64.replace(/\s+/g, "");
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

async function ghFetch<T>(
  token: string,
  endpoint: string,
  init: RequestInit = {},
): Promise<T> {
  const resp = await fetch(`https://api.github.com${endpoint}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token.trim()}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
  if (!resp.ok) {
    const msg =
      typeof data.message === "string"
        ? data.message
        : `GitHub API error (HTTP ${resp.status})`;
    throw new Error(msg);
  }
  return data as T;
}

export async function verifyGitHubToken(token: string): Promise<{
  username: string;
  name: string;
}> {
  const user = await ghFetch<{ login?: string; name?: string }>(token, "/user");
  if (!user.login) throw new Error("Invalid GitHub token.");
  return { username: user.login, name: user.name || user.login };
}

export async function listGitHubRepos(token: string): Promise<GitHubRepoItem[]> {
  const list = await ghFetch<
    Array<{
      full_name: string;
      default_branch: string;
      private: boolean;
      description: string | null;
      updated_at: string;
    }>
  >(token, "/user/repos?sort=updated&per_page=50&affiliation=owner,collaborator");

  return list.map((r) => ({
    fullName: r.full_name,
    defaultBranch: r.default_branch || "main",
    private: Boolean(r.private),
    description: r.description || "",
    updatedAt: r.updated_at || "",
  }));
}

export async function fetchGitHubTree(
  token: string,
  fullName: string,
  branch: string,
): Promise<GitHubTreeEntry[]> {
  const res = await ghFetch<{
    tree?: Array<{ path?: string; type?: string; sha?: string; size?: number }>;
  }>(
    token,
    `/repos/${fullName}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
  );
  return (res.tree ?? [])
    .filter(
      (item): item is { path: string; type: "blob" | "tree"; sha: string; size?: number } =>
        typeof item.path === "string" &&
        (item.type === "blob" || item.type === "tree") &&
        typeof item.sha === "string",
    )
    .filter(
      (item) =>
        !/(?:^|\/)(?:node_modules|\.git|dist|build|\.next)(?:\/|$)/.test(item.path),
    );
}

export async function readGitHubFile(
  token: string,
  fullName: string,
  filePath: string,
  branch: string,
): Promise<{ content: string; sha: string }> {
  const cleanPath = filePath.replace(/^\/+/, "");
  const encodedPath = cleanPath
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  const data = await ghFetch<{
    content?: string;
    encoding?: string;
    sha?: string;
  }>(
    token,
    `/repos/${fullName}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`,
  );
  if (!data.sha) throw new Error(`File not found: ${cleanPath}`);
  const content =
    data.encoding === "base64" && typeof data.content === "string"
      ? fromBase64Utf8(data.content)
      : String(data.content ?? "");
  return { content, sha: data.sha };
}

export async function createGitHubBranch(
  token: string,
  fullName: string,
  baseBranch: string,
  newBranchName: string,
): Promise<string> {
  const ref = await ghFetch<{ object?: { sha?: string } }>(
    token,
    `/repos/${fullName}/git/ref/heads/${encodeURIComponent(baseBranch)}`,
  );
  const sha = ref.object?.sha;
  if (!sha) throw new Error(`Could not resolve base branch "${baseBranch}".`);
  await ghFetch(token, `/repos/${fullName}/git/refs`, {
    method: "POST",
    body: JSON.stringify({
      ref: `refs/heads/${newBranchName}`,
      sha,
    }),
  });
  return newBranchName;
}

export async function upsertGitHubFile(
  token: string,
  fullName: string,
  input: {
    path: string;
    content: string;
    branch: string;
    message: string;
    sha?: string;
  },
): Promise<{ commitUrl: string; sha: string }> {
  const cleanPath = input.path.replace(/^\/+/, "");
  const encodedPath = cleanPath
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  let fileSha = input.sha;
  if (!fileSha) {
    try {
      const existing = await readGitHubFile(token, fullName, cleanPath, input.branch);
      fileSha = existing.sha;
    } catch {
      // Creating a brand-new file
    }
  }
  const res = await ghFetch<{
    commit?: { html_url?: string };
    content?: { sha?: string };
  }>(token, `/repos/${fullName}/contents/${encodedPath}`, {
    method: "PUT",
    body: JSON.stringify({
      message: input.message,
      content: toBase64Utf8(input.content),
      branch: input.branch,
      ...(fileSha ? { sha: fileSha } : {}),
    }),
  });
  return {
    commitUrl: res.commit?.html_url || `https://github.com/${fullName}`,
    sha: res.content?.sha || "",
  };
}

export async function deleteGitHubFile(
  token: string,
  fullName: string,
  input: { path: string; branch: string; message: string },
): Promise<{ commitUrl: string }> {
  const cleanPath = input.path.replace(/^\/+/, "");
  const encodedPath = cleanPath
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  const existing = await readGitHubFile(token, fullName, cleanPath, input.branch);
  const res = await ghFetch<{ commit?: { html_url?: string } }>(
    token,
    `/repos/${fullName}/contents/${encodedPath}`,
    {
      method: "DELETE",
      body: JSON.stringify({
        message: input.message,
        sha: existing.sha,
        branch: input.branch,
      }),
    },
  );
  return { commitUrl: res.commit?.html_url || `https://github.com/${fullName}` };
}

export async function openGitHubPullRequest(
  token: string,
  fullName: string,
  input: { title: string; head: string; base: string; body: string },
): Promise<{ prUrl: string; number: number }> {
  const res = await ghFetch<{ html_url?: string; number?: number }>(
    token,
    `/repos/${fullName}/pulls`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return {
    prUrl: res.html_url || `https://github.com/${fullName}/pulls`,
    number: res.number || 0,
  };
}

/* ==================== VERCEL / CLOUDFLARE / SUPABASE LIVE TESTS ==================== */

export async function testVercelConnection(
  token: string,
  teamId?: string,
): Promise<{ accountLabel: string; summary: string }> {
  const qs = teamId?.trim() ? `?teamId=${encodeURIComponent(teamId.trim())}&limit=5` : "?limit=5";
  const resp = await fetch(`https://api.vercel.com/v9/projects${qs}`, {
    headers: { Authorization: `Bearer ${token.trim()}` },
  });
  const data = (await resp.json().catch(() => ({}))) as {
    projects?: Array<{ name?: string; latestDeployments?: Array<{ readyState?: string }> }>;
    error?: { message?: string };
  };
  if (!resp.ok) {
    throw new Error(data.error?.message || `Vercel API HTTP ${resp.status}`);
  }
  const projects = data.projects ?? [];
  const names = projects
    .slice(0, 4)
    .map((p) => {
      const st = p.latestDeployments?.[0]?.readyState;
      return st ? `${p.name} (${st})` : p.name || "project";
    })
    .join(", ");
  return {
    accountLabel: `${projects.length} project(s)`,
    summary: names || "Connected (no projects found)",
  };
}

export async function testCloudflareConnection(
  token: string,
): Promise<{ accountLabel: string; summary: string }> {
  const resp = await fetch("https://api.cloudflare.com/client/v4/user/tokens/verify", {
    headers: { Authorization: `Bearer ${token.trim()}` },
  });
  const data = (await resp.json().catch(() => ({}))) as {
    success?: boolean;
    result?: { status?: string; id?: string };
    errors?: Array<{ message?: string }>;
  };
  if (!resp.ok || !data.success) {
    throw new Error(
      data.errors?.[0]?.message || `Cloudflare verification failed (HTTP ${resp.status})`,
    );
  }
  return {
    accountLabel: `Token ${data.result?.status || "active"}`,
    summary: `Cloudflare API token verified (${data.result?.status || "active"})`,
  };
}

export async function testSupabaseConnection(
  projectUrl: string,
  apiKey: string,
): Promise<{ projectLabel: string; summary: string }> {
  const cleanUrl = projectUrl.trim().replace(/\/+$/, "");
  if (!/^https:\/\/[a-z0-9.-]+\.supabase\.co$/i.test(cleanUrl)) {
    throw new Error("Enter a valid Supabase URL (https://<ref>.supabase.co).");
  }
  const resp = await fetch(`${cleanUrl}/rest/v1/`, {
    headers: {
      apikey: apiKey.trim(),
      Authorization: `Bearer ${apiKey.trim()}`,
    },
  });
  if (!resp.ok && resp.status !== 200) {
    throw new Error(`Supabase REST check failed (HTTP ${resp.status})`);
  }
  const host = new URL(cleanUrl).hostname.split(".")[0] || "project";
  return {
    projectLabel: host,
    summary: `Supabase REST OpenAPI reachable (${host})`,
  };
}