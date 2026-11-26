// Настройки Гудвина: разделы-карточки. Мозг, голос, активация, телефон/компьютер, память, журнал.
import { useEffect, useState } from 'react'
import { provider, setCfg } from './ai'
import { isAndroid, nativeCall } from './bridge'
import { downloadLog, readLog } from './log'
import { forgetCache, listMacros, macroText, type Macro } from './macros'
import MemoryPanel from './MemoryPanel'
import { getMode, setMode } from './mode'
import { isDesktop } from './net'
import { canHear, getNight, say, setNight } from './speech'
import { deskCall } from './tools'
import { BrainPanel, openExternal, PermsPanel, useCfg, VoicePanel } from './Setup'
import AgentsPanel from './AgentsPanel'
import { getUsage, onUsage, overLimit } from './usage'
import { IBack, IExt } from './Icons'
import WakeTrain, { canTrain } from './WakeTrain'

const REPO = 'https://github.com/isabekdanial33-gif/burmaldets'

function Sec({ id, title, sub, open, onOpen, children }: { id: string; title: string; sub?: string; open: string; onOpen: (id: string) => void; children: React.ReactNode }) {
  const on = open === id
  return (
    <section className={'bm-sec' + (on ? ' on' : '')}>
      <button className="bm-sec-h" onClick={() => onOpen(on ? '' : id)} aria-expanded={on}>
        <span>
          <b>{title}</b>
          {sub && <small>{sub}</small>}
        </span>
        <i aria-hidden>{on ? '−' : '+'}</i>
      </button>
      {on && <div className="bm-sec-b">{children}</div>}
    </section>
  )
}

function Toggle({ on, onChange, title, sub }: { on: boolean; onChange: (v: boolean) => void; title: string; sub?: string }) {
  return (
    <label className="bm-toggle">
      <span>
        <b>{title}</b>
        {sub && <small>{sub}</small>}
      </span>
      <input type="checkbox" role="switch" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <i aria-hidden />
    </label>
  )
}

