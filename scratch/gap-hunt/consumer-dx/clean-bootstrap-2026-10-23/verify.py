"""Verify captured default bootstraps without rerunning runtime work."""
import hashlib,json,pathlib,re
root=pathlib.Path(__file__).parent
for issue in (169,159,160,161,168):
    meta=json.loads((root/f"{issue}.json").read_text())
    raw=(root/f"{issue}.log").read_bytes()
    text=re.sub(r"\x1b\[[0-9;]*m", "", raw.decode())
    assert hashlib.sha256(raw).hexdigest()==meta["log_sha256"]
    assert meta["initial_tracked_and_untracked_status"]==""
    assert meta["node_modules_absent_before"] and meta["reuse_build_environment_absent"]
    assert "$ npm ci" in text and "$ npm run build:packages" in text
    assert meta["exit_code"]==(2 if issue==169 else 1), (issue,meta["exit_code"])
    if issue==169:
        assert len(re.findall(r"error TS2322:",text))==4
        assert len(re.findall(r"error TS\d+:",text))==4
        assert "Tests:       2 passed, 2 total" in text
        assert "tsd/dist/cli.js" in text and "eslint/bin/eslint.js" in text
    elif issue==159:
        assert "acknowledging each new acceptance returns only that acceptance from SQL" in text
        assert "Tests:       1 failed, 1 total" in text
        assert "-   1," in text and "+   2," in text and "+   3," in text
    elif issue==160:
        assert '"encodeWork":[20,40],"publishWork":[1323,5043]' in text
        assert "Tests:       1 failed, 1 total" in text
        assert "Received:    5043" in text
    elif issue==161:
        assert "Tests:       15 passed, 15 total" in text
        assert "ℹ tests 8" in text and "ℹ pass 8" in text and "ℹ fail 0" in text
        assert "facade does not yet wire the accounting port" in text
        assert "ℹ tests 1" in text and "ℹ fail 1" in text
    else:
        assert "Tests:       1 failed, 2 passed, 3 total" in text
        assert "a no-identity member with an explicit supported string custom key" in text
        assert "- accepted" in text and "+ rejected" in text
    print(f"{issue}: expected diagnostic and required controls verified")
