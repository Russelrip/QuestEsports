const globals = require("globals");

module.exports = [
  {
    files: ["**/*.js"],
    ignores: ["src/generated/**", "node_modules/**"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: globals.node,
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", caughtErrors: "none" }],
      "no-unreachable": "error",
      "no-constant-condition": ["error", { checkLoops: false }],
    },
  },
];
