# Layer 1: Directives (SOPs)

This directory contains **Directives** — Standard Operating Procedures (SOPs) written in natural language. They define the "what" and the "how" for complex, repeatable operations.

## 📄 Template Structure

Every directive should follow this general format:

```markdown
# Directive Name / SOP Title

## Goal
A brief summary of what this directive achieves.

## Steps
A numbered list of tasks to execute. This can include:
- Initiating specific orchestration personas (e.g., UI_Designer, Code_Monkey)
- Target input schemas
- Expected script executions
- Output paths

## Edge Cases
A living log of encountered issues, rate limits, configurations, or parameters discovered during execution. The agent updates this section dynamically via the **Self-Annealing Loop** when errors occur.
```

## 🛠️ Usage Flow

1. Define a new task or process in this directory as a `.md` file.
2. The agent reads the directive, schedules the appropriate sub-agents or scripts in sequence, runs validation tests, and resolves errors.
3. If an error is caught during execution, the agent fixes it, re-runs the validation, and updates the **Edge Cases** section in your directive to codify the learning.
