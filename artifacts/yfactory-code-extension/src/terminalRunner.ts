import { spawn, type ChildProcess } from "node:child_process";
import * as path from "node:path";
import * as vscode from "vscode";
import type { IdeProposedCommand } from "./apiClient";

export type LocalCommandResult = {
  command: string;
  approved: boolean;
  exitCode: number | null;
  output: string;
  aborted: boolean;
};

const MAX_OUTPUT_CHARS = 12_000;

export class LocalTerminalRunner {
  private readonly channel: vscode.OutputChannel;
  private activeChild: ChildProcess | null = null;

  constructor() {
    this.channel = vscode.window.createOutputChannel("YFactory Code Terminal");
  }

  isRunning(): boolean {
    return this.activeChild !== null;
  }

  stopActiveCommand(): void {
    if (this.activeChild) {
      this.activeChild.kill();
      this.activeChild = null;
      this.channel.appendLine("\n[YFactory Code] Command stopped by user.");
    }
  }

  async runApprovedCommand(
    workspaceRoot: string,
    proposal: IdeProposedCommand,
  ): Promise<LocalCommandResult> {
    if (this.activeChild) {
      throw new Error("Another command is already running. Stop it first.");
    }

    // Extra modal confirmation for destructive commands
    if (proposal.riskLevel === "destructive") {
      const answer = await vscode.window.showWarningMessage(
        `DESTRUCTIVE COMMAND WARNING:\n"${proposal.command}"\n\nReason: ${proposal.reason}\n\nOnly run this if you fully understand its impact.`,
        { modal: true },
        "Run Command Anyway",
      );
      if (answer !== "Run Command Anyway") {
        return {
          command: proposal.command,
          approved: false,
          exitCode: null,
          output: "Rejected by user at destructive confirmation.",
          aborted: false,
        };
      }
    }

    // Resolve safe working directory strictly inside workspaceRoot
    let cwd = workspaceRoot;
    if (proposal.cwd) {
      const candidate = path.resolve(workspaceRoot, proposal.cwd);
      const rel = path.relative(workspaceRoot, candidate);
      if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
        cwd = candidate;
      }
    }

    this.channel.show(true);
    this.channel.appendLine(`\n$ ${proposal.command}`);
    this.channel.appendLine(`[cwd: ${cwd}]`);

    return new Promise<LocalCommandResult>((resolve) => {
      let output = "";
      let aborted = false;

      const child = spawn(proposal.command, {
        cwd,
        shell: true,
        env: process.env,
      });
      this.activeChild = child;

      const appendChunk = (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        this.channel.append(text);
        if (output.length < MAX_OUTPUT_CHARS) {
          output += text.slice(0, MAX_OUTPUT_CHARS - output.length);
        }
      };

      child.stdout?.on("data", appendChunk);
      child.stderr?.on("data", appendChunk);

      child.on("error", (err) => {
        if (this.activeChild === child) this.activeChild = null;
        this.channel.appendLine(`\n[Error] ${err.message}`);
        resolve({
          command: proposal.command,
          approved: true,
          exitCode: 1,
          output: `${output}\n${err.message}`.trim(),
          aborted,
        });
      });

      child.on("close", (code, signal) => {
        if (this.activeChild === child) this.activeChild = null;
        if (signal) aborted = true;
        this.channel.appendLine(
          `\n[YFactory Code] Process exited (code=${code ?? "null"}${signal ? `, signal=${signal}` : ""}).`,
        );
        resolve({
          command: proposal.command,
          approved: true,
          exitCode: code,
          output: output.trim(),
          aborted,
        });
      });
    });
  }

  dispose(): void {
    this.stopActiveCommand();
    this.channel.dispose();
  }
}
