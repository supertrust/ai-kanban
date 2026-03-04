import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ClaudeSession, ProjectGroup } from "../types";
import { parseJsonlFile } from "./JsonlParser";

function resolveDir(dir: string): string {
  if (dir.startsWith("~")) {
    return path.join(os.homedir(), dir.slice(1));
  }
  return dir;
}

export class SessionDetector {
  private claudeDir: string;
  private liveThresholdMs: number;

  constructor(claudeDir: string, liveThresholdMinutes: number = 10) {
    this.claudeDir = resolveDir(claudeDir);
    this.liveThresholdMs = liveThresholdMinutes * 60 * 1000;
  }

  getProjectsDir(): string {
    return path.join(this.claudeDir, "projects");
  }

  scanProjects(): ProjectGroup[] {
    const projectsDir = this.getProjectsDir();
    if (!fs.existsSync(projectsDir)) {
      return [];
    }

    const groups: Map<string, ProjectGroup> = new Map();

    let dirs: string[];
    try {
      dirs = fs.readdirSync(projectsDir);
    } catch {
      return [];
    }

    for (const dirName of dirs) {
      const dirPath = path.join(projectsDir, dirName);
      try {
        if (!fs.statSync(dirPath).isDirectory()) {
          continue;
        }
      } catch {
        continue;
      }

      const jsonlFiles = fs
        .readdirSync(dirPath)
        .filter((f) => f.endsWith(".jsonl"))
        .map((f) => {
          const fullPath = path.join(dirPath, f);
          try {
            return { path: fullPath, mtime: fs.statSync(fullPath).mtime.getTime() };
          } catch {
            return { path: fullPath, mtime: 0 };
          }
        })
        .sort((a, b) => b.mtime - a.mtime)
        .map((f) => f.path);

      const sessions: ClaudeSession[] = [];

      for (const filePath of jsonlFiles) {
        const session = parseJsonlFile(filePath);
        if (!session) {
          continue;
        }

        // Recheck live status with our threshold
        session.isLive = session.lastUpdatedAt
          ? Date.now() - session.lastUpdatedAt.getTime() < this.liveThresholdMs
          : false;

        sessions.push(session);
      }

      if (sessions.length === 0) {
        continue;
      }

      const projectName = sessions[0].projectName;
      const projectPath = sessions[0].projectPath;
      const hasLiveSession = sessions.some((s) => s.isLive);

      groups.set(dirName, {
        name: projectName,
        path: projectPath,
        sessions,
        hasLiveSession,
      });
    }

    // Sort: groups with live sessions first, then by most recent session
    return Array.from(groups.values()).sort((a, b) => {
      if (a.hasLiveSession && !b.hasLiveSession) {
        return -1;
      }
      if (!a.hasLiveSession && b.hasLiveSession) {
        return 1;
      }
      const aLatest = a.sessions[0]?.lastUpdatedAt?.getTime() ?? 0;
      const bLatest = b.sessions[0]?.lastUpdatedAt?.getTime() ?? 0;
      return bLatest - aLatest;
    });
  }

}
