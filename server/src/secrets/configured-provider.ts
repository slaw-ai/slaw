import { SECRET_PROVIDERS, type SecretProvider } from "@slaw/shared";

export function getConfiguredSecretProvider(): SecretProvider {
  const configuredProvider = process.env.SLAW_SECRETS_PROVIDER;
  return configuredProvider && SECRET_PROVIDERS.includes(configuredProvider as SecretProvider)
    ? configuredProvider as SecretProvider
    : "local_encrypted";
}
