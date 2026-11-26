// «Руки» Бурмалдеца на Windows: мышь и клавиатура как у человека + список кнопок и полей окна (UI Automation).
// Компилируется один раз при старте (PowerShell Add-Type) и работает в отдельном процессе, команды — по строке JSON.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Automation;

public static class BmHands
{
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }
    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort vk, scan; public uint flags, time; public IntPtr extra; }
    [StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION u; }
    delegate bool EnumProc(IntPtr h, IntPtr l);

    [DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] i, int size);
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int c);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int size);

    const uint MOUSE = 0, KEYB = 1, KEYUP = 2, UNICODE = 4, EXTENDED = 1;
    const uint LDOWN = 2, LUP = 4, RDOWN = 8, RUP = 0x10, MDOWN = 0x20, MUP = 0x40, WHEEL = 0x800, HWHEEL = 0x1000;
    static readonly Random rnd = new Random();
    static readonly int SZ = Marshal.SizeOf(typeof(INPUT));

    public static void Init() { SetProcessDPIAware(); }

    // ---------- курсор ----------
    /** Где курсор сейчас (физические пиксели). */
    public static int[] Pos() { POINT p; GetCursorPos(out p); return new[] { p.X, p.Y }; }
    public static int[] ScreenSize() { return new[] { GetSystemMetrics(0), GetSystemMetrics(1) }; }

    /**
     * Ведём курсор как рука: по слегка изогнутой кривой, с разгоном и торможением, без «телепорта».
     * Время зависит от расстояния (закон Фиттса, упрощённо): близко — 0,12 с, через весь экран — около 0,5 с.
     */
    public static void MoveHuman(int x, int y, double speed)
    {
        POINT p; GetCursorPos(out p);
        double dx = x - p.X, dy = y - p.Y, dist = Math.Sqrt(dx * dx + dy * dy);
        if (dist < 2) { SetCursorPos(x, y); return; }
        double ms = Math.Min(650, 110 + 95 * Math.Log(1 + dist / 40)) / Math.Max(0.3, speed);
        // контрольные точки кривой Безье смещены в сторону — путь чуть дугой, как у человека
        double nx = -dy / dist, ny = dx / dist, bend = (rnd.NextDouble() - 0.5) * Math.Min(120, dist * 0.25);
        double c1x = p.X + dx * 0.3 + nx * bend, c1y = p.Y + dy * 0.3 + ny * bend;
        double c2x = p.X + dx * 0.75 + nx * bend * 0.4, c2y = p.Y + dy * 0.75 + ny * bend * 0.4;
        int steps = Math.Max(8, (int)(ms / 9));
        var sw = Stopwatch.StartNew();
        for (int i = 1; i <= steps; i++)
        {
            double t = (double)i / steps;
            t = t < 0.5 ? 4 * t * t * t : 1 - Math.Pow(-2 * t + 2, 3) / 2; // плавный разгон и торможение
            double u = 1 - t;
            double bx = u * u * u * p.X + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x;
            double by = u * u * u * p.Y + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y;
            SetCursorPos((int)Math.Round(bx), (int)Math.Round(by));
            int wait = (int)(ms * i / steps - sw.ElapsedMilliseconds);
            if (wait > 0) Thread.Sleep(wait);
        }
        SetCursorPos(x, y);
    }

    static void Mouse(uint flags, uint data)
    {
        var i = new INPUT { type = MOUSE };
        i.u.mi.dwFlags = flags; i.u.mi.mouseData = data;
        SendInput(1, new[] { i }, SZ);
    }

    /** Нажатие кнопкой мыши: left/right/middle, 1 или 2 раза; кнопка удерживается 50–90 мс, как пальцем. */
    public static void Click(string button, int count)
    {
        uint d = LDOWN, u = LUP;
        if (button == "right") { d = RDOWN; u = RUP; }
        if (button == "middle") { d = MDOWN; u = MUP; }
        for (int n = 0; n < count; n++)
        {
            Mouse(d, 0); Thread.Sleep(rnd.Next(50, 90)); Mouse(u, 0);
            if (n + 1 < count) Thread.Sleep(rnd.Next(70, 110));
        }
    }

    public static void Button(string button, bool down)
    {
        uint f = button == "right" ? (down ? RDOWN : RUP) : button == "middle" ? (down ? MDOWN : MUP) : (down ? LDOWN : LUP);
        Mouse(f, 0);
    }

    /** Колесо: щелчками по 120, с паузой, как крутят пальцем. Положительное — вверх (от себя). */
    public static void Scroll(int notches, bool horizontal)
    {
        int n = Math.Abs(notches), sign = Math.Sign(notches);
        for (int i = 0; i < n; i++)
        {
            Mouse(horizontal ? HWHEEL : WHEEL, unchecked((uint)(120 * sign)));
            Thread.Sleep(rnd.Next(25, 60));
        }
    }

    // ---------- клавиатура ----------
    static void Key(ushort vk, bool up)
    {
        var i = new INPUT { type = KEYB };
        i.u.ki.vk = vk;
        uint f = up ? KEYUP : 0;
        // стрелки, Delete, Home/End и т.п. — «расширенные» клавиши
        if ((vk >= 0x21 && vk <= 0x2E) || vk == 0x5B || vk == 0x5C) f |= EXTENDED;
        i.u.ki.flags = f;
        SendInput(1, new[] { i }, SZ);
    }

    /** Сочетание клавиш: зажать по порядку, отпустить в обратном. */
    public static void Combo(ushort[] vks)
    {
        foreach (var k in vks) { Key(k, false); Thread.Sleep(rnd.Next(18, 40)); }
        for (int i = vks.Length - 1; i >= 0; i--) { Key(vks[i], true); Thread.Sleep(rnd.Next(10, 25)); }
    }

    /** Печать любого текста (русский, эмодзи) — посимвольно, с неровными паузами, как человек. cps — символов в секунду. */
    public static void Type(string text, double cps)
    {
        double baseMs = 1000.0 / Math.Max(5, cps);
        foreach (char c in text)
        {
            if (c == '\n') { Key(0x0D, false); Key(0x0D, true); }
            else if (c == '\t') { Key(0x09, false); Key(0x09, true); }
            else
            {
                var d = new INPUT { type = KEYB };
                d.u.ki.scan = c; d.u.ki.flags = UNICODE;
                var u = d; u.u.ki.flags = UNICODE | KEYUP;
                SendInput(2, new[] { d, u }, SZ);
            }
            int ms = (int)(baseMs * (0.55 + rnd.NextDouble() * 0.9));
            if (c == ' ' || c == ',' || c == '.') ms += rnd.Next(0, (int)baseMs);
            Thread.Sleep(Math.Max(2, ms));
        }
    }

    // ---------- окна ----------
    static string Title(IntPtr h) { var sb = new StringBuilder(300); GetWindowText(h, sb, 300); return sb.ToString(); }

    static bool Normal(IntPtr h, uint skipPid)
    {
        if (!IsWindowVisible(h)) return false;
        int ex = GetWindowLong(h, -20);
        if ((ex & 0x80) != 0) return false; // WS_EX_TOOLWINDOW
        int cloaked;
        if (DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return false; // скрытые окна UWP
        uint pid; GetWindowThreadProcessId(h, out pid);
        if (pid == skipPid) return false;
        string t = Title(h);
        if (t.Length == 0 || t == "Program Manager") return false;
        return true;
    }

    /** Окна сверху вниз: «hwnd\tзаголовок\tсвёрнуто». Свои окна (pid) пропускаем. */
    public static string Windows(uint skipPid)
    {
        var sb = new StringBuilder();
        int n = 0;
        EnumWindows((h, l) =>
        {
            if (Normal(h, skipPid) && n < 25) { sb.Append(h.ToInt64()).Append('\t').Append(Title(h).Replace('\t', ' ')).Append('\t').Append(IsIconic(h) ? "1" : "0").Append('\n'); n++; }
            return true;
        }, IntPtr.Zero);
        return sb.ToString();
    }

    /** Верхнее «настоящее» окно (не Бурмалдец). */
    public static long Target(uint skipPid)
    {
        IntPtr fg = GetForegroundWindow();
        if (fg != IntPtr.Zero && Normal(fg, skipPid) && !IsIconic(fg)) return fg.ToInt64();
        IntPtr found = IntPtr.Zero;
        EnumWindows((h, l) => { if (Normal(h, skipPid) && !IsIconic(h)) { found = h; return false; } return true; }, IntPtr.Zero);
        return found.ToInt64();
    }

    /** Какое окно сейчас впереди и чьё оно (процесс). */
    public static long Fg() { return GetForegroundWindow().ToInt64(); }
    public static long Pid(long hwnd) { uint pid; GetWindowThreadProcessId(new IntPtr(hwnd), out pid); return pid; }
    public static string TitleOf(long hwnd) { return Title(new IntPtr(hwnd)); }

    /** Вывести окно вперёд. Windows не даёт фоновым процессам красть фокус — короткое нажатие Alt снимает запрет. */
    public static bool Focus(long hwnd)
    {
        var h = new IntPtr(hwnd);
        if (IsIconic(h)) ShowWindow(h, 9);
        if (GetForegroundWindow() == h) return true;
        Key(0x12, false); Key(0x12, true);
        SetForegroundWindow(h);
        BringWindowToTop(h);
        Thread.Sleep(120);
        return GetForegroundWindow() == h;
    }

    // ---------- что на экране (UI Automation) ----------
    static string Kind(ControlType t)
    {
        if (t == ControlType.Button) return "кнопка";
        if (t == ControlType.Hyperlink) return "ссылка";
        if (t == ControlType.Edit) return "поле";
        if (t == ControlType.Document) return "документ";
        if (t == ControlType.ComboBox) return "список";
        if (t == ControlType.CheckBox) return "галочка";
        if (t == ControlType.RadioButton) return "выбор";
        if (t == ControlType.MenuItem) return "пункт меню";
        if (t == ControlType.TabItem) return "вкладка";
        if (t == ControlType.ListItem) return "элемент";
        if (t == ControlType.TreeItem) return "узел";
        if (t == ControlType.SplitButton) return "кнопка";
        if (t == ControlType.Slider) return "ползунок";
        if (t == ControlType.Text) return "текст";
        if (t == ControlType.Image) return "картинка";
        if (t == ControlType.DataItem) return "строка";
        return null;
    }

    /**
     * Видимые кнопки, поля, ссылки и тексты окна — по строке: «тип\tимя\tx\ty\tw\th\tфлаги».
     * Ограничены числом и временем: в браузере дерево огромное, а модели хватает видимого.
     */
    public static string Ui(long hwnd, int max, int budgetMs)
    {
        var sb = new StringBuilder();
        var sw = Stopwatch.StartNew();
        AutomationElement root;
        try { root = AutomationElement.FromHandle(new IntPtr(hwnd)); } catch { return ""; }
        RECT wr; GetWindowRect(new IntPtr(hwnd), out wr);
        var walker = TreeWalker.ControlViewWalker;
        var stack = new Stack<AutomationElement>();
        stack.Push(root);
        int count = 0, texts = 0;
        var seen = new HashSet<string>();
        while (stack.Count > 0 && count < max && sw.ElapsedMilliseconds < budgetMs)
        {
            var el = stack.Pop();
            AutomationElement.AutomationElementInformation c;
            try { c = el.Current; } catch { continue; }
            if (c.IsOffscreen && el != root) continue;
            var r = c.BoundingRectangle;
            bool inside = !r.IsEmpty && r.Width >= 3 && r.Height >= 3 && r.Right > wr.L && r.Left < wr.R && r.Bottom > wr.T && r.Top < wr.B;
            string kind = Kind(c.ControlType);
            if (kind != null && inside && el != root)
            {
                string name = (c.Name ?? "").Trim();
                string flags = "";
                if (c.ControlType == ControlType.Edit || c.ControlType == ControlType.ComboBox || c.ControlType == ControlType.Document)
                {
                    if (c.IsPassword) flags += "p";
                    else
                    {
                        try
                        {
                            object vp;
                            if (c.ControlType != ControlType.Document && el.TryGetCurrentPattern(ValuePattern.Pattern, out vp))
                            {
                                string v = ((ValuePattern)vp).Current.Value ?? "";
                                if (v.Length > 0) name = (name.Length > 0 ? name + " = " : "= ") + (v.Length > 60 ? v.Substring(0, 60) + "…" : v);
                            }
                        }
                        catch { }
                    }
                    if (c.HasKeyboardFocus) flags += "f";
                }
                if (!c.IsEnabled) flags += "d";
                object tp;
                try { if (c.ControlType == ControlType.CheckBox && el.TryGetCurrentPattern(TogglePattern.Pattern, out tp) && ((TogglePattern)tp).Current.ToggleState == ToggleState.On) flags += "on"; } catch { }
                bool skip = false;
                if (c.ControlType == ControlType.Text || c.ControlType == ControlType.Image)
                {
                    // тексты и картинки — только с подписью и в разумном количестве: это контекст, а не цели
                    if (name.Length < 2 || texts >= max / 2) skip = true; else texts++;
                }
                else if (name.Length == 0 && c.ControlType != ControlType.Edit && c.ControlType != ControlType.Document) skip = true;
                if (name.Length > 90) name = name.Substring(0, 90) + "…";
                string key = kind + name + (int)(r.X / 8) + (int)(r.Y / 8);
                if (!skip && seen.Add(key))
                {
                    sb.Append(kind).Append('\t').Append(name.Replace('\t', ' ').Replace('\n', ' ')).Append('\t')
                      .Append((int)r.X).Append('\t').Append((int)r.Y).Append('\t').Append((int)r.Width).Append('\t').Append((int)r.Height).Append('\t').Append(flags).Append('\n');
                    count++;
                }
            }
            // внутрь кнопок и ссылок не спускаемся — там только их же подписи
            if (c.ControlType == ControlType.Button || c.ControlType == ControlType.Hyperlink || c.ControlType == ControlType.MenuItem) continue;
            var kids = new List<AutomationElement>();
            try
            {
                var ch = walker.GetFirstChild(el);
                while (ch != null && kids.Count < 400) { kids.Add(ch); ch = walker.GetNextSibling(ch); }
            }
            catch { }
            for (int i = kids.Count - 1; i >= 0; i--) stack.Push(kids[i]);
        }
        return sb.ToString();
    }
}
