#!/usr/bin/env python3
"""Small stdlib client for the HexLive bug API. Never logs the bearer token."""
import argparse, hashlib, json, os, pathlib, subprocess, sys, urllib.error, urllib.request, urllib.parse

DEFAULT=os.environ.get("FLASHBACK_API", "https://flashback.62-146-235-120.sslip.io/api/bugs/v1")
REPOSITORY_TOKEN=pathlib.Path(__file__).resolve().parents[1]/"bug-token"
USER_TOKEN=pathlib.Path("~/.config/hexlive/bug-token").expanduser()

def token(args):
    path=pathlib.Path(args.token_file).expanduser() if args.token_file else USER_TOKEN
    try: value=path.read_text(encoding="utf-8").strip()
    except OSError as e: raise SystemExit(f"Cannot read device-local token file: {path}") from e
    if not value: raise SystemExit(f"Device-local token file is empty: {path}")
    return value

def call(args,method,path,payload=None,auth=False):
    data=None if payload is None else json.dumps(payload,ensure_ascii=False).encode()
    headers={"Accept":"application/json","X-Flashback-Project":args.project}
    if data is not None: headers["Content-Type"]="application/json"
    value=token(args)
    if value: headers["Authorization"]="Bearer "+value
    url=urllib.parse.urljoin(args.api.rstrip("/")+"/",path) if path.startswith("/api/") else args.api.rstrip("/")+path
    request=urllib.request.Request(url,data=data,headers=headers,method=method)
    try:
        with urllib.request.urlopen(request,timeout=15) as response:
            body=response.read().decode()
            return None if not body else json.loads(body)
    except urllib.error.HTTPError as e:
        body=e.read().decode(errors="replace")
        raise SystemExit(f"HTTP {e.code}: {body}")

# ── §114.4c: fix-commit patches ─────────────────────────────────────────────
# The server has no repository. The patch the player reads in the card is
# `git show` of the commit, uploaded from the agent's checkout once per SHA.

MAX_PATCH_CHARS=1_000_000

def git(repo,*argv):
    return subprocess.run(["git","-C",repo,*argv],check=True,capture_output=True,text=True,errors="replace").stdout

def commit_patch(repo,sha):
    """Build the upload payload for one commit; raises CalledProcessError when git does not know it."""
    full,author,when,subject=git(repo,"show","-s","--no-color","--format=%H%x00%an%x00%aI%x00%s",sha).rstrip("\n").split("\0")
    message=git(repo,"show","-s","--no-color","--format=%B",sha).strip()
    files=[]
    for line in git(repo,"show","--no-color","--format=","--numstat","-M",sha).splitlines():
        if not line.strip(): continue
        added,deleted,path=line.split("\t",2)
        binary=added=="-" or deleted=="-"
        files.append({"path":path,"added":0 if binary else int(added),"deleted":0 if binary else int(deleted),"binary":binary})
    patch=git(repo,"show","--no-color","--no-ext-diff","--format=","--patch","-M",sha)
    truncated=len(patch)>MAX_PATCH_CHARS
    if truncated: patch=patch[:MAX_PATCH_CHARS]
    return {"sha":full,"subject":subject,"message":message,"author":author,"whenUtc":when,"files":files,"patch":patch,"truncated":truncated}

def push_commit(args,sha,repo):
    payload=commit_patch(repo,sha)
    call(args,"PUT",f"/commits/{payload['sha']}",payload,True)
    return payload["sha"]

def push_commits(args,shas,repo,quiet=False):
    """Upload every SHA git knows; report the ones it does not instead of failing the whole run."""
    pushed,unknown=[],[]
    for sha in shas:
        try: pushed.append(push_commit(args,sha,repo))
        except subprocess.CalledProcessError: unknown.append(sha)
    if unknown and not quiet: print("not in this checkout (skipped): "+" ".join(unknown),file=sys.stderr)
    return pushed,unknown

def backfill(args,repo):
    reports=call(args,"GET","/reports")
    stored=set(call(args,"GET","/commits") or [])
    wanted=[]
    for r in reports:
        for sha in r.get("fixCommits") or ([r["fixCommit"]] if r.get("fixCommit") else []):
            sha=sha.strip().lower()
            if sha and sha not in wanted and not any(s==sha or s.startswith(sha) for s in stored): wanted.append(sha)
    pushed,unknown=push_commits(args,wanted,repo)
    return {"stored":len(stored),"pushed":len(pushed),"unknown":unknown}

