#!/usr/bin/env node
/**
 * MGT 575 — minimal MCP server (stdio) for teaching.
 *
 * Env: GEMINI_API_KEY (Google AI Studio / Gemini API)
 *
 * Tools:
 *   ping          — no external services; good first tool
 *   ask_gemini    — text → Gemini (simple LLM tool pattern)
 *   eagle_eye     — primary monitor screenshot + query → Gemini vision
 *   draw_image    — text prompt → Gemini native image model → saves PNG/JPEG to a folder you choose
 *
 * Env (image): GEMINI_IMAGE_MODEL optional (default gemini-3.1-flash-image-preview). Same GEMINI_API_KEY.
 *
 * Cursor: add to ~/.cursor/mcp.json (merge into mcpServers):
 *   "mgt575-demo": {
 *     "command": "node",
 *     "args": ["FULL_PATH_TO/test/mcp-demo-server/src/index.mjs"],
 *     "env": { "GEMINI_API_KEY": "your_key_here" }
 *   }
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleGenAI, Modality } from "@google/genai";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

function getGeminiModel() {
  const key = process.env.GEMINI_API_KEY;
  if (!key?.trim()) {
    throw new Error("Missing GEMINI_API_KEY in environment.");
  }
  const gen = new GoogleGenerativeAI(key.trim());
  return gen.getGenerativeModel({ model: "gemini-2.0-flash" });
}

function getGenAiClient() {
  const key = process.env.GEMINI_API_KEY;
  if (!key?.trim()) {
    throw new Error("Missing GEMINI_API_KEY in environment.");
  }
  return new GoogleGenAI({ apiKey: key.trim() });
}

const DEFAULT_IMAGE_MODEL = "gemini-3.1-flash-image-preview";

function extForMime(mime) {
  const m = (mime || "").toLowerCase();
  if (m.includes("jpeg")) return ".jpg";
  if (m.includes("webp")) return ".webp";
  return ".png";
}

/** Walk candidates for first image/* inlineData (Gemini native image output). */
function extractFirstImageFromResponse(response) {
  const cands = response?.candidates ?? [];
  for (const c of cands) {
    const parts = c?.content?.parts ?? [];
    for (const p of parts) {
      const id = p?.inlineData;
      if (id?.data && typeof id.data === "string" && id.mimeType?.startsWith("image/")) {
        return { data: id.data, mimeType: id.mimeType };
      }
    }
  }
  return null;
}

async function drawImageToFolder({ prompt, folder: folderArg, filename: filenameArg }) {
  const folder = path.resolve(String(folderArg || "").trim());
  await fs.mkdir(folder, { recursive: true });

  const model = (process.env.GEMINI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL).trim();
  const ai = getGenAiClient();
  const response = await ai.models.generateContent({
    model,
    contents: String(prompt).trim(),
    config: {
      responseModalities: [Modality.TEXT, Modality.IMAGE],
    },
  });

  const img = extractFirstImageFromResponse(response);
  if (!img) {
    const note = typeof response?.text === "string" ? response.text : "";
    throw new Error(
      "Model returned no image part. Try a different prompt or GEMINI_IMAGE_MODEL. Model text (if any): " +
        String(note).slice(0, 500)
    );
  }

  let base = filenameArg ? path.basename(String(filenameArg).trim()) : "";
  if (!base) {
    base = `draw_${Date.now()}${extForMime(img.mimeType)}`;
  } else if (!path.extname(base)) {
    base += extForMime(img.mimeType);
  }

  const outPath = path.join(folder, base);
  const buf = Buffer.from(img.data, "base64");
  await fs.writeFile(outPath, buf);
  return { outPath, mimeType: img.mimeType, model };
}

