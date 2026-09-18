// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { GitDetailsRepository, type GitResult } from "../lib/details/git";
import { DetailsService, type DetailsBackend } from "../lib/details/service";
import { documentPath, DetailsError, type DetailsLocator } from "../lib/details/types";
const exec = promisify(execFile);
let directory: string;
let repository: GitDetailsRepository;
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "details-test-"));
  await exec("git", ["init", "--bare", "--initial-branch=main", directory]);
  repository = new GitDetailsRepository({ directory, authorName: "Fixture Writer", authorEmail: "fixture@localhost" });
});
afterEach(async () => { vi.restoreAllMocks(); await rm(directory, { recursive: true, force: true }); });

describe("Git details repository", () => {
  it("distinguishes a missing file from a committed empty document, including an unborn branch", async () => {
    expect(await repository.read("doc1")).toEqual({ availability: "missing", commit: null, source: null });
    expect(await repository.history("doc1")).toEqual([]);
    const saved = await repository.save("doc1", "", null);
    expect(saved).toMatchObject({ availability: "available", source: "", changed: true });
    expect(await repository.read("doc1")).toMatchObject({ availability: "available", source: "", commit: saved.commit });
    expect(await repository.read("absent")).toMatchObject({ availability: "missing", source: null, commit: saved.commit });
  });
  it("round-trips exact source, pins history, and produces a path-scoped diff", async () => {
    const first = await repository.save("doc1", "\uFEFF---\r\nbroken: [oops\r\n---\r\n# Original 🏡\r\n", null);
    const second = await repository.save("doc1", "# Revised\n", first.commit);
    expect(await repository.read("doc1", first.commit!)).toMatchObject({ source: first.source, commit: first.commit });
    expect(await repository.read("doc1")).toMatchObject({ source: second.source, commit: second.commit });
    const history = await repository.history("doc1");
    expect(history.map(r => r.commit)).toEqual([second.commit, first.commit]);
    expect(await repository.diff("doc1", first.commit!, second.commit!)).toContain("+# Revised");
    const { stdout } = await exec("git", ["--git-dir", directory, "show", "-s", "--format=%an <%ae>", second.commit!]);
    expect(stdout.trim()).toBe("Fixture Writer <fixture@localhost>");
  });
  it("preserves other documents and allows an unchanged document to save after another document changed HEAD", async () => {
    const first = await repository.save("doc1", "first", null);
    const second = await repository.save("doc2", "second", null);
    const third = await repository.save("doc1", "third", first.commit);
    expect(third.changed).toBe(true);
    expect(await repository.read("doc2")).toMatchObject({ source: "second" });
    expect(await repository.read("doc2", first.commit!)).toMatchObject({ availability: "missing", source: null });
    expect(await repository.diff("doc1", first.commit!, second.commit!)).toBe("");
  });
  it("rejects stale changed-document saves and makes exact retries idempotent", async () => {
    const first = await repository.save("doc1", "first", null);
    const second = await repository.save("doc1", "second", first.commit);
    await expect(repository.save("doc1", "stale draft", first.commit)).rejects.toMatchObject({ code: "stale_revision", status: 409 });
    expect(await repository.save("doc1", "second", first.commit)).toMatchObject({ changed: false, commit: second.commit });
    expect(await repository.history("doc1")).toHaveLength(2);
  });
  it.each(["update-index", "commit-tree", "update-ref"])("recovers from %s failure with committed content and ordinary index untouched", async failingCommand => {
    const first = await repository.save("doc1", "original", null);
    await writeFile(path.join(directory, "index"), "untouched index sentinel");
    const internal = repository as unknown as { git(args: string[], input?: string, index?: string, allowFailure?: boolean): Promise<GitResult> };
    const original = internal.git.bind(repository);
    const spy = vi.spyOn(internal, "git").mockImplementation(async (...args) => {
      if (args[0][0] === failingCommand) throw new DetailsError("git_failed", "Injected failure", 503);
      return original(...args);
    });
    await expect(repository.save("doc1", "failed draft", first.commit)).rejects.toMatchObject({ code: "git_failed" });
    spy.mockRestore();
    expect(await repository.read("doc1")).toMatchObject({ source: "original", commit: first.commit });
    expect(await readFile(path.join(directory, "index"), "utf8")).toBe("untouched index sentinel");
    await expect(access(path.join(directory, "lifeor-details-writer.lock"))).rejects.toBeTruthy();
    expect(await repository.save("doc1", "retry", first.commit)).toMatchObject({ changed: true, source: "retry" });
  });
  it("reconciles a successful ref update whose command response was lost", async () => {
    const internal = repository as unknown as { git(args: string[], input?: string, index?: string, allowFailure?: boolean): Promise<GitResult> };
    const original = internal.git.bind(repository);
    vi.spyOn(internal, "git").mockImplementation(async (...args) => {
      const result = await original(...args);
      if (args[0][0] === "update-ref") throw new Error("Lost response");
      return result;
    });
    const saved = await repository.save("doc1", "durable", null);
    expect(saved.changed).toBe(true);
    expect(await repository.read("doc1")).toMatchObject({ source: "durable", commit: saved.commit });
  });
  it("rejects traversal, arbitrary revisions, oversized content, and a held writer lock", async () => {
    for (const id of ["../secret", "--help", "foo/bar", "x.md:HEAD", ""]) await expect(repository.read(id)).rejects.toMatchObject({ code: "invalid_id" });
    await expect(repository.read("doc1", "HEAD")).rejects.toMatchObject({ code: "invalid_revision" });
    await expect(repository.read("doc1", "a".repeat(40))).rejects.toMatchObject({ code: "revision_missing" });
    await expect(repository.save("doc1", "\uD800", null)).rejects.toMatchObject({ code: "invalid_encoding" });
    await expect(repository.save("doc1", "x".repeat(1024 * 1024 + 1), null)).rejects.toMatchObject({ code: "document_too_large" });
    await writeFile(path.join(directory, "lifeor-details-writer.lock"), "other writer");
    await expect(repository.save("doc1", "draft", null)).rejects.toMatchObject({ code: "writer_busy" });
    expect(await repository.read("doc1")).toMatchObject({ availability: "missing" });
  });
  it("rejects non-bare source checkouts and reports missing repositories as unreadable", async () => {
    const missing = new GitDetailsRepository({ directory: path.join(directory, "missing") });
    await expect(missing.read("doc1")).rejects.toMatchObject({ code: "repository_unreadable" });
    const checkout = path.join(directory, "checkout");
    await exec("git", ["init", checkout]);
    await expect(new GitDetailsRepository({ directory: checkout }).read("doc1")).rejects.toMatchObject({ code: "configuration" });
  });
});

