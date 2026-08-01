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

// ── Coverage: getMermaidParser (module-scope cache) ─────────────────────────
// getMermaidParser caches results in module-scope `mermaidParser` /
// `mermaidParserError`. Each test below uses vi.resetModules() + vi.doMock +
// a cache-busting dynamic import so the cache starts fresh per test.

describe("getMermaidParser", () => {
	let importSeq = 0;
	async function freshImport() {
		// Cache-busting query keeps each test isolated from prior module state.
		return await import("../index.ts?getMermaidParser-" + importSeq++);
	}

	it("returns null from cache on a second call after a probe error sets mermaidParserError", async () => {
		// First call: mermaid has NO parse fn -> sets mermaidParserError.
		// Second call: short-circuits at `if (mermaidParser || mermaidParserError)`
		// and returns the cached null (line 48 first arm).
		vi.resetModules();
		vi.doMock("mermaid", () => ({ get default() { return undefined; } }));
		vi.doMock("beautiful-mermaid", () => ({ renderMermaidAscii: () => "x" }));
		const mod = await freshImport();

		const first = await mod.__test.getMermaidParser();
		expect(first).toBeNull();

		// Second call returns null WITHOUT re-evaluating the body (cache hit).
		const second = await mod.__test.getMermaidParser();
		expect(second).toBeNull();
	});

	it("uses mermaidAPI fallback when mod.default is undefined (line 52 mermaidAPI arm)", async () => {
		// vi.doMock requires a `default` key be present on the mermaid mock
		// (otherwise vitest throws "No default export is defined"). We expose
		// default via a getter that returns undefined, forcing the code to fall
		// through to `(mod as any).mermaidAPI ?? mod`.
		vi.resetModules();
		vi.doMock("mermaid", () => ({
			get default() {
				return undefined;
			},
			mermaidAPI: {
				parse: vi.fn(() => "parsed"),
				initialize: vi.fn(),
			},
		}));
		vi.doMock("beautiful-mermaid", () => ({ renderMermaidAscii: () => "x" }));
		const mod = await freshImport();

		const parser = await mod.__test.getMermaidParser();
		expect(typeof parser).toBe("function");
	});

	// NOTE (line 52 `?? mod` fallback arm): the final fallback `?? mod` cannot
	// be exercised under vitest. vi.doMock("mermaid") enforces that a `default`
	// export exist on the mock; an object literal lacking `default` causes
	// `[vitest] No "default" export is defined` at import time, so `mod` would
	// only ever expose `.default`/`.mermaidAPI`. Skipping rather than failing.

	it("sets error when api has no parse function (line 53, !api || typeof parse !== function)", async () => {
		vi.resetModules();
		vi.doMock("mermaid", () => ({ default: { initialize: vi.fn() } })); // no parse
		vi.doMock("beautiful-mermaid", () => ({ renderMermaidAscii: () => "x" }));
		const mod = await freshImport();

		const parser = await mod.__test.getMermaidParser();
		expect(parser).toBeNull();
	});

	it("sets error when api.parse is not a function", async () => {
		vi.resetModules();
		vi.doMock("mermaid", () => ({ default: { parse: "not-a-function", initialize: vi.fn() } }));
		vi.doMock("beautiful-mermaid", () => ({ renderMermaidAscii: () => "x" }));
		const mod = await freshImport();

		const parser = await mod.__test.getMermaidParser();
		expect(parser).toBeNull();
	});

	it("skips initialize when api.initialize is not a function (line 57 false arm)", async () => {
		// initialize is a string -> typeof !== "function" -> skipped.
		vi.resetModules();
		vi.doMock("mermaid", () => ({
			default: {
				parse: vi.fn(() => "parsed"),
				initialize: "not-a-function" as unknown as () => void,
			},
		}));
		vi.doMock("beautiful-mermaid", () => ({ renderMermaidAscii: () => "x" }));
		const mod = await freshImport();

		const parser = await mod.__test.getMermaidParser();
		expect(typeof parser).toBe("function");
	});

	it("swallows errors thrown by api.initialize (line 60 catch)", async () => {
		vi.resetModules();
		vi.doMock("mermaid", () => ({
			default: {
				parse: vi.fn(() => "parsed"),
				initialize: vi.fn(() => {
					throw new Error("init boom");
				}),
			},
		}));
		vi.doMock("beautiful-mermaid", () => ({ renderMermaidAscii: () => "x" }));
		const mod = await freshImport();

		const parser = await mod.__test.getMermaidParser();
		expect(typeof parser).toBe("function");
	});

	it("handles a synchronous probe result that is not a thenable (line 72 false arm)", async () => {
		// api.parse returns a plain object (no .then) -> probe not awaited.
		vi.resetModules();
		vi.doMock("mermaid", () => ({
			default: {
				parse: vi.fn(() => ({ ast: "node" })),
				initialize: vi.fn(),
			},
		}));
		vi.doMock("beautiful-mermaid", () => ({ renderMermaidAscii: () => "x" }));
		const mod = await freshImport();

		const parser = await mod.__test.getMermaidParser();
		expect(typeof parser).toBe("function");
		// The returned parser must also handle a sync (non-thenable) parse
		// result (line 83 false arm).
		await parser!("flowchart\n  A-->B");
	});

	it("records DOMPurify probe error and returns null (line 75 true arm)", async () => {
		// Probe throws a DOMPurify error -> mermaidParserError set, returns null.
		vi.resetModules();
		vi.doMock("mermaid", () => ({
			default: {
				parse: vi.fn(() => {
					throw new Error("DOMPurify.addHook is not a function");
				}),
				initialize: vi.fn(),
			},
		}));
		vi.doMock("beautiful-mermaid", () => ({ renderMermaidAscii: () => "x" }));
		const mod = await freshImport();

		const parser = await mod.__test.getMermaidParser();
		expect(parser).toBeNull();
	});

	it("uses error.message for an Error thrown by the probe (line 74 true arm)", async () => {
		// Probe throws a non-DOMPurify Error -> caught, but NOT a DOMPurify
		// error so it does NOT set mermaidParserError; parser still builds.
		vi.resetModules();
		vi.doMock("mermaid", () => ({
			default: {
				// First call (probe) throws a plain Error; subsequent calls (real
				// parse inside the parser closure) succeed.
				parse: vi.fn(() => {
					throw new Error("probe-only-failure");
				}),
				initialize: vi.fn(),
			},
		}));
		vi.doMock("beautiful-mermaid", () => ({ renderMermaidAscii: () => "x" }));
		const mod = await freshImport();

		const parser = await mod.__test.getMermaidParser();
		// Because the probe error is not a DOMPurify error, the catch swallows
		// it and the parser is still constructed.
		expect(typeof parser).toBe("function");
	});

	it("uses String(error) when the probe throws a non-Error (line 74 false arm)", async () => {
		// Probe throws a raw string -> `error instanceof Error` is false.
		vi.resetModules();
		vi.doMock("mermaid", () => ({
			default: {
				parse: vi.fn(() => {
					throw "raw-probe-string";
				}),
				initialize: vi.fn(),
			},
		}));
		vi.doMock("beautiful-mermaid", () => ({ renderMermaidAscii: () => "x" }));
		const mod = await freshImport();

		// Not a DOMPurify error, so the parser is still built despite the throw.
		const parser = await mod.__test.getMermaidParser();
		expect(typeof parser).toBe("function");
	});

	it("uses error.message when import throws an Error (line 89 true arm)", async () => {
		// Accessing mod.default throws an Error inside the try -> outer catch.
		vi.resetModules();
		vi.doMock("mermaid", () => ({
			get default() {
				throw new Error("import-failed-err");
			},
		}));
		vi.doMock("beautiful-mermaid", () => ({ renderMermaidAscii: () => "x" }));
		const mod = await freshImport();

		const parser = await mod.__test.getMermaidParser();
		expect(parser).toBeNull();
	});

	it("uses String(error) when import throws a non-Error (line 89 false arm)", async () => {
		// Accessing mod.default throws a raw string -> instanceof Error false.
		vi.resetModules();
		vi.doMock("mermaid", () => ({
			get default() {
				throw "raw-import-string";
			},
		}));
		vi.doMock("beautiful-mermaid", () => ({ renderMermaidAscii: () => "x" }));
		const mod = await freshImport();

		const parser = await mod.__test.getMermaidParser();
		expect(parser).toBeNull();
	});
});

