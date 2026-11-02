#!/usr/bin/env python3
"""Download Linux/amd64 Python 3.12 wheels on a build machine, without installing them."""
import hashlib,pathlib,subprocess,sys
root=pathlib.Path(__file__).resolve().parents[1]
out=root/'apps/whisper/wheels';out.mkdir(parents=True,exist_ok=True)
subprocess.run([sys.executable,'-m','pip','download','--only-binary=:all:','--platform','manylinux_2_28_x86_64','--platform','manylinux2014_x86_64','--platform','manylinux_2_27_x86_64','--python-version','312','--implementation','cp','--abi','cp312','--abi','abi3','--dest',str(out),'-r',str(root/'apps/whisper/requirements.txt')],check=True)
(out/'SHA256SUMS').write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.name+'\n' for p in sorted(out.glob('*.whl'))))
