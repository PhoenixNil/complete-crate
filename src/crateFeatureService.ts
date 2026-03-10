import semver from "semver";
import { httpGet as defaultHttpGet } from "./httpClient";

export interface SparseIndexVersionRecord {
  vers: string;
  yanked?: boolean;
  features?: Record<string, string[]>;
  features2?: Record<string, string[]>;
}

export type HttpGet = (url: string, maxRedirects?: number) => Promise<Buffer>;
export interface FeatureServiceLogger {
  warn(message: string): void;
}

interface ParsedCargoVersion {
  major: number;
  minor?: number;
  patch?: number;
  prerelease?: string;
  build?: string;
}

const DEFAULT_SPARSE_INDEX_BASE_URL = "https://index.crates.io";

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function parseCargoVersion(versionText: string): ParsedCargoVersion | null {
  const match = versionText.trim().match(
    /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/
  );
  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: match[2] === undefined ? undefined : Number(match[2]),
    patch: match[3] === undefined ? undefined : Number(match[3]),
    prerelease: match[4],
    build: match[5],
  };
}

function formatCargoVersion(
  version: ParsedCargoVersion,
  includePrerelease = true
): string {
  const minor = version.minor ?? 0;
  const patch = version.patch ?? 0;
  let output = `${version.major}.${minor}.${patch}`;

  if (includePrerelease && version.prerelease) {
    output += `-${version.prerelease}`;
  }

  if (includePrerelease && version.build) {
    output += `+${version.build}`;
  }

  return output;
}

function getCaretUpperBound(version: ParsedCargoVersion): string {
  const minor = version.minor ?? 0;
  const patch = version.patch ?? 0;

  if (version.major > 0) {
    return `${version.major + 1}.0.0-0`;
  }

  if (minor > 0) {
    return `0.${minor + 1}.0-0`;
  }

  return `0.0.${patch + 1}-0`;
}

function getTildeUpperBound(version: ParsedCargoVersion): string {
  if (version.minor === undefined) {
    return `${version.major + 1}.0.0-0`;
  }

  return `${version.major}.${version.minor + 1}.0-0`;
}

function parseWildcardRange(requirement: string): string | null {
  const parts = requirement
    .trim()
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return null;
  }

  const wildcardIndex = parts.findIndex((part) => /^[xX*]$/.test(part));
  if (wildcardIndex === -1) {
    return null;
  }

  if (wildcardIndex === 0) {
    return "*";
  }

  const major = Number(parts[0]);
  if (!Number.isFinite(major)) {
    return null;
  }

  if (wildcardIndex === 1) {
    return `>=${major}.0.0 <${major + 1}.0.0-0`;
  }

  const minor = Number(parts[1]);
  if (!Number.isFinite(minor)) {
    return null;
  }

  return `>=${major}.${minor}.0 <${major}.${minor + 1}.0-0`;
}

function convertSingleCargoRequirement(requirement: string): string | null {
  const trimmed = requirement.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed === "*") {
    return "*";
  }

  if (/[xX*]/.test(trimmed)) {
    return parseWildcardRange(trimmed);
  }

  const operatorMatch = trimmed.match(/^(>=|<=|>|<|=|\^|~)(.+)$/);
  const operator = operatorMatch?.[1] ?? "^";
  const versionText = (operatorMatch?.[2] ?? trimmed).trim();
  const version = parseCargoVersion(versionText);
  if (!version) {
    return null;
  }

  const normalizedVersion = formatCargoVersion(version);

  switch (operator) {
    case "=":
      return normalizedVersion;
    case ">":
    case ">=":
    case "<":
    case "<=":
      return `${operator}${normalizedVersion}`;
    case "~":
      return `>=${normalizedVersion} <${getTildeUpperBound(version)}`;
    case "^":
      return `>=${normalizedVersion} <${getCaretUpperBound(version)}`;
    default:
      return null;
  }
}

export function cargoRequirementToSemverRange(
  requirement: string
): string | null {
  const parts = requirement
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return null;
  }

  const convertedParts = parts.map(convertSingleCargoRequirement);
  if (convertedParts.some((part) => part === null)) {
    return null;
  }

  return convertedParts.join(" ");
}

