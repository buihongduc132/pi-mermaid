/**
 * Tests for pi-mermaid/index.ts
 *
 * Covers pure functions, cache logic, mermaid parser detection,
 * block processing, and the DOMPurify probe fix.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { __test } from "../index.ts";

const {
	isDomPurifyError,
	normalizeMermaidSource,
	formatIssueLines,
	buildContextContent,
	extractText,
	extractMermaidBlocks,
	getMermaidTypeToken,
	getSupportedMermaidType,
	hashMermaid,
	countAsciiLines,
	maxAsciiLineWidth,
	selectAsciiVariant,
	splitIssuesFromContent,
	getLastAssistantText,
	getAsciiCacheKey,
	ASCII_PRESETS,
	MAX_BLOCKS,
	COLLAPSED_LINES,
} = __test;

// ── Pure Function Tests ────────────────────────────────────────────────────

describe("isDomPurifyError", () => {
	it("should detect DOMPurify.addHook errors", () => {
		expect(isDomPurifyError("DOMPurify.addHook is not a function")).toBe(true);
	});

	it("should detect generic DOMPurify errors", () => {
		expect(isDomPurifyError("DOMPurify is not supported")).toBe(true);
	});

	it("should return false for unrelated errors", () => {
		expect(isDomPurifyError("Syntax error in diagram")).toBe(false);
	});

	it("should return false for empty string", () => {
		expect(isDomPurifyError("")).toBe(false);
	});
});

describe("normalizeMermaidSource", () => {
	it("should trim trailing whitespace", () => {
		expect(normalizeMermaidSource("graph TD   ")).toBe("graph TD");
	});

	it("should handle empty string", () => {
		expect(normalizeMermaidSource("")).toBe("");
	});

	it("should not modify already clean source", () => {
		expect(normalizeMermaidSource("graph TD")).toBe("graph TD");
	});

	it("should trim trailing spaces from multiline", () => {
		expect(normalizeMermaidSource("graph TD   \n  A-->B  ")).toBe("graph TD   \n  A-->B");
	});
});

describe("extractMermaidBlocks", () => {
	it("should extract single mermaid block", () => {
		const text = "Some text\n```mermaid\ngraph TD\n  A-->B\n```\nMore text";
		expect(extractMermaidBlocks(text)).toEqual(["graph TD\n  A-->B"]);
	});

	it("should extract multiple mermaid blocks", () => {
		const text =
			"```mermaid\ngraph TD\n  A-->B\n```\nText\n```mermaid\nsequenceDiagram\n  A->>B\n```";
		expect(extractMermaidBlocks(text)).toHaveLength(2);
	});

	it("should respect maxBlocks", () => {
		const text = "```mermaid\nA\n```\n```mermaid\nB\n```\n```mermaid\nC\n```";
		expect(extractMermaidBlocks(text, 2)).toHaveLength(2);
	});

	it("should return empty array for no blocks", () => {
		expect(extractMermaidBlocks("Just regular text")).toHaveLength(0);
	});

	it("should skip empty blocks", () => {
		expect(extractMermaidBlocks("```mermaid\n\n```")).toHaveLength(0);
	});
});

describe("getMermaidTypeToken", () => {
	it("should extract graph token", () => {
		expect(getMermaidTypeToken("graph TD\n  A-->B")).toBe("graph");
	});

	it("should extract flowchart token", () => {
		expect(getMermaidTypeToken("flowchart LR\n  A --> B")).toBe("flowchart");
	});

	it("should extract sequenceDiagram token", () => {
		expect(getMermaidTypeToken("sequenceDiagram\n  A->>B")).toBe("sequenceDiagram");
	});

	it("should extract classDiagram token", () => {
		expect(getMermaidTypeToken("classDiagram\n  class A")).toBe("classDiagram");
	});

	it("should skip comment lines", () => {
		expect(getMermaidTypeToken("%% comment\ngraph TD\n  A-->B")).toBe("graph");
	});

	it("should skip empty lines", () => {
		expect(getMermaidTypeToken("\n\ngraph TD\n  A-->B")).toBe("graph");
	});

	it("should return null for empty block", () => {
		expect(getMermaidTypeToken("")).toBeNull();
	});

	it("should return null for comment-only block", () => {
		expect(getMermaidTypeToken("%% only comments")).toBeNull();
	});

	it("should return null for whitespace-only block", () => {
		expect(getMermaidTypeToken("   \n   ")).toBeNull();
	});
});

describe("getSupportedMermaidType", () => {
	it("should map graph to flowchart", () => {
		expect(getSupportedMermaidType("graph TD\n  A-->B")).toEqual({
			token: "graph",
			normalized: "flowchart",
		});
	});

	it("should map flowchart to flowchart", () => {
		expect(getSupportedMermaidType("flowchart LR").normalized).toBe("flowchart");
	});

	it("should map sequenceDiagram to sequence", () => {
		expect(getSupportedMermaidType("sequenceDiagram").normalized).toBe("sequence");
	});

	it("should map classDiagram to class", () => {
		expect(getSupportedMermaidType("classDiagram").normalized).toBe("class");
	});

	it("should map erDiagram to er", () => {
		expect(getSupportedMermaidType("erDiagram").normalized).toBe("er");
	});

	it("should map stateDiagram to state", () => {
		expect(getSupportedMermaidType("stateDiagram").normalized).toBe("state");
	});

	it("should map stateDiagram-v2 to state", () => {
		expect(getSupportedMermaidType("stateDiagram-v2").normalized).toBe("state");
	});

	it("should return null for unsupported type", () => {
		const result = getSupportedMermaidType("gantt\n  title T");
		expect(result.normalized).toBeNull();
		expect(result.token).toBe("gantt");
	});

	it("should return null token for empty block", () => {
		const result = getSupportedMermaidType("");
		expect(result.token).toBeNull();
		expect(result.normalized).toBeNull();
	});
});

describe("hashMermaid", () => {
	it("should return 8-char hex string", () => {
		const hash = hashMermaid("graph TD\n  A-->B");
		expect(hash).toHaveLength(8);
		expect(hash).toMatch(/^[0-9a-f]{8}$/);
	});

	it("should return same hash for same input", () => {
		expect(hashMermaid("graph TD")).toBe(hashMermaid("graph TD"));
	});

	it("should return different hash for different input", () => {
		expect(hashMermaid("graph TD")).not.toBe(hashMermaid("graph LR"));
	});
});

describe("formatIssueLines", () => {
	it("should format single error issue", () => {
		expect(
			formatIssueLines([{ severity: "error", message: "bad syntax" }], "abc123"),
		).toBe("[mermaid:error][hash:abc123] bad syntax");
	});

	it("should format single warning issue", () => {
		expect(
			formatIssueLines([{ severity: "warning", message: "odd" }], "abc"),
		).toBe("[mermaid:warning][hash:abc] odd");
	});

	it("should format multiple issues on separate lines", () => {
		const result = formatIssueLines(
			[
				{ severity: "error", message: "err1" },
				{ severity: "warning", message: "warn1" },
			],
			"abc",
		);
		expect(result.split("\n")).toHaveLength(2);
	});

	it("should return empty for no issues", () => {
		expect(formatIssueLines([], "abc")).toBe("");
	});
});

describe("extractText", () => {
	it("should return string as-is", () => {
		expect(extractText("hello")).toBe("hello");
	});

	it("should extract text from content array", () => {
		expect(
			extractText([
				{ type: "text", text: "hello" },
				{ type: "text", text: "world" },
			]),
		).toBe("hello\nworld");
	});

	it("should skip non-text parts", () => {
		expect(
			extractText([
				{ type: "image", url: "x" },
				{ type: "text", text: "hello" },
			]),
		).toBe("hello");
	});

	it("should skip empty text parts", () => {
		expect(
			extractText([
				{ type: "text", text: "" },
				{ type: "text", text: "   " },
				{ type: "text", text: "hello" },
			]),
		).toBe("hello");
	});

	it("should return empty for null", () => {
		expect(extractText(null)).toBe("");
	});

	it("should return empty for number", () => {
		expect(extractText(42)).toBe("");
	});

	it("should return empty for undefined", () => {
		expect(extractText(undefined)).toBe("");
	});
});

describe("buildContextContent", () => {
	it("should build context with source and no issues", () => {
		const result = buildContextContent("graph TD\n  A-->B", "abc", [], true);
		expect(result).toContain("```mermaid");
		expect(result).toContain("%% mermaid-hash: abc");
	});

	it("should build context with issues and source", () => {
		const result = buildContextContent(
			"graph TD",
			"abc",
			[{ severity: "error", message: "bad" }],
			true,
		);
		expect(result).toContain("[mermaid:error]");
		expect(result).toContain("```mermaid");
	});

	it("should return only issues when includeSource is false", () => {
		expect(
			buildContextContent(
				"graph TD",
				"abc",
				[{ severity: "error", message: "bad" }],
				false,
			),
		).toBe("[mermaid:error][hash:abc] bad");
	});

	it("should return empty for no issues and no source", () => {
		expect(buildContextContent("graph TD", "abc", [], false)).toBe("");
	});
});

describe("countAsciiLines / maxAsciiLineWidth", () => {
	it("countAsciiLines should count lines", () => {
		expect(countAsciiLines("a\nb\nc")).toBe(3);
	});

	it("countAsciiLines should return 0 for empty string", () => {
		expect(countAsciiLines("")).toBe(0);
	});

	it("countAsciiLines should return 1 for single line", () => {
		expect(countAsciiLines("hello")).toBe(1);
	});

	it("maxAsciiLineWidth should find widest line", () => {
		expect(maxAsciiLineWidth("a\nbbb\nc")).toBe(3);
	});

	it("maxAsciiLineWidth should return 0 for empty string", () => {
		expect(maxAsciiLineWidth("")).toBe(0);
	});

	it("maxAsciiLineWidth should handle CRLF", () => {
		expect(maxAsciiLineWidth("a\r\nbbb\r\nc")).toBe(3);
	});
});

describe("selectAsciiVariant", () => {
	const variants = [
		{ presetKey: "default", ascii: "wide", lineCount: 1, maxLineWidth: 80 },
		{ presetKey: "compact", ascii: "mid", lineCount: 1, maxLineWidth: 40 },
		{ presetKey: "tight", ascii: "narrow", lineCount: 1, maxLineWidth: 20 },
	];

	it("should select first variant that fits", () => {
		const result = selectAsciiVariant(50, variants, "fallback", 1);
		expect(result.presetKey).toBe("compact");
		expect(result.clipped).toBe(false);
	});

	it("should select tightest variant when nothing fits", () => {
		const result = selectAsciiVariant(10, variants, "fallback", 1);
		expect(result.presetKey).toBe("tight");
		expect(result.clipped).toBe(true);
	});

	it("should select first variant when all fit", () => {
		const result = selectAsciiVariant(100, variants, "fallback", 1);
		expect(result.presetKey).toBe("default");
		expect(result.clipped).toBe(false);
	});

	it("should use fallback when no variants", () => {
		const result = selectAsciiVariant(100, undefined, "fallback ascii", 2);
		expect(result.ascii).toBe("fallback ascii");
		expect(result.lineCount).toBe(2);
		expect(result.clipped).toBe(false);
	});

	it("should mark fallback as clipped when wider than width", () => {
		const result = selectAsciiVariant(5, undefined, "a very long fallback line", 1);
		expect(result.clipped).toBe(true);
	});

	it("should handle empty variants array", () => {
		const result = selectAsciiVariant(100, [], "fallback", 1);
		expect(result.ascii).toBe("fallback");
	});
});

describe("splitIssuesFromContent", () => {
	it("should split error issues from ascii content", () => {
		const text = "[mermaid:error][hash:abc123] Parse error: bad syntax\n\nASCII art here";
		const result = splitIssuesFromContent(text);
		expect(result.issues).toHaveLength(1);
		expect(result.issues[0]!.severity).toBe("error");
		expect(result.issues[0]!.message).toBe("Parse error: bad syntax");
		expect(result.ascii).toBe("ASCII art here");
	});

	it("should handle warning severity", () => {
		const text = "[mermaid:warning][hash:def] Something odd\n\nASCII here";
		const result = splitIssuesFromContent(text);
		expect(result.issues[0]!.severity).toBe("warning");
	});

	it("should handle multiline issue messages", () => {
		const text = "[mermaid:error][hash:abc] First line\nSecond line\n\nASCII";
		const result = splitIssuesFromContent(text);
		expect(result.issues[0]!.message).toBe("First line\nSecond line");
		expect(result.ascii).toBe("ASCII");
	});

	it("should handle multiple issues", () => {
		const text = "[mermaid:error][hash:abc] err1\n[mermaid:warning][hash:def] warn1\n\nASCII";
		const result = splitIssuesFromContent(text);
		expect(result.issues).toHaveLength(2);
	});

	it("should return ascii as-is when no issues", () => {
		const text = "Just ASCII art\nno issues";
		const result = splitIssuesFromContent(text);
		expect(result.issues).toHaveLength(0);
		expect(result.ascii).toBe(text);
	});

	it("should handle empty string", () => {
		const result = splitIssuesFromContent("");
		expect(result.ascii).toBe("");
		expect(result.issues).toHaveLength(0);
	});

	it("should handle issues without hash", () => {
		const text = "[mermaid:error] no hash error\n\nASCII";
		// Regex requires [hash:...] or nothing after severity — this should not match
		const result = splitIssuesFromContent(text);
		// Without hash, the regex doesn't match, so it's all ascii
		expect(result.ascii).toBeTruthy();
	});
});

describe("getLastAssistantText", () => {
	it("should return last assistant text", () => {
		const entries = [
			{ type: "message", message: { role: "user", content: [{ type: "text", text: "hi" }] } },
			{ type: "message", message: { role: "assistant", content: [{ type: "text", text: "hello" }] } },
		];
		expect(getLastAssistantText(entries as any)).toBe("hello");
	});

	it("should return null for no assistant messages", () => {
		expect(
			getLastAssistantText([
				{ type: "message", message: { role: "user", content: [{ type: "text", text: "hi" }] } },
			] as any),
		).toBeNull();
	});

	it("should return the most recent assistant message", () => {
		const entries = [
			{ type: "message", message: { role: "assistant", content: [{ type: "text", text: "first" }] } },
			{ type: "message", message: { role: "user", content: [{ type: "text", text: "q" }] } },
			{ type: "message", message: { role: "assistant", content: [{ type: "text", text: "second" }] } },
		];
		expect(getLastAssistantText(entries as any)).toBe("second");
	});

	it("should skip empty assistant messages", () => {
		const entries = [
			{ type: "message", message: { role: "assistant", content: [{ type: "text", text: "" }] } },
			{ type: "message", message: { role: "assistant", content: [{ type: "text", text: "actual" }] } },
		];
		expect(getLastAssistantText(entries as any)).toBe("actual");
	});

	it("should return null for empty entries", () => {
		expect(getLastAssistantText([] as any)).toBeNull();
	});

	it("should skip non-message entries", () => {
		const entries = [
			{ type: "tool_use", message: { role: "assistant", content: [{ type: "text", text: "skip" }] } },
			{ type: "message", message: { role: "assistant", content: [{ type: "text", text: "keep" }] } },
		];
		expect(getLastAssistantText(entries as any)).toBe("keep");
	});
});

describe("getAsciiCacheKey", () => {
	it("should combine hash and preset key", () => {
		expect(getAsciiCacheKey("abc12345", "default")).toBe("abc12345:default");
	});

	it("should handle different presets", () => {
		expect(getAsciiCacheKey("abc", "compact")).not.toBe(getAsciiCacheKey("abc", "tight"));
	});
});

describe("ASCII_PRESETS", () => {
	it("should have 4 presets", () => {
		expect(ASCII_PRESETS).toHaveLength(4);
	});

	it("should have expected preset keys", () => {
		const keys = ASCII_PRESETS.map((p: any) => p.key);
		expect(keys).toEqual(["default", "compact", "tight", "squeezed"]);
	});
});

describe("renderAsciiVariant", () => {
	it("should render and cache variant", () => {
		const result = __test.renderAsciiVariant("graph TD\n  A-->B", "testhash", ASCII_PRESETS[0]);
		expect(result).toHaveProperty("ascii");
		expect(result).toHaveProperty("lineCount");
		expect(result).toHaveProperty("maxLineWidth");
		expect(result).toHaveProperty("presetKey");
	});
});

describe("getCachedAsciiLines", () => {
	it("should split ascii into lines", () => {
		const result = __test.getCachedAsciiLines("line1\nline2\nline3");
		expect(result.lines).toEqual(["line1", "line2", "line3"]);
		expect(result.previewLines).toEqual(["line1", "line2", "line3"]);
	});

	it("should truncate preview for long ascii", () => {
		const longAscii = Array.from({ length: 20 }, (_, i) => `line${i}`).join("\n");
		const result = __test.getCachedAsciiLines(longAscii);
		expect(result.lines).toHaveLength(20);
		expect(result.previewLines).toHaveLength(COLLAPSED_LINES);
	});

	it("should return empty for empty string", () => {
		const result = __test.getCachedAsciiLines("");
		expect(result.lines).toEqual([]);
		expect(result.previewLines).toEqual([]);
	});
});

describe("module export default function", () => {
	const mockMermaidParse = vi.fn();
	const mockMermaidInitialize = vi.fn();

	beforeEach(() => {
		vi.resetModules();
		mockMermaidParse.mockReset();
		mockMermaidInitialize.mockReset();
	});

	it("should register message renderer, command, and event handlers", async () => {
		vi.doMock("mermaid", () => ({
			default: {
				parse: vi.fn().mockResolvedValue(undefined),
				initialize: vi.fn(),
			},
		}));

		const mod = await import("../index.ts?" + Date.now());
		const setupFn = mod.default;

		const mockPi = {
			registerMessageRenderer: vi.fn(),
			registerCommand: vi.fn(),
			on: vi.fn(),
			sendMessage: vi.fn(),
		};

		setupFn(mockPi as any);

		expect(mockPi.registerMessageRenderer).toHaveBeenCalledWith("pi-mermaid", expect.any(Function));
		expect(mockPi.registerCommand).toHaveBeenCalledWith("pi-mermaid", expect.any(Object));
		expect(mockPi.on).toHaveBeenCalledWith("input", expect.any(Function));
		expect(mockPi.on).toHaveBeenCalledWith("agent_end", expect.any(Function));
	});
});

describe("processBlock", () => {
	it("should parse and render a valid graph block", async () => {
		const parser = vi.fn().mockResolvedValue(undefined);
		const warnings: string[] = [];
		const warnParserUnavailable = (msg?: string) => {
			warnings.push(msg ?? "");
		};

		const result = await __test.processBlock(
			"graph TD\n  A-->B",
			1,
			"",
			parser,
			warnParserUnavailable,
		);

		expect(parser).toHaveBeenCalledWith("graph TD\n  A-->B");
		expect(result.details.ascii).toBeTruthy();
		expect(result.issues).toHaveLength(0);
	});

	it("should report parse errors", async () => {
		const parser = vi.fn().mockRejectedValue(new Error("bad diagram syntax"));
		const warnParserUnavailable = vi.fn();

		const result = await __test.processBlock(
			"graph TD\n  A-->B",
			1,
			"",
			parser,
			warnParserUnavailable,
		);

		expect(result.issues).toHaveLength(1);
		expect(result.issues[0]!.severity).toBe("error");
		expect(result.issues[0]!.message).toContain("bad diagram syntax");
	});

	it("should call warnParserUnavailable on DOMPurify errors", async () => {
		const parser = vi.fn().mockRejectedValue(new Error("DOMPurify.addHook is not a function"));
		const warnParserUnavailable = vi.fn();

		await __test.processBlock("graph TD\n  A-->B", 1, "", parser, warnParserUnavailable);

		expect(warnParserUnavailable).toHaveBeenCalledWith("DOMPurify.addHook is not a function");
		// Should still render ASCII
		const result2 = await __test.processBlock("graph TD\n  A-->B", 2, "", parser, warnParserUnavailable);
		expect(result2.details.ascii).toBeTruthy();
	});

	it("should handle null parser gracefully", async () => {
		const warnParserUnavailable = vi.fn();

		const result = await __test.processBlock(
			"graph TD\n  A-->B",
			1,
			"",
			null,
			warnParserUnavailable,
		);

		expect(result.details.ascii).toBeTruthy();
	});

	it("should handle unsupported diagram type", async () => {
		const parser = vi.fn().mockResolvedValue(undefined);
		const warnParserUnavailable = vi.fn();

		// gantt is not in SUPPORTED_TYPES
		const result = await __test.processBlock(
			"gantt\n  title T\n  a :a1, 2024-01-01, 1d",
			1,
			"",
			parser,
			warnParserUnavailable,
		);

		// ASCII render might fail, but processBlock still returns
		expect(result).toHaveProperty("details");
		expect(result).toHaveProperty("issues");
	});

	it("should include block label in error messages", async () => {
		const parser = vi.fn().mockRejectedValue(new Error("syntax error"));
		const warnParserUnavailable = vi.fn();

		const result = await __test.processBlock(
			"graph TD\n  A-->B",
			2,
			" (block 2)",
			parser,
			warnParserUnavailable,
		);

		expect(result.issues[0]!.message).toContain("(block 2)");
	});
});

describe("renderMermaidMessage (via module setup)", () => {
	async function setupWithMocks() {
		vi.resetModules();
		vi.doMock("mermaid", () => ({
			default: {
				parse: vi.fn().mockResolvedValue(undefined),
				initialize: vi.fn(),
			},
		}));
		vi.doMock("beautiful-mermaid", () => ({
			renderMermaidAscii: vi.fn(() => "ASCII art line 1\nASCII art line 2"),
		}));
		const mod = await import("../index.ts?" + Date.now());
		return mod;
	}

	it("should render message with ascii content", async () => {
		const mod = await setupWithMocks();
		const mockRenderer = vi.fn();
		const mockPi = {
			registerMessageRenderer: (_type: string, renderer: any) => {
				mockRenderer.mockImplementation(renderer);
			},
			registerCommand: vi.fn(),
			on: vi.fn(),
			sendMessage: vi.fn(),
		};

		mod.default(mockPi as any);

		// Create a mock message
		const message = {
			content: [{ type: "text", text: "[mermaid:error][hash:abc] some error\n\nASCII fallback" }],
			details: {
				ascii: "ASCII diagram",
				lineCount: 3,
				source: "graph TD\n  A-->B",
				index: 0,
			},
		};
		const mockTheme = {
			fg: (_type: string, text: string) => text,
			bg: (_type: string, text: string) => text,
			bold: (text: string) => text,
		};

		const box = mockRenderer(message, { expanded: false }, mockTheme);
		expect(box).toBeDefined();
	});

	it("should render expanded message with source", async () => {
		vi.resetModules();
		vi.doMock("mermaid", () => ({
			default: {
				parse: vi.fn().mockResolvedValue(undefined),
				initialize: vi.fn(),
			},
		}));
		vi.doMock("beautiful-mermaid", () => ({
			renderMermaidAscii: vi.fn(() => "ASCII art line 1\nASCII art line 2"),
		}));
		// Mock getMarkdownTheme to avoid theme initialization
		vi.doMock("@mariozechner/pi-coding-agent", () => ({
			getMarkdownTheme: () => ({
				codeBlock: (s: string) => s,
				codeBlockBorder: (s: string) => s,
				codeBlockIndent: "  ",
			}),
			keyHint: (_b: string, label: string) => label,
		}));

		const mod = await import("../index.ts?" + Date.now());
		let capturedRenderer: any;
		const mockPi = {
			registerMessageRenderer: (_type: string, renderer: any) => {
				capturedRenderer = renderer;
			},
			registerCommand: vi.fn(),
			on: vi.fn(),
			sendMessage: vi.fn(),
		};

		mod.default(mockPi as any);

		const message = {
			content: [{ type: "text", text: "ASCII fallback content" }],
			details: {
				ascii: "ASCII diagram",
				lineCount: 2,
				source: "graph TD\n  A-->B",
				index: 0,
			},
		};
		const mockTheme = {
			fg: (_type: string, text: string) => text,
			bg: (_type: string, text: string) => text,
			bold: (text: string) => text,
		};

		const box = capturedRenderer(message, { expanded: true }, mockTheme);
		expect(box).toBeDefined();
	});

	it("should render message without details", async () => {
		const mod = await setupWithMocks();
		let capturedRenderer: any;
		const mockPi = {
			registerMessageRenderer: (_type: string, renderer: any) => {
				capturedRenderer = renderer;
			},
			registerCommand: vi.fn(),
			on: vi.fn(),
			sendMessage: vi.fn(),
		};

		mod.default(mockPi as any);

		const message = {
			content: [{ type: "text", text: "Just ASCII content here" }],
		};
		const mockTheme = {
			fg: (_type: string, text: string) => text,
			bg: (_type: string, text: string) => text,
			bold: (text: string) => text,
		};

		const box = capturedRenderer(message, { expanded: false }, mockTheme);
		expect(box).toBeDefined();
	});
});

describe("input event handler", () => {
	it("should skip extension-sourced events", async () => {
		vi.resetModules();
		vi.doMock("mermaid", () => ({
			default: {
				parse: vi.fn().mockResolvedValue(undefined),
				initialize: vi.fn(),
			},
		}));
		vi.doMock("beautiful-mermaid", () => ({
			renderMermaidAscii: vi.fn(() => "ASCII"),
		}));

		const mod = await import("../index.ts?" + Date.now());
		let capturedHandler: any;
		const mockPi = {
			registerMessageRenderer: vi.fn(),
			registerCommand: vi.fn(),
			on: (event: string, handler: any) => {
				if (event === "input") capturedHandler = handler;
			},
			sendMessage: vi.fn(),
		};

		mod.default(mockPi as any);

		const result = await capturedHandler({ source: "extension", text: "hello" }, { hasUI: true, ui: { notify: vi.fn() } });
		expect(result.action).toBe("continue");
	});

	it("should skip events without mermaid blocks", async () => {
		vi.resetModules();
		vi.doMock("mermaid", () => ({
			default: {
				parse: vi.fn().mockResolvedValue(undefined),
				initialize: vi.fn(),
			},
		}));
		vi.doMock("beautiful-mermaid", () => ({
			renderMermaidAscii: vi.fn(() => "ASCII"),
		}));

		const mod = await import("../index.ts?" + Date.now());
		let capturedHandler: any;
		const mockPi = {
			registerMessageRenderer: vi.fn(),
			registerCommand: vi.fn(),
			on: (event: string, handler: any) => {
				if (event === "input") capturedHandler = handler;
			},
			sendMessage: vi.fn(),
		};

		mod.default(mockPi as any);

		const result = await capturedHandler({ source: "user", text: "hello world" }, { hasUI: true, ui: { notify: vi.fn() } });
		expect(result.action).toBe("continue");
	});

	it("should render mermaid blocks from input", async () => {
		vi.resetModules();
		vi.doMock("mermaid", () => ({
			default: {
				parse: vi.fn().mockResolvedValue(undefined),
				initialize: vi.fn(),
			},
		}));
		vi.doMock("beautiful-mermaid", () => ({
			renderMermaidAscii: vi.fn(() => "ASCII diagram here"),
		}));

		const mod = await import("../index.ts?" + Date.now());
		let capturedHandler: any;
		const mockPi = {
			registerMessageRenderer: vi.fn(),
			registerCommand: vi.fn(),
			on: (event: string, handler: any) => {
				if (event === "input") capturedHandler = handler;
			},
			sendMessage: vi.fn(),
		};

		mod.default(mockPi as any);

		const ctx = { hasUI: true, ui: { notify: vi.fn() } };
		const result = await capturedHandler(
			{ source: "user", text: "```mermaid\ngraph TD\n  A-->B\n```" },
			ctx,
		);
		expect(result.action).toBe("continue");
		expect(mockPi.sendMessage).toHaveBeenCalled();
	});
});

describe("agent_end event handler", () => {
	it("should render mermaid blocks from assistant messages", async () => {
		vi.resetModules();
		vi.doMock("mermaid", () => ({
			default: {
				parse: vi.fn().mockResolvedValue(undefined),
				initialize: vi.fn(),
			},
		}));
		vi.doMock("beautiful-mermaid", () => ({
			renderMermaidAscii: vi.fn(() => "ASCII diagram"),
		}));

		const mod = await import("../index.ts?" + Date.now());
		let capturedHandler: any;
		const mockPi = {
			registerMessageRenderer: vi.fn(),
			registerCommand: vi.fn(),
			on: (event: string, handler: any) => {
				if (event === "agent_end") capturedHandler = handler;
			},
			sendMessage: vi.fn(),
		};

		mod.default(mockPi as any);

		const ctx = { hasUI: true, ui: { notify: vi.fn() } };
		await capturedHandler(
			{
				messages: [
					{ role: "assistant", content: [{ type: "text", text: "```mermaid\ngraph TD\n  A-->B\n```" }] },
				],
			},
			ctx,
		);
		expect(mockPi.sendMessage).toHaveBeenCalled();
	});

	it("should skip when no assistant text", async () => {
		vi.resetModules();
		vi.doMock("mermaid", () => ({
			default: {
				parse: vi.fn().mockResolvedValue(undefined),
				initialize: vi.fn(),
			},
		}));
		vi.doMock("beautiful-mermaid", () => ({
			renderMermaidAscii: vi.fn(() => "ASCII"),
		}));

		const mod = await import("../index.ts?" + Date.now());
		let capturedHandler: any;
		const mockPi = {
			registerMessageRenderer: vi.fn(),
			registerCommand: vi.fn(),
			on: (event: string, handler: any) => {
				if (event === "agent_end") capturedHandler = handler;
			},
			sendMessage: vi.fn(),
		};

		mod.default(mockPi as any);

		await capturedHandler({ messages: [{ role: "user", content: "hi" }] }, { hasUI: true, ui: { notify: vi.fn() } });
		expect(mockPi.sendMessage).not.toHaveBeenCalled();
	});
});

describe("pi-mermaid command handler", () => {
	it("should handle command with no assistant messages", async () => {
		vi.resetModules();
		vi.doMock("mermaid", () => ({
			default: {
				parse: vi.fn().mockResolvedValue(undefined),
				initialize: vi.fn(),
			},
		}));
		vi.doMock("beautiful-mermaid", () => ({
			renderMermaidAscii: vi.fn(() => "ASCII"),
		}));

		const mod = await import("../index.ts?" + Date.now());
		let capturedCommand: any;
		const mockPi = {
			registerMessageRenderer: vi.fn(),
			registerCommand: (_name: string, config: any) => {
				capturedCommand = config.handler;
			},
			on: vi.fn(),
			sendMessage: vi.fn(),
		};

		mod.default(mockPi as any);

		const ctx = {
			hasUI: true,
			ui: { notify: vi.fn() },
			sessionManager: { getBranch: () => [] },
		};

		await capturedCommand([], ctx);
		expect(ctx.ui.notify).toHaveBeenCalledWith("No assistant message found", "warning");
	});
});
