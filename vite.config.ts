import react from "@vitejs/plugin-react"
import { configDefaults, defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [react()],
  test: {
    // Live tests hit public RPCs; `pnpm test:live` runs them on purpose.
    exclude: process.env.LIVE
      ? configDefaults.exclude
      : [...configDefaults.exclude, "**/*.live.test.ts"],
  },
})
