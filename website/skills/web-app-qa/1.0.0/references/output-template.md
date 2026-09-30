# Web App QA Report

Copy this layout into `qa-output/report.md` and fill in every `{placeholder}`.

**Target:** {target_url}
**Date:** {date}
**Scope:** {scope_description}
**Tester:** {agent_name} (exploratory QA with the station browser)

---

## Executive Summary

| Severity | Count |
|----------|-------|
| Critical | {critical_count} |
| High | {high_count} |
| Medium | {medium_count} |
| Low | {low_count} |
| **Total** | **{total_count}** |

**Overall assessment:** {one_sentence_assessment}

---

## Issues

Repeat this section for each issue found, sorted by severity (Critical first).

### Issue #{issue_number}: {issue_title}

| Field | Value |
|-------|-------|
| **Severity** | {severity} |
| **Category** | {category} |
| **URL** | {url_where_found} |
| **Reproduced** | {every time / seen once} |

**Description:**
{detailed_description_of_the_issue}

**Steps to reproduce:**
1. {step_1}
2. {step_2}
3. {step_3}

**Expected behavior:**
{what_should_happen}

**Actual behavior:**
{what_actually_happens}

**Screenshot:**
{screenshot_path}

**Console or network errors** (if applicable):
```
{error_output}
```

---

## Issues Summary Table

| # | Title | Severity | Category | URL |
|---|-------|----------|----------|-----|
| {n} | {title} | {severity} | {category} | {url} |

## Testing Coverage

### Pages tested
- {list_of_pages_visited}

### Features tested
- {list_of_features_exercised}

### Not tested / out of scope
- {areas_not_covered_and_why}

### Blockers
- {anything_that_prevented_testing_certain_areas}

---

## Notes

{additional_observations, unconfirmed findings, and recommendations}
