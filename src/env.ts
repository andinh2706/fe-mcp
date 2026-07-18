/**
 * Centralized environment configuration.
 *
 * Every environment variable the server reads is parsed HERE, exactly once, at
 * module load — and exposed through the frozen `ENV` object. Nothing else in
 * the codebase should touch `process.env`; import `ENV` (and `LogLevel`) from
 * this file instead. This gives a single, typed, documented source of truth
 * for runtime configuration.
 *
 * ┌──────────────────┬──────────────┬───────────┬──────────────────────────────────────────────┐
 * │ Variable         │ ENV field    │ Default   │ Purpose                                        │
 * ├──────────────────┼──────────────┼───────────┼──────────────────────────────────────────────┤
 * │ CDP_HOST         │ CDP_HOST     │ 127.0.0.1 │ Host of Chrome's remote-debugging endpoint     │
 * │ CDP_PORT         │ CDP_PORT     │ 9999      │ Port of that endpoint (--remote-debugging-port)│
 * │ CDP_TARGET_URL   │ CDP_TARGET_URL│ null     │ URL substring to pick which tab to attach to   │
 * │ LOG_LEVEL        │ LOG_LEVEL    │ info      │ stderr log verbosity (debug/info/warn/error)   │
 * │ LOG_FILE         │ LOG_FILE     │ null      │ Optional path to also append logs to           │
 * │ LOG_TOOL_RESULTS │ LOG_TOOL_RESULTS│ false  │ Also log each tool's outcome (see logger.ts)   │
 * └──────────────────┴──────────────┴───────────┴──────────────────────────────────────────────┘
 */

/** stderr log verbosity levels, least to most severe. */
export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

/** Coerce an arbitrary env string to a valid LogLevel, defaulting to "info". */
function parseLogLevel(raw: string | undefined): LogLevel {
  return raw && (LOG_LEVELS as readonly string[]).includes(raw) ? (raw as LogLevel) : "info";
}

/** Coerce an env string to a boolean. Anything but 1/true/yes/on is false. */
function parseBool(raw: string | undefined): boolean {
  return raw !== undefined && ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

export interface Env {
  /** Host of Chrome's remote-debugging endpoint. */
  readonly CDP_HOST: string;
  /** Port of Chrome's remote-debugging endpoint (Chrome's `--remote-debugging-port`). */
  readonly CDP_PORT: number;
  /** URL substring used to select which page tab to attach to, or null for the first real page tab. */
  readonly CDP_TARGET_URL: string | null;
  /** stderr log verbosity. */
  readonly LOG_LEVEL: LogLevel;
  /** Optional file path to also append logs to, or null to skip file logging. */
  readonly LOG_FILE: string | null;
  /**
   * When true, every tool call also logs how it FINISHED (duration, ok/error,
   * result preview) — turning LOG_FILE into a full trace of an agent session.
   * Off by default: it is noisy, and results can contain page data. See logger.ts.
   */
  readonly LOG_TOOL_RESULTS: boolean;
}

/** The single, typed, read-only view of all runtime configuration. */
export const ENV: Env = Object.freeze({
  // Default to the IPv4 loopback, NOT "localhost": Chrome's remote-debugging
  // port binds only to 127.0.0.1, while "localhost" resolves to ::1 (IPv6)
  // first on many systems (e.g. Windows + Node 18+), causing ECONNREFUSED.
  CDP_HOST: process.env.CDP_HOST || "127.0.0.1",
  CDP_PORT: parseInt(process.env.CDP_PORT || "9999", 10),
  CDP_TARGET_URL: process.env.CDP_TARGET_URL || null,
  LOG_LEVEL: parseLogLevel(process.env.LOG_LEVEL),
  LOG_FILE: process.env.LOG_FILE || null,
  LOG_TOOL_RESULTS: parseBool(process.env.LOG_TOOL_RESULTS),
});
