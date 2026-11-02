"""Private CPU Whisper worker. Only the Flashback app's Docker network can reach it."""
import io,json,os,threading,wave,hmac
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from faster_whisper import WhisperModel

model=WhisperModel(os.environ.get('WHISPER_MODEL','small'),device='cpu',compute_type='int8',cpu_threads=int(os.environ.get('WHISPER_THREADS','2')),num_workers=1,download_root=os.environ.get('WHISPER_CACHE','/models'))
busy=threading.Lock()
class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass  # No audio, text or request credentials in logs.
    def respond(self,code,data):
        body=json.dumps(data,ensure_ascii=False).encode();self.send_response(code);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
    def do_GET(self):self.respond(200 if self.path=='/health' else 404,{'ready':True})
    def do_POST(self):
        if self.path!='/transcribe':return self.respond(404,{'error':'Not found'})
        token=os.environ.get('VOICE_SERVICE_TOKEN')
        if token and not hmac.compare_digest(self.headers.get('Authorization',''),'Bearer '+token):return self.respond(401,{'error':'Authentication required'})
        size=int(self.headers.get('Content-Length','0'))
        if size<44 or size>3*1024*1024:return self.respond(413,{'error':'Invalid audio size'})
        if not busy.acquire(blocking=False):return self.respond(429,{'error':'Busy'})
        try:
            audio=self.rfile.read(size)
            with wave.open(io.BytesIO(audio),'rb') as wav:
                if (wav.getnchannels(),wav.getframerate(),wav.getsampwidth())!=(1,16000,2) or not .25<=wav.getnframes()/16000<=90.1:raise ValueError('Invalid WAV')
            segments,_=model.transcribe(io.BytesIO(audio),language='ru',beam_size=5,vad_filter=True,condition_on_previous_text=False,initial_prompt='Игра First Signal. Путник, Лада, Дима. Деревня, колодец, бочка, часовня, бой, предметы.')
            self.respond(200,{'text':' '.join(s.text.strip() for s in segments).strip(),'language':'ru'})
        except Exception:self.respond(400,{'error':'Cannot transcribe audio'})
        finally:busy.release()

print('Whisper ready: CPU int8',flush=True)
ThreadingHTTPServer((os.environ.get('WHISPER_HOST','0.0.0.0'),4320),Handler).serve_forever()
