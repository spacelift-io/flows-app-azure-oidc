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

| Field                       | Description                           | Required | Default                                    |
| --------------------------- | ------------------------------------- | -------- | ------------------------------------------ |
| **Application (Client) ID** | App registration client ID            | ✅       | -                                          |
| **Directory (Tenant) ID**   | Your Azure AD tenant identifier       | ✅       | -                                          |
| **Azure Setup Complete**    | Set to true after Azure setup is done | ✅       | `false`                                    |
| **Token Scopes**            | Array of scopes to request            | ❌       | `["https://graph.microsoft.com/.default"]` |
| **Token Audience**          | OIDC token audience claim             | ❌       | `"api://AzureADTokenExchange"`             |

## Signals

| Signal        | Type                 | Description                         |
| ------------- | -------------------- | ----------------------------------- |
| `accessToken` | `string` (sensitive) | Azure AD access token for API calls |
| `expiresAt`   | `number`             | Unix timestamp when token expires   |

## Setup Guide

Complete setup instructions are provided within the app's installation guide. The process involves:

1. **Create Azure App Registration** - Set up app in Azure Portal
2. **Note Required Information** - Copy tenant ID and client ID
3. **Install and Configure App** - Enter Azure details, leave setup incomplete
4. **Configure Federated Identity** - Link Azure to this app's OIDC endpoint
5. **Set API Permissions** - Grant required Microsoft Graph permissions
6. **Complete Setup** - Set "Azure Setup Complete" to true
7. **Verify Setup** - Confirm token generation and refresh

### Common Scopes

| Scope                                                | Description                 |
| ---------------------------------------------------- | --------------------------- |
| `["https://graph.microsoft.com/.default"]`           | Use all granted permissions |
| `["https://graph.microsoft.com/User.Read"]`          | Read user profile           |
| `["https://graph.microsoft.com/User.Read.All"]`      | Read all user profiles      |
| `["https://graph.microsoft.com/Group.Read.All"]`     | Read all groups             |
| `["https://graph.microsoft.com/Directory.Read.All"]` | Read directory data         |

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
