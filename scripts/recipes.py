"""Рецепты для режима повара (каталог ГрандШеф) берутся из соседнего проекта MyGrandChef и в репозиторий НЕ попадают.
    python scripts/recipes.py            # скопировать web/public/data и web/public/img из ../grandchef-recipes/app/public
Без них Бурмалдец работает полностью, только режим повара не найдёт рецепты в каталоге.
"""
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT.parent / "grandchef-recipes" / "app" / "public"
DST = ROOT / "web" / "public"
for name in ("data", "img"):
    s, d = SRC / name, DST / name
    if not s.exists():
        print("нет", s, "— пропускаю")
        continue
    if d.exists():
        shutil.rmtree(d)
    shutil.copytree(s, d)
    print(name, sum(1 for _ in d.rglob("*") if _.is_file()), "файлов")
