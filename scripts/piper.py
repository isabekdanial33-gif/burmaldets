# Локальный нейроголос для ПК: Piper (MIT, github.com/rhasspy/piper) + голос «Руслан» (ru_RU-ruslan-medium).
# Кладёт всё в desktop/piper — оттуда установщик берёт его в сборку.
import io, os, urllib.request, zipfile

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'desktop', 'piper')
BIN = 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip'
VOICE = 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/ru/ru_RU/ruslan/medium/ru_RU-ruslan-medium.onnx'

os.makedirs(os.path.join(ROOT, 'voices'), exist_ok=True)
if not os.path.exists(os.path.join(ROOT, 'piper.exe')):
    z = zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(BIN).read()))
    for n in z.namelist():
        if n.startswith('piper/') and not n.endswith('/') and 'pkgconfig' not in n and 'tashkeel' not in n:
            out = os.path.join(ROOT, n[len('piper/'):])
            os.makedirs(os.path.dirname(out), exist_ok=True)
            open(out, 'wb').write(z.read(n))
for ext in ('.onnx', '.onnx.json'):
    out = os.path.join(ROOT, 'voices', 'ru_RU-ruslan-medium' + ext)
    if not os.path.exists(out):
        urllib.request.urlretrieve(VOICE.replace('.onnx', ext), out)
print('piper ok:', ROOT)
