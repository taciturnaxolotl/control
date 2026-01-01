import { Database } from "bun:sqlite";

const DB_PATH = process.env.DATABASE_PATH || "./data/control.db";
const FLAGS_CONFIG_PATH = process.env.FLAGS_CONFIG || "./flags.json";

// Load flags config from file (path from env or default)
const flagsConfig = await Bun.file(FLAGS_CONFIG_PATH).json().catch(() => {
  // Fallback to local flags.json if FLAGS_CONFIG path doesn't exist
  return import("../flags.json").then(m => m.default);
});

// Initialize database
const db = new Database(DB_PATH, { create: true });
db.exec(`
  CREATE TABLE IF NOT EXISTS flags (
    id TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// Prepared statements for performance
const getFlag = db.prepare<{ enabled: number }, [string]>(
  "SELECT enabled FROM flags WHERE id = ?"
);
const setFlagStmt = db.prepare(
  `INSERT INTO flags (id, enabled, updated_at) VALUES (?, ?, datetime('now'))
   ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled, updated_at = datetime('now')`
);
const getAllFlags = db.prepare<{ id: string; enabled: number }, []>(
  "SELECT id, enabled FROM flags"
);

export interface FlagDefinition {
  name: string;
  description: string;
  paths: string[]; // The paths this flag blocks
  redact?: Record<string, string[]>; // path -> fields to strip from JSON
}

export interface ServiceDefinition {
  name: string;
  flags: Record<string, FlagDefinition>;
}

export interface FlagsConfig {
  services: Record<string, ServiceDefinition>;
}

export interface FlagStatus {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  service: string;
}

export function getConfig(): FlagsConfig {
  return flagsConfig as FlagsConfig;
}

export function getAllFlagIds(): string[] {
  const config = getConfig();
  const ids: string[] = [];
  for (const service of Object.values(config.services)) {
    for (const flagId of Object.keys(service.flags)) {
      ids.push(flagId);
    }
  }
  return ids;
}

export function getFlagDefinition(
  flagId: string
): { flag: FlagDefinition; serviceId: string; service: ServiceDefinition } | null {
  const config = getConfig();
  for (const [serviceId, service] of Object.entries(config.services)) {
    if (flagId in service.flags) {
      return { flag: service.flags[flagId], serviceId, service };
    }
  }
  return null;
}

export function getFlagStatus(flagId: string): boolean {
  const row = getFlag.get(flagId);
  return row?.enabled === 1;
}

export function setFlag(flagId: string, enabled: boolean): void {
  if (!getFlagDefinition(flagId)) {
    throw new Error(`Unknown flag: ${flagId}`);
  }
  setFlagStmt.run(flagId, enabled ? 1 : 0);
}

export function getAllFlagsStatus(): Record<string, FlagStatus[]> {
  const config = getConfig();
  const result: Record<string, FlagStatus[]> = {};

  // Get all current flag states from DB
  const dbFlags = new Map<string, boolean>();
  for (const row of getAllFlags.all()) {
    dbFlags.set(row.id, row.enabled === 1);
  }

  for (const [serviceId, service] of Object.entries(config.services)) {
    const flags: FlagStatus[] = [];
    for (const [flagId, flag] of Object.entries(service.flags)) {
      flags.push({
        id: flagId,
        name: flag.name,
        description: flag.description,
        enabled: dbFlags.get(flagId) ?? false,
        service: serviceId,
      });
    }
    result[serviceId] = flags;
  }

  return result;
}

// Match a path pattern against a request path (supports * wildcard for single segment)
function matchPath(pattern: string, path: string): boolean {
  if (!pattern.includes("*")) {
    return path === pattern || path.startsWith(pattern + "/") || path.startsWith(pattern + "?");
  }
  
  // Convert pattern to regex: * matches any single path segment
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape regex special chars except *
    .replace(/\*/g, "[^/]+"); // * matches one path segment
  
  const regex = new RegExp(`^${regexPattern}($|\\?|/)`);
  return regex.test(path);
}

// Check if a request should be blocked based on host and path
export function shouldBlock(host: string, path: string): boolean {
  const config = getConfig();

  for (const [serviceId, service] of Object.entries(config.services)) {
    // Check if this request matches a service
    if (!host.includes(serviceId) && !serviceId.includes(host)) {
      continue;
    }

    for (const [flagId, flag] of Object.entries(service.flags)) {
      // Check if flag is enabled (blocking)
      if (!getFlagStatus(flagId)) {
        continue;
      }

      // Check if any of the flag's paths match (supports * wildcard)
      for (const flagPath of flag.paths) {
        if (matchPath(flagPath, path)) {
          return true;
        }
      }
    }
  }

  return false;
}

// Get fields to redact from a JSON response based on host and path
export function getRedactions(host: string, path: string): string[] {
  const config = getConfig();
  const fields: string[] = [];

  for (const [serviceId, service] of Object.entries(config.services)) {
    if (!host.includes(serviceId) && !serviceId.includes(host)) {
      continue;
    }

    for (const [flagId, flag] of Object.entries(service.flags)) {
      if (!getFlagStatus(flagId)) {
        continue;
      }

      if (flag.redact) {
        for (const [redactPath, redactFields] of Object.entries(flag.redact)) {
          if (path === redactPath || path.startsWith(redactPath + "?")) {
            fields.push(...redactFields);
          }
        }
      }
    }
  }

  return fields;
}
