import type { IncomingHttpHeaders, Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import {
  gateSignalSchema,
  gateSubscriptionSchema,
  type GateSignal,
  type GateSubscription,
} from '@portl/contracts';

type Access = {
  authorize: (
    headers: IncomingHttpHeaders,
    subscription: GateSubscription,
    requestId?: string,
  ) => Promise<boolean>;
  acceptsOrigin: (origin: string) => boolean;
  budget: (userId: string) => Promise<boolean>;
};
type Peer = {
  subscription: GateSubscription;
  pending: Map<string, GateSignal>;
  running: boolean;
};

// Signals are best effort. REST remains authoritative after missed or conflated signals.
export function createGateSocketServer(http: HttpServer, access: Access) {
  const peers = new Map<Socket, Peer>();
  let authorizing = 0;
  const io = new Server(http, {
    path: '/socket.io',
    serveClient: false,
    maxHttpBufferSize: 2048,
    connectTimeout: 10_000,
    cors: {
      origin: (origin, done) =>
        done(null, !!origin && access.acceptsOrigin(origin)),
      credentials: true,
    },
    allowRequest: (req, done) => {
      const origin = req.headers.origin ?? req.headers['expo-origin'];
      done(
        null,
        typeof origin === 'string' &&
          access.acceptsOrigin(origin) &&
          io.engine.clientsCount < 100,
      );
    },
  });
  io.use(async (socket, next) => {
    let reserved = false;
    try {
      // Disconnected handshakes may still have database work outstanding.
      if (authorizing >= 100) throw new Error('denied');
      authorizing++;
      reserved = true;
      const subscription = gateSubscriptionSchema.parse(socket.handshake.auth);
      if (
        !(await access.authorize(socket.request.headers, subscription)) ||
        !(await access.budget(subscription.userId))
      )
        throw new Error('denied');
      // Reserve capacity after asynchronous checks to include handshakes in progress.
      if (
        socket.conn.readyState !== 'open' ||
        peers.size >= 100 ||
        [...peers.values()].filter(
          (p) => p.subscription.userId === subscription.userId,
        ).length >= 3
      )
        throw new Error('denied');
      peers.set(socket, { subscription, pending: new Map(), running: false });
      const forget = () => {
        peers.get(socket)?.pending.clear();
        peers.delete(socket);
      };
      socket.conn.once('close', forget);
      socket.once('disconnect', forget);
      next();
    } catch {
      next(
        Object.assign(new Error('Live gate updates unavailable'), {
          data: { code: 'ACCESS_DENIED' },
        }),
      );
    } finally {
      if (reserved) authorizing--;
    }
  });
  io.on('connection', (socket) => {
    // No client commands or arbitrary room subscriptions are supported.
    socket.onAny(() => socket.disconnect(true));
  });
  async function drain(socket: Socket, peer: Peer) {
    if (peer.running || !socket.connected) return;
    peer.running = true;
    try {
      while (socket.connected && peer.pending.size) {
        const signal = peer.pending.values().next().value!;
        peer.pending.delete(signal.requestId);
        if (
          await access.authorize(
            socket.request.headers,
            peer.subscription,
            signal.requestId,
          )
        ) {
          if (socket.connected) socket.volatile.emit('gate:changed', signal);
        }
      }
    } catch {
      // Fail closed on revocation or unavailable authorization; REST recovery remains usable.
      socket.disconnect(true);
    } finally {
      peer.running = false;
    }
  }
  const revalidate = setInterval(() => {
    for (const [socket, peer] of peers) {
      if (peer.running || !socket.connected) continue;
      peer.running = true;
      void access
        .authorize(socket.request.headers, peer.subscription)
        .then((allowed) => {
          if (!allowed) socket.disconnect(true);
        })
        .catch(() => socket.disconnect(true))
        .finally(() => {
          peer.running = false;
          void drain(socket, peer);
        });
    }
  }, 30_000);
  revalidate.unref();
  return {
    publish(value: GateSignal) {
      const parsed = gateSignalSchema.safeParse(value);
      if (!parsed.success) return;
      const signal = parsed.data;
      for (const [socket, peer] of peers) {
        if (
          !socket.connected ||
          peer.subscription.societyId !== signal.societyId
        )
          continue;
        const prior = peer.pending.get(signal.requestId);
        if (prior && prior.version >= signal.version) continue;
        if (!prior && peer.pending.size >= 32)
          peer.pending.delete(peer.pending.keys().next().value!);
        peer.pending.set(signal.requestId, signal);
        void drain(socket, peer);
      }
    },
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(revalidate);
        io.close(() => resolve());
      }),
  };
}
