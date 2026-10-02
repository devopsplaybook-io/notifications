import { marked } from "marked";
import DOMPurify from "dompurify";

const MAX_CACHE_ENTRIES = 200;

marked.setOptions({
  breaks: true,
  gfm: true,
});

interface RenderCacheEntry {
  source: string;
  html: string;
}

/**
 * Memoizes sanitized markdown per notification id so re-renders do not re-run
 * marked + DOMPurify. Entries are invalidated when the source text changes.
 */
export class RenderCache {
  private static entries = new Map<string, RenderCacheEntry>();

  public static renderMarkdown(
    id: string,
    text: string | null | undefined,
  ): string {
    if (!text) {
      return "";
    }
    const cached = RenderCache.entries.get(id);
    if (cached && cached.source === text) {
      return cached.html;
    }
    const html = DOMPurify.sanitize(marked.parse(text) as string);
    if (cached) {
      RenderCache.entries.delete(id);
    } else if (RenderCache.entries.size >= MAX_CACHE_ENTRIES) {
      const oldest = RenderCache.entries.keys().next().value;
      if (oldest !== undefined) {
        RenderCache.entries.delete(oldest);
      }
    }
    RenderCache.entries.set(id, { source: text, html });
    return html;
  }

  public static clear(): void {
    RenderCache.entries.clear();
  }
}
