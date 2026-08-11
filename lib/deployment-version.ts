export function gitShaMatches(deployedSha: string, expectedSha: string) {
  const deployed = deployedSha.trim().toLowerCase();
  const expected = expectedSha.trim().toLowerCase();
  return Boolean(deployed && expected) && (deployed.startsWith(expected) || expected.startsWith(deployed));
}