export function resolveVersionRecord(
  records: SparseIndexVersionRecord[],
  requirement: string
): SparseIndexVersionRecord | null {
  const semverRange = cargoRequirementToSemverRange(requirement);
  if (!semverRange) {
    return null;
  }

  const compatibleRecords = records
    .filter((record) => !record.yanked)
    .filter((record) => semver.valid(record.vers))
    .filter((record) =>
      semver.satisfies(record.vers, semverRange, {
        includePrerelease: false,
      })
    )
    .sort((left, right) => semver.rcompare(left.vers, right.vers));

  return compatibleRecords[0] ?? null;
}

export function getFeatureNames(record: SparseIndexVersionRecord): string[] {
  const names = new Set<string>();

  for (const source of [record.features, record.features2]) {
    if (!source) {
      continue;
    }

    for (const name of Object.keys(source)) {
      names.add(name);
    }
  }

  return Array.from(names).sort((left, right) => left.localeCompare(right));
}

export function getSparseIndexPath(crateName: string): string {
  const normalizedName = crateName.toLowerCase();

  if (normalizedName.length === 1) {
    return `1/${normalizedName}`;
  }

  if (normalizedName.length === 2) {
    return `2/${normalizedName}`;
  }

  if (normalizedName.length === 3) {
    return `3/${normalizedName.charAt(0)}/${normalizedName}`;
  }

  return `${normalizedName.slice(0, 2)}/${normalizedName.slice(2, 4)}/${normalizedName}`;
}

export class CrateFeatureService {
  private readonly crateCache = new Map<string, SparseIndexVersionRecord[] | null>();
  private readonly crateRequests = new Map<
    string,
    Promise<SparseIndexVersionRecord[] | null>
  >();
  private readonly featureCache = new Map<string, string[] | null>();
  private readonly normalizedBaseUrl: string;

  constructor(
    private readonly httpGet: HttpGet = defaultHttpGet,
    sparseIndexBaseUrl: string = DEFAULT_SPARSE_INDEX_BASE_URL,
    private readonly logger: FeatureServiceLogger = console
  ) {
    this.normalizedBaseUrl = normalizeBaseUrl(sparseIndexBaseUrl);
  }

  async getFeatures(
    crateName: string,
    versionRequirement: string
  ): Promise<string[] | null> {
    const normalizedName = crateName.trim().toLowerCase();
    if (normalizedName.length === 0 || versionRequirement.trim().length === 0) {
      return null;
    }

    const records = await this.getCrateRecords(normalizedName);
    if (!records) {
      return null;
    }

    const resolvedRecord = resolveVersionRecord(records, versionRequirement);
    if (!resolvedRecord) {
      return null;
    }

    const cacheKey = `${normalizedName}@${resolvedRecord.vers}`;
    if (this.featureCache.has(cacheKey)) {
      return this.featureCache.get(cacheKey) ?? null;
    }

    const features = getFeatureNames(resolvedRecord);
    this.featureCache.set(cacheKey, features);
    return features;
  }

  private async getCrateRecords(
    crateName: string
  ): Promise<SparseIndexVersionRecord[] | null> {
    if (this.crateCache.has(crateName)) {
      return this.crateCache.get(crateName) ?? null;
    }

    const inFlightRequest = this.crateRequests.get(crateName);
    if (inFlightRequest) {
      return inFlightRequest;
    }

    const request = this.fetchCrateRecords(crateName)
      .then((records) => {
        this.crateCache.set(crateName, records);
        return records;
      })
      .catch((error: Error) => {
        this.logger.warn(
          `CrateLite: failed to load features for ${crateName}: ${error.message}`
        );
        return null;
      })
      .finally(() => {
        this.crateRequests.delete(crateName);
      });

    this.crateRequests.set(crateName, request);
    return request;
  }

  private async fetchCrateRecords(
    crateName: string
  ): Promise<SparseIndexVersionRecord[] | null> {
    const url = `${this.normalizedBaseUrl}/${getSparseIndexPath(crateName)}`;
    const buffer = await this.httpGet(url);
    const content = buffer.toString("utf-8");
    const records: SparseIndexVersionRecord[] = [];

    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }

      const record = JSON.parse(trimmed) as SparseIndexVersionRecord;
      if (typeof record.vers !== "string") {
        continue;
      }

      records.push(record);
    }

    return records;
  }
}
