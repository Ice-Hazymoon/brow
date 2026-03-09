import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { CACHE_DIR } from "./config";

const DEFAULT_TTL = 24 * 60 * 60 * 1000; // 24h

export async function cachedFetch<T>(
  url: string,
  key: string,
  ttl = DEFAULT_TTL
): Promise<T> {
  mkdirSync(CACHE_DIR, { recursive: true });
  const path = join(CACHE_DIR, `${key}.json`);

  if (existsSync(path)) {
    const age = Date.now() - statSync(path).mtimeMs;
    if (age < ttl) {
      return JSON.parse(readFileSync(path, "utf-8"));
    }
  }

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Fetch ${url} failed: ${resp.status}`);
  const data = await resp.json();
  writeFileSync(path, JSON.stringify(data));
  return data as T;
}

export async function cachedFetchAll<T>(
  buildUrl: (offset: number) => string,
  key: string,
  pageSize = 100,
  ttl = DEFAULT_TTL
): Promise<T[]> {
  mkdirSync(CACHE_DIR, { recursive: true });
  const path = join(CACHE_DIR, `${key}.json`);

  if (existsSync(path)) {
    const age = Date.now() - statSync(path).mtimeMs;
    if (age < ttl) {
      return JSON.parse(readFileSync(path, "utf-8"));
    }
  }

  const all: T[] = [];
  let offset = 0;
  while (true) {
    const resp = await fetch(buildUrl(offset));
    if (!resp.ok) break;
    const data = await resp.json();
    if (!Array.isArray(data) || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }

  writeFileSync(path, JSON.stringify(all));
  return all;
}
