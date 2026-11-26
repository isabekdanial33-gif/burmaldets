// «Что Гудвин обо мне знает»: запомненные факты, заметки и траты — посмотреть и удалить. Всё хранится только на этом устройстве.
import { useState } from 'react'
import { forgetLine, memoryFacts } from './memory'
import { allNotes, deleteNoteAt } from './notes'
import { clearExpenses, report } from './expenses'

export default function MemoryPanel() {
  const [, bump] = useState(0)
  const refresh = () => bump((x) => x + 1)
  const [sure, setSure] = useState(false)
  const facts = memoryFacts()
  const notes = allNotes()
  const month = report('month')
  const all = report('all')
  return (
    <div className="shef-mem">
      <b>Что Гудвин обо мне помнит</b>
      <small>Хранится только на этом телефоне. Скажите «запомни…» или «забудь…», либо удалите здесь.</small>
      {facts.length ? (
        <ul>
          {facts.map((f) => (
            <li key={f}>
              <span>{f}</span>
              <button className="shef-x" aria-label={'Забыть: ' + f} onClick={() => (forgetLine(f), refresh())}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <small>Пока ничего.</small>
      )}
      <b>Заметки: {notes.length}</b>
      {notes.length > 0 && (
        <ul>
          {notes.slice(0, 20).map((n) => (
            <li key={n.at}>
              <span>{n.text}</span>
              <button className="shef-x" aria-label={'Удалить заметку: ' + n.text} onClick={() => (deleteNoteAt(n.at), refresh())}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <b>Расходы</b>
      <small>
        {all.count
          ? `В этом месяце: ${month.total.toLocaleString('ru-RU')} ${month.currency === 'KZT' ? '₸' : month.currency} (${month.count} зап.). Всего записей: ${all.count}.`
          : 'Трат пока нет. Скажите, например: «потратил 2000 на такси».'}
      </small>
      {all.count > 0 && (
        <button className="btn" onClick={() => (sure ? (clearExpenses(), setSure(false), refresh()) : setSure(true))} onBlur={() => setSure(false)}>
          {sure ? 'Точно удалить все траты? Нажмите ещё раз' : 'Очистить расходы'}
        </button>
      )}
    </div>
  )
}
