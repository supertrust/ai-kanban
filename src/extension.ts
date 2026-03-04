import * as vscode from "vscode";
import { KanbanPanel } from "./providers/KanbanPanel";
import { KanbanSidebarProvider } from "./providers/KanbanSidebar";
import { SessionDetector } from "./parser/SessionDetector";
import { FileWatcher } from "./watcher/FileWatcher";
import { ProjectGroup } from "./types";

let fileWatcher: FileWatcher | undefined;
let sidebarProvider: KanbanSidebarProvider | undefined;

function getConfig() {
  const cfg = vscode.workspace.getConfiguration("aiKanban");
  return {
    claudeDir: cfg.get<string>("claudeDir", "~/.claude"),
    liveThresholdMinutes: cfg.get<number>("liveThresholdMinutes", 10),
    autoOpenOnLive: cfg.get<boolean>("autoOpenOnLive", false),
  };
}

function getWorkspacePath(): string {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
}

function applyFilter(projects: ProjectGroup[]): ProjectGroup[] {
  const ws = getWorkspacePath();
  if (!ws) return projects;
  return projects.filter((g) => g.path === ws);
}

function isSessionAllowed(session: { projectPath: string }): boolean {
  const ws = getWorkspacePath();
  if (!ws) return true;
  return session.projectPath === ws;
}

export function activate(context: vscode.ExtensionContext) {
  const { claudeDir, liveThresholdMinutes } = getConfig();
  const detector = new SessionDetector(claudeDir, liveThresholdMinutes);

  sidebarProvider = new KanbanSidebarProvider();
  vscode.window.registerTreeDataProvider("aiKanban.sessions", sidebarProvider);

  let allProjects: ProjectGroup[] = [];

  function refresh() {
    const filtered = applyFilter(allProjects);
    sidebarProvider?.setProjects(filtered);
    if (KanbanPanel.currentPanel) {
      KanbanPanel.currentPanel.updateProjects(filtered);
    }
  }

  try {
    allProjects = detector.scanProjects();
    refresh();
  } catch (err) {
    vscode.window.showErrorMessage(`AI Kanban: Failed to load sessions — ${err}`);
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("aiKanban")) {
        refresh();
      }
    }),
  );

  const openBoardCmd = vscode.commands.registerCommand(
    "aiKanban.openBoard",
    (sessionId?: string) => {
      const filtered = applyFilter(allProjects);
      sidebarProvider?.setProjects(filtered);
      const panel = KanbanPanel.createOrShow(context);
      panel.updateProjects(filtered);
      if (sessionId) {
        panel.setActiveSession(sessionId);
      }
    },
  );

  const refreshCmd = vscode.commands.registerCommand(
    "aiKanban.refresh",
    () => {
      try {
        allProjects = detector.scanProjects();
        refresh();
        vscode.window.setStatusBarMessage("AI Kanban: Refreshed", 2000);
      } catch (err) {
        vscode.window.showErrorMessage(`AI Kanban: Refresh failed — ${err}`);
      }
    },
  );

  fileWatcher = new FileWatcher(claudeDir);

  function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): T {
    let timer: ReturnType<typeof setTimeout>;
    return ((...args: any[]) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    }) as T;
  }

  const debouncedRefreshPanel = debounce(() => {
    if (KanbanPanel.currentPanel) {
      KanbanPanel.currentPanel.updateProjects(applyFilter(allProjects));
    }
  }, 400);

  fileWatcher.on("sessionUpdated", (session) => {
    let found = false;
    for (const group of allProjects) {
      const idx = group.sessions.findIndex((s) => s.id === session.id);
      if (idx >= 0) {
        group.sessions[idx] = session;
        group.hasLiveSession = group.sessions.some((s) => s.isLive);
        found = true;
        break;
      }
    }
    if (!found) {
      let projectGroup = allProjects.find((g) => g.path === session.projectPath);
      if (!projectGroup) {
        projectGroup = { name: session.projectName, path: session.projectPath, sessions: [], hasLiveSession: false };
        allProjects.unshift(projectGroup);
      }
      projectGroup.sessions.unshift(session);
      projectGroup.hasLiveSession = session.isLive;
    }

    const { autoOpenOnLive: aol } = getConfig();
    if (!isSessionAllowed(session)) return;

    const filtered = applyFilter(allProjects);
    sidebarProvider?.setProjects(filtered);

    if (KanbanPanel.currentPanel) {
      // partial update for active session, debounced full refresh otherwise
      if (KanbanPanel.currentPanel.activeSessionId === session.id) {
        KanbanPanel.currentPanel.pushSessionUpdate(session);
      } else {
        debouncedRefreshPanel();
      }
    } else if (aol && session.isLive) {
      const panel = KanbanPanel.createOrShow(context);
      panel.updateProjects(filtered);
    }
  });

  fileWatcher.on("newSession", (session) => {
    let projectGroup = allProjects.find((g) => g.path === session.projectPath);
    if (!projectGroup) {
      projectGroup = { name: session.projectName, path: session.projectPath, sessions: [], hasLiveSession: false };
      allProjects.unshift(projectGroup);
    }
    // update if already tracked, otherwise add
    const existingIdx = projectGroup.sessions.findIndex((s) => s.id === session.id);
    if (existingIdx >= 0) {
      projectGroup.sessions[existingIdx] = session;
    } else {
      projectGroup.sessions.unshift(session);
    }
    projectGroup.hasLiveSession = projectGroup.sessions.some((s) => s.isLive);

    if (!isSessionAllowed(session)) return;

    const filtered = applyFilter(allProjects);
    sidebarProvider?.setProjects(filtered);
    if (KanbanPanel.currentPanel) {
      KanbanPanel.currentPanel.updateProjects(filtered);
    }
  });

  fileWatcher.start();

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = "aiKanban.openBoard";
  statusBar.text = "$(layout-panel) AI Kanban";
  statusBar.tooltip = "Open AI Kanban Board";
  statusBar.show();

  context.subscriptions.push(openBoardCmd, refreshCmd, statusBar);
}

export function deactivate() {
  fileWatcher?.stop();
}
