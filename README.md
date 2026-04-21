# MGT 575 — Simple MCP server demo

This repo is a minimal teaching example of a **Model Context Protocol (MCP)** server: one Node process that speaks **stdio** to the host (Cursor), advertises **tools**, and runs them when the model (or you) invokes them.

The implementation lives in **`mcp-demo-server/src/index.mjs`**.

## Server names (two different “names”)

| Where | Name | What it is |
|--------|------|------------|
| Cursor config | **`mgt575-demo`** | The key you choose under `mcpServers` in `mcp.json`. This is what you see in the Cursor MCP UI. |
| MCP protocol | **`mgt575-mcp-demo`** | The server’s `name` field in code (`new Server({ name: "mgt575-mcp-demo", ... })`). Useful for logs and debugging. |

Use **`mgt575-demo`** in Cursor unless you prefer another label; just keep the key and your config consistent.

## Prerequisites

- **Node.js** 18+ recommended (matches current `@modelcontextprotocol/sdk` usage).
- A **Google Gemini API key** ([Google AI Studio](https://aistudio.google.com/apikey)) in the environment as **`GEMINI_API_KEY`**.  
  All tools except **`ping`** call Gemini (directly or for images).

Optional:

- **`GEMINI_IMAGE_MODEL`** — overrides the default image model for `draw_image` (see comments in `index.mjs`).

## Install and run locally

```bash
cd mcp-demo-server
npm install
npm start
```

`npm start` runs the server on stdio. By itself it will look idle in the terminal; that is normal. To poke it interactively:

```bash
npm run inspect
```

This uses the official MCP Inspector so you can list tools and send test calls.

## Tools included (examples to copy from)

| Tool | Purpose |
|------|--------|
| `ping` | No API calls; returns JSON metadata (good first tool). |
| `ask_gemini` | Text question → Gemini text answer. |
| `eagle_eye` | Windows primary monitor screenshot + question → Gemini vision (privacy: screen pixels go to Google). |
| `draw_image` | Text prompt → Gemini image output → saves a file under a folder you pass in. |

The pattern in code is:

1. **`ListToolsRequestSchema`** — register each tool with `name`, `description`, and `inputSchema` (JSON Schema for arguments).
2. **`CallToolRequestSchema`** — branch on `request.params.name`, read `request.params.arguments`, return `{ content: [{ type: "text", text: "..." }] }` or set `isError: true` on failure.

To **add a tool**, duplicate that pattern: append an object to the `tools` array, then add a matching `if (name === "your_tool") { ... }` block in the call handler.

## Configure Cursor to use this server

Cursor loads MCP servers from an **`mcp.json`** file (exact location can vary by Cursor version; common places are **user-level** `~/.cursor/mcp.json` or **project-level** configuration under your project’s Cursor settings). In the JSON, merge an entry under **`mcpServers`** using the label **`mgt575-demo`**.

**Windows example** (adjust the path to your clone):

```json
{
  "mcpServers": {
    "mgt575-demo": {
      "command": "node",
      "args": [
        "C:/Users/YOU/path/to/lecture_21_mcp_server/test/mcp-demo-server/src/index.mjs"
      ],
      "env": {
        "GEMINI_API_KEY": "your_key_here"
      }
    }
  }
}
```

Notes for students:

- **`command`** must be on your `PATH` (here, `node`).
- **`args`** is the script path as a single string in an array (not the whole command in one string).
- Prefer **forward slashes** in paths on Windows inside JSON to avoid escaping backslashes.
- After saving, **restart Cursor** or reload MCP so it spawns a fresh server process.

The server does not load a `.env` file by itself; put secrets in the **`env`** block above or in your OS environment.

## Repo layout

```
test/
├── README.md                 ← this file
├── mcp.json                  ← optional local reference (your class may use a template)
└── mcp-demo-server/
    ├── package.json
    └── src/
        └── index.mjs         ← MCP server: tools + handlers
```

## Safety and teaching notes

- **`eagle_eye`** sends whatever is on screen to a cloud model; use only in settings where that is acceptable.
- **`draw_image`** writes files to disk; only use folders you intend to write to.
- Do not commit real API keys; use Cursor’s `env` block locally or secret management your course recommends.
