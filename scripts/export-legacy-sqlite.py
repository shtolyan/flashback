#!/usr/bin/env python3
"""Read a consistent archived HexLive SQLite snapshot without its retired server."""
import argparse, json, sqlite3
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('database');p.add_argument('output');a=p.parse_args()
c=sqlite3.connect('file:'+str(Path(a.database).resolve())+'?mode=ro',uri=True);c.row_factory=sqlite3.Row
columns=dict(id='id',created_utc='createdUtc',status='status',text='text',context='context',assigned_agent='assignedAgent',agent_handoff='agentHandoff',fix_commit='fixCommit',reported_version='reportedInVersion',ready_version='readyForTestInVersion',fixed_version='fixedInVersion',archived='archived',revision='revision')
reports=[]
for row in c.execute('SELECT * FROM bug_reports ORDER BY id'):
 r={v:row[k] for k,v in columns.items()};r['archived']=bool(r['archived'])
 r['comments']=[dict(whenUtc=x['when_utc'],author=x['author'],text=x['text']) for x in c.execute('SELECT * FROM bug_comments WHERE report_id=? ORDER BY ordinal',(r['id'],))]
 r['fixCommits']=[x['sha'] for x in c.execute('SELECT sha FROM bug_fix_commits WHERE report_id=? ORDER BY ordinal',(r['id'],))]
 reports.append(r)
patches=[dict(sha=x['sha'],subject=x['subject'],message=x['message'],author=x['author'],whenUtc=x['when_utc'],files=json.loads(x['files']),patch=x['patch'],truncated=bool(x['truncated']),storedUtc=x['stored_utc']) for x in c.execute('SELECT * FROM bug_commit_patches ORDER BY sha')]
out=Path(a.output)
with out.open('x') as f:
 out.chmod(0o600);json.dump(dict(reports=reports,patches=patches),f,ensure_ascii=False)
print(json.dumps(dict(reports=len(reports),comments=sum(len(r['comments']) for r in reports),patches=len(patches))))
