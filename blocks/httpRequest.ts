import { AppBlock, events } from "@slflows/sdk/v1";

const httpRequest: AppBlock = {
  name: "HTTP Request",
  description: "Make an arbitrary HTTP request using an Azure access token",
  category: "HTTP",

  inputs: {
    default: {
      name: "HTTP Request",
      description: "Execute HTTP request with Azure authentication",
      config: {
        url: {
          name: "URL",
          description: "The complete URL to make the request to",
          type: "string",
          required: true,
        },
        method: {
          name: "HTTP Method",
          description: "HTTP method to use",
          type: {
            type: "string",
            enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
          },
          default: "GET",
          required: true,
        },
        serviceName: {
          name: "Service Name",
          description:
            "Azure service name for token selection (e.g., 'management', 'graph', 'storage')",
          type: "string",
          default: "management",
          required: true,
        },
        body: {
          name: "Request Body",
          description: "Request body content (for POST, PUT, PATCH methods)",
          type: "string",
          required: false,
        },
        bodyType: {
          name: "Body Type",
          description:
            "Content type for the request body (json, text, binary - binary expects base64-encoded string)",
          type: {
            type: "string",
            enum: ["json", "text", "binary"],
          },
          required: false,
        },
        headers: {
          name: "Additional Headers",
          description:
            'Additional HTTP headers as JSON object (e.g., {"x-custom-header": "value"})',
          type: {
            type: "object",
            additionalProperties: {
              type: "string",
            },
          },
          required: false,
        },
      },
      onEvent: async (input) => {
        const {
          url,
          method,
          serviceName,
          body,
          bodyType = "json",
          headers,
        } = input.event.inputConfig;

        try {
          // Get the access tokens from the app signals
          const accessTokens = input.app.signals.accessTokens;

          if (!accessTokens || typeof accessTokens !== "object") {
            throw new Error(
              "Access tokens not available. Make sure the Azure OIDC app is properly configured and tokens are generated.",
            );
          }

          const accessToken = accessTokens[serviceName];
          if (!accessToken) {
            const availableServices = Object.keys(accessTokens);
            throw new Error(
              `No access token found for service '${serviceName}'. Available services: ${availableServices.join(", ")}`,
            );
          }

          // Use provided headers directly
          const additionalHeaders = headers || {};

          // Prepare headers
          const requestHeaders: Record<string, string> = {
            Authorization: `Bearer ${accessToken}`,
            "Accept-Language": "",
            ...additionalHeaders,
          };

          // Set content type based on body type if body is provided
          if (body && !requestHeaders["Content-Type"]) {
            switch (bodyType) {
              case "json":
                requestHeaders["Content-Type"] = "application/json";
                break;
              case "text":
                requestHeaders["Content-Type"] = "text/plain";
                break;
              case "binary":
                requestHeaders["Content-Type"] = "application/octet-stream";
                break;
            }
          }

          // Prepare request body
          let requestBody: BodyInit | undefined;
          if (body && ["POST", "PUT", "PATCH"].includes(method.toUpperCase())) {
            if (bodyType === "json") {
              try {
                // Validate JSON if bodyType is json
                JSON.parse(body);
                requestBody = body;
              } catch (jsonError) {
                throw new Error(
                  `Invalid JSON body: ${jsonError instanceof Error ? jsonError.message : String(jsonError)}`,
                );
              }
            } else if (bodyType === "binary") {
              try {
                // Decode base64 string to binary data
                const binaryData = Uint8Array.from(atob(body), (c) =>
                  c.charCodeAt(0),
                );
                requestBody = binaryData.buffer;
              } catch (base64Error) {
                throw new Error(
                  `Invalid base64 binary body: ${base64Error instanceof Error ? base64Error.message : String(base64Error)}`,
                );
              }
            } else {
              requestBody = body;
            }
          }

          // Make the HTTP request
          const response = await fetch(url, {
            method: method.toUpperCase(),
            headers: requestHeaders,
            body: requestBody,
          });

          // Extract response headers
          const responseHeaders: Record<string, string> = {};
          response.headers.forEach((value, key) => {
            responseHeaders[key] = value;
          });

          // Get response body
          let responseBody: string;
          try {
            responseBody = await response.text();
          } catch (bodyError) {
            responseBody = `Failed to read response body: ${bodyError instanceof Error ? bodyError.message : String(bodyError)}`;
          }

          // Emit the response
          await events.emit({
            statusCode: response.status,
            statusText: response.statusText,
            headers: responseHeaders,
            body: responseBody,
            url: response.url,
            ok: response.ok,
          });
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          throw new Error(`HTTP request failed: ${errorMessage}`);
        }
      },
    },
  },

  outputs: {
    default: {
      name: "HTTP Response",
      description: "Response from the HTTP request",
      type: {
        type: "object",
        properties: {
          statusCode: {
            type: "number",
            description: "HTTP status code",
          },
          statusText: {
            type: "string",
            description: "HTTP status text",
          },
          headers: {
            type: "object",
            description: "Response headers",
            additionalProperties: {
              type: "string",
            },
          },
          body: {
            type: "string",
            description: "Response body as string",
          },
          url: {
            type: "string",
            description: "Final URL after redirects",
          },
          ok: {
            type: "boolean",
            description:
              "Whether the request was successful (status in 200-299 range)",
          },
        },
        required: ["statusCode", "statusText", "headers", "body", "url", "ok"],
      },
    },
  },
};

export default httpRequest;
