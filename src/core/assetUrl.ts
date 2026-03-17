const stripLeadingSlashes = (value: string): string => value.replace(/^\/+/, '');

export const resolvePublicAssetUrl = (assetPath: string): string => {
  const normalizedPath = stripLeadingSlashes(assetPath);
  return `${import.meta.env.BASE_URL}${normalizedPath}`;
};
