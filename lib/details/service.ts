import { DetailsError, documentPath, type DetailsLocator, type DetailsTarget, type DocumentRead } from "./types";
import { parseDetails } from "./frontmatter";
import type { GitDetailsRepository } from "./git";

export interface DetailsBackend {
  currentUser(): Promise<{ _id: string } | null>;
  get(id: string): Promise<DetailsLocator | null>;
  forTarget(target: DetailsTarget): Promise<DetailsLocator | null>;
  ensure(target: DetailsTarget, repositoryKey: string): Promise<DetailsLocator>;
  observe(id: string, commit: string | null, availability: "available" | "missing" | "unreadable"): Promise<void>;
}
/** The only application entry point into Git: no Git call precedes owner validation. */
export class DetailsService {
  constructor(private backend: DetailsBackend, private repository: GitDetailsRepository, private repositoryKey: string) {}
  private async user() {
    const user = await this.backend.currentUser();
    if (!user) throw new DetailsError("unauthenticated", "Sign in to access details.", 401);
    return user;
  }
  private validate(locator: DetailsLocator | null, owner: string) {
    if (!locator || locator.user_id !== owner) throw new DetailsError("not_found", "Details document not found.", 404);
    if (locator.path !== documentPath(locator._id) || locator.repository_key !== this.repositoryKey) throw new DetailsError("configuration", "The document locator does not match the configured content repository.", 503);
    return locator;
  }
  private async locator(id: string) {
    const user = await this.user();
    documentPath(id);
    return this.validate(await this.backend.get(id), user._id);
  }
  private async observation(id: string, document: DocumentRead) {
    try { await this.backend.observe(id, document.commit, document.availability); return "current" as const; }
    catch { return "pending" as const; }
  }
  private async readLocator(locator: DetailsLocator, commit?: string) {
    let document: DocumentRead;
    try { document = await this.repository.read(locator._id, commit); }
    catch (error) {
      if (!commit) await this.backend.observe(locator._id, null, "unreadable").catch(() => {});
      throw error;
    }
    const cache = commit ? "pinned" as const : await this.observation(locator._id, document);
    return { documentId: locator._id, repositoryKey: this.repositoryKey, path: locator.path, ...document, parsed: document.source === null ? null : parseDetails(document.source), cache };
  }
  async read(id: string, commit?: string) { return this.readLocator(await this.locator(id), commit); }
  async forTarget(target: DetailsTarget) {
    const user = await this.user();
    // Backend forTarget validates the target even when it has no document.
    const locator = await this.backend.forTarget(target);
    if (!locator) return { documentId: null, availability: "missing" as const, source: null, commit: null, parsed: null, cache: "current" as const };
    return this.readLocator(this.validate(locator, user._id));
  }
  async saveTarget(target: DetailsTarget, source: string, expectedCommit: string | null) {
    const user = await this.user();
    const locator = this.validate(await this.backend.ensure(target, this.repositoryKey), user._id);
    return this.saveLocator(locator, source, expectedCommit);
  }
  private async saveLocator(locator: DetailsLocator, source: string, expectedCommit: string | null) {
    if (expectedCommit === null) {
      const current = await this.repository.read(locator._id);
      if (current.availability === "missing") expectedCommit = current.commit;
    }
    const document = await this.repository.save(locator._id, source, expectedCommit);
    const cache = await this.observation(locator._id, document);
    return { documentId: locator._id, ...document, parsed: parseDetails(source), cache, warning: cache === "pending" ? "Saved in Git. The database cache update failed and will retry when you reopen details." : null };
  }
  async save(id: string, source: string, expectedCommit: string | null) { return this.saveLocator(await this.locator(id), source, expectedCommit); }
  async history(id: string) { const locator = await this.locator(id); return { revisions: await this.repository.history(locator._id) }; }
  async diff(id: string, from: string, to: string) { const locator = await this.locator(id); return { from, to, diff: await this.repository.diff(locator._id, from, to) }; }
}
