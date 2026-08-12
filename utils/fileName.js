// Frappe stores File.file_name / file_url in Data fields capped at 140 characters
// and counts the percent-encoded form, so a non-ASCII name explodes: every Arabic
// letter costs 6 characters encoded, and iOS hands us names that are already
// percent-encoded. A 40-character Arabic name therefore arrives as ~250
// characters and the server rejects the upload with "will get truncated, as max
// characters allowed is 140".
//
// The budget below leaves room for the "/private/files/" prefix Frappe prepends
// to file_url and for the "-1", "-2" suffixes it adds on duplicate names.
const MAX_ENCODED_LENGTH = 100;

// Bidi marks and isolates (LRM, RLM, FSI/PDI, BOM) ride along invisibly in names
// copied out of Arabic file managers — they cost length without showing anything.
const INVISIBLE_CHARS = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;

// An extension longer than this is almost certainly not an extension, just a dot
// in the middle of the name.
const MAX_EXTENSION_LENGTH = 12;

const decodeIfEncoded = (value) => {
  if (!/%[0-9A-Fa-f]{2}/.test(value)) return value;
  try {
    return decodeURIComponent(value);
  } catch (error) {
    return value;
  }
};

const encodedLength = (value) => encodeURIComponent(value).length;

const splitExtension = (name) => {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return { stem: name, extension: "" };

  const extension = name.slice(dot);
  if (extension.length > MAX_EXTENSION_LENGTH || /\s/.test(extension)) {
    return { stem: name, extension: "" };
  }

  return { stem: name.slice(0, dot), extension };
};

/**
 * Make a picked file's name safe for Frappe: decode it, drop invisible and path
 * characters, and truncate it — by encoded length, keeping the extension — so the
 * server never has to.
 */
export const sanitizeFileName = (rawName, fallbackName = "attachment") => {
  const cleaned = decodeIfEncoded(String(rawName ?? "").trim())
    .replace(INVISIBLE_CHARS, "")
    .replace(/[/\\]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return fallbackName;

  let { stem, extension } = splitExtension(cleaned);
  if (!stem.trim()) stem = fallbackName;

  let budget = MAX_ENCODED_LENGTH - encodedLength(extension);
  if (budget < 8) {
    extension = "";
    budget = MAX_ENCODED_LENGTH;
  }

  // Walk by code point so a truncation never splits a surrogate pair.
  let truncated = "";
  let length = 0;
  for (const char of Array.from(stem)) {
    const charLength = encodedLength(char);
    if (length + charLength > budget) break;
    truncated += char;
    length += charLength;
  }

  truncated = truncated.trim();
  if (!truncated) truncated = fallbackName;

  return `${truncated}${extension}`;
};

/**
 * Normalize a picked attachment before it goes into a multipart body: sanitized
 * name, and a mime type that tolerates both the `type` and `mimeType` keys the
 * image and document pickers return.
 */
export const sanitizeAttachment = (file, fallbackName = "attachment") => {
  if (!file) return file;

  return {
    ...file,
    name: sanitizeFileName(file.name, fallbackName),
    type: file.type || file.mimeType || "application/octet-stream",
  };
};

export default { sanitizeFileName, sanitizeAttachment };
