// Чаты и проекты: список слева направо — проекты с их чатами, чаты без проекта; внутри — переписка.
// Чату или проекту можно назначить агента (свой ИИ и характер), у проекта — общие инструкции.
import { useEffect, useState } from 'react'
import { getAgents } from './ai'
import { activeChat, addProject, deleteChat, deleteProject, listChats, listProjects, newChat, onChats, openChat, updateChat, updateProject, type Chat, type Project } from './chats'
import { IBack } from './Icons'

function useChats() {
  const [, set] = useState(0)
  useEffect(() => onChats(() => set((n) => n + 1)), [])
  return { chats: listChats(), projects: listProjects(), active: activeChat().id }
}

const when = (t: number) => {
  const d = new Date(t)
  const today = new Date().toDateString() === d.toDateString()
  return today ? d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

export default function ChatsPanel({ onClose }: { onClose: () => void }) {
  const { chats, projects, active } = useChats()
  const [view, setView] = useState<string | null>(null) // открытая переписка
  const [proj, setProj] = useState<Project | 'new' | null>(null) // редактор проекта
  const agents = getAgents()

  const go = (c: Chat) => {
    openChat(c.id)
    onClose()
  }
  const start = (projectId?: string) => {
    const p = projects.find((x) => x.id === projectId)
    newChat({ projectId, agentId: p?.agentId })
    onClose()
  }

  if (proj) return <ProjectEdit p={proj === 'new' ? null : proj} onDone={() => setProj(null)} />

  const shown = view ? chats.find((c) => c.id === view) : null
  if (shown)
    return (
      <div className="bm-chats" role="dialog" aria-label="Переписка">
        <div className="bm-set-top">
          <button className="bm-iconbtn" onClick={() => setView(null)} aria-label="Назад">
            <IBack />
          </button>
          <input className="bm-chat-title" value={shown.title} onChange={(e) => updateChat(shown.id, { title: e.target.value })} aria-label="Название чата" />
          <span />
        </div>
        <div className="bm-chat-meta">
          <select value={shown.projectId || ''} onChange={(e) => updateChat(shown.id, { projectId: e.target.value || undefined })} aria-label="Проект">
            <option value="">Без проекта</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                📁 {p.name}
              </option>
            ))}
          </select>
          <select value={shown.agentId || ''} onChange={(e) => updateChat(shown.id, { agentId: e.target.value || undefined })} aria-label="Агент">
            <option value="">Основной ассистент</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                🤖 {a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="bm-log">
          {shown.log.length ? (
            shown.log.map((m, i) => (
              <p key={i} className={'bm-msg ' + m.r}>
                {m.t}
                <time>{when(m.at)}</time>
              </p>
            ))
          ) : (
            <p className="bm-empty">Пока пусто</p>
          )}
        </div>
        <div className="bm-row">
          <button className="bm-btn" onClick={() => go(shown)}>
            {shown.id === active ? 'Продолжить' : 'Открыть этот чат'}
          </button>
          <button
            className="bm-btn ghost"
            onClick={() => {
              deleteChat(shown.id)
              setView(null)
            }}
          >
            Удалить
          </button>
        </div>
      </div>
    )

  const loose = chats.filter((c) => !c.projectId || !projects.some((p) => p.id === c.projectId))
  const row = (c: Chat) => (
    <button key={c.id} className={'bm-chat-row' + (c.id === active ? ' on' : '')} onClick={() => setView(c.id)}>
      <span>
        <b>{c.title}</b>
        <small>
          {when(c.updated)}
          {c.agentId && agents.find((a) => a.id === c.agentId) ? ' · 🤖 ' + agents.find((a) => a.id === c.agentId)!.name : ''}
          {c.log.length ? ` · ${c.log.length} реплик` : ''}
        </small>
      </span>
    </button>
  )
  return (
    <div className="bm-chats" role="dialog" aria-label="Чаты и проекты">
      <div className="bm-set-top">
        <button className="bm-iconbtn" onClick={onClose} aria-label="Назад">
          <IBack />
        </button>
        <h2>Чаты</h2>
        <span />
      </div>
      <div className="bm-row">
        <button className="bm-btn" onClick={() => start()}>
          + Новый чат
        </button>
        <button className="bm-btn ghost" onClick={() => setProj('new')}>
          + Проект
        </button>
      </div>
      <div className="bm-chat-list">
        {projects.map((p) => (
          <section key={p.id} className="bm-proj">
            <div className="bm-proj-h">
              <b>📁 {p.name}</b>
              <span>
                <button className="bm-linkbtn" onClick={() => start(p.id)}>
                  + чат
                </button>
                <button className="bm-linkbtn" onClick={() => setProj(p)}>
                  настроить
                </button>
              </span>
            </div>
            {chats.filter((c) => c.projectId === p.id).map(row)}
          </section>
        ))}
        {loose.length > 0 && (
          <section className="bm-proj">
            {projects.length > 0 && (
              <div className="bm-proj-h">
                <b>Без проекта</b>
              </div>
            )}
            {loose.map(row)}
          </section>
        )}
      </div>
    </div>
  )
}

function ProjectEdit({ p, onDone }: { p: Project | null; onDone: () => void }) {
  const [name, setName] = useState(p?.name || '')
  const [ins, setIns] = useState(p?.instructions || '')
  const [agentId, setAgent] = useState(p?.agentId || '')
  const agents = getAgents()
  const save = () => {
    if (p) updateProject(p.id, { name: name.trim() || p.name, instructions: ins, agentId: agentId || undefined })
    else addProject({ name, instructions: ins, agentId: agentId || undefined })
    onDone()
  }
  return (
    <div className="bm-chats" role="dialog" aria-label="Проект">
      <div className="bm-set-top">
        <button className="bm-iconbtn" onClick={onDone} aria-label="Назад">
          <IBack />
        </button>
        <h2>{p ? 'Проект' : 'Новый проект'}</h2>
        <span />
      </div>
      <label className="bm-field">
        <span>Название</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Например: Учёба, Работа, Сайт" autoFocus />
      </label>
      <label className="bm-field">
        <span>Инструкции для всех чатов проекта</span>
        <textarea rows={6} value={ins} onChange={(e) => setIns(e.target.value)} placeholder="Например: я учусь в 8 классе; объясняй химию простыми словами и с примерами" />
      </label>
      <label className="bm-field">
        <span>Агент проекта</span>
        <select value={agentId} onChange={(e) => setAgent(e.target.value)}>
          <option value="">Основной ассистент</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              🤖 {a.name}
            </option>
          ))}
        </select>
      </label>
      <div className="bm-row">
        <button className="bm-btn" onClick={save}>
          Сохранить
        </button>
        {p && (
          <button
            className="bm-btn ghost"
            onClick={() => {
              deleteProject(p.id)
              onDone()
            }}
          >
            Удалить проект
          </button>
        )}
      </div>
    </div>
  )
}
