import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  recordEvent,
  getEntries,
  clearEntries,
  loadPersistedEntries,
  formatReport,
  maskSecret,
  installConsoleCapture,
  uninstallConsoleCapture,
} from "../utils/diagnosticLog";

describe("diagnosticLog", () => {
  beforeEach(async () => {
    await clearEntries();
    jest.clearAllMocks();
  });

  afterEach(() => {
    uninstallConsoleCapture();
  });

  it("records structured events with a tag and serialized data", () => {
    recordEvent("login/attempt", { hasApiKey: true, baseUrl: "https://x.io" });

    const entries = getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe("event");
    expect(entries[0].tag).toBe("login/attempt");
    expect(entries[0].msg).toContain("hasApiKey");
    expect(entries[0].msg).toContain("https://x.io");
  });

  it("masks secrets, keeping only the head and tail", () => {
    expect(maskSecret("supersecrettoken12345")).toBe("supers…2345");
    expect(maskSecret("short")).toBe("sho…rt");
    expect(maskSecret(null)).toBeNull();
  });

  it("caps the buffer at the maximum number of entries", () => {
    for (let i = 0; i < 450; i += 1) {
      recordEvent("loop", i);
    }
    const entries = getEntries();
    expect(entries.length).toBe(400);
    // Oldest entries are dropped, newest retained.
    expect(entries[entries.length - 1].msg).toBe("449");
  });

  it("handles circular references without throwing", () => {
    const circular = { name: "node" };
    circular.self = circular;
    expect(() => recordEvent("circular", circular)).not.toThrow();
    expect(getEntries()[0].msg).toContain("[Circular]");
  });

  it("captures console.log/warn/error after install and still calls through", () => {
    const spy = jest.spyOn(console, "log").mockImplementation(() => {});
    installConsoleCapture();

    console.log("hello", { a: 1 });

    const entries = getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe("log");
    expect(entries[0].msg).toContain("hello");
    expect(entries[0].msg).toContain('"a": 1');
    // Original console.log is still invoked.
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("builds a readable report with the header and entries", () => {
    recordEvent("login/error", { status: 401 });
    const report = formatReport({ Build: "2026-06-28 D", "Base URL": "https://x.io" });

    expect(report).toContain("Claudion Check-in Diagnostics");
    expect(report).toContain("Build: 2026-06-28 D");
    expect(report).toContain("Base URL: https://x.io");
    expect(report).toContain("Entries: 1");
    expect(report).toContain("login/error");
  });

  it("merges persisted entries from a previous session ahead of current ones", async () => {
    const previous = [{ t: 1, level: "event", tag: "old", msg: "from last run" }];
    AsyncStorage.getItem.mockResolvedValueOnce(JSON.stringify(previous));

    recordEvent("new", "current run");
    await loadPersistedEntries();

    const entries = getEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0].tag).toBe("old");
    expect(entries[1].tag).toBe("new");
  });
});
