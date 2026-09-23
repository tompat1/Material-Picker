# Layer 3: Execution Scripts

This directory houses **deterministic Python scripts** or CLI utilities. The agent calls these scripts during the execution phase to perform data-heavy, repetitive, or integration tasks.

## ⚙️ Operating Rules

1. **Deterministic Execution:** The script should perform operations linearly and predictably (no generative guessing).
2. **Error Handling & Logs:** Print clear error logs, tracebacks, and statuses. Exit with non-zero exit codes (`sys.exit(1)`) on failure so the orchestrating agent can detect issues and self-anneal.
3. **Environment Isolation:** Read configurations from environment variables (`os.environ` or `.env`) — never hardcode secrets.
4. **Intermediate Storage:** Save local file exports, raw scrapings, or temporary JSON states into the `.tmp/` directory.

## 🐍 Python Best Practices

- Use standard libraries where possible.
- If dependencies are needed, document them or keep a local `requirements.txt` or `package.json` config.
- Automatically create output parent directories if they don't exist:
  ```python
  import os
  os.makedirs(os.path.dirname(output_file), exist_ok=True)
  ```
