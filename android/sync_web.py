"""Копирует собранный сайт (app/dist) внутрь APK: android/app/src/main/assets/www.
Страницы для поисковиков (r/, og/, sitemap) в приложении не нужны.
    cd web && npm run build && python ../android/sync_web.py
"""
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent
src = ROOT.parent / "web" / "dist"
dst = ROOT / "app" / "src" / "main" / "assets" / "www"
SKIP = {"r", "og", "sitemap.xml", "robots.txt", "sw.js", "og.jpg"}
if dst.exists():
    shutil.rmtree(dst)
dst.mkdir(parents=True)
for p in src.iterdir():
    if p.name in SKIP:
        continue
    (shutil.copytree if p.is_dir() else shutil.copy2)(p, dst / p.name)
n = sum(1 for _ in dst.rglob("*") if _.is_file())
mb = sum(f.stat().st_size for f in dst.rglob("*") if f.is_file()) / 1e6
print(f"www: {n} файлов, {mb:.0f} МБ")
