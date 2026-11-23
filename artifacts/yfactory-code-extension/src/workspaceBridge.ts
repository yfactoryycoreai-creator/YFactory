import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import type { IdeAttachedFile, IdeProposedEdit } from "./apiClient";

const MAX_FILE_BYTES = 180_000;
const MAX_FILE_CHARS = 18_000;
const MAX_TREE_ITEMS = 250;

const EXCLUDED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  "coverage",
  ".cache",
  ".venv",
  "venv",
  "__pycache__",
  "target",
]);

const SENSITIVE_PATTERNS: ReadonlyArray<RegExp> = [
  /(?:^|\/)\.env(?:\.|$)/i,
  /(?:^|\/)\.git(?:\/|$)/i,
  /(?:^|\/)node_modules(?:\/|$)/i,
  /\.(?:pem|key|p12|pfx|jks|keystore|crt)$/i,
  /(?:^|\/)(?:id_rsa|id_ed25519|id_ecdsa)(?:\.pub)?$/i,
  /(?:^|\/).*(?:secret|credential|service[-_]?account).*\.json$/i,
  /(?:^|\/)\.npmrc$/i,
  /(?:^|\/)\.pypirc$/i,
];

export const DIFF_SCHEME = "yfactory-diff";

export class VirtualDiffProvider implements vscode.TextDocumentContentProvider {
  private readonly contents = new Map<string, string>();
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.emitter.event;

  setContent(uri: vscode.Uri, content: string): void {
    this.contents.set(uri.toString(), content);
    this.emitter.fire(uri);
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? "";
  }

  dispose(): void {
    this.contents.clear();
    this.emitter.dispose();
  }
}

export class WorkspaceBridge {
  private readonly diffProvider: VirtualDiffProvider;

  constructor(diffProvider: VirtualDiffProvider) {
    this.diffProvider = diffProvider;
  }

  getWorkspaceRoot(): { rootPath: string; name: string } | null {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return null;
    return { rootPath: folder.uri.fsPath, name: folder.name };
  }

  isSensitivePath(relPath: string): boolean {
    const norm = relPath.replace(/\\/g, "/").trim().replace(/^\.\//, "");
    if (!norm || norm.startsWith("/") || norm.includes("..")) return true;
    const parts = norm.split("/");
    if (parts.some((p) => EXCLUDED_DIRS.has(p))) return true;
    return SENSITIVE_PATTERNS.some((rx) => rx.test(norm));
  }

  resolveSafePath(relPath: string): { absPath: string; relPath: string } | null {
    const ws = this.getWorkspaceRoot();
    if (!ws) return null;
    const cleaned = relPath.replace(/\\/g, "/").trim().replace(/^\.\//, "");
    if (!cleaned || this.isSensitivePath(cleaned)) return null;
    const absPath = path.resolve(ws.rootPath, cleaned);
    const relative = path.relative(ws.rootPath, absPath).replace(/\\/g, "/");
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      return null;
    }
    if (this.isSensitivePath(relative)) return null;
    return { absPath, relPath: relative };
  }

  async listAuthorizedTree(): Promise<string[]> {
    const ws = this.getWorkspaceRoot();
    if (!ws) return [];
    const results: string[] = [];

    const walk = async (dirAbs: string, prefix: string): Promise<void> => {
      if (results.length >= MAX_TREE_ITEMS) return;
      let entries;
      try {
        entries = await fs.readdir(dirAbs, { withFileTypes: true });
      } catch {
        return;
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (results.length >= MAX_TREE_ITEMS) return;
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          if (EXCLUDED_DIRS.has(entry.name) || entry.name.startsWith(".git")) {
            continue;
          }
          await walk(path.join(dirAbs, entry.name), rel);
        } else if (entry.isFile()) {
          if (this.isSensitivePath(rel)) continue;
          results.push(rel);
        }
      }
    };

    await walk(ws.rootPath, "");
    return results;
  }

  async readAuthorizedFile(relPath: string): Promise<IdeAttachedFile | null> {
    const safe = this.resolveSafePath(relPath);
    if (!safe) return null;
    try {
      const stat = await fs.stat(safe.absPath);
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;
      const raw = await fs.readFile(safe.absPath, "utf8");
      if (raw.includes("\u0000")) return null;
      const ext = path.extname(safe.relPath).replace(/^\./, "");
      return {
        path: safe.relPath,
        content: raw.slice(0, MAX_FILE_CHARS),
        ...(ext ? { language: ext } : {}),
      };
    } catch {
      return null;
    }
  }

  async getActiveEditorFile(): Promise<IdeAttachedFile | null> {
    const ws = this.getWorkspaceRoot();
    const editor = vscode.window.activeTextEditor;
    if (!ws || !editor || editor.document.uri.scheme !== "file") return null;
    const rel = path
      .relative(ws.rootPath, editor.document.uri.fsPath)
      .replace(/\\/g, "/");
    if (!rel || rel.startsWith("..") || this.isSensitivePath(rel)) return null;
    return {
      path: rel,
      content: editor.document.getText().slice(0, MAX_FILE_CHARS),
      language: editor.document.languageId,
    };
  }

