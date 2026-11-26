// Экран Бурмалдеца. Три вида: весь экран (приложение), «шторка» поверх других приложений (телефон, плавающая кнопка
// или слово-активатор) и панель рядом с шаром на рабочем столе (компьютер).
import { afterWake, wakeEnd } from './wake'
import { syncWakeExtra } from './WakeTrain'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { go } from '../ui'
import { ask, stopAsk } from './agent'
import type { Emotion } from './brain'
import Holo, { type Phase } from './Holo'
import Pyramid from './Pyramid'
import Help from './Help'
import CardView, { type Card } from './Card'
import Settings from './Settings'
import Onboarding from './Setup'
import { getCfg } from './ai'
import { isAndroid, nativeCall, onNative } from './bridge'
import { isDesktop } from './net'
import { shefLog } from './log'
import { cancelListen, canHear, chime, listen, say, startWake, stopSpeaking, stopWake, unlockAudio } from './speech'
import { deskCall, ui } from './tools'
import { getMode, onMode, setMode, type Mode } from './mode'
import { ICam, IClose, IGear, IHelp, IKey, IMic, ISend } from './Icons'

const TIPS: Record<Mode, string[]> = {
  general: ['Какая погода завтра?', 'Курс доллара', 'Главные новости', 'Напомни через час позвонить маме', 'Что у меня сегодня?', 'Разбуди меня в 7', 'Включи что-нибудь спокойное', 'Потратил 2000 на такси', 'Доброе утро', 'Где я?', 'Расскажи анекдот', 'Сколько будет 15% от 8400?'],
  cook: ['Найди курицу на ужин', 'Что приготовить из того, что есть?', 'Поставь таймер на 10 минут', 'Что в списке покупок?', 'Выйди из режима повара'],
}
const DESK_TIPS = ['Открой YouTube', 'Что у меня на экране?', 'Сделай погромче', 'Поставь таймер на 5 минут', 'Включи лофи', 'Курс доллара']

const photoPrompt = () =>
  getMode() === 'cook'
    ? 'Что на этом фото? Если это блюдо — скажи, что это, и найди похожий рецепт в каталоге. Если продукты — предложи, что из них приготовить.'
    : 'Что на этом фото? Коротко опиши главное. Если там текст — прочитай или переведи его.'

const ONLY_NAME = /^(?:эй|ну|алло|слышь)?[\s,]*(?:бур\s*м[оа]л\S*|бурм[оа]лд\S*|бур молодец|чекун\S*|чеку нет)[\s.!?,]*$/i
/** Имя голосом хозяина (из обучения, например «отец») без команды. */
const onlyName = (q: string) => {
  const e = wakeEnd(q)
  return e >= 0 && !afterWake(q, e).replace(/^(?:эй|ну|алло|слышь)\s*/, '')
}
const GREET = ['Слушаю.', 'Да, слушаю.', 'Да-да, я здесь.', 'Я тут.']
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]
let lastTalk = 0
const WAKE_KEY = 'bm:wake'
const PYR_KEY = 'shef:pyramid'
type Layout = 'full' | 'sheet' | 'panel'

async function toJpeg(file: Blob): Promise<string> {
  const bmp = await createImageBitmap(file)
  const k = Math.min(1, 1024 / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * k)
  c.height = Math.round(bmp.height * k)
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  return c.toDataURL('image/jpeg', 0.82).split(',')[1]
}

const STATUS: Record<Phase, string> = { sleep: 'ожидание', idle: 'онлайн', listen: 'слушаю', think: 'думаю', speak: 'говорю' }

export default function ShefPage() {
  const [setup, setSetup] = useState(() => getCfg().setup)
  if (!setup) return <Onboarding onDone={() => setSetup(true)} />
  return <Assistant />
}

