import { spawn } from "node:child_process";
import { mkdtemp, open, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DetailsError, documentPath, MAX_DOCUMENT_BYTES, validateCommit, type DocumentRead, type DocumentRevision } from "./types";

export interface GitConfig {
  directory: string;
  branch?: string;
  authorName?: string;
  authorEmail?: string;
}
export interface GitResult { stdout: string; code: number }
export type GitRunner = (args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; input?: string }) => Promise<GitResult>;
const runGit: GitRunner = (args, options) => new Promise((resolve, reject) => {
  const child = spawn("git", args, { cwd: options.cwd, env: options.env, stdio: ["pipe", "pipe", "pipe"] });
  const chunks: Buffer[] = [];
  let size = 0;
  let settled = false;
  const finishError = (error: Error) => { if (!settled) { settled = true; reject(error); } };
  const timer = setTimeout(() => { child.kill("SIGKILL"); finishError(new Error("Git timed out")); }, 30_000);
  child.on("error", finishError);
  child.stdout.on("data", (chunk: Buffer) => {
    size += chunk.length;
    if (size > 12 * MAX_DOCUMENT_BYTES) { child.kill("SIGKILL"); finishError(new Error("Git output too large")); }
    else chunks.push(chunk);
  });
  child.stderr.resume(); // Never return filesystem/configuration secrets in HTTP errors.
  child.stdin.on("error", () => {});
  child.on("close", code => {
    clearTimeout(timer);
    if (!settled) {
      try {
        const stdout = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks));
        settled = true;
        resolve({ stdout, code: code ?? 1 });
      } catch { finishError(new Error("Git output is not valid UTF-8")); }
    }
  });
  child.stdin.end(options.input);
});