// ── Coverage: selectAsciiVariant fallback line counting (line 278) ─────────

describe("selectAsciiVariant fallbackLineCount falsy", () => {
	it("computes lineCount from fallbackAscii when fallbackLineCount is 0 (line 278 false arm)", () => {
		// fallbackLineCount = 0 (falsy) -> countAsciiLines(fallbackAscii).
		const multiLine = "line one\nline two\nline three";
		const result = selectAsciiVariant(100, undefined, multiLine, 0);
		expect(result.ascii).toBe(multiLine);
		expect(result.lineCount).toBe(3);
	});
});

// ── Coverage: splitIssuesFromContent line 319 true arm ──────────────────────

describe("splitIssuesFromContent trailing issue without blank line", () => {
	it("pushes current when the only line is an issue (line 319 true arm)", () => {
		// A single issue line with NO trailing content: the loop sets `current`
		// at line 298, then `i` reaches lines.length and the while-condition
		// exits WITHOUT pushing (no blank line, no second iteration). The guard
		// at line 319 (`current && !issues.includes(current)`) then pushes it.
		const text = "[mermaid:error][hash:abc] some error";
		const result = splitIssuesFromContent(text);
		expect(result.issues).toHaveLength(1);
		expect(result.issues[0]!.message).toBe("some error");
		expect(result.ascii).toBe("");
	});
});

// ── Coverage: processBlock render error paths (lines 351-355, 390, 401) ─────

