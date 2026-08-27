import { sanitizeFileName, sanitizeAttachment } from "../utils/fileName";

// Frappe measures File.file_name in its percent-encoded form against a 140-char
// cap; we keep a margin under that for the /private/files/ prefix.
const encodedLength = (name) => encodeURIComponent(name).length;

describe("sanitizeFileName", () => {
  it("leaves an ordinary name alone", () => {
    expect(sanitizeFileName("payslip.pdf")).toBe("payslip.pdf");
  });

  it("decodes a percent-encoded name instead of counting the escapes", () => {
    const encoded = "%D8%B1%D8%B3%D9%88%D9%85.pdf";

    expect(sanitizeFileName(encoded)).toBe("رسوم.pdf");
  });

  it("keeps the encoded length of the rejected upload under the Frappe cap", () => {
    // The exact name the server rejected: bidi marks + Arabic, percent-encoded.
    const rejected =
      "%E2%80%8E%E2%81%A8%D8%B1%D9%83%D9%88%D8%B3%D8%AA%20%D8%B1%D8%B3%D9%88%D9%85%20%D8%AA%D8%B5%D8%A7%D8%B1%D9%8A%D8%AD%20%D8%AC%D8%AF%D9%8A%D8%AF%20%D8%B9%D8%AF%D8%AF%204%20%D9%83%D8%B4%D9%88%D9%81%E2%81%A9.pdf";

    const result = sanitizeFileName(rejected);

    expect(encodedLength(rejected)).toBeGreaterThan(140);
    expect(encodedLength(result)).toBeLessThanOrEqual(140);
    expect(result).toMatch(/\.pdf$/);
    // Invisible bidi isolates are gone.
    expect(result).not.toMatch(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/);
  });

  it("truncates a long ASCII name but keeps the extension", () => {
    const long = `${"a".repeat(300)}.png`;

    const result = sanitizeFileName(long);

    expect(result.endsWith(".png")).toBe(true);
    expect(encodedLength(result)).toBeLessThanOrEqual(140);
  });

  it("does not split a surrogate pair when truncating", () => {
    const result = sanitizeFileName(`${"😀".repeat(60)}.jpg`);

    expect(result).not.toMatch(/[\uD800-\uDFFF]$/);
    expect(Array.from(result).every((char) => char.length <= 2)).toBe(true);
  });

  it("strips path separators", () => {
    expect(sanitizeFileName("../../etc/passwd.txt")).toBe("..-..-etc-passwd.txt");
  });

  it("falls back when the name is empty or missing", () => {
    expect(sanitizeFileName("", "receipt")).toBe("receipt");
    expect(sanitizeFileName(null, "receipt")).toBe("receipt");
    expect(sanitizeFileName(undefined, "receipt")).toBe("receipt");
  });

  it("treats a long trailing segment as part of the name, not an extension", () => {
    expect(sanitizeFileName("report.2026.final-version-notes")).toBe(
      "report.2026.final-version-notes",
    );
  });
});

describe("sanitizeAttachment", () => {
  it("accepts either the picker's type or mimeType key", () => {
    expect(sanitizeAttachment({ uri: "file:///a", name: "a.pdf", mimeType: "application/pdf" })).toEqual(
      { uri: "file:///a", name: "a.pdf", mimeType: "application/pdf", type: "application/pdf" },
    );

    expect(sanitizeAttachment({ uri: "file:///a", name: "a.jpg", type: "image/jpeg" }).type).toBe(
      "image/jpeg",
    );
  });

  it("passes through a missing file", () => {
    expect(sanitizeAttachment(null)).toBeNull();
    expect(sanitizeAttachment(undefined)).toBeUndefined();
  });
});

/* =====================================================================
 * The picker is where sanitization has to happen: every attachment in the
 * app — loan, leave, expense, complaint, attendance request — comes through
 * useAttachmentPicker, so sanitizing there covers all of them at once.
 * ================================================================== */

jest.mock("expo-image-picker", () => ({
  requestCameraPermissionsAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));

jest.mock("expo-document-picker", () => ({
  getDocumentAsync: jest.fn(),
}));

// eslint-disable-next-line import/first
import * as ImagePicker from "expo-image-picker";
// eslint-disable-next-line import/first
import * as DocumentPicker from "expo-document-picker";
// eslint-disable-next-line import/first
import { renderHook } from "@testing-library/react-native";
// eslint-disable-next-line import/first
import { useAttachmentPicker } from "../hooks/useAttachmentPicker";

describe("useAttachmentPicker sanitizes what it hands back", () => {
  // The exact name Frappe rejected: bidi isolates + percent-encoded Arabic.
  const HOSTILE =
    "%E2%80%8E%E2%81%A8%D8%B1%D9%83%D9%88%D8%B3%D8%AA%20%D8%B1%D8%B3%D9%88%D9%85%20%D8%AA%D8%B5%D8%A7%D8%B1%D9%8A%D8%AD%20%D8%AC%D8%AF%D9%8A%D8%AF%20%D8%B9%D8%AF%D8%AF%204%20%D9%83%D8%B4%D9%88%D9%81%E2%81%A9.pdf";

  it("truncates a hostile document name under the Frappe cap", async () => {
    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [
        { uri: "file:///tmp/x.pdf", name: HOSTILE, mimeType: "application/pdf" },
      ],
    });

    const { result } = renderHook(() => useAttachmentPicker());
    const file = await result.current.pickDocument();

    expect(encodedLength(file.name)).toBeLessThanOrEqual(140);
    expect(file.name).toMatch(/\.pdf$/);
    expect(file.type).toBe("application/pdf");
  });

  it("sanitizes a camera capture's name too", async () => {
    ImagePicker.requestCameraPermissionsAsync.mockResolvedValue({
      status: "granted",
    });
    ImagePicker.launchCameraAsync.mockResolvedValue({
      canceled: false,
      assets: [
        { uri: "file:///tmp/p.jpg", fileName: HOSTILE, mimeType: "image/jpeg" },
      ],
    });

    const { result } = renderHook(() => useAttachmentPicker());
    const file = await result.current.pickFromCamera();

    expect(encodedLength(file.name)).toBeLessThanOrEqual(140);
  });

  it("leaves an ordinary name untouched, so nothing else changes", async () => {
    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [
        {
          uri: "file:///tmp/payslip.pdf",
          name: "payslip.pdf",
          mimeType: "application/pdf",
        },
      ],
    });

    const { result } = renderHook(() => useAttachmentPicker());
    const file = await result.current.pickDocument();

    expect(file.name).toBe("payslip.pdf");
  });
});