/** Windows: capture primary screen as PNG bytes via PowerShell (no native npm addons). */
async function capturePrimaryScreenPng() {
  if (process.platform !== "win32") {
    throw new Error(
      "eagle_eye: screenshot path is implemented for Windows only in this demo. " +
        "On macOS, swap in `screencapture -x /tmp/s.png` + readFile; on Linux, try `grim` or `import`."
    );
  }
  const psOneLiner = [
    "Add-Type -AssemblyName System.Windows.Forms,System.Drawing;",
    "$b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds;",
    "$bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height;",
    "$g=[System.Drawing.Graphics]::FromImage($bmp);",
    "$g.CopyFromScreen($b.Location,[System.Drawing.Point]::new(0,0),$b.Size);",
    "$ms=New-Object System.IO.MemoryStream;",
    "$bmp.Save($ms,[System.Drawing.Imaging.ImageFormat]::Png);",
    "[Convert]::ToBase64String($ms.ToArray())",
  ].join(" ");
  const { stdout } = await execFileP(
    "powershell.exe",
    ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", psOneLiner],
    { maxBuffer: 80 * 1024 * 1024, windowsHide: true, encoding: "utf8" }
  );
  const b64 = stdout.trim().replace(/\r|\n/g, "");
  return Buffer.from(b64, "base64");
}

const server = new Server(
  { name: "mgt575-mcp-demo", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "ping",
      description: "Health check: returns pong and server metadata (no network).",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: "ask_gemini",
      description: "Ask Gemini a plain-text question (good second tool before vision).",
      inputSchema: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description: "Question for Gemini",
          },
        },
        required: ["question"],
        additionalProperties: false,
      },
    },
    {
      name: "eagle_eye",
      description:
        "Captures the primary monitor, sends the screenshot + your question to Gemini, returns its answer. " +
        "Privacy: anything visible on screen is sent to Google. Teaching use only.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "What you want inferred from the current screen (e.g. summarize this slide, read the error).",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
    {
      name: "draw_image",
      description:
        "Generates an image from a text prompt using Gemini native image output (default model: gemini-3.1-flash-image-preview). " +
        "Writes a PNG/JPEG/WebP file into the folder you specify (folder is created if needed). " +
        "Override model with env GEMINI_IMAGE_MODEL. Teaching: discuss ToS, watermarks, and prompt injection.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "What to draw (be specific: style, subject, lighting).",
          },
          folder: {
            type: "string",
            description: "Absolute or relative directory path where the image file will be saved.",
          },
          filename: {
            type: "string",
            description:
              "Optional file name only (e.g. rooster.png). If omitted, uses draw_<timestamp>.<ext>. If no extension, .png/.jpg is inferred from the response.",
          },
        },
        required: ["prompt", "folder"],
        additionalProperties: false,
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const args = request.params.arguments ?? {};

  try {
    if (name === "ping") {
      const text = JSON.stringify(
        {
          pong: true,
          time: new Date().toISOString(),
          cwd: process.cwd(),
          node: process.version,
          platform: process.platform,
        },
        null,
        2
      );
      return { content: [{ type: "text", text }] };
    }

    if (name === "ask_gemini") {
      const q = String(args.question ?? "").trim();
      if (!q) throw new Error("question is required");
      const model = getGeminiModel();
      const res = await model.generateContent(q);
      const text = res.response.text();
      return { content: [{ type: "text", text }] };
    }

    if (name === "eagle_eye") {
      const query = String(args.query ?? "").trim();
      if (!query) throw new Error("query is required");
      const png = await capturePrimaryScreenPng();
      const b64 = png.toString("base64");
      const model = getGeminiModel();
      const instruction =
        "You are helping a student during class. They sent a screenshot of their primary monitor. " +
        "Answer their question using only what is reasonably visible in the image. " +
        "If text is blurry or missing, say so briefly. Be concise.";
      const res = await model.generateContent([
        { text: instruction },
        { text: `User question:\n${query}` },
        { inlineData: { mimeType: "image/png", data: b64 } },
      ]);
      const text = res.response.text();
      return { content: [{ type: "text", text }] };
    }

    if (name === "draw_image") {
      const prompt = String(args.prompt ?? "").trim();
      const folder = String(args.folder ?? "").trim();
      const filename = args.filename != null ? String(args.filename) : "";
      if (!prompt) throw new Error("prompt is required");
      if (!folder) throw new Error("folder is required");
      const { outPath, mimeType, model } = await drawImageToFolder({
        prompt,
        folder,
        filename,
      });
      const text = JSON.stringify(
        {
          savedTo: outPath,
          mimeType,
          model,
        },
        null,
        2
      );
      return { content: [{ type: "text", text }] };
    }

    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