export default function Settings({ onClose, wakeOn, setWakeOn, pyramid, setPyramid }: { onClose: () => void; wakeOn: boolean; setWakeOn: (v: boolean) => void; pyramid: boolean; setPyramid: (v: boolean) => void }) {
  const cfg = useCfg()
  const [open, setOpen] = useState('')
  const [cook, setCook] = useState(getMode() === 'cook')
  const [night, setN] = useState(getNight())
  const [persona, setPersona] = useState(cfg.persona)
  const log = readLog()
  const p = provider(cfg.provider)
  return (
    <div className="bm-settings" role="dialog" aria-label="Настройки Гудвина">
      <div className="bm-set-top">
        <button className="bm-iconbtn" onClick={onClose} aria-label="Назад">
          <IBack />
        </button>
        <h2>Настройки</h2>
        <span />
      </div>
      <div className="bm-set-list">
        <Sec id="brain" title="Мозг" sub={`${p.name} · ${cfg.model || 'не выбрано'}`} open={open} onOpen={setOpen}>
          <BrainPanel compact />
          <label className="bm-field">
            <span>Характер (по желанию)</span>
            <textarea
              value={persona}
              onChange={(e) => setPersona(e.target.value)}
              onBlur={() => setCfg({ persona })}
              rows={3}
              placeholder="Например: отвечай с юмором, называй меня «босс», говори короче"
            />
          </label>
          <Toggle
            on={cfg.eco !== false}
            onChange={(v) => setCfg({ eco: v })}
            title="Экономный режим"
            sub="Меньше токенов и запросов к ИИ: короче память разговора, инструменты — только нужные, экран компьютера — текстом, а не картинкой, несколько действий за один запрос."
          />
          {cfg.eco !== false && <EcoLimits />}
        </Sec>

        <Sec id="agents" title="Агенты" sub="свои ИИ: отдельные ключи, модели, суб-агенты" open={open} onOpen={setOpen}>
          <AgentsPanel />
        </Sec>

        {isDesktop && (
          <Sec id="acc" title="Аккаунты" sub="вход на сайты без пароля вслух" open={open} onOpen={setOpen}>
            <Accounts />
          </Sec>
        )}

        <Sec id="voice" title="Голос" sub="тембр, скорость, ночной режим" open={open} onOpen={setOpen}>
          <VoicePanel />
          <Toggle on={night} onChange={(v) => (setN(v), setNight(v))} title="Ночью говорить тише" sub="С 23:00 до 7:00 примерно вдвое тише" />
        </Sec>

        <Sec id="wake" title="Активация" sub="«Гудвин», плавающая кнопка" open={open} onOpen={setOpen}>
          {isAndroid ? <AndroidWake /> : null}
          {!isAndroid && canHear && (
            <Toggle on={wakeOn} onChange={setWakeOn} title="Слушать имя" sub={isDesktop ? 'Скажите «Гудвин» — распознаётся прямо на компьютере' : 'Пока открыта эта вкладка'} />
          )}
          {isDesktop && <DesktopWake />}
          {canTrain && <WakeTrain />}
        </Sec>

        {isAndroid && (
          <Sec id="perms" title="Разрешения" sub="микрофон, поверх окон, батарея" open={open} onOpen={setOpen}>
            <PermsPanel />
          </Sec>
        )}

        <Sec id="cook" title="Режим повара" sub={cook ? 'включён' : 'выключен'} open={open} onOpen={setOpen}>
          <Toggle
            on={cook}
            onChange={(v) => (setCook(v), setMode(v ? 'cook' : 'general'))}
            title="Режим повара"
            sub="Рецепты для ГрандШеф, готовка по шагам, холодильник. Голосом: «режим повара» и «выйди из режима повара»."
          />
          <Toggle on={pyramid} onChange={setPyramid} title="Колонка-голограмма" sub="Для пирамидки: 4 голограммы вокруг центра, экран не гаснет" />
        </Sec>

        {isAndroid && (
          <Sec id="phone" title="Телефон" sub="управление экраном, сценарии, голос телефона" open={open} onOpen={setOpen}>
            <AndroidExtra />
          </Sec>
        )}

        <Sec id="mem" title="Память" sub="что Гудвин знает о вас" open={open} onOpen={setOpen}>
          <MemoryPanel />
        </Sec>

        <Sec id="log" title="Журнал" sub={`недоработок: ${log.length}`} open={open} onOpen={setOpen}>
          <div className="bm-log">
            {log.slice(-8).map((l, i) => (
              <small key={i}>{l}</small>
            ))}
            {!log.length && <small>Пусто — значит, всё работало.</small>}
            {log.length > 0 && !isAndroid && (
              <button className="bm-btn ghost sm" onClick={downloadLog}>
                Скачать журнал
              </button>
            )}
          </div>
        </Sec>

        <Sec id="about" title="О приложении" sub="Гудвин · голосовой ассистент" open={open} onOpen={setOpen}>
          <p className="bm-hint">Ключи и память хранятся только на этом устройстве. Запросы идут напрямую к выбранному провайдеру ИИ.</p>
          <button className="bm-btn ghost sm" onClick={() => openExternal(REPO)}>
            Исходный код на GitHub <IExt size={14} />
          </button>
          <button
            className="bm-btn ghost sm"
            onClick={() => {
              setCfg({ setup: false })
              location.reload()
            }}
          >
            Пройти первый запуск заново
          </button>
        </Sec>
      </div>
      <div className="bm-set-foot">
        <button className="bm-btn big" onClick={onClose}>
          Готово
        </button>
      </div>
    </div>
  )
}

/** Эко-лимит: сколько запросов и токенов ИИ в день; когда кончится — работают только навыки без ИИ. */
function EcoLimits() {
  const cfg = useCfg()
  const [u, setU] = useState(getUsage())
  useEffect(() => onUsage(() => setU(getUsage())), [])
  const num = (v: string) => Math.max(0, Math.round(Number(v.replace(/\s/g, '')) || 0))
  const over = overLimit()
  return (
    <div className="bm-eco">
      <div className="bm-eco-row">
        <label className="bm-field">
          <span>Запросов в день</span>
          <input inputMode="numeric" value={cfg.limitRequests ?? 0} onChange={(e) => setCfg({ limitRequests: num(e.target.value) })} />
        </label>
        <label className="bm-field">
          <span>Токенов в день</span>
          <input inputMode="numeric" value={cfg.limitTokens ?? 0} onChange={(e) => setCfg({ limitTokens: num(e.target.value) })} />
        </label>
      </div>
      <small className="bm-note">0 — без лимита. Когда лимит кончится, ИИ до завтра не вызывается: работают погода, курсы, таймеры, заметки и другие навыки без ИИ.</small>
      <div className={'bm-eco-meter' + (over ? ' over' : '')}>
        <span>
          Сегодня: <b>{u.requests}</b> запросов · <b>{u.tokens.toLocaleString('ru-RU')}</b> токенов
        </span>
        {(cfg.limitRequests || cfg.limitTokens) ? (
          <i style={{ width: Math.min(100, Math.max(cfg.limitRequests ? (u.requests / cfg.limitRequests) * 100 : 0, cfg.limitTokens ? (u.tokens / cfg.limitTokens) * 100 : 0)) + '%' }} />
        ) : null}
      </div>
      {over && <p className="bm-check bad">Лимит на сегодня исчерпан ({over}).</p>}
    </div>
  )
}

