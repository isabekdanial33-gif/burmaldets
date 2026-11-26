// Первый запуск и раздел «Мозг»: провайдер ИИ, свой ключ, модель, голос, разрешения.
import { useEffect, useMemo, useState } from 'react'
import { getCfg, listModels, onCfg, PROVIDERS, provider, setCfg, type ProviderId, type VoiceEngine } from './ai'
import { isAndroid, nativeCall } from './bridge'
import { ping } from './llm'
import { isDesktop } from './net'
import { EDGE_VOICES, GEMINI_VOICES, OPENAI_VOICES, getRate, getVoiceName, say, setRate, setVoiceName, unlockAudio, voiceEngine } from './speech'
import { deskCall } from './tools'
import { IBack, ICheck, IExt, IEye } from './Icons'
import Holo from './Holo'

export function openExternal(url: string) {
  if (isAndroid) nativeCall('openUrl', { url }, 5000).catch(() => {})
  else if (isDesktop) void deskCall('openUrl', { url })
  else window.open(url, '_blank', 'noopener')
}

export function useCfg() {
  const [c, setC] = useState(getCfg())
  useEffect(() => onCfg(() => setC(getCfg())), [])
  return c
}

const MARK: Record<ProviderId, string> = { gemini: 'G', openai: 'AI', anthropic: 'A', openrouter: 'OR', groq: 'GQ', deepseek: 'DS', mistral: 'M', xai: 'X', custom: '⌂' }
const TAGS: Partial<Record<ProviderId, string[]>> = {
  gemini: ['бесплатно', 'голос', 'зрение'],
  openai: ['голос', 'зрение'],
  anthropic: ['умный', 'зрение'],
  openrouter: ['300+ моделей'],
  groq: ['мгновенно', 'бесплатно'],
  deepseek: ['дёшево'],
  mistral: ['бесплатно'],
  xai: ['Grok'],
  custom: ['Ollama', 'LM Studio'],
}

/** Выбор провайдера плитками. */
export function ProviderGrid({ value, onPick }: { value: ProviderId; onPick: (id: ProviderId) => void }) {
  return (
    <div className="bm-prov-grid" role="radiogroup" aria-label="Провайдер ИИ">
      {PROVIDERS.map((p) => (
        <button key={p.id} role="radio" aria-checked={value === p.id} className={'bm-prov' + (value === p.id ? ' on' : '')} onClick={() => onPick(p.id)}>
          <span className={'bm-prov-mark m-' + p.id}>{MARK[p.id]}</span>
          <b>{p.name}</b>
          <span className="bm-tags">
            {(TAGS[p.id] || []).map((t) => (
              <i key={t}>{t}</i>
            ))}
          </span>
        </button>
      ))}
    </div>
  )
}

type Check = { state: 'idle' | 'busy' | 'ok' | 'bad'; msg?: string }

