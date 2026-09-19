// Builders and shared fragments for the OpenAPI document.
const { env } = require("../../config/env");

const apiBaseUrl = env.API_PUBLIC_URL || `http://localhost:${env.PORT}`;

const createQueryParameter = (name, schema, description) => ({
  name,
  in: "query",
  schema,
  ...(description ? { description } : {}),
});

const createPathParameter = (name, schema) => ({
  name,
  in: "path",
  required: true,
  schema,
});

const createHeaderParameter = (
  name,
  schema,
  { required = false, description } = {},
) => ({
  name,
  in: "header",
  required,
  schema,
  ...(description ? { description } : {}),
});

const createResponse = (description) => ({ description });
const oauthProviderParameter = createPathParameter("provider", {
  type: "string",
  enum: ["google", "discord"],
});
const oauthRedirectResponse = (description) => ({
  description,
  headers: {
    Location: {
      required: true,
      schema: { type: "string", format: "uri-reference" },
    },
    "Set-Cookie": {
      required: true,
      schema: { type: "string" },
      description: "OAuth flow cookie or its expiry cookie; never a session cookie.",
    },
  },
});
const linkedProvidersSchema = {
  type: "array",
  items: {
    type: "object",
    required: ["provider", "linked"],
    properties: {
      provider: { type: "string", enum: ["google", "discord"] },
      linked: { type: "boolean" },
    },
  },
};
const linkedProvidersResponse = {
  description: "Current OAuth provider link state",
  content: {
    "application/json": {
      schema: {
        type: "object",
        required: ["success", "providers"],
        properties: {
          success: { type: "boolean", const: true },
          providers: linkedProvidersSchema,
        },
      },
    },
  },
};
const createOperation = (
  tag,
  summary,
  {
    authenticated = false,
    parameters = [],
    additionalResponses = {},
    permissionScopes = [],
    requiredGlobalRole,
    permissionDescription,
    description,
    requestBody,
  } = {},
) => ({
  tags: [tag],
  summary,
  ...(description
    ? { description }
    : permissionDescription
      ? { description: permissionDescription }
      : {}),
  parameters,
  ...(requestBody ? { requestBody } : {}),
  ...(permissionScopes.length ? { "x-required-permission-scopes": permissionScopes } : {}),
  ...(requiredGlobalRole ? { "x-required-global-role": requiredGlobalRole } : {}),
  ...(authenticated
    ? { security: [{ sessionCookie: [] }, { mobileBearer: [] }] }
    : {}),
  responses: {
    200: createResponse(summary),
    ...(authenticated
      ? { 401: createResponse("Authentication required") }
      : {}),
    ...(permissionScopes.length ? { 403: createResponse("Insufficient permission scope") } : {}),
    400: createResponse("Invalid request"),
    ...additionalResponses,
  },
});

const createListResponse = (tag, summary, parameters = []) => ({
  get: {
    tags: [tag],
    summary,
    parameters,
    responses: {
      200: createResponse(summary),
    },
  },
});

const pageParameter = createQueryParameter("page", {
  type: "integer",
  minimum: 1,
  default: 1,
});

const pageSizeParameter = createQueryParameter("pageSize", {
  type: "integer",
  minimum: 1,
  maximum: 50,
  default: 10,
});

const searchParameter = createQueryParameter("search", { type: "string" });

const idParameter = (name) => [createPathParameter(name, { type: "string" })];

const supportScreenshotItems = {
  type: "string",
  format: "binary",
  description: "JPEG, PNG, or WebP image only.",
};

const supportCreateRequestBody = {
  required: true,
  description: "JSON remains supported. Multipart requests may repeat screenshots up to three times.",
  content: {
    "application/json": {
      schema: {
        type: "object",
        required: ["subject", "body"],
        properties: {
          subject: { type: "string", maxLength: 160 },
          body: { type: "string", maxLength: 2000 },
        },
      },
    },
    "multipart/form-data": {
      schema: {
        type: "object",
        required: ["subject", "body"],
        properties: {
          subject: { type: "string", maxLength: 160 },
          body: { type: "string", maxLength: 2000 },
          screenshots: { type: "array", maxItems: 3, items: supportScreenshotItems },
        },
      },
    },
  },
};

const supportReplyRequestBody = {
  required: true,
  description: "JSON remains supported. Multipart requests may repeat screenshots up to three times.",
  content: {
    "application/json": {
      schema: {
        type: "object",
        required: ["body"],
        properties: { body: { type: "string", maxLength: 2000 } },
      },
    },
    "multipart/form-data": {
      schema: {
        type: "object",
        required: ["body"],
        properties: {
          body: { type: "string", maxLength: 2000 },
          screenshots: { type: "array", maxItems: 3, items: supportScreenshotItems },
        },
      },
    },
  },
};

module.exports = {
  apiBaseUrl,
  createQueryParameter,
  createPathParameter,
  createHeaderParameter,
  createResponse,
  oauthProviderParameter,
  oauthRedirectResponse,
  linkedProvidersSchema,
  linkedProvidersResponse,
  createOperation,
  createListResponse,
  pageParameter,
  pageSizeParameter,
  searchParameter,
  idParameter,
  supportScreenshotItems,
  supportCreateRequestBody,
  supportReplyRequestBody,
};
