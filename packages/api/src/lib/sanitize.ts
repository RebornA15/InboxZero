/**
 * Sanitizes HTML email content using DOMPurify in a jsdom environment.
 *
 * Security properties:
 *   - Strips all <script> tags and event handlers.
 *   - Removes src/href attributes pointing to javascript: URIs.
 *   - Optionally strips remote image sources (default: true).
 *   - Output is safe for rendering inside a sandboxed iframe.
 *
 * NEVER inject this output directly into the main application DOM.
 * Always render inside a sandboxed iframe with a restrictive CSP.
 */

import { JSDOM } from "jsdom";
import DOMPurify from "dompurify";

let purify: ReturnType<typeof DOMPurify> | null = null;

function getPurify(): ReturnType<typeof DOMPurify> {
  if (!purify) {
    const { window } = new JSDOM("");
    purify = DOMPurify(window as unknown as Parameters<typeof DOMPurify>[0]);
  }
  return purify;
}

export interface SanitizeOptions {
  /** Strip remote images to prevent tracking (default: true). */
  blockRemoteImages?: boolean;
}

export function sanitizeHtml(
  html: string,
  options: SanitizeOptions = {}
): string {
  const { blockRemoteImages = true } = options;
  const p = getPurify();

  let sanitized = p.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["script", "style", "form", "input", "button", "link", "meta"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover"],
    FORCE_BODY: true,
    RETURN_DOM: false,
    RETURN_DOM_FRAGMENT: false,
  });

  if (blockRemoteImages) {
    // Replace src attributes on <img> tags with a placeholder
    sanitized = sanitized.replace(
      /<img([^>]*)\ssrc=["']https?:\/\/[^"']*["']([^>]*)>/gi,
      '<img$1 data-src-blocked="true" alt="[remote image blocked]"$2>'
    );
  }

  return sanitized;
}

/**
 * Extracts a plain-text preview from either a text body or stripped HTML.
 * Truncates to `maxLength` characters.
 */
export function extractPreview(
  textBody: string | null | undefined,
  htmlBody: string | null | undefined,
  maxLength = 200
): string {
  if (textBody) {
    return textBody.slice(0, maxLength).replace(/\s+/g, " ").trim();
  }
  if (htmlBody) {
    const { window } = new JSDOM(htmlBody);
    const text = window.document.body.textContent ?? "";
    return text.slice(0, maxLength).replace(/\s+/g, " ").trim();
  }
  return "";
}
