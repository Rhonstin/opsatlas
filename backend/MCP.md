# OpsAtlas MCP Server

OpsAtlas exposes an MCP (Model Context Protocol) endpoint at `/mcp` so that AI agents can query your infrastructure data.

## Endpoint

```
POST/GET/DELETE /mcp
```

Streamable HTTP transport — the same Express server that serves the REST API.

## Authentication

The MCP endpoint accepts either:

1. **JWT token** — same as the web UI (cookie `opsatlas_token` or `Authorization: Bearer <token>`)
2. **API key** — via `X-API-Key` header (coming soon)

## Available Tools

| Tool | Description | Read/Write |
|------|-------------|------------|
| `list_instances` | List cloud instances (VMs, Cloud SQL, Coolify apps) with filters | Read |
| `get_instance` | Get detailed info about a specific instance | Read |
| `list_dns_records` | List DNS records with matched instances | Read |
| `list_connections` | List all cloud and DNS connections with status | Read |
| `get_connection_health` | Connection details, projects, recent sync runs | Read |
| `trigger_sync` | Start a background sync for a connection | Write |

### Tool Parameters

#### `list_instances`
- `provider` (optional): `gcp` | `aws` | `hetzner` | `coolify`
- `status` (optional): `RUNNING` | `STOPPED` | `TERMINATED` | `ERROR` | `PENDING`
- `resource_type` (optional): `compute` | `cloudsql` | `app`
- `tags` (optional): comma-separated tag names

#### `get_instance`
- `instance_id` (required): instance UUID

#### `list_dns_records`
- `zone` (optional): DNS zone name
- `type` (optional): `A` | `AAAA` | `CNAME` | `TXT` | `MX` | `SRV`
- `connection_id` (optional): DNS connection UUID

#### `get_connection_health`
- `connection_id` (required): cloud connection UUID

#### `trigger_sync`
- `connection_id` (required): cloud connection UUID

## Client Configuration

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "opsatlas": {
      "url": "http://localhost:4000/mcp",
      "headers": {
        "Authorization": "Bearer <your-jwt-token>"
      }
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "opsatlas": {
      "url": "http://localhost:4000/mcp",
      "headers": {
        "Authorization": "Bearer <your-jwt-token>"
      }
    }
  }
}
```

### MCP Inspector (testing)

```bash
npx @modelcontextprotocol/inspector http://localhost:4000/mcp
```

## Example Agent Prompts

Once connected, an agent can answer questions like:

- "What VMs are running in my Hetzner account?"
- "Which instances have domain names pointing to them?"
- "Show me all stopped instances that might be wasting money"
- "Sync my AWS connection and tell me what changed"
- "What DNS records point to 1.2.3.4?"
