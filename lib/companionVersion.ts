type ParsedVersion = {
  core: [bigint, bigint, bigint];
  prerelease: string[] | null;
};

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function compareCompanionVersions(left: string, right: string): number | null {
  const leftVersion = parseVersion(left);
  const rightVersion = parseVersion(right);
  if (!leftVersion || !rightVersion) return null;

  for (let index = 0; index < leftVersion.core.length; index += 1) {
    const leftPart = leftVersion.core[index];
    const rightPart = rightVersion.core[index];
    if (leftPart > rightPart) return 1;
    if (leftPart < rightPart) return -1;
  }

  return comparePrerelease(leftVersion.prerelease, rightVersion.prerelease);
}

export function shouldOfferCompanionUpdate(
  latestVersion: string,
  installedVersion?: string,
): boolean {
  if (!parseVersion(latestVersion)) return false;
  if (!installedVersion) return true;
  const comparison = compareCompanionVersions(latestVersion, installedVersion);
  return comparison === null || comparison > 0;
}

function parseVersion(value: string): ParsedVersion | null {
  const match = SEMVER_PATTERN.exec(value.trim());
  if (!match) return null;

  const prerelease = match[4]?.split('.') ?? null;
  if (prerelease?.some((part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith('0'))) {
    return null;
  }

  return {
    core: [BigInt(match[1]), BigInt(match[2]), BigInt(match[3])],
    prerelease,
  };
}

function comparePrerelease(left: string[] | null, right: string[] | null): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;

  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;

    const leftIsNumeric = /^\d+$/.test(leftPart);
    const rightIsNumeric = /^\d+$/.test(rightPart);
    if (leftIsNumeric && rightIsNumeric) {
      return BigInt(leftPart) > BigInt(rightPart) ? 1 : -1;
    }
    if (leftIsNumeric) return -1;
    if (rightIsNumeric) return 1;
    return leftPart > rightPart ? 1 : -1;
  }
  return 0;
}