describe("processBlock render failures", () => {
	const warnParserUnavailable = vi.fn();

	it("skips the squeezed preset when it throws (line 389, preset.key === squeezed continue)", async () => {
		// real renderMermaidAscii is invoked via renderAsciiVariant; mock it to
		// throw ONLY for the squeezed preset (paddingX === 1). The other 3
		// presets succeed, so variants is non-empty and the squeezed failure is
		// silently skipped via `continue`.
		vi.resetModules();
		vi.doMock("mermaid", () => ({
			default: { parse: vi.fn().mockResolvedValue(undefined), initialize: vi.fn() },
		}));
		vi.doMock("beautiful-mermaid", () => ({
			renderMermaidAscii: vi.fn((block: string, opts: { paddingX: number }) => {
				if (opts.paddingX === 1) throw new Error("squeezed boom");
				return "ascii-" + opts.paddingX;
			}),
		}));
		const mod = await import("../index.ts?proc-squeezed-" + Date.now());

		const result = await mod.__test.processBlock(
			"graph TD\n  A-->B",
			1,
			"",
			null,
			warnParserUnavailable,
		);
		// First (non-squeezed) variant is used; squeezed simply omitted.
		expect(result.details.ascii).toBe("ascii-5");
		expect(result.details.variants).toHaveLength(3);
		expect(result.details.variants!.map((v: any) => v.presetKey)).not.toContain("squeezed");
	});

	it("throws 'No ASCII variants rendered' when every preset fails (line 395/396)", async () => {
		// All presets throw -> variants stays empty -> inner `throw` fires ->
		// caught by outer catch -> '[render failed]' with a reported issue.
		vi.resetModules();
		vi.doMock("mermaid", () => ({
			default: { parse: vi.fn().mockResolvedValue(undefined), initialize: vi.fn() },
		}));
		vi.doMock("beautiful-mermaid", () => ({
			renderMermaidAscii: vi.fn(() => {
				throw new Error("total render failure");
			}),
		}));
		const mod = await import("../index.ts?proc-novariants-" + Date.now());

		const result = await mod.__test.processBlock(
			"graph TD\n  A-->B",
			1,
			"",
			null,
			warnParserUnavailable,
		);
		expect(result.details.ascii).toBe("[render failed]");
		expect(result.details.lineCount).toBe(1);
		expect(result.details.variants).toBeUndefined();
		expect(result.issues).toHaveLength(1);
		expect(result.issues[0]!.message).toContain("No ASCII variants rendered");
	});

	it("reports 'No ASCII variants rendered' when every preset throws (line 401 true arm)", async () => {
		// When ALL presets throw, the inner loop leaves `variants` empty and
		// line 396 throws `new Error("No ASCII variants rendered")`. That Error
		// is what reaches the outer catch at line 400, so `error instanceof
		// Error` is TRUE and error.message is used (line 401 true arm).
		//
		// NOTE: the `: String(error)` arm (line 401 false arm) is unreachable on
		// the render path. The only value that can escape into this catch is the
		// `new Error(...)` constructed at line 396 (per-preset throws are
		// caught individually at line 388). So a non-Error can never reach
		// line 401 here. Skipping that arm rather than leaving a failing test.
		vi.resetModules();
		vi.doMock("mermaid", () => ({
			default: { parse: vi.fn().mockResolvedValue(undefined), initialize: vi.fn() },
		}));
		vi.doMock("beautiful-mermaid", () => ({
			renderMermaidAscii: vi.fn(() => {
				throw "raw-render-string";
			}),
		}));
		const mod = await import("../index.ts?proc-nonerr-" + Date.now());

		const result = await mod.__test.processBlock(
			"graph TD\n  A-->B",
			1,
			"",
			null,
			warnParserUnavailable,
		);
		expect(result.details.ascii).toBe("[render failed]");
		expect(result.details.lineCount).toBe(1);
		// The raw per-preset throw is swallowed; the surfaced message is the
		// synthesized "No ASCII variants rendered" Error.
		expect(result.issues[0]!.message).toContain("No ASCII variants rendered");
	});

	it("dedupes repeated issues via seenIssueKeys (line 351 true arm)", async () => {
		// seenIssueKeys is module-scoped and persists across processBlock calls
		// on the same module instance. Rendering the SAME block twice with the
		// same render failure produces the same issue key; the second call's
		// addIssue hits `if (seenIssueKeys.has(key)) return` and emits no issue.
		vi.resetModules();
		vi.doMock("mermaid", () => ({
			default: { parse: vi.fn().mockResolvedValue(undefined), initialize: vi.fn() },
		}));
		vi.doMock("beautiful-mermaid", () => ({
			renderMermaidAscii: vi.fn(() => {
				throw new Error("dup render failure");
			}),
		}));
		const mod = await import("../index.ts?proc-dedup-" + Date.now());

		const first = await mod.__test.processBlock("graph TD\n  A-->B", 1, "", null, warnParserUnavailable);
		expect(first.issues).toHaveLength(1);

		const second = await mod.__test.processBlock("graph TD\n  A-->B", 1, "", null, warnParserUnavailable);
		// Same diagramHash + same error -> deduped, no issue recorded.
		expect(second.issues).toHaveLength(0);
	});

	it("evicts oldest seenIssueKeys entry once size exceeds MAX_SEEN_ISSUES (lines 353-355)", async () => {
		// seenIssueKeys caps at MAX_SEEN_ISSUES (200) by deleting the OLDEST
		// inserted key once size exceeds 200 (LRU-ish). To prove eviction
		// actually happens: record key #0, then 200 MORE distinct keys (which
		// evicts #0), then re-trigger the SAME block #0. Because #0 was evicted,
		// the re-trigger is NOT deduped -> it records a fresh issue. With
		// blockLabel="" the issue message (and thus the dedup key) is stable
		// across both #0 calls, so the only variable is whether #0 survives.
		vi.resetModules();
		vi.doMock("mermaid", () => ({
			default: { parse: vi.fn().mockResolvedValue(undefined), initialize: vi.fn() },
		}));
		vi.doMock("beautiful-mermaid", () => ({
			renderMermaidAscii: vi.fn(() => {
				throw new Error("evict render failure");
			}),
		}));
		const mod = await import("../index.ts?proc-evict-" + Date.now());

		// Seed key #0 (block N0): first occurrence -> recorded, issues length 1.
		const first = await mod.__test.processBlock(`graph TD\n  N0-->B`, 1, "", null, warnParserUnavailable);
		expect(first.issues).toHaveLength(1);

		// 200 MORE distinct blocks (N1..N200) -> 200 more distinct keys. The
		// 200th of these pushes size to 201 (> MAX_SEEN_ISSUES), evicting the
		// oldest entry, which is key #0.
		for (let n = 1; n <= 200; n++) {
			await mod.__test.processBlock(`graph TD\n  N${n}-->B`, 1, "", null, warnParserUnavailable);
		}

		// Re-trigger the SAME block #0 with the SAME failure. If eviction
		// worked, key #0 is gone from seenIssueKeys, so this is recorded again
		// (issues length 1). If eviction did NOT happen, key #0 would still be
		// present and addIssue would dedupe (issues length 0).
		const reIssueResult = await mod.__test.processBlock(`graph TD\n  N0-->B`, 1, "", null, warnParserUnavailable);
		expect(reIssueResult.issues).toHaveLength(1);
	});
});

// ── renderMermaidMessage: full coverage of the MessageRenderer and its inner
//    Component.render / invalidate / Box paint callbacks (index.ts lines 426-489) ──

