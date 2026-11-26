// Первый запуск и раздел «Мозг»: провайдер ИИ, свой ключ, модель, голос, разрешения.
import { useEffect, useMemo, useRef, useState } from 'react'
import { getCfg, listModels, onCfg, PROVIDERS, provider, setCfg, type ModelInfo, type ProviderId, type VoiceEngine } from './ai'
import { isAndroid, nativeCall } from './bridge'
import { ping } from './llm'
import { isDesktop } from './net'
import { EDGE_VOICES, GEMINI_VOICES, OPENAI_VOICES, getRate, getVoiceName, say, setRate, setVoiceName, unlockAudio, voiceEngine } from './speech'
import { deskCall } from './tools'
import { IBack, ICheck, IExt, IEye } from './Icons'
import Holo from './Holo'
import WakeTrain, { canTrain } from './WakeTrain'

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
const fmtCtx = (n: number) => (n >= 1e6 ? +(n / 1e6).toFixed(1) + 'M' : Math.round(n / 1000) + 'K') + ' контекст'

/** Ключ + модель для выбранного провайдера. compact — внутри настроек. */
export function BrainPanel({ compact, onReady }: { compact?: boolean; onReady?: () => void }) {
  const cfg = useCfg()
  const [pid, setPid] = useState<ProviderId>(cfg.provider)
  const p = provider(pid)
  const [key, setKey] = useState(cfg.keys[pid] || '')
  const [base, setBase] = useState(cfg.base || p.base)
  const [show, setShow] = useState(false)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [view, setView] = useState<'chat' | 'free' | 'all'>('chat')
  const [manual, setManual] = useState(false)
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
    setManual(false)
    setView('chat')
    setModel(getCfg().provider === id ? getCfg().model : np.models[0] || '')
    setBackup('')
    setChk({ state: 'idle' })
    setPong({ state: 'idle' })
  }

  const seq = useRef(0)
  const load = async (k = key) => {
    const my = ++seq.current
    setChk({ state: 'busy', msg: 'Проверяю ключ и загружаю модели…' })
    const r = await listModels(pid, k, pid === 'custom' ? base : undefined)
    if (my !== seq.current) return // уже сменили ключ или провайдера
    if (!r.ok) return (setModels([]), setChk({ state: 'bad', msg: r.error }))
    setModels(r.models)
    const ids = r.models.map((m) => m.id)
    if (!ids.includes(model)) setModel(r.models.find((m) => p.models.includes(m.id))?.id || r.models.find((m) => m.chat)?.id || r.models[0]?.id || model)
    if (backup && !ids.includes(backup)) setBackup('')
    const chat = r.models.filter((m) => m.chat).length
    setChk({ state: 'ok', msg: `Ключ работает · моделей: ${r.models.length}${chat < r.models.length ? ` (для разговора — ${chat})` : ''}` })
  }
  // ключ уже есть — список моделей загрузим сами; вставили новый — тоже, без кнопки
  useEffect(() => {
    if (key.trim() || pid === 'custom') void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid])
  const onKey = (v: string) => {
    setKey(v)
    setModels([])
    setChk({ state: 'idle' })
    const my = ++seq.current
    if (v.trim().length >= 20) window.setTimeout(() => my === seq.current && void load(v), 600)
  }

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

  const freeN = models.filter((m) => m.free && m.chat).length
  const chatN = models.filter((m) => m.chat).length
  const shown = useMemo(() => {
    let l = view === 'all' ? models : view === 'free' ? models.filter((m) => m.free && m.chat) : models.filter((m) => m.chat)
    if (q) {
      const w = q.toLowerCase()
      l = l.filter((m) => m.id.toLowerCase().includes(w) || (m.name || '').toLowerCase().includes(w))
    }
    return l
  }, [models, q, view])
  const chatList = models.filter((m) => m.chat)
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
            onChange={(e) => onKey(e.target.value)}
            placeholder={pid === 'gemini' ? 'AIza…' : pid === 'anthropic' ? 'sk-ant-…' : 'sk-…'}
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="off"
            aria-label="API-ключ"
          />
          <button type="button" className="bm-iconbtn" onClick={() => setShow((s) => !s)} aria-label={show ? 'Скрыть ключ' : 'Показать ключ'}>
            <IEye size={18} />
          </button>
          <button type="button" className="bm-btn ghost" onClick={() => load()} disabled={chk.state === 'busy' || (!key.trim() && pid !== 'custom')}>
            Проверить
          </button>
        </span>
        <small className="bm-note">Ключ хранится только на этом устройстве и уходит только к {p.name}.</small>
      </label>
      {chk.msg && <p className={'bm-check ' + chk.state}>{chk.msg}</p>}

      <div className="bm-field">
        <span>
          Модель
          {models.length > 0 && (
            <button type="button" className="bm-linkbtn" onClick={() => load()} disabled={chk.state === 'busy'}>
              Обновить список
            </button>
          )}
        </span>
        {models.length > 0 && !manual ? (
          <>
            <div className="bm-mtabs" role="tablist">
              <button type="button" role="tab" aria-selected={view === 'chat'} className={view === 'chat' ? 'on' : ''} onClick={() => setView('chat')}>
                Для разговора <b>{chatN}</b>
              </button>
              {freeN > 0 && (
                <button type="button" role="tab" aria-selected={view === 'free'} className={view === 'free' ? 'on' : ''} onClick={() => setView('free')}>
                  Бесплатные <b>{freeN}</b>
                </button>
              )}
              <button type="button" role="tab" aria-selected={view === 'all'} className={view === 'all' ? 'on' : ''} onClick={() => setView('all')}>
                Все <b>{models.length}</b>
              </button>
            </div>
            {models.length > 8 && <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по названию…" className="bm-search" spellCheck={false} autoCapitalize="off" />}
            <div className="bm-models" role="listbox" aria-label="Модели">
              {shown.map((m) => (
                <button
                  type="button"
                  key={m.id}
                  role="option"
                  aria-selected={m.id === model}
                  className={'bm-model' + (m.id === model ? ' on' : '') + (m.chat ? '' : ' dim')}
                  onClick={() => (setModel(m.id), setPong({ state: 'idle' }))}
                >
                  <span className="bm-mname">
                    {m.id}
                    {((m.name && m.name !== m.id) || m.ctx) && (
                      <small>{[m.name && m.name !== m.id ? m.name : '', m.ctx ? fmtCtx(m.ctx) : ''].filter(Boolean).join(' · ')}</small>
                    )}
                  </span>
                  <span className="bm-mtags">
                    {p.models[0] === m.id && <i>рекомендую</i>}
                    {m.free && <i>бесплатно</i>}
                    {!m.chat && <i className="x">не для разговора</i>}
                  </span>
                </button>
              ))}
              {!shown.length && <p className="bm-empty">Ничего не нашлось</p>}
            </div>
            <small className="bm-note">
              Выбрана: <b>{model || '—'}</b> · показано {shown.length} из {models.length} ·{' '}
              <button type="button" className="bm-linkbtn" onClick={() => setManual(true)}>
                ввести вручную
              </button>
            </small>
          </>
        ) : (
          <>
            <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="название модели" spellCheck={false} autoCapitalize="off" />
            <small className="bm-note">
              {models.length ? (
                <button type="button" className="bm-linkbtn" onClick={() => setManual(false)}>
                  выбрать из списка
                </button>
              ) : chk.state === 'busy' ? (
                'Загружаю список моделей…'
              ) : (
                'Вставьте ключ — список всех моделей появится сам.'
              )}
            </small>
          </>
        )}
      </div>
      {compact && (
        <label className="bm-field">
          <span>Запасная модель (если основная молчит)</span>
          {chatList.length ? (
            <select value={backup} onChange={(e) => setBackup(e.target.value)} className="bm-select">
              <option value="">{pid === 'gemini' ? 'подберу сам' : 'без запасной'}</option>
              {chatList
                .filter((m) => m.id !== model)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id + (m.free ? ' — бесплатно' : '')}
                  </option>
                ))}
            </select>
          ) : (
            <input value={backup} onChange={(e) => setBackup(e.target.value)} placeholder={pid === 'gemini' ? 'подберу сам' : 'необязательно'} spellCheck={false} autoCapitalize="off" />
          )}
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
  const steps = ['hello', 'brain', 'voice', ...(isAndroid ? ['perms'] : []), ...(canTrain ? ['name'] : []), 'done']
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

      {cur === 'name' && (
        <div className="bm-onb-body">
          <p className="bm-kicker">ШАГ {step} · ИМЯ</p>
          <h2 className="bm-h2">Научите меня узнавать ваш голос</h2>
          <p className="bm-hint">Так я буду откликаться на «Бурмалдец» и «Чекунец» именно у вас — займёт полминуты.</p>
          <WakeTrain />
          <div className="bm-onb-foot">
            <button className="bm-btn big" onClick={next}>
              Дальше
            </button>
            <button className="bm-linkbtn" onClick={next}>
              Пропустить — сделаю потом в настройках
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
