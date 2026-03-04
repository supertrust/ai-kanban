import * as vscode from "vscode";
import * as path from "path";
import * as crypto from "crypto";
import {
  ClaudeSession,
  ExtensionMessage,
  ProjectGroup,
  WebviewMessage,
} from "../types";
export class KanbanPanel {
  public static currentPanel: KanbanPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _context: vscode.ExtensionContext;
  private _disposables: vscode.Disposable[] = [];
  private _projects: ProjectGroup[] = [];
  private _activeSessionId?: string;
  private _webviewReady = false;

  static createOrShow(context: vscode.ExtensionContext): KanbanPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (KanbanPanel.currentPanel) {
      KanbanPanel.currentPanel._panel.reveal(column);
      return KanbanPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      "aiKanban",
      "AI Kanban",
      column ?? vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.file(path.join(context.extensionPath, "webview")),
        ],
      },
    );

    KanbanPanel.currentPanel = new KanbanPanel(panel, context);
    return KanbanPanel.currentPanel;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
  ) {
    this._panel = panel;
    this._context = context;

    this._panel.webview.html = this._getHtmlContent();
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.onDidChangeViewState(({ webviewPanel }) => {
      if (webviewPanel.visible && this._webviewReady) {
        this._sendInit();
      }
    }, null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      (message: WebviewMessage) => this._handleWebviewMessage(message),
      null,
      this._disposables,
    );
  }

  private _handleWebviewMessage(message: WebviewMessage): void {
    switch (message.type) {
      case "ready":
        this._webviewReady = true;
        this._sendInit();
        break;
      case "selectSession": {
        const session = this._findSession(message.sessionId);
        if (session) {
          this._activeSessionId = message.sessionId;
          this._send({ type: "sessionData", session });
        }
        break;
      }
      case "moveTask":
        // Task status is managed client-side for manual moves
        break;
    }
  }

  private _findSession(sessionId: string): ClaudeSession | undefined {
    for (const group of this._projects) {
      const s = group.sessions.find((s) => s.id === sessionId);
      if (s) {
        return s;
      }
    }
    return undefined;
  }

  updateProjects(projects: ProjectGroup[]): void {
    this._projects = projects;

    // Auto-select first live session if none selected
    if (!this._activeSessionId) {
      for (const group of projects) {
        const live = group.sessions.find((s) => s.isLive);
        if (live) {
          this._activeSessionId = live.id;
          break;
        }
      }
      if (!this._activeSessionId && projects.length > 0) {
        this._activeSessionId = projects[0]?.sessions[0]?.id;
      }
    }

    // only send if ready; the 'ready' handler sends it otherwise
    if (this._webviewReady && this._panel.visible) {
      this._sendInit();
    }
  }

  pushSessionUpdate(session: ClaudeSession): void {
    for (const group of this._projects) {
      const idx = group.sessions.findIndex((s) => s.id === session.id);
      if (idx >= 0) {
        group.sessions[idx] = session;
        group.hasLiveSession = group.sessions.some((s) => s.isLive);
        break;
      } else if (group.path === session.projectPath) {
        group.sessions.unshift(session);
        group.hasLiveSession = true;
        break;
      }
    }

    if (this._activeSessionId === session.id) {
      this._send({ type: "sessionData", session });
    }

    if (session.isLive) {
      this._send({ type: "sessionLive", sessionId: session.id });
    }
    // avoid full re-render per update to prevent flicker
  }

  private _sendInit(): void {
    this._send({
      type: "init",
      projects: this._projects,
      activeSessionId: this._activeSessionId,
    });
  }

  private _send(message: ExtensionMessage): void {
    if (this._panel.visible) {
      this._panel.webview.postMessage(message);
    }
  }

  setActiveSession(sessionId: string): void {
    this._activeSessionId = sessionId;
    if (this._webviewReady && this._panel.visible) {
      this._sendInit();
    }
  }

  get activeSessionId(): string | undefined {
    return this._activeSessionId;
  }

  private _getHtmlContent(): string {
    const webview = this._panel.webview;
    const webviewPath = path.join(this._context.extensionPath, "webview");

    const scriptUri = webview.asWebviewUri(
      vscode.Uri.file(path.join(webviewPath, "main.js")),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.file(path.join(webviewPath, "style.css")),
    );

    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'nonce-${nonce}';">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <link href="${styleUri}" rel="stylesheet">
  <title>AI Kanban</title>
</head>
<body>
  <div id="app">
    <div id="loading" class="loading-screen">
      <div class="loading-logo">
        <div class="loading-orb"></div>
        <span>AI Kanban</span>
      </div>
    </div>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  dispose(): void {
    KanbanPanel.currentPanel = undefined;
    this._panel.dispose();
    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables = [];
  }
}

function getNonce(): string {
  return crypto.randomBytes(16).toString("hex");
}