/** Ключ + модель для выбранного провайдера. compact — внутри настроек. */
export function BrainPanel({ compact, onReady }: { compact?: boolean; onReady?: () => void }) {
  const cfg = useCfg()
  const [pid, setPid] = useState<ProviderId>(cfg.provider)
  const p = provider(pid)
  const [key, setKey] = useState(cfg.keys[pid] || '')
  const [base, setBase] = useState(cfg.base || p.base)
  const [show, setShow] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [model, setModel] = useState(cfg.provider === pid ? cfg.model : p.models[0] || '')
  const [backup, setBackup] = useState(cfg.provider === pid ? cfg.backup[0] || '' : '')
  const [q, setQ] = useState('')
  const [chk, setChk] = useState<Check>({ state: 'idle' })
  const [pong, setPong] = useState<Check>({ state: 'idle' })

  // сменили провайдера — подставляем его ключ и модели
  const pick = (id: ProviderId) => {
    setPid(id)
    const np = provider(id)
    setKey(getCfg().keys[id] || '')
    setBase(id === 'custom' ? getCfg().base || np.base : np.base)
    setModels([])
    setModel(getCfg().provider === id ? getCfg().model : np.models[0] || '')
    setBackup('')
    setChk({ state: 'idle' })
    setPong({ state: 'idle' })
  }

  const load = async () => {
    setChk({ state: 'busy', msg: 'Проверяю ключ…' })
    const r = await listModels(pid, key, pid === 'custom' ? base : undefined)
    if (!r.ok) return setChk({ state: 'bad', msg: r.error })
    setModels(r.models)
    if (!r.models.includes(model)) setModel(r.models.find((m) => p.models.includes(m)) || r.models[0] || model)
    setChk({ state: 'ok', msg: `Ключ работает · моделей: ${r.models.length}` })
  }
  // ключ уже есть — список моделей загрузим сами
  useEffect(() => {
    if ((key || pid === 'custom') && !models.length) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid])

  const save = () => {
    setCfg({ provider: pid, keys: { [pid]: key.trim() }, model: model.trim(), backup: backup.trim() ? [backup.trim()] : [], ...(pid === 'custom' ? { base: base.trim() } : {}) })
  }
  const test = async () => {
    save()
    setPong({ state: 'busy', msg: 'Спрашиваю модель…' })
    const r = await ping(pid, model.trim())
    setPong(r.ok ? { state: 'ok', msg: `Отвечает за ${(r.ms / 1000).toFixed(1)} с${r.text ? ': «' + r.text.slice(0, 40) + '»' : ''}` } : { state: 'bad', msg: r.error?.slice(0, 220) })
    if (r.ok) onReady?.()
  }

  const shown = useMemo(() => {
    const l = q ? models.filter((m) => m.toLowerCase().includes(q.toLowerCase())) : models
    return l.slice(0, 60)
  }, [models, q])
  const canSave = !!model.trim() && (pid === 'custom' || !!key.trim())

  return (
    <div className={'bm-brain' + (compact ? ' compact' : '')}>
      <ProviderGrid value={pid} onPick={pick} />
      <p className="bm-hint">{p.hint}</p>

      {pid === 'custom' && (
        <label className="bm-field">
          <span>Адрес сервера (OpenAI-совместимый)</span>
          <input value={base} onChange={(e) => setBase(e.target.value)} placeholder="http://localhost:11434/v1" spellCheck={false} autoCapitalize="off" />
        </label>
      )}
      <label className="bm-field">
        <span>
          API-ключ {pid === 'custom' && <small>(если нужен)</small>}
          {p.keyUrl && (
            <button type="button" className="bm-linkbtn" onClick={() => openExternal(p.keyUrl)}>
              Где взять ключ <IExt size={14} />
            </button>
          )}
        </span>
        <span className="bm-keyrow">
          <input
            type={show ? 'text' : 'password'}
            value={key}
            onChange={(e) => (setKey(e.target.value), setChk({ state: 'idle' }))}
            placeholder={pid === 'gemini' ? 'AIza…' : pid === 'anthropic' ? 'sk-ant-…' : 'sk-…'}
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="off"
            aria-label="API-ключ"
          />
          <button type="button" className="bm-iconbtn" onClick={() => setShow((s) => !s)} aria-label={show ? 'Скрыть ключ' : 'Показать ключ'}>
            <IEye size={18} />
          </button>
          <button type="button" className="bm-btn ghost" onClick={load} disabled={chk.state === 'busy' || (!key.trim() && pid !== 'custom')}>
            Проверить
          </button>
        </span>
        <small className="bm-note">Ключ хранится только на этом устройстве и уходит только к {p.name}.</small>
      </label>
      {chk.msg && <p className={'bm-check ' + chk.state}>{chk.msg}</p>}

      <label className="bm-field">
        <span>Модель</span>
        {models.length > 8 && <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск модели…" className="bm-search" />}
        {models.length ? (
          <div className="bm-models" role="listbox" aria-label="Модели">
            {shown.map((m) => (
              <button key={m} role="option" aria-selected={m === model} className={'bm-model' + (m === model ? ' on' : '')} onClick={() => (setModel(m), setPong({ state: 'idle' }))}>
                {m}
                {p.models[0] === m && <i>рекомендую</i>}
                {/:free$/.test(m) && <i>бесплатно</i>}
              </button>
            ))}
          </div>
        ) : (
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="название модели" spellCheck={false} autoCapitalize="off" />
        )}
      </label>
      {compact && (
        <label className="bm-field">
          <span>Запасная модель (если основная молчит)</span>
          <input value={backup} onChange={(e) => setBackup(e.target.value)} placeholder={pid === 'gemini' ? 'подберу сам' : 'необязательно'} list="bm-models-dl" spellCheck={false} autoCapitalize="off" />
          <datalist id="bm-models-dl">
            {models.slice(0, 80).map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>
      )}
      <div className="bm-row">
        <button className="bm-btn" onClick={test} disabled={!canSave || pong.state === 'busy'}>
          {pong.state === 'busy' ? 'Проверяю…' : compact ? 'Сохранить и проверить' : 'Проверить ответ'}
        </button>
        {compact && (
          <button className="bm-btn ghost" onClick={save} disabled={!canSave}>
            Сохранить
          </button>
        )}
      </div>
      {pong.msg && <p className={'bm-check ' + pong.state}>{pong.msg}</p>}
    </div>
  )
}

/** Голос: движок, тембр, скорость, проверка. */
export function VoicePanel() {
  const cfg = useCfg()
  const eng = voiceEngine()
  const list = eng === 'gemini' ? GEMINI_VOICES : eng === 'openai' ? OPENAI_VOICES : eng === 'edge' ? EDGE_VOICES : []
  const [rate, setR] = useState(getRate())
  const opts: [VoiceEngine, string, boolean][] = [
    ['auto', 'Лучший доступный', true],
    ['gemini', 'Gemini — живой голос', !!cfg.keys.gemini],
    ['openai', 'OpenAI — живой голос', !!cfg.keys.openai],
    ['edge', 'Microsoft Edge — бесплатный (сервис иногда недоступен)', isDesktop],
    ['system', 'Голос устройства', true],
  ]
  return (
    <div className="bm-voice">
      <div className="bm-seg" role="radiogroup" aria-label="Голос">
        {opts
          .filter((o) => o[2])
          .map(([v, l]) => (
            <button key={v} role="radio" aria-checked={cfg.voice === v} className={cfg.voice === v ? 'on' : ''} onClick={() => setCfg({ voice: v, voiceName: '' })}>
              {l}
            </button>
          ))}
      </div>
      <p className="bm-hint">
        Сейчас звучит: <b>{eng === 'gemini' ? 'Gemini' : eng === 'openai' ? 'OpenAI' : eng === 'edge' ? 'Edge' : 'голос устройства'}</b>
        {eng === 'gemini' && ' — у бесплатного ключа около 10 озвучек в сутки на модель, потом голос устройства.'}
        {!cfg.keys.gemini && !cfg.keys.openai && !isDesktop && ' — живой голос появится, если добавить ключ Gemini или OpenAI.'}
      </p>
      {list.length > 0 && (
        <label className="bm-field">
          <span>Тембр</span>
          <select value={getVoiceName()} onChange={(e) => setVoiceName(e.target.value)}>
            {list.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
      )}
      {eng !== 'gemini' && !!cfg.keys.gemini === false && (
        <label className="bm-field">
          <span>Ключ Gemini для голоса (необязательно)</span>
          <input type="password" defaultValue={cfg.keys.gemini || ''} onBlur={(e) => setCfg({ keys: { gemini: e.target.value.trim() } })} placeholder="AIza…" autoComplete="off" spellCheck={false} />
        </label>
      )}
      <label className="bm-field">
        <span>Скорость речи · {Math.round(rate * 100)}%</span>
        <input type="range" min={0.7} max={1.5} step={0.05} value={rate} onChange={(e) => setR(setRate(Number(e.target.value)))} />
      </label>
      <button className="bm-btn ghost" onClick={() => (unlockAudio(), say('Привет! Я Бурмалдец. Голос работает.'))}>
        ▶ Проверить голос
      </button>
    </div>
  )
}

type Perms = { mic?: boolean; overlay?: boolean; notifications?: boolean; access?: boolean; battery?: boolean; bubble?: boolean; wake?: boolean }
/** Разрешения телефона одним списком: что включено и кнопка «включить». */
export function PermsPanel() {
  const [p, setP] = useState<Perms>({})
  const load = () => nativeCall<Perms>('perms', {}, 4000).then(setP).catch(() => {})
  useEffect(() => {
    load()
    const f = () => setTimeout(load, 400)
    window.addEventListener('focus', f)
    document.addEventListener('visibilitychange', f)
    const t = setInterval(load, 2500)
    return () => (window.removeEventListener('focus', f), document.removeEventListener('visibilitychange', f), clearInterval(t))
  }, [])
  const ask = (which: string) => nativeCall('askPerm', { which }, 5000).finally(() => setTimeout(load, 800))
  const rows: [keyof Perms, string, string][] = [
    ['mic', 'Микрофон', 'чтобы слышать вас'],
    ['overlay', 'Поверх других окон', 'плавающая кнопка и ответы поверх приложений'],
    ['notifications', 'Уведомления', 'напоминания и «Бурмалдец слушает»'],
    ['battery', 'Без экономии батареи', 'чтобы Android не усыплял слух'],
    ['access', 'Управление телефоном', 'видеть экран и нажимать за вас (по желанию)'],
  ]
  return (
    <div className="bm-perms">
      {rows.map(([k, t, d]) => (
        <div key={k} className={'bm-perm' + (p[k] ? ' ok' : '')}>
          <span className="bm-perm-dot">{p[k] ? <ICheck size={14} /> : null}</span>
          <span>
            <b>{t}</b>
            <small>{d}</small>
          </span>
          {!p[k] && (
            <button className="bm-btn ghost sm" onClick={() => ask(k)}>
              Включить
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

/** Первый запуск: знакомство → мозг → голос → разрешения → готово. */
export default function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0)
  const cfg = useCfg()
  const steps = ['hello', 'brain', 'voice', ...(isAndroid ? ['perms'] : []), 'done']
  const cur = steps[step]
  const next = () => setStep((s) => Math.min(steps.length - 1, s + 1))
  const back = () => setStep((s) => Math.max(0, s - 1))
  const finish = () => {
    setCfg({ setup: true })
    if (isAndroid) nativeCall('bubble', { on: true }, 4000).catch(() => {})
    onDone()
  }
  const ready = cfg.provider === 'custom' ? !!cfg.model : !!cfg.keys[cfg.provider] && !!cfg.model
  return (
    <div className="bm-onb">
      <div className="bm-aurora" aria-hidden>
        <i />
        <i />
        <i />
      </div>
      <div className="bm-onb-top">
        {step > 0 && cur !== 'done' ? (
          <button className="bm-iconbtn" onClick={back} aria-label="Назад">
            <IBack />
          </button>
        ) : (
          <span />
        )}
        <div className="bm-steps" aria-label={`Шаг ${step + 1} из ${steps.length}`}>
          {steps.map((s, i) => (
            <i key={s} className={i <= step ? 'on' : ''} />
          ))}
        </div>
        <span />
      </div>

      {cur === 'hello' && (
        <div className="bm-onb-body bm-hero">
          <div className="bm-hero-orb">
            <Holo phase="idle" emotion="радость" bare />
          </div>
          <p className="bm-kicker">ПЕРСОНАЛЬНЫЙ ИИ-АССИСТЕНТ</p>
          <h1 className="bm-title">Бурмалдец</h1>
          <p className="bm-sub">
            Он же <b>Чекунец</b>. Позовите по имени или нажмите на плавающую кнопку — отвечу голосом, найду, напомню, включу, посмотрю на экран.
          </p>
          <button className="bm-btn big" onClick={next}>
            Начать
          </button>
        </div>
      )}

      {cur === 'brain' && (
        <div className="bm-onb-body">
          <p className="bm-kicker">ШАГ 1 · МОЗГ</p>
          <h2 className="bm-h2">Выберите ИИ и вставьте свой ключ</h2>
          <BrainPanel onReady={() => undefined} />
          <div className="bm-onb-foot">
            <button className="bm-btn big" onClick={next} disabled={!ready}>
              Дальше
            </button>
            <button className="bm-linkbtn" onClick={next}>
              Пока без ИИ — только простые команды
            </button>
          </div>
        </div>
      )}

      {cur === 'voice' && (
        <div className="bm-onb-body">
          <p className="bm-kicker">ШАГ 2 · ГОЛОС</p>
          <h2 className="bm-h2">Как мне звучать</h2>
          <VoicePanel />
          <div className="bm-onb-foot">
            <button className="bm-btn big" onClick={next}>
              Дальше
            </button>
          </div>
        </div>
      )}

      {cur === 'perms' && (
        <div className="bm-onb-body">
          <p className="bm-kicker">ШАГ 3 · ДОСТУП</p>
          <h2 className="bm-h2">Чтобы я был рядом всегда</h2>
          <p className="bm-hint">Плавающая кнопка живёт поверх всех приложений, а на слово «Бурмалдец» или «Чекунец» я просыпаюсь даже при выключенном экране.</p>
          <PermsPanel />
          <div className="bm-onb-foot">
            <button className="bm-btn big" onClick={next}>
              Дальше
            </button>
          </div>
        </div>
      )}

      {cur === 'done' && (
        <div className="bm-onb-body bm-hero">
          <div className="bm-hero-orb">
            <Holo phase="speak" emotion="радость" bare />
          </div>
          <h2 className="bm-title sm">Готово</h2>
          <p className="bm-sub">
            Скажите <b>«Бурмалдец»</b> или <b>«Чекунец»</b>
            {isAndroid ? ' — или нажмите на плавающую кнопку.' : isDesktop ? ', нажмите на шар на рабочем столе или Ctrl+Alt+Пробел.' : ' — или нажмите на шар.'}
          </p>
          <button className="bm-btn big" onClick={finish}>
            Поехали
          </button>
        </div>
      )}
    </div>
  )
}
