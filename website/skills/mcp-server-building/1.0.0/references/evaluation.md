# MCP Server Evaluation Guide

## Overview

How to create evaluations for an MCP server. An evaluation tests whether a model can use the server to answer realistic, complex questions using only the tools the server provides.

---

## Quick reference

### Requirements
- Create 10 human-readable questions.
- Questions must be READ-ONLY, INDEPENDENT, NON-DESTRUCTIVE.
- Each question needs multiple tool calls (potentially dozens).
- Answers must be single, verifiable values.
- Answers must be STABLE (they will not change over time).

### Output format
```xml
<evaluation>
   <qa_pair>
      <question>Your question here</question>
      <answer>Single verifiable answer</answer>
   </qa_pair>
</evaluation>
```

---

## Purpose

The measure of an MCP server is NOT how completely it implements tools. It is how well those implementations (input and output schemas, descriptions, behavior) enable a model with no other context, and access ONLY to the server, to answer realistic and difficult questions.

Create 10 human-readable questions that need ONLY read-only, independent, non-destructive, idempotent operations to answer. Each question should be:
- Realistic.
- Clear and concise.
- Unambiguous.
- Complex, needing potentially dozens of tool calls or steps.
- Answerable with a single, verifiable value that you identify in advance.

## Question guidelines

### Core requirements

1. **Questions MUST be independent.**
   - No question depends on the answer to another.
   - None assumes a write made while processing another question.

2. **Questions MUST need ONLY non-destructive and idempotent tool use.**
   - None instructs or requires changing state to reach the answer.

3. **Questions must be REALISTIC, CLEAR, CONCISE, and COMPLEX.**
   - Another model must need multiple (potentially dozens of) tools or steps to answer.

### Complexity and depth

4. **Questions must require deep exploration.**
   - Consider multi-hop questions with several sub-questions and sequential tool calls.
   - Each step should build on what earlier steps found.

5. **Questions may require extensive paging.**
   - Through multiple pages of results.
   - Through old data (1 to 2 years back) to find niche information.
   - The questions must be DIFFICULT.

6. **Questions must require deep understanding,** not surface-level knowledge.
   - They may pose a complex idea as a True/False question that needs evidence.
   - They may be multiple choice, where the model must test different hypotheses.

7. **Questions must not be solvable with a simple keyword search.**
   - Do not include specific keywords from the target content.
   - Use synonyms, related concepts, or paraphrases.
   - Require several searches, analysis of several related items, extracting context, then deriving the answer.

### Tool testing

8. **Questions should stress-test tool return values.**
   - They may make tools return large JSON objects or lists that strain the model.
   - They should need several kinds of data: IDs and names; timestamps and dates; file IDs, names, extensions and types; URLs.
   - They should probe whether the tool returns every useful form of the data.

9. **Questions should MOSTLY reflect real human use:** the information-retrieval tasks a person helped by a model would care about.

10. **Questions may need dozens of tool calls.**
    - This challenges models with limited context.
    - It pushes the server's tools to return less.

11. **Include ambiguous questions.**
    - Ambiguous in wording, or requiring a hard decision about which tools to call.
    - They force the model to risk mistakes or misreadings.
    - Despite the AMBIGUITY there is STILL A SINGLE VERIFIABLE ANSWER.

### Stability

12. **Design questions so the answer DOES NOT CHANGE.**
    - Do not ask about "current state", which is dynamic.
    - For example, do not count reactions to a post, replies to a thread, or members of a channel.

13. **DO NOT let the server RESTRICT the kinds of questions you write.**
    - Write challenging, complex questions.
    - Some may turn out not to be solvable with the server's tools; that is a finding.
    - Questions may require specific output formats (a date against an epoch time, JSON against Markdown).

## Answer guidelines

### Verification

1. **Answers must be VERIFIABLE by direct string comparison.**
   - If the answer could be written in several formats, state the format in the QUESTION: "Use YYYY/MM/DD.", "Respond True or False.", "Answer A, B, C, or D and nothing else."
   - The answer is one verifiable value, such as: a user ID, user name, display name; a channel ID or name; a message ID or string; a URL or title; a number; a timestamp or date; a boolean; an email address or phone number; a file ID, name or extension; a multiple-choice letter.
   - Answers must not need special formatting or complex structured output.

### Readability

2. **Prefer HUMAN-READABLE answers:** names, dates, file names, message strings, URLs, yes/no, true/false, a/b/c/d, in preference to opaque IDs (IDs are acceptable). The VAST MAJORITY of answers should be human-readable.

### Stability

3. **Answers must be STABLE.**
   - Look at old content: conversations that have ended, projects that have launched, questions that were answered.
   - Base questions on "closed" concepts that will always return the same answer.
   - A question may name a fixed time window to insulate it from change.
   - Rely on context that is UNLIKELY to change. When asking for a paper's name, be specific enough that it cannot be confused with papers published later.

4. **Answers must be CLEAR and UNAMBIGUOUS:** one answer, derivable with the server's tools.

### Diversity

5. **Answers must be DIVERSE** in kind and format:
   - User concepts: user ID, user name, display name, first name, last name, email address, phone number.
   - Channel concepts: channel ID, channel name, channel topic.
   - Message concepts: message ID, message string, timestamp, month, day, year.

6. **Answers must NOT be complex structures.**
   - Not a list of values, not a complex object, not a list of IDs or strings, not free natural-language text.
   - UNLESS the answer can be checked by direct string comparison and realistically reproduced: it must be unlikely that a model would return the same list in another order or format.

## Evaluation process

### Step 1: Documentation inspection

Read the documentation of the target API (`web_fetch`) to understand the available endpoints and functionality. Where something is ambiguous, fetch more from the web.

### Step 2: Tool inspection

