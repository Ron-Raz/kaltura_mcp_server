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
