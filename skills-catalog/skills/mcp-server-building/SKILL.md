---
name: mcp-server-building
description: "Build a connector that lets AI agents use an outside service through well-designed tools (a Model Context Protocol server), in four phases: research, build, test, and prove it with realistic questions."
license: Apache-2.0
metadata:
  title: "MCP Server Building"
  category: "Engineering"
  author: "Anthropic"
---

# MCP Server Development Guide

## Overview

Create MCP (Model Context Protocol) servers that let AI models work with external services through well-designed tools. The quality of an MCP server is measured by how well it enables a model to accomplish real-world tasks, not by how many endpoints it wraps.

Use this when the Commander wants to integrate an external API or service as an MCP server, in TypeScript (MCP SDK) or Python (FastMCP).

## Before you start

1. **Check the toolchain** with `shell.exec` before relying on it:
   - TypeScript: `node --version` (18 or newer) and `npm --version`.
   - Python: `python --version` (3.10 or newer) and `pip --version`.
   If the one you need is missing, stop and tell the Commander to install it from its official site (nodejs.org or python.org). Do not try to install a language runtime yourself.
2. **Say what will be installed.** Building the server installs packages into the project folder (the official MCP SDK, a schema library, an HTTP client). Name them and get the Commander's go-ahead before the first `npm install` or `pip install`. For Python, install into a virtual environment inside the project, not system-wide.
3. **Keys stay out of sight.** The server reads the service's key from an environment variable that the Commander sets. Never write a key into code, a committed file, a command, or chat.
4. **Work in a project folder** in your workspace or one the Commander trusted, and write files with `fs.write` and `fs.edit`.

---

# Process

Building a high-quality MCP server has four phases.

## Phase 1: Deep research and planning

### 1.1 Understand modern MCP design

**API coverage and workflow tools.** Balance comprehensive coverage of the API's endpoints with specialized workflow tools. Workflow tools are more convenient for specific tasks; comprehensive coverage lets an agent compose operations freely. Which works better varies by client: some benefit from code execution that combines basic tools, others from higher-level workflows. When uncertain, prioritize comprehensive API coverage.

**Tool naming and discoverability.** Clear, descriptive names help agents find the right tool quickly. Use a consistent prefix (`github_create_issue`, `github_list_repos`) and action-oriented naming.

**Context management.** Agents benefit from concise tool descriptions and from being able to filter and paginate results. Design tools that return focused, relevant data.

**Actionable error messages.** An error should guide the agent toward a solution, with a specific suggestion and a next step.

### 1.2 Study the MCP protocol documentation

Start from the sitemap to find the relevant pages: `web_fetch` on `https://modelcontextprotocol.io/sitemap.xml`. Then fetch specific pages with a `.md` suffix for Markdown (for example `https://modelcontextprotocol.io/specification/draft.md`).

Key pages to review:
- The specification overview and architecture.
- Transport mechanisms (streamable HTTP, stdio).
- Tool, resource, and prompt definitions.

### 1.3 Study the framework documentation

**Recommended stack:**
- **Language:** TypeScript. The SDK support is strong, it runs well in many execution environments, and models write it well thanks to its wide use, static typing and good linting tools. Use Python when the Commander's project is already Python.
- **Transport:** streamable HTTP for remote servers, with stateless JSON (simpler to scale and maintain than stateful sessions and streaming responses); stdio for local servers.

**Load the documentation:**
- `references/mcp-best-practices.md`: the core guidelines. Read it first.
- TypeScript: `web_fetch` the SDK README at `https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/main/README.md` and follow its project layout and tool-registration examples.
- Python: `web_fetch` the SDK README at `https://raw.githubusercontent.com/modelcontextprotocol/python-sdk/main/README.md` and follow its server setup and tool-registration examples.

SDKs move. Where a reference file and the current SDK README disagree on a name or a signature, the README wins.

### 1.4 Plan the implementation

**Understand the API.** Review the service's API documentation (`web_search`, `web_fetch`) to identify the key endpoints, the authentication requirements, and the data models.

**Tool selection.** Prioritize comprehensive API coverage. List the endpoints to implement, starting with the most common operations. Show the Commander the tool list before building; for anything that writes, deletes, sends or pays, confirm it belongs in the server at all.

---

## Phase 2: Implementation

### 2.1 Set up the project structure

See the language guide for the layout, the package files, and the configuration:
- TypeScript: the project structure, `package.json` and `tsconfig.json` the SDK README shows.
- Python: the module layout and dependencies the SDK README shows.

### 2.2 Implement the core infrastructure

