/**
 * M23 §11 (artifact safety): validates an artifact `locator` string without
 * ever opening the artifact, fetching a URL, or validating remote
 * existence. Purely structural. Allowed: a repository-relative path, an
 * opaque provider reference (a bare identifier with no URL scheme), or a
 * clean `https://` URL with no userinfo/query/fragment. Rejected: inline
 * data/base64 (`data:` URLs), any non-https scheme (including `file:`,
 * `javascript:`, `ftp:` -- anything with a `scheme:` prefix other than
 * `https:` is treated as a URL and rejected outright, since a colon-
 * prefixed opaque reference is indistinguishable from a dangerous scheme),
 * URL userinfo/query/fragment (query strings cover signed/tokenized
 * URLs), out-of-root absolute paths, UNC/device paths, and `..` traversal.
 */
export type ArtifactLocatorValidation =
  | { ok: true; normalized: string }
  | { ok: false; reason: string };

const SCHEME_PATTERN = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;
const WINDOWS_ABSOLUTE_PATTERN = /^[a-zA-Z]:[\\/]/;
const DEVICE_PATH_PATTERN = /^\\\\[.?]\\/;

export function validateArtifactLocator(locator: string): ArtifactLocatorValidation {
  const trimmed = locator.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: "locator must not be empty" };
  }
  if (trimmed.includes("\0")) {
    return { ok: false, reason: "locator contains a null byte" };
  }

  const schemeMatch = trimmed.match(SCHEME_PATTERN);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme !== "https") {
      return {
        ok: false,
        reason: `scheme '${scheme}' is not permitted -- only https URLs and repository-relative/opaque references are allowed`,
      };
    }
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return { ok: false, reason: "malformed https URL" };
    }
    if (url.username || url.password) {
      return { ok: false, reason: "URL userinfo is not permitted" };
    }
    if (url.search) {
      return { ok: false, reason: "URL query strings are not permitted (covers signed/tokenized URLs)" };
    }
    if (url.hash) {
      return { ok: false, reason: "URL fragments are not permitted" };
    }
    return { ok: true, normalized: trimmed };
  }

  if (DEVICE_PATH_PATTERN.test(trimmed) || trimmed.startsWith("/dev/")) {
    return { ok: false, reason: "device paths are not permitted" };
  }
  if (trimmed.startsWith("\\\\")) {
    return { ok: false, reason: "UNC paths are not permitted" };
  }
  if (WINDOWS_ABSOLUTE_PATTERN.test(trimmed) || trimmed.startsWith("/")) {
    return { ok: false, reason: "out-of-root absolute paths are not permitted -- use a repository-relative path" };
  }

  const segments = trimmed.split(/[\\/]/);
  if (segments.some((segment) => segment === "..")) {
    return { ok: false, reason: "path traversal ('..') is not permitted" };
  }

  return { ok: true, normalized: trimmed.replace(/\\/g, "/") };
}
