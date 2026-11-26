// Агенты и суб-агенты: у каждого свой провайдер, ключ, модель и характер.
// Агенту можно отдать чат или проект целиком; суб-агента главный зовёт на помощь сам (ask_agent).
import { useState } from 'react'
import { getCfg, listModels, PROVIDERS, provider, setCfg, type Agent, type ModelInfo, type ProviderId } from './ai'
import { ping } from './llm'
import { useCfg } from './Setup'

const uid = () => Math.random().toString(36).slice(2, 10)
const empty = (): Agent => ({ id: '', name: '', provider: getCfg().provider, key: '', model: '', instructions: '', sub: true })

export default function AgentsPanel() {
  const cfg = useCfg()
  const agents = cfg.agents || []
  const [edit, setEdit] = useState<Agent | null>(null)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const open = (a: Agent | null) => {
    setEdit(a ? { ...a } : empty())
    setModels([])
    setMsg('')
  }
  const load = async (a: Agent) => {
    setBusy(true)
    setMsg('Загружаю модели…')
    const r = await listModels(a.provider, a.key || (a.provider === getCfg().provider ? getCfg().keys[a.provider] : '') || '', a.base)
    setBusy(false)
    if (!r.ok) return setMsg(r.error || 'Не получилось')
    const chat = r.models.filter((m) => m.chat)
    setModels(chat)
    setMsg(`Моделей: ${chat.length}`)
    if (!a.model || !chat.some((m) => m.id === a.model)) setEdit({ ...a, model: chat.find((m) => provider(a.provider).models.includes(m.id))?.id || chat[0]?.id || '' })
  }
  const save = () => {
    if (!edit) return
    if (!edit.name.trim() || !edit.model) return setMsg('Нужны имя и модель')
    const a = { ...edit, id: edit.id || uid(), name: edit.name.trim() }
    setCfg({ agents: [...agents.filter((x) => x.id !== a.id), a] })
    setEdit(null)
  }
  const test = async () => {
    if (!edit) return
    setMsg('Спрашиваю…')
    // проверка тем же путём, что и в работе: со своим ключом агента
    const r = await ping(edit.provider, edit.model, edit.key || edit.base ? { provider: edit.provider, model: edit.model, key: edit.key || undefined, base: edit.base, who: 'test' } : undefined)
    setMsg(r.ok ? `Отвечает за ${(r.ms / 1000).toFixed(1)} с` : `Ошибка: ${r.error?.slice(0, 160)}`)
  }

  if (edit)
    return (
      <div className="bm-agent-edit">
        <label className="bm-field">
          <span>Имя</span>
          <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Например: Программист" />
        </label>
        <label className="bm-field">
          <span>Провайдер</span>
          <select value={edit.provider} onChange={(e) => (setEdit({ ...edit, provider: e.target.value as ProviderId, model: '' }), setModels([]))}>
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {edit.provider === 'custom' && (
          <label className="bm-field">
            <span>Адрес сервера</span>
            <input value={edit.base || ''} onChange={(e) => setEdit({ ...edit, base: e.target.value })} placeholder="http://localhost:11434/v1" />
          </label>
        )}
        <label className="bm-field">
          <span>
            API-ключ агента <small>(пусто — общий ключ этого провайдера)</small>
          </span>
          <span className="bm-keyrow">
            <input type="password" value={edit.key} onChange={(e) => setEdit({ ...edit, key: e.target.value })} autoComplete="off" spellCheck={false} />
            <button type="button" className="bm-btn ghost" onClick={() => load(edit)} disabled={busy}>
              Модели
            </button>
          </span>
        </label>
        <label className="bm-field">
          <span>Модель</span>
          {models.length ? (
            <select value={edit.model} onChange={(e) => setEdit({ ...edit, model: e.target.value })}>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id + (m.free ? ' — бесплатно' : '')}
                </option>
              ))}
            </select>
          ) : (
            <input value={edit.model} onChange={(e) => setEdit({ ...edit, model: e.target.value })} placeholder="нажмите «Модели» — появится список" />
          )}
        </label>
        <label className="bm-field">
          <span>Характер и задачи</span>
          <textarea rows={4} value={edit.instructions} onChange={(e) => setEdit({ ...edit, instructions: e.target.value })} placeholder="Например: опытный программист на Python, отвечает кодом и коротко объясняет" />
        </label>
        <label className="bm-toggle">
          <span>
            <b>Суб-агент</b>
            <small>Главный ассистент сам зовёт его на помощь по профилю («спроси у программиста…»)</small>
          </span>
          <input type="checkbox" role="switch" checked={edit.sub} onChange={(e) => setEdit({ ...edit, sub: e.target.checked })} />
          <i aria-hidden />
        </label>
        <div className="bm-row">
          <button className="bm-btn" onClick={save}>
            Сохранить
          </button>
          <button className="bm-btn ghost" onClick={test} disabled={!edit.model}>
            Проверить
          </button>
          <button className="bm-linkbtn" onClick={() => setEdit(null)}>
            Отмена
          </button>
        </div>
        {msg && <small className="bm-note">{msg}</small>}
      </div>
    )

  return (
    <div className="bm-agents">
      <p className="bm-hint">
        Агент — отдельный ИИ со своим провайдером, ключом и характером. Ему можно отдать чат или проект целиком (в «Чатах»), а суб-агентов главный зовёт на помощь сам.
      </p>
      {agents.map((a) => (
        <button key={a.id} className="bm-acc-row" onClick={() => open(a)}>
          <span>
            <b>
              {a.name} {a.sub && <i className="bm-tag">суб-агент</i>}
            </b>
            <small>
              {provider(a.provider).name} · {a.model}
            </small>
          </span>
          <span
            className="bm-chip"
            role="button"
            onClick={(e) => {
              e.stopPropagation()
              setCfg({ agents: agents.filter((x) => x.id !== a.id) })
            }}
          >
            Удалить
          </span>
        </button>
      ))}
      <button className="bm-btn" onClick={() => open(null)}>
        + Новый агент
      </button>
    </div>
  )
}
