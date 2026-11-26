// Суб-агенты: главный ассистент поручает задачу помощнику со своим провайдером, ключом и моделью
// (например: «программист» на Claude, «переводчик» на GPT, «исследователь» на Gemini) и получает ответ текстом.
import { agentBrain, getAgents, findAgent } from './ai'
import { chat, LlmError } from './llm'

type Obj = Record<string, unknown>

export const SUB_EXEC: Record<string, (a: Obj) => Promise<Obj>> = {
  async ask_agent(a) {
    const ag = findAgent(String(a.agent || ''))
    if (!ag) return { ok: false, error: 'нет такого агента', agents: getAgents().map((x) => x.name) }
    const task = String(a.task || '').trim()
    if (!task) return { ok: false, error: 'какую задачу поручить?' }
    try {
      const { content, model } = await chat(
        {
          systemInstruction: { parts: [{ text: `Ты — ${ag.name}, помощник голосового ассистента. Тебе поручили задачу — выполни её полностью и по делу. Отвечай по-русски, если не просят иначе.\n${ag.instructions || ''}` }] },
          contents: [{ role: 'user', parts: [{ text: task + (a.context ? '\n\nКонтекст:\n' + String(a.context).slice(0, 6000) : '') }] }],
          generationConfig: { temperature: 0.6, maxOutputTokens: 2000 },
        },
        agentBrain(ag),
      )
      const text = content.parts
        .filter((p) => p.text && !p.thought)
        .map((p) => p.text)
        .join(' ')
        .trim()
      return { ok: true, agent: ag.name, model, answer: text.slice(0, 8000), note: 'Перескажи пользователю суть ответа агента своими словами, коротко.' }
    } catch (e) {
      const code = e instanceof LlmError ? e.code : 'busy'
      return { ok: false, agent: ag.name, error: code === 'key' ? 'ключ агента не подошёл' : code === 'quota' ? 'дневной лимит исчерпан' : code === 'model' ? 'модель агента не отвечает' : 'агент не ответил: ' + code }
    }
  },
}

/** Описание инструмента с именами суб-агентов — только если они есть. */
export function subDecl() {
  const subs = getAgents().filter((a) => a.sub)
  if (!subs.length) return null
  return {
    name: 'ask_agent',
    description:
      'Поручить задачу суб-агенту (у него свой ИИ). Зови, когда задача по его профилю или пользователь просит «спроси у …». Доступны: ' +
      subs.map((a) => `${a.name}${a.instructions ? ' — ' + a.instructions.slice(0, 80) : ''}`).join('; '),
    parameters: {
      type: 'object',
      properties: {
        agent: { type: 'string', description: 'Имя агента', enum: subs.map((a) => a.name) },
        task: { type: 'string', description: 'Что сделать — полная самостоятельная формулировка' },
        context: { type: 'string', description: 'Нужные данные из разговора (необязательно)' },
      },
      required: ['agent', 'task'],
    },
  }
}
