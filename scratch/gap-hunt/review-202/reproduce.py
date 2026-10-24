#!/usr/bin/env python3
"""Recheck bounded docs and published consumers without changing product source."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile

PIN = '09da3b0b05eaff0563faa70ba68c44107508ed7b'
ROOT = Path(__file__).resolve().parents[3]
FIXTURE = 'scratch/gap-hunt/contract-operations/verify-157.sh'
DIGEST = 'b2becb9113b7ee62a2d984612000ce5c52299ec114eedece4de35eb370e7cfc7'

def git(*args):
    return subprocess.check_output(['git', '-c', 'core.fsmonitor=false', *args], cwd=ROOT)

def main():
    # Refuse unknown fixture bytes or a default manager launch on this host.
    assert hashlib.sha256((ROOT / FIXTURE).read_bytes()).hexdigest() == DIGEST
    manager = os.environ.get('PNPM12_BIN')
    assert manager, 'Supply an existing approved exact pnpm12.10.1 executable; do not retry denied downloads.'
    assert subprocess.check_output([manager, '--version'], text=True).strip() == '12.10.1'
    with tempfile.TemporaryDirectory(prefix='microdelta-review202-') as directory:
        checkout = Path(directory) / 'source'
        checkout.mkdir()
        archive = git('archive', '--format=tar', PIN)
        subprocess.run(['tar', '-xf', '-', '-C', str(checkout)], input=archive, check=True)
        files = {str(p.relative_to(checkout)): hashlib.sha256(p.read_bytes()).hexdigest()
                 for p in checkout.rglob('*') if p.is_file()}
        subprocess.run(['node', '--test', 'tooling/native-install-docs.test.mjs'], cwd=checkout, check=True)
        subprocess.run(['bash', '-x', FIXTURE], cwd=checkout, check=True, timeout=900)
        assert all(hashlib.sha256((checkout / p).read_bytes()).hexdigest() == h for p, h in files.items())
        print(json.dumps({'source': PIN, 'sourceFilesUnchanged': len(files), 'docs': '4/4', 'consumers': 'both managers passed exact original assertions', 'linux': 'not executed'}))

if __name__ == '__main__':
    main()
