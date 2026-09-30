# MCP Server Best Practices

## Quick reference

### Server naming
- **Python:** `{service}_mcp` (for example `slack_mcp`)
- **Node/TypeScript:** `{service}-mcp-server` (for example `slack-mcp-server`)

### Tool naming
- snake_case with a service prefix
- Format: `{service}_{action}_{resource}`
- Examples: `slack_send_message`, `github_create_issue`

### Response formats
- Support both JSON and Markdown
- JSON for programmatic processing
- Markdown for human readability

### Pagination
- Always respect the `limit` parameter
- Return `has_more`, `next_offset`, `total_count`
- Default to 20 to 50 items

### Transport
- **Streamable HTTP:** remote servers, several clients at once
- **stdio:** local integrations, command-line tools
- Avoid SSE (deprecated in favor of streamable HTTP)

---

## Server naming conventions

**Python:** `{service}_mcp`, lowercase with underscores. Examples: `slack_mcp`, `github_mcp`, `jira_mcp`.

**Node/TypeScript:** `{service}-mcp-server`, lowercase with hyphens. Examples: `slack-mcp-server`, `github-mcp-server`, `jira-mcp-server`.

The name should be general, descriptive of the service being integrated, easy to infer from the task description, and free of version numbers.

---

## Tool naming and design

### Tool naming

1. **Use snake_case:** `search_users`, `create_project`, `get_channel_info`.
2. **Include the service prefix.** Expect your server to be used next to other MCP servers:
   - `slack_send_message`, not just `send_message`
   - `github_create_issue`, not just `create_issue`
3. **Be action-oriented:** start with a verb (get, list, search, create).
4. **Be specific:** avoid generic names that could collide with other servers.

### Tool design

- A tool description must describe the functionality narrowly and unambiguously.
- The description must match what the tool actually does.
- Provide tool annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`).
- Keep each tool operation focused and atomic.

---

## Response formats

Every tool that returns data should support more than one format.

### JSON (`response_format="json"`)
- Machine-readable structured data.
- All available fields and metadata.
- Consistent field names and types.
- For programmatic processing.

### Markdown (`response_format="markdown"`, usually the default)
- Human-readable formatted text.
- Headers, lists, and formatting for clarity.
- Timestamps converted to a readable form.
- Display names shown with IDs in parentheses.
- Verbose metadata left out.

---

## Pagination

For tools that list resources:

- **Always respect the `limit` parameter.**
- **Implement pagination:** `offset` or cursor based.
- **Return pagination metadata:** `has_more`, `next_offset` or `next_cursor`, `total_count`.
- **Never load all results into memory,** which matters most for large datasets.
- **Default to reasonable limits:** 20 to 50 items is typical.

Example pagination response:

```json
{
  "total": 150,
  "count": 20,
  "offset": 0,
  "items": [],
  "has_more": true,
  "next_offset": 20
}
```

---

## Transport options

### Streamable HTTP

**Best for:** remote servers, web services, several clients at once.

**Characteristics:**
- Bidirectional communication over HTTP.
- Supports multiple simultaneous clients.
- Can be deployed as a web service.
- Allows server-to-client notifications.

**Use when** serving multiple clients, deploying as a cloud service, or integrating with web applications.

### stdio

**Best for:** local integrations and command-line tools.

**Characteristics:**
- Communication over standard input and output.
- Simple setup, no network configuration.
- Runs as a subprocess of the client.

**Use when** building tools for local development, integrating with desktop applications, or serving a single user in a single session.

**Note:** a stdio server must NOT log to standard output (it carries the protocol). Log to standard error.

### Transport selection

| Criterion | stdio | Streamable HTTP |
|-----------|-------|-----------------|
| **Deployment** | Local | Remote |
| **Clients** | Single | Multiple |
| **Complexity** | Low | Medium |
| **Real-time** | No | Yes |

---

## Security best practices

### Authentication and authorization

**OAuth 2.1:**
- Use secure OAuth 2.1 with certificates from recognized authorities.
- Validate access tokens before processing requests.
- Accept only tokens specifically intended for your server.

**API keys:**
- Read API keys from environment variables, never from code.
- Validate the key at server startup.
- Give a clear error message when authentication fails.

### Input validation

- Sanitize file paths to prevent directory traversal.
- Validate URLs and external identifiers.
- Check parameter sizes and ranges.
- Prevent command injection in system calls.
- Use schema validation (Pydantic or Zod) for all inputs.

### Error handling

- Do not expose internal errors to clients.
- Log security-relevant errors on the server side.
- Give helpful messages that do not reveal internals.
- Clean up resources after errors.

### DNS rebinding protection

For streamable HTTP servers running locally:
- Enable DNS rebinding protection.
- Validate the `Origin` header on all incoming connections.
- Bind to `127.0.0.1`, not `0.0.0.0`.

---

## Tool annotations

Annotations help clients understand how a tool behaves:

| Annotation | Type | Default | Description |
|-----------|------|---------|-------------|
| `readOnlyHint` | boolean | false | The tool does not modify its environment |
| `destructiveHint` | boolean | true | The tool may perform destructive updates |
| `idempotentHint` | boolean | false | Repeated calls with the same arguments have no additional effect |
| `openWorldHint` | boolean | true | The tool interacts with external entities |

**Important:** annotations are hints, not security guarantees. A client must not base a security-critical decision on annotations alone.

---

## Error handling

- Use the standard JSON-RPC error codes.
- Report tool errors inside the result object, not as protocol-level errors.
- Give helpful, specific messages with a suggested next step.
- Do not expose internal implementation details.
- Clean up resources properly on errors.

Example:

```typescript
try {
  const result = performOperation();
  return { content: [{ type: "text", text: result }] };
} catch (error) {
  return {
    isError: true,
    content: [{
      type: "text",
      text: `Error: ${error.message}. Try using filter='active_only' to reduce results.`
    }]
  };
}
```

---

## Testing requirements

Testing should cover:

- **Functional:** correct execution with valid and invalid inputs.
- **Integration:** interaction with the external system.
- **Security:** authentication, input sanitization, rate limiting.
- **Performance:** behavior under load, timeouts.
- **Error handling:** proper error reporting and cleanup.

---

## Documentation requirements

- Clear documentation of every tool and capability.
- Working examples (at least 3 per major feature).
- Security considerations.
- Required permissions and access levels.
- Rate limits and performance characteristics.
