// Настройки Бурмалдеца: разделы-карточки. Мозг, голос, активация, телефон/компьютер, память, журнал.
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
import { IBack, IExt } from './Icons'

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
    <div className="bm-settings" role="dialog" aria-label="Настройки Бурмалдеца">
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
        </Sec>

        <Sec id="voice" title="Голос" sub="тембр, скорость, ночной режим" open={open} onOpen={setOpen}>
          <VoicePanel />
          <Toggle on={night} onChange={(v) => (setN(v), setNight(v))} title="Ночью говорить тише" sub="С 23:00 до 7:00 примерно вдвое тише" />
        </Sec>

        <Sec id="wake" title="Активация" sub="«Бурмалдец», «Чекунец», плавающая кнопка" open={open} onOpen={setOpen}>
          {isAndroid ? <AndroidWake /> : null}
          {!isAndroid && canHear && (
            <Toggle on={wakeOn} onChange={setWakeOn} title="Слушать имя" sub={isDesktop ? 'Скажите «Бурмалдец» или «Чекунец» — распознаётся прямо на компьютере' : 'Пока открыта эта вкладка'} />
          )}
          {isDesktop && <DesktopWake />}
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

        <Sec id="mem" title="Память" sub="что Бурмалдец знает о вас" open={open} onOpen={setOpen}>
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

        <Sec id="about" title="О приложении" sub="Бурмалдец · он же Чекунец" open={open} onOpen={setOpen}>
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
        title="Слушать «Бурмалдец» и «Чекунец»"
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
        Горячая клавиша: <b>Ctrl + Alt + Пробел</b> — позвать Бурмалдеца из любой программы.
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
      <small>Бурмалдец видит экран и нажимает за вас в любых приложениях. Отправку, звонки, покупки и удаление — только после вашего «да». Пароли не вводит.</small>
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

