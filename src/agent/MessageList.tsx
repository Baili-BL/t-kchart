import type { AgentMessage } from './types';
import { Icon } from '../ui/icons';

/** 把工具调用渲染成一行 `set_symbol(symbol="NVDA")` */
function callLabel(name: string, args: Record<string, unknown>): string {
  const parts = Object.entries(args).map(([k, v]) => {
    const s = typeof v === 'string' ? JSON.stringify(v.length > 40 ? v.slice(0, 40) + '…' : v) : String(v);
    return k + '=' + s;
  });
  return name + '(' + parts.join(', ') + ')';
}

export function MessageList({ messages, sending }: { messages: AgentMessage[]; sending: boolean }): JSX.Element {
  const last = messages[messages.length - 1];
  return (
    <ol className="msg-list">
      {messages.map((m) => {
        if (m.role === 'user') {
          return (
            <li key={m.id} className="msg user">
              <div className="bubble">{m.content}</div>
            </li>
          );
        }
        if (m.role === 'tool') {
          return (
            <li key={m.id} className={'msg tool' + (m.isError ? ' err' : '')}>
              <Icon name={m.isError ? 'alertCircle' : 'check'} size={12} />
              <span className="tool-name">{m.toolName}</span>
              <span className="tool-out">{m.content}</span>
            </li>
          );
        }
        // assistant：空内容且无工具调用时不渲染（流式开始前的占位）
        const hasCalls = !!m.toolCalls?.length;
        if (!m.content && !hasCalls) return null;
        return (
          <li key={m.id} className={'msg assistant' + (m.isError ? ' err' : '')}>
            {m.content && <div className="md">{m.content}</div>}
            {hasCalls && (
              <ul className="calls">
                {m.toolCalls!.map((c) => (
                  <li key={c.id} className="call">
                    <Icon name="zap" size={11} />
                    <code>{callLabel(c.name, c.arguments)}</code>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
      {sending && last && last.role !== 'assistant' && (
        <li className="msg assistant">
          <span className="typing">
            <i />
            <i />
            <i />
          </span>
        </li>
      )}
    </ol>
  );
}
