/**
 * Wire format between the relay and a connector: one JSON object per WebSocket text message.
 *
 *   connector -> relay   hello {token, host}
 *   relay -> connector   welcome {host} | ping
 *   relay -> connector   req {id, method, path, headers, body(base64|null)} | req-cancel {id}
 *   connector -> relay   res-head {id, status, headers} | res-body {id, data(base64)} | res-end {id} | res-error {id, message}
 *   both ways            ws-open {id, path, headers} (relay->) | ws-opened {id} (->relay)
 *                        ws-msg {id, data, binary} | ws-close {id, code, reason}
 *
 * Shared by the relay (relay/server.mjs) and the connector (server/connector/connector.mjs keeps its own
 * copy so it has no dependencies).
 */
export const HOST_ID = /^[a-z0-9]{12,40}$/;

export function encodeFrame(frame) {
  return JSON.stringify(frame);
}

export function decodeFrame(raw, isBinary = false) {
  if (isBinary) return null;
  try {
    const frame = JSON.parse(raw.toString());
    return frame && typeof frame === "object" && typeof frame.t === "string" ? frame : null;
  } catch {
    return null;
  }
}
