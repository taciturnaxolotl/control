import { Database } from "bun:sqlite";
import flagsConfig from "../flags.json";

const DB_PATH = process.env.DATABASE_PATH || "./data/control.db";

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
  path?: string; // The path this flag blocks (e.g., "/sse")
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

      // Check if the flag applies to this path
      const flagPath = flag.path || `/${flagId.split("-").pop()}`;
      if (path === flagPath || path.startsWith(flagPath + "/") || path.startsWith(flagPath + "?")) {
        return true;
      }
    }
  }

  return false;
}