describe("renderMermaidMessage: renderer capture + ascii/box/source rendering", () => {
	// Helper: set up an isolated module instance and capture the MessageRenderer
	// registered via pi.registerMessageRenderer. Returns the captured renderer
	// so individual tests can invoke it with bespoke message/theme shapes.
	async function setupRenderer(opts?: { mockMarkdownTheme?: any }) {
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
		if (opts?.mockMarkdownTheme) {
			vi.doMock("@mariozechner/pi-coding-agent", () => opts.mockMarkdownTheme);
		}

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
		// Renderer is registered synchronously during the default export call.
		expect(capturedRenderer).toBeTypeOf("function");
		return { capturedRenderer: () => capturedRenderer };
	}

	function makeTheme() {
		return {
			fg: vi.fn((_type: string, text: string) => text),
			bg: vi.fn((_type: string, text: string) => text),
			bold: vi.fn((t: string) => t),
		};
	}

	it("renders a basic Box whose first child is the asciiComponent (expanded forces all lines)", async () => {
		// Mocks keyHint so the real theme singleton is never touched.
		const { capturedRenderer } = await setupRenderer({
			mockMarkdownTheme: {
				getMarkdownTheme: () => ({
					codeBlock: (s: string) => s,
					codeBlockBorder: (s: string) => s,
					codeBlockIndent: "  ",
					highlightCode: (code: string) => code.split("\n"),
				}),
				keyHint: (_a: string, label: string) => label,
			},
		});
		const theme = makeTheme();

		// expanded=true forces isExpanded=true even though there's no overflow,
		// and details.source is present so the source block is appended.
		const message = {
			content: [{ type: "text", text: "ASCII fallback content" }],
			details: {
				ascii: "line1\nline2",
				lineCount: 2,
				source: "graph TD\n  A-->B",
				index: 0,
			},
		};

		const box = capturedRenderer()(message, { expanded: true }, theme);
		expect(box).toBeDefined();
		// expanded + source => [asciiComponent, Spacer, Text]
		expect(box.children).toHaveLength(3);

		const asciiComponent = box.children[0];
		// asciiComponent.render -> exercises lines 435-449 (render callback)
		const lines = asciiComponent.render(80);
		expect(lines).toContain("line1");
		expect(lines).toContain("line2");
		// bold + fg called for the label
		expect(theme.bold).toHaveBeenCalled();
		expect(theme.fg).toHaveBeenCalled();

		// invalidate callback (line 467) is a no-op but must be callable.
		expect(() => asciiComponent.invalidate()).not.toThrow();
	});

	it("covers the Box paint callback (theme.bg) via box.render", async () => {
		const { capturedRenderer } = await setupRenderer({
			mockMarkdownTheme: {
				getMarkdownTheme: () => ({
					codeBlock: (s: string) => s,
					codeBlockBorder: (s: string) => s,
				}),
				keyHint: (_a: string, label: string) => label,
			},
		});
		const theme = makeTheme();
		const message = {
			content: [{ type: "text", text: "ascii content" }],
			details: { ascii: "a\nb", lineCount: 2, index: 0 },
		};

		const box = capturedRenderer()(message, { expanded: false }, theme);
		// box.render samples bgFn("test") and applies bg per line -> exercises
		// the Box paint callback `(t) => theme.bg(...)` (line 470).
		const rendered = box.render(40);
		expect(rendered.length).toBeGreaterThan(0);
		expect(theme.bg).toHaveBeenCalled();
	});

	it("renders full lines and uses identity clip when content fits width (needsClip=false)", async () => {
		const { capturedRenderer } = await setupRenderer({
			mockMarkdownTheme: {
				getMarkdownTheme: () => ({ codeBlock: (s: string) => s, codeBlockBorder: (s: string) => s }),
				keyHint: (_a: string, label: string) => label,
			},
		});
		const theme = makeTheme();
		// Wide render width so selection.maxLineWidth <= contentWidth (needsClip=false)
		// -> the identity `(line) => line` arm (lines 444/445 right arm) is used.
		const message = {
			content: [{ type: "text", text: "x" }],
			details: {
				ascii: "narrow line\nother narrow",
				lineCount: 2,
				source: "graph TD",
				index: 0,
				variants: [{ presetKey: "tight", ascii: "narrow line\nother narrow", lineCount: 2, maxLineWidth: 12 }],
			},
		};
		const box = capturedRenderer()(message, { expanded: false }, theme);
		const asciiComponent = box.children[0];
		const lines = asciiComponent.render(100);
		// Lines are not truncated -> identity arm preserved full content.
		expect(lines.some((l: string) => l.includes("narrow line"))).toBe(true);
	});

	it("collapses overflow: previewLines + 'more lines' hint (line 442 false arm, line 454)", async () => {
		const { capturedRenderer } = await setupRenderer({
			mockMarkdownTheme: {
				getMarkdownTheme: () => ({ codeBlock: (s: string) => s, codeBlockBorder: (s: string) => s }),
				keyHint: (_a: string, label: string) => label,
			},
		});
		const theme = makeTheme();
		// lineCount=20 (> COLLAPSED_LINES=10) + expanded=false -> isExpanded=false
		// -> uses previewLines (10) and emits the "... (N more lines ...)" hint.
		const twentyLines = Array.from({ length: 20 }, (_, i) => `line${i}`).join("\n");
		const message = {
			content: [{ type: "text", text: "x" }],
			details: {
				ascii: twentyLines,
				lineCount: 20,
				source: "graph TD",
				index: 0,
				variants: [{ presetKey: "tight", ascii: twentyLines, lineCount: 20, maxLineWidth: 6 }],
			},
		};
		const box = capturedRenderer()(message, { expanded: false }, theme);
		const asciiComponent = box.children[0];
		const lines = asciiComponent.render(100); // wide width: no clip, only overflow hint
		// Exactly the COLLAPSED_LINES preview lines + label + 1 hint line.
		expect(lines).toHaveLength(1 + COLLAPSED_LINES + 1);
		const hint = lines[lines.length - 1];
		expect(hint).toContain("10 more lines");
		expect(hint).toContain("to expand");
		// No "clipped" hint because width (100) >= maxLineWidth.
		expect(lines.some((l: string) => l.includes("clipped to fit width"))).toBe(false);
	});

	it("clips wide content and emits 'clipped' hint (lines 443, 444 left, 445 left, 460)", async () => {
		const { capturedRenderer } = await setupRenderer({
			mockMarkdownTheme: {
				getMarkdownTheme: () => ({ codeBlock: (s: string) => s, codeBlockBorder: (s: string) => s }),
				keyHint: (_a: string, label: string) => label,
			},
		});
		const theme = makeTheme();
		// maxLineWidth=200 but render width=40 -> needsClip=true (truncate arm) and
		// selection.clipped=true (tightest variant still wider than width).
		const wideAscii = "x".repeat(200);
		const message = {
			content: [{ type: "text", text: "x" }],
			details: {
				ascii: wideAscii,
				lineCount: 1, // no overflow -> only the clipped hint shows
				source: "graph TD",
				index: 0,
				variants: [{ presetKey: "tight", ascii: wideAscii, lineCount: 1, maxLineWidth: 200 }],
			},
		};
		const box = capturedRenderer()(message, { expanded: false }, theme);
		const asciiComponent = box.children[0];
		const lines = asciiComponent.render(40);
		// Truncated body line should not exceed the content width (40) in visible
		// width. truncateToWidth may append an ANSI reset ("\u001b[0m"), so use
		// visibleWidth rather than string length.
		const body = lines[1]; // index 0 is the label
		expect(maxAsciiLineWidth(body)).toBeLessThanOrEqual(40);
		// Clipped hint present.
		expect(lines.some((l: string) => l.includes("clipped to fit width"))).toBe(true);
		// No overflow hint (lineCount=1).
		expect(lines.some((l: string) => l.includes("more lines"))).toBe(false);
	});

	it("expanded=true overrides overflow so full lines render without hint", async () => {
		const { capturedRenderer } = await setupRenderer({
			mockMarkdownTheme: {
				getMarkdownTheme: () => ({ codeBlock: (s: string) => s, codeBlockBorder: (s: string) => s }),
				keyHint: (_a: string, label: string) => label,
			},
		});
		const theme = makeTheme();
		// lineCount=20 but expanded=true -> isExpanded=true (line 441 left arm),
		// full lines render, no "more lines" hint.
		const twentyLines = Array.from({ length: 20 }, (_, i) => `line${i}`).join("\n");
		const message = {
			content: [{ type: "text", text: "x" }],
			details: {
				ascii: twentyLines,
				lineCount: 20,
				index: 0,
			},
		};
		const box = capturedRenderer()(message, { expanded: true }, theme);
		const asciiComponent = box.children[0];
		const lines = asciiComponent.render(100);
		// label + 20 full lines, no overflow hint.
		expect(lines).toHaveLength(1 + 20);
		expect(lines.some((l: string) => l.includes("more lines"))).toBe(false);
	});

	it("falls back to countAsciiLines when details.lineCount is absent (line 431)", async () => {
		const { capturedRenderer } = await setupRenderer({
			mockMarkdownTheme: {
				getMarkdownTheme: () => ({ codeBlock: (s: string) => s, codeBlockBorder: (s: string) => s }),
				keyHint: (_a: string, label: string) => label,
			},
		});
		const theme = makeTheme();
		// details present but WITHOUT lineCount -> fallback arm of line 431 fires.
		const message = {
			content: [{ type: "text", text: "x" }],
			details: {
				ascii: "a\nb\nc\nd",
				source: "graph TD",
				index: 0,
				// lineCount intentionally omitted
			},
		};
		const box = capturedRenderer()(message, { expanded: false }, theme);
		const asciiComponent = box.children[0];
		// Should render without throwing and include all 4 lines (no overflow).
		const lines = asciiComponent.render(100);
		expect(lines).toContain("a");
		expect(lines).toContain("d");
	});

	it("expanded source block uses highlightCode when defined (line 478 left arm)", async () => {
		const highlightCode = vi.fn((code: string) => code.split("\n").map((l: string) => `[H]${l}`));
		const { capturedRenderer } = await setupRenderer({
			mockMarkdownTheme: {
				getMarkdownTheme: () => ({
					codeBlock: (s: string) => `[CB]${s}`,
					codeBlockBorder: (s: string) => `[B]${s}`,
					codeBlockIndent: "    ", // defined -> line 476 left arm
					highlightCode,
				}),
				keyHint: (_a: string, label: string) => label,
			},
		});
		const theme = makeTheme();
		const message = {
			content: [{ type: "text", text: "ascii content" }],
			details: { ascii: "a\nb", lineCount: 2, source: "graph TD\n  A-->B", index: 0 },
		};

		const box = capturedRenderer()(message, { expanded: true }, theme);
		expect(box.children).toHaveLength(3);
		expect(box.children[1].constructor.name).toBe("Spacer");
		expect(box.children[2].constructor.name).toBe("Text");

		// Render the Text component to exercise the source-block construction.
		const textLines = box.children[2].render(120);
		expect(highlightCode).toHaveBeenCalledWith("graph TD\n  A-->B", "mermaid");
		// Each code line prefixed with the (defined) indent and the highlight marker.
		expect(textLines.some((l: string) => l.includes("[B]```mermaid"))).toBe(true);
		expect(textLines.some((l: string) => /^    \[H\]graph TD/.test(l))).toBe(true);
		expect(textLines.some((l: string) => /```$/.test(l.trim()))).toBe(true);
	});

	it("expanded source block falls back to codeBlock when highlightCode is undefined (line 479 right arm, line 476 fallback indent)", async () => {
		const { capturedRenderer } = await setupRenderer({
			mockMarkdownTheme: {
				getMarkdownTheme: () => ({
					codeBlock: (s: string) => `[CB]${s}`,
					codeBlockBorder: (s: string) => `[B]${s}`,
					// codeBlockIndent omitted -> line 476 right arm falls back to "  "
					// highlightCode omitted -> line 478 ?. chain is undefined -> line 479
					//   right arm uses normalizedSource.split("\n").map(codeBlock)
				}),
				keyHint: (_a: string, label: string) => label,
			},
		});
		const theme = makeTheme();
		const message = {
			content: [{ type: "text", text: "ascii content" }],
			details: { ascii: "a\nb", lineCount: 2, source: "graph TD   \n  A-->B", index: 0 },
		};

		const box = capturedRenderer()(message, { expanded: true }, theme);
		const textLines = box.children[2].render(120);
		// codeBlock applied per line; default 2-space indent (fallback).
		expect(textLines.some((l: string) => /^  \[CB\]graph TD/.test(l))).toBe(true);
		// highlightCode was undefined, so the fallback used codeBlock (not a raw split).
		expect(textLines.some((l: string) => l.includes("[CB]"))).toBe(true);
		expect(textLines.some((l: string) => l.includes("[H]"))).toBe(false);
	});

	it("does not render source block when expanded=false even if source present", async () => {
		const { capturedRenderer } = await setupRenderer({
			mockMarkdownTheme: {
				getMarkdownTheme: () => ({ codeBlock: (s: string) => s, codeBlockBorder: (s: string) => s }),
				keyHint: (_a: string, label: string) => label,
			},
		});
		const theme = makeTheme();
		const message = {
			content: [{ type: "text", text: "ascii content" }],
			details: { ascii: "a\nb", lineCount: 2, source: "graph TD", index: 0 },
		};
		const box = capturedRenderer()(message, { expanded: false }, theme);
		// Only the asciiComponent; no Spacer/Text.
		expect(box.children).toHaveLength(1);
	});

	it("does not render source block when details.source is absent", async () => {
		const { capturedRenderer } = await setupRenderer({
			mockMarkdownTheme: {
				getMarkdownTheme: () => ({ codeBlock: (s: string) => s, codeBlockBorder: (s: string) => s }),
				keyHint: (_a: string, label: string) => label,
			},
		});
		const theme = makeTheme();
		const message = {
			content: [{ type: "text", text: "ascii content" }],
			details: { ascii: "a\nb", lineCount: 2, index: 0 },
		};
		const box = capturedRenderer()(message, { expanded: true }, theme);
		// expanded=true but details.source missing -> line 473 false arm.
		expect(box.children).toHaveLength(1);
	});

	it("uses fallback ascii from content when details.ascii is absent", async () => {
		const { capturedRenderer } = await setupRenderer({
			mockMarkdownTheme: {
				getMarkdownTheme: () => ({ codeBlock: (s: string) => s, codeBlockBorder: (s: string) => s }),
				keyHint: (_a: string, label: string) => label,
			},
		});
		const theme = makeTheme();
		// No details at all -> fallbackAscii comes from splitIssuesFromContent(content).
		const message = {
			content: [{ type: "text", text: "fallback ascii line 1\nfallback ascii line 2" }],
		};
		const box = capturedRenderer()(message, { expanded: false }, theme);
		const lines = box.children[0].render(100);
		expect(lines.some((l: string) => l.includes("fallback ascii line 1"))).toBe(true);
	});
});

// ── Coverage: renderBlocks / input / agent_end / pi-mermaid command ──────────
//
// Targets the previously-uncovered branches in lines 493-612 of index.ts.
// Reuses the vi.resetModules() + vi.doMock("mermaid", ...) + dynamic-import
// pattern so the module-scope mermaidParser / mermaidParserError /
// mermaidParserWarned state is fresh per test.

// mermaid mock whose parse() resolves (parser ok).
function mockMermaidOk() {
	vi.doMock("mermaid", () => ({
		default: {
			parse: vi.fn().mockResolvedValue(undefined),
			initialize: vi.fn(),
		},
	}));
}

// mermaid mock whose `mod.default` access throws -> getMermaidParser's outer
// catch sets module-scope mermaidParserError to errorMessage and returns null.
// (Throwing inside the vi.doMock factory itself is intercepted by vitest with a
// wrapped "There was an error when mocking a module" message, so we throw from
// a `default` getter instead, which is caught by index.ts's try around the
// `await import("mermaid")` + `.default ?? ...` access.)
function mockMermaidImportThrows(errorMessage = "Cannot find module 'mermaid'") {
	vi.doMock("mermaid", () => ({
		get default() {
			throw new Error(errorMessage);
		},
	}));
}

describe("renderBlocks: notify closure (hasUI arms)", () => {
	it("renders a block when ctx.hasUI is true (notify true arm, line 499 br0)", async () => {
		vi.resetModules();
		mockMermaidOk();
		vi.doMock("beautiful-mermaid", () => ({ renderMermaidAscii: vi.fn(() => "ASCII") }));
		const mod = await import("../index.ts?rb-notify-true-" + Date.now());

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

		const notify = vi.fn();
		await capturedHandler(
			{ source: "user", text: "```mermaid\ngraph TD\n  A-->B\n```" },
			{ hasUI: true, ui: { notify } },
		);
		// notify closure's true arm is reachable; block is rendered.
		expect(mockPi.sendMessage).toHaveBeenCalledTimes(1);
	});

	it("renders a block when ctx.hasUI is false without throwing (notify false arm, line 499 br1)", async () => {
		vi.resetModules();
		mockMermaidOk();
		vi.doMock("beautiful-mermaid", () => ({ renderMermaidAscii: vi.fn(() => "ASCII") }));
		const mod = await import("../index.ts?rb-notify-false-" + Date.now());

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

		// ctx.hasUI false -> the `if (ctx.hasUI)` false arm at line 499 must
		// be exercised. Use an unsupported type so notify() is actually invoked
		// (a valid graph never calls notify). No ui object is provided.
		await expect(
			capturedHandler(
				{ source: "user", text: "```mermaid\npie\n  \"A\": 50\n```" },
				{ hasUI: false } as any,
			),
		).resolves.toEqual({ action: "continue" });
		// Unsupported type -> skipped (no sendMessage).
		expect(mockPi.sendMessage).not.toHaveBeenCalled();
	});
});