  private async computeProposedContent(
    edit: IdeProposedEdit,
  ): Promise<{ original: string; proposed: string; exists: boolean }> {
    const safe = this.resolveSafePath(edit.path);
    if (!safe) {
      throw new Error(`Path is outside workspace or restricted: ${edit.path}`);
    }

    let original = "";
    let exists = false;
    try {
      original = await fs.readFile(safe.absPath, "utf8");
      exists = true;
    } catch {
      exists = false;
    }

    if (edit.action === "create") {
      return { original: "", proposed: edit.newContent ?? edit.replaceBlock ?? "", exists };
    }
    if (edit.action === "delete") {
      return { original, proposed: "", exists };
    }
    if (edit.action === "rename") {
      return { original, proposed: original, exists };
    }

    // Targeted edit: replace searchBlock with replaceBlock when available
    if (edit.searchBlock && original.includes(edit.searchBlock)) {
      const proposed = original.replace(edit.searchBlock, edit.replaceBlock ?? "");
      return { original, proposed, exists };
    }
    if (typeof edit.newContent === "string") {
      return { original, proposed: edit.newContent, exists };
    }
    if (edit.searchBlock) {
      throw new Error(
        `Could not locate exact searchBlock in ${safe.relPath}. File may have changed.`,
      );
    }
    throw new Error(`Edit proposal for ${safe.relPath} is missing replacement content.`);
  }

  async previewEditDiff(edit: IdeProposedEdit): Promise<void> {
    const safe = this.resolveSafePath(edit.path);
    if (!safe) {
      throw new Error(`Restricted or invalid path: ${edit.path}`);
    }
    const { original, proposed } = await this.computeProposedContent(edit);
    const stamp = Date.now();
    const leftUri = vscode.Uri.parse(
      `${DIFF_SCHEME}:/before/${stamp}/${encodeURIComponent(safe.relPath)}`,
    );
    const rightUri = vscode.Uri.parse(
      `${DIFF_SCHEME}:/after/${stamp}/${encodeURIComponent(safe.relPath)}`,
    );
    this.diffProvider.setContent(leftUri, original);
    this.diffProvider.setContent(rightUri, proposed);
    const title = `YFactory Diff: ${safe.relPath} (${edit.action})`;
    await vscode.commands.executeCommand("vscode.diff", leftUri, rightUri, title);
  }

  async applyProposedEdit(edit: IdeProposedEdit): Promise<string> {
    const safe = this.resolveSafePath(edit.path);
    if (!safe) {
      throw new Error(`Path is outside workspace or restricted: ${edit.path}`);
    }
    const targetUri = vscode.Uri.file(safe.absPath);

    if (edit.action === "delete") {
      const confirm = await vscode.window.showWarningMessage(
        `YFactory Code wants to DELETE "${safe.relPath}". Reason: ${edit.reason}`,
        { modal: true },
        "Delete File",
      );
      if (confirm !== "Delete File") {
        throw new Error("Delete rejected by user.");
      }
      const wsEdit = new vscode.WorkspaceEdit();
      wsEdit.deleteFile(targetUri, { ignoreIfNotExists: true });
      const ok = await vscode.workspace.applyEdit(wsEdit);
      if (!ok) throw new Error(`Failed to delete ${safe.relPath}.`);
      return safe.relPath;
    }

    if (edit.action === "rename") {
      if (!edit.newPath) throw new Error("Missing destination path for rename.");
      const destSafe = this.resolveSafePath(edit.newPath);
      if (!destSafe) throw new Error(`Restricted destination path: ${edit.newPath}`);
      const confirm = await vscode.window.showWarningMessage(
        `YFactory Code wants to RENAME "${safe.relPath}" to "${destSafe.relPath}". Reason: ${edit.reason}`,
        { modal: true },
        "Rename File",
      );
      if (confirm !== "Rename File") {
        throw new Error("Rename rejected by user.");
      }
      const wsEdit = new vscode.WorkspaceEdit();
      wsEdit.renameFile(targetUri, vscode.Uri.file(destSafe.absPath), {
        overwrite: false,
      });
      const ok = await vscode.workspace.applyEdit(wsEdit);
      if (!ok) throw new Error(`Failed to rename ${safe.relPath}.`);
      return destSafe.relPath;
    }

    const { proposed, exists } = await this.computeProposedContent(edit);
    if (edit.action === "create" || !exists) {
      await fs.mkdir(path.dirname(safe.absPath), { recursive: true });
      const wsEdit = new vscode.WorkspaceEdit();
      wsEdit.createFile(targetUri, { ignoreIfExists: true });
      wsEdit.insert(targetUri, new vscode.Position(0, 0), proposed);
      const ok = await vscode.workspace.applyEdit(wsEdit);
      if (!ok) throw new Error(`Failed to create ${safe.relPath}.`);
      const doc = await vscode.workspace.openTextDocument(targetUri);
      await doc.save();
      await vscode.window.showTextDocument(doc, { preview: false });
      return safe.relPath;
    }

    // Targeted WorkspaceEdit so VS Code native Undo (Ctrl+Z) works smoothly
    const doc = await vscode.workspace.openTextDocument(targetUri);
    const currentText = doc.getText();
    const wsEdit = new vscode.WorkspaceEdit();
    if (edit.searchBlock && currentText.includes(edit.searchBlock)) {
      const startOffset = currentText.indexOf(edit.searchBlock);
      const endOffset = startOffset + edit.searchBlock.length;
      const range = new vscode.Range(
        doc.positionAt(startOffset),
        doc.positionAt(endOffset),
      );
      wsEdit.replace(targetUri, range, edit.replaceBlock ?? "");
    } else {
      const fullRange = new vscode.Range(
        doc.positionAt(0),
        doc.positionAt(currentText.length),
      );
      wsEdit.replace(targetUri, fullRange, proposed);
    }

    const ok = await vscode.workspace.applyEdit(wsEdit);
    if (!ok) throw new Error(`Failed to apply edit to ${safe.relPath}.`);
    await doc.save();
    await vscode.window.showTextDocument(doc, { preview: false });
    return safe.relPath;
  }
}
