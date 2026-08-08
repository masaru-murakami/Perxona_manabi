# Connect Chat Bot — Function Tool Definition Specification

Applicable endpoints:

| Method  | Path                                     | Description                                               |
| ------- | ---------------------------------------- | --------------------------------------------------------- |
| `POST`  | `/api/v1/connect/chatbots`               | Create a chat bot; tools can be included at creation time |
| `PATCH` | `/api/v1/connect/chatbots/{chat_bot_id}` | Update a chat bot; tools can be replaced                  |
| `GET`   | `/api/v1/connect/chatbots/{chat_bot_id}` | Retrieve tools (credentials are masked)                   |

Authentication: `Authorization: Bearer <connect JWT>`.
The chat bot belongs to the caller's default organization.

---

## 1. How to pass the `tools` field

Both `create_chat_bot` and `update_chat_bot` use **`multipart/form-data`** (to also support `knowledge_file` uploads).

`tools` is a **form field** whose value is a **JSON string** — not a nested multipart structure:

```bash
curl -X POST https://<host>/api/v1/connect/chatbots \
  -H "Authorization: Bearer $CONNECT_JWT" \
  -F 'name=Support Bot' \
  -F 'custom_instructions=You are a helpful support agent.' \
  -F 'tools=[{"name":"weather_lookup","description":"Look up current weather for a city.","settings":{"request":{"method":"get","url":"https://api.example.com/v1/weather","query_params":{"type":"object","properties":{"city":{"type":"string","description":"City name in English"}},"required":["city"]}},"auth":{"secret_type":"api_key","api_key_header":"X-Api-Key","api_key_value":"sk-live-xxx"},"response":{"body_schema":{"type":"object","properties":{"temp_c":{"type":"number"}}}}}}]'
```

### Three semantics of `tools`

| How it's passed        | Meaning                                         |
| ---------------------- | ----------------------------------------------- |
| `tools` field omitted  | **No change** (at `create` time = no tools)     |
| `tools=[]`             | **Clear** all tools                             |
| `tools=[{...}, {...}]` | **Replace entirely** (not an incremental patch) |

> There is no API to update a single tool. You must send the complete list every time; the backend
> deletes the old `CallFunc` / `OutboundAPI` records and recreates them, so tool `id`s will change.

Errors:

- JSON parse failure → `400 INVALID_ARGUMENT`, `details` contains `tools is not valid JSON: ...`
- Schema validation failure → `400 INVALID_ARGUMENT`, `details` contains `tools failed validation: ...`

---

## 2. Structure of a single tool

```jsonc
{
  "name": "weather_lookup",            // required
  "description": "…",                  // optional, but strongly recommended
  "settings": {                        // required
    "request":  { … },                 // required
    "auth":     { … },                 // optional, defaults to no_auth
    "response": { … }                  // optional, defaults to {}
  }
}
```

### 2.1 `name`

| Rule       | Value                                                                                   |
| ---------- | --------------------------------------------------------------------------------------- |
| Type       | `string`                                                                                |
| Length     | 1–42 (must not be blank after trimming)                                                 |
| Uniqueness | Must not be duplicated within the same payload; otherwise `CONNECT_DUPLICATE_TOOL_NAME` |

**Strongly recommended: use only `[a-zA-Z0-9_-]`.** Before sending to the LLM, `name` is sanitized: any
character outside `[a-zA-Z0-9_-]` is replaced with `_` (due to OpenAI / Anthropic tool name restrictions).
Therefore `get.weather` and `get-weather` may collide after sanitization — the latter will be
**silently skipped** and that tool will not exist in the conversation.

> Storyboard call funcs conventionally use a `@` prefix; **Connect tools should not and must not
> include `@`** (a leading `@` will be stripped).

### 2.2 `description`

Free text that becomes the first paragraph of the tool description seen by the LLM. This is the
model's primary signal for deciding when to call the tool — write it clearly with the purpose and
trigger conditions.

If `response.body_schema` is set, it will be serialized and appended after the description:

```text
<description>

Expected response JSON structure:
{"type":"object","properties":{"temp_c":{"type":"number"}}}
```

---

## 3. `settings.request`

```jsonc
{
  "method": "get",                     // required
  "url": "https://api.example.com/v1/weather",   // required
  "headers":      { "X-Tenant": "acme" },        // optional, fixed values
  "query_params": { …JSON Schema… },              // optional, LLM-filled parameters
  "body":         { …JSON Schema… }               // optional, LLM-filled parameters
}
```