describe("renderBlocks: warnParserUnavailable (parser null)", () => {
	it("notifies once with mermaidParserError suffix when parser unavailable (hasUI true)", async () => {
		vi.resetModules();
		mockMermaidImportThrows("boom-import");
		vi.doMock("beautiful-mermaid", () => ({ renderMermaidAscii: vi.fn(() => "ASCII") }));
		const mod = await import("../index.ts?rb-warn1-" + Date.now());

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

		const notify = vi.fn();
		await capturedHandler(
			{ source: "user", text: "```mermaid\ngraph TD\n  A-->B\n```" },
			{ hasUI: true, ui: { notify } },
		);
		// warnParserUnavailable() with no errorMessage -> suffix uses mermaidParserError.
		expect(notify).toHaveBeenCalledWith(
			"Mermaid parser validation isn't available (boom-import). Rendering as ASCII without validation.",
			"info",
		);
		// Block still renders without validation.
		expect(mockPi.sendMessage).toHaveBeenCalledTimes(1);
	});

	it("warns only once across multiple blocks (mermaidParserWarned guard, line 503 second-call early return)", async () => {
		vi.resetModules();
		mockMermaidImportThrows("boom-import");
		vi.doMock("beautiful-mermaid", () => ({ renderMermaidAscii: vi.fn(() => "ASCII") }));
		const mod = await import("../index.ts?rb-warn2-" + Date.now());

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

		const notify = vi.fn();
		const text = "```mermaid\ngraph TD\n  A-->B\n```\n```mermaid\ngraph TD\n  C-->D\n```";
		await capturedHandler({ source: "user", text }, { hasUI: true, ui: { notify } });
		// Only the first warnParserUnavailable emits; the second early-returns.
		const warns = notify.mock.calls.filter(([m]) =>
			typeof m === "string" && m.includes("Mermaid parser validation isn't available"),
		);
		expect(warns).toHaveLength(1);
		expect(mockPi.sendMessage).toHaveBeenCalledTimes(2);
	});

	it("does not notify when ctx.hasUI is false (warnParserUnavailable early return, line 503 br1)", async () => {
		vi.resetModules();
		mockMermaidImportThrows("boom-import");
		vi.doMock("beautiful-mermaid", () => ({ renderMermaidAscii: vi.fn(() => "ASCII") }));
		const mod = await import("../index.ts?rb-warn3-" + Date.now());

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

		// ctx.hasUI false -> warnParserUnavailable returns before notify.
		await capturedHandler(
			{ source: "user", text: "```mermaid\ngraph TD\n  A-->B\n```" },
			{ hasUI: false } as any,
		);
		expect(mockPi.sendMessage).toHaveBeenCalledTimes(1);
	});

	it("emits empty suffix when errorMessage is a DOMPurify error (line 505 isDom true arm)", async () => {
		vi.resetModules();
		// Probe (classDiagram) resolves; real block parse throws a DOMPurify error,
		// so processBlock calls warnParserUnavailable(errorMessage) where
		// isDomPurifyError(errorMessage) is true -> suffix "".
		const parse = vi.fn(async (src: string) => {
			if (src.startsWith("classDiagram")) return undefined;
			throw new Error("DOMPurify.addHook is not a function");
		});
		vi.doMock("mermaid", () => ({ default: { parse, initialize: vi.fn() } }));
		vi.doMock("beautiful-mermaid", () => ({ renderMermaidAscii: vi.fn(() => "ASCII") }));
		const mod = await import("../index.ts?rb-warn-dom-" + Date.now());

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

		const notify = vi.fn();
		await capturedHandler(
			{ source: "user", text: "```mermaid\ngraph TD\n  A-->B\n```" },
			{ hasUI: true, ui: { notify } },
		);
		expect(notify).toHaveBeenCalledWith(
			"Mermaid parser validation isn't available. Rendering as ASCII without validation.",
			"info",
		);
		expect(mockPi.sendMessage).toHaveBeenCalledTimes(1);
	});
});

