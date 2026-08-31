export class ZenProviderError extends Error {
  constructor(message: string) {
    super(redactZenSecrets(message));
    this.name = "ZenProviderError";
  }
}

export class ZenAuthenticationError extends ZenProviderError {
  constructor(message = "Zen authentication failed. Check OPENCODE_ZEN_API_KEY.") {
    super(message);
    this.name = "ZenAuthenticationError";
  }
}

export function redactZenSecrets(value: string, secretValues: string[] = []): string {
  let redacted = value;
  for (const secret of secretValues) {
    if (secret) redacted = redacted.replaceAll(secret, "[REDACTED]");
  }
  return redacted
    .replace(/(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/(api[_-]?key\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/(bearer\s+)[^\s,;]+/gi, "$1[REDACTED]");
}
