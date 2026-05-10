import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		coverage: {
			provider: "v8",
			reporter: ["text", "text-summary", "lcov"],
			include: ["index.ts"],
			thresholds: {
				statements: 80,
				branches: 60,
				functions: 80,
				lines: 80,
			},
		},
	},
});
