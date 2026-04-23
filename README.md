# Kaltura MCP Server

An MCP server for the Kaltura media platform. Exposes tools for searching and inspecting media entries via the Kaltura API, usable from any MCP-compatible client (Claude Desktop, MCP Inspector, custom agents).

## Endpoint

```
POST https://<host>/mcp
```

The server uses the [Streamable HTTP transport](https://spec.modelcontextprotocol.io/specification/2025-03-26/basic/transports/#streamable-http). All tool calls go to `POST /mcp`. `GET /health` returns `{ status, version }`.

## Authentication

Every tool that calls the Kaltura API requires a **Kaltura Session (KS)**. Pass it either as a request header or directly as a tool parameter:

| Method | Value |
|---|---|
| Request header | `X-Kaltura-KS: <your-ks>` |
| Tool parameter | `ks: "<your-ks>"` (per-call, takes precedence) |

Optionally override the Kaltura service URL (defaults to `https://www.kaltura.com`):

```
X-Kaltura-URL: https://your-partner.kaltura.com
```

Generate a KS from the [Kaltura Management Console](https://kmc.kaltura.com) or via the Kaltura API `session.start` action.

## Tools

### `get_session_info`

Returns details about the current Kaltura session.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ks` | string | No | KS token. Falls back to `X-Kaltura-KS` header. |

**Returns:** partner ID, user ID, session type, expiry, privileges.

---

### `search_entries`

Searches Kaltura media entries using the eSearch unified search API. Searches across entry name, description, tags, metadata, captions, and transcripts.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `ks` | string | No | header | KS token. Falls back to `X-Kaltura-KS` header. |
| `search_term` | string | Yes | — | Term to search for. |
| `item_type` | number | No | `1` | `1` = exact, `2` = partial, `3` = starts_with |
| `page_size` | number | No | `10` | Results per page (max 100). |

**Returns:** `totalCount` and per-entry: `id`, `name`, `objectType`, `duration`, `plays`, `views`, `thumbnailUrl`, `matchedFields`, and `captionMatches` (with `line`, `startsAt`, `endsAt`, `language`) when captions matched.

## Connecting to Claude Desktop

Add the following to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "kaltura": {
      "type": "http",
      "url": "https://<your-railway-host>/mcp",
      "headers": {
        "X-Kaltura-KS": "<your-ks>"
      }
    }
  }
}
```

Config file locations:
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

## Local Development

```bash
npm install
npm run dev        # starts with --watch on port 3000
```

## Deployment

Deploys to [Railway](https://railway.com) via `railway.json`. Set the `PORT` environment variable if needed (Railway sets it automatically). The `/health` endpoint is used as the healthcheck.