/** Сохранённые аккаунты (как в Джарвисе): шифруются Windows, модель видит только названия. */
function Accounts() {
  const [list, setList] = useState<{ id: string; name: string; site: string; auto?: boolean }[]>([])
  const [f, setF] = useState({ name: '', site: '', login: '', password: '', auto: true })
  const [msg, setMsg] = useState('')
  useEffect(() => {
    void deskCall('accList', {}).then((r) => setList((r.list as typeof list) || []))
  }, [])
  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    const r = await deskCall('accAdd', f)
    if (!r.ok) return setMsg(String(r.error || 'Не сохранилось'))
    setList(r.list as typeof list)
    setF({ name: '', site: '', login: '', password: '', auto: true })
    setMsg('Сохранено и зашифровано.')
  }
  return (
    <div className="bm-acc">
      <p className="bm-hint">
        Скажите «зайди в мой ВК» — он откроет страницу входа и сам введёт логин и пароль (с галочкой «сам» — без вопроса, иначе после вашего «да»). Они шифруются средствами Windows и хранятся только на этом
        компьютере; ИИ их не видит и не произносит.
      </p>
      {list.map((a) => (
        <div key={a.id} className="bm-acc-row">
          <span>
            <b>{a.name}</b>
            {a.site && <small>{a.site}</small>}
          </span>
          <label className="bm-acc-auto" title="Входить самому без вопроса">
            <input type="checkbox" checked={!!a.auto} onChange={(e) => deskCall('accAuto', { id: a.id, on: e.target.checked }).then((r) => setList(r.list as typeof list))} />
            сам
          </label>
          <button type="button" className="bm-chip" onClick={() => deskCall('accRemove', { id: a.id }).then((r) => setList(r.list as typeof list))}>
            Удалить
          </button>
        </div>
      ))}
      <form className="bm-acc-form" onSubmit={add} autoComplete="off">
        <input placeholder="Название: ВКонтакте" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
        <input placeholder="Сайт: vk.com (необязательно)" value={f.site} onChange={(e) => setF({ ...f, site: e.target.value })} />
        <input placeholder="Логин, почта или телефон" value={f.login} onChange={(e) => setF({ ...f, login: e.target.value })} required autoComplete="off" />
        <input type="password" placeholder="Пароль" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required autoComplete="new-password" />
        <label className="bm-acc-auto">
          <input type="checkbox" checked={f.auto} onChange={(e) => setF({ ...f, auto: e.target.checked })} />
          Входить самому, без вопроса «да/нет»
        </label>
        <button className="bm-btn">Сохранить аккаунт</button>
      </form>
      {msg && <small className="bm-note">{msg}</small>}
    </div>
  )
}

function AndroidWake() {
  const [st, setSt] = useState<{ wake?: boolean; bubble?: boolean; overlay?: boolean }>({})
  const load = () => nativeCall<{ wake?: boolean; bubble?: boolean; overlay?: boolean }>('perms', {}, 4000).then(setSt).catch(() => {})
  useEffect(() => {
    load()
  }, [])
  return (
    <>
      <Toggle
        on={st.wake !== false}
        onChange={(v) => nativeCall('wakeEnable', { on: v }, 5000).finally(load)}
        title="Слушать «Гудвин»"
        sub="Всегда, даже при выключенном экране. Распознаётся прямо на телефоне, звук никуда не уходит."
      />
      <Toggle
        on={!!st.bubble}
        onChange={(v) => nativeCall('bubble', { on: v }, 5000).finally(() => setTimeout(load, 600))}
        title="Плавающая кнопка"
        sub={st.overlay ? 'Шар поверх всех приложений. Нажмите — и говорите. Перетащите вниз на ✕, чтобы спрятать.' : 'Нужно разрешение «Поверх других окон» — включится по нажатию.'}
      />
    </>
  )
}

