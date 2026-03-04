import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { EventEmitter } from "events";
import * as chokidar from "chokidar";
import { ClaudeSession } from "../types";
import { parseJsonlFile, parseNewLines } from "../parser/JsonlParser";

function resolveDir(dir: string): string {
  if (dir.startsWith("~")) {
    return path.join(os.homedir(), dir.slice(1));
  }
  return dir;
}

export interface WatcherEvents {
  sessionUpdated: (session: ClaudeSession) => void;
  newSession: (session: ClaudeSession) => void;
  sessionLive: (sessionId: string) => void;
}

export class FileWatcher extends EventEmitter {
  private claudeDir: string;
  private watcher?: chokidar.FSWatcher;
  private fileOffsets: Map<string, number> = new Map();
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private knownFiles: Set<string> = new Set();

  emit<K extends keyof WatcherEvents>(
    event: K,
    ...args: Parameters<WatcherEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }

  on<K extends keyof WatcherEvents>(
    event: K,
    listener: WatcherEvents[K],
  ): this {
    return super.on(event, listener);
  }

  constructor(claudeDir: string) {
    super();
    this.claudeDir = resolveDir(claudeDir);
  }

  start(): void {
    const projectsDir = path.join(this.claudeDir, "projects");
    if (!fs.existsSync(projectsDir)) {
      return;
    }

    this.watcher = chokidar.watch(`${projectsDir}/**/*.jsonl`, {
      persistent: true,
      ignoreInitial: false,      // emit 'add' for existing files on startup
      awaitWriteFinish: {
        stabilityThreshold: 100, // wait 100ms for write to settle
        pollInterval: 50,
      },
      usePolling: false,
      atomic: true,
    });

    this.watcher
      .on("add", (filePath: string) => {
        this.handleAdd(filePath);
      })
      .on("change", (filePath: string) => {
        this.handleChange(filePath);
      })
      .on("unlink", (filePath: string) => {
        this.fileOffsets.delete(filePath);
        this.knownFiles.delete(filePath);
        const timer = this.debounceTimers.get(filePath);
        if (timer) {
          clearTimeout(timer);
          this.debounceTimers.delete(filePath);
        }
      })
      .on("error", (err: Error) => {
        console.error("[Claude Kanban] FileWatcher error:", err);
      });
  }

  private handleAdd(filePath: string): void {
    const isNew = !this.knownFiles.has(filePath);
    this.knownFiles.add(filePath);

    // new files start at 0, existing files skip to EOF
    if (!this.fileOffsets.has(filePath)) {
      try {
        const stat = fs.statSync(filePath);
        this.fileOffsets.set(filePath, isNew ? 0 : stat.size);
      } catch {
        this.fileOffsets.set(filePath, 0);
      }
    }

    if (isNew) {
      const session = parseJsonlFile(filePath);
      if (session) {
        this.emit("newSession", session);
      }
    }
  }

  private handleChange(filePath: string): void {
    // register if not yet tracked
    if (!this.knownFiles.has(filePath)) {
      this.handleAdd(filePath);
    }

    const existing = this.debounceTimers.get(filePath);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(filePath);
      this.processChange(filePath);
    }, 150);

    this.debounceTimers.set(filePath, timer);
  }

  private processChange(filePath: string): void {
    const offset = this.fileOffsets.get(filePath) ?? 0;
    const { events, newOffset } = parseNewLines(filePath, offset);
    this.fileOffsets.set(filePath, newOffset);

    if (events.length === 0) {
      return;
    }

    const session = parseJsonlFile(filePath);
    if (session) {
      session.isLive = true;
      this.emit("sessionUpdated", session);
      this.emit("sessionLive", session.id);
    }
  }

  stop(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    if (this.watcher) {
      this.watcher.close().catch(() => {
        /* ignore */
      });
      this.watcher = undefined;
    }
  }
}
