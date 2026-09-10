#!/usr/bin/env python3
"""Capture legacy HTTP data; freeze source writes before a final cutover capture."""
import argparse
import concurrent.futures
import datetime
import json
import pathlib
import urllib.request

p = argparse.ArgumentParser()
p.add_argument('--api', required=True)
p.add_argument('--output', required=True)
a = p.parse_args()
def get(route):
    with urllib.request.urlopen(a.api.rstrip('/') + route, timeout=30) as response:
        return json.load(response)
reports = get('/reports')
shas = get('/commits')
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
    patches = list(executor.map(lambda sha: get('/commits/' + sha), shas))
if reports != get('/reports') or shas != get('/commits'):
    raise SystemExit('Source changed during capture; retry after pausing writes.')
snapshot = dict(reports=reports, patches=patches, source=a.api,
                capturedUtc=datetime.datetime.now(datetime.timezone.utc).isoformat())
target = pathlib.Path(a.output)
target.parent.mkdir(parents=True, exist_ok=True)
with target.open('x', encoding='utf-8') as file:
    target.chmod(0o600)
    json.dump(snapshot, file, ensure_ascii=False)
print(json.dumps(dict(reports=len(reports), comments=sum(len(r['comments']) for r in reports), patches=len(patches), output=str(target))))
