# Story 2.5 — WebSocket Redis Realtime

- [x] Dependencies socket.io + redis-adapter + redis
- [x] HTTP server + Socket.IO + Redis adapter (fail-fast sans REDIS_URL)
- [x] Gateway auth mock + room:join/leave
- [x] Broadcast track:added / queue:updated / vote:added after REST success
- [x] Makefile `api-test-ws` + scripts smoke/unit
- [x] Vérif Docker: health, db-push, ws-smoke, api-test, api-test-license

## Review

- Socket.IO sur le même port que REST; fan-out uniquement.
- Smoke `make api-test-ws` OK; REST licenses non régressés.
- Story status → `review`.