def main():
    p=argparse.ArgumentParser(); p.add_argument("--api",default=DEFAULT); p.add_argument("--token-file"); p.add_argument("--project",default=os.environ.get("FLASHBACK_PROJECT","hexlive"))
    sub=p.add_subparsers(dest="cmd",required=True)
    sub.add_parser("list"); sub.add_parser("queue"); sub.add_parser("whoami")
    images=sub.add_parser("attachments",help="download and SHA-256 verify screenshot attachments")
    images.add_argument("id",type=int);images.add_argument("--output",required=True)
    upload=sub.add_parser("attach",help="attach PNG or JPEG to a freshly read report")
    upload.add_argument("id",type=int);upload.add_argument("file")
    g=sub.add_parser("get"); g.add_argument("id",type=int)
    c=sub.add_parser("create"); c.add_argument("--text",required=True); c.add_argument("--context",default=""); c.add_argument("--version",default="")
    u=sub.add_parser("update"); u.add_argument("id",type=int); u.add_argument("--status"); u.add_argument("--text"); u.add_argument("--assigned-agent"); u.add_argument("--handoff"); u.add_argument("--fix-commits",nargs="*"); u.add_argument("--expected-revision",type=int); u.add_argument("--archived",choices=("true","false")); u.add_argument("--repo",default=".",help="checkout to read --fix-commits patches from"); u.add_argument("--no-patch",action="store_true",help="do not upload the patches of --fix-commits")
    pc=sub.add_parser("push-commit",help="upload git show of commits so the card shows files and diff"); pc.add_argument("sha",nargs="+"); pc.add_argument("--repo",default=".")
    bf=sub.add_parser("backfill",help="upload the patch of every fix commit the tracker lacks"); bf.add_argument("--repo",default=".")
    m=sub.add_parser("comment"); m.add_argument("id",type=int); m.add_argument("--author",default="codex"); m.add_argument("--text",required=True)
    d=sub.add_parser("delete"); d.add_argument("id",type=int)
    a=p.parse_args()
    if a.cmd=="whoami":
        data=call(a,"GET","/api/auth/me");data["tokenFile"]=str(pathlib.Path(a.token_file).expanduser() if a.token_file else USER_TOKEN)
    elif a.cmd=="attachments":
        report=call(a,"GET",f"/reports/{a.id}");out=pathlib.Path(a.output);out.mkdir(parents=True,exist_ok=True);data=[]
        for image in report.get("attachments",[]):
            url=urllib.parse.urljoin(a.api,image["url"])
            if urllib.parse.urlsplit(url).netloc!=urllib.parse.urlsplit(a.api).netloc:raise SystemExit("Refusing attachment from another origin")
            req=urllib.request.Request(url,headers={"Authorization":"Bearer "+token(a),"X-Flashback-Project":a.project})
            with urllib.request.urlopen(req,timeout=60) as response:body=response.read(4*1024*1024+1)
            if hashlib.sha256(body).hexdigest()!=image["sha256"]:raise SystemExit("Attachment hash mismatch")
            name=image["id"]+"-"+pathlib.Path(image["filename"]).name
            target=out/name;target.write_bytes(body);data.append({"id":image["id"],"path":str(target.resolve()),"sha256":image["sha256"]})
    elif a.cmd=="attach":
        report=call(a,"GET",f"/reports/{a.id}");file=pathlib.Path(a.file);body=file.read_bytes()
        if len(body)>4*1024*1024:raise SystemExit("Image exceeds 4 MiB")
        content="image/png" if body.startswith(b"\x89PNG\r\n\x1a\n") else "image/jpeg" if body.startswith(b"\xff\xd8") else None
        if content is None:raise SystemExit("PNG or JPEG required")
        url=a.api.rstrip("/")+f"/reports/{a.id}/attachments?filename="+urllib.parse.quote(file.name)+"&expectedRevision="+str(report["revision"])
        req=urllib.request.Request(url,data=body,method="POST",headers={"Authorization":"Bearer "+token(a),"X-Flashback-Project":a.project,"Content-Type":content})
        try:
            with urllib.request.urlopen(req,timeout=60) as response:data=json.load(response)
        except urllib.error.HTTPError as e:raise SystemExit(f"HTTP {e.code}: "+e.read().decode(errors="replace"))
    elif a.cmd in ("list","queue"):
        data=call(a,"GET","/reports")
        if a.cmd=="queue": data=[r for r in data if r.get("status") in ("created","rework")]
    elif a.cmd=="get": data=call(a,"GET",f"/reports/{a.id}")
    elif a.cmd=="create": data=call(a,"POST","/reports",{"text":a.text,"context":a.context,"reportedInVersion":a.version})
    elif a.cmd=="comment": data=call(a,"POST",f"/reports/{a.id}/comments",{"author":a.author,"text":a.text},True)
    elif a.cmd=="delete": data=call(a,"POST",f"/reports/{a.id}/delete",{},True)
    elif a.cmd=="push-commit": data=push_commits(a,a.sha,a.repo)[0]
    elif a.cmd=="backfill": data=backfill(a,a.repo)
    else:
        mapping={"status":a.status,"text":a.text,"assignedAgent":a.assigned_agent,"agentHandoff":a.handoff,"fixCommits":a.fix_commits,"expectedRevision":a.expected_revision,"archived":None if a.archived is None else a.archived=="true"}
        data=call(a,"POST",f"/reports/{a.id}",{k:v for k,v in mapping.items() if v is not None},True)
        if a.fix_commits and not a.no_patch: push_commits(a,a.fix_commits,a.repo)
    if data is not None: print(json.dumps(data,ensure_ascii=False,indent=2))

if __name__=="__main__": main()