List the tools the server offers (through the MCP Inspector) and understand their input and output schemas and descriptions, WITHOUT calling the tools at this stage.

### Step 3: Develop understanding

Repeat steps 1 and 2 until you understand the server well. Think about the kinds of tasks you want to create. Write the questions from the tools' descriptions, as a client would see them, not from the server's source code, so the evaluation tests what a client actually has to go on.

### Step 4: Read-only content inspection

Now USE the server's tools:
- Inspect content with READ-ONLY and NON-DESTRUCTIVE operations ONLY.
- The goal is to find specific content (users, channels, messages, projects, tasks) for realistic questions.
- Do NOT call any tool that modifies state.
- BE CAREFUL: some tools return a LOT of data and can exhaust your context. Make small, targeted calls, set the `limit` parameter below 10, and use pagination.

### Step 5: Question generation

With the content inspected, write 10 human-readable questions that a model should be able to answer with the server, following every guideline above.

## Output format

Each pair is a question and its answer. Save an XML file with `fs.write`:

```xml
<evaluation>
   <qa_pair>
      <question>Find the project created in Q2 2024 with the highest number of completed tasks. What is the project name?</question>
      <answer>Website Redesign</answer>
   </qa_pair>
   <qa_pair>
      <question>Search for issues labeled as "bug" that were closed in March 2024. Which user closed the most issues? Provide their username.</question>
      <answer>sarah_dev</answer>
   </qa_pair>
   <qa_pair>
      <question>Look for pull requests that modified files in the /api directory and were merged between January 1 and January 31, 2024. How many different contributors worked on these PRs?</question>
      <answer>7</answer>
   </qa_pair>
</evaluation>
```

## Examples

### Good questions

**Multi-hop, needing deep exploration (a GitHub server)**
```xml
<qa_pair>
   <question>Find the repository that was archived in Q3 2023 and had previously been the most forked project in the organization. What was the primary programming language used in that repository?</question>
   <answer>Python</answer>
</qa_pair>
```
Good because it needs several searches to find archived repositories, must work out which had the most forks before archival, must read the repository details for the language, has a simple verifiable answer, and rests on historical data that will not change.

**Understanding context without keyword matching (a project-management server)**
```xml
<qa_pair>
   <question>Locate the initiative focused on improving customer onboarding that was completed in late 2023. The project lead created a retrospective document after completion. What was the lead's role title at that time?</question>
   <answer>Product Manager</answer>
</qa_pair>
```
Good because it does not name the project, needs completed projects from a specific period, must identify the lead and their role, needs context from a retrospective document, and has a readable, stable answer.

**Aggregation over several steps (an issue-tracker server)**
```xml
<qa_pair>
   <question>Among all bugs reported in January 2024 that were marked as critical priority, which assignee resolved the highest percentage of their assigned bugs within 48 hours? Provide the assignee's username.</question>
   <answer>alex_eng</answer>
</qa_pair>
```
Good because it filters by date, priority and status, groups by assignee and computes rates, needs timestamps understood, tests pagination, and has a single username as the answer from a closed period.

### Poor questions

**The answer changes over time**
```xml
<qa_pair>
   <question>How many open issues are currently assigned to the engineering team?</question>
   <answer>47</answer>
</qa_pair>
```
Poor because the answer moves as issues are created, closed, or reassigned.

**Too easy with a keyword search**
```xml
<qa_pair>
   <question>Find the pull request with title "Add authentication feature" and tell me who created it.</question>
   <answer>developer123</answer>
</qa_pair>
```
Poor because an exact-title search solves it; no exploration, synthesis, or analysis is needed.

**Ambiguous answer format**
```xml
<qa_pair>
   <question>List all the repositories that have Python as their primary language.</question>
   <answer>repo1, repo2, repo3, data-pipeline, ml-tools</answer>
</qa_pair>
```
Poor because the answer is a list that could come back in any order or format and is hard to check by string comparison. Ask for a specific aggregate (a count) or a superlative (most stars) instead.

## Verification process

After writing the evaluation:

1. **Re-read the XML file** (`fs.read`) and check it is well formed.
2. **Solve each question YOURSELF** with the server's tools, one question at a time, from scratch, and record the answer you reach.
3. **Flag any question** that needed a write or destructive operation.
4. **Replace any answer** that your own solving showed to be wrong.
5. **Remove any `<qa_pair>`** that needs a write or destructive operation.

Solve the questions in small batches and write the results to the file as you go, so a long session does not lose them.

## Running the evaluation

No evaluation runner ships with this skill. Run it by hand:

1. Start the server under the MCP Inspector (its `--cli` mode works from the command line without a browser; its README lists the current options), or, if the Commander has connected the server to the station in ABILITIES, find its tools with `tool.search`.
2. Take each question in a fresh pass, using ONLY the server's tools and no memory of how you wrote the question.
3. Compare your final answer with the recorded one by exact string.
4. Write a results table to a Markdown file: question, expected, actual, correct or not, number of tool calls, and one line on what made it hard.

The truest test is a model that has never seen the server. If the Commander can run the question file with another agent that has only this server's tools, recommend it and hand over the file.

## Reading the results

If many questions fail:
- Are the tool descriptions clear and complete?
- Are the input parameters well documented?
- Do the tools return too much or too little data?
- Are the error messages actionable?
- Does pagination work correctly?

Fix the server, not the questions, unless a question broke one of the guidelines above. Then run the evaluation again.

## Tips

1. **Plan ahead** before generating questions.
2. **Focus on realistic use cases** that people would actually want done.
3. **Write challenging questions** that test the limits of the server.
4. **Ensure stability** by using historical data and closed concepts.
5. **Verify answers** by solving the questions yourself with the server's tools.
6. **Iterate and refine** with what you learn along the way.
