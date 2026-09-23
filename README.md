# Agentic Workspace Boilerplate

This repository serves as a template for setting up a structured pair-programming workspace optimized for agentic coding models (like Claude, Gemini, etc.) using the **3-Layer Architecture** and a **Multi-Model Routing Strategy**.

## 🏗️ Structure Overview

```
.
├── .agents/
│   └── AGENTS.md           # Core agent instructions & persona triggers
├── directives/
│   └── README.md           # Layer 1: Standard Operating Procedures (SOPs)
├── execution/
│   └── README.md           # Layer 3: Deterministic execution scripts (Python)
├── .tmp/
│   └── .gitkeep            # Untracked workspace directory for intermediate files
├── .env.example            # Environment variables baseline
└── .gitignore              # Preconfigured Git ignore patterns
```

## 🚀 How to Use This Template

1. Click **"Use this template"** on GitHub to create your new repository.
2. Clone your new repository locally.
3. Configure your local `.env` by copying `.env.example`:
   ```bash
   cp .env.example .env
   ```
4. Define your project goals in `directives/` and write automation scripts in `execution/`.
5. Start pair programming! The agent will automatically read `.agents/AGENTS.md` (or standard model configuration files) to follow the multi-model routing strategy and operating principles.
