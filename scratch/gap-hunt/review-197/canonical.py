#!/usr/bin/env python3
"""Replay canonical/current checks only; no historical counterfactual is implied."""
from pathlib import Path
import json,os,subprocess
root=Path(__file__).resolve().parents[3];os.chdir(root)
for row in json.loads((root/'scratch/gap-hunt/review-197/receipt.json').read_text())['initialCommands']:
 print(row['name'],flush=True)
 subprocess.run(row['argv'],check=True)
