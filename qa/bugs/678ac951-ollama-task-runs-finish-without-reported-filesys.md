---
fingerprint: 678ac951
slug: ollama-task-runs-finish-without-reported-filesys
title: Ollama task runs finish without reported filesystem tool calls
surface: providers
severity: P2
status: fixed
found: 2026-09-19
lane: agent/reliability-audit-0919
fix: 0e25b955f
origin: customer
affected: StarNet 0.12.3 Windows; llama3.1:8b and qwen3:8b; reported source 3ba5b84922f3b62caa4e159999ef3acc82af2a3e
family: local-provider-tool-projection
report: https://github.com/androoAGI/starnet/issues/20
installer: unverified
recovery: unconfirmed
---

# Ollama task runs finish without reported filesystem tool calls

## Symptom

On StarNet 0.12.3 Windows, llama3.1:8b and qwen3:8b reportedly finish file creation requests with zero tool calls despite visible File Cabinet tools. Direct Ollama structured calls reportedly work.

## Repro

Reproduce the exact station and model with a sanitized tool-definition/request capture; compare normal interactive, task-promoted, delegated and direct adapter paths. Separate prose resembling a function call from actual structured tool_calls.

## Evidence

Fresh read of GitHub issue #20 on 2026-09-19. sidecar/providers/openai-compatible.js forwards req.tools and parses structured calls; sidecar/index.js checks tool capability only when explicitly false. test/provider.openai-compatible.test.js covers structured chunks and refuses silent tool removal. test/casual-response-safety.e2e.test.js proves real Ollama-profile task promotion emits tools to a controlled endpoint. Neither substitutes for the affected model/station.

## Verdict

Open: no affected wire capture or actual Ollama models available. Do not force every answer to call a tool or execute function-like prose. Capture selection, classification, effective tool set and response before changing the provider contract.

## Regression

Reproduced on a real Ollama 0.34.4 (RTX 5060 Ti 16 GB) with qwen3:8b: the StarNet task request (~98 KB, 86 tool schemas) went to /v1/chat/completions, Ollama ran the model at its server default window (context_length 4096 in /api/ps: the default is 4k under 24 GB VRAM) and reported prompt_tokens 2050. The model saw only the tail of the tool list and answered "I cannot create files ... the available tools only support scheduling routines"; the run ended done with no tool call. The /v1 endpoint ignores options.num_ctx, a top-level num_ctx, and a native preload (it reloads the model back to 4096).

Fix 0e25b955f: Ollama chat rides the native /api/chat with options.num_ctx sized to the request (ladder 8k..64k, capped by the model window from /api/show) and truncate:false, so an under-estimate is refused with the exact count and resent once. Live after the fix: prompt_eval_count 20969 at num_ctx 32768, qwen3:8b calls fs_write, and a fresh station driven through the real genesis UI (OLLAMA -> qwen3:8b -> first task) wrote agent/hello.txt with the requested text (context gauge 22k / 41k).

Residual, not a StarNet defect: llama3.1:8b's Ollama chat template renders the tool list only when the last message is from the user, so after its first tool result the model is sent ~6k tokens with no tools and starts writing calls as text. qwen3:8b does not have this limit.

Before: prompt_tokens 2050 of a ~21k task prompt, no tool call, run done. After: prompt_eval_count 20969 at num_ctx 32768, fs_write called, hello.txt written.

## Sibling coverage

{
  "adapters": [
    {
      "target": "Ollama native /api/chat wire",
      "state": "covered",
      "test": "test/provider.ollama-native.test.js",
      "scenario": "request-sized num_ctx, truncate:false refusal resent once, NDJSON tool calls, /v1-only fallback, unpulled model, no-tools model",
      "gate": "fast"
    },
    {
      "target": "custom OpenAI-compatible endpoints",
      "state": "covered",
      "test": "test/provider.ollama-native.test.js",
      "scenario": "a custom endpoint never touches /api/*",
      "gate": "fast"
    }
  ],
  "entrypoints": [
    {
      "target": "interactive task run on the ollama profile",
      "state": "covered",
      "test": "test/tool-projection.e2e.test.js",
      "scenario": "real sidecar runs against a native-speaking Ollama fixture write and read back a file",
      "gate": "http"
    },
    {
      "target": "casual turn vs task on the ollama profile",
      "state": "covered",
      "test": "test/casual-response-safety.e2e.test.js",
      "scenario": "output caps ride options.num_predict; tools only on tasks; restart preserves the transcript",
      "gate": "http"
    },
    {
      "target": "delegated and routine runs",
      "state": "blocked",
      "reason": "They reach the same adapter through the factory; no live delegated or scheduled run against a real Ollama was exercised in this lane."
    }
  ],
  "displays": [
    {
      "target": "genesis brain screen model default",
      "state": "covered",
      "test": "test/free-path-ollama.test.js",
      "scenario": "an Ollama default is an installed tool-capable model from the live catalog",
      "gate": "fast"
    },
    {
      "target": "installed desktop",
      "state": "blocked",
      "reason": "No installer was rebuilt or exercised; proven in the browser against a source sidecar and a real Ollama 0.34.4."
    }
  ],
  "lifecycle": [
    {
      "target": "window growth across a run",
      "state": "covered",
      "test": "test/provider.ollama-native.test.js",
      "scenario": "an under-estimated prompt is resized once and the larger window sticks for the next request",
      "gate": "fast"
    },
    {
      "target": "real CPU-only hardware",
      "state": "blocked",
      "reason": "Not measured: a CPU-only 8B load at a 32k window exhausted this machine's RAM; the silent-timeout message is covered instead."
    }
  ]
}