function Assistant() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [emotion, setEmotion] = useState<Emotion>('спокойно')
  const [heard, setHeard] = useState('')
  const [reply, setReply] = useState('')
  const [typing, setTyping] = useState(!canHear)
  const [text, setText] = useState('')
  const typingRef = useRef(typing)
  typingRef.current = typing
  const [settings, setSettings] = useState(false)
  const [help, setHelp] = useState(false)
  const [poke, setPoke] = useState(0)
  const [link, setLink] = useState(ui.link)
  const [card, setCard] = useState<Card | null>(null)
  const [photoAsk, setPhotoAsk] = useState(false)
  const [pyramid, setPyramid] = useState(() => localStorage.getItem(PYR_KEY) === '1')
  const [layout, setLayout] = useState<Layout>(isDesktop ? 'panel' : 'full')
  const layoutRef = useRef(layout)
  layoutRef.current = layout
  const [mode, setModeState] = useState<Mode>(getMode())
  useEffect(() => onMode(setModeState), [])
  // «шторка» и панель на компьютере: страница прозрачная, видно приложение под ней
  useEffect(() => {
    document.documentElement.classList.toggle('bm-clear', layout !== 'full')
  }, [layout])
  const tips = useMemo(() => {
    const l = [...(isDesktop && mode === 'general' ? DESK_TIPS : TIPS[mode])]
    for (let i = l.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[l[i], l[j]] = [l[j], l[i]]
    }
    return l.slice(0, 4)
  }, [mode])
  // на компьютере слушаем имя по умолчанию (в приложении), в браузере — по галочке
  const [wakeOn, setWakeOn] = useState(() => !isAndroid && canHear && (localStorage.getItem(WAKE_KEY) ?? (isDesktop ? '1' : '0')) === '1')
  const busy = useRef(false)
  /** Нажали «Стоп»: разговор обрывается, ничего не говорим и не слушаем дальше. */
  const halt = useRef(false)
  /** Что сейчас делает на компьютере («Нажимаю «Сохранить»») — видно под шаром. */
  const [act, setAct] = useState('')
  useEffect(() => {
    const f = (e: Event) => setAct(String((e as CustomEvent).detail || ''))
    window.addEventListener('bm:act', f)
    return () => window.removeEventListener('bm:act', f)
  }, [])
  const queued = useRef<{ q?: string; image?: string } | null>(null)
  const alive = useRef(true)
  const fileRef = useRef<HTMLInputElement>(null)
  const photoResolve = useRef<((v: string | null) => void) | null>(null)
  const idleClose = useRef(0)

  // «шторка» поверх приложений сама прячется, если разговор закончился и ничего не трогают
  const armClose = useCallback(() => {
    clearTimeout(idleClose.current)
    if (layoutRef.current === 'sheet') idleClose.current = window.setTimeout(() => !busy.current && closeSheet(), 9000)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const touch = () => clearTimeout(idleClose.current)

  const sleep = useCallback(() => {
    if (!alive.current) return
    setPhase(isAndroid || wakeOn ? 'sleep' : 'idle')
    if (isAndroid) nativeCall('sleep', {}, 3000).catch(() => {})
    armClose()
  }, [wakeOn, armClose])

  /** Разговор: приветствие → слушаем → ответ → ещё раз слушаем (без имени), пока человек говорит. */
  const converse = useCallback(
    async (first?: string, image?: string) => {
      touch()
      if (busy.current) {
        if (first !== undefined || image) {
          queued.current = { q: first, image }
          stopSpeaking()
          cancelListen()
        }
        return
      }
      busy.current = true
      halt.current = false
      stopWake()
      setLink(null)
      ui.link = null
      try {
        let q = first
        if (q === undefined && !image && Date.now() - lastTalk > 10 * 60000) {
          setEmotion('слушаю')
          setPhase('speak')
          await say(pick(GREET))
        }
        for (let turn = 0; alive.current && turn < 30; turn++) {
          if (q === undefined && !image) {
            let h = { text: '', how: '' }
            for (let tryN = 0; tryN < 2 && alive.current && !h.text; tryN++) {
              setPhase('listen')
              setHeard(tryN ? 'Не расслышал — скажите ещё раз' : '')
              await chime()
              if (!alive.current) return
              h = await listen(setHeard)
              if (halt.current) return
              if (queued.current) break
              if (!h.text && h.how !== 'cancel') shefLog('не расслышал', h.how || 'тишина')
            }
            if (!alive.current) return
            if (queued.current) {
              ;({ q, image } = queued.current)
              queued.current = null
              if (q === undefined && !image) continue
            } else q = h.text
            // сказали только имя («Бурмалдец!») — значит, ждут, что слушаю: слушаем дальше, без ответа
            if (q && (ONLY_NAME.test(q.trim()) || onlyName(q)) && turn < 28) {
              q = undefined
              continue
            }
            if (!q) {
              chime(false)
              break
            }
          }
          setHeard(q || '📷')
          setReply('')
          setCard(null)
          ui.card = null
          setLink(null)
          ui.link = null
          setPhase('think')
          setEmotion('думаю')
          const r = await ask(q || '', { image })
          lastTalk = Date.now()
          image = undefined
          if (!alive.current) return
          if (halt.current || r.stopped) {
            setReply('')
            return
          }
          if (r.text) {
            const c = ui.card
            ui.card = null
            await say(r.text, () => {
              setEmotion(r.emotion)
              setReply(r.text)
              setCard(c)
              setPhase('speak')
            })
          } else setReply('')
          if (!alive.current || halt.current) return
          if (ui.nav) {
            const to = ui.nav
            ui.nav = null
            go(to)
            return
          }
          if (queued.current) {
            ;({ q, image } = queued.current)
            queued.current = null
            continue
          }
          if (!r.text || /^(пока|до свидания|отбой|спи|хватит|стоп|все спасибо|всё спасибо|свободен)/i.test(q || '')) break
          if (!canHear || typingRef.current) break
          q = undefined
        }
      } finally {
        busy.current = false
        sleep()
      }
    },
    [sleep],
  )

  const closeSheet = () => {
    stopSpeaking()
    cancelListen()
    if (isAndroid) nativeCall('close', {}, 3000).catch(() => {})
    else if (isDesktop) void deskCall('hidePanel', {})
  }

  useEffect(() => {
    alive.current = true
    const offs = [
      onNative('wake', (d) => {
        // с плавающей кнопки или по имени, когда открыто другое приложение — показываемся «шторкой»
        const sheet = !!(d as { sheet?: boolean } | null)?.sheet
        setLayout(isDesktop ? 'panel' : sheet ? 'sheet' : 'full')
        converse()
      }),
      onNative('layout', (d) => setLayout(isDesktop ? 'panel' : (d as { sheet?: boolean } | null)?.sheet ? 'sheet' : 'full')),
      onNative('back', () => (layoutRef.current === 'sheet' ? closeSheet() : close())),
      onNative('command', (d) => converse(String(d || ''))),
      onNative('stop', () => stopAll()),
      // напоминание или таймер на компьютере: просто сказать вслух
      onNative('say', (d) => {
        const t = String(d || '')
        if (!t || busy.current) return
        setReply(t)
        setEmotion('радость')
        setPhase('speak')
        say(t).finally(sleep)
      }),
    ]
    const f = () => setLink(ui.link)
    ui.listeners.add(f)
    ui.photo = () =>
      new Promise((res) => {
        photoResolve.current = res
        setPhotoAsk(true)
        setTimeout(() => {
          if (photoResolve.current === res) {
            photoResolve.current = null
            setPhotoAsk(false)
            res(null)
          }
        }, 90000)
      })
    if (isAndroid) {
      syncWakeExtra()
      nativeCall<{ wake?: boolean; cmd?: string | null; say?: string | null; sheet?: boolean }>('ready', {}, 5000)
        .then((r) => {
          if (r.sheet) setLayout('sheet')
          if (r.say) {
            setReply(r.say)
            setEmotion('радость')
            setPhase('speak')
            say(r.say).finally(sleep)
          } else if (r.cmd) converse(r.cmd)
          else if (r.wake) converse()
          else sleep()
        })
        .catch(sleep)
    } else sleep()
    return () => {
      alive.current = false
      offs.forEach((o) => o())
      ui.listeners.delete(f)
      ui.photo = null
      stopSpeaking()
      stopWake()
      clearTimeout(idleClose.current)
      if (isAndroid) nativeCall('leave', {}, 3000).catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // шар на рабочем столе повторяет состояние: слушаю / думаю / говорю
  useEffect(() => {
    if (isDesktop) void deskCall('phase', { phase })
  }, [phase])

  // после обучения голосу слух перезапускается (оно забирало микрофон)
  const [rewake, setRewake] = useState(0)
  useEffect(() => {
    const f = () => setRewake((n) => n + 1)
    window.addEventListener('bm:rewake', f)
    return () => window.removeEventListener('bm:rewake', f)
  }, [])
  useEffect(() => {
    if (!isAndroid && wakeOn && (phase === 'sleep' || phase === 'idle') && !busy.current) startWake((rest) => converse(rest || undefined))
    if (!wakeOn) stopWake()
  }, [phase, wakeOn, converse, rewake])

  const close = () => {
    alive.current = false
    stopSpeaking()
    stopWake()
    if (isAndroid) nativeCall('close', {}, 3000).catch(() => {})
    else if (isDesktop) void deskCall('hidePanel', {})
  }

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || settings || help) return
      if (busy.current) return stopAll()
      if (layoutRef.current !== 'full') closeSheet()
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  })

  /** «Стоп»: замолчать, бросить ответ и остановить действия на компьютере. */
  function stopAll() {
    halt.current = true
    queued.current = null
    stopAsk()
    stopSpeaking()
    cancelListen()
    if (isDesktop) void deskCall('pcStop', {})
    setAct('')
    setReply('')
    setHeard('')
    setPhase(isAndroid || wakeOn ? 'sleep' : 'idle')
  }

  const tapOrb = () => {
    unlockAudio()
    touch()
    setPoke((p) => p + 1)
    if (busy.current) return stopAll()
    converse()
  }

  const sendText = (e: React.FormEvent) => {
    e.preventDefault()
    const t = text.trim()
    if (!t) return
    unlockAudio()
    setText('')
    converse(t)
  }

  const onFile = async (f: File | undefined) => {
    if (!f) {
      photoResolve.current?.(null)
      return
    }
    const b64 = await toJpeg(f)
    if (photoResolve.current) {
      photoResolve.current(b64)
      photoResolve.current = null
      setPhotoAsk(false)
      return
    }
    unlockAudio()
    converse(text.trim() || photoPrompt(), b64)
    setText('')
  }

  const takePhoto = async () => {
    unlockAudio()
    if (isAndroid) {
      const r = await nativeCall<{ jpeg?: string }>('takePhoto', {}, 180000).catch(() => ({ jpeg: undefined }))
      if (r.jpeg) converse(text.trim() || photoPrompt(), r.jpeg)
    } else fileRef.current?.click()
  }

  const status =
    phase === 'listen' ? 'Слушаю…' : phase === 'think' ? act || 'Думаю…' : phase === 'speak' ? '' : isAndroid || wakeOn ? 'Скажите «Бурмалдец» или «Чекунец»' : 'Нажмите на шар и говорите'

  const setPyr = (on: boolean) => {
    setPyramid(on)
    localStorage.setItem(PYR_KEY, on ? '1' : '0')
    if (isAndroid) nativeCall('speakerMode', { on }, 4000).catch(() => {})
  }
  const settingsEl = settings && (
    <Settings
      onClose={() => setSettings(false)}
      wakeOn={wakeOn}
      setWakeOn={(v) => (setWakeOn(v), localStorage.setItem(WAKE_KEY, v ? '1' : '0'))}
      pyramid={pyramid}
      setPyramid={setPyr}
    />
  )

  if (pyramid)
    return (
      <div className="shef shef-pyr" onClick={tapOrb}>
        <Pyramid phase={phase} emotion={emotion} poke={poke} />
        <button className="bm-iconbtn pyr-gear" onClick={(e) => (e.stopPropagation(), setSettings(true))} aria-label="Настройки">
          <IGear />
        </button>
        {settingsEl}
      </div>
    )

  const idle = (phase === 'idle' || phase === 'sleep') && !reply
  const compact = layout !== 'full'
  return (
    <div className={'bm bm-' + layout + ' ph-' + phase} onPointerDown={touch}>
      {layout === 'sheet' && <div className="bm-scrim" onClick={closeSheet} aria-label="Закрыть" />}
      {layout === 'full' && (
        <div className="bm-aurora" aria-hidden>
          <i />
          <i />
          <i />
        </div>
      )}
      <div className="bm-shell">
        <header className="bm-top">
          <div className="bm-brand">
            <span className={'bm-pulse ph-' + phase} />
            <span className="bm-word">БУРМАЛДЕЦ</span>
            <span className="bm-state">{STATUS[phase]}</span>
            {mode === 'cook' && (
              <button className="bm-chip" onClick={() => setMode('general')} title="Выйти из режима повара" aria-label="Режим повара включён. Нажмите, чтобы выйти">
                повар <IClose size={12} />
              </button>
            )}
          </div>
          <div className="bm-top-r">
            <button className="bm-iconbtn" onClick={() => setHelp(true)} aria-label="Что умеет Бурмалдец">
              <IHelp size={20} />
            </button>
            <button className="bm-iconbtn" onClick={() => setSettings(true)} aria-label="Настройки">
              <IGear size={20} />
            </button>
            {compact && (
              <button className="bm-iconbtn" onClick={closeSheet} aria-label="Свернуть">
                <IClose size={20} />
              </button>
            )}
          </div>
        </header>

        <button className="bm-stage" onClick={tapOrb} aria-label="Бурмалдец — нажмите, чтобы поговорить">
          <span className="bm-halo" aria-hidden />
          <Holo phase={phase} emotion={emotion} poke={poke} bare={compact} />
        </button>

        <section className="bm-subs" aria-live="polite">
          {heard && <p className="bm-heard">{heard}</p>}
          {reply && phase !== 'listen' && card?.kind !== 'news' && <p className="bm-reply">{reply}</p>}
          {card && phase !== 'listen' && <CardView card={card} />}
          {status && <p className="bm-status">{status}</p>}
          {idle && (
            <div className="bm-tips" aria-label="Примеры команд">
              {tips.map((t) => (
                <button key={t} className="shef-tip" onClick={() => (unlockAudio(), converse(t))}>
                  {t}
                </button>
              ))}
            </div>
          )}
          {link && (
            <a className="bm-link" href={link.url} target="_blank" rel="noopener noreferrer" onClick={() => setLink(null)}>
              {link.label}
            </a>
          )}
          {photoAsk && (
            <button className="bm-link" onClick={() => fileRef.current?.click()}>
              Выберите фото
            </button>
          )}
        </section>

        <nav className="bm-dock">
          <button className="bm-iconbtn" onClick={takePhoto} aria-label={isDesktop ? 'Показать картинку' : 'Показать фото'}>
            <ICam />
          </button>
          {typing ? (
            <form className="bm-form" onSubmit={sendText}>
              {(phase === 'think' || phase === 'speak') && (
                <button type="button" className="bm-stop-s" onClick={stopAll} aria-label="Стоп" title="Остановить ответ (Esc)">
                  <i aria-hidden />
                </button>
              )}
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Напишите Бурмалдецу…" aria-label="Сообщение" autoFocus={!isAndroid} />
              <button className="bm-send" aria-label="Отправить">
                <ISend size={18} />
              </button>
            </form>
          ) : phase === 'think' || phase === 'speak' ? (
            <button className="bm-mic bm-stop" onClick={stopAll} aria-label="Стоп" title="Остановить ответ (Esc)">
              <i aria-hidden />
            </button>
          ) : (
            <button className={'bm-mic' + (phase === 'listen' ? ' on' : '')} onClick={tapOrb} aria-label="Говорить">
              <IMic size={26} />
            </button>
          )}
          <button className="bm-iconbtn" onClick={() => setTyping((t) => !t)} aria-label={typing ? 'Голосом' : 'Написать текстом'}>
            {typing ? <IMic /> : <IKey />}
          </button>
        </nav>
      </div>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => (onFile(e.target.files?.[0]), (e.target.value = ''))} />

      {settingsEl}
      {help && <Help mode={mode} onClose={() => setHelp(false)} onPick={(t) => (setHelp(false), unlockAudio(), converse(t))} />}
    </div>
  )
}
