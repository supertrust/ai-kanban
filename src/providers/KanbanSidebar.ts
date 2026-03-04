import * as vscode from "vscode";
import { ClaudeSession, ProjectGroup } from "../types";

type SidebarItem = ProjectItem | SessionItem;

export class KanbanSidebarProvider implements vscode.TreeDataProvider<SidebarItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    SidebarItem | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _projects: ProjectGroup[] = [];
  setProjects(projects: ProjectGroup[]): void {
    this._projects = projects;
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: SidebarItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: SidebarItem): SidebarItem[] {
    if (!element) {
      return this._projects.map((group) => new ProjectItem(group));
    }
    if (element instanceof ProjectItem) {
      return element.group.sessions.map(
        (session) => new SessionItem(session),
      );
    }
    return [];
  }


}

class ProjectItem extends vscode.TreeItem {
  constructor(public readonly group: ProjectGroup) {
    super(group.name, vscode.TreeItemCollapsibleState.Expanded);
    this.description = `${group.sessions.length} sessions`;
    this.iconPath = group.hasLiveSession
      ? new vscode.ThemeIcon(
          "circle-filled",
          new vscode.ThemeColor("charts.red"),
        )
      : new vscode.ThemeIcon("folder");
    this.tooltip = group.path;
    this.contextValue = "project";
  }
}

class SessionItem extends vscode.TreeItem {
  constructor(public readonly session: ClaudeSession) {
    const label = formatSessionLabel(session);
    super(label, vscode.TreeItemCollapsibleState.None);

    this.description = session.lastUpdatedAt
      ? formatRelativeTime(session.lastUpdatedAt)
      : "";

    this.iconPath = session.isLive
      ? new vscode.ThemeIcon(
          "circle-filled",
          new vscode.ThemeColor("charts.red"),
        )
      : new vscode.ThemeIcon("comment-discussion");

    this.tooltip = new vscode.MarkdownString(
      [
        `**${label}**`,
        ``,
        `📁 ${session.projectPath}`,
        session.gitBranch ? `🌿 ${session.gitBranch}` : "",
        session.model ? `🤖 ${session.model}` : "",
        `📊 ${session.totalTokens.input + session.totalTokens.output} tokens`,
        `📋 ${session.tasks.length} tasks`,
      ]
        .filter(Boolean)
        .join("\n"),
    );

    this.command = {
      command: "claudeKanban.openBoard",
      title: "Open Board",
      arguments: [session.id],
    };

    this.contextValue = session.isLive ? "session-live" : "session";
  }
}

function formatSessionLabel(session: ClaudeSession): string {
  const firstTask = session.tasks[0];
  if (firstTask?.title) {
    return firstTask.title.slice(0, 50);
  }
  return session.id.slice(0, 8);
}

function formatRelativeTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
