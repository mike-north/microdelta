"""Publish sanitized copies; preserve raw logs separately and disclose both hashes."""
import hashlib
import json
from pathlib import Path
import re
import sys

raw_dir, public_dir = map(Path, sys.argv[1:])
public_dir.mkdir(parents=True, exist_ok=True)
receipts = []
for raw in sorted(raw_dir.glob('*.log')):
    data = raw.read_bytes()
    text = data.decode('utf-8')
    text = re.sub(r'\x1b\[[0-9;]*m', '', text)
    text = re.sub(r'watchman warning: Recrawled.*?(?:\n\n|\Z)', '[Watchman recrawl warning omitted; raw retained privately]\n\n', text, flags=re.S)
    text = re.sub(r'/Users/[^\s\x1b\'"`<>]+', '<USER_PATH>', text)
    text = re.sub(r'(?:/private)?/(?:var/folders|tmp)/[^\s\x1b\'"`<>]+', '<TEMP_PATH>', text)
    public = text.encode('utf-8')
    (public_dir / raw.name).write_bytes(public)
    receipts.append({'file': raw.name, 'raw_sha256': hashlib.sha256(data).hexdigest(), 'public_sha256': hashlib.sha256(public).hexdigest()})
(public_dir / 'NORMALIZATION.json').write_text(json.dumps({'transform': 'UTF-8; strip ANSI SGR; replace Watchman recrawl block, /Users paths and OS temp paths with placeholders; no other edits', 'raw_location': 'private ignored/external storage; not committed', 'logs': receipts}, indent=2) + '\n')
