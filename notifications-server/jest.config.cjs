module.exports = {
  testEnvironment: "node",
  testMatch: ["<rootDir>/test/**/*.spec.js"],
  collectCoverage: true,
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "json"],
};
