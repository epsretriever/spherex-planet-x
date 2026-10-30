import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTs,
  {
    ignores: [".next/**", "node_modules/**", "e2e/.generated/**", "playwright-report/**", "test-results/**", "test-results-real/**", "playwright-report-real/**", "lighthouse-reports/**", "next-env.d.ts"],
  },
];

export default config;
