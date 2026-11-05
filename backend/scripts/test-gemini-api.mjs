#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const idx = trimmed.indexOf("=");
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function parseArgs(argv) {
  const args = {
    model: "",
    listOnly: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--list-only") {
      args.listOnly = true;
      continue;
    }
    if (token === "--model" && argv[i + 1]) {
      args.model = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function normalizeModelName(name) {
  return String(name || "").replace(/^models\//, "").trim();
}

async function listGenerateContentModels(apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`Model list failed (${res.status}): ${raw.slice(0, 400)}`);
  }
  const json = JSON.parse(raw);
  const models = (json.models || [])
    .filter((model) => Array.isArray(model.supportedGenerationMethods) && model.supportedGenerationMethods.includes("generateContent"))
    .map((model) => normalizeModelName(model.name))
    .filter((name) => name.toLowerCase().includes("gemini"));
  return Array.from(new Set(models));
}

async function runOneLinePrompt(apiKey, model) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const payload = {
    contents: [
      {
        parts: [{ text: "give one line response" }]
      }
    ],
    generationConfig: {
      maxOutputTokens: 32,
      temperature: 0
    }
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-goog-api-key": apiKey
    },
    body: JSON.stringify(payload)
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`generateContent failed for '${model}' (${res.status}): ${raw.slice(0, 500)}`);
  }
  const json = JSON.parse(raw);
  const parts = json?.candidates?.[0]?.content?.parts || [];
  const text = parts
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("")
    .trim();
  return {
    model,
    text,
    rawParts: parts,
    usageMetadata: json?.usageMetadata || null
  };
}

async function main() {
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  loadEnvFile(path.join(repoRoot, ".env"));
  const { model: explicitModel, listOnly } = parseArgs(process.argv.slice(2));

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is missing. Set it in backend/.env.");
  }

  const models = await listGenerateContentModels(apiKey);
  console.log(`Found ${models.length} generateContent-capable Gemini models for this key.`);
  console.log(models.slice(0, 25).join("\n"));

  if (listOnly) return;

  const candidates = Array.from(
    new Set([
      normalizeModelName(explicitModel || process.env.GEMINI_MODEL || ""),
      "gemini-flash-latest",
      "gemini-3.8-flash",
      "gemini-3.7-flash",
      "gemini-3.6-flash",
      "gemini-3.5-flash",
      "gemini-2.5-flash",
      "gemini-1.5-flash"
    ].filter(Boolean))
  ).filter((name) => models.includes(name));

  if (candidates.length === 0) {
    throw new Error("No preferred candidate models are available for this key. Re-run with --list-only and pick one from the returned list.");
  }

  let lastErr = null;
  for (const model of candidates) {
    try {
      const result = await runOneLinePrompt(apiKey, model);
      if (!result.text) {
        console.log(`\nFAILED model '${model}' -> empty textual response (parts: ${JSON.stringify(result.rawParts)})`);
        continue;
      }
      console.log("\nSUCCESS");
      console.log(`model: ${result.model}`);
      console.log(`response: ${result.text}`);
      if (result.usageMetadata) {
        console.log(`usage: ${JSON.stringify(result.usageMetadata)}`);
      }
      return;
    } catch (err) {
      lastErr = err;
      console.log(`\nFAILED model '${model}' -> ${err.message}`);
    }
  }

  throw lastErr || new Error("All candidate models failed.");
}

main().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});
