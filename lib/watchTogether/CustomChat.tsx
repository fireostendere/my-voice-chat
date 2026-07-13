'use client';
import * as React from 'react';
import {
  ChatEntry,
  useChat,
  useMaybeLayoutContext,
  type ChatProps,
} from '@livekit/components-react';

export function CustomChat({
  messageFormatter,
  messageDecoder,
  messageEncoder,
  channelTopic,
  ...props
}: ChatProps) {
  const layoutContext = useMaybeLayoutContext();
  const ulRef = React.useRef<HTMLUListElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const lastReadTimestamp = React.useRef(0);

  const chatOptions = React.useMemo(
    () => ({ messageDecoder, messageEncoder, channelTopic }),
    [messageDecoder, messageEncoder, channelTopic],
  );
  const { chatMessages, send, isSending } = useChat(chatOptions);

  React.useEffect(() => {
    if (ulRef.current) ulRef.current.scrollTo({ top: ulRef.current.scrollHeight });
  }, [chatMessages]);

  React.useEffect(() => {
    if (!layoutContext || chatMessages.length === 0) return;
    const last = chatMessages[chatMessages.length - 1];
    if (layoutContext.widget.state?.showChat && lastReadTimestamp.current !== last.timestamp) {
      lastReadTimestamp.current = last.timestamp;
      return;
    }
    const unread = chatMessages.filter(
      (m) => !lastReadTimestamp.current || m.timestamp > lastReadTimestamp.current,
    ).length;
    if (unread > 0 && layoutContext.widget.state?.unreadMessages !== unread) {
      layoutContext.widget.dispatch?.({ msg: 'unread_msg', count: unread });
    }
  }, [chatMessages, layoutContext]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const input = inputRef.current;
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;

    try {
      await send(text);
    } catch (err) {
      console.error('Failed to send chat message', err);
      return; // keep the draft so the user can retry
    }
    input.value = '';
    input.focus();
  };

  return (
    <div {...props} className="lk-chat">
      <div className="lk-chat-header">
        Messages
        {layoutContext && (
          <button
            type="button"
            className="lk-button lk-chat-close-button"
            aria-label="Close chat"
            title="Close chat"
            onClick={() => layoutContext.widget.dispatch?.({ msg: 'toggle_chat' })}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        )}
      </div>
      <ul className="lk-list lk-chat-messages" ref={ulRef}>
        {chatMessages.map((msg, idx, arr) => {
          const hideName = idx >= 1 && arr[idx - 1].from === msg.from;
          const hideTimestamp = hideName && msg.timestamp - arr[idx - 1].timestamp < 60_000;
          return (
            <ChatEntry
              key={msg.id ?? idx}
              hideName={hideName}
              hideTimestamp={hideTimestamp}
              entry={msg}
              messageFormatter={messageFormatter}
            />
          );
        })}
      </ul>
      <form className="lk-chat-form" onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          className="lk-form-control lk-chat-form-input"
          disabled={isSending}
          type="text"
          placeholder="Message"
          onInput={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          onKeyUp={(e) => e.stopPropagation()}
        />
        <button type="submit" className="lk-button lk-chat-form-button" disabled={isSending}>
          Send
        </button>
      </form>
    </div>
  );
}
