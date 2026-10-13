import React from 'react';

export function RoomConnectionError({
  error,
  onRetry,
  onLeave,
}: {
  error?: string;
  onRetry: () => void;
  onLeave: () => void;
}) {
  if (!error) return null;
  return (
    <div className="lk-connection-error">
      <div role="alert">
        <h2>Let’s get you back in</h2>
        <p>{error}</p>
        <div className="lk-button-group">
          <button className="lk-button" onClick={onRetry} autoFocus>
            Try again
          </button>
          <button className="lk-button" onClick={onLeave}>
            Back to home
          </button>
        </div>
      </div>
    </div>
  );
}
