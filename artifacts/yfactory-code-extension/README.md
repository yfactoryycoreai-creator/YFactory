YFactory Code Extension (VS Code)
Official IDE-connected AI Coding Agent extension for YFactory AI. Works directly on your currently open workspace with diff review and approval-gated local terminal commands — no App Builder, no duplicate IDE, and zero API keys stored inside the extension or workspace.
Compatibility Status
Visual Studio Code (>= 1.85.0): Primary supported target.
Cursor: Built on standard VS Code Extension APIs; mark as experimental until verified directly in Cursor using the checklist below.
Quick Setup & Local Testing (VS Code)
Open a terminal inside artifacts/yfactory-code-extension/:
npm install
npm run compile
Open artifacts/yfactory-code-extension in Visual Studio Code and press F5 (Run Extension Development Host), or build a .vsix package with:
npx @vscode/vsce package
and install it via Extensions -> ... -> Install from VSIX.
Open any project folder (Workspace) in the Extension Development Host window.
Click the YFactory Code gold icon in the Activity Bar.
In YFactory AI -> Code, click Generate IDE Pairing Code, copy the Server URL + temporary code (YF-XXXX-XXXX), and connect.
Security Guarantees
Short-lived session tokens stored exclusively in VS Code SecretStorage.
Provider API keys stay encrypted in YFactory Backend (Provider Center).
Automatically excludes .env, .env.*, private keys (*.pem, *.key), *secret*.json, node_modules, dist, build, and .git.
Every file edit displays a side-by-side VS Code Diff before applying; delete/rename and destructive terminal commands require explicit modal confirmation.