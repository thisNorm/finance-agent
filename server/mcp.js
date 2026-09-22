import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createStore } from "./store.js";
const store = createStore();
const server = new McpServer({
  name: "personal-finance-agent",
  version: "0.1.0",
});
for (const [name, tool] of Object.entries(store.tools))
  server.registerTool(
    name,
    {
      description: tool.description,
      inputSchema: tool.schema,
      annotations: {
        readOnlyHint: ["get_overview", "compare_purchase"].includes(name),
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        return {
          content: [
            { type: "text", text: JSON.stringify(store.call(name, args)) },
          ],
        };
      } catch {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "입력값 또는 거래 상태를 확인하세요. 작업을 저장하지 않았습니다.",
            },
          ],
        };
      }
    },
  );
await server.connect(new StdioServerTransport());
process.on("SIGINT", async () => {
  await server.close();
  store.close();
  process.exit(0);
});