Create the shared utilities first:
- An API client with authentication.
- Error-handling helpers.
- Response formatting (JSON and Markdown).
- Pagination support.

### 2.3 Implement the tools

For each tool:

**Input schema**
- Use Zod (TypeScript) or Pydantic (Python).
- Include constraints and clear descriptions.
- Add examples in the field descriptions.

**Output schema**
- Define an `outputSchema` where possible, for structured data.
- Return `structuredContent` in tool responses (a TypeScript SDK feature).
- This helps clients understand and process tool output.

**Tool description**
- A concise summary of what it does.
- Parameter descriptions.
- The return type and its schema.

**Implementation**
- Async/await for I/O operations.
- Proper error handling with actionable messages.
- Pagination where applicable.
- Both text content and structured data when the SDK supports it.

**Annotations**
- `readOnlyHint`: true or false
- `destructiveHint`: true or false
- `idempotentHint`: true or false
- `openWorldHint`: true or false

---

## Phase 3: Review and test

### 3.1 Code quality

Review for:
- No duplicated code (DRY).
- Consistent error handling.
- Full type coverage.
- Clear tool descriptions.

### 3.2 Build and test

**TypeScript**
- `npm run build` through `verify.run` must finish without errors.
- Exercise the tools with the MCP Inspector (`npx @modelcontextprotocol/inspector`; it has a `--cli` mode for use without a browser).

**Python**
- Check the syntax: `python -m py_compile your_server.py`.
- Exercise the tools with the MCP Inspector.

**On this station**
- A stdio server waits for input forever. Do not launch it bare with `shell.exec` (it will sit until the timeout): run it under the Inspector, or in a `terminal.start` session you read with `terminal.read` and then stop.
- The Inspector is a package fetched from the npm registry when first run. Tell the Commander before its first run, like any other install.
- Test against a sandbox or test account of the service. Call read-only tools freely; call a tool that writes, deletes, sends or pays only with the Commander's go-ahead for that call.
- Connecting the finished server to the station is the Commander's step, in ABILITIES. Give them the start command and the environment variable names it needs. Do not report it as connected.

See the language guides for detailed testing approaches and the quality checklists.

---

## Phase 4: Create evaluations

After implementing the server, create evaluations that test whether a model can actually use it to answer realistic, complex questions.

**Read `references/evaluation.md` for the complete guidelines.**

### 4.1 Create 10 evaluation questions

1. **Tool inspection:** list the available tools and understand what each can do.
2. **Content exploration:** use READ-ONLY operations to explore the data that is there.
3. **Question generation:** write 10 complex, realistic questions.
4. **Answer verification:** solve each question yourself with the server's tools to verify the answer.

### 4.2 Requirements

Each question must be:
- **Independent:** not dependent on any other question.
- **Read-only:** needs only non-destructive operations.
- **Complex:** needs several tool calls and deep exploration.
- **Realistic:** based on a real use a person would care about.
- **Verifiable:** one clear answer that can be checked by string comparison.
- **Stable:** the answer will not change over time.

### 4.3 Output format

Write an XML file with `fs.write`, in this structure:

```xml
<evaluation>
  <qa_pair>
    <question>Find the repository that was archived in Q3 2023 and had previously been the most forked project in the organization. What was its primary programming language?</question>
    <answer>Python</answer>
  </qa_pair>
  <!-- More qa_pairs... -->
</evaluation>
```

---

# Reference files

Load these as needed:

- `references/mcp-best-practices.md` (load first): server and tool naming, response formats (JSON and Markdown), pagination, transport selection (streamable HTTP or stdio), security and error handling.
- The SDK README for the chosen language (Phase 2), fetched fresh: it wins over anything remembered.
- `references/evaluation.md` (Phase 4): question and answer guidelines, the XML format, good and poor examples, how to verify.
- The MCP protocol: the sitemap at `https://modelcontextprotocol.io/sitemap.xml`, then pages with the `.md` suffix.

## Done means

The server builds without errors (you read the build result), each tool was called at least once through the Inspector and returned what its description promises, the quality checklist in the language guide is ticked or its gaps are listed, and the evaluation file holds 10 questions whose answers you verified yourself.

## Output

The project folder (name its README or entry file with `deliverable_note`), the evaluation XML file, and a short report: the tools implemented, the build and test results you saw, the start command and environment variables the Commander needs, and anything you could not verify.

*Needs the DISH (web_fetch, web_search), the INTEL CAB (fs.write, fs.edit) and the WORKBENCH (shell.exec, verify.run, terminal.start), plus Node.js or Python already installed on the Commander's machine.*

Adapted for StarNet from mcp-builder (Anthropic), Apache-2.0.
