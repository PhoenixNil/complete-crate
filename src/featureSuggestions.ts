export function getSuggestedFeatures(
  featureNames: readonly string[],
  featurePrefix: string,
  selectedFeatures: readonly string[]
): string[] {
  const selected = new Set(selectedFeatures);

  return featureNames.filter((featureName) => {
    if (selected.has(featureName)) {
      return false;
    }

    if (featurePrefix.length === 0) {
      return true;
    }

    return featureName.startsWith(featurePrefix);
  });
}
