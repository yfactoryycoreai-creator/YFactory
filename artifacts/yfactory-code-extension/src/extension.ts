import * as vscode from "vscode";
import { YFactoryApiClient } from "./apiClient";
import { YFactorySidebarProvider } from "./sidebarView";
import { LocalTerminalRunner } from "./terminalRunner";
import {
  DIFF_SCHEME,
  VirtualDiffProvider,
  WorkspaceBridge,
} from "./workspaceBridge";

export function activate(context: vscode.ExtensionContext): void {
  const diffProvider = new VirtualDiffProvider();
  const apiClient = new YFactoryApiClient(context.secrets);
  const workspaceBridge = new WorkspaceBridge(diffProvider);
  const terminalRunner = new LocalTerminalRunner();
  const sidebarProvider = new YFactorySidebarProvider(
    context.extensionUri,
    apiClient,
    workspaceBridge,
    terminalRunner,
  );

  context.subscriptions.push(
    diffProvider,
    terminalRunner,
    vscode.workspace.registerTextDocumentContentProvider(
      DIFF_SCHEME,
      diffProvider,
    ),
    vscode.window.registerWebviewViewProvider(
      YFactorySidebarProvider.viewType,
      sidebarProvider,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
    vscode.commands.registerCommand("yfactoryCode.openSidebar", async () => {
      await vscode.commands.executeCommand("yfactoryCode.sidebar.focus");
    }),
    vscode.commands.registerCommand("yfactoryCode.pair", async () => {
      await sidebarProvider.promptPairFromCommand();
    }),
    vscode.commands.registerCommand("yfactoryCode.disconnect", async () => {
      await sidebarProvider.disconnectSession();
    }),
    vscode.commands.registerCommand("yfactoryCode.cancelTask", () => {
      sidebarProvider.cancelActiveTask();
    }),
  );
}

export function deactivate(): void {
  // Subscriptions are disposed automatically by VS Code.
}