function DesktopWake() {
  const [auto, setAuto] = useState<boolean | null>(null)
  const [orb, setOrb] = useState<boolean | null>(null)
  useEffect(() => {
    void deskCall('prefs', {}).then((r) => (setAuto(!!r.autostart), setOrb(r.orb !== false)))
  }, [])
  return (
    <>
      {orb !== null && <Toggle on={orb} onChange={(v) => (setOrb(v), void deskCall('prefs', { orb: v }))} title="Шар на рабочем столе" sub="Плавает поверх окон. Нажмите — и говорите, перетащите — куда удобно." />}
      {auto !== null && <Toggle on={auto} onChange={(v) => (setAuto(v), void deskCall('prefs', { autostart: v }))} title="Запускать вместе с Windows" />}
      <p className="bm-hint">
        Горячая клавиша: <b>Ctrl + Alt + Пробел</b> — позвать Гудвина из любой программы.
      </p>
    </>
  )
}

function AndroidExtra() {
  const [voices, setVoices] = useState<{ name: string; quality: number; network: boolean; current: boolean }[]>([])
  useEffect(() => {
    nativeCall<{ voices: { name: string; quality: number; network: boolean; current: boolean }[] }>('voices', {}, 5000)
      .then((r) => setVoices(r.voices || []))
      .catch(() => {})
  }, [])
  return (
    <>
      <PhoneControl />
      <MacroList />
      {voices.length > 0 && (
        <label className="bm-field">
          <span>Голос телефона (без интернета)</span>
          <select defaultValue={voices.find((v) => v.current)?.name} onChange={(e) => nativeCall('setVoice', { name: e.target.value }, 5000).then(() => say('Так я звучу этим голосом.'))}>
            {voices.map((v, i) => (
              <option key={v.name} value={v.name}>
                {`Голос ${i + 1}${v.network ? ' (интернет)' : ''} · качество ${v.quality}`}
              </option>
            ))}
          </select>
        </label>
      )}
      <small className="bm-note">Журнал на телефоне: Android/data/com.burmaldets.app/files/</small>
    </>
  )
}

function PhoneControl() {
  const [st, setSt] = useState<{ on?: boolean } | null>(null)
  useEffect(() => {
    const f = () => nativeCall<{ on: boolean }>('screenStatus', {}, 4000).then(setSt).catch(() => {})
    f()
    window.addEventListener('focus', f)
    return () => window.removeEventListener('focus', f)
  }, [])
  return (
    <div className="bm-log">
      <b>Управление телефоном: {st?.on ? 'включено ✓' : 'выключено'}</b>
      <small>Гудвин видит экран и нажимает за вас в любых приложениях. Отправку, звонки, покупки и удаление — только после вашего «да». Пароли не вводит.</small>
      {!st?.on && (
        <>
          <button className="bm-btn ghost sm" onClick={() => nativeCall('screenSettings', {}, 4000)}>
            Включить в «Специальных возможностях»
          </button>
          <small>Если пункт серый (Android 13+): «О приложении» → ⋮ → «Разрешить ограниченные настройки», потом снова сюда.</small>
          <button className="bm-btn ghost sm" onClick={() => nativeCall('appInfo', {}, 4000)}>
            Открыть «О приложении»
          </button>
        </>
      )}
    </div>
  )
}

function MacroList() {
  const [list, setList] = useState<Macro[]>([])
  const load = () =>
    listMacros(true)
      .then((r) => setList(r.macros))
      .catch(() => {})
  useEffect(() => {
    load()
  }, [])
  return (
    <div className="bm-log">
      <b>Сценарии: {list.length}</b>
      {!list.length && <small>Скажите, например: «каждый будний день в 7:00 включай музыку и говори “доброе утро”» или «когда подключаю наушники — открой YouTube Music».</small>}
      {list.map((m) => (
        <div key={m.id} className="bm-macro">
          <label className="bm-toggle">
            <span>
              <b>{m.name}</b>
              <small>{macroText(m)}</small>
            </span>
            <input type="checkbox" role="switch" checked={m.enabled !== false} onChange={(e) => (forgetCache(), nativeCall('macroToggle', { id: m.id, on: e.target.checked }, 5000).then(load))} />
            <i aria-hidden />
          </label>
          <button className="bm-btn ghost sm" onClick={() => nativeCall('macroRun', { id: m.id }, 5000)}>
            ▶
          </button>
          <button className="bm-btn ghost sm" onClick={() => (forgetCache(), nativeCall('macroDelete', { id: m.id }, 5000).then(load))} aria-label={'Удалить ' + m.name}>
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}

