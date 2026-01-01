import { join } from "path";
import { unlink } from "fs/promises";
import flagsConfig from "../flags.json";

async function exists(path: string): Promise<boolean> {
  return Bun.file(path).exists();
}

export interface FlagDefinition {
  name: string;
  description: string;
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

const FLAGS_DIR = process.env.FLAGS_DIR || "/var/lib/caddy/flags";

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

export async function getFlagStatus(flagId: string): Promise<boolean> {
  const path = join(FLAGS_DIR, flagId);
  return exists(path);
}

export async function setFlag(flagId: string, enabled: boolean): Promise<void> {
  if (!getFlagDefinition(flagId)) {
    throw new Error(`Unknown flag: ${flagId}`);
  }

  const path = join(FLAGS_DIR, flagId);
  if (enabled) {
    await Bun.write(path, "");
  } else {
    if (await exists(path)) {
      await unlink(path);
    }
  }
}

export async function getAllFlagsStatus(): Promise<Record<string, FlagStatus[]>> {
  const config = getConfig();
  const result: Record<string, FlagStatus[]> = {};

  for (const [serviceId, service] of Object.entries(config.services)) {
    const flags: FlagStatus[] = [];
    for (const [flagId, flag] of Object.entries(service.flags)) {
      flags.push({
        id: flagId,
        name: flag.name,
        description: flag.description,
        enabled: await getFlagStatus(flagId),
        service: serviceId,
      });
    }
    result[serviceId] = flags;
  }

  return result;
}