function fixtureBackend(): DetailsBackend {
  const locator: DetailsLocator = { _id: "doc1", user_id: "owner", target: { kind: "entity", id: "entity1" }, repository_key: "local", path: documentPath("doc1") };
  return {
    currentUser: vi.fn(async () => ({ _id: "owner" })),
    get: vi.fn(async () => locator), forTarget: vi.fn(async () => locator),
    ensure: vi.fn(async () => locator), observe: vi.fn(async () => {}),
  };
}
describe("authenticated details service", () => {
  it("performs no Git operations for an unauthenticated request or foreign locator across every operation", async () => {
    const backend = fixtureBackend();
    const git = vi.spyOn(repository, "read");
    const save = vi.spyOn(repository, "save");
    const history = vi.spyOn(repository, "history");
    const diff = vi.spyOn(repository, "diff");
    const service = new DetailsService(backend, repository, "local");
    const calls = [() => service.read("doc1"), () => service.read("doc1", "a".repeat(40)), () => service.save("doc1", "text", null), () => service.history("doc1"), () => service.diff("doc1", "a".repeat(40), "b".repeat(40)), () => service.forTarget({ kind: "entity", id: "entity1" }), () => service.saveTarget({ kind: "entity", id: "entity1" }, "text", null)];
    vi.mocked(backend.currentUser).mockResolvedValue(null);
    for (const call of calls) await expect(call()).rejects.toMatchObject({ status: 401 });
    vi.mocked(backend.currentUser).mockResolvedValue({ _id: "intruder" });
    for (const call of calls) await expect(call()).rejects.toMatchObject({ status: 404 });
    for (const spy of [git, save, history, diff]) expect(spy).not.toHaveBeenCalled();
  });
  it("rejects a forged locator path or repository before Git access", async () => {
    const backend = fixtureBackend();
    const locator = (await backend.get("doc1"))!;
    const spy = vi.spyOn(repository, "read");
    for (const invalid of [{ ...locator, path: "details/another-owner.md" }, { ...locator, repository_key: "other" }]) {
      vi.mocked(backend.get).mockResolvedValue(invalid);
      await expect(new DetailsService(backend, repository, "local").read("doc1")).rejects.toMatchObject({ status: 503 });
    }
    expect(spy).not.toHaveBeenCalled();
  });
  it("keeps committed content recoverable after cache failure and rebuilds cache on read", async () => {
    const backend = fixtureBackend();
    const service = new DetailsService(backend, repository, "local");
    vi.mocked(backend.observe).mockRejectedValueOnce(new Error("database unavailable"));
    const saved = await service.saveTarget({ kind: "entity", id: "entity1" }, "durable source", null);
    expect(saved).toMatchObject({ source: "durable source", cache: "pending" });
    expect(saved.warning).toContain("Saved in Git");
    const read = await service.read("doc1");
    expect(read).toMatchObject({ commit: saved.commit, cache: "current", source: "durable source" });
    expect(backend.observe).toHaveBeenLastCalledWith("doc1", saved.commit, "available");
    expect(await repository.history("doc1")).toHaveLength(1);
    await service.read("doc1", saved.commit!);
    expect(backend.observe).toHaveBeenCalledTimes(2); // Pinned reads never overwrite current cache.
  });
  it("appends against a pinned base, preserves long source and is safe to retry", async () => {
    const service = new DetailsService(fixtureBackend(), repository, "local");
    const target = {kind: "entity" as const, id: "entity1"};
    const source = "# Existing\n\n" + "Preserve this imported text. ".repeat(2000);
    const first = await service.saveTarget(target, source, null);
    const added = await service.appendTarget(target, "One indoor cat is allowed.", first.commit);
    expect((await service.forTarget(target)).source).toBe(source+"\n\nOne indoor cat is allowed.\n");
    expect((await service.appendTarget(target, "One indoor cat is allowed.", first.commit)).changed).toBe(false);
    await expect(service.appendTarget(target, "Different competing edit", first.commit)).rejects.toMatchObject({code:"stale_revision"});
    expect((await service.forTarget(target)).commit).toBe(added.commit);
  });
  it("allocates only when saving and never reports an unsuccessful commit as saved", async () => {
    const backend = fixtureBackend();
    vi.mocked(backend.forTarget).mockResolvedValue(null);
    const service = new DetailsService(backend, repository, "local");
    expect(await service.forTarget({ kind: "entity", id: "entity1" })).toMatchObject({ documentId: null, availability: "missing" });
    expect(backend.ensure).not.toHaveBeenCalled();
    vi.spyOn(repository, "save").mockRejectedValue(new DetailsError("git_failed", "Failed", 503));
    await expect(service.saveTarget({ kind: "entity", id: "entity1" }, "draft", null)).rejects.toMatchObject({ code: "git_failed" });
    expect(backend.observe).not.toHaveBeenCalled();
    expect(backend.ensure).toHaveBeenCalledWith({ kind: "entity", id: "entity1" }, "local");
  });
});
