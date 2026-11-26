"""Модель распознавания речи Vosk (русская, маленькая, Apache 2.0) для слова-активатора «Бурмалдец»/«Чекунец».
    python scripts/vosk.py   # скачает и разложит в android/app/src/main/assets/vosk и desktop/vosk/model.tar.gz
"""
import io, shutil, tarfile, urllib.request, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
URL = "https://alphacephei.com/vosk/models/vosk-model-small-ru-0.22.zip"
AND = ROOT / "android" / "app" / "src" / "main" / "assets" / "vosk"
DESK = ROOT / "desktop" / "vosk" / "model.tar.gz"

if not AND.exists():
    print("скачиваю", URL)
    z = zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(URL).read()))
    tmp = ROOT / "android" / "_vosk"
    z.extractall(tmp)
    src = next(tmp.iterdir())
    AND.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(src), AND)
    shutil.rmtree(tmp, ignore_errors=True)
if not DESK.exists():
    DESK.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(DESK, "w:gz") as t:
        t.add(AND, arcname="vosk-model-small-ru-0.22")
print("готово:", AND, DESK)
