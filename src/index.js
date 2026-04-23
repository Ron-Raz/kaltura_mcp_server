import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import http from "http";
import { createRequire } from "module";

const { version } = createRequire(import.meta.url)("../package.json");

const PORT = process.env.PORT || 3000;
const DEFAULT_KALTURA_URL = "https://www.kaltura.com";

function ksError() {
  return {
    content: [{ type: "text", text: "A Kaltura Session (KS) is required. Pass it via the X-Kaltura-KS request header." }],
    isError: true,
  };
}

async function callKalturaApi(kalturaUrl, service, action, params = {}) {
  const url = new URL(`/api_v3/service/${service}/action/${action}`, kalturaUrl);
  url.searchParams.set("format", "1");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url.toString());
  const data = await response.json();

  if (data?.objectType === "KalturaAPIException") {
    throw new Error(`Kaltura API error ${data.code}: ${data.message}`);
  }

  return data;
}

async function callKalturaApiPost(kalturaUrl, service, action, body) {
  const url = new URL(`/api_v3/service/${service}/action/${action}`, kalturaUrl);

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ format: 1, ...body }),
  });

  const data = await response.json();

  if (data?.objectType === "KalturaAPIException") {
    throw new Error(`Kaltura API error ${data.code}: ${data.message}`);
  }

  return data;
}

function createServer(ks, kalturaUrl) {
  const server = new McpServer({
    name: "kaltura-mcp-server",
    version,
  });

  server.tool(
    "hello_world",
    "Returns a friendly greeting",
    { name: z.string().optional().describe("Name to greet") },
    async ({ name }) => ({
      content: [{ type: "text", text: `Hello, ${name ?? "World"}! This MCP server is running.` }],
    })
  );

  server.tool(
    "get_session_info",
    "Returns information about the current Kaltura session (partner ID, user, type, expiry, privileges)",
    { ks: z.string().optional().describe("Kaltura Session token. Falls back to the X-Kaltura-KS request header if omitted.") },
    async ({ ks: ksParam }) => {
      const resolvedKs = ksParam ?? ks;
      if (!resolvedKs) return ksError();
      try {
        const data = await callKalturaApi(kalturaUrl, "session", "get", { ks: resolvedKs });
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: err.message }], isError: true };
      }
    }
  );

  server.tool(
    "search_entries",
    "Search Kaltura media entries using the eSearch unified search API. Searches across all entry fields including metadata, captions, and transcripts. Returns entry details and highlighted matches with caption timestamps.",
    {
      ks: z.string().optional().describe("Kaltura Session token. Falls back to the X-Kaltura-KS request header if omitted."),
      search_term: z.string().describe("Term to search for across all entry fields (name, description, captions, metadata, etc.)"),
      item_type: z.number().int().min(1).max(3).optional().describe("Match type: 1=exact match (default), 2=partial, 3=starts_with"),
      page_size: z.number().int().min(1).max(100).optional().describe("Number of results to return (default 10)"),
    },
    async ({ ks: ksParam, search_term, item_type = 1, page_size = 10 }) => {
      const resolvedKs = ksParam ?? ks;
      if (!resolvedKs) return ksError();
      try {
        const data = await callKalturaApiPost(kalturaUrl, "elasticsearch_esearch", "searchEntry", {
          ks: resolvedKs,
          searchParams: {
            objectType: "KalturaESearchEntryParams",
            searchOperator: {
              objectType: "KalturaESearchEntryOperator",
              operator: 1,
              searchItems: [
                {
                  objectType: "KalturaESearchUnifiedItem",
                  searchTerm: search_term,
                  itemType: item_type,
                  addHighlight: true,
                },
              ],
            },
          },
          pager: {
            objectType: "KalturaFilterPager",
            pageSize: page_size,
            pageIndex: 1,
          },
        });

        const totalCount = data.totalCount ?? 0;
        const results = (data.objects ?? []).map((obj) => {
          const entry = obj.object ?? {};
          const highlights = obj.highlights ?? [];

          const matchedFields = [...new Set(highlights.map((h) => h.fieldName).filter(Boolean))];

          const captionMatches = highlights
            .filter((h) => h.fieldName?.toLowerCase().includes("caption"))
            .flatMap((h) =>
              (h.hits ?? []).map((hit) => ({
                text: hit.value,
                ...(hit.externalTimestamp != null && { timestamp_ms: hit.externalTimestamp }),
              }))
            );

          return {
            id: entry.id,
            name: entry.name,
            objectType: entry.objectType,
            duration: entry.duration,
            plays: entry.plays,
            views: entry.views,
            thumbnailUrl: entry.thumbnailUrl,
            matchedFields,
            ...(captionMatches.length > 0 && { captionMatches }),
          };
        });

        return {
          content: [{ type: "text", text: JSON.stringify({ totalCount, results }, null, 2) }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: err.message }], isError: true };
      }
    }
  );

  return server;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Expose-Headers": "*",
};

const httpServer = http.createServer(async (req, res) => {
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    res.setHeader(key, value);
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", version }));
    return;
  }

  const pathname = new URL(req.url, "http://localhost").pathname;

  if (pathname !== "/mcp") {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const ks = req.headers["x-kaltura-ks"] ?? null;
  const kalturaUrl = (req.headers["x-kaltura-url"] ?? DEFAULT_KALTURA_URL).replace(/\/$/, "");

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  });

  const mcpServer = createServer(ks, kalturaUrl);

  res.on("close", () => {
    transport.close();
    mcpServer.close();
  });

  await mcpServer.connect(transport);
  await transport.handleRequest(req, res);
});

httpServer.listen(PORT, () => {
  console.log(`MCP server listening on port ${PORT}`);
  console.log(`Endpoint: http://localhost:${PORT}/mcp`);
});