| Field          | Type             | Description                                                                               |
| -------------- | ---------------- | ----------------------------------------------------------------------------------------- |
| `method`       | enum             | `get` / `post` / `put` / `patch` / `delete` (lowercase)                                   |
| `url`          | string           | Must be a full `http://` or `https://` URL including the host                             |
| `headers`      | `dict[str, str]` | **Fixed values** sent as-is on every call (auth headers are produced by `auth`, not here) |
| `query_params` | JSON Schema      | Defines the query string parameters **filled by the LLM**                                 |
| `body`         | JSON Schema      | Defines the JSON body parameters **filled by the LLM**                                    |

### ⚠️ The most common mistake

`query_params` and `body` are **not "fixed values to send" — they are JSON Schemas for parameters**.
The backend compiles these schemas into LLM tool parameter definitions; the model fills in values at runtime.

```jsonc
// ✅ Correct: JSON Schema
"query_params": {
  "type": "object",
  "properties": {
    "city": { "type": "string", "description": "City name in English" },
    "days": { "type": "integer", "description": "Forecast days, 1-7" }
  },
  "required": ["city"]
}

// ❌ Wrong: treating it as fixed values
"query_params": { "city": "Taipei" }
```

The "wrong" example above will not throw an error — it will be interpreted as a simplified schema
format, turning `city` into a field **without a type definition**. The behavior is unpredictable;
don't do this.

For values that must be fixed (tenant id, API version, etc.), put them in **`headers`** or embed
them directly in the **`url` query string**.

### `body` only applies to methods that have a body

`body` is only compiled into parameters when `method` is `post` / `put` / `patch`. `body` for `get` / `delete` is ignored.

### When a schema is ignored

When `query_params` / `body` is `{}`, is not a dict, or contains no recognizable field definitions,
that parameter will not appear in the tool signature — the LLM will call the tool with no arguments.

### Supported JSON Schema formats

All three are accepted:

```jsonc
// Standard
{ "type": "object", "properties": { "city": { "type": "string" } }, "required": ["city"] }

// Omitting type
{ "properties": { "city": { "type": "string" } } }

// Simplified (fields placed at root)
{ "city": { "type": "string", "description": "City name" } }
```

The **standard format** is recommended — it has the clearest semantics.

`string` fields in `required` that don't specify `minLength` will automatically have `minLength: 1`
added by the backend, preventing the model from calling with an empty string.

---

## 4. `settings.auth`

Discriminated union, distinguished by `secret_type`. Defaults to `no_auth` when omitted.

```jsonc
// No authentication (default)
{ "secret_type": "no_auth" }

// API Key: placed in the specified header
{ "secret_type": "api_key", "api_key_header": "X-Api-Key", "api_key_value": "sk-live-xxx" }

// Bearer Token: sends Authorization: Bearer <token>
{ "secret_type": "bearer_token", "bearer_token": "eyJhbGci..." }
```

| `secret_type`  | Required fields                   | Constraints                    |
| -------------- | --------------------------------- | ------------------------------ |
| `no_auth`      | —                                 | —                              |
| `api_key`      | `api_key_header`, `api_key_value` | Both must be non-empty strings |
| `bearer_token` | `bearer_token`                    | Non-empty string               |

All variants use `extra="forbid"`: including fields that belong to a different `secret_type` will
cause an immediate validation failure. For example, specifying `secret_type: "no_auth"` alongside
`bearer_token` returns `400`.

Headers generated by `auth` will **override** any same-named header in `request.headers`.

---

## 5. `settings.response`

```jsonc
{
  "body_schema": {
    "type": "object",
    "properties": { "temp_c": { "type": "number" } },
  },
}
```

`body_schema` **is not validated** — it is only written into the tool description for the LLM to
see, so the model knows what the response looks like and how to reference its fields. The actual
response is passed back to the model as-is (parsed as JSON if possible, otherwise as plain text).

---

## 6. Runtime behavior and limitations

Things to be aware of when writing definitions:

| Item           | Behavior                                                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Timeout        | connect 10s / read 30s                                                                                                                       |
| Redirect       | **Not followed**. A 3xx response is treated as an error                                                                                      |
| Target address | Only hosts that resolve to a **public IP** are allowed. localhost, private subnets, and URLs with a literal IP are blocked (SSRF protection) |
| Non-2xx        | Treated as a tool error and fed back to the model                                                                                            |
| Build failure  | If a single tool cannot be compiled into an LLM tool, it is logged and **skipped**; other tools continue to work normally                    |

---

## 7. Differences when reading back tools

The `tools[]` returned by `GET /api/v1/connect/chatbots/{id}` is **not fully symmetric** with what was sent:

```jsonc
{
  "id": "01K7GW...",                   // system-generated; changes on every replace
  "name": "weather_lookup",
  "description": "…",
  "settings": {
    "request": {
      "method": "get",
      "url": "https://api.example.com/v1/weather",   // reconstructed as the full URL
      "headers": { … },
      "query_params": { …original JSON Schema… },
      "body": { …original JSON Schema… }
    },
    "auth": {
      "secret_type": "api_key",
      "api_key_header": "X-Api-Key",
      "api_key_value": "sk-l****"      // ← masked
    },
    "response": { "body_schema": { … } }
  }
}
```

- **Credentials are always masked** and cannot be retrieved. To rotate a key, re-send the complete `tools` definition.
- `id` is system-generated and is new on every replace — do not use it as an external identifier; use `name` instead.

---

## 8. Complete examples

### 8.1 GET + query params

```jsonc
{
  "name": "search_orders",
  "description": "Search a customer's orders by email. Use when the user asks about their order status or history.",
  "settings": {
    "request": {
      "method": "get",
      "url": "https://api.example.com/v1/orders",
      "headers": { "X-Tenant-Id": "acme" },
      "query_params": {
        "type": "object",
        "properties": {
          "email": {
            "type": "string",
            "description": "Customer email address",
          },
          "limit": {
            "type": "integer",
            "description": "Max results, default 10",
          },
        },
        "required": ["email"],
      },
    },
    "auth": { "secret_type": "bearer_token", "bearer_token": "eyJhbGci..." },
    "response": {
      "body_schema": {
        "type": "object",
        "properties": {
          "orders": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "id": { "type": "string" },
                "status": { "type": "string" },
                "total": { "type": "number" },
              },
            },
          },
        },
      },
    },
  },
}
```

### 8.2 POST + body

```jsonc
{
  "name": "create_ticket",
  "description": "Create a support ticket. Use only after the user has confirmed the summary of their issue.",
  "settings": {
    "request": {
      "method": "post",
      "url": "https://api.example.com/v1/tickets",
      "body": {
        "type": "object",
        "properties": {
          "subject": {
            "type": "string",
            "description": "One-line summary of the issue",
          },
          "detail": {
            "type": "string",
            "description": "Full description in the user's own words",
          },
          "priority": {
            "type": "string",
            "enum": ["low", "normal", "high"],
            "description": "Defaults to normal unless the user indicates urgency",
          },
        },
        "required": ["subject", "detail"],
      },
    },
    "auth": {
      "secret_type": "api_key",
      "api_key_header": "X-Api-Key",
      "api_key_value": "sk-live-xxx",
    },
    "response": {
      "body_schema": {
        "type": "object",
        "properties": { "ticket_id": { "type": "string" } },
      },
    },
  },
}
```

### 8.3 Tool with no parameters

```jsonc
{
  "name": "get_business_hours",
  "description": "Get the current business hours. Call this whenever the user asks when the store is open.",
  "settings": {
    "request": {
      "method": "get",
      "url": "https://api.example.com/v1/business-hours",
    },
  },
}
```

---

## 9. Checklist

Verify each item before defining a tool:

- [ ] `name` uses only `[a-zA-Z0-9_-]`, 1–42 characters, no duplicates in the list, no `@` prefix
- [ ] `description` explains **when to call** the tool, not just what the API does
- [ ] `query_params` / `body` are **JSON Schemas**, not fixed values
- [ ] Every parameter has a `description` so the model knows what to fill in
- [ ] Required parameters are listed in `required`
- [ ] Fixed values go in `headers` or directly in the `url`, not in the parameter schema
- [ ] `body` is only used with `post` / `put` / `patch`
- [ ] `url` is a full `https://` URL pointing to a publicly resolvable host
- [ ] The `auth` variant has all required fields and no fields from other variants
- [ ] When updating, the **complete** tools list is sent (this is a replace, not an incremental update)

---

## Appendix: Schema reference

| API field                   | Pydantic model                                                                                      |
| --------------------------- | --------------------------------------------------------------------------------------------------- |
| `tools[]`                   | `ConnectChatBotToolCreateData`                                                                      |
| `tools[].settings`          | `ConnectChatBotToolSettingsData`                                                                    |
| `tools[].settings.request`  | `ConnectChatBotToolRequestData`                                                                     |
| `tools[].settings.auth`     | `ConnectChatBotToolNoAuth` \| `ConnectChatBotToolAPIKeyAuth` \| `ConnectChatBotToolBearerTokenAuth` |
| `tools[].settings.response` | `ConnectChatBotToolResponseData`                                                                    |
