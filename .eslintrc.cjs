module.exports = {
  root: true,
  env: { es2022: true, node: true, jest: true },
  parserOptions: { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true } },
  plugins: ["react", "react-hooks", "import"],
  extends: ["eslint:recommended", "plugin:react-hooks/recommended"],
  globals: {
    __DEV__: "readonly", fetch: "readonly", FormData: "readonly", Headers: "readonly",
    Request: "readonly", Response: "readonly", AbortController: "readonly",
    URL: "readonly", URLSearchParams: "readonly", requestAnimationFrame: "readonly",
    cancelAnimationFrame: "readonly", window: "readonly", document: "readonly",
    navigator: "readonly", alert: "readonly",
  },
  // Audit correctness; leave legacy formatting and unused-import cleanup to
  // independent changes. Hook dependency warnings remain visible for review.
  rules: {
    "no-unused-vars": "off",
    // These legacy idioms are intentional and covered by contracts; retain
    // the security-relevant undefined-name/async-executor/hook checks.
    "no-empty": ["error", { allowEmptyCatch: true }],
    "no-control-regex": "off", // Input sanitizers explicitly remove control characters.
    "no-regex-spaces": "off", // Swift indentation fixtures match literal spaces.
    "no-useless-catch": "off",
    "no-ex-assign": "off", // Attendance replaces a positively classified error.
  },
  ignorePatterns: ["node_modules/", "ios/", "android/", ".git-rewrite/", ".expo/", ".claude/", "build/", "dist/"],
};
