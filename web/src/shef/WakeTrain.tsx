// Обучение имени под голос хозяина. Распознаватель на устройстве (Vosk) не знает слов «Бурмалдец» и «Чекунец»
// и у каждого голоса подбирает своё похожее («отец», «бурма отец»...). Человек говорит имя несколько раз —
// мы запоминаем, что именно было услышано, и дальше это тоже будит ассистента.
import { useRef, useState } from 'react'
import { getCfg, setCfg } from './ai'
import { isAndroid, nativeCall } from './bridge'
import { deskListen } from './desk'
import { isDesktop } from './net'
import { chime, micLevel, stopWake } from './speech'
import { norm, wakeEnd } from './wake'

const ASK = ['Бурмалдец', 'Бурмалдец', 'Бурмалдец', 'Чекунец', 'Чекунец']
/** Слишком частые слова — такое «имя» будило бы ассистента от любого разговора. */
const COMMON = new Set('а и но да нет не ну вот так это то он она они мы вы я ты что как где там тут уже еще ещё все всё бы же ли или если когда'.split(' '))

/** Где можно учить: на телефоне и в приложении для компьютера (там слушает Vosk). */
export const canTrain = isAndroid || isDesktop

async function hearOnce(): Promise<string> {
  if (isAndroid) {
    const r = await nativeCall<{ text?: string; error?: string }>('wakeHear', { timeout: 6000 }, 9000)
    if (r.error) throw new Error(r.error)
    return r.text || ''
  }
  const r = await deskListen(undefined, micLevel, true)
  return r.text
}

/** Отправляем выученные фразы службе на телефоне (она слушает имя без приложения). */
export function syncWakeExtra() {
  if (isAndroid) nativeCall('wakeExtra', { list: getCfg().wakeExtra || [] }, 4000).catch(() => {})
}

type Try = { want: string; heard: string; note: string }

export default function WakeTrain() {
  const [list, setList] = useState<string[]>(getCfg().wakeExtra || [])
  const [run, setRun] = useState<{ i: number; state: 'ready' | 'listen' | 'done' } | null>(null)
  const [tries, setTries] = useState<Try[]>([])
  const [err, setErr] = useState('')
  const box = useRef<HTMLDivElement>(null)

  const save = (l: string[]) => {
    setList(l)
    setCfg({ wakeExtra: l })
    syncWakeExtra()
  }
  const finish = () => {
    setRun((r) => r && { ...r, state: 'done' })
    if (isAndroid) nativeCall('sleep', {}, 4000).catch(() => {})
    else window.dispatchEvent(new Event('bm:rewake'))
  }

  const start = async () => {
    setErr('')
    setTries([])
    box.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    if (!isAndroid) stopWake()
    const learned = [...list]
    const got: Try[] = []
    for (let i = 0; i < ASK.length; i++) {
      setRun({ i, state: 'listen' })
      void chime()
      let heard = ''
      try {
        heard = norm(await hearOnce())
      } catch (e) {
        setErr('Не получилось включить микрофон: ' + String(e).slice(0, 120))
        break
      }
      let note: string
      const words = heard.split(' ').filter(Boolean)
      if (!heard) note = 'ничего не услышал'
      else if (wakeEnd(heard, []) >= 0) note = 'узнаю и так ✓'
      else if (words.length > 3) note = 'слишком длинно — скажите только имя'
      else if (words.length === 1 && (COMMON.has(heard) || heard.length < 3)) note = 'слишком частое слово — не запоминаю'
      else if (learned.includes(heard)) note = 'уже запомнил ✓'
      else {
        learned.push(heard)
        note = 'запомнил ✓'
      }
      got.push({ want: ASK[i], heard, note })
      setTries([...got])
    }
    save(learned)
    finish()
  }

  const cur = run && run.state !== 'done' ? ASK[run.i] : ''
  return (
    <div className="bm-train" ref={box}>
      <div className="bm-train-h">
        <b>Узнавать имя моим голосом</b>
        <small>
          Распознаватель на устройстве не знает слов «Бурмалдец» и «Чекунец» и слышит их по-своему — у кого «бур молодец», у кого «отец». Скажите имя
          {' ' + ASK.length} раз — запомню, как оно звучит у вас.
        </small>
      </div>
      {cur ? (
        <div className="bm-train-now" aria-live="polite">
          <span>
            {run!.i + 1} из {ASK.length}
          </span>
          Скажите: <b>«{cur}»</b>
          <i className="bm-train-dot" />
        </div>
      ) : (
        <button type="button" className="bm-btn" onClick={start}>
          {list.length ? 'Обучить ещё раз' : 'Начать обучение'}
        </button>
      )}
      {err && <p className="bm-check bad">{err}</p>}
      {tries.length > 0 && (
        <ul className="bm-train-log">
          {tries.map((t, i) => (
            <li key={i}>
              <span>«{t.want}»</span> → <code>{t.heard || '—'}</code> <em>{t.note}</em>
            </li>
          ))}
        </ul>
      )}
      {list.length > 0 && (
        <div className="bm-train-list">
          <small>Ещё узнаю как:</small>
          {list.map((p) => (
            <button type="button" key={p} className="bm-chip" onClick={() => save(list.filter((x) => x !== p))} title="Забыть">
              {p} <span aria-hidden>✕</span>
            </button>
          ))}
          {list.some((p) => !p.includes(' ')) && (
            <small className="bm-note">
              Одно обычное слово будит, только если сказать его отдельно или с паузой после него: «{list.find((p) => !p.includes(' '))}, … ». Так «мой{' '}
              {list.find((p) => !p.includes(' '))} сказал…» в разговоре меня не разбудит.
            </small>
          )}
        </div>
      )}
    </div>
  )
}