/** Server-only adapter. Call only after authenticated locator ownership validation. */
export class GitDetailsRepository {
  private readonly ref: string;
  constructor(private readonly config: GitConfig, private readonly runner: GitRunner = runGit) {
    const branch = config.branch ?? "main";
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(branch)) throw new DetailsError("configuration", "Invalid details branch configuration.", 503);
    this.ref = `refs/heads/${branch}`;
  }
  private async git(args: string[], input?: string, index?: string, allowFailure = false): Promise<GitResult> {
    const env: NodeJS.ProcessEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))), NODE_ENV: process.env.NODE_ENV };
    Object.assign(env, {
      GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", GIT_NO_REPLACE_OBJECTS: "1",
      GIT_AUTHOR_NAME: this.config.authorName ?? "LifeOR Details", GIT_AUTHOR_EMAIL: this.config.authorEmail ?? "details@localhost",
      GIT_COMMITTER_NAME: this.config.authorName ?? "LifeOR Details", GIT_COMMITTER_EMAIL: this.config.authorEmail ?? "details@localhost",
      ...(index ? { GIT_INDEX_FILE: index } : {}),
    });
    let result: GitResult;
    try { result = await this.runner(["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "commit.gpgsign=false", ...args], { cwd: this.config.directory, env, input }); }
    catch { throw new DetailsError("repository_unreadable", "The details repository is unavailable. Your draft has not been confirmed saved.", 503); }
    if (result.code !== 0 && !allowFailure) throw new DetailsError("git_failed", "Git could not complete the operation. Your draft has not been confirmed saved.", 503);
    return result;
  }
  private async verifyRepository() {
    // A bare repository prevents accidental application/source checkout writes and avoids stale worktree state.
    const bare = await this.git(["rev-parse", "--is-bare-repository"]);
    if (bare.stdout.trim() !== "true") throw new DetailsError("configuration", "Details must use a separate bare content repository.", 503);
    const gitDir = (await this.git(["rev-parse", "--absolute-git-dir"])).stdout.trim();
    if (await realpath(gitDir) !== await realpath(this.config.directory)) throw new DetailsError("configuration", "Details repository directory must be its bare Git root.", 503);
  }
  private async head(): Promise<string | null> {
    const result = await this.git(["rev-parse", "--verify", "--quiet", this.ref], undefined, undefined, true);
    if (result.code === 1) return null;
    if (result.code !== 0) throw new DetailsError("repository_unreadable", "Cannot resolve the details branch.", 503);
    return validateCommit(result.stdout.trim());
  }
  private async revision(commit: string) {
    validateCommit(commit);
    const exists = await this.git(["cat-file", "-t", commit], undefined, undefined, true);
    if (exists.code !== 0 || exists.stdout.trim() !== "commit") throw new DetailsError("revision_missing", "That committed revision is unavailable.", 404);
    const head = await this.head();
    if (!head || (await this.git(["merge-base", "--is-ancestor", commit, head], undefined, undefined, true)).code !== 0) throw new DetailsError("revision_missing", "That revision is not in the details branch history.", 404);
    return commit;
  }
  private async readAt(file: string, commit: string | null): Promise<DocumentRead> {
    if (!commit) return { availability: "missing", commit: null, source: null };
    const entry = (await this.git(["ls-tree", commit, "--", file])).stdout;
    if (!entry) return { availability: "missing", commit, source: null };
    if (!/^100644 blob [a-f0-9]+\t/.test(entry)) throw new DetailsError("invalid_document", "Details entry is not a regular document.", 503);
    const size = Number((await this.git(["cat-file", "-s", `${commit}:${file}`])).stdout);
    if (!Number.isSafeInteger(size) || size > MAX_DOCUMENT_BYTES) throw new DetailsError("document_too_large", "Document exceeds the 1 MiB editor limit.", 413);
    return { availability: "available", commit, source: (await this.git(["show", `${commit}:${file}`])).stdout };
  }
  async read(id: string, pinnedCommit?: string): Promise<DocumentRead> {
    const file = documentPath(id);
    await this.verifyRepository();
    return this.readAt(file, pinnedCommit ? await this.revision(pinnedCommit) : await this.head());
  }
  async history(id: string): Promise<DocumentRevision[]> {
    const file = documentPath(id);
    await this.verifyRepository();
    const head = await this.head();
    if (!head) return [];
    const output = (await this.git(["log", "-100", "--format=%H%x00%cI%x00%s", head, "--", file])).stdout;
    return output.trimEnd().split("\n").filter(Boolean).map(line => {
      const [commit, date, message] = line.split("\0");
      return { commit, date, message };
    });
  }
  async diff(id: string, from: string, to: string): Promise<string> {
    const file = documentPath(id);
    await this.verifyRepository();
    await this.revision(from);
    await this.revision(to);
    return (await this.git(["diff", "--no-ext-diff", "--no-textconv", "--no-color", "--unified=3", from, to, "--", file])).stdout;
  }
  async save(id: string, source: string, expectedCommit: string | null): Promise<DocumentRead & { changed: boolean }> {
    const file = documentPath(id);
    if (Buffer.from(source, "utf8").toString("utf8") !== source) throw new DetailsError("invalid_encoding", "Document source must be valid Unicode text.");
    if (Buffer.byteLength(source, "utf8") > MAX_DOCUMENT_BYTES) throw new DetailsError("document_too_large", "Document exceeds 1 MiB.", 413);
    if (expectedCommit !== null) validateCommit(expectedCommit);
    await this.verifyRepository();
    const lockPath = path.join(this.config.directory, "lifeor-details-writer.lock");
    let lock;
    try { lock = await open(lockPath, "wx", 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new DetailsError("writer_busy", "The document writer is busy or requires recovery. Keep your draft and retry.", 409);
      throw new DetailsError("repository_unwritable", "Cannot acquire the document writer lock.", 503);
    }
    let scratch: string | undefined;
    try {
      await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
      const parent = await this.head();
      const current = await this.readAt(file, parent);
      // Idempotent retry also repairs a failed DB cache update without another commit.
      if (current.availability === "available" && current.source === source) return { ...current, changed: false };
      if (parent !== expectedCommit) {
        const previous = await this.readAt(file, expectedCommit ? await this.revision(expectedCommit) : null);
        if (previous.availability !== current.availability || previous.source !== current.source) throw new DetailsError("stale_revision", "This document changed in Git. Reload current details before saving; keep a copy of your draft.", 409);
      }
      scratch = await mkdtemp(path.join(tmpdir(), "lifeor-details-"));
      const index = path.join(scratch, "index");
      await this.git(parent ? ["read-tree", parent] : ["read-tree", "--empty"], undefined, index);
      const blob = (await this.git(["hash-object", "-w", "--stdin"], source)).stdout.trim();
      await this.git(["update-index", "--add", "--cacheinfo", "100644", blob, file], undefined, index);
      const tree = (await this.git(["write-tree"], undefined, index)).stdout.trim();
      const commit = (await this.git(["commit-tree", tree, ...(parent ? ["-p", parent] : [])], `Update details ${id}\n`)).stdout.trim();
      validateCommit(commit);
      try { await this.git(["update-ref", this.ref, commit, parent ?? "0".repeat(commit.length)]); }
      catch (error) {
        // A lost process response may follow a successful atomic ref update.
        if (await this.head() !== commit) throw error;
      }
      return { availability: "available", source, commit, changed: true };
    } finally {
      if (scratch) await rm(scratch, { recursive: true, force: true }).catch(() => {});
      await lock.close();
      await rm(lockPath, { force: true });
    }
  }
}
