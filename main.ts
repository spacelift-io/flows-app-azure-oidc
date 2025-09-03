import {
  defineApp,
  http,
  kv,
  lifecycle,
  AppInput,
  AppLifecycleCallbackOutput,
  AppOnHTTPRequestInput,
} from "@slflows/sdk/v1";
import { ClientAssertionCredential } from "@azure/identity";

// Key value store keys
const KV_KEYS = {
  ACCESS_TOKENS: "accessTokens",
  EXPIRES_AT: "expiresAt",
  CONFIG_CHECKSUM: "configChecksum",
  PRIVATE_KEY: "privateKey",
  PUBLIC_KEY: "publicKey",
  KEY_ID: "keyId",
};

// Constants
const REFRESH_BUFFER_SECONDS = 600; // Refresh 10 minutes before expiration
const KEY_SIZE = 2048; // RSA key size
const ALGORITHM = "RS256"; // JWT algorithm

export const app = defineApp({
  name: "Azure OIDC",

  signals: {
    accessTokens: {
      name: "Azure Access Tokens",
      description: "Map of service names to Azure AD access tokens",
      sensitive: true,
    },
    expiresAt: {
      name: "Token Expiration",
      description: "Unix timestamp (milliseconds) when tokens expire",
    },
  },

  installationInstructions: `This Azure OIDC app uses federated identity credentials for passwordless authentication with Azure AD. Follow these steps in order:

## Setup Process

### Step 1. Create Azure App Registration First
   - Go to **Azure Portal** → **Microsoft Entra ID** (formerly Azure Active Directory) → **App registrations**
   - Click **"New registration"**
   - **Name**: Choose a descriptive name (e.g., "My Flows Azure OIDC App")
   - **Supported account types**: Select based on your needs (usually "Accounts in this organizational directory only")
   - **Redirect URI**: Leave blank
   - Click **"Register"**

### Step 2. Note Required Information
   - **Application (client) ID**: Copy from the app registration overview page
   - **Directory (tenant) ID**: Copy from the app registration overview page
   - Keep this information handy for step 5

### Step 3. Install and Configure This App
   - Install this Flows app in your workspace
   - Enter the values you noted in step 2:
     - **Azure Tenant ID**: Your Directory (tenant) ID
     - **Application (Client) ID**: Your Application (client) ID
     - **Services**: Optional, defaults to \`["management"]\` (list of Azure services to get tokens for)
     - **Token Audience**: Optional, defaults to \`api://AzureADTokenExchange\` (must match federated credential audience)
     - **Azure Setup Complete**: **Leave as false** - you'll set this to true after completing Azure federated credential setup
   - Click **"Save"**
   - The app will show as "in_progress" until setup is complete

### Step 4. Configure Federated Identity Credential
   - Return to your Azure app registration
   - Go to **"Certificates & secrets"** in the left sidebar
   - Click the **"Federated credentials"** tab
   - Click **"Add credential"**
   - **Federated credential scenario**: Select **"Other issuer"**
   - **Issuer**: Set to <copyable>\`{appEndpointUrl}\`</copyable>
   - **Subject identifier**: Set to <copyable>\`{appEndpointHost}\`</copyable>
   - **Audience**: Set to <copyable>\`api://AzureADTokenExchange\`</copyable> (or match your custom audience setting)
   - **Name**: Give it a descriptive name (e.g., "Flows OIDC Credential")
   - **Description**: Optional description for your reference
   - Click **"Add"**

### Step 5. Configure API Permissions
   - Still in your Azure app registration, go to **"API permissions"**
   - Click **"Add a permission"**
   - Select **"Microsoft Graph"**
   - Choose **"Application permissions"** (required for this service-to-service authentication)
   - Add the specific permissions your flows need.
   - **Important**: Click **"Grant admin consent"** for your organization (admin required)

### Step 6. Complete App Configuration
   - **Wait 1-2 minutes** for Azure changes to propagate (eventual consistency)
   - Return to this Flows app configuration
   - Set **Azure Setup Complete** to **true** (this tells the app that Azure setup is complete)
   - Click **"Save"**

### Step 7. Verify Setup
   - The app should now show as "ready" status
   - Check the app signals to confirm access tokens are being generated
   - Tokens will automatically refresh before expiration

## Usage
- The app exposes an \`accessTokens\` signal containing a map of service names to Azure AD access tokens
- Use tokens in HTTP requests to the corresponding Azure APIs (e.g., \`ref("signal.$installationName.accessTokens").management\` for ARM APIs)
- Available services: management, graph, storage, keyvault, etc.
- Tokens include all permissions granted to your app registration for each service
- Tokens are automatically refreshed before expiration`,

  config: {
    clientId: {
      name: "Application (client) ID",
      description: "Application ID from Azure app registration",
      type: "string",
      required: true,
    },
    tenantId: {
      name: "Directory (tenant) ID",
      description: "Your Azure AD tenant identifier",
      type: "string",
      required: true,
    },
    services: {
      name: "Services",
      description:
        "Array of Azure services to get tokens for (e.g., ['management', 'graph', 'storage'])",
      type: ["string"],
      default: ["management"],
      required: true,
    },
    azureSetupComplete: {
      name: "Azure Setup Complete",
      description:
        "Set to true after completing Azure app registration and federated credential setup",
      type: "boolean",
      required: true,
      default: false,
    },
    audience: {
      name: "Token Audience",
      description:
        "The audience claim for the OIDC token (default: 'api://AzureADTokenExchange')",
      type: "string",
      required: false,
    },
  },

  async onSync(input: AppInput): Promise<AppLifecycleCallbackOutput> {
    try {
      const config = input.app.config;

      // Check if we need to generate keys for OIDC
      await ensureKeyPair();

      // Check if Azure setup has been completed
      if (!config.azureSetupComplete) {
        return {
          newStatus: "in_progress",
          customStatusDescription:
            "Waiting for Azure setup to be completed. Please complete Azure app registration and federated credential setup, then set 'Azure Setup Complete' to true.",
        };
      }

      // Check if token needs refresh
      const needsRefresh = await shouldRefreshToken(config);

      if (!needsRefresh) {
        // Token still valid, no update needed
        return { newStatus: "ready" };
      }

      // Generate new tokens
      const newTokens = await generateAccessTokens(config, input.app.http.url);

      return {
        newStatus: "ready",
        signalUpdates: {
          accessTokens: newTokens.accessTokens,
          expiresAt: newTokens.expiresAt,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error("Failed to sync Azure OIDC app: ", errorMessage);

      return {
        newStatus: "failed",
        customStatusDescription: `Azure sync failed: ${errorMessage}`,
      };
    }
  },

  http: {
    async onRequest(input: AppOnHTTPRequestInput): Promise<void> {
      const requestPath = input.request.path;

      try {
        if (requestPath === "/.well-known/openid-configuration") {
          // OIDC discovery endpoint
          const response = await handleOidcDiscovery(input.app.http.url);
          await http.respond(input.request.requestId, response);
        } else if (requestPath === "/.well-known/jwks") {
          // JWKS endpoint
          const response = await handleJwks();
          await http.respond(input.request.requestId, response);
        } else {
          await http.respond(input.request.requestId, {
            statusCode: 404,
            body: { error: "Endpoint not found" },
          });
        }
      } catch (error) {
        console.error("HTTP request failed: ", error);
        await http.respond(input.request.requestId, {
          statusCode: 500,
          body: { error: "Internal server error" },
        });
      }
    },
  },

  schedules: {
    "refresh-token": {
      description:
        "Refreshes Azure access token (Azure tokens expire after 60-90 minutes)",
      customizable: false,
      definition: {
        type: "frequency",
        frequency: {
          interval: 10,
          unit: "minutes",
        },
      },
      async onTrigger() {
        try {
          const { value: expiresAt } = await kv.app.get(KV_KEYS.EXPIRES_AT);

          if (!expiresAt) {
            await lifecycle.sync();
            return;
          }

          const now = Date.now();
          const refreshThreshold = now + REFRESH_BUFFER_SECONDS * 1000;

          if (expiresAt < refreshThreshold) {
            await lifecycle.sync();
          }
        } catch (error) {
          console.error("Error in token refresh schedule: ", error);
        }
      },
    },
  },

  blocks: {},
});

// Helper Functions

async function ensureKeyPair(): Promise<void> {
  // Check if all key components exist
  const [{ value: privateKey }, { value: publicKey }, { value: keyId }] =
    await kv.app.getMany([
      KV_KEYS.PRIVATE_KEY,
      KV_KEYS.PUBLIC_KEY,
      KV_KEYS.KEY_ID,
    ]);

  // Only generate keys if any component is missing
  if (!privateKey || !publicKey || !keyId) {
    // Generate RSA key pair
    const keyPair = await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: KEY_SIZE,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    );

    // Export keys
    const privateKeyJwk = await crypto.subtle.exportKey(
      "jwk",
      keyPair.privateKey,
    );
    const publicKeyJwk = await crypto.subtle.exportKey(
      "jwk",
      keyPair.publicKey,
    );

    // Generate stable key ID
    const newKeyId = crypto.randomUUID();

    // Store keys atomically
    await kv.app.setMany([
      { key: KV_KEYS.PRIVATE_KEY, value: privateKeyJwk },
      { key: KV_KEYS.PUBLIC_KEY, value: publicKeyJwk },
      { key: KV_KEYS.KEY_ID, value: newKeyId },
    ]);
  }
}

async function shouldRefreshToken(config: any): Promise<boolean> {
  const [{ value: expiresAt }, { value: previousChecksum }] =
    await kv.app.getMany([KV_KEYS.EXPIRES_AT, KV_KEYS.CONFIG_CHECKSUM]);

  // Check if config changed
  const currentChecksum = await generateChecksum(config);
  const configChanged =
    !previousChecksum || currentChecksum !== previousChecksum;

  // Check if token expired or close to expiring
  const now = Date.now();
  const refreshThreshold = now + REFRESH_BUFFER_SECONDS * 1000;
  const needsRefresh = !expiresAt || expiresAt < refreshThreshold;

  // Refresh if config changed or expiring soon
  return configChanged || needsRefresh;
}

async function generateAccessTokens(config: any, appUrl: string) {
  try {
    // Use federated identity with client assertion (OIDC token)
    const credential = new ClientAssertionCredential(
      config.tenantId,
      config.clientId,
      async () => {
        // Generate a fresh OIDC token for each request
        return await createOidcToken(appUrl, config);
      },
    );

    // Get services list, default to ["management"]
    const services = config.services || ["management"];
    const accessTokens: Record<string, string> = {};
    let earliestExpiry = Number.MAX_SAFE_INTEGER;

    // Generate token for each service
    for (const service of services) {
      const scope = `https://${service}.azure.com/.default`;
      const tokenResponse = await credential.getToken(scope);

      if (!tokenResponse) {
        throw new Error(
          `Failed to obtain access token for ${service} from Azure`,
        );
      }

      accessTokens[service] = tokenResponse.token;
      earliestExpiry = Math.min(
        earliestExpiry,
        tokenResponse.expiresOnTimestamp,
      );
    }

    // Store tokens and config checksum
    const configChecksum = await generateChecksum(config);
    await kv.app.setMany([
      { key: KV_KEYS.ACCESS_TOKENS, value: accessTokens },
      { key: KV_KEYS.EXPIRES_AT, value: earliestExpiry },
      { key: KV_KEYS.CONFIG_CHECKSUM, value: configChecksum },
    ]);

    return {
      accessTokens: accessTokens,
      expiresAt: earliestExpiry,
    };
  } catch (error) {
    console.error(
      "Azure tokens generation failed: ",
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
}

async function createOidcToken(appUrl: string, config: any): Promise<string> {
  const { value: privateKeyJwk } = await kv.app.get(KV_KEYS.PRIVATE_KEY);
  const { value: keyId } = await kv.app.get(KV_KEYS.KEY_ID);

  if (!privateKeyJwk || !keyId) {
    throw new Error("Private key or key ID not found");
  }

  // Import private key
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    privateKeyJwk,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["sign"],
  );

  // Create JWT header
  const header = {
    alg: ALGORITHM,
    typ: "JWT",
    kid: keyId,
  };

  const appHostname = new URL(appUrl).hostname;
  const audience = config.audience || "api://AzureADTokenExchange";

  // Create JWT payload
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: appUrl,
    sub: appHostname,
    aud: audience,
    exp: now + 300, // Token expires in 5 minutes
    iat: now,
    nbf: now,
    jti: crypto.randomUUID(),
  };

  // Encode header and payload
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));

  // Create signature
  const signatureData = `${encodedHeader}.${encodedPayload}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(signatureData),
  );

  const encodedSignature = base64UrlEncode(signature);

  return `${signatureData}.${encodedSignature}`;
}

async function handleOidcDiscovery(appUrl: string) {
  const discoveryDoc = {
    issuer: appUrl,
    jwks_uri: `${appUrl}/.well-known/jwks`,
    response_types_supported: ["id_token"],
    subject_types_supported: ["pairwise", "public"],
    id_token_signing_alg_values_supported: [ALGORITHM],
    claims_supported: ["sub", "aud", "exp", "iat", "iss", "jti", "nbf"],
  };

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: discoveryDoc,
  };
}

async function handleJwks() {
  const { value: publicKeyJwk } = await kv.app.get(KV_KEYS.PUBLIC_KEY);
  const { value: keyId } = await kv.app.get(KV_KEYS.KEY_ID);

  if (!publicKeyJwk || !keyId) {
    throw new Error("Public key or key ID not found");
  }

  const jwks = {
    keys: [
      {
        kid: keyId,
        kty: "RSA",
        n: publicKeyJwk.n,
        e: publicKeyJwk.e,
      },
    ],
  };

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: jwks,
  };
}

function base64UrlEncode(data: string | ArrayBuffer): string {
  let base64: string;

  if (typeof data === "string") {
    base64 = btoa(data);
  } else {
    base64 = btoa(String.fromCharCode(...new Uint8Array(data)));
  }

  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function generateChecksum(obj: any): Promise<string> {
  const configString = JSON.stringify(obj);
  const buffer = new TextEncoder().encode(configString);
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);

  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