describe("renderBlocks: body branches", () => {
	it("notifies 'rendering first N' when more than MAX_BLOCKS blocks are present (line 516)", async () => {
		vi.resetModules();
		mockMermaidOk();
		vi.doMock("beautiful-mermaid", () => ({ renderMermaidAscii: vi.fn(() => "ASCII") }));
		const mod = await import("../index.ts?rb-maxblocks-" + Date.now());

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

		const notify = vi.fn();
		// 6 blocks (> MAX_BLOCKS=5).
		const text = Array.from({ length: 6 }, (_, i) =>
			"```mermaid\ngraph TD\n  A" + i + "-->B" + i + "\n```",
		).join("\n");
		await capturedHandler({ source: "user", text }, { hasUI: true, ui: { notify } });

		expect(notify).toHaveBeenCalledWith(
			`Found 6 mermaid blocks, rendering first ${MAX_BLOCKS}.`,
			"warning",
		);
		expect(mockPi.sendMessage).toHaveBeenCalledTimes(MAX_BLOCKS);
	});

	it("notifies 'too large' and skips a block with > MAX_SOURCE_LINES (line 524)", async () => {
		vi.resetModules();
		mockMermaidOk();
		vi.doMock("beautiful-mermaid", () => ({ renderMermaidAscii: vi.fn(() => "ASCII") }));
		const mod = await import("../index.ts?rb-toolong-" + Date.now());

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

		const notify = vi.fn();
		// Valid block followed by an oversized block (>400 lines).
		const huge = "graph TD\n" + "A-->B\n".repeat(420);
		const text = "```mermaid\ngraph TD\n  A-->B\n```\n```mermaid\n" + huge + "\n```";
		await capturedHandler({ source: "user", text }, { hasUI: true, ui: { notify } });

		expect(notify).toHaveBeenCalledWith(
			expect.stringMatching(/Mermaid block 2 too large \(\d+ lines, \d+ chars\)\./),
			"warning",
		);
		// Only the first block renders.
		expect(mockPi.sendMessage).toHaveBeenCalledTimes(1);
	});

	it("notifies 'too large' and skips a block with > MAX_SOURCE_CHARS (line 524 char arm)", async () => {
		vi.resetModules();
		mockMermaidOk();
		vi.doMock("beautiful-mermaid", () => ({ renderMermaidAscii: vi.fn(() => "ASCII") }));
		const mod = await import("../index.ts?rb-toomanychars-" + Date.now());

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

		const notify = vi.fn();
		// Few lines but total length > 20000 chars.
		const longToken = "A" + "-->B".repeat(5000);
		const text = "```mermaid\ngraph TD\n  " + longToken + "\n```";
		await capturedHandler({ source: "user", text }, { hasUI: true, ui: { notify } });

		expect(notify).toHaveBeenCalledWith(
			expect.stringMatching(/Mermaid block 1 too large \(\d+ lines, \d+ chars\)\./),
			"warning",
		);
		expect(mockPi.sendMessage).not.toHaveBeenCalled();
	});

	it("notifies 'can't render type' for unsupported type (pie) (line 533)", async () => {
		vi.resetModules();
		mockMermaidOk();
		vi.doMock("beautiful-mermaid", () => ({ renderMermaidAscii: vi.fn(() => "ASCII") }));
		const mod = await import("../index.ts?rb-unsupp-" + Date.now());

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

		const notify = vi.fn();
		await capturedHandler(
			{ source: "user", text: "```mermaid\npie\n  \"A\": 50\n```" },
			{ hasUI: true, ui: { notify } },
		);
		expect(notify).toHaveBeenCalledWith(
			expect.stringContaining('can\'t render type "pie"'),
			"info",
		);
		expect(mockPi.sendMessage).not.toHaveBeenCalled();
	});

	it("notifies 'can't render type \"unknown\"' when a block has no type token (line 534 ?? \"unknown\")", async () => {
		vi.resetModules();
		mockMermaidOk();
		vi.doMock("beautiful-mermaid", () => ({ renderMermaidAscii: vi.fn(() => "ASCII") }));
		const mod = await import("../index.ts?rb-nottoken-" + Date.now());

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

		const notify = vi.fn();
		// A block whose only non-blank lines are comments -> getMermaidTypeToken
		// returns null -> `token ?? "unknown"` falls to "unknown".
		await capturedHandler(
			{ source: "user", text: "```mermaid\n%% only a comment\n```" },
			{ hasUI: true, ui: { notify } },
		);
		expect(notify).toHaveBeenCalledWith(
			expect.stringContaining('can\'t render type "unknown"'),
			"info",
		);
		expect(mockPi.sendMessage).not.toHaveBeenCalled();
	});

	it("relays per-block notifications from processBlock via notify (line 560 loop)", async () => {
		vi.resetModules();
		mockMermaidOk();
		// renderMermaidAscii throws for every preset -> processBlock emits a
		// "render failed" notification that renderBlocks must relay.
		vi.doMock("beautiful-mermaid", () => ({
			renderMermaidAscii: vi.fn(() => {
				throw new Error("render exploded");
			}),
		}));
		const mod = await import("../index.ts?rb-relay-" + Date.now());

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

		const notify = vi.fn();
		await capturedHandler(
			{ source: "user", text: "```mermaid\ngraph TD\n  A-->B\n```" },
			{ hasUI: true, ui: { notify } },
		);
		expect(notify).toHaveBeenCalledWith(
			expect.stringContaining("Mermaid render failed"),
			expect.any(String),
		);
		// A failed block still sends a message (with '[render failed]' ascii).
		expect(mockPi.sendMessage).toHaveBeenCalledTimes(1);
	});
});

