# Azure OIDC App

A Flows app that provides Azure AD access tokens using OIDC federated identity credentials for passwordless authentication.

## Overview

This app enables secure integration with Microsoft Azure services by:

- **Passwordless Authentication**: Uses OIDC federated identity instead of client secrets
- **Automatic Token Management**: Handles token generation, refresh, and expiration
- **Microsoft Graph Integration**: Provides access tokens for Microsoft Graph and other Azure APIs
- **Signal-Based Architecture**: Exposes tokens as signals for consumption by other Flows entities

## Features

### Core Capabilities

- ✅ **OIDC Federated Identity**: Self-issued JWT tokens for Azure authentication
- ✅ **Automatic Token Refresh**: Tokens refreshed automatically before expiration
- ✅ **OIDC Discovery Endpoints**: Provides `.well-known/openid-configuration` and JWKS endpoints
- ✅ **Configurable Scopes**: Support for custom Microsoft Graph permissions
- ✅ **Secure Key Management**: RSA-2048 key pairs stored securely in app KV store

### Security

- ✅ **No Client Secrets**: Eliminates secret rotation and management overhead
- ✅ **Short-Lived Tokens**: Azure-managed token lifetime (60-90 minutes)
- ✅ **Audience Validation**: Configurable audience for federated credential matching
- ✅ **Sensitive Data Handling**: Access tokens marked as sensitive signals

## Configuration

| Field                       | Description                               | Required | Default                        |
| --------------------------- | ----------------------------------------- | -------- | ------------------------------ |
| **Application (Client) ID** | App registration client ID                | ✅       | -                              |
| **Directory (Tenant) ID**   | Your Azure AD tenant identifier           | ✅       | -                              |
| **Services**                | Array of Azure services to get tokens for | ✅       | `["management"]`               |
| **Azure Setup Complete**    | Set to true after Azure setup is done     | ✅       | `false`                        |
| **Token Audience**          | OIDC token audience claim                 | ❌       | `"api://AzureADTokenExchange"` |

## Signals

| Signal         | Type                 | Description                           |
| -------------- | -------------------- | ------------------------------------- |
| `accessTokens` | `object` (sensitive) | Map of service names to access tokens |
| `expiresAt`    | `number`             | Unix timestamp when tokens expire     |

## Blocks

### HTTP Request

Make arbitrary HTTP requests to Azure APIs using the managed access tokens.

**Inputs:**

- `url` - Complete URL to make the request to
- `method` - HTTP method (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS)
- `serviceName` - Azure service token to use (e.g., 'management', 'graph', 'storage')
- `body` - Request body content (for POST/PUT/PATCH methods)
- `bodyType` - Content type: json, text, or binary (base64-encoded)
- `headers` - Additional HTTP headers as object

**Outputs:**

- `statusCode` - HTTP response status code
- `statusText` - HTTP response status message
- `headers` - Response headers object
- `body` - Response body as string
- `url` - Final URL after redirects
- `ok` - Boolean indicating success (200-299 range)

### Using Access Tokens in Other Blocks

Access tokens are also available as signals for use in other flows:

```javascript
// Reference management token
ref("signal.azureOidc.accessTokens").management;

// Reference graph token
ref("signal.azureOidc.accessTokens").graph;
```

## Setup Guide

Complete setup instructions are provided within the app's installation guide. The process involves:

1. **Create Azure App Registration** - Set up app in Azure Portal
2. **Note Required Information** - Copy tenant ID and client ID
3. **Install and Configure App** - Enter Azure details, leave setup incomplete
4. **Configure Federated Identity** - Link Azure to this app's OIDC endpoint
5. **Set API Permissions** - Grant required Microsoft Graph permissions
6. **Complete Setup** - Set "Azure Setup Complete" to true
7. **Verify Setup** - Confirm token generation and refresh

### Common Services

Configure the `Services` array to request tokens for different Azure services:

| Service      | Description                 | Token Scope                     |
| ------------ | --------------------------- | ------------------------------- |
| `management` | Azure Resource Manager APIs | `https://management.azure.com/` |
| `graph`      | Microsoft Graph API         | `https://graph.microsoft.com/`  |
| `storage`    | Azure Storage APIs          | `https://storage.azure.com/`    |
| `keyvault`   | Azure Key Vault APIs        | `https://vault.azure.net/`      |

## Architecture

```text
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Flows App     │    │   Azure AD       │    │ Microsoft Graph │
│                 │    │                  │    │                 │
│ 1. Generate JWT ├────► 2. Validate OIDC ├────► 3. API Access   │
│ 2. Request Token│    │ 3. Issue Token   │    │                 │
│ 3. Refresh Auto │    │                  │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

### Token Flow

1. **Key Generation**: App generates RSA key pair on first run
2. **OIDC Token**: App creates self-signed JWT with proper claims
3. **Azure Validation**: Azure validates JWT against federated credential
4. **Access Token**: Azure issues access token with requested scopes
5. **Auto Refresh**: App monitors expiration and refreshes proactively

## OIDC Endpoints

The app exposes standard OIDC discovery endpoints:

- `/.well-known/openid-configuration` - OIDC discovery document
- `/.well-known/jwks` - JSON Web Key Set for token validation

These endpoints are used by Azure to validate the federated identity relationship.