describe("input event handler: extra branches", () => {
	it("returns continue when event.text is not a string (line 568 false arm)", async () => {
		vi.resetModules();
		mockMermaidOk();
		vi.doMock("beautiful-mermaid", () => ({ renderMermaidAscii: vi.fn(() => "ASCII") }));
		const mod = await import("../index.ts?in-nonstr-" + Date.now());

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

		const result = await capturedHandler(
			{ source: "user", text: undefined },
			{ hasUI: true, ui: { notify: vi.fn() } },
		);
		expect(result).toEqual({ action: "continue" });
		expect(mockPi.sendMessage).not.toHaveBeenCalled();
	});

	it("returns continue when text is an empty string (line 569)", async () => {
		vi.resetModules();
		mockMermaidOk();
		vi.doMock("beautiful-mermaid", () => ({ renderMermaidAscii: vi.fn(() => "ASCII") }));
		const mod = await import("../index.ts?in-empty-" + Date.now());

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

		const result = await capturedHandler(
			{ source: "user", text: "" },
			{ hasUI: true, ui: { notify: vi.fn() } },
		);
		expect(result).toEqual({ action: "continue" });
		expect(mockPi.sendMessage).not.toHaveBeenCalled();
	});

	it("renders multiple blocks with includeSourceInContext true (line 574 multi-block arm)", async () => {
		vi.resetModules();
		mockMermaidOk();
		vi.doMock("beautiful-mermaid", () => ({ renderMermaidAscii: vi.fn(() => "ASCII") }));
		const mod = await import("../index.ts?in-multi-" + Date.now());

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

		const text = "```mermaid\ngraph TD\n  A-->B\n```\n```mermaid\ngraph TD\n  C-->D\n```";
		await capturedHandler({ source: "user", text }, { hasUI: true, ui: { notify: vi.fn() } });
		expect(mockPi.sendMessage).toHaveBeenCalledTimes(2);
		// blocks.length > 1 -> includeSourceInContext true: content includes the
		// fenced mermaid source block with a hash header.
		const sent = mockPi.sendMessage.mock.calls[0][0];
		expect(sent.content).toContain("```mermaid");
		expect(sent.content).toContain("mermaid-hash:");
	});
});

describe("agent_end event handler: extra branches", () => {
	it("skips whitespace-only assistant messages to find the last non-empty one (line 584 break)", async () => {
		vi.resetModules();
		mockMermaidOk();
		vi.doMock("beautiful-mermaid", () => ({ renderMermaidAscii: vi.fn(() => "ASCII") }));
		const mod = await import("../index.ts?ae-skipws-" + Date.now());

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

		// Last assistant (index 2) is whitespace-only -> loop continues to
		// index 1 which has real mermaid text (line 584 false arm + break).
		await capturedHandler(
			{
				messages: [
					{ role: "assistant", content: "   " },
					{ role: "assistant", content: "```mermaid\ngraph TD\n  A-->B\n```" },
					{ role: "assistant", content: "   \n  " },
				],
			},
			{ hasUI: true, ui: { notify: vi.fn() } },
		);
		expect(mockPi.sendMessage).toHaveBeenCalledTimes(1);
	});

	it("returns early when assistant text has no mermaid blocks (line 590)", async () => {
		vi.resetModules();
		mockMermaidOk();
		vi.doMock("beautiful-mermaid", () => ({ renderMermaidAscii: vi.fn(() => "ASCII") }));
		const mod = await import("../index.ts?ae-nomerm-" + Date.now());

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

		await capturedHandler(
			{ messages: [{ role: "assistant", content: "Just plain text, no diagrams." }] },
			{ hasUI: true, ui: { notify: vi.fn() } },
		);
		expect(mockPi.sendMessage).not.toHaveBeenCalled();
	});
});

describe("pi-mermaid command handler: extra branches", () => {
	it("does not notify when ctx.hasUI is false and no assistant message (line 600 false arm)", async () => {
		vi.resetModules();
		mockMermaidOk();
		vi.doMock("beautiful-mermaid", () => ({ renderMermaidAscii: vi.fn(() => "ASCII") }));
		const mod = await import("../index.ts?cmd-nouifalse-" + Date.now());

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
			hasUI: false,
			sessionManager: { getBranch: () => [] },
		} as any;
		await expect(capturedCommand([], ctx)).resolves.toBeUndefined();
		expect(mockPi.sendMessage).not.toHaveBeenCalled();
	});

	it("notifies 'No mermaid blocks found' when assistant has no mermaid (line 605/606 true arm)", async () => {
		vi.resetModules();
		mockMermaidOk();
		vi.doMock("beautiful-mermaid", () => ({ renderMermaidAscii: vi.fn(() => "ASCII") }));
		const mod = await import("../index.ts?cmd-noblocks-" + Date.now());

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

		const notify = vi.fn();
		const ctx = {
			hasUI: true,
			ui: { notify },
			sessionManager: {
				getBranch: () => [{ type: "message", message: { role: "assistant", content: "no diagrams" } }],
			},
		} as any;
		await capturedCommand([], ctx);
		expect(notify).toHaveBeenCalledWith("No mermaid blocks found", "warning");
		expect(mockPi.sendMessage).not.toHaveBeenCalled();
	});

	it("does not notify 'No mermaid blocks found' when hasUI is false (line 606 false arm)", async () => {
		vi.resetModules();
		mockMermaidOk();
		vi.doMock("beautiful-mermaid", () => ({ renderMermaidAscii: vi.fn(() => "ASCII") }));
		const mod = await import("../index.ts?cmd-noblocks-noui-" + Date.now());

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
			hasUI: false,
			sessionManager: {
				getBranch: () => [{ type: "message", message: { role: "assistant", content: "no diagrams" } }],
			},
		} as any;
		await expect(capturedCommand([], ctx)).resolves.toBeUndefined();
		expect(mockPi.sendMessage).not.toHaveBeenCalled();
	});

	it("renders blocks on the happy path (line 610, includeSourceInContext default true)", async () => {
		vi.resetModules();
		mockMermaidOk();
		vi.doMock("beautiful-mermaid", () => ({ renderMermaidAscii: vi.fn(() => "ASCII") }));
		const mod = await import("../index.ts?cmd-happy-" + Date.now());

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
			sessionManager: {
				getBranch: () => [
					{ type: "message", message: { role: "user", content: "draw" } },
					{ type: "message", message: { role: "assistant", content: "```mermaid\ngraph TD\n  A-->B\n```" } },
				],
			},
		} as any;
		await capturedCommand([], ctx);
		expect(mockPi.sendMessage).toHaveBeenCalledTimes(1);
		const sent = mockPi.sendMessage.mock.calls[0][0];
		expect(sent.content).toContain("```mermaid");
		expect(sent.content).toContain("mermaid-hash:");
	});
});

